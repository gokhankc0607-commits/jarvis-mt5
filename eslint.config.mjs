import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextCoreWebVitals,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/agent/**", "drizzle/**"]),
  {
    rules: {
      // React Compiler önerileri: mevcut veri-yükleme deseni (effect içinde setState) için uyarı olarak bırakıldı,
      // zamanla düzeltilecek; derlemeyi/CI'ı kırmasın.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
