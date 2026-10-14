import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { signals, compileJobs, strategies, messages } from "@/db/schema";
import { userFromAgentKey } from "@/lib/auth";
import { decideSignal } from "@/lib/actions";

export async function POST(req: Request) {
  const u = await userFromAgentKey(req.headers.get("x-agent-key"));
  if (!u) return Response.json({ error: "Geçersiz ajan anahtarı" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const now = new Date();

  if (b.type === "signal") {
    await db
      .update(signals)
      .set({ status: b.status === "executed" ? "executed" : "failed", note: String(b.note ?? "").slice(0, 500), decidedAt: now })
      .where(and(eq(signals.id, Number(b.id)), eq(signals.userId, u.id)));
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
  } else if (b.type === "message") {
    await db.insert(messages).values({ userId: u.id, role: b.role === "user" ? "user" : "assistant", content: String(b.content ?? "") });
  }
  return Response.json({ ok: true });
}
