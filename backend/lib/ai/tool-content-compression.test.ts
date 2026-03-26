import { describe, test, expect } from "bun:test";
import type { ModelMessage } from "ai";
import { truncateString, compressValue, compressToolCallContent } from "./tool-content-compression";

// ── Helpers ────────────────────────────────────────────────────────────

/** Generate a string with exactly N words */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

function textMsg(role: "user" | "assistant", text: string): ModelMessage {
  return { role, content: [{ type: "text", text }] } as unknown as ModelMessage;
}

function toolCallMsg(
  toolName: string,
  input: Record<string, unknown>,
  toolCallId = "tc-1",
): ModelMessage {
  return {
    role: "assistant",
    content: [{ type: "tool-call", toolCallId, toolName, input }],
  } as unknown as ModelMessage;
}

function toolResultMsg(
  toolName: string,
  output: unknown,
  toolCallId = "tc-1",
): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId, toolName, output }],
  } as unknown as ModelMessage;
}

// ── truncateString ────────────────────────────────────────────────────

describe("truncateString", () => {
  test("returns empty string unchanged", () => {
    expect(truncateString("")).toBe("");
  });

  test("returns short string unchanged", () => {
    const s = "hello world";
    expect(truncateString(s)).toBe(s);
  });

  test("returns string with exactly 300 words unchanged", () => {
    const s = words(300);
    expect(truncateString(s)).toBe(s);
  });

  test("truncates string with 301 words", () => {
    const s = words(301);
    const result = truncateString(s);
    const parts = result.split(" ... ");
    expect(parts).toHaveLength(2);
    expect(parts[0].split(/\s+/)).toHaveLength(200);
    expect(parts[1].split(/\s+/)).toHaveLength(200);
  });

  test("truncates string with 500 words", () => {
    const s = words(500);
    const result = truncateString(s);
    expect(result).toContain(" ... ");
    // First 200 words
    expect(result.startsWith("word0 word1")).toBe(true);
    // Last 200 words
    expect(result.endsWith("word498 word499")).toBe(true);
  });
});

// ── compressValue ─────────────────────────────────────────────────────

describe("compressValue", () => {
  test("returns number unchanged", () => {
    expect(compressValue(42)).toBe(42);
  });

  test("returns boolean unchanged", () => {
    expect(compressValue(true)).toBe(true);
  });

  test("returns null unchanged", () => {
    expect(compressValue(null)).toBeNull();
  });

  test("returns undefined unchanged", () => {
    expect(compressValue(undefined)).toBeUndefined();
  });

  test("returns short string unchanged", () => {
    expect(compressValue("short")).toBe("short");
  });

  test("truncates long string", () => {
    const long = words(400);
    const result = compressValue(long) as string;
    expect(result).toContain(" ... ");
    expect(result.split(/\s+/).length).toBeLessThan(410);
  });

  test("compresses strings in array", () => {
    const arr = ["short", words(400), "also short"];
    const result = compressValue(arr) as string[];
    expect(result[0]).toBe("short");
    expect(result[1]).toContain(" ... ");
    expect(result[2]).toBe("also short");
  });

  test("compresses string values in object", () => {
    const obj = { name: "short", body: words(400), count: 5 };
    const result = compressValue(obj) as Record<string, unknown>;
    expect(result.name).toBe("short");
    expect(result.body).toContain(" ... ");
    expect(result.count).toBe(5);
  });

  test("compresses nested object string values", () => {
    const obj = {
      outer: {
        inner: words(400),
        num: 10,
      },
      flag: true,
    };
    const result = compressValue(obj) as Record<string, Record<string, unknown>>;
    expect(result.outer.inner).toContain(" ... ");
    expect(result.outer.num).toBe(10);
    expect(result.flag).toBe(true);
  });

  test("compresses strings inside arrays inside objects", () => {
    const obj = { items: [words(400), "short"] };
    const result = compressValue(obj) as Record<string, string[]>;
    expect(result.items[0]).toContain(" ... ");
    expect(result.items[1]).toBe("short");
  });
});

// ── compressToolCallContent ───────────────────────────────────────────

describe("compressToolCallContent", () => {
  test("returns text messages unchanged by reference", () => {
    const msg = textMsg("user", "hello");
    const result = compressToolCallContent([msg]);
    expect(result[0]).toBe(msg); // referential equality
  });

  test("returns assistant text messages unchanged by reference", () => {
    const msg = textMsg("assistant", "I can help");
    const result = compressToolCallContent([msg]);
    expect(result[0]).toBe(msg);
  });

  test("does not mutate original messages", () => {
    const longText = words(400);
    const original = toolCallMsg("search", { query: longText });
    const originalInput = (
      (original.content as Record<string, unknown>[])[0] as Record<string, unknown>
    ).input;

    compressToolCallContent([original]);

    // Original should be untouched
    const afterInput = (
      (original.content as Record<string, unknown>[])[0] as Record<string, unknown>
    ).input;
    expect(afterInput).toBe(originalInput);
  });

  test("compresses long string in tool-call input", () => {
    const msg = toolCallMsg("search", { query: words(400), limit: 10 });
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    const input = part.input as Record<string, unknown>;
    expect(input.query).toContain(" ... ");
    expect(input.limit).toBe(10);
  });

  test("leaves short tool-call input unchanged", () => {
    const msg = toolCallMsg("search", { query: "short query", limit: 5 });
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    const input = part.input as Record<string, unknown>;
    expect(input.query).toBe("short query");
    expect(input.limit).toBe(5);
  });

  test("compresses nested string in tool-result output", () => {
    const output = { type: "json", value: { data: words(400), ok: true } };
    const msg = toolResultMsg("search", output);
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    const out = part.output as Record<string, Record<string, unknown>>;
    expect(out.value.data).toContain(" ... ");
    expect(out.value.ok).toBe(true);
    expect(out.type).toBe("json");
  });

  test("compresses raw object tool-result output", () => {
    const output = { message: words(400), status: 200 };
    const msg = toolResultMsg("api_call", output);
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    const out = part.output as Record<string, unknown>;
    expect(out.message).toContain(" ... ");
    expect(out.status).toBe(200);
  });

  test("handles mixed message types", () => {
    const msgs = [
      textMsg("user", "search for something"),
      toolCallMsg("search", { query: words(400) }),
      toolResultMsg("search", { type: "json", value: { data: words(400) } }),
      textMsg("assistant", "Here are the results"),
    ];
    const result = compressToolCallContent(msgs);

    // Text messages unchanged by reference
    expect(result[0]).toBe(msgs[0]);
    expect(result[3]).toBe(msgs[3]);

    // Tool messages compressed
    const callPart = (result[1].content as Record<string, unknown>[])[0];
    expect((callPart.input as Record<string, unknown>).query).toContain(" ... ");

    const resultPart = (result[2].content as Record<string, unknown>[])[0];
    const out = resultPart.output as Record<string, Record<string, unknown>>;
    expect(out.value.data).toContain(" ... ");
  });

  test("handles tool-call with null input", () => {
    const msg = {
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "tc-1", toolName: "ping", input: null }],
    } as unknown as ModelMessage;
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    expect(part.input).toBeNull();
  });

  test("handles tool-result with null output", () => {
    const msg = {
      role: "tool",
      content: [{ type: "tool-result", toolCallId: "tc-1", toolName: "ping", output: null }],
    } as unknown as ModelMessage;
    const result = compressToolCallContent([msg]);
    const part = (result[0].content as Record<string, unknown>[])[0];
    expect(part.output).toBeNull();
  });

  test("handles string content messages (non-array)", () => {
    const msg = { role: "user", content: "just a string" } as unknown as ModelMessage;
    const result = compressToolCallContent([msg]);
    expect(result[0]).toBe(msg);
  });
});
