import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname
  },
  typescript: {
    // Type checking runs locally and in CI; skip during prod build to avoid OOM on small instances
    ignoreBuildErrors: true
  }
};

export default nextConfig;
