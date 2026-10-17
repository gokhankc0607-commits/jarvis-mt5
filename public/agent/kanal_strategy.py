"""
kanal_strategy.py — KANAL stratejisi v2 (KANAL3BAND + RSI + CCI/MA)
==================================================================
Panel (src/lib/kanal.ts) ve MQL5 EA (KANAL_Strateji.mq5) ile AYNI mantık.

ALIŞ : 1) Mum TÜM alt bantların (en dış bant = merkez − 4.2×ATR) DIŞINDA KAPANIR (fitil yetmez)
       2) RSI 30'un altında kapanmıştır
       3) Fiyat GERİ DÖNER: son kapanan mum tekrar en dış bandın İÇİNDE kapanır (bant dışı kapanış daha önce)
       4) RSI 30'u YUKARI keser (bant dışı kapanış bu kesişimden önce / aynı mumda)
       5) CCI mor çizgiyi (CCI MA) YUKARI keser
SATIŞ: tersi — TÜM üst bantların dışında kapanış, RSI 70 üstü, bant içine dönüş, RSI 70'i AŞAĞI keser, CCI mor çizgiyi AŞAĞI keser.

SL : ALIŞ → RSI 30'u yukarı kesmeden önceki EN DÜŞÜK fiyat · SATIŞ → RSI 70'i aşağı kesmeden önceki EN YÜKSEK fiyat
TP : bandın MERKEZ çizgisi (ilk hedef)
Zaman dilimleri: M3, M5, M15, H1 (panelden seçilir). Sinyal kapanmış mumda, ilk kez tamamlandığında bir kez oluşur.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, fields
from typing import Any, Optional

import numpy as np
import pandas as pd

KANAL_TFS = ("M3", "M5", "M15", "H1")


@dataclass
class KanalParams:
    halfLength: int = 60
    atrPeriod: int = 100
    atrMult1: float = 4.2
    atrMult2: float = 3.5
    atrMult3: float = 2.8
    setupLookback: int = 10      # bant dışı kapanış en fazla kaç mum önce
    crossMaxAge: int = 10        # RSI + CCI kesişimi en fazla kaç mum önce (ve şu an hâlâ onaylı)
    minBreakAtr: float = 0.0     # "kesin kapanış" payı (ATR×)
    rsiPeriod: int = 14
    rsiOb: float = 70.0
    rsiOs: float = 30.0
    cciPeriod: int = 34
    cciMaPeriod: int = 21
    slPadAtr: float = 0.0        # SL payı (ATR×)
    tpMode: str = "center"       # center = merkez çizgi · band = en yakın karşı bant

    @classmethod
    def from_dict(cls, d: Optional[dict]) -> "KanalParams":
        d = d or {}
        out = cls()
        for f in fields(cls):
            if f.name in d and d[f.name] is not None and d[f.name] != "":
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
        cl = lambda v, lo, hi: min(hi, max(lo, v))  # noqa: E731
        out.halfLength = cl(out.halfLength, 5, 200)
        out.atrPeriod = cl(out.atrPeriod, 10, 300)
        out.atrMult1, out.atrMult2, out.atrMult3 = (cl(out.atrMult1, 0.5, 10), cl(out.atrMult2, 0.5, 10), cl(out.atrMult3, 0.5, 10))
        out.setupLookback = cl(out.setupLookback, 2, 30)
        out.crossMaxAge = min(out.setupLookback, cl(out.crossMaxAge, 1, 30))
        out.minBreakAtr = cl(out.minBreakAtr, 0.0, 2.0)
        out.rsiPeriod = cl(out.rsiPeriod, 2, 50)
        out.rsiOb = cl(out.rsiOb, 50.0, 95.0)
        out.rsiOs = cl(out.rsiOs, 5.0, 50.0)
        out.cciPeriod = cl(out.cciPeriod, 5, 100)
        out.cciMaPeriod = cl(out.cciMaPeriod, 2, 100)
        out.slPadAtr = cl(out.slPadAtr, 0.0, 3.0)
        out.tpMode = "band" if out.tpMode == "band" else "center"
        return out


# --------------------------------------------------------------------------- #
def center_at(pr: np.ndarray, i: int, H: int, n_eff: Optional[int] = None) -> Optional[float]:
    if i - H < 0:
        return None
    n = len(pr) if n_eff is None else n_eff
    w = np.arange(H, 0, -1, dtype=float)
    s = (H + 1) * pr[i] + float(np.dot(w, pr[i - H:i][::-1]))
    sw = (H + 1) + float(w.sum())
    m = min(H, n - 1 - i)
    if m > 0:
        s += float(np.dot(w[:m], pr[i + 1:i + 1 + m]))
        sw += float(w[:m].sum())
    return s / sw


def atr_at(h: np.ndarray, l: np.ndarray, c: np.ndarray, i: int, P: int) -> Optional[float]:
    if i < P + 10:
        return None
    q = np.arange(i - 10 - P + 1, i - 10 + 1)
    return float((np.maximum(h[q], c[q - 1]) - np.minimum(l[q], c[q - 1])).sum() / P)


def rsi_wilder(close: np.ndarray, period: int) -> np.ndarray:
    n = len(close)
    out = np.full(n, np.nan)
    if n <= period:
        return out
    d = np.diff(close)
    up = np.where(d > 0, d, 0.0)
    dn = np.where(d < 0, -d, 0.0)
    au, ad = up[:period].mean(), dn[:period].mean()

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
    win = np.lib.stride_tricks.sliding_window_view(tp, period)
    sma = win.mean(axis=1)
    md = np.abs(win - sma[:, None]).mean(axis=1)
    with np.errstate(divide="ignore", invalid="ignore"):
        out[period - 1:] = np.where(md == 0, 0.0, (tp[period - 1:] - sma) / (0.015 * md))
    return out


def sma_series(src: np.ndarray, period: int) -> np.ndarray:
    n = len(src)
    out = np.full(n, np.nan)
    valid = np.where(~np.isnan(src))[0]
    if len(valid) == 0:
        return out
    for i in range(int(valid[0]) + period - 1, n):
        out[i] = src[i - period + 1:i + 1].mean()
    return out


def kanal_levels(side: str, entry: float, extreme: float, center: float, atr: float,
                 p: Optional[KanalParams] = None) -> tuple[float, float]:
    """SL = RSI kesişiminden önceki dip/tepe ± pay · TP = merkez çizgi (ya da en yakın karşı bant)."""
    p = p or KanalParams()
    pad = p.slPadAtr * atr
    mults = [p.atrMult1, p.atrMult2, p.atrMult3]
    if side == "BUY":
        sl = extreme - pad
        if sl >= entry:
            sl = entry - 1.5 * atr
        if p.tpMode == "band":
            ups = [center + m * atr for m in mults if center + m * atr > entry]
            tp = min(ups) if ups else entry + 2 * (entry - sl)
        else:
            tp = center
            if tp <= entry:
                tp = entry + 1.5 * (entry - sl)
        return sl, tp
    sl = extreme + pad
    if sl <= entry:
        sl = entry + 1.5 * atr
    if p.tpMode == "band":
        dns = [center - m * atr for m in mults if center - m * atr < entry]
        tp = max(dns) if dns else entry - 2 * (sl - entry)
    else:
        tp = center
        if tp >= entry:
            tp = entry - 1.5 * (sl - entry)
    return sl, tp


def kanal_confidence(side: str, depth: float, rsi_peak: Optional[float], cci: Optional[float], cci_ma: Optional[float],
                     entry: float, sl: Optional[float], tp: Optional[float], p: Optional[KanalParams] = None) -> dict:
    """60 + derinlik min(10, ATR×20) + RSI aşırılığı min(15, |seviye−tepe|) + CCI–MA min(5, fark/20) + R:R (≥2→10, ≥1.5→7, ≥1→4)"""
    p = p or KanalParams()
    depth_p = max(0.0, min(10.0, depth * 20))
    rsi_p = 0.0 if rsi_peak is None else max(0.0, min(15.0, (p.rsiOs - rsi_peak) if side == "BUY" else (rsi_peak - p.rsiOb)))
    cci_p = 0.0 if (cci is None or cci_ma is None) else max(0.0, min(5.0, abs(cci - cci_ma) / 20))
    rr = abs(tp - entry) / abs(entry - sl) if (sl is not None and tp is not None and abs(entry - sl) > 0) else 0.0
    rr_p = 10 if rr >= 2 else 7 if rr >= 1.5 else 4 if rr >= 1 else 0
    score = min(99, math.floor(60 + depth_p + rsi_p + cci_p + rr_p + 0.5))
    r1 = lambda v: round(v * 10) / 10  # noqa: E731
    return {"score": int(score), "rr": rr,
            "parts": {"base": 60, "depth": r1(depth_p), "rsi": r1(rsi_p), "cci": r1(cci_p), "rr": rr_p}}


def _num(x: Any) -> Optional[float]:
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)


# --------------------------------------------------------------------------- #
def kanal_analyze(symbol: str, tf: str, df: pd.DataFrame, p: Optional[KanalParams] = None,
                  entry: Optional[float] = None) -> Optional[dict[str, Any]]:
    """df: time, open, high, low, close — SON SATIR oluşmakta olan mumdur."""
    p = p or KanalParams()
    n = len(df)
    if n < p.atrPeriod + p.halfLength + 30:
        return None
    h = df["high"].to_numpy(float)
    l = df["low"].to_numpy(float)
    c = df["close"].to_numpy(float)
    t = n - 2
    pr = (h + l + 2.0 * c) / 4.0
    rsi = rsi_wilder(c, p.rsiPeriod)
    cci = cci_series(h, l, c, p.cciPeriod)
    ma = sma_series(cci, p.cciMaPeriod)
    W, C = p.setupLookback, p.crossMaxAge
    M = max(p.atrMult1, p.atrMult2, p.atrMult3)

    cy: dict[int, Optional[float]] = {}
    atr: dict[int, Optional[float]] = {}
    for i in range(max(1, t - W - 4), t + 1):
        cy[i] = center_at(pr, i, p.halfLength, n - 1)
        atr[i] = atr_at(h, l, c, i, p.atrPeriod)

    def ok(*v: float) -> bool:
        return all(not np.isnan(x) for x in v)

    def beyond(sell: bool, v: float) -> bool:
        return (not np.isnan(v)) and (v > p.rsiOb if sell else v < p.rsiOs)

    def eval_side(sell: bool, tt: int) -> dict:
        frm = max(1, tt - W + 1)
        brk_bars: list[int] = []
        depth = 0.0
        for b in range(frm, tt + 1):
            c0, a0 = cy.get(b), atr.get(b)
            if c0 is None or a0 is None or a0 <= 0:
                continue
            outer = c0 + M * a0 if sell else c0 - M * a0
            d = (c[b] - outer) if sell else (outer - c[b])
            if d > p.minBreakAtr * a0:
                brk_bars.append(b)
                depth = max(depth, d / a0)
        ext = False
        peak: Optional[float] = None
        for b in range(max(1, frm - 1), tt + 1):
            r = rsi[b]
            if np.isnan(r):
                continue
            if beyond(sell, r):
                ext = True
            peak = float(r) if peak is None else (max(peak, float(r)) if sell else min(peak, float(r)))
        x = -1
        f2 = max(1, frm, tt - C + 1)
        for b in range(f2, tt + 1):
            r0, r1 = rsi[b - 1], rsi[b]
            if not ok(r0, r1):
                continue
            if (r0 > p.rsiOb and r1 <= p.rsiOb) if sell else (r0 < p.rsiOs and r1 >= p.rsiOs):
                x = b
        ctt, att = cy.get(tt), atr.get(tt)
        # kanalın içi = iki dış bandın arası
        inside = ctt is not None and att is not None and bool(ctt - M * att < c[tt] < ctt + M * att)
        ret = bool(inside and any(b < tt for b in brk_bars))
        brk_before = [b for b in brk_bars if b <= x]
        r_now = rsi[tt]
        rsi_ok = bool(x >= 0 and len(brk_before) > 0 and (not np.isnan(r_now)) and (r_now <= p.rsiOb if sell else r_now >= p.rsiOs))
        cci_x = False
        for b in range(f2, tt + 1):
            if ok(cci[b - 1], cci[b], ma[b - 1], ma[b]):
                if sell and cci[b - 1] >= ma[b - 1] and cci[b] < ma[b]:
                    cci_x = True
                if (not sell) and cci[b - 1] <= ma[b - 1] and cci[b] > ma[b]:
                    cci_x = True
        cci_ok = bool(cci_x and ok(cci[tt], ma[tt]) and (cci[tt] < ma[tt] if sell else cci[tt] > ma[tt]))
        if x >= 0:
            s0 = x - 1
            while s0 - 1 >= 1 and x - s0 < 200 and beyond(sell, rsi[s0 - 1]):
                s0 -= 1
            start = min(s0, brk_before[0]) if brk_before else s0
            end = x
        else:
            start, end = frm, tt
        extreme = float(h[start:end + 1].max()) if sell else float(l[start:end + 1].min())
        return {"brk": bool(brk_bars), "ext": ext, "ret": ret, "rsi": rsi_ok, "cci": cci_ok, "extreme": extreme, "depth": depth, "peak": peak}

    armed_of = lambda s: s["brk"] and s["ext"] and s["ret"] and s["rsi"] and s["cci"]  # noqa: E731
    stage_of = lambda s: 0 if not s["brk"] else (1 if not s["ext"] else 2 + int(s["ret"]) + int(s["rsi"]) + int(s["cci"]))  # noqa: E731

    sell, buy = eval_side(True, t), eval_side(False, t)
    sell_prev, buy_prev = eval_side(True, t - 1), eval_side(False, t - 1)

    ct, at = cy.get(t), atr.get(t)
    close = float(c[t])
    band_up = ct + M * at if ct is not None and at is not None else None
    band_dn = ct - M * at if ct is not None and at is not None else None
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
    fire = (armed_of(sell) and not armed_of(sell_prev)) if side == "SELL" else \
           (armed_of(buy) and not armed_of(buy_prev)) if side == "BUY" else False

    live = float(entry if entry is not None else c[n - 1])
    sl = tp = extreme = rr_v = None
    conf, parts = 0, {"base": 0, "depth": 0, "rsi": 0, "cci": 0, "rr": 0}
    if side and cur and ct is not None and at is not None and np.isfinite(cur["extreme"]):
        extreme = cur["extreme"]
        sl, tp = kanal_levels(side, live, extreme, ct, at, p)
        cf = kanal_confidence(side, cur["depth"], cur["peak"], _num(cci[t]), _num(ma[t]), live, sl, tp, p)
        conf, parts, rr_v = cf["score"], cf["parts"], cf["rr"]

    reason = ""
    if side and cur:
        pk = "—" if cur["peak"] is None else f"{cur['peak']:.1f}"
        dep = f" ({cur['depth']:.2f} ATR)" if cur["brk"] else " yok"
        if side == "BUY":
            reason = (f"Tüm alt bantların dışında kapanış{dep} · {'bant içine döndü' if cur['ret'] else 'dönüş bekleniyor'} · RSI dip {pk}{(' <' + f'{p.rsiOs:g}') if cur['ext'] else ''} · "
                      f"RSI {p.rsiOs:g}↑ {'kesti' if cur['rsi'] else 'bekleniyor'} · CCI mor çizgi↑ {'kesti' if cur['cci'] else 'bekleniyor'}")
        else:
            reason = (f"Tüm üst bantların dışında kapanış{dep} · {'bant içine döndü' if cur['ret'] else 'dönüş bekleniyor'} · RSI tepe {pk}{(' >' + f'{p.rsiOb:g}') if cur['ext'] else ''} · "
                      f"RSI {p.rsiOb:g}↓ {'kesti' if cur['rsi'] else 'bekleniyor'} · CCI mor çizgi↓ {'kesti' if cur['cci'] else 'bekleniyor'}")

    bar_time = df["time"].iloc[t]
    bar_ts = int(bar_time.timestamp()) if hasattr(bar_time, "timestamp") else int(bar_time)
    return {
        "symbol": symbol, "tf": tf, "price": live,
        "rsi": _num(rsi[t]), "cci": _num(cci[t]), "cciMa": _num(ma[t]),
        "center": ct, "bandUp": band_up, "bandDn": band_dn, "atr": at, "pos": pos,
        "side": side, "stage": (s_stage if side == "SELL" else b_stage if side == "BUY" else 0),
        "checks": ({"brk": cur["brk"], "ext": cur["ext"], "ret": cur["ret"], "rsi": cur["rsi"], "cci": cur["cci"]} if cur
                   else {"brk": False, "ext": False, "ret": False, "rsi": False, "cci": False}),
        "depth": cur["depth"] if cur else 0.0, "rsiPeak": cur["peak"] if cur else None,
        "armed": armed, "fire": bool(fire),
        "entry": live, "sl": sl, "tp": tp, "extreme": extreme, "rr": rr_v,
        "confidence": conf, "confParts": parts, "reason": reason, "barTime": bar_ts,
    }
