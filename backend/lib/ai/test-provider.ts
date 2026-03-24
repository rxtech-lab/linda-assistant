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
  chunkInitialDelayInMs?: number | null;
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
  const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
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
  const sentence = "The quick brown fox jumps over the lazy dog near the riverbank. ";
  const parts: string[] = [];
  for (let i = 0; i < 100; i++) {
    parts.push(`[${i + 1}] ${sentence}`);
  }
  return parts.join("");
}

/** Create tool-call stream chunks: input-start → input-delta → input-end → tool-call → finish. */
function createToolCallChunks(
  id: string,
  toolName: string,
  input: string,
  includeFinish = true,
): LanguageModelV3StreamPart[] {
  const parts: LanguageModelV3StreamPart[] = [
    { type: "tool-input-start", id, toolName },
    { type: "tool-input-delta", id, delta: input },
    { type: "tool-input-end", id },
    { type: "tool-call", toolCallId: id, toolName, input },
  ];
  if (includeFinish) {
    parts.push({
      type: "finish",
      finishReason: { unified: "tool-calls", raw: undefined },
      usage: MOCK_USAGE,
    });
  }
  return parts;
}

/** Create a simple text message: text-start → text-delta → text-end → finish(stop). */
function createTextMessageChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    {
      type: "finish",
      finishReason: { unified: "stop", raw: undefined },
      usage: MOCK_USAGE,
    },
  ];
}

/** Split text into word-based delta chunks for streaming simulation. */
function createChunkedTextStream(
  text: string,
  opts?: { chunkSize?: number; suffix?: string },
): LanguageModelV3StreamPart[] {
  const words = text.split(" ");
  const chunkSize = opts?.chunkSize ?? 1;
  const chunks: LanguageModelV3StreamPart[] = [{ type: "text-start", id: "text-1" }];
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize).join(" ") + " ";
    chunks.push({ type: "text-delta", id: "text-1", delta: chunk });
  }
  if (opts?.suffix) {
    chunks.push({ type: "text-delta", id: "text-1", delta: opts.suffix });
  }
  chunks.push({ type: "text-end", id: "text-1" });
  chunks.push({
    type: "finish",
    finishReason: { unified: "stop", raw: undefined },
    usage: MOCK_USAGE,
  });
  return chunks;
}

function buildStreamChunks(messages: unknown[], availableTools?: Set<string>): MockStreamConfig {
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
            (c.output.type === "error-text" || c.output.type === "execution-denied"),
        ),
    );

    // Stateful: "test-tool-call-reject" rejection → "Wanna try again?"
    if (isRejection && hasUserMessage(messages, "test-tool-call-reject")) {
      return {
        chunks: createTextMessageChunks("Wanna try again?"),
        chunkDelayInMs: null,
      };
    }

    // ask_question flow: after user answers, return follow-up text
    if (hasUserMessage(messages, "[TOOL:ask_question]")) {
      return {
        chunks: createTextMessageChunks(
          "Thank you for answering! Based on your response, here is the follow-up. [QUESTION_FOLLOW_UP]",
        ),
        chunkDelayInMs: null,
      };
    }

    const text = isRejection ? "I understand, I won't do that." : "Email sent successfully.";

    return {
      chunks: createTextMessageChunks(text),
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
  if (lastText.includes("[SLOW_STREAM_LONG]")) {
    return {
      chunks: createChunkedTextStream(
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu one two three four",
      ),
      chunkDelayInMs: 300,
    };
  }

  if (lastText.includes("[SLOW_STREAM]")) {
    return {
      chunks: createChunkedTextStream(
        "The quick brown fox jumps over the lazy dog and keeps running across the field",
      ),
      chunkDelayInMs: 200,
    };
  }

  // Scenario: long output (~1000 words)
  if (lastText === "long-output-test-1") {
    const longText = generateLongText();
    console.log("Generated long text for streaming:", longText.slice(0, 100) + "...");
    return {
      chunks: createChunkedTextStream(longText, {
        chunkSize: 50,
        suffix: "[END OF LONG OUTPUT]",
      }),
      chunkDelayInMs: 200,
      chunkInitialDelayInMs: 500,
    };
  }

  // Scenario: send_email with document attachment (supports :auto suffix to skip confirmation)
  if (
    (lastText.includes("[TOOL:send_email_with_doc]") ||
      lastText.includes("[TOOL:send_email_with_doc:auto]")) &&
    (!availableTools || availableTools.has("send_email"))
  ) {
    const input = JSON.stringify({
      to: "test@example.com",
      subject: "Test Email With Attachment",
      body: "<p>Please find the document attached.</p>",
      documentId: "e2e-test-doc",
    });
    return {
      chunks: createToolCallChunks("call-doc-1", "send_email", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: send_email tool call (supports :auto suffix to skip confirmation)
  if (
    (lastText.includes("[TOOL:send_email]") || lastText.includes("[TOOL:send_email:auto]")) &&
    (!availableTools || availableTools.has("send_email"))
  ) {
    // Extract email address from message if present, otherwise default
    const emailMatch = lastText.match(/[\w.-]+@[\w.-]+\.\w+/);
    const to = emailMatch ? emailMatch[0] : "test@example.com";
    // Extract subject from "with subject ..." if present
    const subjectMatch = lastText.match(/with subject\s+(.+?)$/i);
    const subject = subjectMatch ? subjectMatch[1].trim() : "Test Email";
    const input = JSON.stringify({
      to,
      subject,
      body: "<p>Test body</p>",
    });
    return {
      chunks: createToolCallChunks("call-1", "send_email", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: create_task tool call (supports :auto suffix to skip confirmation)
  if (
    (lastText.includes("[TOOL:create_task]") || lastText.includes("[TOOL:create_task:auto]")) &&
    (!availableTools || availableTools.has("create_task"))
  ) {
    const input = JSON.stringify({
      title: "Test Task",
      description: "A test task created by the agent",
    });
    return {
      chunks: createToolCallChunks("call-2", "create_task", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: update_task tool call (non-existent id to trigger error, supports :auto suffix)
  if (
    (lastText.includes("[TOOL:update_task]") || lastText.includes("[TOOL:update_task:auto]")) &&
    (!availableTools || availableTools.has("update_task"))
  ) {
    const input = JSON.stringify({
      taskId: "non-existent-id-12345",
      status: "finished",
    });
    return {
      chunks: createToolCallChunks("call-3", "update_task", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: parallel tool calls (send_email + create_task, supports :auto suffix)
  if (
    (lastText.includes("[TOOL:parallel]") || lastText.includes("[TOOL:parallel:auto]")) &&
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
        ...createToolCallChunks("parallel-call-1", "send_email", emailInput, false),
        ...createToolCallChunks("parallel-call-2", "create_task", taskInput),
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
      chunks: createToolCallChunks("call-reject-1", "send_email", input),
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
      chunks: createToolCallChunks("call-reject-retry", "send_email", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: ask_question tool call (boolean question)
  if (
    lastText.includes("[TOOL:ask_question]") &&
    (!availableTools || availableTools.has("ask_question"))
  ) {
    const input = JSON.stringify({
      questions: [
        {
          title: "Do you like sushi?",
          type: "boolean",
        },
      ],
    });
    return {
      chunks: createToolCallChunks("call-question-1", "ask_question", input),
      chunkDelayInMs: null,
    };
  }

  // Default: stream "Hello, world!"
  return {
    chunks: createTextMessageChunks("Hello, world!"),
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

      console.log("Simulating stream with config:", JSON.stringify(config, null, 2));
      return {
        stream: simulateReadableStream({
          chunks: config.chunks,
          chunkDelayInMs: config.chunkDelayInMs,
          initialDelayInMs:
            config.chunkInitialDelayInMs === null ? 500 : config.chunkInitialDelayInMs,
        }),
      };
    },
  });
}
