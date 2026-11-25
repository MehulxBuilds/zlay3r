import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "node:path";

// Only NEXT_PUBLIC_* values referenced by client code enter the browser bundle.
config({ path: resolve(__dirname, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/sdk", "@repo/ui"],
  experimental: { optimizePackageImports: ["@repo/ui"] },
};

export default nextConfig;
