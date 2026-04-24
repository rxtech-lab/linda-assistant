import "server-only";
import { db } from "@/lib/db";
import { briefings, assignees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type PublicBriefingRow = typeof briefings.$inferSelect & {
  assignee: Pick<typeof assignees.$inferSelect, "name" | "personality"> | null;
};

export async function fetchBriefingById(id: string): Promise<PublicBriefingRow | null> {
  const [row] = await db
    .select({
      id: briefings.id,
      userId: briefings.userId,
      chatSessionId: briefings.chatSessionId,
      assigneeId: briefings.assigneeId,
      title: briefings.title,
      content: briefings.content,
      imageUrl: briefings.imageUrl,
      podcastUrl: briefings.podcastUrl,
      isPublic: briefings.isPublic,
      createdAt: briefings.createdAt,
      updatedAt: briefings.updatedAt,
      assignee: {
        name: assignees.name,
        personality: assignees.personality,
      },
    })
    .from(briefings)
    .leftJoin(assignees, eq(briefings.assigneeId, assignees.id))
    .where(eq(briefings.id, id));
  if (!row) return null;
  return {
    ...row,
    assignee: row.assignee?.name ? row.assignee : null,
  };
}
