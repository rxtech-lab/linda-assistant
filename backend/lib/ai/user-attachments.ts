import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { sql } from "drizzle-orm";
import { extensionToMimeType } from "@/lib/s3";

interface Attachment {
  type: "image" | "audio" | "pdf" | "file";
  url: string;
  key?: string;
  name?: string;
  mimeType?: string;
}

export interface ProcessedAttachments {
  /** Content parts to add to the user message (images, files, and text hints) */
  userContentParts: unknown[];
  /** Optional system message to inject after the user message */
  systemMessage: { role: "system"; content: string } | null;
}

/**
 * Process user message attachments.
 *
 * - Images become `{ type: "image", image: url }` content parts on the user message.
 * - Files become `{ type: "file", data: url, mimeType }` content parts (persisted in DB
 *   for reload display, and sent to the model via AI SDK FilePart).
 * - A text hint listing attached files is appended so the model is aware.
 */
export async function processUserAttachments(
  attachments: Attachment[],
  userId: string,
  chatSessionId: string,
): Promise<ProcessedAttachments> {
  const userContentParts: unknown[] = [];
  const imageAttachments = attachments.filter((a) => a.type === "image");
  const fileAttachments = attachments.filter((a) => a.type !== "image");

  // Images: pass directly to model via URL
  for (const attachment of imageAttachments) {
    userContentParts.push({
      type: "image",
      image: new URL(attachment.url),
    });
  }

  let systemMessage: ProcessedAttachments["systemMessage"] = null;

  // Files: add as file content parts (persisted in DB for reload) + create upload record
  if (fileAttachments.length > 0) {
    // Add file parts to user message content (for DB persistence and model access)
    for (const attachment of fileAttachments) {
      const ext = attachment.name?.split(".").pop()?.toLowerCase() ?? "";
      const mime = attachment.mimeType ?? extensionToMimeType(ext);
      userContentParts.push({
        type: "file",
        data: new URL(attachment.url),
        mediaType: mime,
      });
    }

    // Use the S3 key directly if provided, otherwise extract from URL
    const uploadedKeys = fileAttachments.map((a) => {
      if (a.key) return a.key;
      const url = new URL(a.url);
      return url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
    });

    const extensions = fileAttachments.map((a) => {
      const ext = a.name?.split(".").pop() ?? "*";
      return ext.toLowerCase();
    });

    await db
      .insert(uploads)
      .values({
        userId,
        chatSessionId,
        toolCallId: `user-upload-${Date.now()}`,
        toolName: "user_attachment",
        approvalId: `user-upload-${Date.now()}`,
        title: "User attached files",
        numberUploads: fileAttachments.length,
        extensions,
        urls: [],
        uploadedKeys,
        status: "completed",
        completedAt: sql`(datetime('now'))`,
      })
      .returning();

    // Add a text hint so the model knows files are attached
    const fileList = fileAttachments
      .map((a) => {
        const name = a.name ?? "unknown file";
        const ext = name.split(".").pop()?.toLowerCase() ?? "";
        const mime = a.mimeType ?? extensionToMimeType(ext);
        return `${name} (${mime})`;
      })
      .join(", ");

    userContentParts.push({
      type: "text",
      text: `[Attached ${fileAttachments.length} file(s): ${fileList}]`,
    });
  }

  return { userContentParts, systemMessage };
}
