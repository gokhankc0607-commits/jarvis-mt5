"""
kanal_strategy.py — KANAL3BAND geri dönüş + RSI + CCI(MA) stratejisi
====================================================================
Panel (src/lib/kanal.ts) ve MQL5 EA (KANAL_Strateji.mq5) ile AYNI mantık.

SATIŞ: fiyat ÜST bandı kırar ve kapanış tekrar band İÇİNE döner, RSI 70 altında,
       CCI mor çizgiyi (CCI MA) AŞAĞI keser.
ALIŞ : fiyat ALT bandı kırar ve içeri döner, RSI 30'u YUKARI keser, CCI mor çizgiyi YUKARI keser.
Sinyal, tüm koşulların ilk kez sağlandığı KAPANMIŞ barda bir kez üretilir.

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


def kanal_levels(side: str, entry: float, extreme: float, center: float, atr: float, buf: float) -> tuple[float, float]:
    if side == "SELL":
        sl = extreme + buf * atr
        if sl <= entry:
            sl = entry + 1.5 * atr
        tp = center
        if tp >= entry:
            tp = entry - 1.5 * (sl - entry)
        return sl, tp
    sl = extreme - buf * atr
    if sl >= entry:
        sl = entry - 1.5 * atr
    tp = center
    if tp <= entry:
        tp = entry + 1.5 * (entry - sl)
    return sl, tp


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

    def eval_side(sell: bool, tt: int) -> dict:
        brk = False
        extreme = -np.inf if sell else np.inf
        pierced = [False, False, False]
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
            extreme = max(extreme, h[b]) if sell else min(extreme, l[b])
        ret = False
        ct, at = cy.get(tt), atr.get(tt)
        if brk and ct is not None and at is not None:
            lvl = ct + mult * at if sell else ct - mult * at
            ret = bool(c[tt] < lvl) if sell else bool(c[tt] > lvl)
        f2 = max(1, tt - p.crossLookback + 1)
        if sell:
            if p.sellRsiMode == "below":
                rsi_ok = bool(ok(rsi[tt]) and rsi[tt] < p.rsiOb)
            else:
                rsi_ok = any(lvl_dn(b, p.rsiOb) for b in range(f2, tt + 1))
            cci_ok = any(cross_dn(cci, ma, b) for b in range(f2, tt + 1))
        else:
            if p.buyRsiMode == "above":
                rsi_ok = bool(ok(rsi[tt]) and rsi[tt] > p.rsiOs)
            else:
                rsi_ok = any(lvl_up(b, p.rsiOs) for b in range(f2, tt + 1))
            cci_ok = any(cross_up(cci, ma, b) for b in range(f2, tt + 1))
        return {"brk": brk, "ret": ret, "rsi": rsi_ok, "cci": cci_ok, "extreme": float(extreme), "strength": sum(pierced)}

    armed_of = lambda s: s["brk"] and s["ret"] and s["rsi"] and s["cci"]  # noqa: E731
    stage_of = lambda s: 0 if not s["brk"] else (1 if not s["ret"] else 2 + int(s["cci"]) + int(s["rsi"]))  # noqa: E731

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
    sl = tp = extreme = None
    if side and cur and ct is not None and at is not None and np.isfinite(cur["extreme"]):
        extreme = cur["extreme"]
        sl, tp = kanal_levels(side, live, extreme, ct, at, p.slBufferAtr)

    def r(v: float, d: int = 1) -> str:
        return "—" if not ok(v) else f"{v:.{d}f}"

    reason = ""
    if side and cur:
        bn = f"Band {p.band}"
        if side == "SELL":
            rr = f"< {p.rsiOb:g}" if p.sellRsiMode == "below" else (f"{p.rsiOb:g}'i aşağı kesti" if cur["rsi"] else f"{p.rsiOb:g} kesişimi yok")
            reason = f"Üst {bn} kırıldı{' → içeri döndü' if cur['ret'] else ''} · CCI {'MA' + chr(39) + 'yı aşağı kesti' if cur['cci'] else 'kesişim yok'} · RSI {r(rsi[t])} {rr}"
        else:
            rr = f"> {p.rsiOs:g}" if p.buyRsiMode == "above" else (f"{p.rsiOs:g}'u yukarı kesti" if cur["rsi"] else f"{p.rsiOs:g} kesişimi yok")
            reason = f"Alt {bn} kırıldı{' → içeri döndü' if cur['ret'] else ''} · CCI {'MA' + chr(39) + 'yı yukarı kesti' if cur['cci'] else 'kesişim yok'} · RSI {r(rsi[t])} {rr}"

    bar_time = df["time"].iloc[t]
    bar_ts = int(bar_time.timestamp()) if hasattr(bar_time, "timestamp") else int(bar_time)
    return {
        "symbol": symbol, "tf": tf, "price": live,
        "rsi": _num(rsi[t]), "cci": _num(cci[t]), "cciMa": _num(ma[t]),
        "center": ct, "bandUp": band_up, "bandDn": band_dn, "atr": at, "pos": pos,
        "side": side, "stage": (s_stage if side == "SELL" else b_stage if side == "BUY" else 0),
        "checks": ({"brk": cur["brk"], "ret": cur["ret"], "rsi": cur["rsi"], "cci": cur["cci"]} if cur
                   else {"brk": False, "ret": False, "rsi": False, "cci": False}),
        "strength": cur["strength"] if cur else 0, "armed": armed, "fire": bool(fire),
        "entry": live, "sl": sl, "tp": tp, "extreme": extreme, "reason": reason, "barTime": bar_ts,
    }
