import crypto from "crypto";
import { streamText, type ModelMessage } from "ai";
import { db } from "@/lib/db";
import { chatSessions, assignees } from "@/lib/db/schema";
import type { ToolPermission } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildToolSet, getToolPermission } from "./tools";
import { setStreamActive } from "@/lib/streaming/manager";
import { createConfirmation } from "./confirmation";
import { getModelProvider } from "./model";

import { DEFAULT_MODEL, availableModelSchema } from "./models";

const MAX_STEPS = 10;

/** Strip providerOptions and ensure each message has an id */
function sanitizeMessages(messages: ModelMessage[], messageId?: string): ModelMessage[] {
  return messages.map((msg, i) => {
    const record = msg as Record<string, unknown>;
    // Assign provided messageId to the first message (assistant), generate for others (tool)
    const id = record.id ?? (i === 0 && messageId ? messageId : crypto.randomUUID());

    if (!Array.isArray(msg.content)) {
      return { ...record, id } as unknown as ModelMessage;
    }
    return {
      ...record,
      id,
      content: (msg.content as Record<string, unknown>[]).map((part) => {
        if ("providerOptions" in part) {
          const { providerOptions, ...rest } = part;
          return rest;
        }
        return part;
      }),
    } as unknown as ModelMessage;
  });
}

interface AgentRunOptions {
  sessionId: string;
  userId: string;
  onTextChunk?: (text: string) => void;
  onEvent?: (event: string, data: unknown) => void | Promise<void>;
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

  // Update session status
  await db
    .update(chatSessions)
    .set({ status: "in_progress", updatedAt: sql`(datetime('now'))` })
    .where(eq(chatSessions.id, sessionId));

  await onEvent?.("status", { status: "in_progress" });

  let stepCount = 0;
  let currentMessages: ModelMessage[] = [...messages];

  try {
    while (stepCount < MAX_STEPS) {
      if (signal?.aborted) break;

      stepCount++;

      // Stable id for this step — all stream events share it,
      // and the stored assistant message gets the same id for deduplication
      const id = crypto.randomUUID();

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
            onTextChunk?.(part.text);
            await onEvent?.("text-delta", { id, text: part.text });
            break;
          }
          case "tool-call": {
            await onEvent?.("tool-call", {
              id,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: "input" in part ? part.input : undefined,
            });
            break;
          }
          case "tool-result": {
            await onEvent?.("tool-result", {
              id,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: "output" in part ? part.output : undefined,
            });
            break;
          }
          case "error": {
            await onEvent?.("error", { id, error: String(part.error) });
            break;
          }
        }
      }

      const finishReason = await result.finishReason;
      const responseMessages = (await result.response).messages;

      // Append response messages with the step id as the assistant message's id
      currentMessages = [
        ...currentMessages,
        ...sanitizeMessages(responseMessages as ModelMessage[], id),
      ];

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

          await onEvent?.("confirmation_required", {
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

    await onEvent?.("status", { status: "stopped" });
    await onEvent?.("done", {});
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
    await onEvent?.("error", { error: String(error) });
    throw error;
  }
}
