import { cciSeries, rsiSeries, type Candle } from "./indicators";

/**
 * KANAL stratejisi (KANAL3BAND + RSI + CCI/MA) — panel, Python ajanı ve MQL5 EA ile AYNI mantık.
 *
 * SATIŞ: son kapanan barlarda fiyat ÜST bandı kırmış ve kapanış tekrar band İÇİNE dönmüş,
 *        RSI 70 altında (veya aşağı kesmiş), CCI mor çizgiyi (CCI MA) AŞAĞI kesmiş.
 * ALIŞ : fiyat ALT bandı kırmış ve içeri dönmüş, RSI 30'u YUKARI kesmiş, CCI mor çizgiyi YUKARI kesmiş.
 * Sinyal, tüm koşullar ilk kez sağlandığı kapanmış barda bir kez üretilir (kenar tetikleme).
 *
 * v2.9 kuralları:
 *  • SIRA : İLK kural band içinde mum kapanışı (dönüş barı); RSI ve CCI onayı yalnızca dönüş barından itibaren
 *           sayılır (strictOrder). Dönüşten önceki kesişimler onay değildir.
 *  • YÖN  : RSI ve CCI son `confirmBars` kapanmış barda arka arkaya AYNI yönde hareket eder.
 *  • SL   : önceki dip/tepe VEYA RSI'ın dönüş yaptığı barın dibi/tepesi (daha korumalı olan) ∓ ATR payı.
 *  • TP   : ALIŞ -> girişin üstündeki EN YAKIN üst band · SATIŞ -> girişin altındaki EN YAKIN alt band.
 *  • GÜVEN: 40 + 12×kırılan band + 10×sıra + 10×yön + RSI aşırılığı (≤12) + CCI aşırılığı (≤8), en çok 97.
 *
 * NOT: "Centered" merkez çizgisi geçmiş + gelecek barları kullandığı için grafikte yeniden boyanır.
 * Strateji yalnızca sağ uçtaki (canlı) değerlerle, kapanmış barlar üzerinde çalışır.
 */
export type RsiBuyMode = "crossUp" | "above";
export type RsiSellMode = "below" | "crossDown";
export type SlAnchor = "swingRsi" | "break";
export type TpMode = "nearestBand" | "center";

export type KanalParams = {
  halfLength: number; atrPeriod: number; atrMult1: number; atrMult2: number; atrMult3: number;
  band: 1 | 2 | 3; breakLookback: number; crossLookback: number; breakByClose: boolean;
  rsiPeriod: number; rsiOb: number; rsiOs: number; sellRsiMode: RsiSellMode; buyRsiMode: RsiBuyMode;
  cciPeriod: number; cciMaPeriod: number; slBufferAtr: number;
  /** v2.9: önce band içine kapanış, SONRA RSI & CCI onayı */
  strictOrder: boolean;
  /** RSI ve CCI'nin arka arkaya aynı yönde olması gereken bar sayısı (0 = kapalı) */
  confirmBars: number;
  /** SL çapası: önceki dip/tepe + RSI dönüş barı (swingRsi) ya da yalnız kırılım ucu (break) */
  slAnchor: SlAnchor;
  /** TP: en yakın karşı band (nearestBand) ya da merkez çizgi (center) */
  tpMode: TpMode;
  /** Otomatik işlem (ajan uygular) */
  autoTrade: boolean; autoMinConfidence: number; autoMaxOpen: number; breakEvenPct: number;
};

export const KANAL_DEFAULTS: KanalParams = {
  halfLength: 60, atrPeriod: 100, atrMult1: 4.2, atrMult2: 3.5, atrMult3: 2.8, band: 3,
  breakLookback: 5, crossLookback: 3, breakByClose: false,
  rsiPeriod: 14, rsiOb: 70, rsiOs: 30, sellRsiMode: "below", buyRsiMode: "crossUp",
  cciPeriod: 34, cciMaPeriod: 21, slBufferAtr: 0.5,
  strictOrder: true, confirmBars: 1, slAnchor: "swingRsi", tpMode: "nearestBand",
  autoTrade: false, autoMinConfidence: 80, autoMaxOpen: 3, breakEvenPct: 30,
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
    strictOrder: x.strictOrder === undefined ? D.strictOrder : Boolean(x.strictOrder),
    confirmBars: clamp(x.confirmBars, 0, 5, D.confirmBars, true),
    slAnchor: x.slAnchor === "break" ? "break" : "swingRsi",
    tpMode: x.tpMode === "center" ? "center" : "nearestBand",
    autoTrade: x.autoTrade === undefined ? D.autoTrade : Boolean(x.autoTrade),
    autoMinConfidence: clamp(x.autoMinConfidence, 50, 97, D.autoMinConfidence, true),
    autoMaxOpen: clamp(x.autoMaxOpen, 1, 20, D.autoMaxOpen, true),
    breakEvenPct: clamp(x.breakEvenPct, 0, 90, D.breakEvenPct, true),
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
  bands: { up: number[]; dn: number[] } | null;
  pos: "above" | "below" | "inside";
  side: "BUY" | "SELL" | null;
  stage: number; // 0 bekle · 1 band kırıldı · 2 içeri döndü · 3/4 CCI+RSI · 5 = tüm koşullar (sıra + yön dahil)
  checks: { brk: boolean; ret: boolean; rsi: boolean; cci: boolean; seq: boolean; agree: boolean };
  strength: number; // kırılan band sayısı (1-3)
  armed: boolean; fire: boolean;
  confidence: number; // 0-97
  entry: number | null; sl: number | null; tp: number | null; extreme: number | null; anchor: number | null;
  turnPrice: number | null; reentryTime: number | null;
  reason: string; barTime: number;
};

type Side = {
  brk: boolean; ret: boolean; rsi: boolean; cci: boolean; seq: boolean; agree: boolean;
  extreme: number; anchor: number; turnPrice: number | null; strength: number; rsiExt: number | null; cciExt: number | null; reentry: number | null;
};

/**
 * SL = çapa (önceki dip/tepe ya da RSI dönüş barı) ∓ buf×ATR; yanlış taraftaysa giriş ∓ 1.5 ATR.
 * TP = tpMode "nearestBand": girişe EN YAKIN karşı band (en az 0.5 ATR uzakta) · "center": merkez çizgi.
 * Band bulunamazsa merkez, o da yanlış taraftaysa 1.5R (eski davranış).
 */
export function kanalLevels(
  side: "BUY" | "SELL", entry: number, anchor: number, center: number, atr: number, buf: number,
  upBands?: number[] | null, dnBands?: number[] | null, tpMode: TpMode = "center"
) {
  if (side === "SELL") {
    let sl = anchor + buf * atr;
    if (sl <= entry) sl = entry + 1.5 * atr;
    let tp: number | null = null;
    if (tpMode === "nearestBand" && dnBands) {
      const cands = dnBands.filter((v) => v < entry - 0.5 * atr);
      if (cands.length) tp = Math.max(...cands);
    }
    if (tp === null) tp = center;
    if (tp >= entry) tp = entry - 1.5 * (sl - entry);
    return { sl, tp };
  }
  let sl = anchor - buf * atr;
  if (sl >= entry) sl = entry - 1.5 * atr;
  let tp: number | null = null;
  if (tpMode === "nearestBand" && upBands) {
    const cands = upBands.filter((v) => v > entry + 0.5 * atr);
    if (cands.length) tp = Math.min(...cands);
  }
  if (tp === null) tp = center;
  if (tp <= entry) tp = entry + 1.5 * (entry - sl);
  return { sl, tp };
}

/** Güven skoru (panel/ajan/EA aynı formül). */
export function kanalConfidence(side: "BUY" | "SELL" | null, s: Side | null, p: KanalParams) {
  if (!side || !s || !s.brk) return 0;
  let c = 40 + 12 * s.strength + (s.seq ? 10 : 0) + (s.agree ? 10 : 0);
  if (side === "SELL") {
    if (s.rsiExt !== null) c += Math.min(12, Math.max(0, s.rsiExt - p.rsiOb));
    if (s.cciExt !== null) c += s.cciExt >= 100 ? 8 : s.cciExt >= 50 ? 4 : 0;
  } else {
    if (s.rsiExt !== null) c += Math.min(12, Math.max(0, p.rsiOs - s.rsiExt));
    if (s.cciExt !== null) c += s.cciExt <= -100 ? 8 : s.cciExt <= -50 ? 4 : 0;
  }
  return Math.min(97, Math.floor(c + 0.5));
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

  const bandLvl = (b: number, sell: boolean) => {
    const c0 = cy[b], a0 = atr[b];
    if (c0 === null || a0 === null) return null;
    return sell ? c0 + mult * a0 : c0 - mult * a0;
  };

  const evalSide = (sell: boolean, tt: number): Side => {
    let brk = false;
    let extreme = sell ? -Infinity : Infinity;
    let firstOut: number | null = null;     // ilk kırılım barı
    let lastCloseOut: number | null = null; // kapanışı band DIŞINDA kalan son bar
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
      if (sell ? px > lvl : px < lvl) {
        brk = true;
        if (firstOut === null) firstOut = b;
      }
      if (sell ? candles[b].close > lvl : candles[b].close < lvl) lastCloseOut = b;
      if (sell) extreme = Math.max(extreme, candles[b].high);
      else extreme = Math.min(extreme, candles[b].low);
    }
    const strength = pierced.filter(Boolean).length;
    let ret = false;
    const ct = cy[tt], at = atr[tt];
    if (brk && ct !== null && at !== null) {
      const lvl = sell ? ct + mult * at : ct - mult * at;
      ret = sell ? candles[tt].close < lvl : candles[tt].close > lvl;
    }
    // Dönüş barı (İLK KURAL: band içinde mum kapanışı): band dışında kapanan son bardan sonra band içinde
    // kapanan ilk bar; hiç dışarıda kapanış yoksa (fitil kırılımı) kırılım barının kendisi.
    let reentry: number | null = null;
    if (brk) {
      if (lastCloseOut === null) reentry = firstOut;
      else
        for (let b = lastCloseOut + 1; b <= tt; b++) {
          const lv = bandLvl(b, sell);
          if (lv === null) continue;
          if (sell ? candles[b].close < lv : candles[b].close > lv) { reentry = b; break; }
        }
    }
    const f2 = Math.max(1, tt - p.crossLookback + 1);
    const f2s = reentry !== null ? Math.max(f2, reentry) : f2; // sıkı pencere: dönüş barından itibaren
    const rsiEv = (lo: number) => {
      if (sell) {
        if (p.sellRsiMode === "below") return rsi[tt] !== null && (rsi[tt] as number) < p.rsiOb;
        for (let b = lo; b <= tt; b++) if (lvlDown(b, p.rsiOb)) return true;
        return false;
      }
      if (p.buyRsiMode === "above") return rsi[tt] !== null && (rsi[tt] as number) > p.rsiOs;
      for (let b = lo; b <= tt; b++) if (lvlUp(b, p.rsiOs)) return true;
      return false;
    };
    const cciEv = (lo: number) => {
      for (let b = lo; b <= tt; b++) if (sell ? crossDown(cci, ma, b) : crossUp(cci, ma, b)) return true;
      return false;
    };
    const rsiLoose = rsiEv(f2), cciLoose = cciEv(f2);
    const rsiStrict = rsiEv(f2s), cciStrict = cciEv(f2s);
    const seq = ret && rsiStrict && cciStrict; // önce dönüş, sonra RSI & CCI onayı
    const rsiOk = p.strictOrder ? rsiStrict : rsiLoose;
    const cciOk = p.strictOrder ? cciStrict : cciLoose;
    // Yön onayı: RSI ve CCI son N kapanmış barda ARKA ARKAYA aynı yönde
    const nb = Math.max(1, p.confirmBars);
    let agree = true;
    for (let k = 0; k < nb; k++) {
      const i = tt - k;
      const r1 = rsi[i], r0 = rsi[i - 1], c1 = cci[i], c0 = cci[i - 1];
      if (i < 1 || r1 === null || r0 === null || c1 === null || c0 === null) { agree = false; break; }
      if (sell ? !(r1 < r0 && c1 < c0) : !(r1 > r0 && c1 > c0)) { agree = false; break; }
    }
    // RSI'ın dönüş yaptığı bar (pencerede RSI'ın ucu) ve RSI/CCI uçları (SL çapası + güven skoru)
    const f3 = Math.max(1, tt - p.breakLookback - p.crossLookback + 1);
    let turn: number | null = null;
    let rsiExt: number | null = null;
    for (let i = f3; i <= tt; i++) {
      const v = rsi[i];
      if (v === null) continue;
      if (turn === null || rsiExt === null || (sell ? v > rsiExt : v < rsiExt)) { turn = i; rsiExt = v; }
    }
    let cciExt: number | null = null;
    for (let i = f3; i <= tt; i++) {
      const v = cci[i];
      if (v === null) continue;
      if (cciExt === null || (sell ? v > cciExt : v < cciExt)) cciExt = v;
    }
    const turnPrice = turn !== null ? (sell ? candles[turn].high : candles[turn].low) : null;
    let anchor = extreme;
    if (p.slAnchor === "swingRsi" && turnPrice !== null && Number.isFinite(extreme)) anchor = sell ? Math.max(extreme, turnPrice) : Math.min(extreme, turnPrice);
    return { brk, ret, rsi: rsiOk, cci: cciOk, seq, agree, extreme, anchor, turnPrice, strength, rsiExt, cciExt, reentry };
  };

  const armedOf = (s: Side) => s.brk && s.ret && s.rsi && s.cci && (s.agree || p.confirmBars <= 0);
  const stageOf = (s: Side) => (!s.brk ? 0 : !s.ret ? 1 : armedOf(s) ? 5 : 2 + (s.cci ? 1 : 0) + (s.rsi ? 1 : 0));

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
  const bands = ct !== null && at !== null ? { up: mults.map((m) => ct + m * at), dn: mults.map((m) => ct - m * at) } : null;
  let sl: number | null = null, tp: number | null = null, extreme: number | null = null, anchor: number | null = null;
  if (side && cur && ct !== null && at !== null && Number.isFinite(cur.extreme)) {
    extreme = cur.extreme;
    anchor = cur.anchor;
    const lv = kanalLevels(side, livePrice, anchor, ct, at, p.slBufferAtr, bands?.up, bands?.dn, p.tpMode);
    sl = lv.sl; tp = lv.tp;
  }
  const confidence = kanalConfidence(side, cur, p);

  const r = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
  let reason = "";
  if (side && cur) {
    const bn = `Band ${p.band}`;
    const tail = ` · sıra ${cur.seq ? "✓" : "✗"} · yön ${cur.agree ? "✓" : "✗"} · güven %${confidence}`;
    if (side === "SELL")
      reason = `Üst ${bn} kırıldı${cur.ret ? " → içeri döndü" : ""} · CCI ${cur.cci ? "MA'yı aşağı kesti" : "kesişim yok"} · RSI ${r(rsi[t])} ${p.sellRsiMode === "below" ? `< ${p.rsiOb}` : cur.rsi ? `${p.rsiOb}'i aşağı kesti` : `${p.rsiOb} kesişimi yok`}` + tail;
    else
      reason = `Alt ${bn} kırıldı${cur.ret ? " → içeri döndü" : ""} · CCI ${cur.cci ? "MA'yı yukarı kesti" : "kesişim yok"} · RSI ${r(rsi[t])} ${p.buyRsiMode === "above" ? `> ${p.rsiOs}` : cur.rsi ? `${p.rsiOs}'u yukarı kesti` : `${p.rsiOs} kesişimi yok`}` + tail;
  }

  return {
    symbol, tf, price: livePrice,
    rsi: rsi[t], cci: cci[t], cciMa: ma[t], center: ct, bandUp, bandDn, atr: at, bands, pos,
    side, stage: side === "SELL" ? sS : side === "BUY" ? bS : 0,
    checks: cur
      ? { brk: cur.brk, ret: cur.ret, rsi: cur.rsi, cci: cur.cci, seq: cur.seq, agree: cur.agree }
      : { brk: false, ret: false, rsi: false, cci: false, seq: false, agree: false },
    strength: cur ? cur.strength : 0, armed, fire, confidence,
    entry: livePrice, sl, tp, extreme, anchor,
    turnPrice: cur ? cur.turnPrice : null, reentryTime: cur && cur.reentry !== null ? candles[cur.reentry].time : null,
    reason, barTime: candles[t].time,
  };
}
