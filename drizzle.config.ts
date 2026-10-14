import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Harici PostgreSQL kullananlar için: `npx drizzle-kit push` bağlantıyı .env.local / .env'den okur.
// (Gömülü PGlite modunda drizzle-kit gerekmez; şema ilk açılışta otomatik oluşturulur.)
config({ path: ".env.local" });
config();

const url = (process.env.DATABASE_URL ?? "").trim();
if (!/^postgres(ql)?:\/\//i.test(url)) {
  throw new Error("drizzle-kit yalnızca harici PostgreSQL ile kullanılır: .env.local içinde DATABASE_URL=postgresql://... tanımlayın.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
