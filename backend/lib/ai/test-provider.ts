import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

const MOCK_USAGE = {
  inputTokens: {
    total: 10,
    noCache: 10,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
} as const;

interface MockStreamConfig {
  chunks: LanguageModelV3StreamPart[];
  chunkDelayInMs: number | null;
}

/** Helper to check if any user message in the conversation matches the given text exactly. */
function hasUserMessage(messages: unknown[], text: string): boolean {
  return messages.some(
    (m: any) =>
      m.role === "user" &&
      Array.isArray(m.content) &&
      m.content.some((c: any) => c.type === "text" && c.text === text),
  );
}

/** Helper to get the last assistant message text from the conversation. */
function getLastAssistantText(messages: unknown[]): string {
  const lastAssistant = [...messages]
    .reverse()
    .find((m: any) => m.role === "assistant");
  if (!lastAssistant) return "";
  const content = (lastAssistant as any).content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join(" ");
  }
  return typeof content === "string" ? content : "";
}

/** Generate ~1000 words of text for long output testing. */
function generateLongText(): string {
  const sentence =
    "The quick brown fox jumps over the lazy dog near the riverbank. ";
  const parts: string[] = [];
  for (let i = 0; i < 100; i++) {
    parts.push(`[${i + 1}] ${sentence}`);
  }
  return parts.join("");
}

function buildStreamChunks(
  messages: unknown[],
  availableTools?: Set<string>,
): MockStreamConfig {
  // Check for tool-result in prompt (resumed after confirmation or auto-confirm execution)
  const hasToolResult = messages.some(
    (m: any) =>
      m.role === "tool" &&
      Array.isArray(m.content) &&
      m.content.some((c: any) => c.type === "tool-result"),
  );

  if (hasToolResult) {
    // Check if this is a rejection (tool-result with error output type)
    const isRejection = messages.some(
      (m: any) =>
        m.role === "tool" &&
        Array.isArray(m.content) &&
        m.content.some(
          (c: any) =>
            c.type === "tool-result" &&
            typeof c.output === "object" &&
            c.output !== null &&
            (c.output.type === "error-text" ||
              c.output.type === "execution-denied"),
        ),
    );

    // Stateful: "test-tool-call-reject" rejection → "Wanna try again?"
    if (isRejection && hasUserMessage(messages, "test-tool-call-reject")) {
      return {
        chunks: [
          { type: "text-start", id: "text-1" },
          { type: "text-delta", id: "text-1", delta: "Wanna try again?" },
          { type: "text-end", id: "text-1" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: undefined },
            usage: MOCK_USAGE,
          },
        ],
        chunkDelayInMs: null,
      };
    }

    const text = isRejection
      ? "I understand, I won't do that."
      : "Email sent successfully.";

    return {
      chunks: [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: text },
        { type: "text-end", id: "text-1" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Get last user message text
  const lastUserMsg = [...messages]
    .reverse()
    .find((m: any) => m.role === "user");
  const lastText =
    lastUserMsg && Array.isArray((lastUserMsg as any).content)
      ? (lastUserMsg as any).content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text)
          .join(" ")
      : typeof (lastUserMsg as any)?.content === "string"
        ? (lastUserMsg as any).content
        : "";

  // Scenario: slow stream with many chunks (for stop-stream e2e testing)
  if (lastText.includes("[SLOW_STREAM]")) {
    const words =
      "The quick brown fox jumps over the lazy dog and keeps running across the field".split(
        " ",
      );
    const chunks: LanguageModelV3StreamPart[] = [
      { type: "text-start", id: "text-1" },
    ];
    for (const word of words) {
      chunks.push({ type: "text-delta", id: "text-1", delta: `${word} ` });
    }
    chunks.push({ type: "text-end", id: "text-1" });
    chunks.push({
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage: MOCK_USAGE,
    });
    return { chunks, chunkDelayInMs: 200 };
  }

  // Scenario: long output (~1000 words)
  if (lastText === "long-output-test-1") {
    const longText = generateLongText();
    console.log(
      "Generated long text for streaming:",
      longText.slice(0, 100) + "...",
    );
    const words = longText.split(" ");
    const chunks: LanguageModelV3StreamPart[] = [
      { type: "text-start", id: "text-1" },
    ];
    const CHUNK_SIZE = 50;
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE).join(" ") + " ";
      chunks.push({ type: "text-delta", id: "text-1", delta: chunk });
    }

    chunks.push({
      type: "text-delta",
      id: "text-1",
      delta: "[END OF LONG OUTPUT]",
    });
    chunks.push({ type: "text-end", id: "text-1" });
    chunks.push({
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage: MOCK_USAGE,
    });
    return { chunks, chunkDelayInMs: 20 };
  }

  // Scenario: send_email with document attachment (only if tool is available)
  if (
    lastText.includes("[TOOL:send_email_with_doc]") &&
    (!availableTools || availableTools.has("send_email"))
  ) {
    const input = JSON.stringify({
      to: "test@example.com",
      subject: "Test Email With Attachment",
      body: "<p>Please find the document attached.</p>",
      documentId: "e2e-test-doc",
    });
    return {
      chunks: [
        { type: "tool-input-start", id: "call-doc-1", toolName: "send_email" },
        { type: "tool-input-delta", id: "call-doc-1", delta: input },
        { type: "tool-input-end", id: "call-doc-1" },
        {
          type: "tool-call",
          toolCallId: "call-doc-1",
          toolName: "send_email",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Scenario: send_email tool call (only if tool is available)
  if (
    lastText.includes("[TOOL:send_email]") &&
    (!availableTools || availableTools.has("send_email"))
  ) {
    const input = JSON.stringify({
      to: "test@example.com",
      subject: "Test Email",
      body: "<p>Test body</p>",
    });
    return {
      chunks: [
        { type: "tool-input-start", id: "call-1", toolName: "send_email" },
        { type: "tool-input-delta", id: "call-1", delta: input },
        { type: "tool-input-end", id: "call-1" },
        {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "send_email",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Scenario: create_task tool call (only if tool is available)
  if (
    lastText.includes("[TOOL:create_task]") &&
    (!availableTools || availableTools.has("create_task"))
  ) {
    const input = JSON.stringify({
      title: "Test Task",
      description: "A test task created by the agent",
    });
    return {
      chunks: [
        { type: "tool-input-start", id: "call-2", toolName: "create_task" },
        { type: "tool-input-delta", id: "call-2", delta: input },
        { type: "tool-input-end", id: "call-2" },
        {
          type: "tool-call",
          toolCallId: "call-2",
          toolName: "create_task",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Scenario: update_task tool call (with non-existent id to trigger error)
  if (
    lastText.includes("[TOOL:update_task]") &&
    (!availableTools || availableTools.has("update_task"))
  ) {
    const input = JSON.stringify({
      taskId: "non-existent-id-12345",
      status: "finished",
    });
    return {
      chunks: [
        { type: "tool-input-start", id: "call-3", toolName: "update_task" },
        { type: "tool-input-delta", id: "call-3", delta: input },
        { type: "tool-input-end", id: "call-3" },
        {
          type: "tool-call",
          toolCallId: "call-3",
          toolName: "update_task",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Scenario: parallel tool calls (send_email + create_task)
  if (
    lastText.includes("[TOOL:parallel]") &&
    (!availableTools ||
      (availableTools.has("send_email") && availableTools.has("create_task")))
  ) {
    const emailInput = JSON.stringify({
      to: "test@example.com",
      subject: "Parallel Test Email",
      body: "<p>Parallel test body</p>",
    });
    const taskInput = JSON.stringify({
      title: "Parallel Test Task",
      description: "A task created in parallel with an email",
    });
    return {
      chunks: [
        {
          type: "tool-input-start",
          id: "parallel-call-1",
          toolName: "send_email",
        },
        { type: "tool-input-delta", id: "parallel-call-1", delta: emailInput },
        { type: "tool-input-end", id: "parallel-call-1" },
        {
          type: "tool-call",
          toolCallId: "parallel-call-1",
          toolName: "send_email",
          input: emailInput,
        },
        {
          type: "tool-input-start",
          id: "parallel-call-2",
          toolName: "create_task",
        },
        { type: "tool-input-delta", id: "parallel-call-2", delta: taskInput },
        { type: "tool-input-end", id: "parallel-call-2" },
        {
          type: "tool-call",
          toolCallId: "parallel-call-2",
          toolName: "create_task",
          input: taskInput,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Scenario: stateful multi-turn tool call → reject → retry
  // Turn 1: user sends "test-tool-call-reject" → emit send_email tool call
  if (lastText === "test-tool-call-reject") {
    const input = JSON.stringify({
      to: "reject-test@example.com",
      subject: "Rejection Test Email",
      body: "<p>This email should be rejected by the user.</p>",
    });
    return {
      chunks: [
        {
          type: "tool-input-start",
          id: "call-reject-1",
          toolName: "send_email",
        },
        { type: "tool-input-delta", id: "call-reject-1", delta: input },
        { type: "tool-input-end", id: "call-reject-1" },
        {
          type: "tool-call",
          toolCallId: "call-reject-1",
          toolName: "send_email",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Turn 3: user sends "yes" after "Wanna try again?" → re-emit tool call
  if (
    lastText.toLowerCase() === "yes" &&
    hasUserMessage(messages, "test-tool-call-reject") &&
    getLastAssistantText(messages).includes("Wanna try again?")
  ) {
    const input = JSON.stringify({
      to: "reject-test@example.com",
      subject: "Rejection Test Email (Retry)",
      body: "<p>This is the retried email after rejection.</p>",
    });
    return {
      chunks: [
        {
          type: "tool-input-start",
          id: "call-reject-retry",
          toolName: "send_email",
        },
        { type: "tool-input-delta", id: "call-reject-retry", delta: input },
        { type: "tool-input-end", id: "call-reject-retry" },
        {
          type: "tool-call",
          toolCallId: "call-reject-retry",
          toolName: "send_email",
          input,
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: undefined },
          usage: MOCK_USAGE,
        },
      ],
      chunkDelayInMs: null,
    };
  }

  // Default: stream "Hello, world!"
  return {
    chunks: [
      { type: "text-start", id: "text-1" },
      { type: "text-delta", id: "text-1", delta: "Hello, world!" },
      { type: "text-end", id: "text-1" },
      {
        type: "finish",
        finishReason: { unified: "stop", raw: undefined },
        usage: MOCK_USAGE,
      },
    ],
    chunkDelayInMs: null,
  };
}

/** Create a MockLanguageModelV3 for E2E testing. */
export function createTestProvider() {
  return new MockLanguageModelV3({
    doGenerate: async ({ prompt }) => {
      const promptText = JSON.stringify(prompt);
      if (
        promptText.includes("Summarize") ||
        promptText.includes("CONVERSATION SUMMARY") ||
        promptText.includes("running summary")
      ) {
        return {
          content: [
            {
              type: "text",
              text: "Summary: The user discussed tasks and emails. Key facts preserved.",
            },
          ],
          finishReason: { unified: "stop", raw: undefined },
          usage: MOCK_USAGE,
          warnings: [],
        };
      }
      return {
        content: [{ type: "text", text: "Hello, world!" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: MOCK_USAGE,
        warnings: [],
      };
    },
    doStream: async ({ prompt, tools: modelTools }) => {
      const config = buildStreamChunks(
        prompt as unknown[],
        modelTools
          ? new Set((modelTools as Array<{ name: string }>).map((t) => t.name))
          : undefined,
      );
      return {
        stream: simulateReadableStream({
          chunks: config.chunks,
          chunkDelayInMs: config.chunkDelayInMs,
          initialDelayInMs: null,
        }),
      };
    },
  });
}
