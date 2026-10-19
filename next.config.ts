import type { NextConfig } from "next";
import path from "node:path";

// The parts of supabase-js this app does not use (unused-services.ts).
const UNUSED = "./src/lib/supabase/unused-services.ts";
const UNUSED_SERVICES = [
  "@supabase/realtime-js",
  "@supabase/storage-js",
  "@supabase/functions-js",
];

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  webpack(config) {
    for (const name of UNUSED_SERVICES)
      config.resolve.alias[name + "$"] = path.resolve(UNUSED);
    return config;
  },
  turbopack: {
    resolveAlias: Object.fromEntries(
      UNUSED_SERVICES.map((name) => [name, UNUSED]),
    ),
  },
};
export default nextConfig;
