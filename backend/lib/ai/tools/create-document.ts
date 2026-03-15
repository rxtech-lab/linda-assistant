import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { tool } from "ai";
import { z } from "zod";

export const createDocumentTool = (userId: string, chatSessionId: string) =>
  tool({
    description:
      "Create a formatted document (report, analysis, article, etc). Use this when the response requires long-form structured content, or the user asks for a report/document. The document will be saved and the user can view, download, or share it.",
    inputSchema: z.object({
      title: z.string().describe("Document title"),
      format: z
        .enum(["markdown", "html"])
        .describe(
          "Content format. Prefer markdown unless rich HTML formatting is specifically needed.",
        ),
      content: z.string().describe("The full document content in the specified format"),
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
