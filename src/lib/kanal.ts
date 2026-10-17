import { cciSeries, rsiSeries, type Candle } from "./indicators";

/**
 * KANAL stratejisi v2 — panel, Python ajanı (kanal_strategy.py) ve MQL5 EA (KANAL_Strateji.mq5) ile AYNI mantık.
 *
 * ALIŞ : 1) Mum, TÜM alt bantların (en dış bant = merkez − 4.2×ATR) DIŞINDA KAPANIR (fitil yetmez)
 *        2) RSI 30'un altında kapanmıştır (aşırı satım)
 *        3) Fiyat GERİ DÖNER: son kapanan mum tekrar en dış bandın İÇİNDE kapanır (bant dışı kapanış daha önce olmalı)
 *        4) RSI 30'u YUKARI keser  (bant dışı kapanış bu kesişimden önce / aynı mumda olmalı)
 *        5) CCI, mor çizgiyi (CCI MA) YUKARI keser
 * SATIŞ: aynısının tersi — TÜM üst bantların dışında kapanış, RSI 70 üstü, bant içine dönüş, RSI 70'i AŞAĞI keser, CCI mor çizgiyi AŞAĞI keser.
 *
 * SL  : ALIŞ → RSI 30'u yukarı kesmeden önceki EN DÜŞÜK fiyat · SATIŞ → RSI 70'i aşağı kesmeden önceki EN YÜKSEK fiyat
 *       (RSI'ın aşırı bölgede kaldığı süre + bant dışı kapanış mumu dahil, kesişim mumuna kadar)
 * TP  : bandın MERKEZ çizgisi (ilk hedef)
 * Kesişimler bant dışı kapanıştan sonra (en fazla 10 mum) olur ve şu an hâlâ onaylı olmalıdır; sinyal son şart da
 * (genelde bant içine dönüş) tamamlandığı kapanmış mumda bir kez oluşur. Merkez çizgi oluşmakta olan mumu içermez.
 */
export const KANAL_TFS = ["M3", "M5", "M15", "H1"] as const;
export type TpMode = "center" | "band";

export type KanalParams = {
  halfLength: number; atrPeriod: number; atrMult1: number; atrMult2: number; atrMult3: number;
  setupLookback: number; // bant dışı kapanış en fazla kaç mum önce olabilir
  crossMaxAge: number; // RSI ve CCI kesişimi en fazla kaç mum önce olabilir (ayrıca şu an hâlâ onaylı olmalı)
  minBreakAtr: number; // "kesin kapanış": en dış bandın en az bu kadar (ATR×) dışında kapanış (0 = dışında olması yeter)
  rsiPeriod: number; rsiOb: number; rsiOs: number;
  cciPeriod: number; cciMaPeriod: number;
  slPadAtr: number; // SL payı (ATR×), 0 = tam dip/tepe
  tpMode: TpMode; // center = merkez çizgi (varsayılan) · band = en yakın karşı bant
};

export const KANAL_DEFAULTS: KanalParams = {
  halfLength: 60, atrPeriod: 100, atrMult1: 4.2, atrMult2: 3.5, atrMult3: 2.8,
  setupLookback: 10, crossMaxAge: 10, minBreakAtr: 0,
  rsiPeriod: 14, rsiOb: 70, rsiOs: 30, cciPeriod: 34, cciMaPeriod: 21,
  slPadAtr: 0, tpMode: "center",
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
  const setupLookback = clamp(x.setupLookback, 2, 30, D.setupLookback, true);
  return {
    halfLength: clamp(x.halfLength, 5, 200, D.halfLength, true),
    atrPeriod: clamp(x.atrPeriod, 10, 300, D.atrPeriod, true),
    atrMult1: clamp(x.atrMult1, 0.5, 10, D.atrMult1),
    atrMult2: clamp(x.atrMult2, 0.5, 10, D.atrMult2),
    atrMult3: clamp(x.atrMult3, 0.5, 10, D.atrMult3),
    setupLookback,
    crossMaxAge: Math.min(setupLookback, clamp(x.crossMaxAge, 1, 30, D.crossMaxAge, true)),
    minBreakAtr: clamp(x.minBreakAtr, 0, 2, D.minBreakAtr),
    rsiPeriod: clamp(x.rsiPeriod, 2, 50, D.rsiPeriod, true),
    rsiOb: clamp(x.rsiOb, 50, 95, D.rsiOb),
    rsiOs: clamp(x.rsiOs, 5, 50, D.rsiOs),
    cciPeriod: clamp(x.cciPeriod, 5, 100, D.cciPeriod, true),
    cciMaPeriod: clamp(x.cciMaPeriod, 2, 100, D.cciMaPeriod, true),
    slPadAtr: clamp(x.slPadAtr, 0, 3, D.slPadAtr),
    tpMode: x.tpMode === "band" ? "band" : "center",
  };
}

/* ------------------------------------------------------------------ yapı taşları (KANAL3BAND / KANAL-CCI / KANAL-RSI ile aynı) */
export const bandPrice = (c: Candle) => (c.high + c.low + 2 * c.close) / 4; // PB_WEIGHTED

/** Centered YSR: üçgen ağırlıklı merkezi ortalama. nEff: sağ kenar (strateji oluşmakta olan mumu hariç tutar). */
export function centerAt(pr: number[], i: number, H: number, nEff?: number): number | null {
  if (i - H < 0) return null;
  const n = nEff ?? pr.length;
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

/** KANAL3BAND'in ATR'si: TR'lerin basit ortalaması, 10 mum geriden. */
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

/* ------------------------------------------------------------------ seviyeler + güven */
/** SL = RSI kesişiminden önceki dip/tepe ± pay · TP = merkez çizgi (ya da en yakın karşı bant). */
export function kanalLevels(side: "BUY" | "SELL", entry: number, extreme: number, center: number, atr: number, pIn?: Partial<KanalParams>) {
  const p = sanitizeParams(pIn);
  const pad = p.slPadAtr * atr;
  const mults = [p.atrMult1, p.atrMult2, p.atrMult3];
  if (side === "BUY") {
    let sl = extreme - pad;
    if (sl >= entry) sl = entry - 1.5 * atr;
    let tp: number;
    if (p.tpMode === "band") {
      const ups = mults.map((m) => center + m * atr).filter((v) => v > entry);
      tp = ups.length ? Math.min(...ups) : entry + 2 * (entry - sl);
    } else {
      tp = center;
      if (tp <= entry) tp = entry + 1.5 * (entry - sl);
    }
    return { sl, tp };
  }
  let sl = extreme + pad;
  if (sl <= entry) sl = entry + 1.5 * atr;
  let tp: number;
  if (p.tpMode === "band") {
    const dns = mults.map((m) => center - m * atr).filter((v) => v < entry);
    tp = dns.length ? Math.max(...dns) : entry - 2 * (sl - entry);
  } else {
    tp = center;
    if (tp >= entry) tp = entry - 1.5 * (sl - entry);
  }
  return { sl, tp };
}

export type ConfParts = { base: number; depth: number; rsi: number; cci: number; rr: number };

/**
 * Güven (0-99), şeffaf:
 *  60 (5/5 koşul yapısı) + bant dışı derinlik min(10, ATR×20) + RSI aşırılığı min(15, |seviye − RSI tepe/dip|)
 *  + CCI–mor çizgi farkı min(5, |fark|/20) + risk/ödül (≥2 → 10, ≥1.5 → 7, ≥1 → 4)
 */
export function kanalConfidence(side: "BUY" | "SELL", depth: number, rsiPeak: number | null, cci: number | null, cciMa: number | null, entry: number, sl: number | null, tp: number | null, pIn?: Partial<KanalParams>) {
  const p = sanitizeParams(pIn);
  const depthP = Math.max(0, Math.min(10, depth * 20));
  const rsiP = rsiPeak === null ? 0 : Math.max(0, Math.min(15, side === "BUY" ? p.rsiOs - rsiPeak : rsiPeak - p.rsiOb));
  const cciP = cci === null || cciMa === null ? 0 : Math.max(0, Math.min(5, Math.abs(cci - cciMa) / 20));
  const rr = sl !== null && tp !== null && Math.abs(entry - sl) > 0 ? Math.abs(tp - entry) / Math.abs(entry - sl) : 0;
  const rrP = rr >= 2 ? 10 : rr >= 1.5 ? 7 : rr >= 1 ? 4 : 0;
  const score = Math.min(99, Math.floor(60 + depthP + rsiP + cciP + rrP + 0.5));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { score, rr, parts: { base: 60, depth: r1(depthP), rsi: r1(rsiP), cci: r1(cciP), rr: rrP } as ConfParts };
}

/* ------------------------------------------------------------------ strateji */
export type KanalItem = {
  symbol: string; tf: string; price: number;
  rsi: number | null; cci: number | null; cciMa: number | null;
  center: number | null; bandUp: number | null; bandDn: number | null; atr: number | null; // bandUp/Dn = EN DIŞ bantlar
  pos: "above" | "below" | "inside";
  side: "BUY" | "SELL" | null;
  stage: number; // 0-5: 1 bant dışı kapanış · 2 RSI aşırı bölgede · +1 bant içine dönüş · +1 RSI kesişimi · +1 CCI kesişimi
  checks: { brk: boolean; ext: boolean; ret: boolean; rsi: boolean; cci: boolean };
  depth: number; // bant dışı kapanış derinliği (ATR)
  rsiPeak: number | null; // pencere içindeki RSI dip (ALIŞ) / tepe (SATIŞ)
  armed: boolean; fire: boolean;
  entry: number | null; sl: number | null; tp: number | null; extreme: number | null; rr: number | null;
  confidence: number; confParts: ConfParts;
  reason: string; barTime: number;
};

type SideEval = { brk: boolean; ext: boolean; ret: boolean; rsi: boolean; cci: boolean; extreme: number; depth: number; peak: number | null };

export function kanalAnalyze(symbol: string, tf: string, candles: Candle[], pIn?: Partial<KanalParams>, entry?: number): KanalItem | null {
  const p = sanitizeParams(pIn);
  const n = candles.length;
  if (n < p.atrPeriod + p.halfLength + 30) return null;
  const t = n - 2; // son KAPANMIŞ mum (n-1 oluşmakta olan mum)
  const pr = candles.map(bandPrice);
  const rsi = rsiSeries(candles.map((c) => c.close), p.rsiPeriod);
  const cci = cciSeries(candles, p.cciPeriod);
  const ma = smaSeries(cci, p.cciMaPeriod);
  const W = p.setupLookback, C = p.crossMaxAge;
  const M = Math.max(p.atrMult1, p.atrMult2, p.atrMult3); // en dış bant

  const cy: (number | null)[] = new Array(n).fill(null);
  const atr: (number | null)[] = new Array(n).fill(null);
  for (let i = Math.max(1, t - W - 4); i <= t; i++) {
    cy[i] = centerAt(pr, i, p.halfLength, n - 1);
    atr[i] = atrAt(candles, i, p.atrPeriod);
  }

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
  const beyond = (sell: boolean, v: number | null) => v !== null && (sell ? v > p.rsiOb : v < p.rsiOs);

  const evalSide = (sell: boolean, tt: number): SideEval => {
    const from = Math.max(1, tt - W + 1);
    const brkBars: number[] = [];
    let depth = 0;
    for (let b = from; b <= tt; b++) {
      const c0 = cy[b], a0 = atr[b];
      if (c0 === null || a0 === null || a0 <= 0) continue;
      const outer = sell ? c0 + M * a0 : c0 - M * a0;
      const d = sell ? candles[b].close - outer : outer - candles[b].close;
      if (d > p.minBreakAtr * a0) {
        brkBars.push(b);
        depth = Math.max(depth, d / a0);
      }
    }
    let ext = false;
    let peak: number | null = null;
    for (let b = Math.max(1, from - 1); b <= tt; b++) {
      const r = rsi[b];
      if (r === null) continue;
      if (beyond(sell, r)) ext = true;
      peak = peak === null ? r : sell ? Math.max(peak, r) : Math.min(peak, r);
    }
    let x = -1; // en son RSI kesişim mumu (en fazla C mum önce)
    const f2 = Math.max(1, from, tt - C + 1);
    for (let b = f2; b <= tt; b++) {
      const r0 = rsi[b - 1], r1 = rsi[b];
      if (r0 === null || r1 === null) continue;
      if (sell ? r0 > p.rsiOb && r1 <= p.rsiOb : r0 < p.rsiOs && r1 >= p.rsiOs) x = b;
    }
    // GERİ DÖNÜŞ: son kapanan mum (tt) en dış bandın içinde kapanmış, bant dışı kapanış ondan ÖNCE olmuş
    const ctt = cy[tt], att = atr[tt];
    // kanalın içi = iki dış bandın arası (üstten taşıp alt bandın da dışına çöken fiyat "dönmüş" sayılmaz)
    const inside = ctt !== null && att !== null && candles[tt].close < ctt + M * att && candles[tt].close > ctt - M * att;
    const ret = inside && brkBars.some((b) => b < tt);
    const brkBefore = brkBars.filter((b) => b <= x);
    // RSI kesişimi bant dışı kapanıştan sonra olmalı VE şu an hâlâ seviyenin doğru tarafında (onay bozulmamış)
    const rNow = rsi[tt];
    const rsiOk = x >= 0 && brkBefore.length > 0 && rNow !== null && (sell ? rNow <= p.rsiOb : rNow >= p.rsiOs);
    let cciX = false;
    for (let b = f2; b <= tt; b++) if (sell ? crossDown(cci, ma, b) : crossUp(cci, ma, b)) cciX = true;
    const cNow = cci[tt], mNow = ma[tt];
    const cciOk = cciX && cNow !== null && mNow !== null && (sell ? cNow < mNow : cNow > mNow);

    // SL tabanı: RSI aşırı bölgedeyken (ve bant dışı kapanış mumundan) kesişim mumuna kadar en düşük / en yüksek fiyat
    let start: number, end: number;
    if (x >= 0) {
      let s0 = x - 1;
      while (s0 - 1 >= 1 && x - s0 < 200 && beyond(sell, rsi[s0 - 1])) s0--;
      start = brkBefore.length ? Math.min(s0, brkBefore[0]) : s0;
      end = x;
    } else {
      start = from;
      end = tt;
    }
    let extreme = sell ? -Infinity : Infinity;
    for (let b = start; b <= end; b++) extreme = sell ? Math.max(extreme, candles[b].high) : Math.min(extreme, candles[b].low);
    return { brk: brkBars.length > 0, ext, ret, rsi: rsiOk, cci: cciOk, extreme, depth, peak };
  };

  const armedOf = (s: SideEval) => s.brk && s.ext && s.ret && s.rsi && s.cci;
  const stageOf = (s: SideEval) => (!s.brk ? 0 : !s.ext ? 1 : 2 + (s.ret ? 1 : 0) + (s.rsi ? 1 : 0) + (s.cci ? 1 : 0));

  const sell = evalSide(true, t), buy = evalSide(false, t);
  const sellPrev = evalSide(true, t - 1), buyPrev = evalSide(false, t - 1);

  const ct = cy[t], at = atr[t];
  const close = candles[t].close;
  const bandUp = ct !== null && at !== null ? ct + M * at : null;
  const bandDn = ct !== null && at !== null ? ct - M * at : null;
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
  let sl: number | null = null, tp: number | null = null, extreme: number | null = null, rrv: number | null = null;
  let confidence = 0;
  let confParts: ConfParts = { base: 0, depth: 0, rsi: 0, cci: 0, rr: 0 };
  if (side && cur && ct !== null && at !== null && Number.isFinite(cur.extreme)) {
    extreme = cur.extreme;
    const lv = kanalLevels(side, livePrice, cur.extreme, ct, at, p);
    sl = lv.sl;
    tp = lv.tp;
    const cf = kanalConfidence(side, cur.depth, cur.peak, cci[t], ma[t], livePrice, sl, tp, p);
    confidence = cf.score;
    rrv = cf.rr;
    confParts = cf.parts;
  }

  let reason = "";
  if (side && cur) {
    const pk = cur.peak === null ? "—" : cur.peak.toFixed(1);
    if (side === "BUY")
      reason = `Tüm alt bantların dışında kapanış${cur.brk ? ` (${cur.depth.toFixed(2)} ATR)` : " yok"} · ${cur.ret ? "bant içine döndü" : "dönüş bekleniyor"} · RSI dip ${pk}${cur.ext ? " <" + p.rsiOs : ""} · RSI ${p.rsiOs}↑ ${cur.rsi ? "kesti" : "bekleniyor"} · CCI mor çizgi↑ ${cur.cci ? "kesti" : "bekleniyor"}`;
    else
      reason = `Tüm üst bantların dışında kapanış${cur.brk ? ` (${cur.depth.toFixed(2)} ATR)` : " yok"} · ${cur.ret ? "bant içine döndü" : "dönüş bekleniyor"} · RSI tepe ${pk}${cur.ext ? " >" + p.rsiOb : ""} · RSI ${p.rsiOb}↓ ${cur.rsi ? "kesti" : "bekleniyor"} · CCI mor çizgi↓ ${cur.cci ? "kesti" : "bekleniyor"}`;
  }

  return {
    symbol, tf, price: livePrice,
    rsi: rsi[t], cci: cci[t], cciMa: ma[t], center: ct, bandUp, bandDn, atr: at, pos,
    side, stage: side === "SELL" ? sS : side === "BUY" ? bS : 0,
    checks: cur ? { brk: cur.brk, ext: cur.ext, ret: cur.ret, rsi: cur.rsi, cci: cur.cci } : { brk: false, ext: false, ret: false, rsi: false, cci: false },
    depth: cur ? cur.depth : 0, rsiPeak: cur ? cur.peak : null,
    armed, fire, entry: livePrice, sl, tp, extreme, rr: rrv, confidence, confParts,
    reason, barTime: candles[t].time,
  };
}
