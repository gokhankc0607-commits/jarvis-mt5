import { cciSeries, rsiSeries, type Candle } from "./indicators";

/**
 * KANAL stratejisi (KANAL3BAND + RSI + CCI/MA) — panel, Python ajanı ve MQL5 EA ile AYNI mantık.
 *
 * SATIŞ: son kapanan barlarda fiyat ÜST bandı kırmış ve kapanış tekrar band İÇİNE dönmüş,
 *        RSI 70 altında (veya aşağı kesmiş), CCI mor çizgiyi (CCI MA) AŞAĞI kesmiş.
 * ALIŞ : fiyat ALT bandı kırmış ve içeri dönmüş, RSI 30'u YUKARI kesmiş, CCI mor çizgiyi YUKARI kesmiş.
 * Sinyal, tüm koşullar ilk kez sağlandığı kapanmış barda bir kez üretilir (kenar tetikleme).
 *
 * NOT: "Centered" merkez çizgisi geçmiş + gelecek barları kullandığı için grafikte yeniden boyanır.
 * Strateji yalnızca sağ uçtaki (canlı) değerlerle, kapanmış barlar üzerinde çalışır.
 */
export type RsiBuyMode = "crossUp" | "above";
export type RsiSellMode = "below" | "crossDown";

export type KanalParams = {
  halfLength: number; atrPeriod: number; atrMult1: number; atrMult2: number; atrMult3: number;
  band: 1 | 2 | 3; breakLookback: number; crossLookback: number; breakByClose: boolean;
  rsiPeriod: number; rsiOb: number; rsiOs: number; sellRsiMode: RsiSellMode; buyRsiMode: RsiBuyMode;
  cciPeriod: number; cciMaPeriod: number; slBufferAtr: number;
};

export const KANAL_DEFAULTS: KanalParams = {
  halfLength: 60, atrPeriod: 100, atrMult1: 4.2, atrMult2: 3.5, atrMult3: 2.8, band: 3,
  breakLookback: 5, crossLookback: 3, breakByClose: false,
  rsiPeriod: 14, rsiOb: 70, rsiOs: 30, sellRsiMode: "below", buyRsiMode: "crossUp",
  cciPeriod: 34, cciMaPeriod: 21, slBufferAtr: 0.5,
};

const clamp = (v: unknown, lo: number, hi: number, d: number, int = false) => {
  const n = Number(v);
  if (v === undefined || v === null || v === "" || !Number.isFinite(n)) return d;
  const c = Math.min(hi, Math.max(lo, n));
  return int ? Math.round(c) : c;
};

export function sanitizeParams(p?: Record<string, unknown> | Partial<KanalParams> | null): KanalParams {
  const x = (p ?? {}) as Record<string, unknown>;
  const D = KANAL_DEFAULTS;
  const band = clamp(x.band, 1, 3, D.band, true) as 1 | 2 | 3;
  return {
    halfLength: clamp(x.halfLength, 5, 200, D.halfLength, true),
    atrPeriod: clamp(x.atrPeriod, 10, 300, D.atrPeriod, true),
    atrMult1: clamp(x.atrMult1, 0.5, 10, D.atrMult1),
    atrMult2: clamp(x.atrMult2, 0.5, 10, D.atrMult2),
    atrMult3: clamp(x.atrMult3, 0.5, 10, D.atrMult3),
    band,
    breakLookback: clamp(x.breakLookback, 1, 20, D.breakLookback, true),
    crossLookback: clamp(x.crossLookback, 1, 10, D.crossLookback, true),
    breakByClose: x.breakByClose === undefined ? D.breakByClose : Boolean(x.breakByClose),
    rsiPeriod: clamp(x.rsiPeriod, 2, 50, D.rsiPeriod, true),
    rsiOb: clamp(x.rsiOb, 50, 95, D.rsiOb),
    rsiOs: clamp(x.rsiOs, 5, 50, D.rsiOs),
    sellRsiMode: x.sellRsiMode === "crossDown" ? "crossDown" : "below",
    buyRsiMode: x.buyRsiMode === "above" ? "above" : "crossUp",
    cciPeriod: clamp(x.cciPeriod, 5, 100, D.cciPeriod, true),
    cciMaPeriod: clamp(x.cciMaPeriod, 2, 100, D.cciMaPeriod, true),
    slBufferAtr: clamp(x.slBufferAtr, 0, 5, D.slBufferAtr),
  };
}

/* ------------------------------------------------------------------ yapı taşları */
export const bandPrice = (c: Candle) => (c.high + c.low + 2 * c.close) / 4; // PB_WEIGHTED

/** Centered YSR: üçgen ağırlıklı merkezi ortalama; gelecek taraf son bara kadar. */
export function centerAt(pr: number[], i: number, H: number, nEff?: number): number | null {
  if (i - H < 0) return null;
  const n = nEff ?? pr.length; // nEff: sağ kenar (strateji oluşmakta olan barı hariç tutar)
  let sum = (H + 1) * pr[i];
  let sw = H + 1;
  let k = H;
  for (let j = 1; j <= H; j++) {
    sum += k * pr[i - j];
    sw += k;
    if (i + j <= n - 1) {
      sum += k * pr[i + j];
      sw += k;
    }
    k--;
  }
  return sum / sw;
}

/** KANAL3BAND'in özel ATR'si: TR'lerin basit ortalaması, 10 bar geriden. */
export function atrAt(c: Candle[], i: number, P: number): number | null {
  if (i < P + 10) return null;
  let sum = 0;
  for (let j = 0; j < P; j++) {
    const q = i - 10 - j;
    sum += Math.max(c[q].high, c[q - 1].close) - Math.min(c[q].low, c[q - 1].close);
  }
  return sum / P;
}

export function smaSeries(src: (number | null)[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  const s = src.findIndex((v) => v !== null);
  if (s < 0) return out;
  for (let i = s + period - 1; i < src.length; i++) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += src[i - k] as number;
    out[i] = sum / period;
  }
  return out;
}

/** Grafik çizimi için tam seriler (merkez + 3 üst + 3 alt bant). */
export function kanalSeries(candles: Candle[], pIn?: Partial<KanalParams>) {
  const p = sanitizeParams(pIn);
  const n = candles.length;
  const pr = candles.map(bandPrice);
  const center: (number | null)[] = new Array(n).fill(null);
  const up: (number | null)[][] = [0, 1, 2].map(() => new Array(n).fill(null));
  const dn: (number | null)[][] = [0, 1, 2].map(() => new Array(n).fill(null));
  const mult = [p.atrMult1, p.atrMult2, p.atrMult3];
  for (let i = 0; i < n; i++) {
    const cy = centerAt(pr, i, p.halfLength);
    center[i] = cy;
    const a = atrAt(candles, i, p.atrPeriod);
    if (cy === null || a === null) continue;
    for (let k = 0; k < 3; k++) {
      up[k][i] = cy + mult[k] * a;
      dn[k][i] = cy - mult[k] * a;
    }
  }
  const close = candles.map((c) => c.close);
  const rsi = rsiSeries(close, p.rsiPeriod);
  const cci = cciSeries(candles, p.cciPeriod);
  const cciMa = smaSeries(cci, p.cciMaPeriod);
  return { center, up, dn, rsi, cci, cciMa, params: p };
}

/* ------------------------------------------------------------------ strateji */
export type KanalItem = {
  symbol: string; tf: string; price: number;
  rsi: number | null; cci: number | null; cciMa: number | null;
  center: number | null; bandUp: number | null; bandDn: number | null; atr: number | null;
  pos: "above" | "below" | "inside";
  side: "BUY" | "SELL" | null;
  stage: number; // 0-4: 1 band kırıldı · 2 geri döndü · +1 CCI · +1 RSI
  checks: { brk: boolean; ret: boolean; rsi: boolean; cci: boolean };
  strength: number; // kırılan band sayısı (1-3)
  armed: boolean; fire: boolean;
  entry: number | null; sl: number | null; tp: number | null; extreme: number | null;
  reason: string; barTime: number;
};

type Side = { brk: boolean; ret: boolean; rsi: boolean; cci: boolean; extreme: number; strength: number };

export function kanalLevels(side: "BUY" | "SELL", entry: number, extreme: number, center: number, atr: number, buf: number) {
  if (side === "SELL") {
    let sl = extreme + buf * atr;
    if (sl <= entry) sl = entry + 1.5 * atr;
    let tp = center;
    if (tp >= entry) tp = entry - 1.5 * (sl - entry);
    return { sl, tp };
  }
  let sl = extreme - buf * atr;
  if (sl >= entry) sl = entry - 1.5 * atr;
  let tp = center;
  if (tp <= entry) tp = entry + 1.5 * (entry - sl);
  return { sl, tp };
}

export function kanalAnalyze(
  symbol: string, tf: string, candles: Candle[], pIn?: Partial<KanalParams>, entry?: number
): KanalItem | null {
  const p = sanitizeParams(pIn);
  const n = candles.length;
  if (n < p.atrPeriod + p.halfLength + 30) return null;
  const t = n - 2; // son KAPANMIŞ bar (n-1 oluşmakta olan bar)
  const pr = candles.map(bandPrice);
  const rsi = rsiSeries(candles.map((c) => c.close), p.rsiPeriod);
  const cci = cciSeries(candles, p.cciPeriod);
  const ma = smaSeries(cci, p.cciMaPeriod);

  const span = Math.max(p.breakLookback, p.crossLookback) + 4;
  const cy: (number | null)[] = new Array(n).fill(null);
  const atr: (number | null)[] = new Array(n).fill(null);
  for (let i = Math.max(1, t - span); i <= t; i++) {
    cy[i] = centerAt(pr, i, p.halfLength, n - 1); // oluşmakta olan bar (n-1) hariç -> bar içinde titremez
    atr[i] = atrAt(candles, i, p.atrPeriod);
  }
  const mults = [p.atrMult1, p.atrMult2, p.atrMult3];
  const mult = mults[p.band - 1];

  const crossUp = (a: (number | null)[], b: (number | null)[], i: number) => {
    if (i < 1) return false;
    const a0 = a[i - 1], a1 = a[i], b0 = b[i - 1], b1 = b[i];
    return a0 !== null && a1 !== null && b0 !== null && b1 !== null && a0 <= b0 && a1 > b1;
  };
  const crossDown = (a: (number | null)[], b: (number | null)[], i: number) => {
    if (i < 1) return false;
    const a0 = a[i - 1], a1 = a[i], b0 = b[i - 1], b1 = b[i];
    return a0 !== null && a1 !== null && b0 !== null && b1 !== null && a0 >= b0 && a1 < b1;
  };
  const lvlUp = (i: number, L: number) => i >= 1 && rsi[i - 1] !== null && rsi[i] !== null && (rsi[i - 1] as number) < L && (rsi[i] as number) >= L;
  const lvlDown = (i: number, L: number) => i >= 1 && rsi[i - 1] !== null && rsi[i] !== null && (rsi[i - 1] as number) > L && (rsi[i] as number) <= L;

  const evalSide = (sell: boolean, tt: number): Side => {
    let brk = false;
    let extreme = sell ? -Infinity : Infinity;
    let strength = 0;
    const from = Math.max(1, tt - p.breakLookback + 1);
    const pierced = [false, false, false];
    for (let b = from; b <= tt; b++) {
      const c0 = cy[b], a0 = atr[b];
      if (c0 === null || a0 === null) continue;
      const px = sell ? (p.breakByClose ? candles[b].close : candles[b].high) : (p.breakByClose ? candles[b].close : candles[b].low);
      for (let k = 0; k < 3; k++) {
        const lvl = sell ? c0 + mults[k] * a0 : c0 - mults[k] * a0;
        if (sell ? px > lvl : px < lvl) pierced[k] = true;
      }
      const lvl = sell ? c0 + mult * a0 : c0 - mult * a0;
      if (sell ? px > lvl : px < lvl) brk = true;
      if (sell) extreme = Math.max(extreme, candles[b].high);
      else extreme = Math.min(extreme, candles[b].low);
    }
    strength = pierced.filter(Boolean).length;
    let ret = false;
    const ct = cy[tt], at = atr[tt];
    if (brk && ct !== null && at !== null) {
      const lvl = sell ? ct + mult * at : ct - mult * at;
      ret = sell ? candles[tt].close < lvl : candles[tt].close > lvl;
    }
    let rsiOk = false;
    let cciOk = false;
    const f2 = Math.max(1, tt - p.crossLookback + 1);
    if (sell) {
      if (p.sellRsiMode === "below") rsiOk = rsi[tt] !== null && (rsi[tt] as number) < p.rsiOb;
      else for (let b = f2; b <= tt; b++) if (lvlDown(b, p.rsiOb)) rsiOk = true;
      for (let b = f2; b <= tt; b++) if (crossDown(cci, ma, b)) cciOk = true;
    } else {
      if (p.buyRsiMode === "above") rsiOk = rsi[tt] !== null && (rsi[tt] as number) > p.rsiOs;
      else for (let b = f2; b <= tt; b++) if (lvlUp(b, p.rsiOs)) rsiOk = true;
      for (let b = f2; b <= tt; b++) if (crossUp(cci, ma, b)) cciOk = true;
    }
    return { brk, ret, rsi: rsiOk, cci: cciOk, extreme, strength };
  };

  const armedOf = (s: Side) => s.brk && s.ret && s.rsi && s.cci;
  const stageOf = (s: Side) => (!s.brk ? 0 : !s.ret ? 1 : 2 + (s.cci ? 1 : 0) + (s.rsi ? 1 : 0));

  const sell = evalSide(true, t);
  const buy = evalSide(false, t);
  const sellPrev = evalSide(true, t - 1);
  const buyPrev = evalSide(false, t - 1);

  const ct = cy[t], at = atr[t];
  const close = candles[t].close;
  const bandUp = ct !== null && at !== null ? ct + mult * at : null;
  const bandDn = ct !== null && at !== null ? ct - mult * at : null;
  const pos: KanalItem["pos"] = bandUp !== null && close > bandUp ? "above" : bandDn !== null && close < bandDn ? "below" : "inside";

  const sS = stageOf(sell), bS = stageOf(buy);
  let side: "BUY" | "SELL" | null = null;
  if (sS === 0 && bS === 0) side = null;
  else if (sS > bS) side = "SELL";
  else if (bS > sS) side = "BUY";
  else side = ct !== null && close >= ct ? "SELL" : "BUY";

  const cur = side === "SELL" ? sell : side === "BUY" ? buy : null;
  const armed = cur ? armedOf(cur) : false;
  const fire = side === "SELL" ? armedOf(sell) && !armedOf(sellPrev) : side === "BUY" ? armedOf(buy) && !armedOf(buyPrev) : false;

  const livePrice = entry ?? candles[n - 1].close;
  let sl: number | null = null, tp: number | null = null, extreme: number | null = null;
  if (side && cur && ct !== null && at !== null && Number.isFinite(cur.extreme)) {
    extreme = cur.extreme;
    const lv = kanalLevels(side, livePrice, cur.extreme, ct, at, p.slBufferAtr);
    sl = lv.sl; tp = lv.tp;
  }

  const r = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
  let reason = "";
  if (side && cur) {
    const bn = `Band ${p.band}`;
    if (side === "SELL")
      reason = `Üst ${bn} kırıldı${cur.ret ? " → içeri döndü" : ""} · CCI ${cur.cci ? "MA'yı aşağı kesti" : "kesişim yok"} · RSI ${r(rsi[t])} ${p.sellRsiMode === "below" ? `< ${p.rsiOb}` : cur.rsi ? `${p.rsiOb}'i aşağı kesti` : `${p.rsiOb} kesişimi yok`}`;
    else
      reason = `Alt ${bn} kırıldı${cur.ret ? " → içeri döndü" : ""} · CCI ${cur.cci ? "MA'yı yukarı kesti" : "kesişim yok"} · RSI ${r(rsi[t])} ${p.buyRsiMode === "above" ? `> ${p.rsiOs}` : cur.rsi ? `${p.rsiOs}'u yukarı kesti` : `${p.rsiOs} kesişimi yok`}`;
  }

  return {
    symbol, tf, price: livePrice,
    rsi: rsi[t], cci: cci[t], cciMa: ma[t], center: ct, bandUp, bandDn, atr: at, pos,
    side, stage: side === "SELL" ? sS : side === "BUY" ? bS : 0,
    checks: cur ? { brk: cur.brk, ret: cur.ret, rsi: cur.rsi, cci: cur.cci } : { brk: false, ret: false, rsi: false, cci: false },
    strength: cur ? cur.strength : 0, armed, fire,
    entry: livePrice, sl, tp, extreme, reason, barTime: candles[t].time,
  };
}
