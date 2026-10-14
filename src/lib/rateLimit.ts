/**
 * Basit bellek içi hız sınırı (tek süreçli yerel panel için yeterli).
 * Giriş denemelerini kaba kuvvete karşı yavaşlatır: anahtar başına `max` başarısız deneme / `windowMs`.
 */
type Bucket = { count: number; resetAt: number };

const g = globalThis as typeof globalThis & { __jarvisRate?: Map<string, Bucket> };
const store = () => (g.__jarvisRate ??= new Map());

export function rateLimited(key: string, max = 10, windowMs = 10 * 60000): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = store().get(key);
  if (!b || b.resetAt <= now) return { limited: false, retryAfterSec: 0 };
  return { limited: b.count >= max, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

export function rateHit(key: string, windowMs = 10 * 60000) {
  const now = Date.now();
  const m = store();
  const b = m.get(key);
  if (!b || b.resetAt <= now) m.set(key, { count: 1, resetAt: now + windowMs });
  else b.count++;
  // Haritayı şişirme: süresi dolanları ara sıra temizle
  if (m.size > 1000) for (const [k, v] of m) if (v.resetAt <= now) m.delete(k);
}

export function rateReset(key: string) {
  store().delete(key);
}

/** İstemci anahtarı: proxy arkasında x-forwarded-for, aksi hâlde tek bir "yerel" kova. */
export function clientKey(req: Request) {
  const h = req.headers;
  const ip = (h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "").split(",")[0].trim();
  return ip || "local";
}
