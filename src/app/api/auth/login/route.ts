import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, hashPassword, newAgentKey, verifyPassword } from "@/lib/auth";
import { seedUser } from "@/lib/seed";
import { clientKey, rateHit, rateLimited, rateReset } from "@/lib/rateLimit";

const DEMO_EMAIL = "demo@jarvis.local";
const DEMO_PASSWORD = "jarvis123";

async function handle(req: Request) {
  const { email, password } = await req.json().catch(() => ({}));
  const em = String(email ?? "").trim().toLowerCase();
  const pw = String(password ?? "");
  if (!em || !pw) return Response.json({ error: "E-posta ve şifre gerekli" }, { status: 400 });

  // Kaba kuvvet koruması: istemci başına ve hesap başına başarısız deneme sınırı
  const keys = [`login:ip:${clientKey(req)}`, `login:user:${em}`];
  for (const k of keys) {
    const r = rateLimited(k, k.startsWith("login:ip") ? 20 : 8);
    if (r.limited)
      return Response.json({ error: `Çok fazla başarısız deneme. ${Math.ceil(r.retryAfterSec / 60)} dk sonra tekrar deneyin.` }, { status: 429 });
  }

  let [u] = await db.select().from(users).where(eq(users.email, em)).limit(1);
  if (!u && em === DEMO_EMAIL && pw === DEMO_PASSWORD) {
    [u] = await db
      .insert(users)
      .values({ email: em, name: "Kaptan", passwordHash: hashPassword(pw), agentKey: newAgentKey() })
      .returning();
    await seedUser(u.id);
  }
  if (!u || !verifyPassword(pw, u.passwordHash)) {
    for (const k of keys) rateHit(k);
    return Response.json({ error: "Geçersiz e-posta veya şifre" }, { status: 401 });
  }
  for (const k of keys) rateReset(k);
  await createSession(u.id);
  // Varsayılan demo şifresiyle giriş: arayüz uyarı gösterir (ağ modunda herkes bu şifreyi bilir)
  return Response.json({ ok: true, defaultPassword: em === DEMO_EMAIL && pw === DEMO_PASSWORD });
}

export async function POST(req: Request) {
  try {
    return await handle(req);
  } catch (e) {
    console.error("[auth]", e);
    const msg = (e as Error).message || "";
    return Response.json(
      { error: `Veritabanı hatası: ${msg.split("\n")[0].slice(0, 160)}` },
      { status: 500 }
    );
  }
}
