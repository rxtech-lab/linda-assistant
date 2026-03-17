import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, like, or, and, desc } from "drizzle-orm";

export const searchDocumentsTool = (userId: string, needsApproval: boolean) =>
  tool({
    description: "Search through existing documents by keyword to find relevant content",
    needsApproval,
    inputSchema: z.object({
      query: z.string().describe("Search query to match against document title or content"),
      limit: z.number().default(10).describe("Maximum number of results"),
    }),
    execute: async ({ query, limit }) => {
      const pattern = `%${query}%`;
      const results = await db
        .select({
          id: documents.id,
          title: documents.title,
          format: documents.format,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(
          and(
            eq(documents.userId, userId),
            or(like(documents.title, pattern), like(documents.content, pattern)),
          ),
        )
        .limit(limit)
        .orderBy(desc(documents.createdAt));

      return results;
    },
  });

export const SEARCH_DOCUMENTS_TOOL_NAME = "search_documents";
