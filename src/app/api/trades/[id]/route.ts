import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { trades, accountState } from "@/db/schema";
import { type Ctx, num, withUser } from "@/lib/api";
import { isAgentOnline } from "@/lib/actions";

export async function PATCH(req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    const b = await req.json();
    const [t] = await db.select().from(trades).where(and(eq(trades.id, id), eq(trades.userId, u.id))).limit(1);
    if (!t) throw new Error("İşlem bulunamadı");
    if (b.action === "close") {
      if (t.source === "agent" && (await isAgentOnline(u.id))) {
        const [r] = await db.update(trades).set({ status: "closing" }).where(eq(trades.id, id)).returning();
        return Response.json(r);
      }
      const [r] = await db.update(trades).set({ status: "closed", closedAt: new Date() }).where(eq(trades.id, id)).returning();
      await db
        .update(accountState)
        .set({ balance: sql`${accountState.balance} + ${t.pnl}` })
        .where(eq(accountState.userId, u.id));
      return Response.json(r);
    }
    const set: Partial<typeof trades.$inferInsert> = {};
    if (b.sl !== undefined) set.sl = num(b.sl);
    if (b.tp !== undefined) set.tp = num(b.tp);
    if (b.comment !== undefined) set.comment = String(b.comment);
    const [r] = await db.update(trades).set(set).where(eq(trades.id, id)).returning();
    return Response.json(r);
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return withUser(async (u) => {
    const id = Number((await ctx.params).id);
    await db.delete(trades).where(and(eq(trades.id, id), eq(trades.userId, u.id)));
    return Response.json({ ok: true });
  });
}
