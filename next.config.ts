import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Existing photo uploads can total 40 MB and Phase 8 adds a 5 MB raw
    // GPX/KML file. Server Actions default to 1 MB, so align the framework
    // limit with the form-level validation in src/lib/storage.ts.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
