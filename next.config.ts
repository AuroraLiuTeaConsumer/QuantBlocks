import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prevent Next.js from bundling these Node.js-native packages.
  // They are required at runtime by the server, not bundled into the client.
  serverExternalPackages: ["ccxt", "pg"],
};

export default nextConfig;
