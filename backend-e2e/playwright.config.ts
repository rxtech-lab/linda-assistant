import { defineConfig } from "@playwright/test";
import "dotenv/config";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 60_000,
  retries: 3,
  workers: 4,
  snapshotPathTemplate: "{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
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
      name: "extension-search-tools",
      dependencies: ["auth-setup"],
      testMatch: /extension-search-tools\.spec\.ts/,
    },
    {
      name: "queue",
      dependencies: ["extension-search-tools"],
      testMatch: /queue\.spec\.ts/,
    },
    {
      name: "e2e",
      dependencies: ["extension-search-tools"],
      testMatch: /(?!queue\.|extension-search-tools\.).*\.spec\.ts/,
    },
  ],
});
