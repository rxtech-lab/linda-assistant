import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { audios, documents, slideDecks } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { resend } from "@/lib/resend";
import {
  generateDocumentPdf,
  sanitizeDocumentFilename,
} from "@/lib/documents/pdf";
import { renderDeckToPDF } from "@/lib/slides";

type Attachment = { filename: string; content: Buffer };

function sanitizeFilename(
  title: string,
  ext: string,
  fallback: string,
): string {
  const base = title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || fallback;
  return `${base}.${ext}`;
}

function formatTranscript(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Array<{
      speaker?: string;
      text?: string;
    }>;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed
      .map((seg) => `${seg.speaker ?? "Speaker"}: ${(seg.text ?? "").trim()}`)
      .join("\n\n");
  } catch {
    return null;
  }
}

export const sendEmailTool = (
  fromAddress: string,
  userId: string,
  needsApproval: boolean,
) =>
  tool({
    description:
      "Send an email on behalf of the assignee. This action may require user confirmation before execution. Can optionally attach a document (as PDF), a slide deck (as PDF), and/or an audio recording (as MP3).",
    inputSchema: z.object({
      to: z.string().email().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in HTML format"),
      replyToEmailId: z
        .string()
        .optional()
        .describe("ID of the email being replied to"),
      documentId: z
        .string()
        .optional()
        .describe("ID of a document to attach as PDF"),
      slideDeckId: z
        .string()
        .optional()
        .describe("ID of a slide deck to attach as PDF"),
      audioId: z
        .string()
        .optional()
        .describe("ID of an audio recording to attach as MP3"),
    }),
    needsApproval,
    execute: async ({
      to,
      subject,
      body,
      documentId,
      slideDeckId,
      audioId,
    }) => {
      try {
        const attachments: Attachment[] = [];

        if (documentId) {
          const [doc] = await db
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(eq(documents.id, documentId), eq(documents.userId, userId)),
            );

          if (!doc) return { error: "Document not found" };

          const { buffer, title } = await generateDocumentPdf(documentId);
          attachments.push({
            filename: sanitizeDocumentFilename(title),
            content: buffer,
          });
        }

        if (slideDeckId) {
          const [deck] = await db
            .select({ id: slideDecks.id, title: slideDecks.title })
            .from(slideDecks)
            .where(
              and(
                eq(slideDecks.id, slideDeckId),
                eq(slideDecks.userId, userId),
              ),
            );

          if (!deck) return { error: "Slide deck not found" };

          const buffer = await renderDeckToPDF(slideDeckId);
          attachments.push({
            filename: sanitizeFilename(deck.title, "pdf", "slides"),
            content: buffer,
          });
        }

        if (audioId) {
          const [audio] = await db
            .select({
              id: audios.id,
              title: audios.title,
              audioUrl: audios.audioUrl,
              transcript: audios.transcript,
            })
            .from(audios)
            .where(and(eq(audios.id, audioId), eq(audios.userId, userId)));

          if (!audio) return { error: "Audio not found" };
          if (!audio.audioUrl) return { error: "Audio is not ready yet" };

          const response = await fetch(audio.audioUrl);
          if (!response.ok) {
            return {
              error: `Failed to download audio (HTTP ${response.status})`,
            };
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          attachments.push({
            filename: sanitizeFilename(`${audio.title}-audio`, "mp3", "audio"),
            content: buffer,
          });

          const transcriptText = formatTranscript(audio.transcript);
          if (transcriptText) {
            attachments.push({
              filename: sanitizeFilename(
                `${audio.title}-transcript`,
                "txt",
                "transcript",
              ),
              content: Buffer.from(transcriptText, "utf-8"),
            });
          }
        }

        const result = await resend.emails.send({
          from: fromAddress,
          to: [to],
          subject,
          html: body,
          ...(attachments.length > 0 ? { attachments } : {}),
        });

        if (result.error) {
          return {
            error: `${result.error.name}: ${result.error.message}`,
          };
        }

        return { sent: true, emailId: result.data?.id };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown error sending email";
        console.error("[send_email] Error:", err);
        return { error: message };
      }
    },
  });

export const SEND_EMAIL_TOOL_NAME = "send_email";
