import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPresignedDownloadUrl } from "@/lib/s3";

export const readUploadedFileTool = () =>
  tool({
    description:
      "Read the content of previously uploaded files by converting them to text. Use this after request_upload to process and understand uploaded documents, images, or other files.",
    inputSchema: z.object({
      uploadId: z.string().describe("The upload ID from a previous request_upload result"),
    }),
    needsApproval: false,
    execute: async (input) => {
      const [upload] = await db.select().from(uploads).where(eq(uploads.id, input.uploadId));

      if (!upload) {
        return { error: "Upload not found" };
      }

      if (!upload.uploadedKeys || upload.uploadedKeys.length === 0) {
        return { error: "No files uploaded yet" };
      }

      const markitdownUrl = process.env.MARKITDOWN_SERVER_URL;
      const markitdownApiKey = process.env.MARKITDOWN_API_KEY;

      if (!markitdownUrl) {
        return { error: "MARKITDOWN_SERVER_URL not configured" };
      }

      const results: Array<{ key: string; content?: string; error?: string }> = [];

      for (const key of upload.uploadedKeys) {
        try {
          const presignedUrl = await getPresignedDownloadUrl(key);
          const response = await fetch(`${markitdownUrl}/convert`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(markitdownApiKey && { "X-API-Key": markitdownApiKey }),
            },
            body: JSON.stringify({ file: presignedUrl }),
            signal: AbortSignal.timeout(120_000),
          });

          if (!response.ok) {
            const detail = await response.text().catch(() => response.statusText);
            results.push({ key, error: `Conversion failed: ${detail}` });
            continue;
          }

          const data = (await response.json()) as { content: string };
          results.push({ key, content: data.content });
        } catch (err) {
          results.push({
            key,
            error: `Failed to process file: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      return { uploadId: input.uploadId, files: results };
    },
  });

export const READ_UPLOADED_FILE_TOOL_NAME = "read_uploaded_file";
