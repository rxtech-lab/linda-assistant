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

/** MIME types the model can handle natively as file content parts. */
const MODEL_SUPPORTED_FILE_MIMES = new Set(["application/pdf"]);

/**
 * Process user message attachments.
 *
 * - Images become `{ type: "image", image: url }` content parts on the user message.
 * - PDFs become `{ type: "file", data: url, mediaType }` content parts (model-native).
 * - All other files become `{ type: "file" }` parts for frontend rendering, but are
 *   stripped before the model sees them. A text hint with the upload ID and URL tells
 *   the model to use `read_uploaded_file` to access the content.
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

  // Create upload record for images so read_uploaded_file can access them
  // (e.g. QR codes, handwritten text, complex diagrams the model can't parse visually)
  if (imageAttachments.length > 0) {
    const imageKeys = imageAttachments.map((a) => {
      if (a.key) return a.key;
      const url = new URL(a.url);
      return url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
    });

    const imageExts = imageAttachments.map((a) => {
      const ext = a.name?.split(".").pop() ?? "png";
      return ext.toLowerCase();
    });

    const [imageUploadRecord] = await db
      .insert(uploads)
      .values({
        userId,
        chatSessionId,
        toolCallId: `user-upload-img-${Date.now()}`,
        toolName: "user_attachment",
        approvalId: `user-upload-img-${Date.now()}`,
        title: "User attached images",
        numberUploads: imageAttachments.length,
        extensions: imageExts,
        urls: [],
        uploadedKeys: imageKeys,
        status: "completed",
        completedAt: sql`(datetime('now'))`,
      })
      .returning();

    const imageList = imageAttachments
      .map((a, i) => `${a.name ?? "image"} (key: ${imageKeys[i]})`)
      .join(", ");

    userContentParts.push({
      type: "text",
      text: `[Attached ${imageAttachments.length} image(s): ${imageList}. If the image contains a QR code, barcode, or content you cannot recognize visually, use read_uploaded_file with uploadId "${imageUploadRecord.id}" or fileKey to extract its content.]`,
    });
  }

  if (fileAttachments.length > 0) {
    // Add file parts to user message content (persisted in DB for frontend rendering)
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

    const [uploadRecord] = await db
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

    // Build text hints for the model
    const modelSupported: string[] = [];
    const toolReadable: string[] = [];

    for (let i = 0; i < fileAttachments.length; i++) {
      const attachment = fileAttachments[i];
      const name = attachment.name ?? "unknown file";
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      const mime = attachment.mimeType ?? extensionToMimeType(ext);

      if (MODEL_SUPPORTED_FILE_MIMES.has(mime)) {
        modelSupported.push(`${name} (${mime})`);
      } else {
        toolReadable.push(
          `${name} (${mime}, key: ${uploadedKeys[i]})`,
        );
      }
    }

    // Hint for model-supported files (PDF) — model sees these as file parts directly
    if (modelSupported.length > 0) {
      userContentParts.push({
        type: "text",
        text: `[Attached ${modelSupported.length} file(s): ${modelSupported.join(", ")}]`,
      });
    }

    // Hint for unsupported files — model should use read_uploaded_file tool
    if (toolReadable.length > 0) {
      userContentParts.push({
        type: "text",
        text: `[Attached ${toolReadable.length} file(s) that require tool access: ${toolReadable.join(", ")}. Use read_uploaded_file with uploadId "${uploadRecord.id}" or fileKey to read their content.]`,
      });
    }
  }

  return { userContentParts, systemMessage };
}
