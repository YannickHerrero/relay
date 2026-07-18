import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.RELAY_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@relay/db", "@relay/domain"],
  experimental: {
    serverSourceMaps: true,
  },
};

export default nextConfig;
