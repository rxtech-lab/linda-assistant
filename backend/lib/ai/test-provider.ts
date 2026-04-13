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
  endDelayInMs?: number;
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

/** Get tool names from the last assistant message's tool-call content parts. */
function getLastToolCallNames(messages: unknown[]): string[] {
  const lastAssistant = [...messages].reverse().find((m: any) => m.role === "assistant");
  if (!lastAssistant) return [];
  const content = (lastAssistant as any).content;
  if (!Array.isArray(content)) return [];
  return content.filter((c: any) => c.type === "tool-call").map((c: any) => c.toolName as string);
}

/** Extract the output value from the most recent tool-result for a given toolName. */
function getLastToolResultOutput(
  messages: unknown[],
  toolName: string,
): Record<string, unknown> | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type !== "tool-result" || part.toolName !== toolName) continue;
      const output = part.output;
      if (typeof output === "object" && output !== null) {
        // SDK-wrapped: { type: "json", value: { ... } }
        const value = output.value ?? output;
        return typeof value === "object" ? value : null;
      }
    }
  }
  return null;
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

/** Create text stream chunks WITHOUT finish event (for use before tool calls in the same step). */
function createTextChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
  ];
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

    // request_upload flow: after upload completes, return follow-up text
    if (hasUserMessage(messages, "[TOOL:request_upload]")) {
      return {
        chunks: createTextMessageChunks(
          "Upload received! I have processed your file successfully. [UPLOAD_FOLLOW_UP]",
        ),
        chunkDelayInMs: null,
      };
    }

    // Lazy MCP tools multi-step flow: search_tools → read_tool → use_tool → text
    const lastToolNames = getLastToolCallNames(messages);
    const userTexts = messages
      .filter((m: any) => m.role === "user")
      .flatMap((m: any) =>
        Array.isArray(m.content)
          ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text)
          : [],
      )
      .join(" ");
    if (lastToolNames.includes("search_tools") && userTexts.includes("[TOOL:read_tool")) {
      const input = JSON.stringify({ toolIds: ["e2e_test_echo"] });
      return {
        chunks: createToolCallChunks("call-read-1", "read_tool", input),
        chunkDelayInMs: null,
      };
    }
    if (lastToolNames.includes("read_tool") && userTexts.includes("[TOOL:use_tool")) {
      const msgMatch = userTexts.match(/echo\s+"([^"]+)"/i);
      const message = msgMatch ? msgMatch[1] : "hello from lazy tool";
      const input = JSON.stringify({
        toolId: "e2e_test_echo",
        parameters: { message },
      });
      return {
        chunks: createToolCallChunks("call-use-1", "use_tool", input),
        chunkDelayInMs: null,
      };
    }
    if (lastToolNames.includes("use_tool")) {
      return {
        chunks: createTextMessageChunks(
          "I used the echo tool and it returned your message successfully.",
        ),
        chunkDelayInMs: null,
      };
    }
    // search_tools only (no read_tool step) — respond with search results summary
    if (lastToolNames.includes("search_tools")) {
      return {
        chunks: createTextMessageChunks("I found the search results for you."),
        chunkDelayInMs: null,
      };
    }

    // document_slide multi-step flow: create_slides → create_document (with embedded slide) → text
    if (hasUserMessage(messages, "[TOOL:document_slide]")) {
      if (lastToolNames.includes("create_slides")) {
        const slideResult = getLastToolResultOutput(messages, "create_slides");
        const deckId = (slideResult?.deckId as string) ?? "unknown-deck";
        const input = JSON.stringify({
          title: "E2E Test Document with Slides",
          format: "markdown",
          content: `# Test Document\n\nHere are the slides:\n\n{{slide:${deckId}}}\n\nEnd of document.`,
        });
        return {
          chunks: createToolCallChunks("call-doc-slide-1", "create_document", input),
          chunkDelayInMs: null,
        };
      }
      if (lastToolNames.includes("create_document")) {
        return {
          chunks: createTextMessageChunks("Here are your slides and document."),
          chunkDelayInMs: null,
        };
      }
    }

    // document_sheet multi-step flow: create_data_sheet → create_document (with embedded sheet) → text
    if (hasUserMessage(messages, "[TOOL:document_sheet]")) {
      if (lastToolNames.includes("create_data_sheet")) {
        const sheetResult = getLastToolResultOutput(messages, "create_data_sheet");
        const sheetId = (sheetResult?.sheetId as string) ?? "unknown-sheet";
        const input = JSON.stringify({
          title: "E2E Test Document with Data Sheet",
          format: "markdown",
          content: `# Test Document\n\nHere is the data sheet:\n\n{{sheet:${sheetId}}}\n\nEnd of document.`,
        });
        return {
          chunks: createToolCallChunks("call-doc-sheet-1", "create_document", input),
          chunkDelayInMs: null,
        };
      }
      if (lastToolNames.includes("create_document")) {
        return {
          chunks: createTextMessageChunks("Here are your data sheet and document."),
          chunkDelayInMs: null,
        };
      }
    }

    // Slow complex response multi-step flow (with delays for reconnection testing)
    if (hasUserMessage(messages, "[slow-complex-response-1]")) {
      const toolResultCount = messages.filter(
        (m: any) =>
          m.role === "tool" &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === "tool-result"),
      ).length;

      if (toolResultCount === 1) {
        const input = JSON.stringify({
          title: "Slow Complex Document 2",
          format: "markdown",
          content: "# Second Document\n\nCreated in step 2.",
        });
        return {
          chunks: [
            ...createChunkedTextStream(
              "Document created successfully. Now I will create the second document for you.",
              { chunkSize: 2 },
            ).slice(0, -2),
            { type: "text-end" as const, id: "text-1" },
            ...createToolCallChunks("slow-complex-call-2", "create_document", input),
          ],
          chunkDelayInMs: 300,
          chunkInitialDelayInMs: 500,
        };
      }
      return {
        chunks: createChunkedTextStream(
          "All done! Both documents have been created successfully. [END_SLOW_COMPLEX]",
          { chunkSize: 1 },
        ),
        chunkDelayInMs: 1000,
        chunkInitialDelayInMs: 500,
      };
    }

    // Complex response multi-step flow: text → tool → result → text → tool → result → text
    if (hasUserMessage(messages, "[complex-response-1]")) {
      const toolResultCount = messages.filter(
        (m: any) =>
          m.role === "tool" &&
          Array.isArray(m.content) &&
          m.content.some((c: any) => c.type === "tool-result"),
      ).length;

      if (toolResultCount === 1) {
        // Step 2: text + second create_document tool call
        const input = JSON.stringify({
          title: "Complex Document 2",
          format: "markdown",
          content: "# Second Document\n\nCreated in step 2.",
        });
        return {
          chunks: [
            ...createTextChunks("Document created. Now creating another."),
            ...createToolCallChunks("complex-call-2", "create_document", input),
          ],
          chunkDelayInMs: 100,
          endDelayInMs: 10000,
        };
      }
      // Step 3+: final text
      return {
        chunks: createTextMessageChunks("All done! Both documents have been created successfully."),
        chunkDelayInMs: 300,
        endDelayInMs: 10000,
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

  // Scenario: short slow stream (~5 seconds total, for reconnection/replay testing)
  if (lastText === "slow-short-output-test-1") {
    const sentences: string[] = [];
    for (let i = 0; i < 20; i++) {
      sentences.push(`[${i + 1}] The quick brown fox jumps over the lazy dog near the riverbank.`);
    }
    const text = sentences.join(" ");
    return {
      chunks: createChunkedTextStream(text, {
        chunkSize: 10,
        suffix: " [END OF SHORT OUTPUT]",
      }),
      chunkDelayInMs: 250,
      chunkInitialDelayInMs: 500,
    };
  }

  // Scenario: slow long output (~1000 words, slower per-chunk delay for stream reliability testing)
  if (lastText === "slow-long-output-test-1") {
    const longText = generateLongText();
    console.log("Generated slow long text for streaming:", longText.slice(0, 100) + "...");
    return {
      chunks: createChunkedTextStream(longText, {
        chunkSize: 10,
        suffix: "[END OF SLOW LONG OUTPUT]",
      }),
      chunkDelayInMs: 250,
      chunkInitialDelayInMs: 500,
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

  // Scenario: search_tools (first step of lazy MCP tools multi-step flow)
  if (
    (lastText.includes("[TOOL:search_tools]") || lastText.includes("[TOOL:search_tools:auto]")) &&
    (!availableTools || availableTools.has("search_tools"))
  ) {
    const queryMatch = lastText.match(/search.*?"([^"]+)"/i);
    const query = queryMatch ? queryMatch[1] : "echo";
    const input = JSON.stringify({ query });
    return {
      chunks: createToolCallChunks("call-search-1", "search_tools", input),
      chunkDelayInMs: null,
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

  // Scenario: request_upload tool call
  if (
    lastText.includes("[TOOL:request_upload]") &&
    (!availableTools || availableTools.has("request_upload"))
  ) {
    const input = JSON.stringify({
      title: "Upload a photo",
      description: "Please upload a test image",
      number_uploads: 1,
      extensions: ["jpg", "png", "*"],
    });
    return {
      chunks: createToolCallChunks("call-upload-1", "request_upload", input),
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

  // Scenario: document_slide — first step: create_slides (then create_document in tool-result handler)
  if (
    lastText.includes("[TOOL:document_slide]") &&
    (!availableTools || availableTools.has("create_slides"))
  ) {
    const input = JSON.stringify({
      title: "E2E Test Slides",
      description: "Slides for E2E test with document embedding",
    });
    return {
      chunks: createToolCallChunks("call-slides-1", "create_slides", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: document_sheet — first step: create_data_sheet (then create_document in tool-result handler)
  if (
    lastText.includes("[TOOL:document_sheet]") &&
    (!availableTools || availableTools.has("create_data_sheet"))
  ) {
    const input = JSON.stringify({
      title: "E2E Test Data Sheet",
      description: "Data sheet for E2E test with document embedding",
    });
    return {
      chunks: createToolCallChunks("call-sheet-1", "create_data_sheet", input),
      chunkDelayInMs: null,
    };
  }

  // Scenario: complex multi-step response (text → tool → result → text → tool → result → text)
  if (lastText === "[complex-response-1]") {
    const input = JSON.stringify({
      title: "Complex Document 1",
      format: "markdown",
      content: "# First Document\n\nCreated in step 1.",
    });
    return {
      chunks: [
        ...createTextChunks("Let me help you with that."),
        ...createToolCallChunks("complex-call-1", "create_document", input),
      ],
      chunkDelayInMs: 300,
      endDelayInMs: 10000,
    };
  }

  // Scenario: slow complex multi-step response (same as complex-response-1 but with delays for reconnection testing)
  if (lastText === "[slow-complex-response-1]") {
    const input = JSON.stringify({
      title: "Slow Complex Document 1",
      format: "markdown",
      content: "# First Document\n\nCreated in step 1.",
    });
    return {
      chunks: [
        ...createChunkedTextStream(
          "Let me help you with that. I will create two documents for you now.",
          { chunkSize: 2 },
        ).slice(0, -2), // Remove text-end and finish — tool call follows
        { type: "text-end" as const, id: "text-1" },
        ...createToolCallChunks("slow-complex-call-1", "create_document", input),
      ],
      chunkDelayInMs: 300,
      chunkInitialDelayInMs: 500,
    };
  }

  // Scenario: short instant response for bulk message testing
  if (lastText === "short-output-test-1") {
    return {
      chunks: createTextMessageChunks("OK. [END OF SHORT]"),
      chunkDelayInMs: null,
    };
  }

  // Scenario: image + file attachment validation
  // Note: AI SDK converts image parts to { type: "file", mediaType: "image/*" } in the language model prompt
  if (lastText.includes("[image-file-test-1]")) {
    const parts = Array.isArray((lastUserMsg as any)?.content) ? (lastUserMsg as any).content : [];
    console.log(
      "[image-file-test-1] content parts:",
      JSON.stringify(
        parts.map((c: any) => ({ type: c.type, mediaType: c.mediaType })),
        null,
        2,
      ),
    );
    const hasImage = parts.some(
      (c: any) =>
        c.type === "file" && typeof c.mediaType === "string" && c.mediaType.startsWith("image/"),
    );
    if (hasImage) {
      return { chunks: createTextMessageChunks("ok"), chunkDelayInMs: null };
    }
    return {
      chunks: createTextMessageChunks("error: missing image"),
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
      const baseStream = simulateReadableStream({
        chunks: config.chunks,
        chunkDelayInMs: config.chunkDelayInMs,
        initialDelayInMs:
          config.chunkInitialDelayInMs === null ? 500 : config.chunkInitialDelayInMs,
      });

      if (!config.endDelayInMs) {
        return { stream: baseStream };
      }

      const endDelay = config.endDelayInMs;
      const stream = baseStream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            controller.enqueue(chunk);
          },
          async flush(controller) {
            await new Promise((resolve) => setTimeout(resolve, endDelay));
            controller.terminate();
          },
        }),
      );

      return { stream };
    },
  });
}
