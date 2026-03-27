#!/usr/bin/env bun
/**
 * Standalone MCP mock HTTP server — spawned by global-setup.ts.
 * Exposes test tools (echo, get_weather) for e2e extension testing.
 */
import { startMcpMock } from "./mcp-mock";

const port = Number(process.env.MCP_MOCK_PORT ?? 8098);

const mock = await startMcpMock(port);
process.stdout.write(`mcp-mock-ready:${mock.port}\n`);

process.on("SIGTERM", async () => {
  await mock.stop();
  process.exit(0);
});
