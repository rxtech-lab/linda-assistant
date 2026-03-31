import { defineConfig } from "@playwright/test";
import path from "path";

const dbPath = path.resolve(__dirname, "e2e-test.db");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 4,
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
      testIgnore: "**/mem0.spec.ts",
    },
    {
      name: "mem0",
      testMatch: "**/mem0.spec.ts",
      use: { baseURL: "http://localhost:8000" },
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
      REDIS_URL: "redis://localhost:6379",
      AWS_ACCESS_KEY_ID: "minioadmin",
      AWS_SECRET_ACCESS_KEY: "minioadmin",
      AWS_REGION: "us-east-1",
      S3_API_URL: "http://localhost:9000",
      S3_BUCKET_NAME: "e2e-test",
      S3_PUBLIC_URL: "http://localhost:9000/e2e-test",
      CELERY_BASE_URL: "http://localhost:8099",
      CELERY_ADMIN_KEY: "e2e-celery-admin-key",
      E2E_MCP_URL: "http://localhost:8098",
    },
  },
});
