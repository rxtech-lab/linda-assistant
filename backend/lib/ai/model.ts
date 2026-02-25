import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";

const MOCK_USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
} as const;

interface MockStreamConfig {
  chunks: LanguageModelV3StreamPart[];
  chunkDelayInMs: number | null;
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

    const text = isRejection ? "I understand, I won't do that." : "Email sent successfully.";

    return {
      chunks: [
        { type: "text-start", id: "text-1" },
        { type: "text-delta", id: "text-1", delta: text },
        { type: "text-end", id: "text-1" },
        { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: MOCK_USAGE },
      ],
      chunkDelayInMs: null,
    };
  }

  // Get last user message text
  const lastUserMsg = [...messages].reverse().find((m: any) => m.role === "user");
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
    const words = "The quick brown fox jumps over the lazy dog and keeps running across the field".split(" ");
    const chunks: LanguageModelV3StreamPart[] = [{ type: "text-start", id: "text-1" }];
    for (const word of words) {
      chunks.push({ type: "text-delta", id: "text-1", delta: `${word} ` });
    }
    chunks.push({ type: "text-end", id: "text-1" });
    chunks.push({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: MOCK_USAGE });
    return { chunks, chunkDelayInMs: 200 };
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
        { type: "tool-call", toolCallId: "call-1", toolName: "send_email", input },
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
        { type: "tool-call", toolCallId: "call-2", toolName: "create_task", input },
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
        { type: "tool-call", toolCallId: "call-3", toolName: "update_task", input },
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
    (!availableTools || (availableTools.has("send_email") && availableTools.has("create_task")))
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
        { type: "tool-input-start", id: "parallel-call-1", toolName: "send_email" },
        { type: "tool-input-delta", id: "parallel-call-1", delta: emailInput },
        { type: "tool-input-end", id: "parallel-call-1" },
        { type: "tool-call", toolCallId: "parallel-call-1", toolName: "send_email", input: emailInput },
        { type: "tool-input-start", id: "parallel-call-2", toolName: "create_task" },
        { type: "tool-input-delta", id: "parallel-call-2", delta: taskInput },
        { type: "tool-input-end", id: "parallel-call-2" },
        { type: "tool-call", toolCallId: "parallel-call-2", toolName: "create_task", input: taskInput },
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
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: MOCK_USAGE },
    ],
    chunkDelayInMs: null,
  };
}

/**
 * Get model provider by environment. Return a test provider in E2E test environment, and return the modelId for vercel ai gateway in production.
 * @param modelId Model name
 * @returns
 */
export function getModelProvider(modelId: string) {
  if (process.env.IS_E2E) {
    return new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: `Hello, world!` }],
        finishReason: { unified: "stop", raw: undefined },
        usage: MOCK_USAGE,
        warnings: [],
      }),
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
  return modelId;
}
