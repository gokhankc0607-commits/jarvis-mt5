import { eq } from "drizzle-orm";
import { db } from "@/db";
import { watchRules } from "@/db/schema";
import { analyze, DEFAULT_CFG, type Candle, type RadarCfg } from "./indicators";
import { getSeries, getTick } from "./live";
import { TF_MIN, categoryOf, parseTfs, type Category } from "./tf";
import { demoCandles } from "./demo";

/* ------------------------------------------------------------------ yükleme */
export function loadCandles(userId: number, live: boolean, symbol: string, tf: string): Candle[] {
  if (live) return getSeries(userId, symbol, tf)?.candles ?? [];
  return demoCandles(symbol, tf, 320);
}

export function loadCandlesMeta(userId: number, live: boolean, symbol: string, tf: string): { candles: Candle[]; ageMs: number | null } {
  if (!live) return { candles: demoCandles(symbol, tf, 320), ageMs: 0 };
  const s = getSeries(userId, symbol, tf);
  return { candles: s?.candles ?? [], ageMs: s ? Date.now() - s.at : null };
}

type Rule = typeof watchRules.$inferSelect;
export const ruleCfg = (r?: Rule | null): RadarCfg =>
  r
    ? { rsiPeriod: r.rsiPeriod, rsiOverbought: r.rsiOverbought, rsiOversold: r.rsiOversold, cciPeriod: r.cciPeriod, cciLevel: r.cciLevel }
    : DEFAULT_CFG;

export async function userRules(userId: number) {
  return db.select().from(watchRules).where(eq(watchRules.userId, userId)).orderBy(watchRules.id);
}

/* ------------------------------------------------------------------ özet */
export type Quote = {
  symbol: string;
  category: Category;
  enabled: boolean;
  tfs: string[];
  price: number | null;
  change: number;
  changePct: number;
  spark: number[];
  bid: number | null;
  ask: number | null;
  stale: number; // fiyatın kaç sn'dir değişmediği (ajan ölçer): uzunsa piyasa kapalı olabilir
  tickAge: number | null; // son fiyatın panele ulaşma yaşı (sn)
  minDist: number | null; // brokerın minimum SL/TP mesafesi (stops level + spread), fiyat birimiyle
  digits: number | null;
  rsi: number | null;
  cci: number | null;
  signal: "BUY" | "SELL" | null;
  tags: string[];
};
export type RadarRow = {
  symbol: string;
  tf: string;
  price: number | null;
  rsi: number | null;
  cci: number | null;
  signal: "BUY" | "SELL" | null;
  strength: number;
  tags: string[];
  rsiZone: "os" | "ob" | null;
  cciZone: "os" | "ob" | null;
  cfg: { os: number; ob: number; cci: number };
};

export async function buildMarket(userId: number, live: boolean) {
  const rules = await userRules(userId);
  const quotes: Quote[] = [];
  const radar: RadarRow[] = [];
  const seen = new Map<string, Quote>();

  for (const r of rules) {
    const symbol = r.symbol.toUpperCase();
    const tfs = parseTfs(r.timeframe);
    const cfg = ruleCfg(r);
    const existing = seen.get(symbol);
    if (existing) {
      existing.tfs = [...new Set([...existing.tfs, ...tfs])];
      existing.enabled = existing.enabled || r.enabled;
    }
    let first = true;
    const tk = live ? getTick(userId, symbol) : undefined; // canlı fiyat akışı (≈1 sn)
    for (const tf of tfs) {
      const candles = loadCandles(userId, live, symbol, tf);
      const a = analyze(candles, cfg);
      const candlePx = candles.length ? candles[candles.length - 1].close : null;
      const price = tk ? tk.bid : candlePx;
      radar.push({
        symbol, tf, price, rsi: a.rsi, cci: a.cci, signal: a.signal, strength: a.strength, tags: a.tags,
        rsiZone: a.rsiZone, cciZone: a.cciZone, cfg: { os: cfg.rsiOversold, ob: cfg.rsiOverbought, cci: cfg.cciLevel },
      });
      if (first && !existing) {
        first = false;
        const n = candles.length;
        const back = Math.max(1, Math.min(n - 1, Math.round(1440 / (TF_MIN[tf] ?? 60))));
        const ref = n > 1 ? candles[n - 1 - back].close : price ?? 0;
        const q: Quote = {
          symbol, category: categoryOf(symbol), enabled: r.enabled, tfs,
          price, change: price !== null ? price - ref : 0, changePct: price !== null && ref ? ((price - ref) / ref) * 100 : 0,
          spark: candles.slice(-40).map((c) => c.close),
          bid: tk?.bid ?? null, ask: tk?.ask ?? null, stale: tk?.stale ?? 0, tickAge: tk ? (Date.now() - tk.at) / 1000 : null,
          minDist: tk && tk.point !== undefined ? (tk.stops ?? 0) * tk.point + (tk.ask - tk.bid) : null, digits: tk?.digits ?? null,
          rsi: a.rsi, cci: a.cci, signal: a.signal, tags: a.tags,
        };
        seen.set(symbol, q);
        quotes.push(q);
      }
    }
  }
  radar.sort((a, b) => Number(!!b.signal) - Number(!!a.signal) || b.strength - a.strength || b.tags.length - a.tags.length);
  return { quotes, radar };
}
