import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @duckdb/node-api is a native addon: it must stay a real Node require,
  // never be bundled into the server chunk.
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
