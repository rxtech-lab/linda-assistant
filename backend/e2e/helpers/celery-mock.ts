import http from "node:http";

export interface CeleryCall {
  method: string;
  path: string;
  body: unknown;
}

export interface CeleryMock {
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start a mock HTTP server that records Celery schedule API calls.
 * Exposes control endpoints for cross-process test inspection:
 *   GET  /_calls  → returns JSON array of recorded calls
 *   DELETE /_calls → clears recorded calls, returns { ok: true }
 * All other routes return 200 OK and record the call.
 */
export async function startCeleryMock(port = 8099): Promise<CeleryMock> {
  const calls: CeleryCall[] = [];

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "/";

      // Control endpoint: inspect calls
      if (url === "/_calls" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(calls));
        return;
      }

      // Control endpoint: reset calls
      if (url === "/_calls" && req.method === "DELETE") {
        calls.splice(0, calls.length);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      // Record all other requests
      let parsed: unknown = null;
      try {
        parsed = body ? JSON.parse(body) : null;
      } catch {
        /* ignore parse errors */
      }
      calls.push({ method: req.method ?? "GET", path: url, body: parsed });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, resolve));

  return {
    port,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
