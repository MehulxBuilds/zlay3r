import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/sdk", "@repo/ui"],
  experimental: { optimizePackageImports: ["@repo/ui"] },
};

export default nextConfig;
