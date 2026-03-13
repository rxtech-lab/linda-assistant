import { defineConfig } from "@playwright/test";
import "dotenv/config";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
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
      name: "e2e",
      dependencies: ["auth-setup"],
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
