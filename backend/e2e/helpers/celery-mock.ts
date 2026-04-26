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
  // In-memory schedule store keyed by task_id so GET /schedules/:id can mirror
  // what the real Celery service returns. Survives /_calls DELETE — tests
  // that want to wipe it use the dedicated /_schedules control endpoint.
  const schedules = new Map<
    string,
    { task_id: string; cron_schedule: string; timezone: string | null }
  >();

  const scheduleMatch = (url: string) => {
    const m = url.match(/^\/schedules\/([^/?]+)$/);
    return m ? m[1] : null;
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = req.url ?? "/";
      const method = req.method ?? "GET";

      // Control endpoint: inspect calls
      if (url === "/_calls" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(calls));
        return;
      }

      // Control endpoint: reset calls only. Schedule store is intentionally
      // preserved so PUT/DELETE against previously-registered tasks keep
      // working across resets.
      if (url === "/_calls" && method === "DELETE") {
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
      calls.push({ method, path: url, body: parsed });

      // Handle GET /schedules/:id without returning the generic 200 OK below
      const taskId = scheduleMatch(url);
      if (taskId && method === "GET") {
        const stored = schedules.get(taskId);
        if (!stored) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Schedule not found" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stored));
        return;
      }

      // Track schedule state so GET can return a realistic view. POST/PUT
      // both upsert (matches RedBeat's save() behavior), DELETE removes.
      if (url === "/schedules" && method === "POST") {
        const b = (parsed as { task_id?: string; cron_schedule?: string; timezone?: string }) ?? {};
        if (b.task_id && b.cron_schedule) {
          schedules.set(b.task_id, {
            task_id: b.task_id,
            cron_schedule: b.cron_schedule,
            timezone: b.timezone ?? null,
          });
        }
      } else if (taskId) {
        if (method === "PUT") {
          const b = (parsed as { cron_schedule?: string; timezone?: string }) ?? {};
          if (b.cron_schedule) {
            schedules.set(taskId, {
              task_id: taskId,
              cron_schedule: b.cron_schedule,
              timezone: b.timezone ?? null,
            });
          }
        } else if (method === "DELETE") {
          schedules.delete(taskId);
        }
      }

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
