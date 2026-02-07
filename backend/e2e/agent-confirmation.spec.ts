import { test, expect } from "@playwright/test";
import { createClient } from "@libsql/client";
import path from "path";
import { consumeSSE } from "./helpers/sse-client";
import {
  assigneeResponseSchema,
  chatSessionResponseSchema,
  resolveConfirmationResponseSchema,
} from "./helpers/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

test.describe("Agent Confirmation", () => {
  let assigneeId: string;

  test.beforeAll(async ({ request }) => {
    // Create assignee with default permissions (all manual-confirm)
    const res = await request.post("/api/assignees", {
      data: {
        name: "Confirmation Assistant",
        email: "confirm@example.com",
      },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    assigneeResponseSchema.parse(body);
    assigneeId = body.data.id;
  });

  test("send_email pauses for confirmation, resumes on confirm", async ({
    request,
    baseURL,
  }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.data.id;

    // Send message that triggers send_email
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    // Stream until confirmation_required
    const events = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      {
        headers: { authorization: "Bearer e2e-test-token" },
        stopOnEvent: "confirmation_required",
      }
    );

    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain("tool-call");
    expect(eventTypes).toContain("confirmation_required");

    // Check confirmation_required event data
    const confirmEvent = events.find((e) => e.event === "confirmation_required");
    expect(confirmEvent?.data.toolName).toBe("send_email");

    // Verify session is waiting for confirmation
    const sessionCheck = await request.get(`/api/chat-sessions/${sessionId}`);
    const sessionCheckBody = await sessionCheck.json();
    chatSessionResponseSchema.parse(sessionCheckBody);
    expect(sessionCheckBody.data.status).toBe("waiting_confirmation");

    // Query DB directly for pending confirmation
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Resolve confirmation
    const resolveRes = await request.post(
      `/api/confirmations/${confirmationId}/resolve`,
      { data: { action: "confirm" } }
    );
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Reconnect to stream — agent should resume and complete
    const resumeEvents = await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      { headers: { authorization: "Bearer e2e-test-token" } }
    );

    const resumeEventTypes = resumeEvents.map((e) => e.event);
    expect(resumeEventTypes).toContain("text-delta");
    expect(resumeEventTypes).toContain("done");

    // Check that the resumed text contains expected content
    const textEvents = resumeEvents.filter((e) => e.event === "text-delta");
    const fullText = textEvents.map((e) => e.data.text).join("");
    expect(fullText).toContain("Email sent successfully.");

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    chatSessionResponseSchema.parse(finalBody);
    expect(finalBody.data.status).toBe("stopped");
  });

  test("send_email pauses, stops on reject", async ({ request, baseURL }) => {
    // Create session
    const sessionRes = await request.post("/api/chat-sessions", {
      data: { assigneeId },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = await sessionRes.json();
    chatSessionResponseSchema.parse(session);
    const sessionId = session.data.id;

    // Send message that triggers send_email
    await request.post(`/api/chat-sessions/${sessionId}/messages`, {
      data: { content: "[TOOL:send_email] Send a test email" },
    });

    // Stream until confirmation_required
    await consumeSSE(
      `${baseURL}/api/chat-sessions/${sessionId}/stream`,
      {
        headers: { authorization: "Bearer e2e-test-token" },
        stopOnEvent: "confirmation_required",
      }
    );

    // Query DB for pending confirmation
    const client = createClient({ url: `file:${dbPath}` });
    const result = await client.execute({
      sql: "SELECT id FROM confirmations WHERE chat_session_id = ? AND status = 'pending'",
      args: [sessionId],
    });
    expect(result.rows.length).toBe(1);
    const confirmationId = result.rows[0].id as string;
    client.close();

    // Reject the confirmation
    const resolveRes = await request.post(
      `/api/confirmations/${confirmationId}/resolve`,
      { data: { action: "reject" } }
    );
    expect(resolveRes.ok()).toBeTruthy();
    resolveConfirmationResponseSchema.parse(await resolveRes.json());

    // Session should be stopped
    const finalSession = await request.get(`/api/chat-sessions/${sessionId}`);
    const finalBody = await finalSession.json();
    chatSessionResponseSchema.parse(finalBody);
    expect(finalBody.data.status).toBe("stopped");

    // Check that last message has rejection info
    const messages = finalBody.data.messages;
    const lastMsg = messages[messages.length - 1];
    expect(lastMsg.role).toBe("tool");
    const toolResult = lastMsg.content[0];
    expect(toolResult.output.value.rejected).toBe(true);
  });
});
