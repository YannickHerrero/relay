import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["@relay/db", "@relay/domain"],
  experimental: {
    serverSourceMaps: true,
  },
};

export default nextConfig;
