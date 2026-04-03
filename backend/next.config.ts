import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "amqplib", "canvas", "konva"],
  allowedDevOrigins: ["dev.bardplus.dev"],
  output: "standalone",
};

export default nextConfig;
