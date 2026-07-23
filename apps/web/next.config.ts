import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@bread-map/app-db",
    "@bread-map/contracts",
    "@bread-map/recommendation"
  ]
};

export default nextConfig;
