#!/usr/bin/env bun
/**
 * Standalone Celery mock HTTP server — spawned by global-setup.ts.
 * Records schedule API calls and exposes control endpoints for tests.
 */
import { startCeleryMock } from "./celery-mock";

const port = Number(process.env.CELERY_MOCK_PORT ?? 8099);

const mock = await startCeleryMock(port);
process.stdout.write(`celery-mock-ready:${mock.port}\n`);

process.on("SIGTERM", async () => {
  await mock.stop();
  process.exit(0);
});
