import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client"],
  allowedDevOrigins: ["dev.bardplus.dev"],
  output: "standalone",
};

export default nextConfig;
