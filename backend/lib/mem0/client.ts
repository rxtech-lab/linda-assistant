/**
 * HTTP client for the mem0 sidecar (FastAPI server).
 *
 * All methods are non-fatal — on timeout or failure they log a warning
 * and return empty/void so the agent loop is never blocked by mem0.
 */

const MEM0_API_URL = process.env.MEM0_API_URL || "http://mem0:8000";
const TIMEOUT_MS = 30_000;

export interface Mem0Client {
  addMemories(
    messages: { role: string; content: string }[],
    userId: string,
    opts?: { agentId?: string; runId?: string },
  ): Promise<void>;

  searchMemories(
    query: string,
    userId: string,
    opts?: { agentId?: string; limit?: number },
  ): Promise<string[]>;

  deleteMemories(opts: { userId: string; agentId?: string; runId?: string }): Promise<void>;
}

/** POST helper with timeout. */
async function post(path: string, body: unknown): Promise<Response | undefined> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(`${MEM0_API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    console.warn(`[mem0] POST ${path} failed:`, err);
    return undefined;
  }
}

/** DELETE helper with timeout. */
async function del(path: string, params: Record<string, string>): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const qs = new URLSearchParams(params).toString();
    await fetch(`${MEM0_API_URL}${path}?${qs}`, {
      method: "DELETE",
      signal: controller.signal,
    });
    clearTimeout(timer);
  } catch (err) {
    console.warn(`[mem0] DELETE ${path} failed:`, err);
  }
}

export function createMem0Client(): Mem0Client {
  return {
    async addMemories(messages, userId, opts) {
      const body: Record<string, unknown> = { messages, user_id: userId };
      if (opts?.agentId) body.agent_id = opts.agentId;
      if (opts?.runId) body.run_id = opts.runId;
      await post("/memories", body);
    },

    async searchMemories(query, userId, opts) {
      const body: Record<string, unknown> = {
        query,
        user_id: userId,
        limit: opts?.limit ?? 10,
      };
      if (opts?.agentId) body.agent_id = opts.agentId;

      const res = await post("/search", body);
      if (!res?.ok) return [];

      try {
        const data = await res.json();
        // mem0 returns { results: [{ memory: "...", ... }] }
        if (Array.isArray(data?.results)) {
          return data.results
            .map((r: Record<string, unknown>) => r.memory as string | undefined)
            .filter((m: string | undefined): m is string => Boolean(m));
        }
        // Direct array fallback
        if (Array.isArray(data)) {
          return data
            .map((r: Record<string, unknown>) => r.memory as string | undefined)
            .filter((m: string | undefined): m is string => Boolean(m));
        }
        return [];
      } catch {
        return [];
      }
    },

    async deleteMemories(opts) {
      const params: Record<string, string> = { user_id: opts.userId };
      if (opts.agentId) params.agent_id = opts.agentId;
      if (opts.runId) params.run_id = opts.runId;
      await del("/memories", params);
    },
  };
}
