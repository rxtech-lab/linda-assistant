import crypto from "crypto";
import { streamText, type ModelMessage } from "ai";
import { db } from "@/lib/db";
import { chatSessions, assignees, confirmations } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { buildToolSet } from "./tools";
import { setStreamActive } from "@/lib/streaming/manager";
import { createConfirmation } from "./confirmation";
import { getModelProvider } from "./model";
import { getSessionMessages, insertMessages } from "@/lib/db/messages";
import { refreshAccessToken } from "@/lib/auth/refresh";
import {
	prepareMessages,
	extractTextFromMessage,
} from "./compaction";
import { createMem0Client } from "@/lib/mem0/client";

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

/** Custom annotation keys added to content parts for frontend/persistence (not for the model) */
const CUSTOM_ANNOTATIONS = ["confirmation", "error", "approveStatus"];

/** Recognized output types in the AI SDK v6 outputSchema discriminated union */
const VALID_OUTPUT_TYPES = new Set([
  "text",
  "json",
  "execution-denied",
  "error-text",
  "content",
]);

/**
 * Normalize a tool-result output to match the AI SDK v6 `outputSchema` discriminated union.
 * SDK auto-executed tools already produce wrapped output (`{ type: "json", value: ... }`),
 * but manually created tool-results (from resolvePendingToolCalls / resolveConfirmation)
 * use raw objects. This wraps them appropriately.
 */
function normalizeToolResultOutput(
  output: unknown,
  hasIsError: boolean,
): Record<string, unknown> {
  // Already a valid SDK output format
  if (
    typeof output === "object" &&
    output !== null &&
    "type" in (output as Record<string, unknown>) &&
    VALID_OUTPUT_TYPES.has(
      (output as Record<string, unknown>).type as string,
    )
  ) {
    return output as Record<string, unknown>;
  }

  // Error output → error-text
  if (hasIsError) {
    const errorMsg =
      typeof output === "object" &&
      output !== null &&
      "error" in (output as Record<string, unknown>)
        ? String((output as Record<string, unknown>).error)
        : String(output);
    return { type: "error-text", value: errorMsg };
  }

  // Normal output → json
  return { type: "json", value: output };
}

/**
 * Clean messages so they conform to the AI SDK's ModelMessage schema for input.
 * - Strips `tool-approval-request` parts from assistant messages
 * - Removes custom annotations from content parts
 * - Drops `tool-approval-response` messages entirely
 * - Normalizes tool-result output to match SDK `outputSchema`
 * - Removes `isError` field (not in SDK schema)
 */
function cleanMessagesForModel(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const msg of messages) {
    const record = msg as Record<string, unknown>;

    // Drop tool-approval-response messages entirely
    if (Array.isArray(msg.content)) {
      const parts = msg.content as Record<string, unknown>[];
      if (parts.some((p) => p.type === "tool-approval-response")) continue;
    }

    if (!Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    // Clean content parts
    const cleanedParts: Record<string, unknown>[] = [];
    for (const part of msg.content as Record<string, unknown>[]) {
      // Strip tool-approval-request from assistant messages
      if (part.type === "tool-approval-request") continue;

      // Clone and remove custom annotations + isError
      const cleaned = { ...part };
      for (const key of CUSTOM_ANNOTATIONS) {
        delete cleaned[key];
      }

      // Normalize tool-result output for SDK schema
      if (cleaned.type === "tool-result" && cleaned.output !== undefined) {
        cleaned.output = normalizeToolResultOutput(
          cleaned.output,
          cleaned.isError === true,
        );
        delete cleaned.isError;
      }

      cleanedParts.push(cleaned);
    }

    // Skip messages with no remaining content parts
    if (cleanedParts.length === 0) continue;

    result.push({
      ...record,
      content: cleanedParts,
    } as unknown as ModelMessage);
  }
  return result;
}

export function buildSystemPrompt(
  assignee?: { name: string; personality: string | null } | null,
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const dateLine = `\nToday's date is ${today}.`;

  if (!assignee) return `You are a helpful personal assistant.${dateLine}`;
  if (assignee.personality) return `${assignee.personality}${dateLine}`;
  return `You are ${assignee.name}, a helpful personal assistant.${dateLine}`;
}

/**
 * Resolve any tool-calls that lack matching tool-results before starting the agent loop.
 * This handles the confirmation resume flow: when the agent paused for approval, the saved
 * messages contain tool-call parts without tool-results. We execute confirmed tools or
 * create error results for rejected/orphaned ones so streamText won't throw
 * AI_MissingToolResultsError.
 */
async function resolvePendingToolCalls(
  sessionId: string,
  messages: ModelMessage[],
  tools: Record<string, unknown>,
  onEvent?: (event: string, data: unknown) => void | Promise<void>,
): Promise<{ messages: ModelMessage[]; persistCount: number }> {
  // Collect all tool-call IDs and tool-result IDs
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();
  const toolCallInfo = new Map<
    string,
    { toolName: string; input: unknown }
  >();

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && typeof part.toolCallId === "string") {
        toolCallIds.add(part.toolCallId);
        toolCallInfo.set(part.toolCallId, {
          toolName: part.toolName as string,
          input: part.input ?? part.args,
        });
      }
      if (part.type === "tool-result" && typeof part.toolCallId === "string") {
        toolResultIds.add(part.toolCallId);
      }
    }
  }

  // Find unresolved: tool-calls without matching tool-results
  const unresolved = [...toolCallIds].filter((id) => !toolResultIds.has(id));
  if (unresolved.length === 0) {
    return { messages, persistCount: 0 };
  }

  let cleaned = [...messages];

  const newMessages: ModelMessage[] = [];

  for (const toolCallId of unresolved) {
    const info = toolCallInfo.get(toolCallId);
    if (!info) continue;

    // Query confirmations table for this tool call
    const [confirmation] = await db
      .select()
      .from(confirmations)
      .where(eq(confirmations.toolCallId, toolCallId));

    let resultMessage: ModelMessage;

    if (confirmation?.status === "confirmed") {
      // Execute the tool
      const toolDef = tools[info.toolName] as
        | { execute?: (input: unknown) => Promise<unknown> }
        | undefined;

      let output: unknown;
      let isError = false;
      try {
        if (toolDef?.execute) {
          output = await toolDef.execute(
            typeof info.input === "string"
              ? JSON.parse(info.input)
              : info.input,
          );
        } else {
          output = { error: "Tool not found or has no execute function" };
          isError = true;
        }
      } catch (err) {
        output = {
          error: err instanceof Error ? err.message : String(err),
        };
        isError = true;
      }

      resultMessage = {
        id: crypto.randomUUID(),
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId,
            toolName: info.toolName,
            output,
            ...(isError ? { isError: true } : {}),
          },
        ],
      } as unknown as ModelMessage;

      // Emit tool-result event
      const eventData: Record<string, unknown> = {
        toolCallId,
        toolName: info.toolName,
        output,
      };
      if (isError) {
        eventData.isError = true;
        eventData.error =
          typeof output === "object" &&
          output !== null &&
          "error" in (output as Record<string, unknown>)
            ? String((output as Record<string, unknown>).error)
            : "Unknown error";
      }
      await onEvent?.("tool-result", eventData);
    } else if (confirmation?.status === "rejected") {
      // Safety: rejection should already have a tool-result from resolveConfirmation,
      // but create one if somehow missing
      resultMessage = {
        id: crypto.randomUUID(),
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId,
            toolName: info.toolName,
            output: { error: "User rejected this action" },
            isError: true,
          },
        ],
      } as unknown as ModelMessage;

      await onEvent?.("tool-result", {
        toolCallId,
        toolName: info.toolName,
        output: { error: "User rejected this action" },
        isError: true,
        error: "User rejected this action",
      });
    } else {
      // No confirmation found (orphaned from multi-tool step) or still pending
      resultMessage = {
        id: crypto.randomUUID(),
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId,
            toolName: info.toolName,
            output: { error: "Tool execution interrupted" },
            isError: true,
          },
        ],
      } as unknown as ModelMessage;

      await onEvent?.("tool-result", {
        toolCallId,
        toolName: info.toolName,
        output: { error: "Tool execution interrupted" },
        isError: true,
        error: "Tool execution interrupted",
      });
    }

    newMessages.push(resultMessage);
  }

  // Persist new tool-result messages and append to message array
  if (newMessages.length > 0) {
    await insertMessages(sessionId, newMessages);
    cleaned = [...cleaned, ...newMessages];
  }

  return { messages: cleaned, persistCount: newMessages.length };
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

  let systemPrompt = buildSystemPrompt(assignee);

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

  // Search mem0 for relevant long-term memories
  const mem0 = createMem0Client();
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg) {
    const userText = extractTextFromMessage(lastUserMsg);
    if (userText) {
      const memories = await mem0.searchMemories(userText, userId, {
        agentId: session.assigneeId ?? undefined,
        limit: 10,
      });
      if (memories.length > 0) {
        systemPrompt += `\n\n<long_term_memory>\n${memories.map((m) => `- ${m}`).join("\n")}\n</long_term_memory>`;
      }
    }
  }

  await setStreamActive(sessionId, true);

  // Update session status
  await db
    .update(chatSessions)
    .set({ status: "in_progress", updatedAt: sql`(datetime('now'))` })
    .where(eq(chatSessions.id, sessionId));

  await onEvent?.("status", { status: "in_progress" });

  // Resolve any pending tool-calls from a previous confirmation pause
  const preprocessed = await resolvePendingToolCalls(
    sessionId,
    messages,
    tools,
    onEvent,
  );

  let stepCount = 0;
  let currentMessages: ModelMessage[] = [...preprocessed.messages];
  let persistedCount = messages.length + preprocessed.persistCount;

  try {
    while (stepCount < MAX_STEPS) {
      if (signal?.aborted) break;

      stepCount++;

      // Compact history if approaching context limits (prepareStep equivalent)
      const compactionResult = await prepareMessages({
        sessionId,
        userId,
        messages: currentMessages,
        modelId,
        systemPrompt,
        assigneeId: session.assigneeId,
        onEvent,
      });
      if (compactionResult.compacted) {
        currentMessages = compactionResult.messages;
        // DB was updated by compaction; recalculate persisted count
        persistedCount = currentMessages.length;
      }

      // Stable id for this step — all stream events share it,
      // and the stored assistant message gets the same id for deduplication
      const id = crypto.randomUUID();

      const result = streamText({
        model: getModelProvider(modelId),
        system: systemPrompt,
        messages: cleanMessagesForModel(currentMessages),
        tools: tools as Parameters<typeof streamText>[0]["tools"],
        abortSignal: signal,
      });

      // Track tool-approval-request parts emitted by SDK for needsApproval tools
      const pendingApprovals: Array<{
        approvalId: string;
        toolCall: { toolCallId: string; toolName: string; input: unknown };
      }> = [];

      // eslint-disable-next-line no-labels -- labeled break needed to exit from inside switch
      streamLoop: for await (const part of result.fullStream) {
        if (signal?.aborted) break streamLoop;

        switch (part.type) {
          case "text-delta": {
            onTextChunk?.(part.text);
            await onEvent?.("text-delta", { id, text: part.text });
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "tool-call": {
            await onEvent?.("tool-call", {
              id,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              input: "input" in part ? part.input : undefined,
            });
            if (signal?.aborted) break streamLoop;
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
            if (signal?.aborted) break streamLoop;
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
        // SDK detected tools needing approval — create confirmations for ALL and pause
        for (const approval of pendingApprovals) {
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

          await onEvent?.("confirmation_required", {
            confirmationId: confirmation.id,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            parameters: approval.toolCall.input,
          });
        }

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

    // Fire-and-forget: send new turn messages to mem0 for long-term memory
    const newTurnMessages = currentMessages.slice(messages.length);
    if (newTurnMessages.length > 0) {
      mem0
        .addMemories(
          newTurnMessages.map((m) => ({
            role: m.role,
            content: extractTextFromMessage(m),
          })),
          userId,
          { agentId: session.assigneeId ?? undefined, runId: sessionId },
        )
        .catch((err) =>
          console.warn("[agent] mem0 addMemories failed:", err),
        );
    }

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
