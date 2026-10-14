import { readFileSync } from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { kanalSettings, strategies } from "@/db/schema";
import { KANAL_DEFAULTS, sanitizeParams, type KanalParams } from "./kanal";
import { joinTfs, parseTfs } from "./tf";

export type KanalCfg = { enabled: boolean; timeframes: string; scanAll: boolean; lot: number; params: KanalParams };

type Row = typeof kanalSettings.$inferSelect;
const toCfg = (r: Row): KanalCfg => ({
  enabled: r.enabled,
  timeframes: joinTfs(parseTfs(r.timeframes)) || "M15,H1",
  scanAll: r.scanAll,
  lot: r.lot,
  params: sanitizeParams(r.params),
});

export async function ensureKanal(userId: number): Promise<KanalCfg> {
  let [r] = await db.select().from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  if (!r) {
    await db.insert(kanalSettings).values({ userId, params: KANAL_DEFAULTS as unknown as Record<string, number | string | boolean> }).onConflictDoNothing();
    [r] = await db.select().from(kanalSettings).where(eq(kanalSettings.userId, userId)).limit(1);
  }
  return toCfg(r);
}

export async function updateKanal(userId: number, body: Record<string, unknown>): Promise<KanalCfg> {
  const cur = await ensureKanal(userId);
  const set: Partial<typeof kanalSettings.$inferInsert> = { updatedAt: new Date() };
  if (body.enabled !== undefined) set.enabled = Boolean(body.enabled);
  if (body.scanAll !== undefined) set.scanAll = Boolean(body.scanAll);
  if (body.lot !== undefined) {
    const l = Number(body.lot);
    if (Number.isFinite(l) && l > 0 && l <= 100) set.lot = l;
  }
  const tfs = Array.isArray(body.timeframes) ? joinTfs(body.timeframes.map(String)) : typeof body.timeframes === "string" ? joinTfs(body.timeframes.split(",")) : "";
  if (tfs) set.timeframes = tfs;
  if (body.params && typeof body.params === "object")
    set.params = sanitizeParams({ ...cur.params, ...(body.params as Record<string, unknown>) }) as unknown as Record<string, number | string | boolean>;
  await db.update(kanalSettings).set(set).where(eq(kanalSettings.userId, userId));
  return ensureKanal(userId);
}

/* ------------------------------------------------------------------ MQL5 kaynakları */
export const KANAL_SOURCES = [
  { file: "KANAL_Strateji.mq5", name: "KANAL Strateji EA (Band + RSI + CCI)", filePath: "MQL5\\Experts\\Jarvis\\KANAL_Strateji.mq5",
    description: "KANAL3BAND bandını kırıp dönüş + RSI 70/30 + CCI MA kesişimi. Piyasa Gözlemi'ndeki tüm pariteleri tarar. Varsayılan: sadece uyarı." },
  { file: "KANAL3BAND.mq5", name: "KANAL3BAND (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL3BAND.mq5",
    description: "Centered YSR merkez çizgisi + 3 ATR bant çifti + 3 hareketli ortalama." },
  { file: "KANAL-CCI.mq5", name: "KANAL-CCI (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL-CCI.mq5",
    description: "CCI(34) + MA(21) mor çizgi, trend renk değişimi ve alarm." },
  { file: "KANAL-RSI-PANEL.mq5", name: "KANAL-RSI PANEL (gösterge)", filePath: "MQL5\\Indicators\\Jarvis\\KANAL-RSI-PANEL.mq5",
    description: "RSI(14) + M1…D1 çoklu zaman dilimi RSI paneli." },
] as const;

/** Kullanıcının strateji listesinde KANAL dosyaları yoksa ekler (mevcut kullanıcılar için de). */
export async function ensureKanalStrategies(userId: number) {
  const have = await db.select({ filePath: strategies.filePath }).from(strategies).where(eq(strategies.userId, userId));
  const paths = new Set(have.map((h) => h.filePath));
  for (const s of KANAL_SOURCES) {
    if (paths.has(s.filePath)) continue;
    let code = "";
    try {
      code = readFileSync(path.join(process.cwd(), "public", "agent", "mql5", s.file), "utf8");
    } catch {
      continue;
    }
    await db.insert(strategies).values({ userId, name: s.name, filePath: s.filePath, description: s.description, code, version: 1, status: "draft" });
  }
}
