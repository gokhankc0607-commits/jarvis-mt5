import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accountState } from "@/db/schema";
import { withUser } from "@/lib/api";
import { agentOnline } from "@/lib/sim";
import { buildMarket } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  return withUser(async (u) => {
    const [acc] = await db.select().from(accountState).where(eq(accountState.userId, u.id)).limit(1);
    const live = agentOnline(acc?.agentLastSeen);
    const m = await buildMarket(u.id, live);
    return Response.json({ live, ...m });
  });
}
