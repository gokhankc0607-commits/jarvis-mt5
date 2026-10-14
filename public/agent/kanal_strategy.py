"""
kanal_strategy.py — KANAL3BAND geri dönüş + RSI + CCI(MA) stratejisi
====================================================================
Panel (src/lib/kanal.ts) ve MQL5 EA (KANAL_Strateji.mq5) ile AYNI mantık.

SATIŞ: fiyat ÜST bandı kırar ve kapanış tekrar band İÇİNE döner, RSI 70 altında,
       CCI mor çizgiyi (CCI MA) AŞAĞI keser.
ALIŞ : fiyat ALT bandı kırar ve içeri döner, RSI 30'u YUKARI keser, CCI mor çizgiyi YUKARI keser.
Sinyal, tüm koşulların ilk kez sağlandığı KAPANMIŞ barda bir kez üretilir.

v2.9 kuralları:
  • SIRA  : İLK kural band içinde mum kapanışı (dönüş barı); RSI ve CCI onayı yalnızca dönüş barından
            itibaren sayılır (strictOrder). Dönüşten önceki kesişimler onay değildir.
  • YÖN   : RSI ve CCI son `confirmBars` kapanmış barda arka arkaya AYNI yönde hareket etmelidir
            (ALIŞ: ikisi de yükseliyor · SATIŞ: ikisi de düşüyor).
  • SL    : ALIŞ -> önceki dip VEYA RSI'ın dönüş yaptığı barın dibi (daha düşük olan) - ATR payı
            SATIŞ -> önceki tepe VEYA RSI'ın dönüş yaptığı barın tepesi (daha yüksek olan) + ATR payı
  • TP    : ALIŞ -> girişin üstündeki EN YAKIN üst band · SATIŞ -> girişin altındaki EN YAKIN alt band
            (tpMode=center ile eski davranış: merkez çizgi)
  • GÜVEN : 40 + 12×kırılan band + 10×sıra + 10×yön + RSI aşırılığı (≤12) + CCI aşırılığı (≤8), en çok 97.
            Ajan, autoTrade açıkken güven ≥ autoMinConfidence olan sinyali SORMADAN gönderir.

NOT: Centered YSR geçmiş+gelecek barları kullandığı için grafikte yeniden boyanır. Strateji, OLUŞMAKTA OLAN
barı merkez hesabına katmaz (yalnızca kapanmış barlar) — böylece sinyal bar boyunca sabit kalır, titremez.
"""
from __future__ import annotations

from dataclasses import dataclass, fields
from typing import Any, Optional

import numpy as np
import pandas as pd


@dataclass
class KanalParams:
    halfLength: int = 60
    atrPeriod: int = 100
    atrMult1: float = 4.2
    atrMult2: float = 3.5
    atrMult3: float = 2.8
    band: int = 3                 # 1 = en dış (4.2) · 3 = en iç (2.8)
    breakLookback: int = 5
    crossLookback: int = 3
    breakByClose: bool = False
    rsiPeriod: int = 14
    rsiOb: float = 70.0
    rsiOs: float = 30.0
    sellRsiMode: str = "below"    # below | crossDown
    buyRsiMode: str = "crossUp"   # crossUp | above
    cciPeriod: int = 34
    cciMaPeriod: int = 21
    slBufferAtr: float = 0.5
    # --- v2.9: giriş sırası, yön onayı, seviye kuralları
    strictOrder: bool = True      # önce band içine kapanış, SONRA RSI & CCI onayı
    confirmBars: int = 1          # RSI ve CCI'nin arka arkaya aynı yönde olması gereken bar sayısı (0 = kapalı)
    slAnchor: str = "swingRsi"    # swingRsi: önceki dip/tepe + RSI dönüş barı · break: yalnız kırılım ucu (eski)
    tpMode: str = "nearestBand"   # nearestBand: en yakın karşı band · center: merkez çizgi (eski)
    # --- otomatik işlem (ajan uygular)
    autoTrade: bool = False       # güven eşiğini geçen sinyali sormadan gönder
    autoMinConfidence: int = 80   # otomatik giriş için en düşük güven (%)
    autoMaxOpen: int = 3          # aynı anda en fazla otomatik açık işlem
    breakEvenPct: int = 30        # TP yolunun bu yüzdesi kadar kâr edince SL -> giriş (0 = kapalı)

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "KanalParams":
        d = d or {}
        out = cls()
        for f in fields(cls):
            if f.name in d and d[f.name] is not None:
                try:
                    v = d[f.name]
                    cur = getattr(out, f.name)
                    if isinstance(cur, bool):
                        v = bool(v)
                    elif isinstance(cur, int):
                        v = int(round(float(v)))
                    elif isinstance(cur, float):
                        v = float(v)
                    else:
                        v = str(v)
                    setattr(out, f.name, v)
                except (TypeError, ValueError):
                    pass
        out.band = min(3, max(1, out.band))
        out.confirmBars = min(5, max(0, out.confirmBars))
        out.slAnchor = out.slAnchor if out.slAnchor in ("swingRsi", "break") else "swingRsi"
        out.tpMode = out.tpMode if out.tpMode in ("nearestBand", "center") else "nearestBand"
        out.autoMinConfidence = min(97, max(50, out.autoMinConfidence))
        out.autoMaxOpen = min(20, max(1, out.autoMaxOpen))
        out.breakEvenPct = min(90, max(0, out.breakEvenPct))
        return out


# --------------------------------------------------------------------------- #
def center_at(pr: np.ndarray, i: int, H: int, n_eff: Optional[int] = None) -> Optional[float]:
    """n_eff: sağ kenar (gelecek tarafın bittiği bar sayısı). Strateji oluşmakta olan barı hariç tutar."""
    if i - H < 0:
        return None
    n = len(pr) if n_eff is None else n_eff
    w = np.arange(H, 0, -1, dtype=float)             # j = 1..H -> k = H..1
    s = (H + 1) * pr[i] + float(np.dot(w, pr[i - H:i][::-1]))
    sw = (H + 1) + float(w.sum())
    m = min(H, n - 1 - i)                            # gelecek taraf son bara kadar
    if m > 0:
        s += float(np.dot(w[:m], pr[i + 1:i + 1 + m]))
        sw += float(w[:m].sum())
    return s / sw


def atr_at(h: np.ndarray, l: np.ndarray, c: np.ndarray, i: int, P: int) -> Optional[float]:
    if i < P + 10:
        return None
    q = np.arange(i - 10 - P + 1, i - 10 + 1)
    hi = np.maximum(h[q], c[q - 1])
    lo = np.minimum(l[q], c[q - 1])
    return float((hi - lo).sum() / P)


def rsi_wilder(close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    out = np.full(n, np.nan)
    if n <= period:
        return out
    d = np.diff(close)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    au = up[:period].mean()
    ad = dn[:period].mean()

    def val(u: float, dd: float) -> float:
        if dd == 0:
            return 100.0
        if u == 0:
            return 0.0
        return 100.0 - 100.0 / (1.0 + u / dd)

    out[period] = val(au, ad)
    for i in range(period + 1, n):
        au = (au * (period - 1) + up[i - 1]) / period
        ad = (ad * (period - 1) + dn[i - 1]) / period
        out[i] = val(au, ad)
    return out


def cci_series(h: np.ndarray, l: np.ndarray, c: np.ndarray, period: int) -> np.ndarray:
    tp = (h + l + c) / 3.0
    n = len(tp)
    out = np.full(n, np.nan)
    if n < period:
        return out
    win = np.lib.stride_tricks.sliding_window_view(tp, period)      # (n-period+1, period)
    sma = win.mean(axis=1)
    md = np.abs(win - sma[:, None]).mean(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        v = np.where(md == 0, 0.0, (tp[period - 1:] - sma) / (0.015 * md))
    out[period - 1:] = v
    return out


def sma_series(src: np.ndarray, period: int) -> np.ndarray:
    n = len(src)
    out = np.full(n, np.nan)
    valid = np.where(~np.isnan(src))[0]
    if len(valid) == 0:
        return out
    s = int(valid[0])
    for i in range(s + period - 1, n):
        out[i] = src[i - period + 1:i + 1].mean()
    return out


def kanal_levels(side: str, entry: float, anchor: float, center: float, atr: float, buf: float,
                 up_bands: Optional[list[float]] = None, dn_bands: Optional[list[float]] = None,
                 tp_mode: str = "center") -> tuple[float, float]:
    """SL = çapa (önceki dip/tepe ya da RSI dönüş barı) ∓ buf×ATR; yanlış taraftaysa giriş ∓ 1.5 ATR.
    TP = tp_mode=nearestBand: girişe EN YAKIN karşı band (en az 0.5 ATR uzakta) · center: merkez çizgi.
    Band bulunamazsa merkez, o da yanlış taraftaysa 1.5R kullanılır (eski davranış)."""
    if side == "SELL":
        sl = anchor + buf * atr
        if sl <= entry:
            sl = entry + 1.5 * atr
        tp = None
        if tp_mode == "nearestBand" and dn_bands:
            cands = [v for v in dn_bands if v is not None and v < entry - 0.5 * atr]
            if cands:
                tp = max(cands)          # girişin altında, girişe en yakın alt band
        if tp is None:
            tp = center
        if tp >= entry:
            tp = entry - 1.5 * (sl - entry)
        return sl, tp
    sl = anchor - buf * atr
    if sl >= entry:
        sl = entry - 1.5 * atr
    tp = None
    if tp_mode == "nearestBand" and up_bands:
        cands = [v for v in up_bands if v is not None and v > entry + 0.5 * atr]
        if cands:
            tp = min(cands)              # girişin üstünde, girişe en yakın üst band
    if tp is None:
        tp = center
    if tp <= entry:
        tp = entry + 1.5 * (entry - sl)
    return sl, tp


def levels_from_result(res: dict, entry: float, p: "KanalParams") -> tuple[float, float]:
    """kanal_analyze sonucundan canlı giriş fiyatıyla SL/TP (ajan, emri gönderirken güncel fiyatı kullanır)."""
    bands = res.get("bands") or {}
    return kanal_levels(res["side"], entry, res["anchor"], res["center"], res["atr"], p.slBufferAtr,
                        bands.get("up"), bands.get("dn"), p.tpMode)


def kanal_confidence(side: Optional[str], s: Optional[dict], p: "KanalParams") -> int:
    """Güven skoru (panel/ajan/EA aynı formül): 40 + 12×band gücü + 10×sıra + 10×yön + RSI aşırılığı + CCI aşırılığı."""
    if not side or not s or not s["brk"]:
        return 0
    c = 40.0 + 12.0 * s["strength"] + (10.0 if s["seq"] else 0.0) + (10.0 if s["agree"] else 0.0)
    re, ce = s.get("rsiExt"), s.get("cciExt")
    if side == "SELL":
        if re is not None and not np.isnan(re):
            c += min(12.0, max(0.0, re - p.rsiOb))
        if ce is not None and not np.isnan(ce):
            c += 8.0 if ce >= 100 else 4.0 if ce >= 50 else 0.0
    else:
        if re is not None and not np.isnan(re):
            c += min(12.0, max(0.0, p.rsiOs - re))
        if ce is not None and not np.isnan(ce):
            c += 8.0 if ce <= -100 else 4.0 if ce <= -50 else 0.0
    return int(min(97, int(c + 0.5)))


def _num(x: float) -> Optional[float]:
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)


# --------------------------------------------------------------------------- #
def kanal_analyze(symbol: str, tf: str, df: pd.DataFrame, p: Optional[KanalParams] = None,
                  entry: Optional[float] = None) -> Optional[dict[str, Any]]:
    """df: sütunlar time(datetime), open, high, low, close — SON SATIR oluşmakta olan bardır."""
    p = p or KanalParams()
    n = len(df)
    if n < p.atrPeriod + p.halfLength + 30:
        return None
    o = df["open"].to_numpy(float)
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    t = n - 2
    pr = (h + l + 2.0 * c) / 4.0
    rsi = rsi_wilder(c, p.rsiPeriod)
    cci = cci_series(h, l, c, p.cciPeriod)
    ma = sma_series(cci, p.cciMaPeriod)

    span = max(p.breakLookback, p.crossLookback) + 4
    cy: dict[int, Optional[float]] = {}
    atr: dict[int, Optional[float]] = {}
    for i in range(max(1, t - span), t + 1):
        cy[i] = center_at(pr, i, p.halfLength, n - 1)  # oluşmakta olan bar (n-1) hariç -> bar içinde titremez
        atr[i] = atr_at(h, l, c, i, p.atrPeriod)
    mults = [p.atrMult1, p.atrMult2, p.atrMult3]
    mult = mults[p.band - 1]

    def ok(*v: float) -> bool:
        return all(not np.isnan(x) for x in v)

    def cross_up(a: np.ndarray, b: np.ndarray, i: int) -> bool:
        return i >= 1 and ok(a[i - 1], a[i], b[i - 1], b[i]) and a[i - 1] <= b[i - 1] and a[i] > b[i]

    def cross_dn(a: np.ndarray, b: np.ndarray, i: int) -> bool:
        return i >= 1 and ok(a[i - 1], a[i], b[i - 1], b[i]) and a[i - 1] >= b[i - 1] and a[i] < b[i]

    def lvl_up(i: int, L: float) -> bool:
        return i >= 1 and ok(rsi[i - 1], rsi[i]) and rsi[i - 1] < L and rsi[i] >= L

    def lvl_dn(i: int, L: float) -> bool:
        return i >= 1 and ok(rsi[i - 1], rsi[i]) and rsi[i - 1] > L and rsi[i] <= L

    def ts_at(i: int) -> int:
        v = df["time"].iloc[i]
        return int(v.timestamp()) if hasattr(v, "timestamp") else int(v)

    def band_lvl(b: int, sell: bool) -> Optional[float]:
        c0, a0 = cy.get(b), atr.get(b)
        if c0 is None or a0 is None:
            return None
        return c0 + mult * a0 if sell else c0 - mult * a0

    def eval_side(sell: bool, tt: int) -> dict:
        brk = False
        extreme = -np.inf if sell else np.inf
        pierced = [False, False, False]
        first_out: Optional[int] = None       # ilk kırılım barı
        last_close_out: Optional[int] = None  # kapanışı band DIŞINDA kalan son bar
        for b in range(max(1, tt - p.breakLookback + 1), tt + 1):
            c0, a0 = cy.get(b), atr.get(b)
            if c0 is None or a0 is None:
                continue
            px = (c[b] if p.breakByClose else (h[b] if sell else l[b]))
            for k in range(3):
                lvl = c0 + mults[k] * a0 if sell else c0 - mults[k] * a0
                if (px > lvl) if sell else (px < lvl):
                    pierced[k] = True
            lvl = c0 + mult * a0 if sell else c0 - mult * a0
            if (px > lvl) if sell else (px < lvl):
                brk = True
                if first_out is None:
                    first_out = b
            if (c[b] > lvl) if sell else (c[b] < lvl):
                last_close_out = b
            extreme = max(extreme, h[b]) if sell else min(extreme, l[b])
        ret = False
        ct, at = cy.get(tt), atr.get(tt)
        if brk and ct is not None and at is not None:
            lvl = ct + mult * at if sell else ct - mult * at
            ret = bool(c[tt] < lvl) if sell else bool(c[tt] > lvl)
        # Dönüş barı (İLK KURAL: band içinde mum kapanışı): band dışında kapanan son bardan sonra band içinde
        # kapanan ilk bar; hiç dışarıda kapanış yoksa (fitil kırılımı) kırılım barının kendisi.
        reentry: Optional[int] = None
        if brk:
            if last_close_out is None:
                reentry = first_out
            else:
                for b in range(last_close_out + 1, tt + 1):
                    lv = band_lvl(b, sell)
                    if lv is None:
                        continue
                    if (c[b] < lv) if sell else (c[b] > lv):
                        reentry = b
                        break
        f2 = max(1, tt - p.crossLookback + 1)
        f2s = max(f2, reentry) if reentry is not None else f2   # sıkı pencere: dönüş barından itibaren

        def rsi_ev(lo: int) -> bool:
            if sell:
                if p.sellRsiMode == "below":
                    return bool(ok(rsi[tt]) and rsi[tt] < p.rsiOb)
                return any(lvl_dn(b, p.rsiOb) for b in range(lo, tt + 1))
            if p.buyRsiMode == "above":
                return bool(ok(rsi[tt]) and rsi[tt] > p.rsiOs)
            return any(lvl_up(b, p.rsiOs) for b in range(lo, tt + 1))

        def cci_ev(lo: int) -> bool:
            return any((cross_dn if sell else cross_up)(cci, ma, b) for b in range(lo, tt + 1))

        rsi_loose, cci_loose = rsi_ev(f2), cci_ev(f2)
        rsi_strict, cci_strict = rsi_ev(f2s), cci_ev(f2s)
        seq = bool(ret and rsi_strict and cci_strict)           # önce dönüş, sonra RSI & CCI onayı
        rsi_ok = rsi_strict if p.strictOrder else rsi_loose
        cci_ok = cci_strict if p.strictOrder else cci_loose
        # Yön onayı: RSI ve CCI son N kapanmış barda ARKA ARKAYA aynı yönde
        nb = max(1, p.confirmBars)
        agree = True
        for k in range(nb):
            i = tt - k
            if i < 1 or not ok(rsi[i], rsi[i - 1], cci[i], cci[i - 1]):
                agree = False
                break
            if sell:
                if not (rsi[i] < rsi[i - 1] and cci[i] < cci[i - 1]):
                    agree = False
                    break
            elif not (rsi[i] > rsi[i - 1] and cci[i] > cci[i - 1]):
                agree = False
                break
        # RSI'ın dönüş yaptığı bar (pencerede RSI'ın ucu) ve RSI/CCI uçları (SL çapası + güven skoru)
        f3 = max(1, tt - p.breakLookback - p.crossLookback + 1)
        turn: Optional[int] = None
        rsi_ext = float("nan")
        for i in range(f3, tt + 1):
            if not ok(rsi[i]):
                continue
            if turn is None or ((rsi[i] > rsi_ext) if sell else (rsi[i] < rsi_ext)):
                turn, rsi_ext = i, float(rsi[i])
        cci_ext = float("nan")
        for i in range(f3, tt + 1):
            if not ok(cci[i]):
                continue
            if np.isnan(cci_ext) or ((cci[i] > cci_ext) if sell else (cci[i] < cci_ext)):
                cci_ext = float(cci[i])
        turn_px = (float(h[turn]) if sell else float(l[turn])) if turn is not None else None
        anchor = float(extreme)
        if p.slAnchor == "swingRsi" and turn_px is not None and np.isfinite(extreme):
            anchor = max(extreme, turn_px) if sell else min(extreme, turn_px)
        return {"brk": brk, "ret": ret, "rsi": rsi_ok, "cci": cci_ok, "seq": seq, "agree": agree,
                "extreme": float(extreme), "anchor": anchor, "turnPrice": turn_px, "strength": sum(pierced),
                "rsiExt": rsi_ext, "cciExt": cci_ext,
                "reentryTime": ts_at(reentry) if reentry is not None else None}

    def armed_of(s: dict) -> bool:
        return bool(s["brk"] and s["ret"] and s["rsi"] and s["cci"] and (s["agree"] or p.confirmBars <= 0))

    def stage_of(s: dict) -> int:
        if not s["brk"]:
            return 0
        if not s["ret"]:
            return 1
        return 5 if armed_of(s) else 2 + int(s["cci"]) + int(s["rsi"])

    sell, buy = eval_side(True, t), eval_side(False, t)
    sell_prev, buy_prev = eval_side(True, t - 1), eval_side(False, t - 1)

    ct, at = cy.get(t), atr.get(t)
    close = float(c[t])
    band_up = ct + mult * at if ct is not None and at is not None else None
    band_dn = ct - mult * at if ct is not None and at is not None else None
    pos = "above" if band_up is not None and close > band_up else "below" if band_dn is not None and close < band_dn else "inside"

    s_stage, b_stage = stage_of(sell), stage_of(buy)
    if s_stage == 0 and b_stage == 0:
        side = None
    elif s_stage > b_stage:
        side = "SELL"
    elif b_stage > s_stage:
        side = "BUY"
    else:
        side = "SELL" if (ct is not None and close >= ct) else "BUY"

    cur = sell if side == "SELL" else buy if side == "BUY" else None
    armed = bool(cur and armed_of(cur))
    if side == "SELL":
        fire = armed_of(sell) and not armed_of(sell_prev)
    elif side == "BUY":
        fire = armed_of(buy) and not armed_of(buy_prev)
    else:
        fire = False

    live = float(entry if entry is not None else c[n - 1])
    up_b = [ct + m * at for m in mults] if (ct is not None and at is not None) else None
    dn_b = [ct - m * at for m in mults] if (ct is not None and at is not None) else None
    sl = tp = extreme = anchor = None
    if side and cur and ct is not None and at is not None and np.isfinite(cur["extreme"]):
        extreme = cur["extreme"]
        anchor = cur["anchor"]
        sl, tp = kanal_levels(side, live, anchor, ct, at, p.slBufferAtr, up_b, dn_b, p.tpMode)
    confidence = kanal_confidence(side, cur, p)

    def r(v: float, d: int = 1) -> str:
        return "—" if not ok(v) else f"{v:.{d}f}"

    reason = ""
    if side and cur:
        bn = f"Band {p.band}"
        tail = f" · sıra {'✓' if cur['seq'] else '✗'} · yön {'✓' if cur['agree'] else '✗'} · güven %{confidence}"
        if side == "SELL":
            rr = f"< {p.rsiOb:g}" if p.sellRsiMode == "below" else (f"{p.rsiOb:g}'i aşağı kesti" if cur["rsi"] else f"{p.rsiOb:g} kesişimi yok")
            reason = f"Üst {bn} kırıldı{' → içeri döndü' if cur['ret'] else ''} · CCI {'MA' + chr(39) + 'yı aşağı kesti' if cur['cci'] else 'kesişim yok'} · RSI {r(rsi[t])} {rr}" + tail
        else:
            rr = f"> {p.rsiOs:g}" if p.buyRsiMode == "above" else (f"{p.rsiOs:g}'u yukarı kesti" if cur["rsi"] else f"{p.rsiOs:g} kesişimi yok")
            reason = f"Alt {bn} kırıldı{' → içeri döndü' if cur['ret'] else ''} · CCI {'MA' + chr(39) + 'yı yukarı kesti' if cur['cci'] else 'kesişim yok'} · RSI {r(rsi[t])} {rr}" + tail

    bar_ts = ts_at(t)
    return {
        "symbol": symbol, "tf": tf, "price": live,
        "rsi": _num(rsi[t]), "cci": _num(cci[t]), "cciMa": _num(ma[t]),
        "center": ct, "bandUp": band_up, "bandDn": band_dn, "atr": at, "pos": pos,
        "bands": ({"up": up_b, "dn": dn_b} if up_b else None),
        "side": side, "stage": (s_stage if side == "SELL" else b_stage if side == "BUY" else 0),
        "checks": ({"brk": cur["brk"], "ret": cur["ret"], "rsi": cur["rsi"], "cci": cur["cci"], "seq": cur["seq"], "agree": cur["agree"]} if cur
                   else {"brk": False, "ret": False, "rsi": False, "cci": False, "seq": False, "agree": False}),
        "strength": cur["strength"] if cur else 0, "armed": armed, "fire": bool(fire), "confidence": confidence,
        "entry": live, "sl": sl, "tp": tp, "extreme": extreme, "anchor": anchor,
        "turnPrice": cur["turnPrice"] if cur else None, "reentryTime": cur["reentryTime"] if cur else None,
        "reason": reason, "barTime": bar_ts,
    }
