import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { signals, compileJobs, strategies, messages, tradeCommands, trades } from "@/db/schema";
import { userFromAgentKey } from "@/lib/auth";
import { decideSignal } from "@/lib/actions";

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const now = new Date();

  if (b.type === "signal") {
    const [sg] = await db
      .update(signals)
      .set({ status: b.status === "executed" ? "executed" : "failed", note: String(b.note ?? "").slice(0, 500), decidedAt: now })
      .where(and(eq(signals.id, Number(b.id)), eq(signals.userId, u.id)))
      .returning();
    // açılan pozisyonun zaman dilimi (işlem kaydı zaten oluştuysa hemen doldur)
    if (sg && b.status === "executed" && b.ticket)
      await db.update(trades).set({ timeframe: sg.timeframe }).where(and(eq(trades.userId, u.id), eq(trades.ticket, String(b.ticket)), eq(trades.timeframe, "")));
  } else if (b.type === "decision") {
    // Sesli "Evet"/"Hayır" ajanda algılandı
    const r = await decideSignal(u.id, Number(b.signalId), Boolean(b.approve));
    return Response.json({ ok: true, signal: r });
  } else if (b.type === "compile") {
    const ok = b.status === "success";
    const [job] = await db
      .update(compileJobs)
      .set({
        status: ok ? "success" : "failed",
        errors: Number(b.errors ?? 0),
        warnings: Number(b.warnings ?? 0),
        attempt: Number(b.attempt ?? 1),
        log: String(b.log ?? ""),
        finishedAt: now,
      })
      .where(and(eq(compileJobs.id, Number(b.jobId)), eq(compileJobs.userId, u.id)))
      .returning();
    if (job) {
      const [st] = await db.select().from(strategies).where(eq(strategies.id, job.strategyId));
      const codeChanged = typeof b.code === "string" && b.code && st && b.code !== st.code;
      await db
        .update(strategies)
        .set({
          status: ok ? "compiled" : "error",
          lastCompiledAt: now,
          ...(codeChanged ? { code: b.code, version: st.version + 1, updatedAt: now } : {}),
        })
        .where(eq(strategies.id, job.strategyId));
    }
  } else if (b.type === "command") {
    const ok = b.status === "done";
    const [c] = await db
      .update(tradeCommands)
      .set({ status: ok ? "done" : "failed", note: String(b.note ?? "").slice(0, 500), doneAt: now })
      .where(and(eq(tradeCommands.id, Number(b.id)), eq(tradeCommands.userId, u.id)))
      .returning();
    if (c && ok && c.type === "modify") {
      const set: Partial<typeof trades.$inferInsert> = {};
      if (c.sl !== null) set.sl = c.sl || null;
      if (c.tp !== null) set.tp = c.tp || null;
      if (Object.keys(set).length) await db.update(trades).set(set).where(and(eq(trades.userId, u.id), eq(trades.ticket, c.ticket)));
    }
    if (c && !ok && c.type === "close")
      await db.update(trades).set({ status: "open" }).where(and(eq(trades.userId, u.id), eq(trades.ticket, c.ticket), eq(trades.status, "closing")));
  } else if (b.type === "message") {
    await db.insert(messages).values({ userId: u.id, role: b.role === "user" ? "user" : "assistant", content: String(b.content ?? "") });
  }
  return Response.json({ ok: true });
}
