import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, and, lt, gte, sql, asc, desc } from "drizzle-orm";

/** Load all messages for a session (including compacted), ordered by seq */
export async function getSessionMessages(chatSessionId: string): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatSessionId, chatSessionId))
    .orderBy(asc(messages.seq));

  return rows.map(rowToModelMessage);
}

/** Load only non-compacted messages for a session (for AI agent use), ordered by seq */
export async function getActiveSessionMessages(chatSessionId: string): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.chatSessionId, chatSessionId), eq(messages.isCompacted, false)))
    .orderBy(asc(messages.seq));

  return rows.map(rowToModelMessage);
}

/** Insert new messages starting at MAX(seq)+1 */
export async function insertMessages(
  chatSessionId: string,
  newMessages: ModelMessage[],
): Promise<void> {
  if (newMessages.length === 0) return;

  const [maxRow] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(${messages.seq}), -1)` })
    .from(messages)
    .where(eq(messages.chatSessionId, chatSessionId));

  let nextSeq = (maxRow?.maxSeq ?? -1) + 1;

  const values = newMessages.map((msg) => {
    const record = msg as Record<string, unknown>;
    return {
      id: (record.id as string) || undefined,
      chatSessionId,
      seq: nextSeq++,
      role: msg.role,
      content: msg.content as unknown,
    };
  });

  await db.insert(messages).values(values);
}

/** Update a single message's content JSON (for annotation of already-persisted messages) */
export async function updateMessageContent(messageId: string, content: unknown): Promise<void> {
  await db.update(messages).set({ content }).where(eq(messages.id, messageId));
}

/**
 * Insert a message right after a target message (by ID) in the seq ordering.
 * Shifts all subsequent messages' seq up by 1 to make room.
 */
export async function insertMessageAfter(
  chatSessionId: string,
  afterMessageId: string,
  newMessage: ModelMessage,
): Promise<void> {
  const [target] = await db
    .select({ seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.chatSessionId, chatSessionId), eq(messages.id, afterMessageId)));

  if (!target) {
    await insertMessages(chatSessionId, [newMessage]);
    return;
  }

  const insertSeq = target.seq + 1;

  // Shift all messages at or after insertSeq up by 1
  await db
    .update(messages)
    .set({ seq: sql`${messages.seq} + 1` })
    .where(and(eq(messages.chatSessionId, chatSessionId), gte(messages.seq, insertSeq)));

  const record = newMessage as Record<string, unknown>;
  await db.insert(messages).values({
    id: (record.id as string) || undefined,
    chatSessionId,
    seq: insertSeq,
    role: newMessage.role,
    content: newMessage.content as unknown,
  });
}

/** Cursor-based pagination: return `limit` messages before a given ID (or from the end) */
export async function getPagedMessages(
  chatSessionId: string,
  limit: number,
  beforeId?: string,
): Promise<{ messages: ModelMessage[]; nextCursor: string | null }> {
  let maxSeq: number | undefined;

  if (beforeId) {
    const [cursor] = await db
      .select({ seq: messages.seq })
      .from(messages)
      .where(and(eq(messages.chatSessionId, chatSessionId), eq(messages.id, beforeId)));

    if (!cursor) throw new Error("Cursor not found");
    maxSeq = cursor.seq;
  }

  const condition =
    maxSeq !== undefined
      ? and(eq(messages.chatSessionId, chatSessionId), lt(messages.seq, maxSeq))
      : eq(messages.chatSessionId, chatSessionId);

  // Fetch limit+1 to check if there are more
  const rows = await db
    .select()
    .from(messages)
    .where(condition)
    .orderBy(desc(messages.seq))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit).reverse(); // reverse to chronological

  const nextCursor = hasMore ? (pageRows[0]?.id ?? null) : null;

  return {
    messages: pageRows.map(rowToModelMessage),
    nextCursor,
  };
}

/**
 * Compact messages: mark old messages (seq < keepFromSeq) as compacted,
 * then insert the summary message at the split boundary.
 *
 * Old messages are preserved in the DB for user history but excluded
 * from AI agent context via getSessionMessages().
 *
 * The summary message is inserted at seq = keepFromSeq, and remaining
 * messages are shifted up by 1 to make room.
 */
export async function compactMessages(
  chatSessionId: string,
  summaryMessage: ModelMessage,
  keepFromSeq: number,
): Promise<void> {
  const record = summaryMessage as Record<string, unknown>;

  // 1. Mark old non-compacted messages as compacted (preserve for user history)
  await db
    .update(messages)
    .set({ isCompacted: true })
    .where(
      and(
        eq(messages.chatSessionId, chatSessionId),
        lt(messages.seq, keepFromSeq),
        eq(messages.isCompacted, false),
      ),
    );

  // 2. Shift remaining messages' seq by +1 to make room for the summary
  await db
    .update(messages)
    .set({
      seq: sql`${messages.seq} + 1`,
    })
    .where(and(eq(messages.chatSessionId, chatSessionId), gte(messages.seq, keepFromSeq)));

  // 3. Insert summary message at seq = keepFromSeq
  await db.insert(messages).values({
    id: (record.id as string) || undefined,
    chatSessionId,
    seq: keepFromSeq,
    role: summaryMessage.role,
    content: summaryMessage.content as unknown,
    isCompacted: false,
  });
}

/** Get the count of messages in a session */
export async function getMessageCount(chatSessionId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(messages)
    .where(eq(messages.chatSessionId, chatSessionId));
  return row?.count ?? 0;
}

/** Delete all messages for a session */
export async function deleteSessionMessages(chatSessionId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.chatSessionId, chatSessionId));
}

function rowToModelMessage(row: typeof messages.$inferSelect): ModelMessage {
  let content = row.content as ModelMessage["content"];

  // Strip reasoning parts from assistant messages — they're internal AI traces
  if (row.role === "assistant" && Array.isArray(content)) {
    content = (content as Array<{ type: string }>).filter(
      (part) => part.type !== "reasoning",
    ) as typeof content;
  }

  return {
    id: row.id,
    role: row.role as ModelMessage["role"],
    content,
    seq: row.seq,
    isCompacted: row.isCompacted,
  } as ModelMessage;
}
