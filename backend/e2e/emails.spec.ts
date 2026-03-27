import { test, expect } from "@playwright/test";
import { nanoid } from "nanoid";
import {
  emailResponseSchema,
  emailListResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
} from "./helpers/schemas";

const user2Headers = { "x-test-user-id": "e2e-user-2" };

test.describe("Emails CRUD", () => {
  let emailId: string;

  test("POST /api/inbox/emails creates an email", async ({ request }) => {
    const res = await request.post("/api/inbox/emails", {
      data: {
        emailId: nanoid(),
        fromEmail: "sender@example.com",
        toEmail: "recipient@example.com",
        subject: "Test Email",
        htmlBody: "<p>Hello world</p>",
        receivedAt: "2026-01-15T10:00:00Z",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    emailResponseSchema.parse(body);
    expect(body).toMatchObject({
      fromEmail: "sender@example.com",
      toEmail: "recipient@example.com",
      subject: "Test Email",
      htmlBody: "<p>Hello world</p>",
    });
    expect(body.id).toBeTruthy();
    expect(body.userId).toBe("e2e-test-user");
    expect(body.isRead).toBe(false);
    emailId = body.id;
  });

  test("GET /api/inbox/emails lists emails with pagination", async ({ request }) => {
    const res = await request.get("/api/inbox/emails");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    emailListResponseSchema.parse(body);
    expect(body.pagination).toMatchObject({
      total: expect.any(Number),
      limit: expect.any(Number),
      offset: expect.any(Number),
      hasMore: expect.any(Boolean),
    });
    const found = body.data.find((e: { id: string }) => e.id === emailId);
    expect(found).toBeTruthy();
  });

  test("GET /api/inbox/emails/:id returns a single email and marks it as read", async ({
    request,
  }) => {
    const res = await request.get(`/api/inbox/emails/${emailId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    emailResponseSchema.parse(body);
    expect(body.id).toBe(emailId);
    expect(body.subject).toBe("Test Email");
    // GET auto-marks email as read
    expect(body.isRead).toBe(true);
  });

  test("PUT /api/inbox/emails/:id updates email fields", async ({ request }) => {
    const res = await request.put(`/api/inbox/emails/${emailId}`, {
      data: { isRead: true },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    emailResponseSchema.parse(body);
    expect(body.isRead).toBe(true);
    // Other fields unchanged
    expect(body.subject).toBe("Test Email");
    expect(body.fromEmail).toBe("sender@example.com");
  });

  test("PUT /api/inbox/emails/:id updates metadata", async ({ request }) => {
    const res = await request.put(`/api/inbox/emails/${emailId}`, {
      data: { metadata: { starred: true, label: "important" } },
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    emailResponseSchema.parse(body);
    expect(body.metadata).toEqual({ starred: true, label: "important" });
    expect(body.isRead).toBe(true);
  });

  test("DELETE /api/inbox/emails/:id removes the email", async ({ request }) => {
    const res = await request.delete(`/api/inbox/emails/${emailId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    deleteResponseSchema.parse(body);
    expect(body.deleted).toBe(true);

    const getRes = await request.get(`/api/inbox/emails/${emailId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe("Emails cross-user isolation", () => {
  let user1EmailId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/inbox/emails", {
      data: {
        emailId: nanoid(),
        fromEmail: "from@example.com",
        toEmail: "user1@example.com",
        subject: "User1 Email",
        receivedAt: "2026-01-15T10:00:00Z",
      },
    });
    const body = await res.json();
    user1EmailId = body.id;
  });

  test("user2 cannot list user1 emails", async ({ request }) => {
    const res = await request.get("/api/inbox/emails", { headers: user2Headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    const found = body.data.find((e: { id: string }) => e.id === user1EmailId);
    expect(found).toBeUndefined();
  });

  test("user2 cannot GET user1 email", async ({ request }) => {
    const res = await request.get(`/api/inbox/emails/${user1EmailId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });

  test("user2 cannot PUT user1 email", async ({ request }) => {
    const res = await request.put(`/api/inbox/emails/${user1EmailId}`, {
      headers: user2Headers,
      data: { isRead: true },
    });
    expect(res.status()).toBe(404);

    const getRes = await request.get(`/api/inbox/emails/${user1EmailId}`);
    const body = await getRes.json();
    // isRead is now true because GET auto-marks as read
    expect(body.isRead).toBe(true);
    // Other fields unchanged by user2
    expect(body.subject).toBe("User1 Email");
  });

  test("user2 cannot DELETE user1 email", async ({ request }) => {
    const res = await request.delete(`/api/inbox/emails/${user1EmailId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);

    const getRes = await request.get(`/api/inbox/emails/${user1EmailId}`);
    expect(getRes.ok()).toBeTruthy();
  });
});

test.describe("Emails non-existing resource", () => {
  const fakeId = "nonexistent-email-12345";

  test("GET non-existing email returns 404", async ({ request }) => {
    const res = await request.get(`/api/inbox/emails/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Email not found");
  });

  test("PUT non-existing email returns 404", async ({ request }) => {
    const res = await request.put(`/api/inbox/emails/${fakeId}`, {
      data: { isRead: true },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Email not found");
  });

  test("DELETE non-existing email returns 404", async ({ request }) => {
    const res = await request.delete(`/api/inbox/emails/${fakeId}`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Email not found");
  });
});
