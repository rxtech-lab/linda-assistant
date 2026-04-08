import { type ModelMessage, stepCountIs, streamText } from "ai";
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
import {
  type EmailAttachment,
  assignees,
  chatSessions,
  confirmations,
  emailInbox,
  questions,
  taskEmails,
  tasks,
  uploads,
  usage,
} from "@/lib/db/schema";
import { createMem0Client } from "@/lib/mem0/client";
import { redis } from "@/lib/redis";
import { setStreamActive } from "@/lib/streaming/manager";
import { extractTextFromMessage, prepareMessages } from "./compaction";
import { createConfirmation, sendConfirmationGroupNotification } from "./confirmation";
import { createLocationRequest } from "./location";
import { getModelProvider } from "./model";
import { availableModelSchema, calculateCostUsd, DEFAULT_MODEL } from "./models";
import { createQuestion, sendQuestionGroupNotification } from "./question";
import { createUploadRequest, sendUploadGroupNotification } from "./upload";
import { formatHistoryContext, generateTaskHistory, getRecentHistory } from "./history";
import { HISTORY_CONTEXT_LIMIT, MAX_STEPS } from "./context";
import { compressToolCallContent } from "./tool-content-compression";
import { buildToolSet } from "./tools";
import { ASK_QUESTION_TOOL_NAME } from "./tools/ask-question";
import { evaluateConditions } from "./tools/conditions";
import { GET_LOCATION_TOOL_NAME } from "./tools/get-location";
import { REQUEST_UPLOAD_TOOL_NAME } from "./tools/request-upload";
import { loadAssigneePermissions, resolvePermission } from "./tools/permission";

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

/** Annotate a tool-call content part with upload info */
export function annotateToolCallUpload(
  messages: ModelMessage[],
  toolCallId: string,
  uploadId: string,
  status: string,
): void {
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === toolCallId) {
        part.upload = { id: uploadId, status };
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
          output: {
            type: "error-text",
            value: "Tool execution was interrupted",
          },
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

  // Step 3: Drop orphan tool-results whose tool-calls no longer exist in the
  // message history (e.g. compacted away). Appending them would cause
  // "No tool call found for function call output" errors from the LLM API.
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
      for (const p of unplaced) {
        console.warn(
          `[cleanMessagesForModel] Dropping orphan tool-result: toolCallId=${p.toolCallId} toolName=${p.toolName} (no matching tool-call in messages)`,
        );
      }
    }
  }

  return finalResult;
}

export function buildSystemPrompt(
  assignee?: { name: string; personality: string | null } | null,
  taskContext?: {
    title: string;
    description: string | null;
    timezone: string | null;
    emails?: Array<{
      fromEmail: string;
      fromName: string | null;
      subject: string | null;
      textBody: string | null;
      receivedAt: string;
      attachments?: EmailAttachment[] | null;
    }>;
  } | null,
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const dateLine = `\nToday's date is ${today}.`;

  const documentGuidance = `\nWhen your response would be very long (e.g., reports, analyses, comprehensive guides), or when the user explicitly asks for a document/report, use the create_document tool instead of writing it inline. Choose the document format based on the user's request: use markdown by default, but use HTML when the user explicitly asks for HTML output. Do NOT include the title as a heading in the document content — the title is displayed separately by the viewer. After creating a document, do NOT repeat the document content in your response — just confirm you created it and provide a brief summary of what it contains. Write documents in a news-report or essay style: use flowing prose and narrative paragraphs rather than bullet-point lists. Reserve bullet points and numbered lists only when genuinely enumerating discrete items (e.g., steps, feature lists). When the document format is markdown, structure documents with ## headers for major sections and ### subheadings for subsections, use markdown blockquotes (>) to highlight key quotes, notable statistics, or important callouts, and embed charts or images using markdown image syntax. When the document format is HTML, structure documents with <h2> for major sections and <h3> for subsections, use <blockquote> for highlighted quotes or callouts, and embed charts or images with standard <img> tags, avoiding markdown syntax. To make the document visually rich like a newspaper, embed relevant images inline from your source URLs — place images near the section they illustrate. When the content involves data, trends, or comparisons, use the create_drawing tool to generate charts and embed them in the document rather than describing the numbers only in prose or tables.`;

  const questionGuidance = `\nUse the ask_question tool to gather user input before proceeding in these situations:
- Before taking important or irreversible actions (e.g., sending emails, deleting data, making external API calls) — ask the user to confirm the details are correct.
- When you are unsure about the user's intent, preferences, or requirements — ask clarifying questions rather than guessing.
- When a task has multiple valid approaches and the best choice depends on user preference.
Do NOT overuse it for trivial or obvious decisions. Only ask when the answer genuinely affects the outcome.
If the user rejects your questions, do NOT retry with the same or similar questions. Acknowledge the rejection and proceed without that information, using reasonable defaults or skipping the action.`;

  const locationGuidance = `\nUse the get_location tool when you need the user's current GPS coordinates — for example, to find nearby places, get local weather, provide directions, or give location-based recommendations. The user will be asked to share their location and may decline. Do NOT request location unless it is clearly relevant to the user's request.`;

  const briefingGuidance = `\nUse the create_briefing tool when the user asks for a briefing, digest, or summary report that should appear in their Briefing feed. Briefings are rich reports with a cover image and markdown content. Use the search_documents tool first if you need to find and link existing documents to the briefing. Provide a short, evocative imageDescription for the cover image (e.g. 'morning coffee and newspaper on a wooden desk'). Write briefing content in a news-report style: use clear narrative prose and well-structured paragraphs rather than bullet-point lists. Reserve bullet points only for genuinely list-like items. Structure briefings with ## headers for major sections and ### subheadings for subsections to guide the reader through the content. Use markdown blockquotes (>) to highlight key quotes, important facts, or standout statistics that deserve special emphasis. To make briefings visually rich like a newspaper, embed relevant images inline using markdown image syntax — source images from the topic being covered and place them near the section they illustrate. When the briefing covers data, statistics, or trends, use the create_drawing tool to generate charts and embed them with markdown image syntax to make the briefing visually informative.`;

  const drawingGuidance = `\nUse the create_drawing tool when the user asks for a chart, graph, plot, or data visualization. The tool generates a chart image using Python/matplotlib and returns its URL. You can embed the chart in documents or briefings using markdown image syntax: ![chart description](url). When creating documents or briefings that involve data, proactively offer to include charts to make the content more visual and informative.`;

  let taskGuidance = "";
  if (taskContext) {
    taskGuidance = `\nYou are currently running within a task: "${taskContext.title}".${taskContext.timezone ? ` The task's timezone is ${taskContext.timezone}.` : ""} You do not need to create any tasks. Follow the user's instructions directly and perform the requested actions on their behalf. Do not ask the user any questions — proceed autonomously with reasonable defaults. If the user's message includes scheduling instructions (e.g. "run at 9am", "every Monday", "repeat daily"), ignore them — those are job configuration for the scheduler, not instructions for you. Focus only on the actual work to be done.`;

    if (taskContext.emails && taskContext.emails.length > 0) {
      const emailSummaries = taskContext.emails
        .map((e) => {
          const from = e.fromName ? `${e.fromName} <${e.fromEmail}>` : e.fromEmail;
          const subject = e.subject || "(no subject)";
          const body = e.textBody || "(no body)";
          let text = `From: ${from}\nSubject: ${subject}\nReceived: ${e.receivedAt}\n\n${body}`;
          if (e.attachments && e.attachments.length > 0) {
            const attachmentList = e.attachments
              .map((a) => `- [${a.name}](${a.url}) (${a.type})`)
              .join("\n");
            text += `\n\nAttachments:\n${attachmentList}`;
          }
          return text;
        })
        .join("\n\n---\n\n");
      taskGuidance += `\n\n<attached_emails>\nThe following emails are attached to this task. Use their content as context for completing the task.\n\n${emailSummaries}\n</attached_emails>`;
    }
  }

  const extensionToolGuidance = `\n## Extension Tools (IMPORTANT — read carefully)

Extension tools (e.g. web search, invoices, file storage) are NOT directly available. You MUST follow this exact 3-step flow to use them:

1. **search_tools** — call search_tools with a keyword query to discover available tools. Returns tool IDs and descriptions.
2. **read_tool** — call read_tool with the tool IDs from step 1 to get the exact parameter names and types. You MUST do this before calling use_tool — do NOT guess parameters.
3. **use_tool** — call use_tool with two top-level fields: "toolId" (string) and "parameters" (object matching the schema from step 2).

NEVER skip step 2 (read_tool). The parameter names vary per tool and you cannot guess them correctly without reading the schema first.

When calling use_tool, pass the toolId exactly as returned by search_tools — a plain string with no extra quotes, markup, or special tokens. The toolId and parameters are two separate top-level fields of use_tool.

Do NOT call extension tool IDs directly as tool calls — they don't exist as callable tools. Do NOT guess parameter names — always read_tool first to get the exact schema.

When the user asks you to compose a document, briefing, report, or do any research that requires up-to-date or real-world information (e.g. news, market data, weather, current events, company info, travel details), you MUST first use search_tools to find available network/web searching tools (search keywords like "web", "search", "browse", "fetch", "news", "scrape"). Use those tools to gather real-time data before writing. Do NOT rely on your own knowledge for factual, time-sensitive, or real-world content — your training data is outdated and may be inaccurate. Always fetch fresh information from external sources first, then compose the document or briefing based on what you find.`;

  const idRedactionGuidance = `\nIMPORTANT: Never include internal IDs (document IDs, slide deck IDs, task IDs, session IDs, or any other system identifiers) in your responses to the user. These are internal implementation details. When referencing created resources, use their titles or descriptions instead. For example, say "I created the document 'Q1 Report'" rather than "I created document doc_abc123". Exception: when you create slides with create_slides, do NOT embed the slide deck ID or any slide syntax in your chat response. The slide carousel is already rendered automatically from the tool call. Just mention what you created by title — do NOT include {{slide:deckId}} or any other slide reference in your chat message. The {{slide:deckId}} syntax is only used inside document and briefing content (via create_document or create_briefing tools), where it renders as an embedded carousel.`;

  if (!assignee)
    return `You are a helpful personal assistant.${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}${briefingGuidance}${drawingGuidance}${extensionToolGuidance}${idRedactionGuidance}${taskGuidance}`;
  if (assignee.personality)
    return `${assignee.personality}${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}${briefingGuidance}${drawingGuidance}${extensionToolGuidance}${idRedactionGuidance}${taskGuidance}`;
  return `You are ${assignee.name}, a helpful personal assistant.${dateLine}${documentGuidance}${questionGuidance}${locationGuidance}${briefingGuidance}${drawingGuidance}${extensionToolGuidance}${idRedactionGuidance}${taskGuidance}`;
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
  taskType?:
    | "message"
    | "confirmation_resolved"
    | "question_resolved"
    | "location_resolved"
    | "upload_resolved",
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

      // Update confirmation, question, or upload status to "cancelled" in DB if one exists
      await db
        .update(confirmations)
        .set({
          status: "cancelled",
          resolvedAt: sql`(datetime('now'))`,
        })
        .where(
          and(eq(confirmations.chatSessionId, sessionId), eq(confirmations.toolCallId, toolCallId)),
        );
      await db
        .update(questions)
        .set({
          status: "rejected",
          answeredAt: sql`(datetime('now'))`,
        })
        .where(and(eq(questions.chatSessionId, sessionId), eq(questions.toolCallId, toolCallId)));
      await db
        .update(uploads)
        .set({
          status: "cancelled",
          completedAt: sql`(datetime('now'))`,
        })
        .where(and(eq(uploads.chatSessionId, sessionId), eq(uploads.toolCallId, toolCallId)));

      // Update the tool-call annotation in messages so it persists as "cancelled".
      // Check for confirmation, question, and upload annotations.
      let existingConfirmationId = "";
      let existingQuestionId = "";
      let existingUploadId = "";
      for (const msg of cleaned) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Record<string, unknown>[]) {
          if (part.type === "tool-call" && part.toolCallId === toolCallId) {
            const conf = part.confirmation as { id?: string } | undefined;
            if (conf?.id) existingConfirmationId = conf.id;
            const quest = part.question as { id?: string } | undefined;
            if (quest?.id) existingQuestionId = quest.id;
            const upl = part.upload as { id?: string } | undefined;
            if (upl?.id) existingUploadId = upl.id;
          }
        }
      }
      if (existingUploadId) {
        annotateToolCallUpload(cleaned, toolCallId, existingUploadId, "cancelled");
      } else if (existingQuestionId) {
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

      // Query confirmations table for this tool call (scoped to current session)
      const [confirmation] = await db
        .select()
        .from(confirmations)
        .where(
          and(eq(confirmations.chatSessionId, sessionId), eq(confirmations.toolCallId, toolCallId)),
        );

      // If no confirmation found, check questions table (for ask_question tool)
      const [questionRecord] = !confirmation
        ? await db
            .select()
            .from(questions)
            .where(
              and(eq(questions.chatSessionId, sessionId), eq(questions.toolCallId, toolCallId)),
            )
        : [undefined];

      // If no confirmation or question found, check uploads table
      const [uploadRecord] =
        !confirmation && !questionRecord
          ? await db
              .select()
              .from(uploads)
              .where(and(eq(uploads.chatSessionId, sessionId), eq(uploads.toolCallId, toolCallId)))
          : [undefined];

      // If no confirmation, question, or upload found, check Redis for location request
      let locationStatus: string | null = null;
      if (!confirmation && !questionRecord && !uploadRecord) {
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
        uploadRecord?.status === "completed" ||
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
          | {
              execute?: (input: unknown, options: Record<string, unknown>) => Promise<unknown>;
            }
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
        if (uploadRecord) {
          annotateToolCallUpload(cleaned, toolCallId, uploadRecord.id, "completed");
        } else if (questionRecord) {
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
      } else if (
        confirmation?.status === "rejected" ||
        questionRecord?.status === "rejected" ||
        uploadRecord?.status === "rejected" ||
        locationStatus === "rejected"
      ) {
        // Safety: rejection should already have a tool-result from resolveConfirmation/resolveQuestion/resolveUpload,
        // but create one if somehow missing
        const errorMsg =
          locationStatus === "rejected"
            ? "User declined to share their location"
            : uploadRecord
              ? "User rejected the upload request"
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
        if (uploadRecord) {
          annotateToolCallUpload(cleaned, toolCallId, uploadRecord.id, "rejected");
        } else if (questionRecord) {
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
  taskType?:
    | "message"
    | "confirmation_resolved"
    | "question_resolved"
    | "location_resolved"
    | "upload_resolved";
  onTextChunk?: (text: string) => void;
  onEvent?: (event: string, data: unknown) => void | Promise<void>;
  signal?: AbortSignal;
}

export async function runAgent(options: AgentRunOptions) {
  const { sessionId, userId, taskType, onTextChunk, onEvent, signal } = options;

  // Load session with messages
  const [session] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));

  if (!session) throw new Error("Session not found");

  // Load task context if session is linked to a task
  let taskContext: {
    title: string;
    description: string | null;
    timezone: string | null;
    emails: Array<{
      fromEmail: string;
      fromName: string | null;
      subject: string | null;
      textBody: string | null;
      receivedAt: string;
      attachments: EmailAttachment[] | null;
    }>;
  } | null = null;
  if (session.taskId) {
    const [task] = await db
      .select({ title: tasks.title, description: tasks.description })
      .from(tasks)
      .where(eq(tasks.id, session.taskId));
    if (task) {
      // Fetch linked emails with attachments
      const linkedEmails = await db
        .select({
          fromEmail: emailInbox.fromEmail,
          fromName: emailInbox.fromName,
          subject: emailInbox.subject,
          textBody: emailInbox.textBody,
          receivedAt: emailInbox.receivedAt,
          attachments: emailInbox.attachments,
        })
        .from(taskEmails)
        .innerJoin(emailInbox, eq(taskEmails.emailId, emailInbox.id))
        .where(eq(taskEmails.taskId, session.taskId));

      taskContext = {
        ...task,
        timezone: session.timezone ?? null,
        emails: linkedEmails,
      };
    }
  }

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

  let systemPrompt = buildSystemPrompt(assignee, taskContext);

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

  const { tools, conditionalAutoConfirm } = await buildToolSet(
    userId,
    session.assigneeId ?? null,
    accessToken,
    sessionId,
    !!taskContext,
    session.taskId ?? undefined,
  );
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

  // Inject recent task history context for standalone chat sessions
  if (!taskContext && session.assigneeId) {
    try {
      const recentHistory = await getRecentHistory(
        userId,
        session.assigneeId,
        HISTORY_CONTEXT_LIMIT,
      );
      const historyContext = formatHistoryContext(recentHistory);
      if (historyContext) {
        systemPrompt += historyContext;
      }
    } catch (err) {
      console.warn("[agent] Failed to load task history context:", err);
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
  let lastFinishReason: string | undefined;
  let currentMessages: ModelMessage[] = compressToolCallContent([...preprocessed.messages]);
  let persistedCount = messages.length + preprocessed.persistCount;

  // Accumulated token usage across all steps
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  try {
    // eslint-disable-next-line no-constant-condition -- outer loop only re-iterates for conditional auto-confirm
    while (true) {
      if (signal?.aborted) break;
      if (stepCount >= MAX_STEPS) break;

      // Compact history if approaching context limits
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

      // Track per-step IDs for SSE events and message deduplication
      const stepIds: string[] = [];
      let currentStepId = "";
      const remainingSteps = MAX_STEPS - stepCount;

      console.log(
        `[agent] Starting streamText with up to ${remainingSteps} step(s) for session=${sessionId}`,
      );

      const result = streamText({
        model: getModelProvider(modelId),
        system: systemPrompt,
        messages: cleanMessagesForModel(currentMessages),
        tools: tools as Parameters<typeof streamText>[0]["tools"],
        abortSignal: signal,
        stopWhen: stepCountIs(remainingSteps),
        providerOptions: {
          gateway: { caching: "auto" },
        },
        prepareStep: async ({ stepNumber }) => {
          // Inject step-limit warning when approaching max steps
          const totalStep = stepCount + stepNumber + 1;
          const stepsRemaining = MAX_STEPS - totalStep;
          if (stepsRemaining <= 2) {
            const warningMessages = cleanMessagesForModel(currentMessages);
            warningMessages.push({
              id: crypto.randomUUID(),
              role: "user",
              content:
                stepsRemaining === 0
                  ? "SYSTEM: This is your LAST step. Respond with text ONLY — do NOT call any tools. Summarize your progress and what remains to be done. The user can ask you to continue if needed."
                  : `SYSTEM: You have ${stepsRemaining} step(s) remaining. Start wrapping up — provide results as text rather than making more tool calls. If more research is needed, tell the user what remains.`,
            } as ModelMessage);
            return { messages: warningMessages };
          }
          return undefined;
        },
        onStepFinish: async (event) => {
          stepCount++;
          lastFinishReason = event.finishReason;
          console.log(
            `[agent] Step ${stepCount}/${MAX_STEPS} finished: reason=${event.finishReason}`,
          );
        },
      });

      // Track tool-approval-request parts emitted by SDK for needsApproval tools
      const pendingApprovals: Array<{
        approvalId: string;
        toolCall: { toolCallId: string; toolName: string; input: unknown };
      }> = [];

      // Accumulates reasoning text within a reasoning block (reset on reasoning-end)
      let thinkingBuffer = "";

      // eslint-disable-next-line no-labels -- labeled break needed to exit from inside switch
      streamLoop: for await (const part of result.fullStream) {
        if (signal?.aborted) break streamLoop;

        switch (part.type) {
          case "start-step": {
            currentStepId = crypto.randomUUID();
            stepIds.push(currentStepId);
            thinkingBuffer = "";
            break;
          }
          case "reasoning-start": {
            await onEvent?.("thinking-start", { id: currentStepId });
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "reasoning-delta": {
            thinkingBuffer += part.text;
            break;
          }
          case "reasoning-end": {
            await onEvent?.("thinking-stop", { id: currentStepId, text: thinkingBuffer });
            thinkingBuffer = "";
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "text-delta": {
            onTextChunk?.(part.text);
            await onEvent?.("text-delta", {
              id: currentStepId,
              text: part.text,
            });
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "tool-input-start": {
            console.log(`[agent] Tool input start: ${part.toolName} (toolCallId=${part.id})`);
            await onEvent?.("tool-input-start", {
              id: currentStepId,
              toolCallId: part.id,
              toolName: part.toolName,
            });
            if (signal?.aborted) break streamLoop;
            break;
          }
          case "tool-call": {
            console.log(
              `[agent] Tool call: ${part.toolName} (toolCallId=${part.toolCallId})`,
              JSON.stringify("input" in part ? part.input : {}).slice(0, 500),
            );
            await onEvent?.("tool-call", {
              id: currentStepId,
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
              id: currentStepId,
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
              id: currentStepId,
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
            await onEvent?.("error", {
              id: currentStepId,
              error: String(part.error),
            });
            break;
          }
        }
      }

      const finishReason = await result.finishReason;
      lastFinishReason = finishReason;
      const responseMessages = (await result.response).messages;

      // Accumulate token usage across all steps in this streamText call
      const runUsage = await result.usage;
      if (runUsage) {
        totalInputTokens += runUsage.inputTokens ?? 0;
        totalOutputTokens += runUsage.outputTokens ?? 0;
      }

      // Assign step-specific IDs to response messages for SSE deduplication
      let stepIdx = 0;
      const sanitizedResponses = (responseMessages as ModelMessage[]).map((msg) => {
        const record = { ...msg } as Record<string, unknown>;
        if (msg.role === "assistant") {
          record.id = record.id ?? stepIds[stepIdx] ?? crypto.randomUUID();
          stepIdx++;
        } else if (!record.id) {
          record.id = crypto.randomUUID();
        }
        return record as unknown as ModelMessage;
      });
      currentMessages = [...currentMessages, ...sanitizedResponses];

      // Annotate all auto-executed tool results and propagate error info
      annotateAutoApproved(sanitizedResponses);
      for (const msg of sanitizedResponses) {
        if (!Array.isArray(msg.content)) continue;
        for (const part of msg.content as Record<string, unknown>[]) {
          if (part.type === "tool-result" && isToolResultError(part)) {
            const errorStr = extractToolResultError(part);
            annotateToolCallError(currentMessages, part.toolCallId as string, errorStr);
          }
        }
      }

      console.log(
        `[agent] streamText finished: reason=${finishReason} steps=${stepIds.length} responseMessages=${responseMessages.length}`,
      );

      if (finishReason === "tool-calls" && pendingApprovals.length > 0) {
        // Separate question, location, upload, and confirmation approvals
        const questionApprovals = pendingApprovals.filter(
          (a) => a.toolCall.toolName === ASK_QUESTION_TOOL_NAME,
        );
        const locationApprovals = pendingApprovals.filter(
          (a) => a.toolCall.toolName === GET_LOCATION_TOOL_NAME,
        );
        const uploadApprovals = pendingApprovals.filter(
          (a) => a.toolCall.toolName === REQUEST_UPLOAD_TOOL_NAME,
        );
        const confirmationApprovals = pendingApprovals.filter(
          (a) =>
            a.toolCall.toolName !== ASK_QUESTION_TOOL_NAME &&
            a.toolCall.toolName !== GET_LOCATION_TOOL_NAME &&
            a.toolCall.toolName !== REQUEST_UPLOAD_TOOL_NAME,
        );

        // Handle question approvals (create records + annotate in-memory, no events yet)
        const createdQuestions: Array<{
          questionId: string;
          questionCount: number;
        }> = [];
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

        // Handle upload approvals (create records + annotate in-memory, no events yet)
        const createdUploads: Array<{
          uploadId: string;
          fileCount: number;
        }> = [];
        const uploadEvents: Array<{
          uploadId: string;
          toolCallId: string;
          toolName: string;
          title: string;
          description: string | undefined;
          numberUploads: number | null;
          extensions: string[];
          urls: Array<{ url: string; key: string; extension: string }>;
        }> = [];
        for (const approval of uploadApprovals) {
          const input = (approval.toolCall.input ?? {}) as Record<string, unknown>;

          const upload = await createUploadRequest({
            userId,
            chatSessionId: sessionId,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            approvalId: approval.approvalId,
            title: input.title as string,
            description: input.description as string | undefined,
            numberUploads: (input.number_uploads as number | undefined) ?? null,
            extensions: input.extensions as string[],
            externalUrls: input.urls as string[] | undefined,
            skipNotification: true,
          });

          createdUploads.push({
            uploadId: upload.id,
            fileCount: upload.numberUploads ?? 0,
          });

          // Annotate the tool-call content part with upload info
          annotateToolCallUpload(
            currentMessages,
            approval.toolCall.toolCallId,
            upload.id,
            "pending",
          );

          uploadEvents.push({
            uploadId: upload.id,
            toolCallId: approval.toolCall.toolCallId,
            toolName: approval.toolCall.toolName,
            title: upload.title,
            description: upload.description ?? undefined,
            numberUploads: upload.numberUploads,
            extensions: upload.extensions ?? [],
            urls: upload.urls ?? [],
          });
        }

        // Evaluate conditional auto-confirm: execute tools whose conditions pass
        const conditionallyApproved: typeof confirmationApprovals = [];
        const remainingConfirmations: typeof confirmationApprovals = [];
        for (const approval of confirmationApprovals) {
          const entry = conditionalAutoConfirm[approval.toolCall.toolName];
          if (entry) {
            const params = (approval.toolCall.input ?? {}) as Record<string, unknown>;
            if (evaluateConditions(entry.conditions, params, entry.logic)) {
              conditionallyApproved.push(approval);
              continue;
            }
          }
          remainingConfirmations.push(approval);
        }

        // Execute conditionally auto-approved tools inline
        for (const approval of conditionallyApproved) {
          const toolDef = tools[approval.toolCall.toolName] as {
            execute?: (input: unknown, opts: { toolCallId: string }) => Promise<unknown>;
          };
          if (toolDef?.execute) {
            try {
              const output = await toolDef.execute(approval.toolCall.input, {
                toolCallId: approval.toolCall.toolCallId,
              });
              const toolResultMsg = {
                id: crypto.randomUUID(),
                role: "tool" as const,
                content: [
                  {
                    type: "tool-result" as const,
                    toolCallId: approval.toolCall.toolCallId,
                    toolName: approval.toolCall.toolName,
                    output,
                    approveStatus: "auto-approved",
                  },
                ],
              } as unknown as ModelMessage;
              currentMessages.push(toolResultMsg);
              await onEvent?.("tool-call", {
                id: currentStepId,
                toolCallId: approval.toolCall.toolCallId,
                toolName: approval.toolCall.toolName,
                input: approval.toolCall.input,
              });
              await onEvent?.("tool-result", {
                id: currentStepId,
                toolCallId: approval.toolCall.toolCallId,
                toolName: approval.toolCall.toolName,
                output,
              });
            } catch (err) {
              const errorStr = err instanceof Error ? err.message : String(err);
              const toolResultMsg = {
                id: crypto.randomUUID(),
                role: "tool" as const,
                content: [
                  {
                    type: "tool-result" as const,
                    toolCallId: approval.toolCall.toolCallId,
                    toolName: approval.toolCall.toolName,
                    output: { error: errorStr },
                    isError: true,
                    approveStatus: "auto-approved",
                  },
                ],
              } as unknown as ModelMessage;
              currentMessages.push(toolResultMsg);
              await onEvent?.("tool-result", {
                id: currentStepId,
                toolCallId: approval.toolCall.toolCallId,
                toolName: approval.toolCall.toolName,
                output: { error: errorStr },
                isError: true,
                error: errorStr,
              });
            }
          }
        }

        // If ALL approvals were auto-approved (no questions, no locations, no uploads, no remaining confirmations)
        if (
          remainingConfirmations.length === 0 &&
          questionApprovals.length === 0 &&
          locationApprovals.length === 0 &&
          uploadApprovals.length === 0
        ) {
          // Persist and continue loop like the auto-executed path
          await insertMessages(sessionId, currentMessages.slice(persistedCount));
          persistedCount = currentMessages.length;
          continue;
        }

        // Handle confirmation approvals (create records + annotate in-memory, no events yet)
        const createdConfirmations: Array<{
          confirmationId: string;
          toolName: string;
        }> = [];
        const confirmationEvents: Array<{
          confirmationId: string;
          toolCallId: string;
          toolName: string;
          parameters: unknown;
        }> = [];
        for (const approval of remainingConfirmations) {
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
        for (const evt of uploadEvents) {
          await onEvent?.("upload_required", evt);
        }

        // Send grouped push notifications
        if (createdConfirmations.length > 0) {
          await sendConfirmationGroupNotification(userId, sessionId, createdConfirmations);
        }
        if (createdQuestions.length > 0) {
          await sendQuestionGroupNotification(userId, sessionId, createdQuestions);
        }
        if (createdUploads.length > 0) {
          await sendUploadGroupNotification(userId, sessionId, createdUploads);
        }

        // Emit status event so SSE clients know the agent is paused
        const waitingStatus = hasLocationRequest
          ? "waiting_location"
          : createdUploads.length > 0 &&
              createdQuestions.length === 0 &&
              createdConfirmations.length === 0
            ? "waiting_upload"
            : createdQuestions.length > 0 && createdConfirmations.length === 0
              ? "waiting_question"
              : "waiting_confirmation";
        await onEvent?.("status", { status: waitingStatus });

        // Save accumulated token usage so far (partial run before pause)
        const pauseCostUsd = calculateCostUsd(modelId, totalInputTokens, totalOutputTokens);
        await db
          .update(chatSessions)
          .set({
            status: waitingStatus,
            updatedAt: sql`(datetime('now'))`,
          })
          .where(eq(chatSessions.id, sessionId));

        // Insert a usage record for this partial run
        if (totalInputTokens > 0 || totalOutputTokens > 0) {
          await db.insert(usage).values({
            userId,
            chatSessionId: sessionId,
            assigneeId: session.assigneeId,
            model: modelId,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            costUsd: pauseCostUsd,
          });
        }

        console.log(
          `[agent] Usage saved (paused): session=${sessionId} model=${modelId} input=${totalInputTokens} output=${totalOutputTokens} cost=$${pauseCostUsd ?? "unknown"}`,
        );

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

      // No approvals — persist and exit loop (SDK already handled multi-step auto-execution)
      await insertMessages(sessionId, currentMessages.slice(persistedCount));
      persistedCount = currentMessages.length;
      break;
    }

    // If max steps reached while agent still wanted tool calls, ask user to continue
    if (stepCount >= MAX_STEPS && lastFinishReason === "tool-calls") {
      const maxStepsId = crypto.randomUUID();
      const continueText =
        "\n\nI've reached the maximum number of steps for this turn. Would you like me to continue? Reply **yes** to keep going.";
      await onEvent?.("text-delta", { id: maxStepsId, text: continueText });
      currentMessages.push({
        id: maxStepsId,
        role: "assistant",
        content: continueText,
      } as ModelMessage);
    }

    // Persist new messages and mark session as stopped
    await insertMessages(sessionId, currentMessages.slice(persistedCount));
    persistedCount = currentMessages.length;

    // Calculate USD cost for this run's accumulated token usage
    const costUsd = calculateCostUsd(modelId, totalInputTokens, totalOutputTokens);

    await db
      .update(chatSessions)
      .set({
        status: "stopped",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, sessionId));

    // Insert a usage record for this completed run
    if (totalInputTokens > 0 || totalOutputTokens > 0) {
      await db.insert(usage).values({
        userId,
        chatSessionId: sessionId,
        assigneeId: session.assigneeId,
        model: modelId,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
      });
    }

    console.log(
      `[agent] Usage saved (completed): session=${sessionId} model=${modelId} input=${totalInputTokens} output=${totalOutputTokens} cost=$${costUsd ?? "unknown"}`,
    );

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

    // Fire-and-forget: generate task history if this is a task session
    if (session.taskId) {
      generateTaskHistory(session.taskId, sessionId).catch((err) =>
        console.warn("[agent] History generation failed:", err),
      );
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
