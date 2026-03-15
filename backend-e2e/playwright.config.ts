import { defineConfig } from "@playwright/test";
import "dotenv/config";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 60_000,
  retries: 4,
  workers: 4,
  webServer: {
    command: "bun oauth-server.ts",
    url: "http://localhost:3001/health",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "queue",
      dependencies: ["auth-setup"],
      testMatch: /queue\.spec\.ts/,
    },
    {
      name: "e2e",
      dependencies: ["queue"],
      testMatch: /(?!queue\.).*\.spec\.ts/,
    },
  ],
});
