import crypto from "crypto";
import type { ModelMessage } from "ai";
import { db } from "@/lib/db";
import { uploads, chatSessions } from "@/lib/db/schema";
import type { UploadUrlItem } from "@/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { syncTaskStatus } from "@/lib/utils/task-status-sync";
import { publishTask, publishEvent } from "@/lib/queue/producer";
import { annotateToolCallUpload } from "./agent";
import { getActiveSessionMessages, insertMessages, updateMessageContent } from "@/lib/db/messages";
import { verifyObjectExists } from "@/lib/s3";

interface CreateUploadRequestParams {
  userId: string;
  chatSessionId: string;
  toolCallId: string;
  toolName: string;
  approvalId: string;
  title: string;
  description?: string;
  numberUploads: number | null;
  extensions: string[];
  externalUrls?: string[];
  skipNotification?: boolean;
}

export async function createUploadRequest(params: CreateUploadRequestParams) {
  let urls: UploadUrlItem[];

  if (params.externalUrls && params.externalUrls.length > 0) {
    // External presigned URLs provided (e.g. from MCP tools)
    urls = params.externalUrls.map((url) => ({
      url,
      key: `external/${crypto.randomUUID()}`,
      extension: "*",
    }));
  } else {
    // URLs are generated on-demand when the client requests them with actual file extensions
    urls = [];
  }

  const [upload] = await db
    .insert(uploads)
    .values({
      userId: params.userId,
      chatSessionId: params.chatSessionId,
      toolCallId: params.toolCallId,
      toolName: params.toolName,
      approvalId: params.approvalId,
      title: params.title,
      description: params.description,
      numberUploads: params.numberUploads,
      extensions: params.extensions,
      urls,
    })
    .returning();

  if (!params.skipNotification) {
    await sendPushNotification(params.userId, {
      title: "Upload Requested",
      body:
        params.numberUploads === 1
          ? `Linda needs you to upload a file: ${params.title}`
          : `Linda needs you to upload ${params.numberUploads} files: ${params.title}`,
      data: {
        type: "upload",
        uploadId: upload.id,
        chatSessionId: params.chatSessionId,
      },
    }).catch((err) => {
      console.error("Failed to send push notification:", err);
    });
  }

  return upload;
}

export async function sendUploadGroupNotification(
  userId: string,
  chatSessionId: string,
  items: Array<{ uploadId: string; fileCount: number }>,
) {
  if (items.length === 0) return;

  const totalFiles = items.reduce((sum, i) => sum + i.fileCount, 0);
  const title = "Upload Requested";
  const body = `Linda needs you to upload ${totalFiles} file${totalFiles === 1 ? "" : "s"}. Please review.`;

  await sendPushNotification(userId, {
    title,
    body,
    data: {
      type: "upload",
      chatSessionId,
      ...(items.length === 1 ? { uploadId: items[0].uploadId } : {}),
    },
  }).catch((err) => {
    console.error("Failed to send grouped push notification:", err);
  });
}

export async function resolveUploadRequest(
  uploadId: string,
  action: "complete" | "reject",
  uploadedKeys?: string[],
) {
  console.log(`[resolveUpload] START id=${uploadId} action=${action}`);

  const [upload] = await db.select().from(uploads).where(eq(uploads.id, uploadId));

  if (!upload) throw new Error("Upload not found");
  if (upload.status !== "pending") throw new Error("Upload already resolved");

  console.log(
    `[resolveUpload] Found upload: session=${upload.chatSessionId} toolCallId=${upload.toolCallId}`,
  );

  if (action === "complete") {
    if (!uploadedKeys || uploadedKeys.length === 0) {
      throw new Error("No uploaded keys provided");
    }
    if (upload.numberUploads !== null && uploadedKeys.length !== upload.numberUploads) {
      throw new Error(`Expected ${upload.numberUploads} uploaded keys, got ${uploadedKeys.length}`);
    }

    // Skip S3 verification in E2E mode (files go to mock endpoint, not real S3)
    const isE2E = process.env.IS_E2E?.toLowerCase() === "true";
    if (!isE2E) {
      const verifyResults = await Promise.all(uploadedKeys.map((key) => verifyObjectExists(key)));
      const missingKeys = uploadedKeys.filter((_, i) => !verifyResults[i]);
      if (missingKeys.length > 0) {
        throw new Error(
          `Upload verification failed: files not found in storage: ${missingKeys.join(", ")}`,
        );
      }
    }
  }

  const resolvedStatus = action === "complete" ? "completed" : "rejected";

  // Update upload status
  await db
    .update(uploads)
    .set({
      status: resolvedStatus,
      uploadedKeys: action === "complete" ? uploadedKeys : null,
      completedAt: sql`(datetime('now'))`,
    })
    .where(eq(uploads.id, uploadId));

  console.log(`[resolveUpload] Updated upload status to ${resolvedStatus}`);

  // Load the chat session
  const [session] = await db
    .select({
      id: chatSessions.id,
      assigneeId: chatSessions.assigneeId,
      taskId: chatSessions.taskId,
    })
    .from(chatSessions)
    .where(eq(chatSessions.id, upload.chatSessionId));

  if (!session) throw new Error("Chat session not found");

  // Load persisted messages, annotate the tool-call
  const persistedMessages = await getActiveSessionMessages(upload.chatSessionId);
  console.log(`[resolveUpload] Loaded ${persistedMessages.length} messages for annotation`);

  annotateToolCallUpload(persistedMessages, upload.toolCallId, upload.id, resolvedStatus);

  // Find the annotated message and update its content in DB
  for (const msg of persistedMessages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content as Record<string, unknown>[]) {
      if (part.type === "tool-call" && part.toolCallId === upload.toolCallId) {
        const record = msg as Record<string, unknown>;
        await updateMessageContent(record.id as string, msg.content);
      }
    }
  }

  console.log(`[resolveUpload] Annotated messages, about to handle reject/events`);

  // For rejection: insert a tool-result with isError so the SDK sees a complete pair
  if (action === "reject") {
    const rejectResult = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: upload.toolCallId,
          toolName: upload.toolName,
          output: { error: "User rejected the upload request" },
          isError: true,
        },
      ],
    } as unknown as ModelMessage;
    await insertMessages(upload.chatSessionId, [rejectResult]);

    // Emit tool-result event so SSE clients see the rejection immediately
    await publishEvent({
      sessionId: upload.chatSessionId,
      event: "tool-result",
      data: {
        toolCallId: upload.toolCallId,
        toolName: upload.toolName,
        output: { error: "User rejected the upload request" },
        isError: true,
        error: "User rejected the upload request",
      },
      timestamp: Date.now(),
    });
  }

  console.log(`[resolveUpload] About to emit upload_resolved event`);

  // Emit upload_resolved event so client can update UI immediately
  await publishEvent({
    sessionId: upload.chatSessionId,
    event: "upload_resolved",
    data: {
      uploadId,
      toolCallId: upload.toolCallId,
      toolName: upload.toolName,
      action: resolvedStatus,
    },
    timestamp: Date.now(),
  });

  // Check if there are remaining pending uploads for this session
  const [{ count: pendingCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(uploads)
    .where(and(eq(uploads.chatSessionId, upload.chatSessionId), eq(uploads.status, "pending")));

  console.log(`[resolveUpload] pendingCount=${pendingCount} session=${upload.chatSessionId}`);

  // Only resume the agent when ALL uploads have been resolved
  if (pendingCount === 0) {
    await db
      .update(chatSessions)
      .set({
        status: "in_progress",
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(chatSessions.id, upload.chatSessionId));

    // Emit status event so the SSE stream knows we're resuming
    await publishEvent({
      sessionId: upload.chatSessionId,
      event: "status",
      data: { status: "in_progress" },
      timestamp: Date.now(),
    });

    console.log(`[resolveUpload] All uploads resolved, publishing task to resume agent`);
    // Signal agent to resume via queue
    await publishTask({
      sessionId: upload.chatSessionId,
      userId: upload.userId,
      type: "upload_resolved",
      timestamp: Date.now(),
    });
  } else {
    console.log(`[resolveUpload] Still ${pendingCount} pending uploads, NOT resuming agent`);
  }

  // Sync task status if applicable
  if (session.taskId) {
    await syncTaskStatus(session.taskId);
  }

  console.log(`[resolveUpload] DONE id=${uploadId} action=${action}`);
  return { action: resolvedStatus, uploadId };
}
