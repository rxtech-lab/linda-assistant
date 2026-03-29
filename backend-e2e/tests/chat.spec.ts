import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  sendMessage,
  consumeStream,
  getChatHistory,
  resolveConfirmation,
  updateAssigneePermissions,
  findToolCallParts,
  findToolResultParts,
  findAllToolCallParts,
  findAllToolResultParts,
  listQuestions,
  answerQuestion,
  sendLocationResponse,
  clearChatHistory,
  type StreamEvent,
} from "./chat.utils";

// Fixture: each test gets its own assignee, deleted after test
const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Reset all tool permissions to manual-confirm
    const assignee = await getAssignee(id);
    const allManualConfirm = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission: "manual-confirm",
    }));
    await updateAssigneePermissions(id, allManualConfirm);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

test.describe.serial("Confirmation flow", () => {
  test.setTimeout(300_000);

  test("test 1: get current time + approve confirmation + continue chat", async ({
    assigneeId,
  }) => {
    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("get_current_time");
          await resolveConfirmation(
            evt.data.confirmationId as string,
            "confirm",
          );
        }
      },
    });

    try {
      // Step 1: Send message asking for current time
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
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
        (e) =>
          e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(timeResults.length).toBeGreaterThanOrEqual(1);

      // Step 2: Send follow-up message and verify agent still responds
      await sendMessage(
        assigneeId,
        "What just happened? Do not use any tools.",
      );
      await stream.waitForDone();

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify a get_current_time tool-call has confirmation with confirmed status
      const timeCallParts = findToolCallParts(messages, "get_current_time");
      expect(timeCallParts.length).toBeGreaterThanOrEqual(1);
      const confirmedCall = timeCallParts.find((p) => p.confirmation);
      expect(confirmedCall).toBeTruthy();
      const timeConfirmation = confirmedCall!.confirmation as {
        id: string;
        status: string;
      };
      expect(timeConfirmation.status).toBe("confirmed");

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

  test("test 2: get current time + reject confirmation + continue chat", async ({
    assigneeId,
  }) => {
    // Single stream connection for the entire test
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          expect(evt.data.toolName).toBe("get_current_time");
          await resolveConfirmation(
            evt.data.confirmationId as string,
            "reject",
          );
        }
      },
    });

    try {
      // Step 1: Send message asking for current time
      await sendMessage(
        assigneeId,
        "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
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
      await sendMessage(assigneeId, "OK thanks. Do not use any tools.");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify a get_current_time tool-call has confirmation with rejected status
      const timeCallParts = findToolCallParts(messages, "get_current_time");
      expect(timeCallParts.length).toBeGreaterThanOrEqual(1);
      const rejectedCall = timeCallParts.find((p) => p.confirmation);
      expect(rejectedCall).toBeTruthy();
      const timeConfirmation = rejectedCall!.confirmation as {
        id: string;
        status: string;
      };
      expect(timeConfirmation.status).toBe("rejected");

      // Verify the rejected tool-call's tool-result has isError
      const allResults = findAllToolResultParts(messages);
      const rejectedResult = allResults.find(
        (r) => r.toolCallId === rejectedCall!.toolCallId,
      );
      expect(rejectedResult).toBeTruthy();
      expect(rejectedResult!.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange — find the last user message and check assistant follows
      const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
      expect(lastUserIdx).toBeGreaterThan(-1);
      expect(messages[lastUserIdx + 1]?.role).toBe("assistant");

      console.log(
        `Test 2 passed: ${messages.length} messages, rejection confirmed`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 3: get current time with auto-confirm + continue chat", async ({
    assigneeId,
  }) => {
    // Set get_current_time to auto-confirm
    const assignee = await getAssignee(assigneeId);
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
        "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
      );
      await stream.waitForDone();

      // Verify get_current_time tool-call event happened
      const toolCalls = stream.events.filter(
        (e) =>
          e.event === "tool-call" && e.data.toolName === "get_current_time",
      );
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);

      // Verify get_current_time tool-result event happened
      const toolResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "get_current_time",
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
      await sendMessage(
        assigneeId,
        "What just happened? Do not use any tools.",
      );
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
    }
  });

  test("test 4: get current time confirmation ignored + continue chat + re-check and confirm", async ({
    assigneeId,
  }) => {
    // Track whether we should confirm or ignore confirmations
    let shouldConfirm = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          if (shouldConfirm) {
            await resolveConfirmation(
              evt.data.confirmationId as string,
              "confirm",
            );
            console.log(`Confirmed: ${evt.data.toolName}`);
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
        "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
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
        "Never mind, just tell me a joke instead. Do not use any tools.",
      );
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
        "Actually, what time is it? Use the get_current_time tool to check. Do not use the ask_question tool.",
      );
      await stream.waitForDone();

      // Verify tool result appeared after confirmation
      const toolResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "get_current_time",
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

  test.skip("test 5: multiple get_current_time — confirm second, first gets rejected, continue chat", async ({
    assigneeId,
  }) => {
    // We'll track confirmation IDs as they arrive and only confirm the second one
    const confirmationIds: Array<{ id: string; toolName: string }> = [];
    let confirmSecond = false;

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "confirmation_required") {
          const cId = evt.data.confirmationId as string;
          confirmationIds.push({
            id: cId,
            toolName: evt.data.toolName as string,
          });
          console.log(
            `Received confirmation #${confirmationIds.length}: ${cId}`,
          );

          // Once we have 2 pending confirmations, confirm the second and reject the first
          if (confirmationIds.length >= 2 && !confirmSecond) {
            confirmSecond = true;
            await resolveConfirmation(confirmationIds[1]!.id, "confirm");
            console.log(`Confirmed second: ${confirmationIds[1]!.id}`);
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
        "Check the current time twice: first in UTC, then in America/New_York. Use the get_current_time tool for each. Do not use the ask_question tool.",
      );
      await stream.waitForDone();

      // Verify we got at least 2 confirmation events
      const confirmationEvents = stream.events.filter(
        (e) => e.event === "confirmation_required",
      );
      expect(confirmationEvents.length).toBeGreaterThanOrEqual(2);

      // Verify get_current_time tool results exist
      const timeResults = stream.events.filter(
        (e) =>
          e.event === "tool-result" && e.data.toolName === "get_current_time",
      );
      expect(timeResults.length).toBeGreaterThanOrEqual(2);

      // Step 2: Send follow-up message and verify agent responds without error
      await sendMessage(
        assigneeId,
        "What happened with those time checks? Do not use any tools.",
      );
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

  test("test 6: get current time confirmation + delete messages + re-check and confirm", async ({
    assigneeId,
  }) => {
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
        "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
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
            await resolveConfirmation(
              evt.data.confirmationId as string,
              "confirm",
            );
            console.log(`Confirmed after delete: ${evt.data.toolName}`);
          }
        },
      });

      try {
        // Step 5: Ask for current time again — this time confirm
        await sendMessage(
          assigneeId,
          "What time is it right now? Use the get_current_time tool to check. Do not use the ask_question tool.",
        );
        await stream2.waitForDone();

        // Verify tool result appeared after confirmation
        const toolResults = stream2.events.filter(
          (e) =>
            e.event === "tool-result" && e.data.toolName === "get_current_time",
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
});

test.describe.serial("Stream behavior", () => {
  test.setTimeout(300_000);

  test("test 7: stream recovery — two listeners, one disconnects and reconnects, both match history", async ({
    assigneeId,
  }) => {
    // Step 1: Connect TWO listeners BEFORE sending the message
    // This ensures listeners are ready when chunks start arriving
    // Listener A: stays connected the entire time
    const streamA = consumeStream(assigneeId, {
      timeout: 120_000,
      label: "Listener A",
      autoDisconnect: true,
    });

    // Listener B: disconnects after the first text-delta chunk and reconnects immediately
    // Reconnecting inside onMessage ensures zero delay, so the stream is still in_progress
    const firstChunkEvents: StreamEvent[] = [];
    let streamBReconnect!: ReturnType<typeof consumeStream>;
    const listenerBReconnected = new Promise<void>((resolve) => {
      const streamB = consumeStream(assigneeId, {
        timeout: 60_000,
        label: "Listener B",
        onMessage: async (evt) => {
          if (evt.event === "text-delta" && !streamBReconnect) {
            firstChunkEvents.push(evt);
            console.log(
              `Listener B received first text-delta chunk, disconnecting and reconnecting immediately...`,
            );
            streamB.cancel();
            streamBReconnect = consumeStream(assigneeId, {
              timeout: 120_000,
              label: "Listener B Reconnect",
            });
            resolve();
          }
        },
      });
    });

    // Step 2: Send message after listeners are connected
    await sendMessage(
      assigneeId,
      "Write exactly 300 words about the history of the internet. Do not use any tools including ask_question. Just write plain text.",
    );

    await listenerBReconnected;

    expect(firstChunkEvents.length).toBeGreaterThan(0);
    const firstChunkText = String(firstChunkEvents[0]!.data.text ?? "");
    console.log(
      `Listener B received first chunk (${firstChunkText.length} chars), disconnected and reconnected`,
    );

    // Step 4: Wait for reconnected B to finish (may get "done" if still generating, or "status: stopped" if already done)
    console.log(`Waiting for both listeners to finish...`);
    await Promise.race([
      streamBReconnect.waitForDone(),
      streamBReconnect.waitForEvent("status").then((evt) => {
        if (evt.data.status === "stopped") return;
        // If not stopped, fall through to waitForDone
        return streamBReconnect.waitForDone();
      }),
    ]);

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

    const streamBAllEvents = streamBReconnect.events;
    console.log(
      `Listener B reconnect received ${streamBAllEvents.length} total events: ${streamBAllEvents.map((e) => e.event).join(", ")}`,
    );

    const streamBTextDeltas = streamBAllEvents.filter(
      (e) => e.event === "text-delta",
    );

    const streamBText = streamBTextDeltas
      .map((e) => String(e.data.text ?? ""))
      .join("");
    console.log(
      `Listener B reconnect: ${streamBTextDeltas.length} text-delta events (${streamBText.length} chars)`,
    );

    const streamBGotRefresh = streamBAllEvents.some(
      (e) => e.event === "refresh",
    );
    console.log(`Listener B reconnect got refresh: ${streamBGotRefresh}`);

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

    // Step 6: Listener A must have received all text via stream
    expect(streamAText).toBe(fullText);

    // Step 7: Listener B recovery — two valid paths:
    // a) Mid-stream reconnect: gets replayed text-deltas matching full text
    // b) Post-stream reconnect: gets "refresh" signal, meaning client should fetch from DB
    if (streamBTextDeltas.length > 0) {
      // Path (a): replayed text-deltas
      expect(streamBText).toBe(fullText);
      console.log(
        `Test 7 passed (replay path): B reconnected mid-stream and received full text via replay (${wordCount} words)`,
      );
    } else {
      // Path (b): refresh signal — verify it was received
      expect(streamBGotRefresh).toBe(true);
      console.log(
        `Test 7 passed (refresh path): B reconnected after stream ended, got refresh signal, DB has full text (${wordCount} words)`,
      );
    }

    streamA.cancel();
    streamBReconnect.cancel();
  });

  test("test 7b: stream recovery — two devices both disconnect and reconnect mid-stream, both get replay", async ({
    assigneeId,
  }) => {
    const deviceTokenA = `test-device-${Date.now()}-a`;
    const deviceTokenB = `test-device-${Date.now()}-b`;

    // Step 1: Connect both devices BEFORE sending the message
    // Each disconnects after first text-delta and reconnects immediately
    const firstChunkA: StreamEvent[] = [];
    let streamAReconnect!: ReturnType<typeof consumeStream>;
    const deviceAReconnected = new Promise<void>((resolve) => {
      const streamA = consumeStream(assigneeId, {
        timeout: 60_000,
        label: "Device A",
        deviceToken: deviceTokenA,
        onMessage: async (evt) => {
          if (evt.event === "text-delta" && !streamAReconnect) {
            firstChunkA.push(evt);
            console.log("Device A received first text-delta, disconnecting and reconnecting...");
            streamA.cancel();
            streamAReconnect = consumeStream(assigneeId, {
              timeout: 120_000,
              label: "Device A Reconnect",
              deviceToken: deviceTokenA,
            });
            resolve();
          }
        },
      });
    });

    const firstChunkB: StreamEvent[] = [];
    let streamBReconnect!: ReturnType<typeof consumeStream>;
    const deviceBReconnected = new Promise<void>((resolve) => {
      const streamB = consumeStream(assigneeId, {
        timeout: 60_000,
        label: "Device B",
        deviceToken: deviceTokenB,
        onMessage: async (evt) => {
          if (evt.event === "text-delta" && !streamBReconnect) {
            firstChunkB.push(evt);
            console.log("Device B received first text-delta, disconnecting and reconnecting...");
            streamB.cancel();
            streamBReconnect = consumeStream(assigneeId, {
              timeout: 120_000,
              label: "Device B Reconnect",
              deviceToken: deviceTokenB,
            });
            resolve();
          }
        },
      });
    });

    // Step 2: Send message after listeners are connected
    await sendMessage(
      assigneeId,
      "Write exactly 300 words about the history of space exploration. Do not use any tools including ask_question. Just write plain text.",
    );

    await Promise.all([deviceAReconnected, deviceBReconnected]);
    console.log("Both devices disconnected and reconnected after first chunk");

    // Step 4: Wait for both to finish
    await Promise.all([
      Promise.race([
        streamAReconnect.waitForDone(),
        streamAReconnect.waitForEvent("status").then((evt) => {
          if (evt.data.status === "stopped") return;
          return streamAReconnect.waitForDone();
        }),
      ]),
      Promise.race([
        streamBReconnect.waitForDone(),
        streamBReconnect.waitForEvent("status").then((evt) => {
          if (evt.data.status === "stopped") return;
          return streamBReconnect.waitForDone();
        }),
      ]),
    ]);

    // Step 5: Verify both received all text
    const { messages } = await getChatHistory(assigneeId);
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

    expect(fullText.length).toBeGreaterThan(500);

    const textA = streamAReconnect.events
      .filter((e) => e.event === "text-delta")
      .map((e) => String(e.data.text ?? ""))
      .join("");
    const textB = streamBReconnect.events
      .filter((e) => e.event === "text-delta")
      .map((e) => String(e.data.text ?? ""))
      .join("");

    // Each device has two valid recovery paths:
    // a) Mid-stream reconnect: gets replayed text-deltas matching full text
    // b) Post-stream reconnect: gets "refresh" signal, client fetches from DB
    const gotRefreshA = streamAReconnect.events.some((e) => e.event === "refresh");
    const gotRefreshB = streamBReconnect.events.some((e) => e.event === "refresh");

    if (textA.length > 0) {
      expect(textA).toBe(fullText);
    } else {
      expect(gotRefreshA).toBe(true);
    }

    if (textB.length > 0) {
      expect(textB).toBe(fullText);
    } else {
      expect(gotRefreshB).toBe(true);
    }

    const pathA = textA.length > 0 ? "replay" : "refresh";
    const pathB = textB.length > 0 ? "replay" : "refresh";
    console.log(
      `Test 7b passed: device A (${pathA}), device B (${pathB}), full text ${fullText.length} chars`,
    );

    streamAReconnect.cancel();
    streamBReconnect.cancel();
  });

  test("test 8: no stream listener — poll DB until assistant replies, then connect with deviceToken and receive refresh signal", async ({
    assigneeId,
  }) => {
    const deviceTokenA = `test-device-${Date.now()}-a`;

    // Step 1: Send message but do NOT listen to the stream
    await sendMessage(
      assigneeId,
      "Reply with only the word 'hello' and nothing else. Do not use any tools.",
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

    // Step 3: Connect with deviceToken — should receive refresh signal (cached data exists, device hasn't seen it)
    const stream = consumeStream(assigneeId, {
      timeout: 15_000,
      deviceToken: deviceTokenA,
    });
    try {
      const refreshEvent = await stream.waitForEvent("refresh");
      console.log("Received refresh event:", refreshEvent.data);

      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      console.log(
        `Late stream connection received ${textDeltas.length} text-delta events`,
      );
      expect(textDeltas.length).toBe(0);

      console.log(
        "Test 8 passed: refresh signal received after generation completed",
      );
    } finally {
      stream.cancel();
    }

    // Step 4: Connect again with same deviceToken — should NOT receive refresh (already marked)
    const stream2 = consumeStream(assigneeId, {
      timeout: 15_000,
      deviceToken: deviceTokenA,
    });
    try {
      const statusEvent = await stream2.waitForEvent("status");
      console.log("Second connection status event:", statusEvent.data);

      const refreshEvents = stream2.events.filter((e) => e.event === "refresh");
      console.log(
        `Second connection received ${refreshEvents.length} refresh events`,
      );
      expect(refreshEvents.length).toBe(0);

      console.log("Test 8 continued: no duplicate refresh for same device");
    } finally {
      stream2.cancel();
    }

    // Step 5: Connect with a DIFFERENT deviceToken — should receive refresh
    const deviceTokenB = `test-device-${Date.now()}-b`;
    const stream3 = consumeStream(assigneeId, {
      timeout: 15_000,
      deviceToken: deviceTokenB,
    });
    try {
      const refreshEvent = await stream3.waitForEvent("refresh");
      console.log("Different device refresh event:", refreshEvent.data);
      console.log("Test 8 continued: different device gets refresh signal");
    } finally {
      stream3.cancel();
    }
  });
});

test.describe("Question tool", () => {
  test.setTimeout(300_000);

  test("test 9: ask question + answer + follow up", async ({ assigneeId }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "question_required") {
          const questionId = evt.data.questionId as string;
          const questions = evt.data.questions as Array<{ type: string }>;
          console.log(`Question required: ${questionId}`);
          expect(questions).toBeTruthy();
          expect(questions.length).toBeGreaterThanOrEqual(1);

          // Answer all questions using data from the event
          const answers = questions.map(
            (qd: { type: string }, i: number) => ({
              questionIndex: i,
              answer:
                qd.type === "boolean"
                  ? true
                  : qd.type === "single_choice" || qd.type === "multiple_choice"
                    ? "Option A"
                    : "Test answer",
            }),
          );
          await answerQuestion(questionId, "answer", answers);
          console.log(`Answered question: ${questionId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers ask_question
      await sendMessage(
        assigneeId,
        "Ask me a question using the ask_question tool. Ask a single boolean question: 'Do you like coffee?'",
      );
      await stream.waitForDone();

      // Verify question_required event was emitted
      const questionEvents = stream.events.filter(
        (e) => e.event === "question_required",
      );
      expect(questionEvents.length).toBeGreaterThanOrEqual(1);

      // Verify tool-result appeared after answering
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "ask_question",
      );
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after receiving answers
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up
      await sendMessage(assigneeId, "What did I answer? Do not use any tools.");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify ask_question tool-call has question annotation with answered status
      const questionCallParts = findToolCallParts(messages, "ask_question");
      expect(questionCallParts.length).toBeGreaterThanOrEqual(1);
      const questionAnnotation = questionCallParts[0]?.question as
        | { id: string; status: string }
        | undefined;
      expect(questionAnnotation).toBeTruthy();
      expect(questionAnnotation!.status).toBe("answered");

      // Verify ask_question tool-result exists
      const questionResultParts = findToolResultParts(messages, "ask_question");
      expect(questionResultParts.length).toBeGreaterThanOrEqual(1);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      console.log(
        `Test 9 passed: ${messages.length} messages, ask_question answered`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 10: ask question + reject + follow up", async ({ assigneeId }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "question_required") {
          const questionId = evt.data.questionId as string;
          console.log(`Question required, rejecting: ${questionId}`);
          await answerQuestion(questionId, "reject");
          console.log(`Rejected question: ${questionId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers ask_question
      await sendMessage(
        assigneeId,
        "Ask me a question using the ask_question tool. Ask a single boolean question: 'Do you like tea?' If the question is rejected, do not retry - just acknowledge the rejection and move on.",
      );
      await stream.waitForDone();

      // Verify question_required event was emitted
      const questionEvents = stream.events.filter(
        (e) => e.event === "question_required",
      );
      expect(questionEvents.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after rejection (acknowledging the rejection)
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up
      await sendMessage(assigneeId, "OK thanks. Do not use any tools.");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify ask_question tool-call has question annotation with rejected status
      const questionCallParts = findToolCallParts(messages, "ask_question");
      expect(questionCallParts.length).toBeGreaterThanOrEqual(1);
      const questionAnnotation = questionCallParts[0]?.question as
        | { id: string; status: string }
        | undefined;
      expect(questionAnnotation).toBeTruthy();
      expect(questionAnnotation!.status).toBe("rejected");

      // Verify rejection tool-result exists with isError
      const questionResultParts = findToolResultParts(messages, "ask_question");
      expect(questionResultParts.length).toBeGreaterThanOrEqual(1);
      expect(questionResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange
      const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
      expect(lastUserIdx).toBeGreaterThan(-1);
      expect(messages[lastUserIdx + 1]?.role).toBe("assistant");

      console.log(
        `Test 10 passed: ${messages.length} messages, ask_question rejected`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 11: ask question + user skips + keeps chatting = auto reject", async ({
    assigneeId,
  }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "question_required") {
          console.log(`Question required but ignoring: ${evt.data.questionId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers ask_question
      await sendMessage(
        assigneeId,
        "Ask me a question using the ask_question tool. Ask a single boolean question: 'Do you like pizza?'",
      );
      // Backend won't send "done" while waiting for question — wait for the question event
      await stream.waitForEvent("question_required");

      // Verify question was requested
      const questionEvents = stream.events.filter(
        (e) => e.event === "question_required",
      );
      expect(questionEvents.length).toBeGreaterThanOrEqual(1);

      // Step 2: Ignore the question and just keep chatting
      await sendMessage(
        assigneeId,
        "Never mind, just tell me a joke instead. Do not use any tools.",
      );
      await stream.waitForDone();

      // Verify agent responded with text (no errors)
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify ask_question tool-call has question annotation with rejected status (auto-rejected)
      const questionCallParts = findToolCallParts(messages, "ask_question");
      expect(questionCallParts.length).toBeGreaterThanOrEqual(1);
      const questionAnnotation = questionCallParts[0]?.question as
        | { id: string; status: string }
        | undefined;
      expect(questionAnnotation).toBeTruthy();
      expect(questionAnnotation!.status).toBe("rejected");

      // Verify rejection tool-result exists with isError
      const questionResultParts = findToolResultParts(messages, "ask_question");
      expect(questionResultParts.length).toBeGreaterThanOrEqual(1);
      expect(questionResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange — find the last user message and check assistant responds after it
      const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
      expect(lastUserIdx).toBeGreaterThan(-1);
      const afterLastUser = messages.slice(lastUserIdx + 1);
      expect(afterLastUser.some((m) => m.role === "assistant")).toBe(true);

      console.log(
        `Test 11 passed: ${messages.length} messages, ask_question auto-rejected after skip`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 11b: answer historical question emits question_answered SSE event", async ({
    assigneeId,
  }) => {
    // Step 1: Start stream and trigger ask_question
    const stream1 = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "stream1",
    });

    let capturedQuestionId: string;
    let capturedToolCallId: string;

    try {
      await sendMessage(
        assigneeId,
        "Ask me a question using the ask_question tool. Ask a single boolean question: 'Do you like sushi?' and provide one follow-up response based on the user's answer.",
      );
      // Wait for the question_required event (backend pauses here)
      await stream1.waitForEvent("question_required");

      const questionEvent = stream1.events.find(
        (e) => e.event === "question_required",
      );
      expect(questionEvent).toBeTruthy();
      capturedQuestionId = questionEvent!.data.questionId as string;
      capturedToolCallId = questionEvent!.data.toolCallId as string;
      console.log(
        `Question created: ${capturedQuestionId}, toolCallId: ${capturedToolCallId}`,
      );
    } finally {
      // Disconnect the first stream (simulates app close)
      stream1.cancel();
    }

    // Step 2: Open a NEW stream (simulates app reopen with historical question)
    const stream2 = consumeStream(assigneeId, {
      timeout: 180_000,
      label: "stream2",
    });

    try {
      // Wait for replayed waiting_question status (backend replays in_progress, tool-call,
      // question_required, then waiting_question)
      await stream2.waitForEvent("question_required");

      // Step 3: Answer the question using the captured questionId
      console.log(`Answering historical question: ${capturedQuestionId!}`);
      await answerQuestion(capturedQuestionId!, "answer", [
        { questionIndex: 0, answer: true },
      ]);

      // Step 4: Wait for the stream to complete
      await stream2.waitForDone();

      // Step 5: Verify question_answered SSE event was emitted
      const answeredEvents = stream2.events.filter(
        (e) => e.event === "question_answered",
      );
      expect(answeredEvents.length).toBeGreaterThanOrEqual(1);
      expect(answeredEvents[0]!.data.action).toBe("answered");
      expect(answeredEvents[0]!.data.toolCallId).toBe(capturedToolCallId!);
      console.log(
        `question_answered event received: toolCallId=${answeredEvents[0]!.data.toolCallId}`,
      );

      // Step 6: Verify agent produced text AFTER receiving the answer (not just replayed pre-question text)
      const textDeltas = stream2.events.filter((e) => e.event === "text-delta");
      const lastMessageFromAssistantStream = textDeltas
        .map((e) => e.data.text)
        .join("");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Verify text-delta events appear after question_answered (post-resume, not just replay)
      const questionAnsweredIndex = stream2.events.findIndex(
        (e) => e.event === "question_answered",
      );
      const postAnswerTextDeltas = stream2.events.filter(
        (e, i) => e.event === "text-delta" && i > questionAnsweredIndex,
      );
      expect(postAnswerTextDeltas.length).toBeGreaterThan(0);

      // Step 7: Verify the stream completed (done event arrived)
      const doneEvents = stream2.events.filter((e) => e.event === "done");
      expect(doneEvents.length).toBeGreaterThanOrEqual(1);

      // Step 8: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      const questionCallParts = findToolCallParts(messages, "ask_question");
      expect(questionCallParts.length).toBeGreaterThanOrEqual(1);
      const questionAnnotation = questionCallParts[0]?.question as
        | { id: string; status: string }
        | undefined;
      expect(questionAnnotation).toBeTruthy();
      expect(questionAnnotation!.status).toBe("answered");

      // check if the last message equals the text from the stream
      const lastMessageFromAssistant = messages.findLast(
        (m) => m.role === "assistant",
      );
      expect((lastMessageFromAssistant?.content[0] as any).text).toEqual(
        lastMessageFromAssistantStream,
      );

      console.log(
        `Test 11b passed: historical question answered, question_answered event emitted, text followed`,
      );
    } finally {
      stream2.cancel();
    }
  });
});

test.describe.serial("Location tool", () => {
  test.setTimeout(300_000);

  test("test 12: get location + share + follow up", async ({ assigneeId }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "location_required") {
          console.log(`Location required: ${evt.data.toolCallId}`);
          await sendLocationResponse(evt.data.toolCallId as string, "confirm", {
            latitude: 37.7749,
            longitude: -122.4194,
            accuracy: 10,
          });
          console.log(`Shared location for: ${evt.data.toolCallId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers get_location
      await sendMessage(
        assigneeId,
        "Use get_location tool to find my coordinates. Do not use the ask_question tool.",
      );
      await stream.waitForDone();

      // Verify location_required event was emitted
      const locationEvents = stream.events.filter(
        (e) => e.event === "location_required",
      );
      expect(locationEvents.length).toBeGreaterThanOrEqual(1);

      // Verify tool-result appeared after sharing location
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_location",
      );
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after receiving location
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up
      await sendMessage(
        assigneeId,
        "What coordinates did I share? Do not use any tools.",
      );
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify get_location tool-call has confirmation with confirmed status
      const locationCallParts = findToolCallParts(messages, "get_location");
      expect(locationCallParts.length).toBeGreaterThanOrEqual(1);
      const locationConfirmation = locationCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(locationConfirmation).toBeTruthy();
      expect(locationConfirmation!.status).toBe("confirmed");

      // Verify get_location tool-result exists
      const locationResultParts = findToolResultParts(messages, "get_location");
      expect(locationResultParts.length).toBeGreaterThanOrEqual(1);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      console.log(
        `Test 12 passed: ${messages.length} messages, get_location shared`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 13: get location + reject + follow up", async ({ assigneeId }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "location_required") {
          console.log(`Location required, rejecting: ${evt.data.toolCallId}`);
          await sendLocationResponse(evt.data.toolCallId as string, "reject");
          console.log(`Rejected location for: ${evt.data.toolCallId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers get_location
      await sendMessage(
        assigneeId,
        "Use the get_location tool to get my location. Do not use the ask_question tool. If location is rejected, do not retry - just acknowledge and move on.",
      );
      await stream.waitForDone();

      // Verify location_required event was emitted
      const locationEvents = stream.events.filter(
        (e) => e.event === "location_required",
      );
      expect(locationEvents.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after rejection
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Send follow-up
      await sendMessage(assigneeId, "OK thanks. Do not use any tools.");
      await stream.waitForDone();

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(5);

      // Verify get_location tool-call has confirmation with rejected status
      const locationCallParts = findToolCallParts(messages, "get_location");
      expect(locationCallParts.length).toBeGreaterThanOrEqual(1);
      const locationConfirmation = locationCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(locationConfirmation).toBeTruthy();
      expect(locationConfirmation!.status).toBe("rejected");

      // Verify rejection tool-result exists with isError
      const locationResultParts = findToolResultParts(messages, "get_location");
      expect(locationResultParts.length).toBeGreaterThanOrEqual(1);
      expect(locationResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange
      const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
      expect(lastUserIdx).toBeGreaterThan(-1);
      expect(messages[lastUserIdx + 1]?.role).toBe("assistant");

      console.log(
        `Test 13 passed: ${messages.length} messages, get_location rejected`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 15: get location with auto-confirm permission", async ({
    assigneeId,
  }) => {
    // Set get_location to auto-confirm
    const assignee = await getAssignee(assigneeId);
    const updatedPermissions = assignee.toolPermissions.map((tp) => {
      if (tp.toolName === "get_location") {
        return { toolName: tp.toolName, permission: "auto-confirm" };
      }
      return tp;
    });
    await updateAssigneePermissions(assigneeId, updatedPermissions);
    console.log("Set get_location to auto-confirm");

    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "location_required") {
          console.log(
            `Location required (isAutoConfirm=${evt.data.isAutoConfirm}): ${evt.data.toolCallId}`,
          );
          // Even with auto-confirm, we still need to respond with coordinates
          await sendLocationResponse(evt.data.toolCallId as string, "confirm", {
            latitude: 40.7128,
            longitude: -74.006,
            accuracy: 5,
          });
          console.log(`Shared location for: ${evt.data.toolCallId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers get_location
      await sendMessage(
        assigneeId,
        "Use the get_location tool to find my coordinates. Do not use the ask_question tool.",
      );
      await stream.waitForDone();

      // Verify location_required event was emitted with isAutoConfirm=true
      const locationEvents = stream.events.filter(
        (e) => e.event === "location_required",
      );
      expect(locationEvents.length).toBeGreaterThanOrEqual(1);
      expect(locationEvents[0]?.data.isAutoConfirm).toBe(true);

      // Verify tool-result appeared
      const toolResults = stream.events.filter(
        (e) => e.event === "tool-result" && e.data.toolName === "get_location",
      );
      expect(toolResults.length).toBeGreaterThanOrEqual(1);

      // Verify agent produced text after receiving location
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 2: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // Verify get_location tool-call has isAutoConfirm=true in history
      const locationCallParts = findToolCallParts(messages, "get_location");
      expect(locationCallParts.length).toBeGreaterThanOrEqual(1);
      expect(locationCallParts[0]?.isAutoConfirm).toBe(true);

      // Verify get_location tool-result exists
      const locationResultParts = findToolResultParts(messages, "get_location");
      expect(locationResultParts.length).toBeGreaterThanOrEqual(1);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      console.log(
        `Test 15 passed: ${messages.length} messages, get_location auto-confirm`,
      );
    } finally {
      stream.cancel();
    }
  });

  test("test 14: get location + user skips + keeps chatting = auto reject", async ({
    assigneeId,
  }) => {
    const stream = consumeStream(assigneeId, {
      timeout: 180_000,
      onMessage: async (evt) => {
        if (evt.event === "location_required") {
          console.log(`Location required but ignoring: ${evt.data.toolCallId}`);
        }
      },
    });

    try {
      // Step 1: Send message that triggers get_location
      await sendMessage(
        assigneeId,
        "Use the get_location tool to find my coordinates. Do not use the ask_question tool.",
      );
      // Backend won't send "done" while waiting for location — wait for the location event
      await stream.waitForEvent("location_required");

      // Verify location was requested
      const locationEvents = stream.events.filter(
        (e) => e.event === "location_required",
      );
      expect(locationEvents.length).toBeGreaterThanOrEqual(1);

      // Step 2: Ignore the location request and just keep chatting
      await sendMessage(
        assigneeId,
        "Never mind, just tell me a joke instead. Do not use any tools.",
      );
      await stream.waitForDone();

      // Verify agent responded with text (no errors)
      const textDeltas = stream.events.filter((e) => e.event === "text-delta");
      expect(textDeltas.length).toBeGreaterThan(0);

      // Step 3: Validate chat history
      const { messages } = await getChatHistory(assigneeId);
      expect(messages.length).toBeGreaterThanOrEqual(4);

      // Verify get_location tool-call has confirmation with cancelled status (auto-cancelled when user skips)
      const locationCallParts = findToolCallParts(messages, "get_location");
      expect(locationCallParts.length).toBeGreaterThanOrEqual(1);
      const locationConfirmation = locationCallParts[0]?.confirmation as
        | { id: string; status: string }
        | undefined;
      expect(locationConfirmation).toBeTruthy();
      expect(locationConfirmation!.status).toBe("cancelled");

      // Verify rejection tool-result exists with isError
      const locationResultParts = findToolResultParts(messages, "get_location");
      expect(locationResultParts.length).toBeGreaterThanOrEqual(1);
      expect(locationResultParts[0]?.isError).toBe(true);

      // Verify all tool-calls have matching tool-results
      const allCalls = findAllToolCallParts(messages);
      const allResults = findAllToolResultParts(messages);
      const resultIds = new Set(allResults.map((r) => r.toolCallId as string));
      for (const call of allCalls) {
        expect(resultIds.has(call.toolCallId as string)).toBe(true);
      }

      // Verify follow-up exchange — find the last user message and check assistant responds after it
      const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
      expect(lastUserIdx).toBeGreaterThan(-1);
      const afterLastUser = messages.slice(lastUserIdx + 1);
      expect(afterLastUser.some((m) => m.role === "assistant")).toBe(true);

      console.log(
        `Test 14 passed: ${messages.length} messages, get_location auto-rejected after skip`,
      );
    } finally {
      stream.cancel();
    }
  });
});
