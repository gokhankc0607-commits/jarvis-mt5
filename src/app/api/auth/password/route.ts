import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { withUser } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth";

/** Şifre değiştir: mevcut şifre doğrulanır, diğer cihazlardaki oturumlar kapatılır (bu oturum açık kalır). */
export async function POST(req: Request) {
  return withUser(async (u) => {
    const b = await req.json().catch(() => ({}));
    const current = String(b.current ?? "");
    const next = String(b.next ?? "");
    if (next.length < 8) throw new Error("Yeni şifre en az 8 karakter olmalı");
    if (next === current) throw new Error("Yeni şifre eskisiyle aynı olamaz");
    if (/^(jarvis123|12345678|password|sifre123)$/i.test(next)) throw new Error("Bu şifre çok tahmin edilebilir, başka bir şifre seçin");
    const [row] = await db.select({ hash: users.passwordHash }).from(users).where(eq(users.id, u.id)).limit(1);
    if (!row || !verifyPassword(current, row.hash)) throw new Error("Mevcut şifre yanlış");
    await db.update(users).set({ passwordHash: hashPassword(next) }).where(eq(users.id, u.id));
    const mine = (await cookies()).get("jarvis_session")?.value ?? "";
    await db.delete(sessions).where(and(eq(sessions.userId, u.id), ne(sessions.id, mine)));
    return Response.json({ ok: true });
  });
}
