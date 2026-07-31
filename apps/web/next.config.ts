import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: resolve(import.meta.dirname, "../..")
  },
  webpack(config, { isServer }) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };
    if (isServer) {
      config.externals.push({
        "better-sqlite3": "commonjs better-sqlite3"
      });
    }

    return config;
  },
  transpilePackages: [
    "@bread-map/app-db",
    "@bread-map/contracts",
    "@bread-map/recommendation"
  ]
};

export default nextConfig;
