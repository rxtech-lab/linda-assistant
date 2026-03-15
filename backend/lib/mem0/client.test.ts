import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { createMem0Client } from "./client";

// ── Mock fetch ─────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = mock(handler as unknown as typeof fetch) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── addMemories ────────────────────────────────────────────────────────

describe("addMemories", () => {
  test("sends correct request body", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    mockFetch(async (url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const client = createMem0Client();
    await client.addMemories([{ role: "user", content: "Hello" }], "user-123", {
      agentId: "agent-1",
      runId: "session-1",
    });

    expect(capturedBody).toBeDefined();
    expect(capturedBody?.user_id).toBe("user-123");
    expect(capturedBody?.agent_id).toBe("agent-1");
    expect(capturedBody?.run_id).toBe("session-1");
    expect(capturedBody?.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  test("does not throw on fetch failure", async () => {
    mockFetch(async () => {
      throw new Error("Network error");
    });

    const client = createMem0Client();
    // Should not throw
    await client.addMemories([{ role: "user", content: "Hello" }], "user-123");
  });
});

// ── searchMemories ─────────────────────────────────────────────────────

describe("searchMemories", () => {
  test("returns parsed memory strings", async () => {
    mockFetch(async () => {
      return new Response(
        JSON.stringify({
          results: [{ memory: "User likes formal emails" }, { memory: "Manager is Sarah" }],
        }),
        { status: 200 },
      );
    });

    const client = createMem0Client();
    const memories = await client.searchMemories("email", "user-123");
    expect(memories).toEqual(["User likes formal emails", "Manager is Sarah"]);
  });

  test("handles direct array response", async () => {
    mockFetch(async () => {
      return new Response(JSON.stringify([{ memory: "Fact 1" }, { memory: "Fact 2" }]), {
        status: 200,
      });
    });

    const client = createMem0Client();
    const memories = await client.searchMemories("test", "user-123");
    expect(memories).toEqual(["Fact 1", "Fact 2"]);
  });

  test("returns empty array on fetch failure", async () => {
    mockFetch(async () => {
      throw new Error("Network error");
    });

    const client = createMem0Client();
    const memories = await client.searchMemories("test", "user-123");
    expect(memories).toEqual([]);
  });

  test("returns empty array on non-ok response", async () => {
    mockFetch(async () => {
      return new Response("Internal Server Error", { status: 500 });
    });

    const client = createMem0Client();
    const memories = await client.searchMemories("test", "user-123");
    expect(memories).toEqual([]);
  });

  test("filters out entries without memory field", async () => {
    mockFetch(async () => {
      return new Response(
        JSON.stringify({
          results: [
            { memory: "Valid memory" },
            { something_else: "Not a memory" },
            { memory: null },
          ],
        }),
        { status: 200 },
      );
    });

    const client = createMem0Client();
    const memories = await client.searchMemories("test", "user-123");
    expect(memories).toEqual(["Valid memory"]);
  });

  test("includes agentId in request", async () => {
    let capturedBody: Record<string, unknown> | undefined;

    mockFetch(async (_url, init) => {
      capturedBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    });

    const client = createMem0Client();
    await client.searchMemories("test", "user-123", {
      agentId: "agent-1",
      limit: 5,
    });

    expect(capturedBody?.agent_id).toBe("agent-1");
    expect(capturedBody?.limit).toBe(5);
  });
});

// ── deleteMemories ─────────────────────────────────────────────────────

describe("deleteMemories", () => {
  test("sends DELETE request with correct params", async () => {
    let capturedUrl = "";

    mockFetch(async (url) => {
      capturedUrl = url as string;
      return new Response(JSON.stringify({ message: "deleted" }), {
        status: 200,
      });
    });

    const client = createMem0Client();
    await client.deleteMemories({
      userId: "user-123",
      agentId: "agent-1",
    });

    expect(capturedUrl).toContain("user_id=user-123");
    expect(capturedUrl).toContain("agent_id=agent-1");
  });

  test("does not throw on fetch failure", async () => {
    mockFetch(async () => {
      throw new Error("Network error");
    });

    const client = createMem0Client();
    // Should not throw
    await client.deleteMemories({ userId: "user-123" });
  });
});
