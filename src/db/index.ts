import path from "path";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "fs";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import type { PGlite as PGliteT } from "@electric-sql/pglite";
import { Pool } from "pg";
import { BOOTSTRAP_SQL, MIGRATION_SQL } from "./bootstrap-sql";

/**
 * Veritabanı seçimi (DATABASE_URL):
 *  - "postgres://..." / "postgresql://..."      -> harici PostgreSQL sunucusu
 *  - boş / "pglite" / "pglite:./data/jarvis.db.tgz" -> GÖMÜLÜ PostgreSQL (PGlite)
 *
 * Gömülü mod, Windows'ta güvenilirlik için PGlite'ı BELLEKTE çalıştırır ve tüm veritabanını
 * tek bir sıkıştırılmış dosyaya atomik olarak kaydeder (tmp -> rename). Böylece
 * klasör tabanlı depolamanın bozulma / "RuntimeError: Aborted()" sorunları yaşanmaz.
 * Bağlantı ilk sorguda açılır; `next build` sırasında veritabanına dokunulmaz.
 */
const url = (process.env.DATABASE_URL ?? "").trim();
const useServer = /^postgres(ql)?:\/\//i.test(url);

type DB = NodePgDatabase<Record<string, never>>;

const g = globalThis as typeof globalThis & {
  __jarvisDb?: DB;
  __jarvisPool?: Pool;
  __jarvisPglite?: PGliteT;
};

function snapshotPath() {
  let raw = url.replace(/^pglite:?/i, "").trim() || "data/jarvis.db.tgz";
  // Eski sürüm klasör yolu verdiyse (data/jarvis-db) dosya adına çevir
  if (!/\.(tgz|tar\.gz|tar)$/i.test(raw)) raw = raw.replace(/[\\/]+$/, "") + ".db.tgz";
  return path.resolve(process.cwd(), raw);
}

function createPglite(): DB {
  const { PGlite } = require("@electric-sql/pglite") as typeof import("@electric-sql/pglite");
  const file = snapshotPath();
  const lock = file + ".lock";
  mkdirSync(path.dirname(file), { recursive: true });

  // --- Tek örnek kilidi: aynı veritabanını iki panel açarsa veri kaybını önle
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8")) || 0;
    let alive = false;
    try {
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        alive = true;
      }
    } catch {}
    if (alive) {
      console.warn(
        `[db] UYARI: kilit dosyası başka bir işlemi gösteriyor (PID ${pid}). Aynı anda iki panel açıksa birini kapatın.`
      );
    }
  }
  writeFileSync(lock, String(process.pid));

  // --- Anlık görüntüyü yükle (bozuksa kenara al ve temiz başla)
  let blob: Blob | undefined;
  if (existsSync(file)) {
    try {
      copyFileSync(file, file + ".bak"); // önceki oturumun yedeği
      blob = new Blob([readFileSync(file)]);
    } catch (e) {
      console.error("[db] anlık görüntü okunamadı:", e);
    }
  }
  let client: PGliteT;
  try {
    client = new PGlite(blob ? { loadDataDir: blob } : undefined);
  } catch (e) {
    console.error("[db] anlık görüntü açılamadı, temiz veritabanı ile başlanıyor:", e);
    client = new PGlite();
  }

  let ready: Promise<void> = (async () => {
    try {
      await client.waitReady;
    } catch (e) {
      if (!blob) throw e;
      const bad = file.replace(/\.tgz$/i, "") + `.bozuk-${Date.now()}.tgz`;
      try { renameSync(file, bad); } catch {}
      console.error(`[db] anlık görüntü bozuk -> ${bad}. Temiz veritabanı oluşturuluyor.`);
      client = new PGlite();
      g.__jarvisPglite = client;
      await client.waitReady;
    }
    await client.exec(BOOTSTRAP_SQL.join(";\n"));
    for (const q of MIGRATION_SQL) await client.exec(q);
    console.log(`[db] Gömülü veritabanı hazır: ${file}`);
  })();
  ready.catch((e) => console.error("[db] başlatma hatası:", e));

  // --- Değişiklikleri izle ve atomik olarak kaydet
  let dirty = false;
  let saving = false;
  const isWrite = (q: unknown) => typeof q === "string" && !/^\s*(select|show|with\s+[\s\S]*?\)\s*select)\b/i.test(q);

  const save = async () => {
    if (!dirty || saving) return;
    saving = true;
    dirty = false;
    try {
      const f = await client.dumpDataDir("gzip");
      const buf = Buffer.from(await f.arrayBuffer());
      const tmp = file + ".tmp";
      writeFileSync(tmp, buf);
      renameSync(tmp, file);
    } catch (e) {
      dirty = true;
      console.error("[db] kaydetme hatası:", e);
    } finally {
      saving = false;
    }
  };
  setInterval(save, 4000).unref();

  const shutdown = async () => {
    await save().catch(() => {});
    try { unlinkSync(lock); } catch {}
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] as const) {
    process.once(sig, () => {
      shutdown().finally(() => process.exit(0));
    });
  }
  process.once("beforeExit", () => void shutdown());

  // Sorgu fonksiyonlarını sar: önce hazır olmayı bekle, yazma sorgularında kirli işaretle
  const proxy = new Proxy({} as PGliteT, {
    get(_t, prop) {
      const target = g.__jarvisPglite ?? client;
      const v = Reflect.get(target, prop, target);
      if (typeof v !== "function") return v;
      if (prop === "query" || prop === "exec" || prop === "transaction") {
        return async (...args: unknown[]) => {
          await ready;
          const c = g.__jarvisPglite ?? client;
          if (prop === "transaction" || isWrite(args[0])) dirty = true;
          return (Reflect.get(c, prop, c) as (...a: unknown[]) => unknown).apply(c, args);
        };
      }
      return v.bind(target);
    },
  });
  g.__jarvisPglite = client;
  // ready'yi globalde tut (client değişebilir)
  ready = ready.then(() => { g.__jarvisPglite = client; });
  return drizzlePglite(proxy) as unknown as DB;
}

function createServer(): DB {
  const fresh = !g.__jarvisPool;
  const pool = g.__jarvisPool ?? new Pool({ connectionString: url });
  g.__jarvisPool = pool;
  if (fresh) {
    // Harici PostgreSQL: boş bir veritabanında da çalışsın diye şema (BOOTSTRAP, idempotent CREATE IF NOT EXISTS)
    // ve ardından sütun geçişleri (MIGRATION) uygulanır. İlk sorgular bu iş bitene kadar bekletilir;
    // böylece "relation users does not exist" türü yarış hataları oluşmaz.
    const ready = (async () => {
      for (const q of BOOTSTRAP_SQL) await pool.query(q).catch((e) => console.error("[db] şema uyarısı:", String(e.message).slice(0, 120)));
      for (const q of MIGRATION_SQL) await pool.query(q).catch((e) => console.error("[db] geçiş uyarısı:", String(e.message).slice(0, 120)));
      console.log("[db] Harici PostgreSQL hazır");
    })();
    ready.catch((e) => console.error("[db] başlatma hatası:", e));
    const gated = new Proxy(pool, {
      get(t, prop) {
        const v = Reflect.get(t, prop, t);
        if (typeof v !== "function") return v;
        if (prop === "query" || prop === "connect") {
          return async (...args: unknown[]) => {
            await ready;
            return (v as (...a: unknown[]) => unknown).apply(t, args);
          };
        }
        return v.bind(t);
      },
    });
    return drizzle(gated);
  }
  return drizzle(pool);
}

function createDb(): DB {
  return useServer ? createServer() : createPglite();
}

function getDb(): DB {
  if (!g.__jarvisDb) g.__jarvisDb = createDb();
  return g.__jarvisDb;
}

/** Tembel (lazy) veritabanı: ilk kullanımda bağlanır. */
export const db = new Proxy({} as DB, {
  get(_t, prop) {
    const real = getDb();
    const v = Reflect.get(real, prop, real);
    return typeof v === "function" ? v.bind(real) : v;
  },
});

export const dbMode = useServer ? "postgres" : "pglite";
