import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resend } from "@/lib/resend";
import { generateDocumentPdf, sanitizeDocumentFilename } from "@/lib/documents/pdf";

export const sendEmailTool = (fromAddress: string, userId: string, needsApproval: boolean) =>
  tool({
    description:
      "Send an email on behalf of the assignee. This action may require user confirmation before execution. Can optionally attach a document as a PDF.",
    inputSchema: z.object({
      to: z.string().email().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in HTML format"),
      replyToEmailId: z.string().optional().describe("ID of the email being replied to"),
      documentId: z.string().optional().describe("ID of a document to attach as PDF"),
    }),
    needsApproval,
    execute: async ({ to, subject, body, documentId }) => {
      try {
        let attachments: Array<{ filename: string; content: Buffer }> | undefined;

        if (documentId) {
          // Verify document ownership
          const [doc] = await db
            .select({ id: documents.id })
            .from(documents)
            .where(and(eq(documents.id, documentId), eq(documents.userId, userId)));

          if (!doc) {
            return { error: "Document not found" };
          }

          const { buffer, title } = await generateDocumentPdf(documentId);
          const filename = sanitizeDocumentFilename(title);
          attachments = [{ filename, content: buffer }];
        }

        const result = await resend.emails.send({
          from: fromAddress,
          to: [to],
          subject,
          html: body,
          ...(attachments ? { attachments } : {}),
        });

        if (result.error) {
          return {
            error: `${result.error.name}: ${result.error.message}`,
          };
        }

        return { sent: true, emailId: result.data?.id };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error sending email";
        console.error("[send_email] Error:", err);
        return { error: message };
      }
    },
  });

export const SEND_EMAIL_TOOL_NAME = "send_email";
