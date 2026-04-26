import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "amqplib", "canvas", "konva"],
  allowedDevOrigins: ["dev.bardplus.dev"],
  output: "standalone",
  async redirects() {
    return [
      {
        source: "/b/:id",
        destination: "/briefing/:id",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
