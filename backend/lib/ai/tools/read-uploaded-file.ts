import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { uploads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getPresignedDownloadUrl } from "@/lib/s3";

/** Approximate token count using 4 chars ≈ 1 token heuristic. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Default max tokens returned per file when readAll is false. */
const DEFAULT_MAX_TOKENS = 5000;

/** Convert a file URL via markitdown and return the full text content. */
async function convertFile(
  fileUrl: string,
  markitdownUrl: string,
  markitdownApiKey: string | undefined,
): Promise<string> {
  const response = await fetch(`${markitdownUrl}/convert`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(markitdownApiKey && { "X-API-Key": markitdownApiKey }),
    },
    body: JSON.stringify({ file: fileUrl }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Conversion failed: ${detail}`);
  }

  const data = (await response.json()) as { content: string };
  return data.content;
}

/**
 * Apply offset/limit/grep to converted file content and return a windowed result
 * with metadata about total size.
 */
function windowContent(
  fullContent: string,
  options: {
    readAll?: boolean;
    offset?: number;
    limit?: number;
    grep?: string;
  },
): {
  content: string;
  totalLines: number;
  totalTokens: number;
  returnedLines: number;
  returnedTokens: number;
  truncated: boolean;
} {
  const lines = fullContent.split("\n");
  const totalLines = lines.length;
  const totalTokens = estimateTokens(fullContent);

  // Grep mode — return matching lines (no token limit)
  if (options.grep) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(options.grep, "i");
    } catch {
      pattern = new RegExp(options.grep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    }
    const matched = lines
      .map((line, i) => ({ line, lineNumber: i + 1 }))
      .filter(({ line }) => pattern.test(line));
    const grepContent = matched.map(({ line, lineNumber }) => `${lineNumber}: ${line}`).join("\n");
    return {
      content: grepContent,
      totalLines,
      totalTokens,
      returnedLines: matched.length,
      returnedTokens: estimateTokens(grepContent),
      truncated: false,
    };
  }

  // Read all mode
  if (options.readAll) {
    return {
      content: fullContent,
      totalLines,
      totalTokens,
      returnedLines: totalLines,
      returnedTokens: totalTokens,
      truncated: false,
    };
  }

  // Windowed mode with offset + limit (token-based)
  const startLine = options.offset ?? 0;
  const maxTokens = options.limit ?? DEFAULT_MAX_TOKENS;

  let tokenCount = 0;
  const selected: string[] = [];
  let endLine = startLine;

  for (let i = startLine; i < lines.length; i++) {
    const lineTokens = estimateTokens(lines[i] + "\n");
    if (tokenCount + lineTokens > maxTokens && selected.length > 0) break;
    selected.push(`${i + 1}: ${lines[i]}`);
    tokenCount += lineTokens;
    endLine = i + 1;
  }

  const windowedContent = selected.join("\n");
  return {
    content: windowedContent,
    totalLines,
    totalTokens,
    returnedLines: selected.length,
    returnedTokens: estimateTokens(windowedContent),
    truncated: endLine < totalLines,
  };
}

export const readUploadedFileTool = () =>
  tool({
    description:
      "Read and extract content from uploaded files or images by converting them to text. Use this for: QR codes, barcodes, documents (CSV, Excel, Word), or any file/image you cannot recognize or parse visually. By default returns the first ~5000 tokens with file size metadata. Use offset/limit to paginate, grep to search, or readAll to get everything.",
    inputSchema: z.object({
      uploadId: z
        .string()
        .optional()
        .describe("The upload ID from a previous request_upload result or user attachment hint"),
      fileKey: z
        .string()
        .optional()
        .describe("S3 key of the file (alternative to uploadId). The key is converted to a presigned URL automatically."),
      readAll: z
        .boolean()
        .optional()
        .describe("Return the entire file content without truncation (default: false)"),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Start reading from this line number (0-based, default: 0)"),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Max tokens to return (default: 5000). Use with offset to paginate."),
      grep: z
        .string()
        .optional()
        .describe("Regex pattern to search for — returns only matching lines with line numbers"),
    }),
    needsApproval: false,
    execute: async (input) => {
      const markitdownUrl = process.env.MARKITDOWN_SERVER_URL;
      const markitdownApiKey = process.env.MARKITDOWN_API_KEY;

      if (!markitdownUrl) {
        return { error: "MARKITDOWN_SERVER_URL not configured" };
      }

      const windowOpts = {
        readAll: input.readAll,
        offset: input.offset,
        limit: input.limit,
        grep: input.grep,
      };

      // Direct key mode — convert a single file by S3 key
      if (input.fileKey) {
        try {
          const presignedUrl = await getPresignedDownloadUrl(input.fileKey);
          const fullContent = await convertFile(presignedUrl, markitdownUrl, markitdownApiKey);
          const result = windowContent(fullContent, windowOpts);
          return { fileKey: input.fileKey, ...result };
        } catch (err) {
          return {
            error: `Failed to process file: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      // Upload ID mode — look up upload record and convert all files
      if (!input.uploadId) {
        return { error: "Either uploadId or fileKey must be provided" };
      }

      const [upload] = await db.select().from(uploads).where(eq(uploads.id, input.uploadId));

      if (!upload) {
        return { error: "Upload not found" };
      }

      if (!upload.uploadedKeys || upload.uploadedKeys.length === 0) {
        return { error: "No files uploaded yet" };
      }

      const results: Array<{
        key: string;
        content?: string;
        totalLines?: number;
        totalTokens?: number;
        returnedLines?: number;
        returnedTokens?: number;
        truncated?: boolean;
        error?: string;
      }> = [];

      for (const key of upload.uploadedKeys) {
        try {
          const presignedUrl = await getPresignedDownloadUrl(key);
          const fullContent = await convertFile(presignedUrl, markitdownUrl, markitdownApiKey);
          const windowed = windowContent(fullContent, windowOpts);
          results.push({ key, ...windowed });
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
