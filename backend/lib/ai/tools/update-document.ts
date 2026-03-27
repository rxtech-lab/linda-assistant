import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { tool } from "ai";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";

export const updateDocumentTool = (userId: string) =>
  tool({
    description:
      "Update an existing document's content. Use when the user asks to revise, edit, or update a previously created document.\n\n" +
      "Content guidelines:\n" +
      "- Use markdown tables to present structured/comparative data (e.g. specs, comparisons, schedules, metrics)\n" +
      "- Use headings (##, ###) to organize sections clearly\n" +
      "- Use bullet points for lists, bold for emphasis, and blockquotes for callouts\n" +
      "- For data-heavy content, prefer tables over prose\n" +
      "- For complex or abstract topics, use generate_image to create illustrative visuals and embed them via ![alt](url) in the content",
    inputSchema: z.object({
      id: z.string().describe("Document ID to update"),
      content: z
        .string()
        .describe(
          "The updated document content. Use markdown tables for structured data, comparisons, and metrics.",
        ),
    }),
    execute: async ({ id, content }) => {
      const [updated] = await db
        .update(documents)
        .set({ content, updatedAt: sql`(datetime('now'))` })
        .where(and(eq(documents.id, id), eq(documents.userId, userId)))
        .returning();

      if (!updated) return { error: "Document not found" };
      return { documentId: updated.id, title: updated.title };
    },
  });

export const UPDATE_DOCUMENT_TOOL_NAME = "update_document";
