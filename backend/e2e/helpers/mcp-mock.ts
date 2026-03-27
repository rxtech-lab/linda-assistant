import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { z } from "zod";

export interface McpMock {
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start a mock MCP server for e2e testing.
 * Exposes two test tools: `echo` and `get_weather`.
 * Uses the Streamable HTTP transport compatible with @ai-sdk/mcp HTTP client.
 */
export async function startMcpMock(port = 8098): Promise<McpMock> {
  // Track active sessions so multi-request flows (initialize → tools/list) work
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  function createSessionServer(): McpServer {
    const server = new McpServer({
      name: "e2e-mock-mcp",
      version: "1.0.0",
    });

    // Simple echo tool — returns the input message
    // @ts-expect-error -- MCP SDK overload causes TS2589 with Zod; runtime works fine
    server.tool(
      "echo",
      "Returns the input message as-is",
      { message: z.string() },
      async (args: { message: string }) => ({
        content: [{ type: "text" as const, text: args.message }],
      }),
    );

    // Fake weather tool — returns deterministic weather data
    server.tool(
      "get_weather",
      "Returns fake weather data for a city",
      { city: z.string() },
      async (args: { city: string }) => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ city: args.city, temp: 22, condition: "sunny" }),
          },
        ],
      }),
    );

    return server;
  }

  const httpServer = http.createServer(async (req, res) => {
    // The @ai-sdk/mcp HTTP client tries GET for inbound SSE — 405 makes it skip gracefully
    if (req.method === "GET") {
      res.writeHead(405).end();
      return;
    }
    if (req.method === "DELETE") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.close();
        sessions.delete(sessionId);
      }
      res.writeHead(200).end();
      return;
    }

    // POST: route to existing session or create a new one
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — reuse transport
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      return;
    }

    // New session — create server + transport pair
    const newServer = createSessionServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    await newServer.connect(transport);

    // After handling, capture the session ID assigned by the transport
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    await transport.handleRequest(req, res);

    // Store session for subsequent requests
    if (transport.sessionId) {
      sessions.set(transport.sessionId, { server: newServer, transport });
    }
  });

  await new Promise<void>((resolve) => httpServer.listen(port, resolve));

  return {
    port,
    stop: async () => {
      // Close all active sessions
      for (const [, session] of sessions) {
        await session.transport.close();
      }
      sessions.clear();
      await new Promise<void>((resolve, reject) =>
        httpServer.close((err) => (err ? reject(err) : resolve())),
      );
    },
  };
}
