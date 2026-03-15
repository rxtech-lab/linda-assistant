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
  type StreamEvent,
} from "./chat.utils";

let assigneeId: string;

test.beforeAll(async () => {
  await ensureOnboarded();
  assigneeId = await getAssigneeId();
  console.log(`Using assignee: ${assigneeId}`);

  // Reset all tool permissions to manual-confirm so tests start from a known state
  const assignee = await getAssignee(assigneeId);
  const allManualConfirm = assignee.toolPermissions.map((tp) => ({
    toolName: tp.toolName,
    permission: "manual-confirm",
  }));
  await updateAssigneePermissions(assigneeId, allManualConfirm);
  console.log("Reset all tool permissions to manual-confirm");

  await clearChatHistory(assigneeId);
});

test.describe("Chat with tool calls", () => {
  test.setTimeout(300_000);

  test.afterEach(async () => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
  });

  test("test 1: get current time + approve confirmation + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("get_current_time");
          const pending = await listConfirmations();
          const c = pending.find((c) => c.toolName === "get_current_time");
          expect(c).toBeTruthy();
          await resolveConfirmation(c!.id, "confirm");
        }
      },
    });

    try {
      // Step 1: Send message asking for current time
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check.",
      );
      await stream.waitForDone();

      // Verify get_current_time confirmation was requested
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(1);
      expect(confirmationEvents[0]?.data.toolName).toBe("get_current_time");

      // Verify get_current_time tool-result appeared
      const timeResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(timeResults.length).toBeGreaterThanOrEqual(1);

      // Step 2: Send follow-up message and verify agent still responds
      await sendMessage(assigneeId, "What just happened?");
      await stream.waitForDone();

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify get_current_time tool-call has confirmation with confirmed status
      const timeCallParts = findToolCallParts(messages, "get_current_time");
      expect(timeCallParts.length).toBeGreaterThanOrEqual(1);
      const timeConfirmation = timeCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(timeConfirmation).toBeTruthy();
      expect(timeConfirmation!.status).toBe("confirmed");

      // Verify get_current_time tool-result exists
      const timeResultParts = findToolResultParts(messages, "get_current_time");
      expect(timeResultParts.length).toBeGreaterThanOrEqual(1);

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

  test("test 2: get current time + reject confirmation + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("get_current_time");
          const pending = await listConfirmations();
          const c = pending.find((c) => c.toolName === "get_current_time");
          expect(c).toBeTruthy();
          await resolveConfirmation(c!.id, "reject");
        }
      },
    });

    try {
      // Step 1: Send message asking for current time
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check.",
      );
      await stream.waitForDone();

      // Verify confirmation was requested
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(1);
      expect(confirmationEvents[0]?.data.toolName).toBe("get_current_time");

      // Verify agent produced text after rejection
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up and verify agent responds
      await sendMessage(assigneeId, "OK thanks");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify get_current_time tool-call has confirmation with rejected status
      const timeCallParts = findToolCallParts(messages, "get_current_time");
      expect(timeCallParts.length).toBeGreaterThanOrEqual(1);
      const timeConfirmation = timeCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(timeConfirmation).toBeTruthy();
      expect(timeConfirmation!.status).toBe("rejected");

      // Verify rejection tool-result exists with isError
      const timeResultParts = findToolResultParts(messages, "get_current_time");
      expect(timeResultParts.length).toBeGreaterThanOrEqual(1);
      expect(timeResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange — find the last user message and check assistant follows
      const lastUserIdx = messages.findLastIndex(
        (m) => m.role === "user",
      );
      expect(lastUserIdx).toBeGreaterThan(-1);
      expect(messages[lastUserIdx + 1]?.role).toBe("assistant");

      console.log(
        `Test 2 passed: ${messages.length} messages, rejection confirmed`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 3: get current time with auto-confirm + continue chat", async () => {
    await clearChatHistory(assigneeId);

    // Step 1: Set get_current_time to auto-confirm
    const assignee = await getAssignee(assigneeId);
    const originalPermissions = [...assignee.toolPermissions];

    const updatedPermissions = assignee.toolPermissions.map((tp) => {
      if (tp.toolName === "get_current_time") {
        return { toolName: tp.toolName, permission: "auto-confirm" };
      }
      return tp;
    });
    await updateAssigneePermissions(assigneeId, updatedPermissions);
    console.log("Set get_current_time to auto-confirm");

    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, { timeout: 180_000 });

    try {
      // Step 2: Send message asking for current time
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check.",
      );
      await stream.waitForDone();

      // Verify get_current_time tool-call event happened
      const toolCalls = stream.events.filter(
        (e) => e.event === "tool-call" && e.data.toolName === "get_current_time",
      );
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);

      // Verify get_current_time tool-result event happened
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify no confirmation was required (auto-confirmed)
      const confirmations = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmations.length).toBe(0);

      // Verify agent produced text response
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Send follow-up and verify agent responds
      await sendMessage(assigneeId, "What just happened?");
      await stream.waitForDone();

      // Step 4: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify get_current_time tool-calls have auto-approved status (no confirmation object)
      const allCalls = findAllToolCallParts(messages);
      const timeCalls = allCalls.filter(
        (part) => part.toolName === "get_current_time",
      );
      expect(timeCalls.length).toBeGreaterThanOrEqual(1);
      for (const call of timeCalls) {
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
        `Test 3 passed: ${messages.length} messages, ${timeCalls.length} auto-confirmed get_current_time calls`,
      );
    } finally {
      stream.cancel();
      // Cleanup: restore original permissions
      await updateAssigneePermissions(assigneeId, originalPermissions);
      console.log("Restored original tool permissions");
    }
  });

  test("test 4: get current time confirmation ignored + continue chat + re-check and confirm", async () => {
    await clearChatHistory(assigneeId);

    // Track whether we should confirm or ignore confirmations
    let shouldConfirm = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          if (shouldConfirm) {
            const pending = await listConfirmations();
            const c = pending.find(
              (c) => c.toolName === "get_current_time" && c.status === "pending",
            );
            if (c) {
              await resolveConfirmation(c.id, "confirm");
              console.log(`Confirmed: ${c.toolName}`);
            }
          } else {
            console.log(`Ignoring confirmation for: ${evt.data.toolName}`);
          }
        }
      },
    });

    try {
      // Step 1: Ask for current time — confirmation will be prompted but ignored
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check.",
      );
      // Backend won't send "done" while waiting for confirmation — wait for the confirmation event instead
      await stream.waitForEvent("confirmation_required");

      // Verify confirmation was requested
      const firstConfirmations = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(firstConfirmations.length).toBeGreaterThanOrEqual(1);

      // Step 2: Ignore the confirmation and just keep chatting
      await sendMessage(assigneeId, "Never mind, just tell me a joke instead");
      await stream.waitForDone();

      // Verify agent responded with text (no errors)
      const textDeltasAfterIgnore = stream.events.filter(
        (e) => e.event === "text-delta",
      );
      expect(textDeltasAfterIgnore.length).toBeGreaterThan(0);

      // Step 3: Ask for time again, this time we will confirm
      shouldConfirm = true;
      await sendMessage(
        assigneeId,
        "Actually, what time is it? Use the get_current_time tool to check.",
      );
      await stream.waitForDone();

      // Verify tool result appeared after confirmation
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_current_time",
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

      // Verify the confirmed get_current_time tool-call has tool-result
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const confirmedTimeCalls = allCalls.filter((part) => {
        if (part.toolName !== "get_current_time") return false;
        const conf = part.confirmation as { status: string } | undefined;
        return conf?.status === "confirmed";
      });
      expect(confirmedTimeCalls.length).toBeGreaterThanOrEqual(1);

      // Verify all tool-calls have matching tool-results
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      console.log(
        `Test 4 passed: ${messages.length} messages, ignored then confirmed get_current_time`,
      );
    } finally {
      stream.cancel();
    }
  });

  test.skip("test 5: multiple get_current_time — confirm second, first gets rejected, continue chat", async () => {
    await clearChatHistory(assigneeId);

    // We'll track confirmation IDs as they arrive and only confirm the second one
    const confirmationIds: Array<{ id: string; toolName: string }> = [];
    let confirmSecond = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          const pending = await listConfirmations();
          const pendingTimeCalls = pending.filter(
            (c) => c.toolName === "get_current_time" && c.status === "pending",
          );

          for (const c of pendingTimeCalls) {
            if (!confirmationIds.find((x) => x.id === c.id)) {
              confirmationIds.push({ id: c.id, toolName: c.toolName });
              console.log(
                `Received confirmation #${confirmationIds.length}: ${c.id}`,
              );
            }
          }

          // Once we have 2 pending confirmations, confirm the second and reject the first
          if (confirmationIds.length >= 2 && !confirmSecond) {
            confirmSecond = true;
            // Confirm the second confirmation
            await resolveConfirmation(confirmationIds[1]!.id, "confirm");
            console.log(`Confirmed second: ${confirmationIds[1]!.id}`);
            // Reject the first confirmation
            await resolveConfirmation(confirmationIds[0]!.id, "reject");
            console.log(`Rejected first: ${confirmationIds[0]!.id}`);
          }
        }
      },
    });

    try {
      // Step 1: Ask agent to check time twice
      await sendMessage(
        assigneeId,
        "Check the current time twice: first in UTC, then in America/New_York. Use the get_current_time tool for each.",
      );
      await stream.waitForDone();

      // Verify we got at least 2 confirmation events
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(2);

      // Verify get_current_time tool results exist
      const timeResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(timeResults.length).toBeGreaterThanOrEqual(2);

      // Step 2: Send follow-up message and verify agent responds without error
      await sendMessage(assigneeId, "What happened with those time checks?");
      await stream.waitForDone();

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify we have both confirmed and rejected get_current_time tool calls
      const timeCallParts = findToolCallParts(messages, "get_current_time");
      expect(timeCallParts.length).toBeGreaterThanOrEqual(2);

      const confirmedCalls = timeCallParts.filter((part) => {
        const conf = part.confirmation as { status: string } | undefined;
        return conf?.status === "confirmed";
      });
      const rejectedCalls = timeCallParts.filter((part) => {
        const conf = part.confirmation as { status: string } | undefined;
        return conf?.status === "rejected";
      });
      expect(confirmedCalls.length).toBeGreaterThanOrEqual(1);
      expect(rejectedCalls.length).toBeGreaterThanOrEqual(1);

      // Verify rejected tool-result has isError
      const allResults = findAllToolResultParts(messages);
      const rejectedToolCallIds = new Set(
        rejectedCalls.map((c) => c.toolCallId as string),
      );
      const rejectedResults = allResults.filter((r) =>
        rejectedToolCallIds.has(r.toolCallId as string),
      );
      expect(rejectedResults.length).toBeGreaterThanOrEqual(1);
      for (const r of rejectedResults) {
        expect(r.isError).toBe(true);
      }

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange exists
      const lastTwo = messages.slice(-2);
      expect(lastTwo[0]?.role).toBe("user");
      expect(lastTwo[1]?.role).toBe("assistant");

      console.log(
        `Test 5 passed: ${messages.length} messages, ${confirmedCalls.length} confirmed, ${rejectedCalls.length} rejected`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 6: get current time confirmation + delete messages + re-check and confirm", async () => {
    await clearChatHistory(assigneeId);

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          console.log(`Ignoring confirmation for: ${evt.data.toolName}`);
        }
      },
    });

    try {
      // Step 1: Ask for current time — confirmation will be prompted but ignored
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check.",
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
      const stream2 = consumeStream(assigneeId, {
        timeout: 180_000,
        onMessage: async (evt) => {
          if (evt.event === "confirmation_required") {
            const pending = await listConfirmations();
            const c = pending.find(
              (c) => c.toolName === "get_current_time" && c.status === "pending",
            );
            if (c) {
              await resolveConfirmation(c.id, "confirm");
              console.log(`Confirmed after delete: ${c.toolName}`);
            }
          }
        },
      });

      try {
        // Step 5: Ask for current time again — this time confirm
        await sendMessage(
          assigneeId,
          "What time is it right now? Use the get_current_time tool to check.",
        );
        await stream2.waitForDone();

        // Verify tool result appeared after confirmation
        const toolResults = stream2.events.filter(
          (e) => e.event === "tool-result" && e.data.toolName === "get_current_time",
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

        // Verify all tool-calls have matching tool-results
        const allCalls = findAllToolCallParts(messages);
        const allResults = findAllToolResultParts(messages);
        expect(allCalls.length).toBeGreaterThanOrEqual(1);

        const resultIds = new Set(
          allResults.map((r) => r.toolCallId as string),
        );
        for (const call of allCalls) {
          expect(resultIds.has(call.toolCallId as string)).toBe(true);
        }

        console.log(
          `Test 6 passed: ${messages.length} messages after delete + re-check time`,
        );
      } finally {
        stream2.cancel();
      }
    } finally {
      // No permission cleanup needed — get_current_time requires confirmation by default
    }
  });

  test("test 7: stream recovery — two listeners, one disconnects and reconnects, both match history", async () => {
    await clearChatHistory(assigneeId);

    // Step 1: Send message asking for ~200 words of plain text (no tool calls)
    await sendMessage(
      assigneeId,
      "Write exactly 200 words about the history of the internet. Do not use any tools. Just write plain text.",
    );

    // Step 2: Connect TWO listeners simultaneously
    // Listener A: stays connected the entire time
    const streamA = consumeStream(assigneeId, {
      timeout: 120_000,
      label: "Listener A",
      autoDisconnect: true,
    });

    // Listener B: disconnects after the first text-delta chunk
    const firstChunkEvents: StreamEvent[] = [];
    const streamB = consumeStream(assigneeId, {
      timeout: 60_000,
      label: "Listener B",
      onMessage: async (evt) => {
        if (evt.event === "text-delta") {
          firstChunkEvents.push(evt);
          console.log(
            `Listener B received first text-delta chunk, disconnecting...`,
          );
          streamB.cancel();
        }
      },
    });

    // Wait for listener B to receive first chunk and disconnect
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (firstChunkEvents.length > 0) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 30_000);
    });

    expect(firstChunkEvents.length).toBeGreaterThan(0);
    const firstChunkText = String(firstChunkEvents[0]!.data.text ?? "");
    console.log(
      `Listener B received first chunk (${firstChunkText.length} chars), disconnected`,
    );

    // Step 3: Wait a bit, then reconnect listener B mid-generation (not after A finishes)
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const streamBReconnect = consumeStream(assigneeId, {
      timeout: 120_000,
      label: "Listener B Reconnect",
    });

    // Step 4: Wait for both listener A and reconnected B to finish
    console.log(`Waiting for both listeners to finish...`);
    await Promise.all([streamBReconnect.waitForDone()]);

    const streamATextDeltas = streamA.events.filter(
      (e) => e.event === "text-delta",
    );
    expect(streamATextDeltas.length).toBeGreaterThan(0);

    const streamAText = streamATextDeltas
      .map((e) => String(e.data.text ?? ""))
      .join("");
    console.log(
      `Listener A received ${streamATextDeltas.length} text-delta events (${streamAText.length} chars)`,
    );

    const streamBTextDeltas = streamBReconnect.events.filter(
      (e) => e.event === "text-delta",
    );
    expect(streamBTextDeltas.length).toBeGreaterThan(0);

    const streamBText = streamBTextDeltas
      .map((e) => String(e.data.text ?? ""))
      .join("");
    console.log(
      `Listener B reconnect received ${streamBTextDeltas.length} text-delta events (${streamBText.length} chars)`,
    );

    // Step 5: Verify full chat history
    const { messages } = await getChatHistory(assigneeId);
    expect(messages.length).toBeGreaterThanOrEqual(2);

    const assistantMsg = messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeTruthy();

    let fullText = "";
    if (typeof assistantMsg!.content === "string") {
      fullText = assistantMsg!.content;
    } else if (Array.isArray(assistantMsg!.content)) {
      for (const part of assistantMsg!.content) {
        if (part.type === "text" && typeof part.text === "string") {
          fullText += part.text;
        }
      }
    }

    // The response should be substantial (200 words ~ 1000+ chars)
    console.log(`Full assistant response: ${fullText.length} chars`);
    expect(fullText.length).toBeGreaterThan(500);

    const wordCount = fullText.trim().split(/\s+/).length;
    console.log(`Word count: ${wordCount}`);
    expect(wordCount).toBeGreaterThan(100);

    // Step 6: Both streams' content must match the chat history
    expect(streamAText).toBe(fullText);
    expect(streamBText).toBe(fullText);

    console.log(
      `Test 7 passed: two listeners, A stayed connected, B disconnected+reconnected mid-generation, both match history (${wordCount} words)`,
    );

    streamA.cancel();
    streamBReconnect.cancel();
  });

  test("test 8: no stream listener — poll DB until assistant replies, then connect and receive nothing", async () => {
    await clearChatHistory(assigneeId);

    // Step 1: Send message but do NOT listen to the stream
    await sendMessage(
      assigneeId,
      "Reply with only the word 'hello' and nothing else.",
    );
    console.log("Message sent, not listening to stream");

    // Step 2: Poll chat history until assistant message appears
    let assistantText = "";
    const maxPollTime = 60_000;
    const pollInterval = 2_000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxPollTime) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const { messages } = await getChatHistory(assigneeId);
      const assistantMsg = messages.find((m) => m.role === "assistant");
      if (assistantMsg) {
        if (typeof assistantMsg.content === "string") {
          assistantText = assistantMsg.content;
        } else if (Array.isArray(assistantMsg.content)) {
          for (const part of assistantMsg.content) {
            if (part.type === "text" && typeof part.text === "string") {
              assistantText += part.text;
            }
          }
        }
        if (assistantText.length > 0) {
          console.log(
            `Assistant replied after ${Date.now() - startTime}ms: "${assistantText.slice(0, 50)}"`,
          );
          break;
        }
      }
    }

    expect(assistantText.length).toBeGreaterThan(0);

    // Step 3: Now connect to the stream — generation is already done, should receive no text-delta events
    const stream = consumeStream(assigneeId, { timeout: 15_000 });
    try {
      const statusEvent = await stream.waitForEvent("status");
      console.log("Received status event:", statusEvent.data);

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      console.log(
        `Late stream connection received ${textDeltas.length} text-delta events`,
      );
      expect(textDeltas.length).toBe(0);

      console.log("Test 8 passed: no stream events after generation completed");
    } finally {
      stream.cancel();
    }
  });
});
