import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const requestUploadTool = () =>
  tool({
    description:
      "Request the user to upload one or more files. Use this when you need the user to provide documents, images, photos, or any files. The user will be prompted with an upload interface where they can select files from their device, photo library, or camera. Specify the expected file extensions and number of files needed.",
    inputSchema: z
      .object({
        title: z.string().describe("Title shown to the user for the upload request"),
        description: z
          .string()
          .optional()
          .describe("Additional context about what files to upload"),
        number_uploads: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe(
            "Number of files expected from the user. If omitted, the user can upload any number of files.",
          ),
        extensions: z
          .array(z.string())
          .describe(
            "Accepted file types for the upload, e.g. ['jpg', 'png', 'pdf']. Use ['*'] for any file type.",
          ),
        urls: z
          .array(z.string())
          .optional()
          .describe(
            "Optional presigned S3 PUT URLs from an external source (e.g. MCP tool). If provided, these are passed through directly. If omitted, URLs are generated automatically.",
          ),
      })
      .refine((d) => !d.urls || !d.number_uploads || d.urls.length === d.number_uploads, {
        message: "urls length must match number_uploads when provided",
      }),
    needsApproval: true,
    execute: async (_input, { toolCallId }) => {
      const [upload] = await db.select().from(uploads).where(eq(uploads.toolCallId, toolCallId));

      if (!upload) {
        return { error: "Upload record not found" };
      }

      if (upload.status === "rejected") {
        return { error: "User rejected the upload request" };
      }

      return {
        uploadId: upload.id,
        status: upload.status,
        uploadedKeys: upload.uploadedKeys,
        title: upload.title,
        numberUploads: upload.numberUploads,
      };
    },
  });

export const REQUEST_UPLOAD_TOOL_NAME = "request_upload";
