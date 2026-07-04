import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname
  },
  typescript: {
    // Type checking runs locally and in CI; skip during prod build to avoid OOM on small instances
    ignoreBuildErrors: true
  },
  async rewrites() {
    return [
      // Clean URL for the standalone Social Context KG live viewer (static bundle in public/).
      { source: "/social-kg-live", destination: "/social-kg-live/index.html" }
    ];
  }
};

export default nextConfig;
