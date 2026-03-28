import { test as base, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  getAssignee,
  sendMessage,
  consumeStream,
  updateAssigneePermissions,
  resolveUpload,
  getUploadPresignedUrls,
  getUploadDownloadUrls,
  getUpload,
  uploadFileToPresignedUrl,
  getChatHistory,
  findToolCallParts,
  findToolResultParts,
  resolveConfirmation,
  type StreamEvent,
} from "./chat.utils";

const test = base.extend<{ assigneeId: string }>({
  assigneeId: async ({}, use, testInfo) => {
    await ensureOnboarded();
    const id = await createAssignee(`e2e-upload-${testInfo.testId}`);
    console.log(`Created assignee ${id} for: ${testInfo.title}`);

    // Set all tool permissions to manual-confirm so we can control the flow
    const assignee = await getAssignee(id);
    const allManualConfirm = assignee.toolPermissions.map((tp) => ({
      toolName: tp.toolName,
      permission: "manual-confirm",
    }));
    await updateAssigneePermissions(id, allManualConfirm);

    await use(id);

    await deleteAssignee(id);
    console.log(`Deleted assignee ${id}`);
  },
});

/**
 * Helper: trigger an upload request via chat, approve the confirmation,
 * and return the upload event data.
 */
async function triggerUploadRequest(
  assigneeId: string,
  message: string,
  options?: { timeout?: number },
): Promise<{
  stream: ReturnType<typeof consumeStream>;
  uploadEvent: StreamEvent;
}> {
  let uploadEvent: StreamEvent | undefined;

  const stream = consumeStream(assigneeId, {
    timeout: options?.timeout ?? 180_000,
    label: "upload-test",
    onMessage: async (evt) => {
      // Auto-approve the request_upload confirmation
      if (
        evt.event === "confirmation_required" &&
        evt.data.toolName === "request_upload"
      ) {
        console.log(
          `Approving request_upload confirmation: ${evt.data.confirmationId}`,
        );
        await resolveConfirmation(evt.data.confirmationId as string, "confirm");
      }
      if (evt.event === "upload_required") {
        uploadEvent = evt;
      }
    },
  });

  await sendMessage(assigneeId, message);

  // Wait for the upload_required event
  const evt = await stream.waitForEvent("upload_required");
  uploadEvent = evt;

  return { stream, uploadEvent: uploadEvent! };
}

/** Create a small test file buffer with the given content type */
function createTestFileContent(ext: string): {
  content: Buffer;
  contentType: string;
} {
  switch (ext) {
    case "txt":
      return {
        content: Buffer.from(
          "Hello, this is a test file for upload e2e testing.",
        ),
        contentType: "text/plain",
      };
    case "csv":
      return {
        content: Buffer.from("name,age\nAlice,30\nBob,25\n"),
        contentType: "text/csv",
      };
    case "json":
      return {
        content: Buffer.from(JSON.stringify({ test: true, data: [1, 2, 3] })),
        contentType: "application/json",
      };
    default:
      return {
        content: Buffer.from(`test content for .${ext} file`),
        contentType: "application/octet-stream",
      };
  }
}

test.describe.serial("Upload flow", () => {
  test.setTimeout(300_000);

  test("complete upload: request presigned URLs, upload file, resolve, get download URLs", async ({
    assigneeId,
  }) => {
    // Step 1: Trigger agent to call request_upload
    const { stream, uploadEvent } = await triggerUploadRequest(
      assigneeId,
      "I need to upload a text file. Please use the request_upload tool with title 'Test Upload' and extensions ['txt'] and number_uploads 1. Do not use any other tools.",
    );

    try {
      const uploadId = uploadEvent.data.uploadId as string;
      expect(uploadId).toBeTruthy();
      expect(uploadEvent.data.toolName).toBe("request_upload");
      console.log(`Upload request created: ${uploadId}`);

      // Step 2: Get presigned URLs with actual file extensions
      const presignedUrls = await getUploadPresignedUrls(uploadId, ["txt"]);
      expect(presignedUrls).toHaveLength(1);
      expect(presignedUrls[0]!.extension).toBe("txt");
      expect(presignedUrls[0]!.url).toContain("http");
      expect(presignedUrls[0]!.key).toContain(".txt");
      console.log(`Got presigned URL for key: ${presignedUrls[0]!.key}`);

      // Step 3: Upload test file to S3
      const { content, contentType } = createTestFileContent("txt");
      await uploadFileToPresignedUrl(
        presignedUrls[0]!.url,
        content,
        contentType,
      );
      console.log("File uploaded to S3");

      // Step 4: Verify upload record has URLs stored
      const upload = await getUpload(uploadId);
      expect(upload.status).toBe("pending");
      expect(upload.urls).toHaveLength(1);
      expect(upload.urls[0]!.key).toBe(presignedUrls[0]!.key);

      // Step 5: Resolve the upload as complete
      const uploadedKeys = presignedUrls.map((u) => u.key);
      await resolveUpload(uploadId, "complete", uploadedKeys);
      console.log("Upload resolved as complete");

      // Step 6: Wait for agent to finish processing
      await stream.waitForDone();

      // Step 7: Verify upload status is completed
      const completedUpload = await getUpload(uploadId);
      expect(completedUpload.status).toBe("completed");
      expect(completedUpload.uploadedKeys).toEqual(uploadedKeys);

      // Step 8: Get download URLs
      const downloadUrls = await getUploadDownloadUrls(uploadId);
      expect(downloadUrls).toHaveLength(1);
      expect(downloadUrls[0]!.key).toBe(presignedUrls[0]!.key);
      expect(downloadUrls[0]!.url).toContain("http");
      expect(downloadUrls[0]!.extension).toBe("txt");
      expect(downloadUrls[0]!.mimeType).toBe("text/plain");
      console.log("Download URL verified");

      // Step 9: Verify the file content is accessible via download URL
      const downloadRes = await fetch(downloadUrls[0]!.url);
      expect(downloadRes.ok).toBe(true);
      const downloadedText = await downloadRes.text();
      expect(downloadedText).toBe(
        "Hello, this is a test file for upload e2e testing.",
      );
      console.log("Downloaded file content matches");

      // Step 10: Verify chat history contains request_upload tool call and result
      const { messages } = await getChatHistory(assigneeId);
      const toolCalls = findToolCallParts(messages, "request_upload");
      expect(toolCalls.length).toBeGreaterThanOrEqual(1);
      const toolResults = findToolResultParts(messages, "request_upload");
      expect(toolResults.length).toBeGreaterThanOrEqual(1);
    } finally {
      stream.cancel();
    }
  });

  test("reject upload: user rejects the upload request", async ({
    assigneeId,
  }) => {
    const { stream, uploadEvent } = await triggerUploadRequest(
      assigneeId,
      "I need to upload a PDF. Use request_upload with title 'Rejected Upload' and extensions ['pdf'] and number_uploads 1. Do not use any other tools.",
    );

    try {
      const uploadId = uploadEvent.data.uploadId as string;
      expect(uploadId).toBeTruthy();

      // Reject the upload
      await resolveUpload(uploadId, "reject");
      console.log("Upload rejected");

      // Wait for agent to finish
      await stream.waitForDone();

      // Verify upload status
      const upload = await getUpload(uploadId);
      expect(upload.status).toBe("rejected");
      expect(upload.uploadedKeys).toBeNull();

      // Download URLs should fail for rejected uploads
      try {
        await getUploadDownloadUrls(uploadId);
        expect(true).toBe(false); // should not reach here
      } catch (err: any) {
        expect(err.message).toContain("409");
      }
    } finally {
      stream.cancel();
    }
  });

  test("presigned URL validation: extension count must match numberUploads", async ({
    assigneeId,
  }) => {
    const { stream, uploadEvent } = await triggerUploadRequest(
      assigneeId,
      "I need to upload exactly 2 images. Use request_upload with title 'Two Images' and extensions ['jpg', 'png'] and number_uploads 2. Do not use any other tools.",
    );

    try {
      const uploadId = uploadEvent.data.uploadId as string;

      // Try with wrong number of extensions - should fail
      try {
        await getUploadPresignedUrls(uploadId, ["jpg"]);
        expect(true).toBe(false); // should not reach here
      } catch (err: any) {
        expect(err.message).toContain("422");
      }

      // Correct number of extensions should work
      const presignedUrls = await getUploadPresignedUrls(uploadId, [
        "jpg",
        "png",
      ]);
      expect(presignedUrls).toHaveLength(2);
      expect(presignedUrls[0]!.extension).toBe("jpg");
      expect(presignedUrls[1]!.extension).toBe("png");
      expect(presignedUrls[0]!.key).toContain(".jpg");
      expect(presignedUrls[1]!.key).toContain(".png");

      // Clean up: reject the upload since we won't complete it
      await resolveUpload(uploadId, "reject");
      await stream.waitForDone();
    } finally {
      stream.cancel();
    }
  });

  test("multi-file upload: upload multiple files at once", async ({
    assigneeId,
  }) => {
    const { stream, uploadEvent } = await triggerUploadRequest(
      assigneeId,
      "I need you to collect 2 files from me: a text file and a CSV. Use request_upload with title 'Multi Upload' and extensions ['txt', 'csv'] and number_uploads 2. Do not use any other tools.",
    );

    try {
      const uploadId = uploadEvent.data.uploadId as string;

      // Get presigned URLs
      const presignedUrls = await getUploadPresignedUrls(uploadId, [
        "txt",
        "csv",
      ]);
      expect(presignedUrls).toHaveLength(2);

      // Upload both files
      const txtFile = createTestFileContent("txt");
      const csvFile = createTestFileContent("csv");

      await Promise.all([
        uploadFileToPresignedUrl(
          presignedUrls[0]!.url,
          txtFile.content,
          txtFile.contentType,
        ),
        uploadFileToPresignedUrl(
          presignedUrls[1]!.url,
          csvFile.content,
          csvFile.contentType,
        ),
      ]);
      console.log("Both files uploaded to S3");

      // Resolve
      const uploadedKeys = presignedUrls.map((u) => u.key);
      await resolveUpload(uploadId, "complete", uploadedKeys);

      await stream.waitForDone();

      // Verify
      const completedUpload = await getUpload(uploadId);
      expect(completedUpload.status).toBe("completed");
      expect(completedUpload.uploadedKeys).toHaveLength(2);

      const downloadUrls = await getUploadDownloadUrls(uploadId);
      expect(downloadUrls).toHaveLength(2);

      // Verify both files are downloadable
      for (const dl of downloadUrls) {
        const res = await fetch(dl.url);
        expect(res.ok).toBe(true);
      }
    } finally {
      stream.cancel();
    }
  });

  test("already resolved upload cannot be resolved again", async ({
    assigneeId,
  }) => {
    const { stream, uploadEvent } = await triggerUploadRequest(
      assigneeId,
      "I need to upload a file. Use request_upload with title 'Double Resolve Test' and extensions ['txt'] and number_uploads 1. Do not use any other tools.",
    );

    try {
      const uploadId = uploadEvent.data.uploadId as string;

      // Get presigned URLs and upload
      const presignedUrls = await getUploadPresignedUrls(uploadId, ["txt"]);
      const { content, contentType } = createTestFileContent("txt");
      await uploadFileToPresignedUrl(
        presignedUrls[0]!.url,
        content,
        contentType,
      );

      // Resolve as complete
      await resolveUpload(
        uploadId,
        "complete",
        presignedUrls.map((u) => u.key),
      );
      await stream.waitForDone();

      // Try to resolve again - should fail with 409
      try {
        await resolveUpload(
          uploadId,
          "complete",
          presignedUrls.map((u) => u.key),
        );
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.message).toContain("409");
      }

      // Try to get new presigned URLs for resolved upload - should fail
      try {
        await getUploadPresignedUrls(uploadId, ["txt"]);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.message).toContain("409");
      }
    } finally {
      stream.cancel();
    }
  });
});
