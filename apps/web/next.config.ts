import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: resolve(import.meta.dirname, "../..")
  },
  webpack(config) {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"]
    };

    return config;
  },
  transpilePackages: [
    "@bread-map/app-db",
    "@bread-map/contracts",
    "@bread-map/recommendation"
  ]
};

export default nextConfig;
