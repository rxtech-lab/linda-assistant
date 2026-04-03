import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { tool } from "ai";
import { z } from "zod";

export const createDocumentTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Create a formatted document (report, analysis, article, etc). Use this when the response requires long-form structured content, or the user asks for a report/document. The document will be saved and the user can view, download, or share it.\n\n" +
      "Content guidelines:\n" +
      "- Use markdown tables to present structured/comparative data (e.g. specs, comparisons, schedules, metrics)\n" +
      "- Use headings (##, ###) to organize sections clearly\n" +
      "- Use bullet points for lists, bold for emphasis, and blockquotes for callouts\n" +
      "- Keep paragraphs concise and scannable\n" +
      "- For data-heavy content, prefer tables over prose\n" +
      "- For complex or abstract topics, use generate_image to create illustrative visuals and embed them via ![alt](url) in the content\n" +
      "- To embed slide presentations as illustrations, first use create_slides, then embed with the syntax {{slide:deckId}} in the content",
    inputSchema: z.object({
      title: z.string().describe("Document title"),
      format: z
        .enum(["markdown", "html"])
        .describe(
          "Content format. Prefer markdown unless rich HTML formatting is specifically needed.",
        ),
      content: z
        .string()
        .describe(
          "The full document content in the specified format. Use markdown tables for structured data, comparisons, and metrics.",
        ),
    }),
    execute: async ({ title, format, content }) => {
      const [doc] = await db
        .insert(documents)
        .values({ userId, chatSessionId, title, format, content })
        .returning();

      return {
        documentId: doc.id,
        title: doc.title,
        format: doc.format,
      };
    },
  });

export const CREATE_DOCUMENT_TOOL_NAME = "create_document";
