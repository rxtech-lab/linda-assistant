import { embed, generateText, type ModelMessage } from "ai";
import { eq, and, desc, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks, chatSessions, taskHistory, taskEmails, taskWebhooks } from "@/lib/db/schema";
import { getSessionMessages } from "@/lib/db/messages";
import { extractTextFromMessage, splitTextIntoChunks } from "./compaction";
import { getModelProvider } from "./model";
import { getEmbeddingProvider } from "./embedding-model";
import {
  CHART_GENERATION_MODEL,
  TASK_SESSION_EMBEDDING_MODEL,
  HISTORY_SUMMARIZATION_CHUNK_SIZE,
  HISTORY_SIMILARITY_THRESHOLD,
  estimateTokenCount,
} from "./context";

// ── Types ──────────────────────────────────────────────────────────────

export interface TaskHistoryEntry {
  id: string;
  taskId: string;
  chatSessionId: string;
  assigneeId: string | null;
  summary: string;
  toolCalls: string[] | null;
  status: string | null;
  source: string | null;
  durationSecs: number | null;
  taskTitle: string;
  score?: number;
  createdAt: string | null;
}

export interface GroupedHistory {
  taskId: string;
  taskTitle: string;
  sessions: TaskHistoryEntry[];
}

// ── Pure helpers (exported for unit testing) ────────────────────────────

/**
 * Group flat history entries by taskId. Pure function.
 */
export function groupHistoryByTask(history: TaskHistoryEntry[]): GroupedHistory[] {
  const map = new Map<string, GroupedHistory>();
  for (const entry of history) {
    const existing = map.get(entry.taskId);
    if (existing) {
      existing.sessions.push(entry);
    } else {
      map.set(entry.taskId, {
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        sessions: [entry],
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Format history entries into a system prompt block. Pure function — no DB calls.
 */
export function formatHistoryContext(history: TaskHistoryEntry[]): string | null {
  if (history.length === 0) return null;
  const grouped = groupHistoryByTask(history);
  const historyBlock = grouped
    .map((g) => {
      const runs = g.sessions.length > 1 ? ` (${g.sessions.length} runs)` : "";
      const summaries = g.sessions
        .map((s) => {
          const tools = s.toolCalls?.length ? ` | Tools: ${s.toolCalls.join(", ")}` : "";
          const duration = s.durationSecs ? ` | ${Math.round(s.durationSecs / 60)}min` : "";
          return `  - Run${tools}${duration}: ${s.summary}`;
        })
        .join("\n");
      return `- Task("${g.taskTitle}")${runs}:\n${summaries}`;
    })
    .join("\n");
  return `\n\n<task_history>\nRecent task execution history for this assistant:\n${historyBlock}\n</task_history>`;
}

// ── History Generation ────────────────────────────────────────────────

/**
 * Extract a text representation of messages suitable for summarization.
 * Includes tool calls and results.
 */
export interface ToolCallDetail {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
}

function extractSessionContent(msgs: ModelMessage[]): {
  text: string;
  toolNames: string[];
  toolCallDetails: ToolCallDetail[];
} {
  const toolNameSet = new Set<string>();
  const lines: string[] = [];
  const pendingCalls = new Map<string, ToolCallDetail>();
  const completedCalls: ToolCallDetail[] = [];

  for (const msg of msgs) {
    const extracted = extractTextFromMessage(msg);
    if (extracted) lines.push(`[${msg.role}]: ${extracted}`);

    if (Array.isArray(msg.content)) {
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "tool-call" && typeof part.toolName === "string") {
          toolNameSet.add(part.toolName as string);
          const detail: ToolCallDetail = {
            toolName: part.toolName as string,
            toolCallId: (part.toolCallId as string) ?? "",
            input: part.input ?? part.args ?? null,
          };
          pendingCalls.set(detail.toolCallId, detail);
        } else if (part.type === "tool-result" && typeof part.toolCallId === "string") {
          const pending = pendingCalls.get(part.toolCallId as string);
          if (pending) {
            pending.output = part.output ?? part.result ?? null;
            completedCalls.push(pending);
            pendingCalls.delete(part.toolCallId as string);
          }
        }
      }
    }
  }

  // Add any tool calls that never got results
  for (const detail of pendingCalls.values()) {
    completedCalls.push(detail);
  }

  return {
    text: lines.join("\n\n"),
    toolNames: Array.from(toolNameSet),
    toolCallDetails: completedCalls,
  };
}

/**
 * Summarize session content, chunking if needed for large histories.
 */
async function summarizeSessionContent(content: string): Promise<string> {
  const tokenCount = estimateTokenCount([{ role: "user", content } as unknown as ModelMessage]);

  if (tokenCount <= HISTORY_SUMMARIZATION_CHUNK_SIZE) {
    // Single-shot summarization
    const result = await generateText({
      model: getModelProvider(CHART_GENERATION_MODEL),
      prompt: `Summarize the following chat session execution concisely (1-2 paragraphs). Include: what tools were called, what results were produced, and the final outcome.\n\n<session>\n${content}\n</session>\n\nSummary:`,
    });
    return result.text;
  }

  // Chunked summarization — mirror compaction pattern
  const chunks = splitTextIntoChunks(content, HISTORY_SUMMARIZATION_CHUNK_SIZE);
  let rollingSummary = "";

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prompt =
      i === 0
        ? `Summarize the following section of a chat session execution. Be concise.\n\n<section>\n${chunk}\n</section>\n\nSummary:`
        : `Given the running summary and the next section of a chat session, produce an updated summary preserving all key information about tools used, results, and outcomes.\n\n<running_summary>\n${rollingSummary}\n</running_summary>\n\n<next_section>\n${chunk}\n</next_section>\n\nUpdated summary:`;

    try {
      const result = await generateText({
        model: getModelProvider(CHART_GENERATION_MODEL),
        prompt,
      });
      rollingSummary = result.text;
    } catch (err) {
      console.warn(`[history] Chunk ${i + 1}/${chunks.length} summarization failed:`, err);
      break;
    }
  }

  return rollingSummary || "Session completed (summary generation failed).";
}

/**
 * Generate and store a history entry for a completed task chat session.
 * Fire-and-forget — never throws.
 */
export async function generateTaskHistory(taskId: string, chatSessionId: string): Promise<void> {
  // 1. Load task and session metadata
  const [task] = await db
    .select({
      title: tasks.title,
      userId: tasks.userId,
      assigneeId: tasks.assigneeId,
      source: tasks.source,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId));

  if (!task) {
    console.warn(`[history] Task ${taskId} not found, skipping history generation`);
    return;
  }

  const [session] = await db
    .select({
      status: chatSessions.status,
      createdAt: chatSessions.createdAt,
      updatedAt: chatSessions.updatedAt,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, chatSessionId));

  if (!session) {
    console.warn(`[history] Chat session ${chatSessionId} not found, skipping`);
    return;
  }

  // 2. Derive source from task
  const webhookLinks = await db
    .select({ id: taskWebhooks.id })
    .from(taskWebhooks)
    .where(eq(taskWebhooks.taskId, taskId))
    .limit(1);
  const historySource =
    webhookLinks.length > 0 ? "webhook" : task.source === "email" ? "email" : "task";

  // 3. Upsert: reuse existing history entry for this session, or create a new one
  const [existingHistory] = await db
    .select({ id: taskHistory.id })
    .from(taskHistory)
    .where(eq(taskHistory.chatSessionId, chatSessionId))
    .limit(1);

  const historyId = existingHistory?.id ?? crypto.randomUUID();

  if (existingHistory) {
    // Reset to pending while we regenerate
    await db.run(
      sql`UPDATE task_history SET status = 'pending', assignee_id = ${task.assigneeId}, source = ${historySource} WHERE id = ${historyId}`,
    );
  } else {
    await db.run(
      sql`INSERT INTO task_history (id, task_id, chat_session_id, assignee_id, user_id, summary, tool_calls, status, source, duration_secs, created_at)
          VALUES (${historyId}, ${taskId}, ${chatSessionId}, ${task.assigneeId}, ${task.userId}, '', NULL, 'pending', ${historySource}, NULL, datetime('now'))`,
    );

    // 4. Copy email and webhook links from task (only for new entries)
    const emailLinks = await db
      .select({ emailId: taskEmails.emailId })
      .from(taskEmails)
      .where(eq(taskEmails.taskId, taskId));
    for (const link of emailLinks) {
      await db.run(
        sql`INSERT INTO history_emails (id, history_id, email_id) VALUES (${crypto.randomUUID()}, ${historyId}, ${link.emailId})`,
      );
    }
    const allWebhookLinks = await db
      .select({ webhookId: taskWebhooks.webhookId })
      .from(taskWebhooks)
      .where(eq(taskWebhooks.taskId, taskId));
    for (const wl of allWebhookLinks) {
      await db.run(
        sql`INSERT INTO history_webhooks (id, history_id, webhook_id) VALUES (${crypto.randomUUID()}, ${historyId}, ${wl.webhookId})`,
      );
    }
  }

  // 5. Load all messages for this session
  const messages = await getSessionMessages(chatSessionId);
  if (messages.length === 0) {
    console.warn(`[history] No messages for session ${chatSessionId}, updating status`);
    await db.run(
      sql`UPDATE task_history SET status = ${session.status ?? "completed"}, summary = 'No messages recorded.' WHERE id = ${historyId}`,
    );
    return;
  }

  // 6. Extract content and tool names
  const { text: sessionContent, toolNames, toolCallDetails } = extractSessionContent(messages);

  // 7. Calculate duration
  let durationSecs: number | null = null;
  if (session.createdAt && session.updatedAt) {
    const start = new Date(session.createdAt).getTime();
    const end = new Date(session.updatedAt).getTime();
    durationSecs = Math.max(0, Math.round((end - start) / 1000));
  }

  // 8. Generate summary (with chunking for large histories)
  const summary = await summarizeSessionContent(sessionContent);

  // 9. Generate embedding
  const { embedding } = await embed({
    model: getEmbeddingProvider(TASK_SESSION_EMBEDDING_MODEL),
    value: summary,
  });

  // 10. Update the pending entry with results
  await db.run(
    sql`UPDATE task_history SET summary = ${summary}, embedding = vector32(${JSON.stringify(embedding)}), tool_calls = ${JSON.stringify(toolNames)}, tool_call_details = ${JSON.stringify(toolCallDetails)}, status = ${session.status}, duration_secs = ${durationSecs} WHERE id = ${historyId}`,
  );

  console.log(
    `[history] Generated history for task=${taskId} session=${chatSessionId} tools=${toolNames.length} duration=${durationSecs}s`,
  );
}

// ── Query helpers ─────────────────────────────────────────────────────

/**
 * Get recent history entries for an assignee, ordered by most recent first.
 */
export async function getRecentHistory(
  userId: string,
  assigneeId: string,
  limit: number,
): Promise<TaskHistoryEntry[]> {
  const rows = await db
    .select({
      id: taskHistory.id,
      taskId: taskHistory.taskId,
      chatSessionId: taskHistory.chatSessionId,
      assigneeId: taskHistory.assigneeId,
      summary: taskHistory.summary,
      toolCalls: taskHistory.toolCalls,
      status: taskHistory.status,
      source: taskHistory.source,
      durationSecs: taskHistory.durationSecs,
      createdAt: taskHistory.createdAt,
      taskTitle: tasks.title,
    })
    .from(taskHistory)
    .innerJoin(tasks, eq(taskHistory.taskId, tasks.id))
    .where(
      and(
        eq(taskHistory.userId, userId),
        eq(taskHistory.assigneeId, assigneeId),
        ne(taskHistory.status, "pending"),
      ),
    )
    .orderBy(desc(taskHistory.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    toolCalls: r.toolCalls as string[] | null,
  }));
}

/**
 * Search history using vector similarity.
 * Returns results ordered by date (primary), filtered by score threshold.
 */
export async function searchHistoryByVector(
  query: string,
  userId: string,
  assigneeId: string | null,
  limit: number,
): Promise<TaskHistoryEntry[]> {
  // Generate embedding for the search query
  const { embedding } = await embed({
    model: getEmbeddingProvider(TASK_SESSION_EMBEDDING_MODEL),
    value: query,
  });

  const embeddingJson = JSON.stringify(embedding);

  // Build WHERE clause
  const assigneeFilter = assigneeId ? sql`AND th.assignee_id = ${assigneeId}` : sql``;

  const rows = await db.all<{
    id: string;
    task_id: string;
    chat_session_id: string;
    assignee_id: string | null;
    summary: string;
    tool_calls: string | null;
    status: string | null;
    source: string | null;
    duration_secs: number | null;
    created_at: string | null;
    task_title: string;
    distance: number;
  }>(
    sql`SELECT th.id, th.task_id, th.chat_session_id, th.assignee_id, th.summary,
               th.tool_calls, th.status, th.source, th.duration_secs, th.created_at,
               t.title as task_title,
               vector_distance_cos(th.embedding, vector32(${embeddingJson})) as distance
        FROM task_history th
        INNER JOIN tasks t ON t.id = th.task_id
        WHERE th.user_id = ${userId} AND th.status != 'pending' ${assigneeFilter}
        ORDER BY th.created_at DESC
        LIMIT ${limit * 2}`,
  );

  // Convert distance to score and filter
  return rows
    .map((r) => ({
      id: r.id,
      taskId: r.task_id,
      chatSessionId: r.chat_session_id,
      assigneeId: r.assignee_id,
      summary: r.summary,
      toolCalls: r.tool_calls ? (JSON.parse(r.tool_calls) as string[]) : null,
      status: r.status,
      source: r.source,
      durationSecs: r.duration_secs,
      createdAt: r.created_at,
      taskTitle: r.task_title,
      score: 1 - r.distance,
    }))
    .filter((r) => r.score >= HISTORY_SIMILARITY_THRESHOLD)
    .slice(0, limit);
}
