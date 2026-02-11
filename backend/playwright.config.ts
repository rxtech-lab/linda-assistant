import { defineConfig } from "@playwright/test";
import path from "path";

const dbPath = path.resolve(__dirname, "e2e-test.db");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: "http://localhost:3001",
    extraHTTPHeaders: {
      authorization: "Bearer e2e-test-token",
    },
  },
  projects: [
    {
      name: "api",
      testMatch: "**/*.spec.ts",
    },
  ],
  webServer: {
    command: "bun next dev --port 3001",
    url: "http://localhost:3001",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      IS_E2E: "true",
      TURSO_DATABASE_URL: `file:${dbPath}`,
      RABBITMQ_URL: "amqp://linda:linda@localhost:5672",
      UPSTASH_REDIS_REST_URL: "http://localhost:8079",
      UPSTASH_REDIS_REST_TOKEN: "token",
    },
  },
});
