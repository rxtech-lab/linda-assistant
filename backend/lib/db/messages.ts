import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { eq, and, lt, sql, asc, desc } from "drizzle-orm";

/** Load all messages for a session, ordered by seq */
export async function getSessionMessages(chatSessionId: string): Promise<ModelMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.chatSessionId, chatSessionId))
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

/** Delete all messages for a session */
export async function deleteSessionMessages(chatSessionId: string): Promise<void> {
  await db.delete(messages).where(eq(messages.chatSessionId, chatSessionId));
}

function rowToModelMessage(row: typeof messages.$inferSelect): ModelMessage {
  return {
    id: row.id,
    role: row.role as ModelMessage["role"],
    content: row.content as ModelMessage["content"],
  } as ModelMessage;
}
