import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import { assigneeResponseSchema, chatSessionResponseSchema } from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Agent Upload", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/assignees", {
      data: {
        name: "Upload Assistant",
        email: "upload@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.id;
  });

  test("request_upload pauses for upload, resumes on complete", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.id;

    // Subscribe to SSE BEFORE posting so we catch all events
    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "upload_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Send message that triggers request_upload
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:request_upload]" },
    });

    // Stream until upload_required
    const events = await eventsPromise;

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("upload_required");

    // Check upload_required event data
    const uploadEvent = events.find((e) => e.event === "upload_required");
    expect(uploadEvent?.data.toolName).toBe("request_upload");
    expect(uploadEvent?.data.uploadId).toBeTruthy();

    const uploadId = uploadEvent?.data.uploadId as string;

    // Verify session is waiting for upload
    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    expect(sessionCheckBody.status).toBe("waiting_upload");

    // Verify upload record exists in DB
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id, status FROM uploads WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    client.close();

    // Request presigned URLs on-demand (new flow)
    const presignedRes = await request.post(`/api/uploads/${uploadId}/presigned-urls`, {
      data: { extensions: ["jpg"] },
    });
    expect(presignedRes.ok()).toBeTruthy();
    const urls = (await presignedRes.json()) as Array<{
      url: string;
      key: string;
      extension: string;
    }>;
    expect(urls.length).toBe(1);

    // Upload test data to presigned URL
    for (const urlItem of urls) {
      const uploadRes = await fetch(urlItem.url, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: Buffer.from("test image content"),
      });
      expect(uploadRes.ok).toBeTruthy();
    }

    // Subscribe for the rest of the stream
    const resumePromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "done",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Resolve the upload
    const resolveRes = await request.post(`/api/uploads/${uploadId}/resolve`, {
      data: {
        action: "complete",
        uploadedKeys: urls.map((u) => u.key),
      },
    });
    expect(resolveRes.ok()).toBeTruthy();

    // Wait for stream to complete
    const resumeEvents = await resumePromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("upload_resolved");
  });

  test("request_upload handles rejection", async ({ request, baseURL }) => {
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "upload_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:request_upload]" },
    });

    const events = await eventsPromise;
    const uploadEvent = events.find((e) => e.event === "upload_required");
    expect(uploadEvent).toBeTruthy();
    const uploadId = uploadEvent?.data.uploadId as string;

    // Subscribe for resume
    const resumePromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "done",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Reject the upload
    const resolveRes = await request.post(`/api/uploads/${uploadId}/resolve`, {
      data: { action: "reject" },
    });
    expect(resolveRes.ok()).toBeTruthy();

    const resumeEvents = await resumePromise;
    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("upload_resolved");
    expect(resumeEventTypes).toContain("tool-result");
  });

  test("download-urls returns presigned GET URLs for completed upload", async ({
    request,
    baseURL,
  }) => {
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    const sessionId = session.id;

    const eventsPromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "upload_required",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:request_upload]" },
    });

    const events = await eventsPromise;
    const uploadEvent = events.find((e) => e.event === "upload_required");
    const uploadId = uploadEvent?.data.uploadId as string;

    // Request presigned URLs on-demand
    const presignedRes = await request.post(`/api/uploads/${uploadId}/presigned-urls`, {
      data: { extensions: ["txt"] },
    });
    expect(presignedRes.ok()).toBeTruthy();
    const urls = (await presignedRes.json()) as Array<{
      url: string;
      key: string;
      extension: string;
    }>;

    // Upload test data
    for (const urlItem of urls) {
      await fetch(urlItem.url, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: Buffer.from("hello world"),
      });
    }

    // Subscribe for resume
    const resumePromise = consumeSSE(`${baseURL}/api/chat-sessions/${sessionId}/stream`, {
      headers: { authorization: "Bearer e2e-test-token" },
      stopOnEvent: "done",
    });
    await new Promise((r) => setTimeout(r, SUB_DELAY));

    // Complete the upload
    await request.post(`/api/uploads/${uploadId}/resolve`, {
      data: {
        action: "complete",
        uploadedKeys: urls.map((u) => u.key),
      },
    });

    await resumePromise;

    // Fetch download URLs
    const downloadRes = await request.get(`/api/uploads/${uploadId}/download-urls`);
    expect(downloadRes.ok()).toBeTruthy();
    const downloadBody = await downloadRes.json();
    expect(Array.isArray(downloadBody)).toBe(true);
    expect(downloadBody.length).toBe(urls.length);

    for (const item of downloadBody) {
      expect(item.url).toBeTruthy();
      expect(item.key).toBeTruthy();
      expect(typeof item.url).toBe("string");
    }
  });
});
