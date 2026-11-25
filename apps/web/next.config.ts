import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/sdk"],
};

export default nextConfig;
