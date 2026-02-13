import crypto from "crypto";
import { streamText, type ModelMessage } from "ai";
import { db } from "@/lib/db";
import { chatSessions, assignees } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildToolSet } from "./tools";
import { setStreamActive } from "@/lib/streaming/manager";
import { createConfirmation } from "./confirmation";
import { getModelProvider } from "./model";
import { getSessionMessages, insertMessages } from "@/lib/db/messages";
import { refreshAccessToken } from "@/lib/auth/refresh";

import { DEFAULT_MODEL, availableModelSchema } from "./models";

const MAX_STEPS = 10;

/** Annotate a tool-call content part with confirmation info */
export function annotateToolCallConfirmation(
  messages: ModelMessage[],
  toolCallId: string,
  confirmationId: string,
  status: string,
): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        part.confirmation = { id: confirmationId, status };
        return;
      }
    }
  }
}

/** Annotate a tool-call content part with error info */
export function annotateToolCallError(
  messages: ModelMessage[],
  toolCallId: string,
  error: string,
): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        part.error = error;
        return;
      }
    }
  }
}

/** Unwrap SDK tool output — AI SDK v6 may wrap as { type: "json", value: ... } */
function unwrapToolOutput(output: unknown): unknown {
  if (typeof output === "object" && output !== null) {
    const obj = output as Record<string, unknown>;
    if (obj.type === "json" && "value" in obj) return obj.value;
  }
  return output;
}

/** Check if a tool-result content part represents an error */
function isToolResultError(part: Record<string, unknown>): boolean {
  if ("isError" in part && part.isError) return true;
  const output = unwrapToolOutput(part.output);
  if (
    typeof output === "object" &&
    output !== null &&
    "error" in (output as Record<string, unknown>)
  )
    return true;
  return false;
}

/** Extract error string from a tool-result content part */
function extractToolResultError(part: Record<string, unknown>): string {
  const output = unwrapToolOutput(part.output) as
    | Record<string, unknown>
    | undefined;
  if (typeof output === "object" && output !== null && "error" in output) {
    return String(output.error);
  }
  if ("error" in part) return String(part.error);
  return "Unknown error";
}

/** Annotate auto-confirmed tool-result content parts with approveStatus */
function annotateAutoApproved(messages: ModelMessage[]): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-result" && !part.approveStatus) {
        part.approveStatus = "auto-approved";
      }
    }
  }
}

/** Ensure each message has an id */
function sanitizeMessages(
  messages: ModelMessage[],
  messageId?: string,
): ModelMessage[] {
  return messages.map((msg, i) => {
    const record = msg as Record<string, unknown>;
    // Assign provided messageId to the first message (assistant), generate for others (tool)
    const id =
      record.id ?? (i === 0 && messageId ? messageId : crypto.randomUUID());
    return { ...record, id } as unknown as ModelMessage;
  });
}

export function buildSystemPrompt(
  assignee?: { name: string; personality: string | null } | null,
): string {
  if (!assignee) return "You are a helpful personal assistant.";
  if (assignee.personality) return assignee.personality;
  return `You are ${assignee.name}, a helpful personal assistant.`;
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
  let assignee: {
    name: string;
    personality: string | null;
    model: string | null;
  } | null = null;
  let modelId = DEFAULT_MODEL;

  if (session.assigneeId) {
    const [found] = await db
      .select({
        name: assignees.name,
        personality: assignees.personality,
        model: assignees.model,
      })
      .from(assignees)
      .where(eq(assignees.id, session.assigneeId));

    if (found) {
      assignee = found;
      if (found.model) {
        const parsed = availableModelSchema.safeParse(found.model);
        modelId = parsed.success ? parsed.data : DEFAULT_MODEL;
      }
    }
  }

  const systemPrompt = buildSystemPrompt(assignee);

  // Ensure we have a valid access token, refresh if needed
  let accessToken = session.accessToken || "";

  if (!accessToken && session.refreshToken) {
    // No access token but we have refresh token, try to refresh
    const refreshed = await refreshAccessToken(session.refreshToken);
    if (refreshed) {
      accessToken = refreshed.accessToken;
      // Update session with new tokens
      await db
        .update(chatSessions)
        .set({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(chatSessions.id, sessionId));
    }
  }

  const { tools } = await buildToolSet(
    userId,
    session.assigneeId ?? null,
    accessToken,
  );
  const messages = await getSessionMessages(sessionId);

  await setStreamActive(sessionId, true);

  // Update session status
  await db
    .update(chatSessions)
    .set({ status: "in_progress", updatedAt: sql`(datetime('now'))` })
    .where(eq(chatSessions.id, sessionId));

  await onEvent?.("status", { status: "in_progress" });

  let stepCount = 0;
  let currentMessages: ModelMessage[] = [...messages];
  let persistedCount = messages.length;

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

      // Track tool-approval-request parts emitted by SDK for needsApproval tools
      const pendingApprovals: Array<{
        approvalId: string;
        toolCall: { toolCallId: string; toolName: string; input: unknown };
      }> = [];

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
            const output = "output" in part ? part.output : undefined;
            const partRecord = part as unknown as Record<string, unknown>;
            const hasError = isToolResultError(partRecord);
            const eventData: Record<string, unknown> = {
              id,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output,
            };
            if (hasError) {
              eventData.isError = true;
              eventData.error = extractToolResultError(partRecord);
            }
            await onEvent?.("tool-result", eventData);
            break;
          }
          case "tool-approval-request": {
            pendingApprovals.push({
              approvalId: (part as unknown as { approvalId: string })
                .approvalId,
              toolCall: (
                part as unknown as {
                  toolCall: {
                    toolCallId: string;
                    toolName: string;
                    input: unknown;
                  };
                }
              ).toolCall,
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

      if (finishReason === "tool-calls" && pendingApprovals.length > 0) {
        // SDK detected tools needing approval — create confirmation and pause
        const approval = pendingApprovals[0];
        const confirmation = await createConfirmation({
          userId,
          chatSessionId: sessionId,
          toolCallId: approval.toolCall.toolCallId,
          toolName: approval.toolCall.toolName,
          approvalId: approval.approvalId,
          parameters: (approval.toolCall.input ?? {}) as Record<
            string,
            unknown
          >,
        });

        // Annotate the tool-call content part with confirmation info
        annotateToolCallConfirmation(
          currentMessages,
          approval.toolCall.toolCallId,
          confirmation.id,
          "pending",
        );

        // Persist new messages and update session status
        await insertMessages(sessionId, currentMessages.slice(persistedCount));
        persistedCount = currentMessages.length;
        await db
          .update(chatSessions)
          .set({
            status: "waiting_confirmation",
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(chatSessions.id, sessionId));

        await onEvent?.("confirmation_required", {
          confirmationId: confirmation.id,
          toolCallId: approval.toolCall.toolCallId,
          toolName: approval.toolCall.toolName,
          parameters: approval.toolCall.input,
        });

        await setStreamActive(sessionId, false);
        return { paused: true, reason: "confirmation_required" };
      }

      if (finishReason === "tool-calls") {
        // All tools auto-executed by SDK — annotate and continue
        const newMessages = currentMessages.slice(
          currentMessages.length - responseMessages.length,
        );
        annotateAutoApproved(newMessages);

        // Annotate tool-call parts with error info from tool-result parts
        for (const msg of newMessages) {
          if (!Array.isArray(msg.content)) continue;
          for (const part of msg.content as Record<string, unknown>[]) {
            if (part.type === "tool-result" && isToolResultError(part)) {
              const errorStr = extractToolResultError(part);
              annotateToolCallError(
                currentMessages,
                part.toolCallId as string,
                errorStr,
              );
            }
          }
        }

        continue;
      }

      // Agent finished (stop, length, etc.)
      break;
    }

    // Persist new messages and mark session as stopped
    await insertMessages(sessionId, currentMessages.slice(persistedCount));
    persistedCount = currentMessages.length;
    await db
      .update(chatSessions)
      .set({
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, sessionId));

    await onEvent?.("status", { status: "stopped" });
    await onEvent?.("done", {});
    await setStreamActive(sessionId, false);

    return { paused: false, reason: "completed" };
  } catch (error) {
    // Persist whatever we have and mark as stopped
    await insertMessages(sessionId, currentMessages.slice(persistedCount));
    persistedCount = currentMessages.length;
    await db
      .update(chatSessions)
      .set({
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, sessionId));

    await setStreamActive(sessionId, false);
    await onEvent?.("error", { error: String(error) });
    throw error;
  }
}
