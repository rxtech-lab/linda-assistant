import { db } from "@/lib/db";
import { tasks, chatSessions } from "@/lib/db/schema";
import { eq, and, ne, sql } from "drizzle-orm";

export async function syncTaskStatus(taskId: string) {
  const sessions = await db
    .select({ status: chatSessions.status })
    .from(chatSessions)
    .where(eq(chatSessions.taskId, taskId));

  if (sessions.length === 0) return;

  const hasActive = sessions.some(
    (s) =>
      s.status === "starting" ||
      s.status === "in_progress" ||
      s.status === "waiting_confirmation"
  );

  const newStatus = hasActive ? "running" : "finished";

  await db
    .update(tasks)
    .set({
      status: newStatus,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(
      and(eq(tasks.id, taskId), ne(tasks.status, "cancelled"))
    );
}
