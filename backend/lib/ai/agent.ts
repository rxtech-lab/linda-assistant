import { streamText, type ModelMessage } from "ai";
import { db } from "@/lib/db";
import { chatSessions, assignees } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildToolSet, getToolPermission } from "./tools";
import {
  appendStreamChunk,
  setStreamActive,
  clearStreamChunks,
} from "@/lib/streaming/manager";
import { createConfirmation } from "./confirmation";
import { getModelProvider } from "./model";

import { DEFAULT_MODEL, availableModelSchema } from "./models";

const MAX_STEPS = 10;

interface AgentRunOptions {
  sessionId: string;
  userId: string;
  onTextChunk?: (text: string) => void;
  onEvent?: (event: string, data: unknown) => void;
  signal?: AbortSignal;
}

export async function runAgent(options: AgentRunOptions) {
  const { sessionId, userId, onTextChunk, onEvent, signal } = options;

  // Load session with messages
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId));

  if (!session) throw new Error("Session not found");

  // Load assignee for personality and model config
  let systemPrompt = "You are Linda, a helpful personal assistant.";
  let modelId = DEFAULT_MODEL;
  let toolPermissions: ToolPermission[] | null = null;

  if (session.assigneeId) {
    const [assignee] = await db
      .select()
      .from(assignees)
      .where(eq(assignees.id, session.assigneeId));

    if (assignee) {
      if (assignee.personality) {
        systemPrompt = assignee.personality;
      }
      if (assignee.model) {
        const parsed = availableModelSchema.safeParse(assignee.model);
        modelId = parsed.success ? parsed.data : DEFAULT_MODEL;
      }
      toolPermissions = assignee.toolPermissions || null;
    }
  }

  const tools = buildToolSet(userId, toolPermissions);
  const messages = (session.messages || []) as ModelMessage[];

  await setStreamActive(sessionId, true);
  await clearStreamChunks(sessionId);

  // Update session status
  await db
    .update(chatSessions)
    .set({ status: "in_progress", updatedAt: sql`(datetime('now'))` })
    .where(eq(chatSessions.id, sessionId));

  onEvent?.("status", { status: "in_progress" });

  let stepCount = 0;
  let currentMessages: ModelMessage[] = [...messages];

  try {
    while (stepCount < MAX_STEPS) {
      if (signal?.aborted) break;

      stepCount++;

      const result = streamText({
        model: getModelProvider(modelId),
        system: systemPrompt,
        messages: currentMessages,
        tools: tools as Parameters<typeof streamText>[0]["tools"],
        abortSignal: signal,
      });

      for await (const part of result.fullStream) {
        if (signal?.aborted) break;

        switch (part.type) {
          case "text-delta": {
            const chunk = JSON.stringify({
              type: "text-delta",
              text: part.text,
            });
            await appendStreamChunk(sessionId, chunk);
            onTextChunk?.(part.text);
            onEvent?.("text-delta", { text: part.text });
            break;
          }
          case "tool-call": {
            onEvent?.("tool-call", {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: "input" in part ? part.input : undefined,
            });
            break;
          }
          case "tool-result": {
            onEvent?.("tool-result", {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: "output" in part ? part.output : undefined,
            });
            break;
          }
          case "error": {
            onEvent?.("error", { error: String(part.error) });
            break;
          }
        }
      }

      const finishReason = await result.finishReason;
      const responseMessages = (await result.response).messages;

      // Append response messages to our message history
      currentMessages = [...currentMessages, ...responseMessages];

      if (finishReason === "tool-calls") {
        // Check if any tool calls require manual confirmation
        const toolCalls = await result.toolCalls;
        const needsConfirmation = toolCalls.find(
          (tc: { toolName: string }) =>
            getToolPermission(tc.toolName, toolPermissions) ===
            "manual-confirm",
        );

        if (needsConfirmation) {
          // Save messages to DB before pausing
          await db
            .update(chatSessions)
            .set({
              messages: currentMessages as unknown[],
              status: "waiting_confirmation",
              updatedAt: sql`(datetime('now'))`,
            })
            .where(eq(chatSessions.id, sessionId));

          // Create confirmation record and notify user
          const input =
            "input" in needsConfirmation ? needsConfirmation.input : undefined;
          await createConfirmation({
            userId,
            chatSessionId: sessionId,
            toolCallId: needsConfirmation.toolCallId,
            toolName: needsConfirmation.toolName,
            parameters: (input ?? {}) as Record<string, unknown>,
          });

          onEvent?.("confirmation_required", {
            toolCallId: needsConfirmation.toolCallId,
            toolName: needsConfirmation.toolName,
            parameters: input,
          });

          await setStreamActive(sessionId, false);
          return { paused: true, reason: "confirmation_required" };
        }

        // Tool calls were auto-confirmed, continue loop
        continue;
      }

      // Agent finished (stop, length, etc.)
      break;
    }

    // Save final messages and mark session as stopped
    await db
      .update(chatSessions)
      .set({
        messages: currentMessages as unknown[],
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, sessionId));

    onEvent?.("status", { status: "stopped" });
    onEvent?.("done", {});
    await setStreamActive(sessionId, false);

    return { paused: false, reason: "completed" };
  } catch (error) {
    // Save whatever we have and mark as stopped
    await db
      .update(chatSessions)
      .set({
        messages: currentMessages as unknown[],
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, sessionId));

    await setStreamActive(sessionId, false);
    onEvent?.("error", { error: String(error) });
    throw error;
  }
}
