import { and, eq, gt, inArray, asc, ne, lt } from "drizzle-orm";
import { db } from "@/db";
import { accountState, trades, signals, compileJobs, strategies, watchRules } from "@/db/schema";
import { userFromAgentKey } from "@/lib/auth";
import { getActiveProvider } from "@/lib/llm";
import { expandRules } from "@/lib/rules";
import { setAgentInfo, setPing } from "@/lib/live";
import { LATEST_AGENT } from "@/lib/version";
import { ensureKanal } from "@/lib/kanalStore";

type Pos = { ticket: string | number; symbol: string; side: string; volume: number; openPrice: number; currentPrice: number; sl?: number; tp?: number; pnl: number; comment?: string };
type Sig = { symbol: string; side: string; timeframe?: string; price: number; sl?: number; tp?: number; volume?: number; reason?: string; indicators?: Record<string, number | string | boolean>; confidence?: number };

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const now = new Date();
  if (b.agent && typeof b.agent === "object")
    setAgentInfo(u.id, {
      version: String(b.agent.version ?? ""), algo: b.agent.algo !== false, tradeAllowed: b.agent.tradeAllowed !== false,
      build: Number(b.agent.build ?? 0) || 0,
    });

  const a = b.account ?? null;
  const accSet = {
    agentLastSeen: now,
    updatedAt: now,
    connected: Boolean(a?.connected ?? false),
    ...(a
      ? {
          server: String(a.server ?? ""),
          login: String(a.login ?? ""),
          balance: Number(a.balance ?? 0),
          equity: Number(a.equity ?? 0),
          margin: Number(a.margin ?? 0),
          freeMargin: Number(a.freeMargin ?? 0),
          currency: String(a.currency ?? "USD"),
          leverage: Number(a.leverage ?? 100),
        }
      : {}),
  };
  await db.insert(accountState).values({ userId: u.id, ...accSet }).onConflictDoUpdate({ target: accountState.userId, set: accSet });

  if (Array.isArray(b.positions) && a?.connected) {
    const positions = b.positions as Pos[];
    const tickets = positions.map((p) => String(p.ticket));
    const existing = await db.select().from(trades).where(and(eq(trades.userId, u.id), inArray(trades.status, ["open", "closing"])));
    for (const p of positions) {
      const ex = existing.find((e) => e.ticket === String(p.ticket));
      const vals = { currentPrice: p.currentPrice, pnl: p.pnl, sl: p.sl || null, tp: p.tp || null, volume: p.volume };
      if (ex) await db.update(trades).set(vals).where(eq(trades.id, ex.id));
      else
        await db.insert(trades).values({
          userId: u.id, ticket: String(p.ticket), symbol: p.symbol, side: p.side, openPrice: p.openPrice,
          comment: p.comment ?? "", source: "agent", ...vals,
        });
    }
    for (const e of existing) {
      if (e.source !== "manual" && !tickets.includes(e.ticket) && (e.source === "agent" || e.status === "closing"))
        await db.update(trades).set({ status: "closed", closedAt: now }).where(eq(trades.id, e.id));
    }
  }

  // MT5 geçmişinden gelen gerçekleşmiş K/Z (komisyon + swap dahil)
  if (Array.isArray(b.closed)) {
    for (const c of b.closed.slice(0, 50) as { ticket: string; profit: number; price: number; time: number }[]) {
      if (!c?.ticket || !Number.isFinite(c.profit)) continue;
      await db
        .update(trades)
        .set({ status: "closed", pnl: c.profit, currentPrice: Number.isFinite(c.price) ? c.price : undefined, closedAt: c.time ? new Date(c.time * 1000) : now })
        .where(and(eq(trades.userId, u.id), eq(trades.ticket, String(c.ticket))));
    }
  }

  let created = 0;
  if (Array.isArray(b.signals)) {
    for (const s of b.signals as Sig[]) {
      const dup = await db
        .select({ id: signals.id })
        .from(signals)
        .where(and(eq(signals.userId, u.id), eq(signals.symbol, s.symbol), eq(signals.side, s.side), eq(signals.timeframe, s.timeframe ?? "H1"), gt(signals.createdAt, new Date(Date.now() - 30 * 60000))))
        .limit(1);
      if (dup.length) continue;
      await db.insert(signals).values({
        userId: u.id, symbol: s.symbol, side: s.side === "SELL" ? "SELL" : "BUY", timeframe: s.timeframe ?? "H1",
        price: s.price, sl: s.sl ?? null, tp: s.tp ?? null, volume: s.volume ?? 0.1, reason: s.reason ?? "",
        indicators: s.indicators ?? {}, confidence: s.confidence ?? 50, source: "agent",
      });
      created++;
    }
  }

  // 30 dk'dan eski bekleyen sinyaller bayattır: süresi dolmuş say (fiyat ve SL/TP artık geçersiz)
  await db
    .update(signals)
    .set({ status: "expired", note: "Süre doldu (30 dk) — yeni sinyal bekleyin" })
    .where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), ne(signals.source, "demo"), lt(signals.createdAt, new Date(Date.now() - 30 * 60000))));
  // Onaylandığı hâlde 10 dk içinde yürütülmemiş sinyaller (ajan kapalıydı / rapor ulaşmadı) tekrar gönderilmez:
  // bayat fiyatla ya da ajan yeniden başlayınca ikinci kez emir açılmasını önler. "Tekrar dene" ile yeniden onaylanabilir.
  await db
    .update(signals)
    .set({ status: "failed", note: "Onay 10 dk içinde yürütülemedi (ajan kapalı/erişilemedi). Fiyat güncelse 'Tekrar dene' ile yeniden onaylayın." })
    .where(and(eq(signals.userId, u.id), eq(signals.status, "approved"), ne(signals.source, "demo"), lt(signals.decidedAt, new Date(Date.now() - 10 * 60000))));
  // Demo/örnek sinyaller gerçek MT5 ajanına ASLA gönderilmez
  const approved = await db.select().from(signals).where(and(eq(signals.userId, u.id), eq(signals.status, "approved"), ne(signals.source, "demo")));
  const closeReq = await db.select({ ticket: trades.ticket }).from(trades).where(and(eq(trades.userId, u.id), eq(trades.status, "closing")));
  const queued = await db
    .select({ job: compileJobs, strategy: strategies })
    .from(compileJobs)
    .innerJoin(strategies, eq(strategies.id, compileJobs.strategyId))
    .where(and(eq(compileJobs.userId, u.id), eq(compileJobs.status, "queued")))
    .orderBy(asc(compileJobs.createdAt));
  if (queued.length) {
    await db.update(compileJobs).set({ status: "running" }).where(inArray(compileJobs.id, queued.map((q) => q.job.id)));
    await db.update(strategies).set({ status: "compiling" }).where(inArray(strategies.id, queued.map((q) => q.strategy.id)));
  }
  const pending = await db.select().from(signals).where(and(eq(signals.userId, u.id), eq(signals.status, "pending"), ne(signals.source, "demo")));
  const allRules = await db.select().from(watchRules).where(eq(watchRules.userId, u.id));
  const rules = expandRules(allRules.filter((r) => r.enabled)); // her zaman dilimi ayrı kural
  const watchlist = expandRules(allRules).map((r) => ({ symbol: r.symbol, timeframe: r.timeframe }));
  if (typeof a?.ping === "number") setPing(u.id, a.ping);
  const provider = await getActiveProvider(u.id);
  const kanal = await ensureKanal(u.id);

  return Response.json({
    createdSignals: created,
    approvedSignals: approved,
    pendingSignals: pending,
    closeTickets: closeReq.map((c) => c.ticket),
    compileJobs: queued.map((q) => ({
      jobId: q.job.id, strategyId: q.strategy.id, name: q.strategy.name, filePath: q.strategy.filePath,
      code: q.strategy.code, autoFix: q.job.autoFix, maxAttempts: q.job.maxAttempts,
    })),
    rules,
    watchlist,
    kanal,
    latestAgent: LATEST_AGENT,
    provider: provider ? { kind: provider.kind, baseUrl: provider.baseUrl, model: provider.model, apiKey: provider.apiKey } : null,
  });
}
