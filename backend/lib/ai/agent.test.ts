import { describe, test, expect } from "bun:test";
import type { ModelMessage } from "ai";
import { buildSystemPrompt, cleanMessagesForModel } from "./agent";

const today = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const dateSuffix = `\nToday's date is ${today}.`;
const documentGuidance = `\nWhen your response would be very long (e.g., reports, analyses, comprehensive guides), or when the user explicitly asks for a document/report, use the create_document tool instead of writing it inline. Always prefer markdown format unless the user specifically requests HTML. Do NOT include the title as a heading in the document content — the title is displayed separately by the viewer. After creating a document, do NOT repeat the document content in your response — just confirm you created it and provide a brief summary of what it contains.`;
const suffix = `${dateSuffix}${documentGuidance}`;

describe("buildSystemPrompt", () => {
  test("returns generic prompt when no assignee", () => {
    expect(buildSystemPrompt(null)).toBe(
      `You are a helpful personal assistant.${suffix}`,
    );
    expect(buildSystemPrompt(undefined)).toBe(
      `You are a helpful personal assistant.${suffix}`,
    );
  });

  test("uses assignee name when no personality is set", () => {
    expect(buildSystemPrompt({ name: "Linda", personality: null })).toBe(
      `You are Linda, a helpful personal assistant.${suffix}`,
    );
  });

  test("uses personality when set", () => {
    const personality = "You are a sarcastic AI named Bob who loves puns.";
    expect(buildSystemPrompt({ name: "Bob", personality })).toBe(
      `${personality}${suffix}`,
    );
  });

  test("uses personality even when it differs from name", () => {
    const personality = "Act as a formal business assistant.";
    expect(buildSystemPrompt({ name: "Linda", personality })).toBe(
      `${personality}${suffix}`,
    );
  });
});

// Helper to create typed messages for tests
function msg(role: string, content: unknown[]): ModelMessage {
  return { id: crypto.randomUUID(), role, content } as unknown as ModelMessage;
}

describe("cleanMessagesForModel", () => {
  test("passes through complete tool-call/tool-result pairs unchanged", () => {
    const messages = [
      msg("user", [{ type: "text", text: "hello" }]),
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "my_tool", input: {} },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "my_tool",
          output: { type: "json", value: { ok: true } },
        },
      ]),
      msg("assistant", [{ type: "text", text: "done" }]),
    ];

    const result = cleanMessagesForModel(messages);
    const toolResults = result.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[]).filter((p) => p.type === "tool-result")
        : [],
    );
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0].output as Record<string, unknown>).type).toBe("json");
  });

  test("injects missing tool-result immediately after assistant message", () => {
    const messages = [
      msg("user", [{ type: "text", text: "send email" }]),
      msg("assistant", [
        {
          type: "tool-call",
          toolCallId: "tc_orphan",
          toolName: "send_email",
          input: { to: "a@b.com" },
        },
        {
          type: "tool-approval-request",
          approvalId: "ap1",
          toolCallId: "tc_orphan",
        },
      ]),
    ];

    const result = cleanMessagesForModel(messages);

    // Should have 3 messages: user, assistant (approval-request stripped), injected tool-result
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("tool");

    const injectedParts = result[2].content as Record<string, unknown>[];
    expect(injectedParts[0].type).toBe("tool-result");
    expect(injectedParts[0].toolCallId).toBe("tc_orphan");
    expect(injectedParts[0].toolName).toBe("send_email");
    expect((injectedParts[0].output as Record<string, unknown>).type).toBe("error-text");
  });

  test("injects results for multiple orphaned tool-calls in one assistant message", () => {
    const messages = [
      msg("user", [{ type: "text", text: "do stuff" }]),
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "tool_a", input: {} },
        { type: "tool-call", toolCallId: "tc2", toolName: "tool_b", input: {} },
      ]),
    ];

    const result = cleanMessagesForModel(messages);

    // user + assistant + 2 injected tool-results
    expect(result).toHaveLength(4);
    expect(result[2].role).toBe("tool");
    expect(result[3].role).toBe("tool");

    const ids = [result[2], result[3]].map(
      (m) => ((m.content as Record<string, unknown>[])[0] as Record<string, unknown>).toolCallId,
    );
    expect(ids).toContain("tc1");
    expect(ids).toContain("tc2");
  });

  test("does not duplicate tool-results that already exist", () => {
    const messages = [
      msg("user", [{ type: "text", text: "hello" }]),
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "my_tool", input: {} },
        { type: "tool-call", toolCallId: "tc2", toolName: "other_tool", input: {} },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "my_tool",
          output: { type: "json", value: "ok" },
        },
      ]),
    ];

    const result = cleanMessagesForModel(messages);

    const toolResults = result.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[]).filter((p) => p.type === "tool-result")
        : [],
    );
    // tc1 already has result, only tc2 should be injected
    expect(toolResults).toHaveLength(2);

    const injected = toolResults.find((p) => p.toolCallId === "tc2");
    expect(injected).toBeDefined();
    expect((injected!.output as Record<string, unknown>).type).toBe("error-text");
  });

  test("strips tool-approval-request parts from assistant messages", () => {
    const messages = [
      msg("user", [{ type: "text", text: "go" }]),
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "send_email", input: {} },
        { type: "tool-approval-request", approvalId: "ap1", toolCallId: "tc1" },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "send_email",
          output: { type: "json", value: "sent" },
        },
      ]),
    ];

    const result = cleanMessagesForModel(messages);
    const assistantParts = result[1].content as Record<string, unknown>[];
    expect(assistantParts).toHaveLength(1);
    expect(assistantParts[0].type).toBe("tool-call");
  });

  test("removes custom annotations from content parts", () => {
    const messages = [
      msg("assistant", [
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "my_tool",
          input: {},
          confirmation: { id: "c1", status: "confirmed" },
          error: "some error",
          approveStatus: "auto-approved",
        },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "my_tool",
          output: { ok: true },
          approveStatus: "auto-approved",
        },
      ]),
    ];

    const result = cleanMessagesForModel(messages);
    const toolCallPart = (result[0].content as Record<string, unknown>[])[0];
    expect(toolCallPart.confirmation).toBeUndefined();
    expect(toolCallPart.error).toBeUndefined();
    expect(toolCallPart.approveStatus).toBeUndefined();
  });

  test("drops tool-approval-response messages entirely", () => {
    const messages = [
      msg("user", [{ type: "text", text: "yes" }]),
      msg("tool", [{ type: "tool-approval-response", toolCallId: "tc1", approved: true }]),
      msg("assistant", [{ type: "text", text: "ok" }]),
    ];

    const result = cleanMessagesForModel(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  test("handles mix of resolved and unresolved tool-calls across messages", () => {
    const messages = [
      msg("user", [{ type: "text", text: "do both" }]),
      // First step: tool-call with result
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "create_doc", input: {} },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc1",
          toolName: "create_doc",
          output: { type: "json", value: { id: "doc1" } },
        },
      ]),
      // Second step: tool-call without result (orphaned)
      msg("assistant", [
        {
          type: "tool-call",
          toolCallId: "tc2",
          toolName: "send_email",
          input: { to: "a@b.com" },
          confirmation: { id: "c1", status: "confirmed" },
        },
        { type: "tool-approval-request", approvalId: "ap1", toolCallId: "tc2" },
      ]),
    ];

    const result = cleanMessagesForModel(messages);

    // user + assistant(tc1) + tool(tc1 result) + assistant(tc2, cleaned) + tool(tc2 injected)
    expect(result).toHaveLength(5);
    expect(result[3].role).toBe("assistant");
    expect(result[4].role).toBe("tool");

    const injectedParts = result[4].content as Record<string, unknown>[];
    expect(injectedParts[0].toolCallId).toBe("tc2");
    expect(injectedParts[0].toolName).toBe("send_email");
  });
});
