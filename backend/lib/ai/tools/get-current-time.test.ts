import { describe, test, expect, mock, beforeEach } from "bun:test";

type SessionRow = { timezone: string | null };

const mockSessionRows = { rows: [] as SessionRow[] };

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(mockSessionRows.rows),
      }),
    }),
  },
}));

const { getCurrentTimeTool } = await import("./get-current-time");

type TimeOutput = {
  currentTime: string;
  timezone: string;
  iso: string;
};

async function runTool(
  tool: ReturnType<typeof getCurrentTimeTool>,
  input: { timezone?: string } = {},
): Promise<TimeOutput> {
  if (!tool.execute) throw new Error("tool.execute missing");
  const res = await tool.execute(input, {
    toolCallId: "test",
    messages: [],
  } as Parameters<NonNullable<typeof tool.execute>>[1]);
  return res as TimeOutput;
}

beforeEach(() => {
  mockSessionRows.rows = [];
});

describe("getCurrentTimeTool", () => {
  test("returns the explicit timezone parameter when provided", async () => {
    const toolInstance = getCurrentTimeTool(false);
    const result = await runTool(toolInstance, { timezone: "America/New_York" });
    expect(result.timezone).toBe("America/New_York");
    expect(typeof result.currentTime).toBe("string");
    expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("defaults to UTC when no timezone is provided and no session context exists", async () => {
    const toolInstance = getCurrentTimeTool(false);
    const result = await runTool(toolInstance);
    expect(result.timezone).toBe("UTC");
  });

  test("falls back to the chat session's timezone when no explicit timezone is passed", async () => {
    mockSessionRows.rows = [{ timezone: "Asia/Tokyo" }];
    const toolInstance = getCurrentTimeTool(false, "user-1", "session-1");
    const result = await runTool(toolInstance);
    expect(result.timezone).toBe("Asia/Tokyo");
  });

  test("explicit timezone parameter overrides the chat session's timezone", async () => {
    mockSessionRows.rows = [{ timezone: "Asia/Tokyo" }];
    const toolInstance = getCurrentTimeTool(false, "user-1", "session-1");
    const result = await runTool(toolInstance, { timezone: "Europe/London" });
    expect(result.timezone).toBe("Europe/London");
  });

  test("defaults to UTC when session has no stored timezone", async () => {
    mockSessionRows.rows = [{ timezone: null }];
    const toolInstance = getCurrentTimeTool(false, "user-1", "session-1");
    const result = await runTool(toolInstance);
    expect(result.timezone).toBe("UTC");
  });

  test("returns an ISO-8601 UTC timestamp regardless of the chosen timezone", async () => {
    const toolInstance = getCurrentTimeTool(false);
    const result = await runTool(toolInstance, { timezone: "Asia/Tokyo" });
    expect(result.iso.endsWith("Z")).toBe(true);
    const parsed = new Date(result.iso);
    expect(Number.isNaN(parsed.getTime())).toBe(false);
  });
});
