import { type ModelMessage, streamText } from "ai";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { refreshAccessToken } from "@/lib/auth/refresh";
import { db } from "@/lib/db";
import {
  getActiveSessionMessages,
  insertMessageAfter,
  insertMessages,
  updateMessageContent,
} from "@/lib/db/messages";
import { assignees, chatSessions, confirmations, questions } from "@/lib/db/schema";
import { createMem0Client } from "@/lib/mem0/client";
import { redis } from "@/lib/redis";
import { setStreamActive } from "@/lib/streaming/manager";
import { extractTextFromMessage, prepareMessages } from "./compaction";
import { createConfirmation, sendConfirmationGroupNotification } from "./confirmation";
import { createLocationRequest } from "./location";
import { createQuestion, sendQuestionGroupNotification } from "./question";
import { ASK_QUESTION_TOOL_NAME } from "./tools/ask-question";
import { GET_LOCATION_TOOL_NAME } from "./tools/get-location";
import { getModelProvider } from "./model";
import { availableModelSchema, DEFAULT_MODEL } from "./models";
import { buildToolSet } from "./tools";
import { resolvePermission, loadAssigneePermissions } from "./tools/permission";

const MAX_STEPS = 20;

/** Annotate a tool-call content part with confirmation info */
export function annotateToolCallConfirmation(
  messages: ModelMessage[],
  toolCallId: string,
  confirmationId: string,
  status: string,
  extra?: Record<string, unknown>,
): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        part.confirmation = { id: confirmationId, status, ...extra };
        return;
      }
    }
  }
}

/** Annotate a tool-call content part with question info */
export function annotateToolCallQuestion(
  messages: ModelMessage[],
  toolCallId: string,
  questionId: string,
  status: string,
): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        part.question = { id: questionId, status };
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
  const output = unwrapToolOutput(part.output) as Record<string, unknown> | undefined;
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
function sanitizeMessages(messages: ModelMessage[], messageId?: string): ModelMessage[] {
  return messages.map((msg, i) => {
    const record = msg as Record<string, unknown>;
    // Assign provided messageId to the first message (assistant), generate for others (tool)
    const id = record.id ?? (i === 0 && messageId ? messageId : crypto.randomUUID());
    return { ...record, id } as unknown as ModelMessage;
  });
}

/** Custom annotation keys added to content parts for frontend/persistence (not for the model) */
const CUSTOM_ANNOTATIONS = ["confirmation", "question", "error", "approveStatus", "isAutoConfirm"];

/** Recognized output types in the AI SDK v6 outputSchema discriminated union */
const VALID_OUTPUT_TYPES = new Set(["text", "json", "execution-denied", "error-text", "content"]);

/**
 * Normalize a tool-result output to match the AI SDK v6 `outputSchema` discriminated union.
 * SDK auto-executed tools already produce wrapped output (`{ type: "json", value: ... }`),
 * but manually created tool-results (from resolvePendingToolCalls / resolveConfirmation)
 * use raw objects. This wraps them appropriately.
 */
function normalizeToolResultOutput(output: unknown, hasIsError: boolean): Record<string, unknown> {
  // Already a valid SDK output format
  if (
    typeof output === "object" &&
    output !== null &&
    "type" in (output as Record<string, unknown>) &&
    VALID_OUTPUT_TYPES.has((output as Record<string, unknown>).type as string)
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
export function cleanMessagesForModel(messages: ModelMessage[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  for (const msg of messages) {
    const record = msg as Record<string, unknown>;

    // Drop tool-approval-response messages entirely
    if (Array.isArray(msg.content)) {
      const parts = msg.content as Record<string, unknown>[];
      if (parts.some((p) => p.type === "tool-approval-response")) continue;
    }

    // Strip internal metadata that shouldn't reach the model
    const { seq: _seq, isCompacted: _ic, ...cleanRecord } = record;

    if (!Array.isArray(msg.content)) {
      result.push(cleanRecord as unknown as ModelMessage);
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
        cleaned.output = normalizeToolResultOutput(cleaned.output, cleaned.isError === true);
        delete cleaned.isError;
      }

      cleanedParts.push(cleaned);
    }

    // Skip messages with no remaining content parts
    if (cleanedParts.length === 0) continue;

    result.push({
      ...cleanRecord,
      content: cleanedParts,
    } as unknown as ModelMessage);
  }
  // Safety net: The AI SDK requires every tool-call to have a matching tool-result
  // immediately after the assistant message. Tool-results may exist elsewhere in the
  // array (e.g., appended at the end) or may be missing entirely. This pass:
  // 1. Collects all tool-result parts into a lookup (removing them from their current position)
  // 2. Rebuilds the array, placing tool-results right after their assistant messages
  // 3. Injects synthetic results for any tool-calls that still have no result

  // Step 1: Extract all tool-result parts into a map, keyed by toolCallId
  // Also preserve providerMetadata from tool messages (needed for Gemini thought signatures)
  const toolResultByCallId = new Map<string, Record<string, unknown>>();
  const toolMsgMetadataByCallId = new Map<string, Record<string, unknown>>();
  const toolResultMsgIndices = new Set<number>();
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role !== "tool" || !Array.isArray(msg.content)) continue;
    const msgRecord = msg as Record<string, unknown>;
    const parts = msg.content as Record<string, unknown>[];
    for (const part of parts) {
      if (part.type === "tool-result" && typeof part.toolCallId === "string") {
        toolResultByCallId.set(part.toolCallId, part);
        toolResultMsgIndices.add(i);
        // Capture providerMetadata from the original tool message
        if (msgRecord.providerMetadata || msgRecord.providerOptions) {
          toolMsgMetadataByCallId.set(part.toolCallId, {
            ...(msgRecord.providerMetadata ? { providerMetadata: msgRecord.providerMetadata } : {}),
            ...(msgRecord.providerOptions ? { providerOptions: msgRecord.providerOptions } : {}),
          });
        }
      }
    }
  }

  // Step 2: Rebuild, inserting tool-results right after their assistant messages
  const placedCallIds = new Set<string>();
  const finalResult: ModelMessage[] = [];
  for (let i = 0; i < result.length; i++) {
    // Skip tool-result messages — they'll be re-inserted after their assistant messages
    if (toolResultMsgIndices.has(i)) continue;

    finalResult.push(result[i]);

    // After each assistant message, place matching tool-results
    const msg = result[i];
    if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;

    const neededResults: Record<string, unknown>[] = [];
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type !== "tool-call" || typeof part.toolCallId !== "string") continue;
      const toolCallId = part.toolCallId;
      const toolName = (part.toolName as string) ?? "unknown";

      const existingResult = toolResultByCallId.get(toolCallId);
      if (existingResult) {
        neededResults.push(existingResult);
      } else {
        console.warn(
          `[cleanMessagesForModel] Injecting missing tool-result for toolCallId=${toolCallId} toolName=${toolName}`,
        );
        neededResults.push({
          type: "tool-result",
          toolCallId,
          toolName,
          output: { type: "error-text", value: "Tool execution was interrupted" },
        });
      }
      placedCallIds.add(toolCallId);
    }

    if (neededResults.length > 0) {
      // Collect providerMetadata from the original tool messages for these results
      const metadata: Record<string, unknown> = {};
      for (const part of neededResults) {
        const callId = part.toolCallId as string;
        const meta = toolMsgMetadataByCallId.get(callId);
        if (meta) Object.assign(metadata, meta);
      }
      finalResult.push({
        role: "tool",
        content: neededResults,
        ...metadata,
      } as unknown as ModelMessage);
    }
  }

  // Step 3: Append any remaining tool-results that didn't match an assistant message
  for (const i of toolResultMsgIndices) {
    const msg = result[i];
    if (!Array.isArray(msg.content)) continue;
    const parts = msg.content as Record<string, unknown>[];
    const unplaced = parts.filter(
      (p) =>
        p.type === "tool-result" &&
        typeof p.toolCallId === "string" &&
        !placedCallIds.has(p.toolCallId as string),
    );
    if (unplaced.length > 0) {
      // Preserve providerMetadata from the original tool message
      const msgRecord = msg as Record<string, unknown>;
      const metadata: Record<string, unknown> = {};
      if (msgRecord.providerMetadata) metadata.providerMetadata = msgRecord.providerMetadata;
      if (msgRecord.providerOptions) metadata.providerOptions = msgRecord.providerOptions;
      finalResult.push({ role: "tool", content: unplaced, ...metadata } as unknown as ModelMessage);
    }
  }

  return finalResult;
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

  const documentGuidance = `\nWhen your response would be very long (e.g., reports, analyses, comprehensive guides), or when the user explicitly asks for a document/report, use the create_document tool instead of writing it inline. Always prefer markdown format unless the user specifically requests HTML. Do NOT include the title as a heading in the document content — the title is displayed separately by the viewer. After creating a document, do NOT repeat the document content in your response — just confirm you created it and provide a brief summary of what it contains.`;

  const questionGuidance = `\nUse the ask_question tool to gather user input before proceeding in these situations:
- Before taking important or irreversible actions (e.g., sending emails, deleting data, making external API calls) — ask the user to confirm the details are correct.
- When you are unsure about the user's intent, preferences, or requirements — ask clarifying questions rather than guessing.
- When a task has multiple valid approaches and the best choice depends on user preference.
Do NOT overuse it for trivial or obvious decisions. Only ask when the answer genuinely affects the outcome.
If the user rejects your questions, do NOT retry with the same or similar questions. Acknowledge the rejection and proceed without that information, using reasonable defaults or skipping the action.`;

  const locationGuidance = `\nUse the get_location tool when you need the user's current GPS coordinates — for example, to find nearby places, get local weather, provide directions, or give location-based recommendations. The user will be asked to share their location and may decline. Do NOT request location unless it is clearly relevant to the user's request.`;

  if (!assignee)
    return `You are a helpful personal assistant.${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}`;
  if (assignee.personality)
    return `${assignee.personality}${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}`;
  return `You are ${assignee.name}, a helpful personal assistant.${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}`;
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
  taskType?: "message" | "confirmation_resolved" | "question_resolved" | "location_resolved",
): Promise<{ messages: ModelMessage[]; persistCount: number }> {
  // Collect all tool-call IDs and tool-result IDs
  const toolCallIds = new Set<string>();
  const toolResultIds = new Set<string>();
  const toolCallInfo = new Map<string, { toolName: string; input: unknown }>();

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

  console.log(
    `[resolvePendingToolCalls] session=${sessionId} toolCalls=${toolCallIds.size} toolResults=${toolResultIds.size} unresolved=${unresolved.length}` +
      (unresolved.length > 0
        ? ` ids=${unresolved.map((id) => `${id}(${toolCallInfo.get(id)?.toolName ?? "?"})`).join(",")}`
        : ""),
  );

  if (unresolved.length === 0) {
    return { messages, persistCount: 0 };
  }

  let cleaned = [...messages];

  const newMessages: ModelMessage[] = [];

  // When the user sent a new message (taskType="message"), don't execute any tools —
  // just mark all unresolved tool calls as "cancelled" so the model sees a result
  // and the frontend renders them as stopped.
  if (taskType === "message") {
    for (const toolCallId of unresolved) {
      const info = toolCallInfo.get(toolCallId);
      if (!info) continue;

      console.log(
        `[agent] Cancelling unresolved tool: ${info.toolName} (toolCallId=${toolCallId}) — user sent new message`,
      );

      // Update confirmation or question status to "cancelled" in DB if one exists
      await db
        .update(confirmations)
        .set({
          status: "cancelled",
          resolvedAt: sql`(datetime('now'))`,
        })
        .where(eq(confirmations.toolCallId, toolCallId));
      await db
        .update(questions)
        .set({
          status: "rejected",
          answeredAt: sql`(datetime('now'))`,
        })
        .where(eq(questions.toolCallId, toolCallId));

      // Update the tool-call annotation in messages so it persists as "cancelled".
      // Check for both confirmation and question annotations.
      let existingConfirmationId = "";
      let existingQuestionId = "";
      for (const msg of cleaned) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Record<string, unknown>[]) {
          if (part.type === "tool-call" && part.toolCallId === toolCallId) {
            const conf = part.confirmation as { id?: string } | undefined;
            if (conf?.id) existingConfirmationId = conf.id;
            const quest = part.question as { id?: string } | undefined;
            if (quest?.id) existingQuestionId = quest.id;
          }
        }
      }
      if (existingQuestionId) {
        annotateToolCallQuestion(cleaned, toolCallId, existingQuestionId, "rejected");
      } else {
        annotateToolCallConfirmation(cleaned, toolCallId, existingConfirmationId, "cancelled");
      }

      // Persist the updated annotation to DB
      for (const msg of cleaned) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Record<string, unknown>[]) {
          if (part.type === "tool-call" && part.toolCallId === toolCallId) {
            const record = msg as Record<string, unknown>;
            if (record.id) await updateMessageContent(record.id as string, msg.content);
          }
        }
      }

      // Inject a tool-result so the model can continue
      const resultMessage = {
        id: crypto.randomUUID(),
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId,
            toolName: info.toolName,
            output: { error: "User stopped this action" },
            isError: true,
          },
        ],
      } as unknown as ModelMessage;

      await onEvent?.("tool-result", {
        toolCallId,
        toolName: info.toolName,
        output: { error: "User stopped this action" },
        isError: true,
        error: "User stopped this action",
      });

      newMessages.push(resultMessage);
    }
  } else {
    // confirmation_resolved / question_resolved: execute confirmed/answered tools, handle rejected/orphaned
    for (const toolCallId of unresolved) {
      const info = toolCallInfo.get(toolCallId);
      if (!info) continue;

      // Query confirmations table for this tool call
      const [confirmation] = await db
        .select()
        .from(confirmations)
        .where(eq(confirmations.toolCallId, toolCallId));

      // If no confirmation found, check questions table (for ask_question tool)
      const [questionRecord] = !confirmation
        ? await db.select().from(questions).where(eq(questions.toolCallId, toolCallId))
        : [undefined];

      // If no confirmation or question found, check Redis for location request
      let locationStatus: string | null = null;
      if (!confirmation && !questionRecord) {
        const raw = await redis.get(`location:request:${toolCallId}`);
        if (raw) {
          const locReq = typeof raw === "string" ? JSON.parse(raw) : raw;
          locationStatus = locReq.status;
        }
      }

      let resultMessage: ModelMessage;

      if (
        confirmation?.status === "confirmed" ||
        questionRecord?.status === "answered" ||
        locationStatus === "confirmed"
      ) {
        // Signal tool is now running before execution
        await onEvent?.("tool-call", {
          toolCallId,
          toolName: info.toolName,
          input: info.input,
        });

        // Execute the tool
        const toolDef = tools[info.toolName] as
          | { execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown> }
          | undefined;

        let output: unknown;
        let isError = false;
        console.log(
          `[agent] Executing ${confirmation ? "confirmed" : "answered"} tool: ${info.toolName} (toolCallId=${toolCallId})`,
        );
        try {
          if (toolDef?.execute) {
            output = await toolDef.execute(
              typeof info.input === "string" ? JSON.parse(info.input) : info.input,
              { toolCallId },
            );
            console.log(`[agent] Tool ${info.toolName} completed successfully`);
          } else {
            output = { error: "Tool not found or has no execute function" };
            isError = true;
            console.error(`[agent] Tool ${info.toolName} not found or has no execute function`);
          }
        } catch (err) {
          output = {
            error: err instanceof Error ? err.message : String(err),
          };
          isError = true;
          console.error(
            `[agent] Tool ${info.toolName} execution failed:`,
            err instanceof Error ? err.stack : err,
          );
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

        // Safety net: ensure the tool-call annotation reflects the resolved status.
        // resolveConfirmation/resolveLocationRequest may have failed to annotate if
        // messages weren't yet persisted when the resolution was processed.
        if (questionRecord) {
          annotateToolCallQuestion(cleaned, toolCallId, questionRecord.id, "answered");
        } else {
          const confId = confirmation?.id ?? toolCallId;
          annotateToolCallConfirmation(cleaned, toolCallId, confId, "confirmed");
        }
        for (const msg of cleaned) {
          if (!Array.isArray(msg.content)) continue;
          for (const part of msg.content as Record<string, unknown>[]) {
            if (part.type === "tool-call" && part.toolCallId === toolCallId) {
              const record = msg as Record<string, unknown>;
              if (record.id) await updateMessageContent(record.id as string, msg.content);
            }
          }
        }
      } else if (confirmation?.status === "rejected" || questionRecord?.status === "rejected" || locationStatus === "rejected") {
        // Safety: rejection should already have a tool-result from resolveConfirmation/resolveQuestion,
        // but create one if somehow missing
        const errorMsg = locationStatus === "rejected"
          ? "User declined to share their location"
          : questionRecord
            ? "User rejected all questions"
            : "User rejected this action";
        resultMessage = {
          id: crypto.randomUUID(),
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId,
              toolName: info.toolName,
              output: { error: errorMsg },
              isError: true,
            },
          ],
        } as unknown as ModelMessage;

        await onEvent?.("tool-result", {
          toolCallId,
          toolName: info.toolName,
          output: { error: errorMsg },
          isError: true,
          error: errorMsg,
        });

        // Safety net: ensure the tool-call annotation reflects rejected status
        if (questionRecord) {
          annotateToolCallQuestion(cleaned, toolCallId, questionRecord.id, "rejected");
        } else {
          const confId = confirmation?.id ?? toolCallId;
          annotateToolCallConfirmation(cleaned, toolCallId, confId, "rejected");
        }
        for (const msg of cleaned) {
          if (!Array.isArray(msg.content)) continue;
          for (const part of msg.content as Record<string, unknown>[]) {
            if (part.type === "tool-call" && part.toolCallId === toolCallId) {
              const record = msg as Record<string, unknown>;
              if (record.id) await updateMessageContent(record.id as string, msg.content);
            }
          }
        }
      } else {
        // No confirmation/question found (orphaned from multi-tool step) or still pending
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
  }

  // Insert each tool-result right after the assistant message containing its tool-call
  // in BOTH the in-memory array and the database. The AI SDK requires tool-result messages
  // immediately after the assistant message; appending at the end would break on next DB
  // load when a user message sits between the assistant tool-call and the tool-result.
  if (newMessages.length > 0) {
    // Build a map from toolCallId → tool-result message
    const resultByToolCallId = new Map<string, ModelMessage>();
    for (const msg of newMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "tool-result" && typeof part.toolCallId === "string") {
          resultByToolCallId.set(part.toolCallId, msg);
        }
      }
    }

    // Insert tool-result messages right after their assistant messages (in-memory + DB)
    const reordered: ModelMessage[] = [];
    const inserted = new Set<string>();
    for (const msg of cleaned) {
      reordered.push(msg);
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      const msgId = (msg as Record<string, unknown>).id as string | undefined;
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "tool-call" && typeof part.toolCallId === "string") {
          const resultMsg = resultByToolCallId.get(part.toolCallId);
          if (resultMsg && !inserted.has(part.toolCallId)) {
            reordered.push(resultMsg);
            inserted.add(part.toolCallId);
            // Persist to DB right after the assistant message
            if (msgId) {
              await insertMessageAfter(sessionId, msgId, resultMsg);
            } else {
              await insertMessages(sessionId, [resultMsg]);
            }
          }
        }
      }
    }
    // Append any tool-results that didn't match an assistant message (shouldn't happen)
    for (const msg of newMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as Record<string, unknown>[]) {
        if (
          part.type === "tool-result" &&
          typeof part.toolCallId === "string" &&
          !inserted.has(part.toolCallId)
        ) {
          reordered.push(msg);
          await insertMessages(sessionId, [msg]);
        }
      }
    }
    cleaned = reordered;
  }

  return { messages: cleaned, persistCount: newMessages.length };
}

interface AgentRunOptions {
  sessionId: string;
  userId: string;
  taskType?: "message" | "confirmation_resolved" | "question_resolved" | "location_resolved";
  onTextChunk?: (text: string) => void;
  onEvent?: (event: string, data: unknown) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runAgent(options: AgentRunOptions) {
  const { sessionId, userId, taskType, onTextChunk, onEvent, signal } = options;

  // Load session with messages
  const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));

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

  const { tools } = await buildToolSet(userId, session.assigneeId ?? null, accessToken, sessionId);
  const messages = await getActiveSessionMessages(sessionId);

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

  console.log(
    `[agent] Starting agent run for session=${sessionId} model=${modelId} tools=${Object.keys(tools).join(",")}`,
  );

  // Cancel any stale pending confirmations from previous runs so they don't
  // block the pendingCount check when new confirmations are created this run.
  const staleConfirmations = await db
    .select({ id: confirmations.id })
    .from(confirmations)
    .where(and(eq(confirmations.chatSessionId, sessionId), eq(confirmations.status, "pending")));
  if (staleConfirmations.length > 0) {
    await db
      .update(confirmations)
      .set({
        status: "rejected",
        resolvedAt: sql`(datetime('now'))`,
      })
      .where(and(eq(confirmations.chatSessionId, sessionId), eq(confirmations.status, "pending")));
    console.log(
      `[agent] Cancelled ${staleConfirmations.length} stale pending confirmation(s) for session=${sessionId}: ${staleConfirmations.map((c) => c.id).join(", ")}`,
    );
  }

  // Cancel stale pending questions
  const staleQuestions = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.chatSessionId, sessionId), eq(questions.status, "pending")));
  if (staleQuestions.length > 0) {
    await db
      .update(questions)
      .set({
        status: "rejected",
        answeredAt: sql`(datetime('now'))`,
      })
      .where(and(eq(questions.chatSessionId, sessionId), eq(questions.status, "pending")));
    console.log(
      `[agent] Cancelled ${staleQuestions.length} stale pending question(s) for session=${sessionId}: ${staleQuestions.map((q) => q.id).join(", ")}`,
    );
  }

  await setStreamActive(sessionId, true);

  // Update session status
  await db
    .update(chatSessions)
    .set({ status: "in_progress", updatedAt: sql`(datetime('now'))` })
    .where(eq(chatSessions.id, sessionId));

  await onEvent?.("status", { status: "in_progress" });

  // Resolve any pending tool-calls from a previous confirmation pause
  const preprocessed = await resolvePendingToolCalls(sessionId, messages, tools, onEvent, taskType);

  let stepCount = 0;
  let currentMessages: ModelMessage[] = [...preprocessed.messages];
  let persistedCount = messages.length + preprocessed.persistCount;

  try {
    while (stepCount < MAX_STEPS) {
      if (signal?.aborted) break;

      stepCount++;
      console.log(`[agent] Step ${stepCount}/${MAX_STEPS} for session=${sessionId}`);

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
            console.log(
              `[agent] Tool call: ${part.toolName} (toolCallId=${part.toolCallId})`,
              JSON.stringify("input" in part ? part.input : {}).slice(0, 500),
            );
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
              console.error(
                `[agent] Tool ${part.toolName} returned error (toolCallId=${part.toolCallId}):`,
                eventData.error,
              );
            } else {
              console.log(
                `[agent] Tool ${part.toolName} completed (toolCallId=${part.toolCallId})`,
              );
            }
            await onEvent?.("tool-result", eventData);
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "tool-approval-request": {
            pendingApprovals.push({
              approvalId: (part as unknown as { approvalId: string }).approvalId,
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
          case "tool-error": {
            const errorPart = part as unknown as {
              toolCallId: string;
              toolName: string;
              error: unknown;
            };
            const errorStr =
              errorPart.error instanceof Error ? errorPart.error.message : String(errorPart.error);
            console.error(
              `[agent] Tool error: ${errorPart.toolName} (toolCallId=${errorPart.toolCallId}):`,
              errorPart.error instanceof Error ? errorPart.error.stack : errorStr,
            );
            await onEvent?.("tool-result", {
              id,
              toolCallId: errorPart.toolCallId,
              toolName: errorPart.toolName,
              output: { error: errorStr },
              isError: true,
              error: errorStr,
            });
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "error": {
            console.error(`[agent] Stream error:`, part.error);
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

      console.log(
        `[agent] Step ${stepCount} finished: reason=${finishReason} responseMessages=${responseMessages.length}`,
      );

      if (finishReason === "tool-calls" && pendingApprovals.length > 0) {
        // Separate question, location, and confirmation approvals
        const questionApprovals = pendingApprovals.filter(
          (a) => a.toolCall.toolName === ASK_QUESTION_TOOL_NAME,
        );
        const locationApprovals = pendingApprovals.filter(
          (a) => a.toolCall.toolName === GET_LOCATION_TOOL_NAME,
        );
        const confirmationApprovals = pendingApprovals.filter(
          (a) =>
            a.toolCall.toolName !== ASK_QUESTION_TOOL_NAME &&
            a.toolCall.toolName !== GET_LOCATION_TOOL_NAME,
        );

        // Handle question approvals (create records + annotate in-memory, no events yet)
        const createdQuestions: Array<{ questionId: string; questionCount: number }> = [];
        const questionEvents: Array<{
          questionId: string;
          toolCallId: string;
          toolName: string;
          questions: unknown;
        }> = [];
        for (const approval of questionApprovals) {
          const input = (approval.toolCall.input ?? {}) as Record<string, unknown>;
          const questionsData = (input.questions ?? []) as Array<{
            title: string;
            description?: string;
            type: "boolean" | "multiple_choice" | "single_choice" | "fill_in_blank";
            options?: Array<{ title: string; description?: string }>;
          }>;

          const question = await createQuestion({
            userId,
            chatSessionId: sessionId,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            approvalId: approval.approvalId,
            questionsData,
            skipNotification: true,
          });

          createdQuestions.push({
            questionId: question.id,
            questionCount: questionsData.length,
          });

          // Annotate the tool-call content part with question info
          annotateToolCallQuestion(
            currentMessages,
            approval.toolCall.toolCallId,
            question.id,
            "pending",
          );

          questionEvents.push({
            questionId: question.id,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            questions: questionsData,
          });
        }

        // Handle location approvals (create records + annotate in-memory, no events yet)
        let hasLocationRequest = false;
        const locationEvents: Array<{
          toolCallId: string;
          toolName: string;
          reason: unknown;
          isAutoConfirm: boolean;
        }> = [];
        for (const approval of locationApprovals) {
          const input = (approval.toolCall.input ?? {}) as Record<string, unknown>;

          // Check assignee permission for auto-confirm vs manual-confirm
          const [session] = await db
            .select({ assigneeId: chatSessions.assigneeId })
            .from(chatSessions)
            .where(eq(chatSessions.id, sessionId));
          const toolPermissions = session?.assigneeId
            ? await loadAssigneePermissions(session.assigneeId)
            : null;
          const perm = resolvePermission(GET_LOCATION_TOOL_NAME, toolPermissions);
          const isAutoConfirm = perm === "auto-confirm";

          await createLocationRequest({
            userId,
            chatSessionId: sessionId,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            approvalId: approval.approvalId,
            reason: input.reason as string | undefined,
            isAutoConfirm,
          });

          // Annotate the tool-call content part
          annotateToolCallConfirmation(
            currentMessages,
            approval.toolCall.toolCallId,
            approval.toolCall.toolCallId,
            "pending",
          );

          // Also store isAutoConfirm directly on the tool-call part for history reload
          if (isAutoConfirm) {
            for (const msg of currentMessages) {
              if (!Array.isArray(msg.content)) continue;
              for (const part of msg.content as Record<string, unknown>[]) {
                if (part.type === "tool-call" && part.toolCallId === approval.toolCall.toolCallId) {
                  part.isAutoConfirm = true;
                }
              }
            }
          }

          locationEvents.push({
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            reason: input.reason,
            isAutoConfirm,
          });

          hasLocationRequest = true;
        }

        // Handle confirmation approvals (create records + annotate in-memory, no events yet)
        const createdConfirmations: Array<{ confirmationId: string; toolName: string }> = [];
        const confirmationEvents: Array<{
          confirmationId: string;
          toolCallId: string;
          toolName: string;
          parameters: unknown;
        }> = [];
        for (const approval of confirmationApprovals) {
          const confirmation = await createConfirmation({
            userId,
            chatSessionId: sessionId,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            approvalId: approval.approvalId,
            parameters: (approval.toolCall.input ?? {}) as Record<string, unknown>,
            skipNotification: true,
          });

          createdConfirmations.push({
            confirmationId: confirmation.id,
            toolName: approval.toolCall.toolName,
          });

          // Annotate the tool-call content part with confirmation info
          annotateToolCallConfirmation(
            currentMessages,
            approval.toolCall.toolCallId,
            confirmation.id,
            "pending",
          );

          confirmationEvents.push({
            confirmationId: confirmation.id,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            parameters: approval.toolCall.input,
          });
        }

        // Persist messages BEFORE emitting events so that resolveConfirmation/
        // resolveLocationRequest/resolveQuestion can find the tool-call messages
        // in the DB when they try to annotate them with confirmed/rejected status.
        await insertMessages(sessionId, currentMessages.slice(persistedCount));
        persistedCount = currentMessages.length;

        // Now emit all events — handlers can safely read messages from DB
        for (const evt of questionEvents) {
          await onEvent?.("question_required", evt);
        }
        for (const evt of locationEvents) {
          await onEvent?.("location_required", evt);
        }
        for (const evt of confirmationEvents) {
          await onEvent?.("confirmation_required", evt);
        }

        // Send grouped push notifications
        if (createdConfirmations.length > 0) {
          await sendConfirmationGroupNotification(userId, sessionId, createdConfirmations);
        }
        if (createdQuestions.length > 0) {
          await sendQuestionGroupNotification(userId, sessionId, createdQuestions);
        }

        // Emit status event so SSE clients know the agent is paused
        const waitingStatus = hasLocationRequest
          ? "waiting_location"
          : createdQuestions.length > 0 && createdConfirmations.length === 0
            ? "waiting_question"
            : "waiting_confirmation";
        await onEvent?.("status", { status: waitingStatus });
        await db
          .update(chatSessions)
          .set({
            status: waitingStatus,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(chatSessions.id, sessionId));

        await setStreamActive(sessionId, false);
        return {
          paused: true,
          reason: hasLocationRequest
            ? "location_required"
            : createdQuestions.length > 0
              ? "question_required"
              : "confirmation_required",
        };
      }

      if (finishReason === "tool-calls") {
        // All tools auto-executed by SDK — annotate and continue
        const newMessages = currentMessages.slice(currentMessages.length - responseMessages.length);
        annotateAutoApproved(newMessages);

        // Annotate tool-call parts with error info from tool-result parts
        for (const msg of newMessages) {
          if (!Array.isArray(msg.content)) continue;
          for (const part of msg.content as Record<string, unknown>[]) {
            if (part.type === "tool-result" && isToolResultError(part)) {
              const errorStr = extractToolResultError(part);
              annotateToolCallError(currentMessages, part.toolCallId as string, errorStr);
            }
          }
        }

        // Persist intermediate messages so they survive crashes and compaction
        await insertMessages(sessionId, currentMessages.slice(persistedCount));
        persistedCount = currentMessages.length;

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
        .catch((err) => console.warn("[agent] mem0 addMemories failed:", err));
    }

    await onEvent?.("status", { status: "stopped" });
    await onEvent?.("done", {});
    await setStreamActive(sessionId, false);

    return { paused: false, reason: "completed" };
  } catch (error) {
    console.error(
      `[agent] Agent run failed for session=${sessionId}:`,
      error instanceof Error ? error.stack : error,
    );
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

    // Emit tool-result error events for any in-flight tool calls so the iOS app
    // can transition from "Running..." to an error state
    for (const msg of currentMessages) {
      if (!Array.isArray(msg.content)) continue;
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "tool-call" && typeof part.toolCallId === "string") {
          // Check if this tool-call has a matching tool-result
          const hasResult = currentMessages.some(
            (m) =>
              Array.isArray(m.content) &&
              (m.content as Record<string, unknown>[]).some(
                (p) => p.type === "tool-result" && p.toolCallId === part.toolCallId,
              ),
          );
          if (!hasResult) {
            await onEvent?.("tool-result", {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              output: { error: "Agent encountered an error" },
              isError: true,
              error: "Agent encountered an error",
            });
          }
        }
      }
    }

    await onEvent?.("error", { error: String(error) });
    throw error;
  }
}
