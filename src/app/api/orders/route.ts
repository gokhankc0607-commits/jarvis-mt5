import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountState, signals } from "@/db/schema";
import { withUser, num } from "@/lib/api";
import { agentOnline, pipSize } from "@/lib/sim";
import { getAgentInfo, getTick } from "@/lib/live";
import { demoCandles } from "@/lib/demo";
import { decideSignal } from "@/lib/actions";

/**
 * Elle emir (Hızlı Emir). Kullanıcı panelde "Emri onayla" düğmesine bilerek basar — bu açık onaydır.
 * Emir güncel fiyattan hesaplanır ve ajan gönderimden önce (Algo Trading, stop mesafesi, fiyat bayatlığı) yeniden doğrular.
 */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json();
    const symbol = String(b.symbol ?? "").toUpperCase().trim();
    if (!/^[A-Z0-9._#-]{2,20}$/.test(symbol)) throw new Error("Geçerli bir sembol girin (örn. EURUSD)");
    const side = b.side === "SELL" ? "SELL" : b.side === "BUY" ? "BUY" : null;
    if (!side) throw new Error("Yön seçin (AL / SAT)");
    const volume = num(b.volume, 0.1) ?? 0.1;
    if (volume < 0.01 || volume > 100) throw new Error("Lot 0.01 ile 100 arasında olmalı");

    const [acc] = await db.select().from(accountState).where(eq(accountState.userId, u.id)).limit(1);
    const live = agentOnline(acc?.agentLastSeen);
    const tk = live ? getTick(u.id, symbol, 20000) : undefined;
    if (live && !tk) throw new Error(`${symbol} için canlı fiyat yok. Sembol MT5 Piyasa Gözlemi'nde / izleme listesinde olmalı ve ajan çalışmalı.`);
    if (live && getAgentInfo(u.id)?.algo === false) throw new Error("MT5'te Algo Trading KAPALI. Üst çubuktaki Algo Trading düğmesini açın, sonra tekrar deneyin.");
    let price: number;
    if (tk) price = side === "BUY" ? tk.ask : tk.bid;
    else {
      const c = demoCandles(symbol, "M15", 5);
      price = c[c.length - 1].close;
    }

    const pip = pipSize(symbol);
    let sl = num(b.sl), tp = num(b.tp);
    const slPips = num(b.slPips), tpPips = num(b.tpPips);
    if (slPips) sl = side === "BUY" ? price - slPips * pip : price + slPips * pip;
    if (tpPips) tp = side === "BUY" ? price + tpPips * pip : price - tpPips * pip;
    if (sl && (side === "BUY" ? sl >= price : sl <= price)) throw new Error(`SL yanlış tarafta: ${side === "BUY" ? "AL" : "SAT"} emrinde SL fiyatın ${side === "BUY" ? "altında" : "üstünde"} olmalı (güncel ${price}).`);
    if (tp && (side === "BUY" ? tp <= price : tp >= price)) throw new Error(`TP yanlış tarafta: ${side === "BUY" ? "AL" : "SAT"} emrinde TP fiyatın ${side === "BUY" ? "üstünde" : "altında"} olmalı (güncel ${price}).`);
    const digits = tk?.digits ?? (price > 1000 ? 2 : price > 50 ? 3 : 5);
    const r = (v: number | null) => (v ? Number(v.toFixed(digits)) : null);

    const [sig] = await db
      .insert(signals)
      .values({
        userId: u.id, symbol, side, timeframe: "MAN", price: Number(price.toFixed(digits)), sl: r(sl), tp: r(tp), volume,
        reason: "Elle emir (panel · Hızlı Emir)", confidence: 100, source: "manual", status: "pending",
        indicators: {}, note: "Kullanıcı onayladı (panel)",
      })
      .returning();
    const out = await decideSignal(u.id, sig.id, true); // canlıda ajana iletir; demoda simüle eder
    return Response.json({ ...out, live });
  });
}
