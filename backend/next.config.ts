import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "amqplib"],
  allowedDevOrigins: ["dev.bardplus.dev"],
  output: "standalone",
};

export default nextConfig;
