import { describe, test, expect } from "bun:test";
import type { ModelMessage } from "ai";
import { buildSystemPrompt, cleanMessagesForModel } from "./agent";

describe("buildSystemPrompt", () => {
  test("returns generic prompt when no assignee", () => {
    const result = buildSystemPrompt(null);
    expect(result).toContain("Today's date is");
    expect(buildSystemPrompt(undefined)).toBe(result);
  });

  test("uses assignee name when no personality is set", () => {
    const result = buildSystemPrompt({ name: "Linda", personality: null });
    expect(result).toStartWith("You are Linda, a helpful personal assistant.");
    expect(result).toContain("Today's date is");
  });

  test("uses personality when set", () => {
    const personality = "You are a sarcastic AI named Bob who loves puns.";
    const result = buildSystemPrompt({ name: "Bob", personality });
    expect(result).toStartWith(personality);
    expect(result).toContain("Today's date is");
  });

  test("uses personality even when it differs from name", () => {
    const personality = "Act as a formal business assistant.";
    const result = buildSystemPrompt({ name: "Linda", personality });
    expect(result).toStartWith(personality);
    expect(result).not.toContain("You are Linda");
  });

  test("includes tool guidance in all prompts", () => {
    const result = buildSystemPrompt(null);
    expect(result).toContain("create_document");
    expect(result).toContain("ask_question");
  });
});

// Helper to create typed messages for tests
function msg(role: string, content: unknown[]): ModelMessage {
  return { id: crypto.randomUUID(), role, content } as unknown as ModelMessage;
}

describe("cleanMessagesForModel", () => {
  test("passes through complete tool-call/tool-result pairs unchanged", async () => {
    const messages = [
      msg("user", [{ type: "text", text: "hello" }]),
      msg("assistant", [{ type: "tool-call", toolCallId: "tc1", toolName: "my_tool", input: {} }]),
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

    const result = await cleanMessagesForModel(messages);
    const toolResults = result.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[]).filter((p) => p.type === "tool-result")
        : [],
    );
    expect(toolResults).toHaveLength(1);
    expect((toolResults[0].output as Record<string, unknown>).type).toBe("json");
  });

  test("injects missing tool-result immediately after assistant message", async () => {
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

    const result = await cleanMessagesForModel(messages);

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

  test("injects results for multiple orphaned tool-calls in one assistant message", async () => {
    const messages = [
      msg("user", [{ type: "text", text: "do stuff" }]),
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc1", toolName: "tool_a", input: {} },
        { type: "tool-call", toolCallId: "tc2", toolName: "tool_b", input: {} },
      ]),
    ];

    const result = await cleanMessagesForModel(messages);

    // user + assistant + 1 tool message containing both injected results
    expect(result).toHaveLength(3);
    expect(result[2].role).toBe("tool");

    const parts = result[2].content as Record<string, unknown>[];
    expect(parts).toHaveLength(2);
    const ids = parts.map((p) => p.toolCallId);
    expect(ids).toContain("tc1");
    expect(ids).toContain("tc2");
  });

  test("does not duplicate tool-results that already exist", async () => {
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

    const result = await cleanMessagesForModel(messages);

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

  test("strips tool-approval-request parts from assistant messages", async () => {
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

    const result = await cleanMessagesForModel(messages);
    const assistantParts = result[1].content as Record<string, unknown>[];
    expect(assistantParts).toHaveLength(1);
    expect(assistantParts[0].type).toBe("tool-call");
  });

  test("removes custom annotations from content parts", async () => {
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

    const result = await cleanMessagesForModel(messages);
    const toolCallPart = (result[0].content as Record<string, unknown>[])[0];
    expect(toolCallPart.confirmation).toBeUndefined();
    expect(toolCallPart.error).toBeUndefined();
    expect(toolCallPart.approveStatus).toBeUndefined();
  });

  test("drops tool-approval-response messages entirely", async () => {
    const messages = [
      msg("user", [{ type: "text", text: "yes" }]),
      msg("tool", [{ type: "tool-approval-response", toolCallId: "tc1", approved: true }]),
      msg("assistant", [{ type: "text", text: "ok" }]),
    ];

    const result = await cleanMessagesForModel(messages);
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
  });

  test("handles mix of resolved and unresolved tool-calls across messages", async () => {
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

    const result = await cleanMessagesForModel(messages);

    // user + assistant(tc1) + tool(tc1 result) + assistant(tc2, cleaned) + tool(tc2 injected)
    expect(result).toHaveLength(5);
    expect(result[3].role).toBe("assistant");
    expect(result[4].role).toBe("tool");

    const injectedParts = result[4].content as Record<string, unknown>[];
    expect(injectedParts[0].toolCallId).toBe("tc2");
    expect(injectedParts[0].toolName).toBe("send_email");
  });

  test("drops orphan tool-results whose tool-call was compacted away", async () => {
    // Simulate post-compaction state: summary replaces old messages including
    // the assistant tool-call, but the tool-result remains as a non-compacted message.
    const messages = [
      msg("user", [
        {
          type: "text",
          text: "[CONVERSATION SUMMARY]\nUser asked to send email. Tool send_email was called.\n[END SUMMARY]",
        },
      ]),
      // Orphan tool-result: its tool-call was compacted into the summary above
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc_compacted",
          toolName: "send_email",
          output: { type: "json", value: { sent: true } },
        },
      ]),
      msg("user", [{ type: "text", text: "What happened next?" }]),
      msg("assistant", [{ type: "text", text: "The email was sent successfully." }]),
    ];

    const result = await cleanMessagesForModel(messages);

    // The orphan tool-result should be dropped, not appended
    const allToolResults = result.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[]).filter((p) => p.type === "tool-result")
        : [],
    );
    expect(allToolResults).toHaveLength(0);

    // Should have: summary, user, assistant (3 messages, tool msg dropped)
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe("user"); // summary
    expect(result[1].role).toBe("user"); // follow-up
    expect(result[2].role).toBe("assistant");
  });

  test("drops orphan tool-results while keeping valid tool-call/result pairs", async () => {
    const messages = [
      msg("user", [{ type: "text", text: "[CONVERSATION SUMMARY]\n..." }]),
      // Orphan tool-result from compacted tool-call
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc_old",
          toolName: "search_emails",
          output: { type: "json", value: [] },
        },
      ]),
      // Valid tool-call/result pair
      msg("assistant", [
        { type: "tool-call", toolCallId: "tc_new", toolName: "create_task", input: { title: "x" } },
      ]),
      msg("tool", [
        {
          type: "tool-result",
          toolCallId: "tc_new",
          toolName: "create_task",
          output: { type: "json", value: { id: "t1" } },
        },
      ]),
      msg("assistant", [{ type: "text", text: "Task created." }]),
    ];

    const result = await cleanMessagesForModel(messages);

    const allToolResults = result.flatMap((m) =>
      Array.isArray(m.content)
        ? (m.content as Record<string, unknown>[]).filter((p) => p.type === "tool-result")
        : [],
    );
    // Only the valid tc_new result should remain
    expect(allToolResults).toHaveLength(1);
    expect(allToolResults[0].toolCallId).toBe("tc_new");
  });
});
