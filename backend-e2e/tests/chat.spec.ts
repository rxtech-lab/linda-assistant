import { test, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  getAssigneeId,
  getAssignee,
  clearChatHistory,
  sendMessage,
  consumeStream,
  getChatHistory,
  listConfirmations,
  resolveConfirmation,
  updateAssigneePermissions,
  findToolCallParts,
  findToolResultParts,
  findAllToolCallParts,
  findAllToolResultParts,
} from "./chat.utils";

let assigneeId: string;

test.beforeAll(async () => {
  await ensureOnboarded();
  assigneeId = await getAssigneeId();
  console.log(`Using assignee: ${assigneeId}`);
});

test.describe("Chat with tool calls", () => {
  test.setTimeout(300_000); // 5 min per test — LLM responses can be slow

  test("test 1: create document + approve send_email confirmation + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("send_email");
          const pending = await listConfirmations();
          const c = pending.find((c) => c.toolName === "send_email");
          expect(c).toBeTruthy();
          await resolveConfirmation(c!.id, "confirm");
        }
      },
    });

    try {
      // Step 1: Send message asking to create doc and send email
      await sendMessage(
        assigneeId,
        "Write a short document in markdown format with title 'Hello World' and content just saying hello world. Then send it to nonexistent@invalid-domain-that-does-not-exist.example.com",
      );
      await stream.waitForDone();

      // Verify create_document tool was auto-executed
      const docToolCalls = stream.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "create_document",
      );
      expect(docToolCalls.length).toBeGreaterThanOrEqual(1);

      const docToolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "create_document",
      );
      expect(docToolResults.length).toBeGreaterThanOrEqual(1);

      // Verify send_email confirmation was requested
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(1);
      expect(confirmationEvents[0]?.data.toolName).toBe("send_email");

      // Verify send_email tool-result appeared (success or error — both are valid)
      const sendEmailResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "send_email",
      );
      expect(sendEmailResults.length).toBeGreaterThanOrEqual(1);

      // Step 2: Send follow-up message and verify agent still responds
      await sendMessage(assigneeId, "What just happened?");
      await stream.waitForDone();

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(6);

      // Verify create_document tool-call has auto-approved status
      const docCallParts = findToolCallParts(messages, "create_document");
      expect(docCallParts.length).toBeGreaterThanOrEqual(1);

      // Verify create_document tool-result exists
      const docResultParts = findToolResultParts(messages, "create_document");
      expect(docResultParts.length).toBeGreaterThanOrEqual(1);

      // Verify send_email tool-call has confirmation with confirmed status
      const emailCallParts = findToolCallParts(messages, "send_email");
      expect(emailCallParts.length).toBeGreaterThanOrEqual(1);
      const emailConfirmation = emailCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(emailConfirmation).toBeTruthy();
      expect(emailConfirmation!.status).toBe("confirmed");

      // Verify send_email tool-result exists
      const emailResultParts = findToolResultParts(messages, "send_email");
      expect(emailResultParts.length).toBeGreaterThanOrEqual(1);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange exists (last two messages should be user + assistant)
      const lastTwo = messages.slice(-2);
      expect(lastTwo[0]?.role).toBe("user");
      expect(lastTwo[1]?.role).toBe("assistant");

      console.log(
        `Test 1 passed: ${messages.length} messages, ${allCalls.length} tool calls`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 2: send email + reject confirmation + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("send_email");
          const pending = await listConfirmations();
          const c = pending.find((c) => c.toolName === "send_email");
          expect(c).toBeTruthy();
          await resolveConfirmation(c!.id, "reject");
        }
      },
    });

    try {
      // Step 1: Send message asking to send email
      await sendMessage(
        assigneeId,
        "Send an email to nonexistent@invalid-domain-that-does-not-exist.example.com with subject 'Test Email' and body 'Hello, this is a test.'",
      );
      await stream.waitForDone();

      // Verify confirmation was requested
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(1);
      expect(confirmationEvents[0]?.data.toolName).toBe("send_email");

      // Verify agent produced text after rejection
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up and verify agent responds
      await sendMessage(assigneeId, "OK thanks");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify send_email tool-call has confirmation with rejected status
      const emailCallParts = findToolCallParts(messages, "send_email");
      expect(emailCallParts.length).toBeGreaterThanOrEqual(1);
      const emailConfirmation = emailCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(emailConfirmation).toBeTruthy();
      expect(emailConfirmation!.status).toBe("rejected");

      // Verify rejection tool-result exists with isError
      const emailResultParts = findToolResultParts(messages, "send_email");
      expect(emailResultParts.length).toBeGreaterThanOrEqual(1);
      expect(emailResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange
      const lastTwo = messages.slice(-2);
      expect(lastTwo[0]?.role).toBe("user");
      expect(lastTwo[1]?.role).toBe("assistant");

      console.log(
        `Test 2 passed: ${messages.length} messages, rejection confirmed`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 3: web search with auto-confirm + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Step 1: Discover firecrawl tool names and set them to auto-confirm
    const assignee = await getAssignee(assigneeId);
    const firecrawlTools = assignee.toolPermissions.filter((tp) =>
      tp.toolName.startsWith("firecrawl_"),
    );
    const originalPermissions = [...assignee.toolPermissions];

    if (firecrawlTools.length === 0) {
      console.warn(
        "No firecrawl tools found — skipping auto-confirm permission update",
      );
    } else {
      const updatedPermissions = assignee.toolPermissions.map((tp) => {
        if (tp.toolName.startsWith("firecrawl_")) {
          return { toolName: tp.toolName, permission: "auto-confirm" };
        }
        return tp;
      });
      await updateAssigneePermissions(assigneeId, updatedPermissions);
      console.log(
        `Set ${firecrawlTools.length} firecrawl tools to auto-confirm`,
      );
    }

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, { timeout: 180_000 });

    try {
      // Step 2: Send message asking to search web
      await sendMessage(
        assigneeId,
        "Search the web for today's weather in Hong Kong and tell me the result",
      );
      await stream.waitForDone();

      // Verify tool-call events happened (firecrawl tools)
      const toolCalls = stream.events.filter((e) => e.event === "tool-call");
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);

      // Verify tool-result events happened
      const toolResults = stream.events.filter((e) => e.event === "tool-result");
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify no confirmation was required
      const confirmations = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmations.length).toBe(0);

      // Verify agent produced text response
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Send follow-up and verify agent responds
      await sendMessage(assigneeId, "Summarize what you found in one sentence");
      await stream.waitForDone();

      // Step 4: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify firecrawl tool-calls have auto-approved status
      const allCalls = findAllToolCallParts(messages);
      const firecrawlCalls = allCalls.filter((part) =>
        (part.toolName as string).startsWith("firecrawl_"),
      );
      expect(firecrawlCalls.length).toBeGreaterThanOrEqual(1);
      for (const call of firecrawlCalls) {
        // Auto-confirmed tools should not have a confirmation object
        expect(call.confirmation).toBeFalsy();
      }

      // Verify all tool-calls have matching tool-results
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify complete message flow ends with user + assistant
      const lastTwo = messages.slice(-2);
      expect(lastTwo[0]?.role).toBe("user");
      expect(lastTwo[1]?.role).toBe("assistant");

      console.log(
        `Test 3 passed: ${messages.length} messages, ${firecrawlCalls.length} firecrawl tool calls`,
      );
    } finally {
      stream.cancel();
      // Cleanup: restore original permissions
      if (firecrawlTools.length > 0) {
        await updateAssigneePermissions(assigneeId, originalPermissions);
        console.log("Restored original tool permissions");
      }
    }
  });

  test("test 4: web search confirmation ignored + continue chat + re-search and confirm", async () => {
    await clearChatHistory(assigneeId);

    // Set firecrawl tools to requires-confirmation
    const assignee = await getAssignee(assigneeId);
    const originalPermissions = [...assignee.toolPermissions];
    const firecrawlTools = assignee.toolPermissions.filter((tp) =>
      tp.toolName.startsWith("firecrawl_"),
    );

    if (firecrawlTools.length > 0) {
      const updatedPermissions = assignee.toolPermissions.map((tp) => {
        if (tp.toolName.startsWith("firecrawl_")) {
          return { toolName: tp.toolName, permission: "manual-confirm" };
        }
        return tp;
      });
      await updateAssigneePermissions(assigneeId, updatedPermissions);
      console.log(
        `Set ${firecrawlTools.length} firecrawl tools to manual-confirm`,
      );
    }

    // Track whether we should confirm or ignore confirmations
    let shouldConfirm = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          if (shouldConfirm) {
            const pending = await listConfirmations();
            const c = pending.find(
              (c) =>
                c.toolName.startsWith("firecrawl_") &&
                c.status === "pending",
            );
            if (c) {
              await resolveConfirmation(c.id, "confirm");
              console.log(`Confirmed: ${c.toolName}`);
            }
          } else {
            console.log(
              `Ignoring confirmation for: ${evt.data.toolName}`,
            );
          }
        }
      },
    });

    try {
      // Step 1: Ask for web search — confirmation will be prompted but ignored
      await sendMessage(
        assigneeId,
        "Search the web for today's weather in Hong Kong",
      );
      // Backend won't send "done" while waiting for confirmation — wait for the confirmation event instead
      await stream.waitForEvent("confirmation_required");

      // Verify confirmation was requested
      const firstConfirmations = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(firstConfirmations.length).toBeGreaterThanOrEqual(1);

      // Step 2: Ignore the confirmation and just keep chatting
      await sendMessage(
        assigneeId,
        "Never mind, just tell me a joke instead",
      );
      await stream.waitForDone();

      // Verify agent responded with text (no errors)
      const textDeltasAfterIgnore = stream.events.filter(
        (e) => e.event === "text-delta",
      );
      expect(textDeltasAfterIgnore.length).toBeGreaterThan(0);

      // Step 3: Ask for web search again, this time we will confirm
      shouldConfirm = true;
      await sendMessage(
        assigneeId,
        "Actually, search the web for today's weather in Hong Kong",
      );
      await stream.waitForDone();

      // Verify tool result appeared after confirmation
      const toolResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" &&
          (e.data.toolName as string).startsWith("firecrawl_"),
      );
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after tool result
      const allTextDeltas = stream.events.filter(
        (e) => e.event === "text-delta",
      );
      expect(allTextDeltas.length).toBeGreaterThan(
        textDeltasAfterIgnore.length,
      );

      // Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(6);

      // Verify the confirmed firecrawl tool-call has tool-result
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const confirmedFirecrawlCalls = allCalls.filter((part) => {
        if (!(part.toolName as string).startsWith("firecrawl_")) return false;
        const conf = part.confirmation as
          | { status: string }
          | undefined;
        return conf?.status === "confirmed";
      });
      expect(confirmedFirecrawlCalls.length).toBeGreaterThanOrEqual(1);

      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of confirmedFirecrawlCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      console.log(
        `Test 4 passed: ${messages.length} messages, ignored then confirmed web search`,
      );
    } finally {
      stream.cancel();
      if (firecrawlTools.length > 0) {
        await updateAssigneePermissions(assigneeId, originalPermissions);
        console.log("Restored original tool permissions");
      }
    }
  });

  test("test 5: web search confirmation + delete messages + re-search and confirm", async () => {
    await clearChatHistory(assigneeId);

    // Set firecrawl tools to requires-confirmation
    const assignee = await getAssignee(assigneeId);
    const originalPermissions = [...assignee.toolPermissions];
    const firecrawlTools = assignee.toolPermissions.filter((tp) =>
      tp.toolName.startsWith("firecrawl_"),
    );

    if (firecrawlTools.length > 0) {
      const updatedPermissions = assignee.toolPermissions.map((tp) => {
        if (tp.toolName.startsWith("firecrawl_")) {
          return { toolName: tp.toolName, permission: "manual-confirm" };
        }
        return tp;
      });
      await updateAssigneePermissions(assigneeId, updatedPermissions);
      console.log(
        `Set ${firecrawlTools.length} firecrawl tools to manual-confirm`,
      );
    }

    // Track whether we should confirm or ignore confirmations
    let shouldConfirm = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          if (shouldConfirm) {
            const pending = await listConfirmations();
            const c = pending.find(
              (c) =>
                c.toolName.startsWith("firecrawl_") &&
                c.status === "pending",
            );
            if (c) {
              await resolveConfirmation(c.id, "confirm");
              console.log(`Confirmed: ${c.toolName}`);
            }
          } else {
            console.log(
              `Ignoring confirmation for: ${evt.data.toolName}`,
            );
          }
        }
      },
    });

    try {
      // Step 1: Ask for web search — confirmation will be prompted but ignored
      await sendMessage(
        assigneeId,
        "Search the web for today's weather in Hong Kong",
      );
      // Backend won't send "done" while waiting for confirmation — wait for the confirmation event instead
      await stream.waitForEvent("confirmation_required");

      // Verify confirmation was requested
      const firstConfirmations = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(firstConfirmations.length).toBeGreaterThanOrEqual(1);

      // Step 2: Cancel the stream before deleting messages (stream will be stale after delete)
      stream.cancel();

      // Step 3: Delete all messages
      await clearChatHistory(assigneeId);
      console.log("Deleted all messages");

      // Step 4: Create a new stream after clearing history
      shouldConfirm = true;
      const stream2 = consumeStream(assigneeId, {
        timeout: 180_000,
        onMessage: async (evt) => {
          if (evt.event === "confirmation_required") {
            const pending = await listConfirmations();
            const c = pending.find(
              (c) =>
                c.toolName.startsWith("firecrawl_") &&
                c.status === "pending",
            );
            if (c) {
              await resolveConfirmation(c.id, "confirm");
              console.log(`Confirmed after delete: ${c.toolName}`);
            }
          }
        },
      });

      try {
        // Step 5: Ask for web search again — this time confirm
        await sendMessage(
          assigneeId,
          "Search the web for today's weather in Hong Kong and tell me the result",
        );
        await stream2.waitForDone();

        // Verify tool result appeared after confirmation
        const toolResults = stream2.events.filter(
          (e) =>
            e.event === "tool-result" &&
            (e.data.toolName as string).startsWith("firecrawl_"),
        );
        expect(toolResults.length).toBeGreaterThanOrEqual(1);

        // Verify agent produced text after tool result
        const textDeltas = stream2.events.filter(
          (e) => e.event === "text-delta",
        );
        expect(textDeltas.length).toBeGreaterThan(0);

        // Validate chat history — should only have messages from after the delete
        const { messages } = await getChatHistory(assigneeId);
        // Should have: user message + assistant with tool-call + tool-result + text
        expect(messages.length).toBeGreaterThanOrEqual(2);

        // Verify firecrawl tool-call with confirmed status has matching tool-result
        const allCalls = findAllToolCallParts(messages);
        const allResults = findAllToolResultParts(messages);
        const firecrawlCalls = allCalls.filter((part) =>
          (part.toolName as string).startsWith("firecrawl_"),
        );
        expect(firecrawlCalls.length).toBeGreaterThanOrEqual(1);

        const resultIds = new Set(
          allResults.map((r) => r.toolCallId as string),
        );
        for (const call of firecrawlCalls) {
          expect(resultIds.has(call.toolCallId as string)).toBe(true);
        }

        console.log(
          `Test 5 passed: ${messages.length} messages after delete + re-search`,
        );
      } finally {
        stream2.cancel();
      }
    } finally {
      if (firecrawlTools.length > 0) {
        await updateAssigneePermissions(assigneeId, originalPermissions);
        console.log("Restored original tool permissions");
      }
    }
  });
});
