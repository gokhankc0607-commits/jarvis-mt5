import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite WASM/veri dosyalarını paketlemeden node_modules'tan yükle
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
