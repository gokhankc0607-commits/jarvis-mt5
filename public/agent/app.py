"""
app.py — JARVIS ana çalıştırıcı (yerel ajan)
============================================
Tüm modülleri birbirine bağlar ve web komuta merkeziyle canlı konuşur:

  MT5Engine  ──► hesap / pozisyon / sinyal adayları ──► /api/agent/sync ──► Komuta Merkezi (Orb UI)
  Komuta Merkezi ──► onaylı sinyaller, kapatma istekleri, derleme işleri ──► ajan yürütür ──► /api/agent/report
  Sesli döngü: yeni sinyal -> "X paritesinde BUY fırsatı oluştu, işleme gireyim mi?" -> Whisper -> yalnızca "Evet" = onay
  Uyandırma kelimesi: "Jarvis ..." -> yerel LLM ile sohbet, "durum", "derle <ad>"

Kullanım:
  python app.py                      # tam mod
  python app.py --no-voice           # ses kapalı (onaylar panelden)
  python app.py --simulate           # MT5 olmadan test
  python app.py --test-compile Experts\\Jarvis\\X.mq5
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
import queue
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any, Optional

import requests

from local_ai import JarvisBrain, LLMClient, SpeechToText, TextToSpeech, has_wake_word, is_no, is_yes
from mql5_compiler import MQL5Compiler
from kanal_strategy import KanalParams, kanal_analyze, kanal_levels
from mt5_engine import ALGO_HINT, TIMEFRAMES, MT5Engine, SignalCandidate, WatchRule

log = logging.getLogger("jarvis")
AGENT_VERSION = "2.8.1"
# PyInstaller ile paketlendiğinde config / modeller .exe'nin yanındaki klasörden okunur
ROOT = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).parent


STATE_FILE = ROOT / ".jarvis_state.json"   # gönderilmiş sinyal kimlikleri (yeniden başlatmada ikinci emir açılmasın)
APPROVAL_MAX_AGE_SEC = 15 * 60             # bu süreden eski onaylar güvenlik için yürütülmez


def load_state() -> dict:
    try:
        d = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def save_state(d: dict) -> None:
    try:
        tmp = STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(d), encoding="utf-8")
        tmp.replace(STATE_FILE)
    except Exception as e:  # noqa: BLE001
        log.debug("durum dosyası yazılamadı: %s", e)


def parse_iso(v: Any) -> Optional[datetime]:
    """Panelden gelen ISO zaman damgası (örn. 2026-10-14T20:40:00.000Z) -> aware datetime."""
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


def rel(p: Optional[str]) -> Optional[str]:
    """Config içindeki göreli yolları uygulama klasörüne göre çözer."""
    if not p:
        return p
    q = Path(p)
    if q.is_absolute():
        return str(q)
    cand = ROOT / q
    return str(cand) if cand.exists() else p  # örn. "small" gibi model adları olduğu gibi kalır


# --------------------------------------------------------------------------- #
class Dashboard:
    def __init__(self, url: str, key: str) -> None:
        self.url = url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"x-agent-key": key, "Content-Type": "application/json"})

    def sync(self, payload: dict) -> dict:
        r = self.s.post(f"{self.url}/api/agent/sync", data=json.dumps(payload, default=str), timeout=15)
        r.raise_for_status()
        return r.json()

    def ticks(self, payload: dict) -> None:
        try:
            r = self.s.post(f"{self.url}/api/agent/ticks", data=json.dumps(payload, default=str), timeout=5)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.debug("Fiyatlar gönderilemedi: %s", e)

    def market(self, payload: dict) -> None:
        try:
            r = self.s.post(f"{self.url}/api/agent/market", data=json.dumps(payload, default=str), timeout=20)
            r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            log.debug("Piyasa verisi gönderilemedi: %s", e)

    def report(self, payload: dict) -> dict:
        try:
            r = self.s.post(f"{self.url}/api/agent/report", data=json.dumps(payload, default=str), timeout=15)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            log.error("Rapor gönderilemedi: %s", e)
            return {}


# --------------------------------------------------------------------------- #
class Jarvis:
    def __init__(self, cfg: dict, voice: bool, simulate: bool) -> None:
        self.cfg = cfg
        self.dash = Dashboard(cfg["dashboard_url"], cfg["agent_key"])
        m = cfg.get("mt5", {})
        self.engine = MT5Engine(m.get("terminal_path") or None, m.get("login") or None, m.get("password") or None,
                                m.get("server") or None, magic=m.get("magic", 770077), simulate=simulate)
        self.compiler = MQL5Compiler(cfg["metaeditor_path"], cfg["mql5_dir"], wine=cfg.get("wine", False))
        self.local_llm = LLMClient.from_dict(cfg["llm"]) if cfg.get("llm") else None
        self.remote_llm: Optional[LLMClient] = None
        self.brain: Optional[JarvisBrain] = None
        self.rules: list[WatchRule] = []
        self.watch: list[dict] = []  # paneldeki tüm izlenen (parite, zaman dilimi) çiftleri
        self.kanal: dict = {}        # panelden gelen KANAL strateji ayarları
        self._fired: dict[tuple, int] = {}  # (sembol, tf, yön) -> sinyal verilen bar zamanı
        self.scan_symbols: list[str] = []   # Piyasa Gözlemi sembolleri (fiyat akışı için)
        self.feed_errors: dict[str, str] = {}  # "SEMBOL TF" -> son hata
        self.known_pos: dict[str, dict] = {}   # açık pozisyonlar (kapanışı yakalamak için)
        self.pos_miss: dict[str, int] = {}
        self.closed_buf: list[dict] = []
        self._algo_warn = 0.0
        self.outbox: list[dict] = []
        self.asked: set[int] = set()
        st = load_state()
        self.executed: set[int] = {int(x) for x in st.get("executed", []) if str(x).isdigit()}
        if self.executed:
            log.info("Önceki oturumdan %d gönderilmiş sinyal kimliği yüklendi (mükerrer emir koruması)", len(self.executed))
        self.compile_q: "queue.Queue[dict]" = queue.Queue()
        self.voice_q: "queue.Queue[dict]" = queue.Queue()
        self.lock = threading.Lock()
        self.level = 0.0
        self.voice_enabled = voice
        self.stt: Optional[SpeechToText] = None
        self.tts: Optional[TextToSpeech] = None
        self.busy_voice = threading.Event()
        self.stop = threading.Event()

    # ------------------------------------------------------------------ yardımcı
    @property
    def llm(self) -> Optional[LLMClient]:
        # config.json'daki yerel LLM her zaman önceliklidir; yoksa paneldeki aktif sağlayıcı
        return self.local_llm or self.remote_llm

    def _set_level(self, v: float) -> None:
        self.level = v

    def _mark_executed(self, sid: int) -> None:
        self.executed.add(sid)
        save_state({"executed": sorted(self.executed)[-500:]})

    def speak(self, text: str) -> None:
        if self.tts:
            self.tts.say(text)
        else:
            log.info("JARVIS: %s", text)

    def listen(self, **kw: Any) -> str:
        if not self.stt:
            return ""
        return self.stt.listen(**kw)

    # ------------------------------------------------------------------ başlat
    def start(self) -> None:
        if not self.engine.connect():
            log.error("MT5'e bağlanılamadı. Terminal açık ve 'Algo Trading' etkin mi?")
        if self.voice_enabled:
            v = self.cfg.get("voice", {})
            try:
                self.tts = TextToSpeech(rel(v.get("piper_model")) or None, on_level=self._set_level)
                self.stt = SpeechToText(rel(v.get("whisper_model", "small")) or "small", v.get("device", "auto"),
                                        v.get("compute_type", "int8"), on_level=self._set_level)
            except Exception as e:  # noqa: BLE001
                log.error("Ses modülleri başlatılamadı (%s) -> sessiz mod", e)
                self.voice_enabled = False
        threading.Thread(target=self.sync_loop, daemon=True, name="sync").start()
        threading.Thread(target=self.scan_loop, daemon=True, name="scan").start()
        threading.Thread(target=self.market_loop, daemon=True, name="market").start()
        threading.Thread(target=self.quote_loop, daemon=True, name="quotes").start()
        log.info("JARVIS ajan v%s başlatıldı", AGENT_VERSION)
        threading.Thread(target=self.compile_worker, daemon=True, name="compile").start()
        if self.voice_enabled:
            threading.Thread(target=self.voice_loop, daemon=True, name="voice").start()
        if self.cfg.get("open_browser", True):
            webbrowser.open(self.cfg["dashboard_url"] + "/dashboard")
        self.speak("JARVIS çevrimiçi efendim. Piyasaları izliyorum.")
        try:
            while not self.stop.is_set():
                time.sleep(0.5)
        except KeyboardInterrupt:
            log.info("Kapatılıyor…")
            self.stop.set()
            self.engine.shutdown()

    # ------------------------------------------------------------------ senkronizasyon
    def sync_loop(self) -> None:
        interval = self.cfg.get("sync_interval", 2.0)
        while not self.stop.is_set():
            try:
                acc = self.engine.account()
                pos_objs = self.engine.positions(strict=True) if acc.connected else []
                # None = MT5 API geçici hata: panele pozisyon listesi gönderme (açık işlemler 'kapandı' sayılmasın)
                positions = [p.to_dict() for p in pos_objs] if pos_objs is not None else None
                if acc.connected and pos_objs is not None:
                    cur = {str(p.ticket) for p in pos_objs}
                    for tk in list(self.known_pos):  # kapanan pozisyonların gerçek K/Z'sini al
                        if tk in cur:
                            continue
                        ds = self.engine.deal_summary(int(tk))
                        self.pos_miss[tk] = self.pos_miss.get(tk, 0) + 1
                        if ds or self.pos_miss[tk] >= 6:
                            if ds:
                                self.closed_buf.append(ds)
                            self.known_pos.pop(tk, None)
                            self.pos_miss.pop(tk, None)
                    for p in pos_objs:
                        self.known_pos[str(p.ticket)] = p.to_dict()
                    if not acc.algo and time.time() - self._algo_warn > 300:
                        self._algo_warn = time.time()
                        log.warning("⚠ %s", ALGO_HINT)
                        self.voice_q.put({"say": "Dikkat efendim, MT5'te Algo Trading kapalı. Onaylasanız bile emir gönderemem."})
                with self.lock:
                    out, self.outbox = self.outbox, []
                payload = {"account": acc.to_dict(), "positions": positions, "closed": list(self.closed_buf), "signals": out,
                           "agent": {"version": AGENT_VERSION, "algo": acc.algo, "tradeAllowed": acc.tradeAllowed, "build": acc.build}}
                resp = self.dash.sync(payload)
                self.closed_buf = []
                self.handle_sync(resp)
            except requests.RequestException as e:
                log.warning("Panel erişilemedi: %s", e)
            except Exception as e:  # noqa: BLE001
                log.exception("sync hatası: %s", e)
            time.sleep(interval)

    def handle_sync(self, resp: dict) -> None:
        self.rules = [WatchRule.from_dict(r) for r in resp.get("rules", [])]
        self.watch = resp.get("watchlist", [])
        self.kanal = resp.get("kanal") or {}
        prov = resp.get("provider")
        if prov:
            self.remote_llm = LLMClient.from_dict(prov)
        if self.llm and not self.brain:
            self.brain = JarvisBrain(self.llm)

        # 1) ONAYLI sinyaller -> emir (KESİN KURAL: yalnızca status=approved)
        for s in resp.get("approvedSignals", []):
            if s["id"] in self.executed or s.get("status") != "approved":
                continue
            comment = f"JARVIS {s['side']} #{s['id']}"
            # Güvenlik 1: eski onay (ajan kapalıyken verilmiş) yürütülmez — fiyat/SL/TP bayattır
            dt = parse_iso(s.get("decidedAt"))
            age = (datetime.now(timezone.utc) - dt).total_seconds() if dt else 0.0
            if age > APPROVAL_MAX_AGE_SEC:
                self._mark_executed(s["id"])
                self.dash.report({"type": "signal", "id": s["id"], "status": "failed",
                                  "note": f"Onay {int(age // 60)} dk önce verilmiş — güvenlik için gönderilmedi. Fiyat güncelse 'Tekrar dene'."})
                continue
            # Güvenlik 2: aynı sinyal için MT5'te zaten pozisyon/işlem varsa (rapor ulaşmamış, ajan yeniden başlamış) tekrar açma
            dup = self.engine.find_by_comment(comment)
            if dup is not None:
                log.warning("Sinyal #%s için MT5'te zaten işlem var (bilet %s) — tekrar gönderilmedi", s["id"], dup)
                self._mark_executed(s["id"])
                self.dash.report({"type": "signal", "id": s["id"], "status": "executed",
                                  "note": f"MT5 bilet #{dup} (daha önce gönderilmişti; mükerrer emir engellendi)"})
                continue
            self._mark_executed(s["id"])
            r = self.engine.place_order(s["symbol"], s["side"], s["volume"], s.get("sl"), s.get("tp"),
                                        comment=comment, approved=True, signal_price=s.get("price"))
            if r.ok:
                log.info("✓ Emir gerçekleşti: %s %s %s lot — %s", s["symbol"], s["side"], s["volume"], r.message)
                self.dash.report({"type": "signal", "id": s["id"], "status": "executed",
                                  "note": f"MT5 bilet #{r.ticket} @ {r.price} · {r.message}"[:480]})
                self.voice_q.put({"say": f"{s['symbol']} {s['side']} emri gerçekleşti efendim. Bilet {r.ticket}."})
            else:
                log.error("✗ Emir reddedildi: %s %s — %s", s["symbol"], s["side"], r.message)
                self.executed.discard(s["id"])  # panelden "Tekrar dene" ile yeniden gönderilebilsin
                save_state({"executed": sorted(self.executed)[-500:]})
                self.dash.report({"type": "signal", "id": s["id"], "status": "failed", "note": r.message[:480]})
                short = "MT5'te Algo Trading kapalı. Üstteki Algo Trading düğmesini açın." if r.retcode == 10027 else r.message[:160]
                self.voice_q.put({"say": f"Dikkat efendim, {s['symbol']} emri gönderilemedi. {short}"})

        # 2) Kapatma istekleri
        for t in resp.get("closeTickets", []):
            r = self.engine.close_position(int(t))
            log.info("Kapatma #%s -> %s %s", t, r.ok, r.message)

        # 3) Derleme işleri
        for job in resp.get("compileJobs", []):
            self.compile_q.put(job)

        # 4) Bekleyen sinyaller -> sesli sor
        for s in resp.get("pendingSignals", []):
            if s["id"] not in self.asked:
                self.asked.add(s["id"])
                self.voice_q.put({"ask": s})

    # ------------------------------------------------------------------ tarama
    def scan_loop(self) -> None:
        interval = self.cfg.get("scan_interval", 10.0)
        while not self.stop.is_set():
            k = self.kanal
            if k and k.get("enabled", True):
                try:
                    self.kanal_scan(k)
                except Exception as e:  # noqa: BLE001
                    log.exception("KANAL tarama hatası: %s", e)
            else:  # KANAL kapalıysa eski RSI/CCI kural taraması
                for rule in list(self.rules):
                    try:
                        cand = self.engine.analyze(rule)
                        if cand:
                            log.info("⚡ Sinyal: %s %s (%s) %s", cand.symbol, cand.side, cand.confidence, cand.reason)
                            with self.lock:
                                self.outbox.append(cand.to_dict())
                    except Exception as e:  # noqa: BLE001
                        log.warning("%s analiz hatası: %s", rule.symbol, e)
            time.sleep(interval)

    def kanal_scan(self, k: dict) -> None:
        """KANAL3BAND geri dönüş + RSI + CCI(MA) stratejisi — Piyasa Gözlemi'ndeki TÜM pariteler."""
        params = KanalParams.from_dict(k.get("params"))
        tfs = [t.strip() for t in str(k.get("timeframes", "M15,H1")).split(",") if t.strip() in TIMEFRAMES]
        if not tfs:
            return
        if k.get("scanAll", True):
            symbols = self.engine.market_watch_symbols()
        else:
            symbols = sorted({w["symbol"] for w in self.watch})
        lot = float(k.get("lot", 0.1))
        self.scan_symbols = list(symbols)
        items: list[dict] = []
        for sym in symbols:
            for tf in tfs:
                try:
                    df = self.engine.rates(sym, tf, 320)
                    res = kanal_analyze(sym, tf, df, params)
                except Exception as e:  # noqa: BLE001
                    self.feed_errors[f"{sym} {tf}"] = str(e)[:140]
                    log.debug("%s %s taranamadı: %s", sym, tf, e)
                    continue
                self.feed_errors.pop(f"{sym} {tf}", None)
                if res is None:
                    continue
                items.append(res)
                if not res["fire"] or not res["side"]:
                    continue
                key = (sym, tf, res["side"])
                if self._fired.get(key) == res["barTime"]:
                    continue  # bu bar için sinyal zaten verildi
                self._fired[key] = res["barTime"]
                try:
                    bid, ask = self.engine.tick(sym)
                    entry = ask if res["side"] == "BUY" else bid
                    sl, tp = kanal_levels(res["side"], entry, res["extreme"], res["center"], res["atr"], params.slBufferAtr)
                except Exception:  # noqa: BLE001
                    entry, sl, tp = res["entry"], res["sl"], res["tp"]
                digits = 2 if entry > 1000 else 3 if entry > 50 else 5
                strength = int(res.get("strength", 1))
                cand = SignalCandidate(
                    symbol=sym, side=res["side"], timeframe=tf, price=round(entry, digits), sl=round(sl, digits),
                    tp=round(tp, digits), volume=lot, reason="KANAL: " + res["reason"],
                    confidence=int(min(95, 62 + 10 * strength + abs((res["rsi"] or 50) - 50) / 5)),
                    indicators={"RSI": round(res["rsi"] or 0, 1), "CCI": round(res["cci"] or 0, 1),
                                "CCI_MA": round(res["cciMa"] or 0, 1), "Band": params.band, "kırılan band": strength},
                )
                log.info("⚡ KANAL sinyal: %s %s %s — %s", sym, tf, res["side"], res["reason"])
                with self.lock:
                    self.outbox.append(cand.to_dict())
        self.dash.market({"scan": items, "watch": symbols})

    # ------------------------------------------------------------------ piyasa verisi (panel grafiği, RSI/CCI radarı)
    def market_loop(self) -> None:
        interval = self.cfg.get("market_interval", 6.0)
        last_log = 0.0
        while not self.stop.is_set():
            series: list[dict] = []
            for w in list(self.watch):
                key = f"{w.get('symbol')} {w.get('timeframe')}"
                try:
                    series.append(self.engine.market_snapshot(w["symbol"], w["timeframe"], 320))
                    self.feed_errors.pop(key, None)
                except Exception as e:  # noqa: BLE001
                    self.feed_errors[key] = str(e)[:140]
                    log.debug("%s verisi alınamadı: %s", key, e)
            if series or self.feed_errors:
                try:
                    ping = self.engine.account().ping
                except Exception:  # noqa: BLE001
                    ping = 0.0
                self.dash.market({"series": series, "ping": ping, "feed": {"errors": list(self.feed_errors.items())[:20], "ok": len(series)}})
            if time.time() - last_log > 60:
                last_log = time.time()
                log.info("Veri akışı: %d seri gönderildi, %d hata%s", len(series), len(self.feed_errors),
                         (" → " + "; ".join(f"{k}: {v}" for k, v in list(self.feed_errors.items())[:3])) if self.feed_errors else "")
            time.sleep(interval)

    def quote_symbols(self) -> list[str]:
        names = {w["symbol"] for w in self.watch}
        names |= {p["symbol"] for p in self.known_pos.values()}
        names |= set(self.scan_symbols[:40])
        return sorted(names)[:80]

    def quote_loop(self) -> None:
        """Canlı fiyat akışı: her saniye bid/ask (grafik ve fiyat listesi bununla akar)."""
        interval = self.cfg.get("quote_interval", 1.0)
        while not self.stop.is_set():
            try:
                names = self.quote_symbols()
                if names:
                    q = self.engine.quotes(names)
                    if q:
                        self.dash.ticks({"ticks": q})
            except Exception as e:  # noqa: BLE001
                log.debug("quote hatası: %s", e)
            time.sleep(interval)

    # ------------------------------------------------------------------ derleme
    def compile_worker(self) -> None:
        while not self.stop.is_set():
            job = self.compile_q.get()
            path = job["filePath"]
            lines: list[str] = []
            try:
                self.compiler.write(path, job["code"])
                rep = self.compiler.auto_fix(
                    path, self.llm if job.get("autoFix", True) else None,
                    max_attempts=job.get("maxAttempts", 5), on_progress=lambda s: lines.append(s),
                )
                self.dash.report({
                    "type": "compile", "jobId": job["jobId"], "status": "success" if rep.success else "failed",
                    "errors": len(rep.final.errors), "warnings": len(rep.final.warnings), "attempt": rep.attempts,
                    "log": rep.log + ("\n\n--- MetaEditor ---\n" + rep.final.log[-3000:] if rep.final.log else ""),
                    "code": rep.code,
                })
                msg = (f"{job['name']} başarıyla derlendi efendim." if rep.success
                       else f"{job['name']} derlemesi {rep.attempts} denemeye rağmen başarısız. Logları inceleyin.")
                self.voice_q.put({"say": msg})
            except Exception as e:  # noqa: BLE001
                log.exception("Derleme hatası")
                self.dash.report({"type": "compile", "jobId": job["jobId"], "status": "failed", "errors": 1,
                                  "log": "\n".join(lines) + f"\nAjan hatası: {e}"})

    # ------------------------------------------------------------------ ses
    def ask_signal(self, s: dict) -> None:
        sym = s["symbol"]
        side = "alış" if s["side"] == "BUY" else "satış"
        q = (f"Efendim, {sym} paritesinde {s['side']} yani {side} fırsatı oluştu. {s.get('reason', '')}. "
             f"Güven yüzde {s.get('confidence', 0)}. İşleme gireyim mi?")
        for attempt in range(2):
            self.speak(q if attempt == 0 else "Anlayamadım efendim. Evet mi, hayır mı?")
            ans = self.listen(max_seconds=5, start_timeout=7)
            if ans:
                self.dash.report({"type": "message", "role": "user", "content": f"🎙 {ans}"})
            if is_yes(ans):
                self.dash.report({"type": "decision", "signalId": s["id"], "approve": True})
                self.speak("Onay alındı. Emri gönderiyorum.")
                return
            if is_no(ans):
                self.dash.report({"type": "decision", "signalId": s["id"], "approve": False})
                self.speak("Anlaşıldı, fırsatı pas geçiyorum.")
                return
        # Belirsiz -> işlem AÇILMAZ, panelde beklemeye devam eder
        self.speak("Onay alamadım. Sinyal panelde onayınızı bekliyor.")

    def voice_loop(self) -> None:
        wake = self.cfg.get("voice", {}).get("wake_word", "jarvis")
        while not self.stop.is_set():
            try:
                task = self.voice_q.get(timeout=0.2)
                if "ask" in task:
                    self.ask_signal(task["ask"])
                elif "say" in task:
                    self.speak(task["say"])
                continue
            except queue.Empty:
                pass
            # Uyandırma kelimesi dinleme
            heard = self.listen(max_seconds=6, start_timeout=3, silence_sec=0.7)
            if not heard or not has_wake_word(heard, wake):
                continue
            cmd = heard.lower().split(wake, 1)[-1].strip(" ,.")
            if not cmd:
                self.speak("Buyurun efendim.")
                cmd = self.listen(max_seconds=10)
            if cmd:
                self.handle_command(cmd)

    def handle_command(self, cmd: str) -> None:
        self.dash.report({"type": "message", "role": "user", "content": f"🎙 {cmd}"})
        c = cmd.lower()
        if c.startswith(("durum", "bakiye", "hesap")):
            a = self.engine.account()
            pos = self.engine.positions()
            reply = (f"Bakiye {a.balance:.2f}, varlık {a.equity:.2f}, serbest teminat {a.freeMargin:.2f} {a.currency}. "
                     f"{len(pos)} açık işlem, toplam {sum(p.pnl for p in pos):.2f} kâr zarar.")
        elif c.startswith("derle"):
            reply = "Derleme komutunu panelden veya 'derle strateji adı' ile verebilirsiniz; işi kuyruğa alması için komuta merkezini kullanıyorum."
        elif self.brain:
            a = self.engine.account()
            ctx = f"bakiye {a.balance}, varlık {a.equity}, izlenen: {', '.join(r.symbol for r in self.rules)}"
            reply = self.brain.ask(cmd, ctx)
        else:
            reply = "Yerel LLM yapılandırılmadı efendim."
        self.dash.report({"type": "message", "role": "assistant", "content": reply})
        self.speak(reply)


# --------------------------------------------------------------------------- #
def load_config(path: Path) -> dict:
    if not path.exists():
        ex = ROOT / "config.example.json"
        log.error("config.json bulunamadı. '%s' dosyasını kopyalayıp düzenleyin.", ex)
        sys.exit(1)
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: Optional[list[str]] = None) -> None:
    ap = argparse.ArgumentParser(description="JARVIS yerel ajan")
    ap.add_argument("--config", default=str(ROOT / "config.json"))
    ap.add_argument("--no-voice", action="store_true")
    ap.add_argument("--simulate", action="store_true", help="MT5 olmadan simülasyon")
    ap.add_argument("--test-compile", metavar="MQ5")
    ap.add_argument("-v", "--verbose", action="store_true")
    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if a.verbose else logging.INFO,
                        format="%(asctime)s │ %(name)-12s │ %(levelname)-7s │ %(message)s", datefmt="%H:%M:%S")
    cfg = load_config(Path(a.config))

    if a.test_compile:
        comp = MQL5Compiler(cfg["metaeditor_path"], cfg["mql5_dir"], wine=cfg.get("wine", False))
        llm = LLMClient.from_dict(cfg["llm"]) if cfg.get("llm") else None
        rep = comp.auto_fix(a.test_compile, llm)
        print(rep.log)
        sys.exit(0 if rep.success else 1)

    Jarvis(cfg, voice=not a.no_voice and cfg.get("voice", {}).get("enabled", True), simulate=a.simulate).start()


if __name__ == "__main__":
    main()
