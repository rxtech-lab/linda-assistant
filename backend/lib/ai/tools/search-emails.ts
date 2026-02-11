import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailInbox } from "@/lib/db/schema";
import { eq, like, or, and, desc } from "drizzle-orm";

export const searchEmailsTool = (userId: string) =>
  tool({
    description: "Search through the user's email inbox by keyword",
    inputSchema: z.object({
      query: z.string().describe("Search query to match against subject, body, or sender"),
      limit: z.number().default(10).describe("Maximum number of results"),
    }),
    execute: async ({ query, limit }) => {
      const pattern = `%${query}%`;
      const results = await db
        .select({
          id: emailInbox.id,
          fromEmail: emailInbox.fromEmail,
          fromName: emailInbox.fromName,
          subject: emailInbox.subject,
          receivedAt: emailInbox.receivedAt,
          isRead: emailInbox.isRead,
        })
        .from(emailInbox)
        .where(
          and(
            eq(emailInbox.userId, userId),
            or(
              like(emailInbox.subject, pattern),
              like(emailInbox.body, pattern),
              like(emailInbox.fromEmail, pattern),
              like(emailInbox.fromName, pattern),
            ),
          ),
        )
        .limit(limit)
        .orderBy(desc(emailInbox.receivedAt));

      return results;
    },
  });

export const SEARCH_EMAILS_TOOL_NAME = "search_emails";
