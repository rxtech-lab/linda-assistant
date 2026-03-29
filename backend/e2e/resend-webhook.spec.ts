import { expect, test } from "@playwright/test";

function webhookPayload(emailId: string) {
  return {
    type: "email.received",
    data: {
      email_id: emailId,
      from: "sender@example.com",
      from_name: "Sender",
      to: ["test@example.com"],
      subject: `Webhook ${emailId}`,
      message_id: `msg-${emailId}`,
    },
  };
}

/** Fetch the URL directly and assert it returns a valid image. */
async function assertImageAccessible(url: string) {
  const res = await fetch(url);
  expect(res.status, `Expected 200 for ${url}, got ${res.status}`).toBe(200);
  const ct = res.headers.get("content-type") || "";
  expect(ct, `Expected image content-type for ${url}, got ${ct}`).toMatch(/^image\//);
  const body = await res.arrayBuffer();
  expect(body.byteLength, `Expected non-empty body for ${url}`).toBeGreaterThan(0);
}

test.describe("Resend webhook inline images", () => {
  test.beforeAll(async ({ request }) => {
    // Create an assignee whose email matches the mock's "to" field
    await request.post("/api/assignees", {
      data: {
        name: "Webhook Test Assignee",
        email: "test@example.com",
      },
    });
  });

  test("1: attachments only, no base64 — stores attachments from CID", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: webhookPayload("e2e-attachments-only"),
    });
    expect(res.ok()).toBeTruthy();

    const listRes = await request.get("/api/inbox/emails");
    const list = await listRes.json();
    const email = list.data.find((e: { emailId: string }) => e.emailId === "e2e-attachments-only");
    expect(email).toBeTruthy();

    // Should have attachments from CID processing
    expect(email.attachments).toBeTruthy();
    expect(email.attachments.length).toBeGreaterThanOrEqual(1);
    expect(email.attachments[0].type).toBe("image");
    expect(email.attachments[0].url).toContain("http://localhost:9000/e2e-test/");

    // HTML should have CID replaced with S3 URL, no data: URIs
    expect(email.htmlBody).not.toContain("cid:");
    expect(email.htmlBody).not.toContain("data:");
    expect(email.htmlBody).toContain("http://localhost:9000/e2e-test/");

    // Verify every attachment URL actually serves an image
    for (const att of email.attachments) {
      await assertImageAccessible(att.url);
    }
  });

  test("2: both attachment and base64 (same content) — deduplicated to single attachment", async ({
    request,
  }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: webhookPayload("e2e-both-attachment-and-base64"),
    });
    expect(res.ok()).toBeTruthy();

    const listRes = await request.get("/api/inbox/emails");
    const list = await listRes.json();
    const email = list.data.find(
      (e: { emailId: string }) => e.emailId === "e2e-both-attachment-and-base64",
    );
    expect(email).toBeTruthy();

    // Same image as CID attachment and base64 inline — should be deduplicated to 1
    expect(email.attachments).toBeTruthy();
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].type).toBe("image");
    expect(email.attachments[0].url).toContain("http://localhost:9000/e2e-test/");
    await assertImageAccessible(email.attachments[0].url);

    // HTML should have no base64 data URIs and no cid: refs
    expect(email.htmlBody).not.toContain("data:");
    expect(email.htmlBody).not.toContain("cid:");
  });

  test("3: base64 only, no attachments — extracts inline image to attachments", async ({
    request,
  }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: webhookPayload("e2e-base64-only"),
    });
    expect(res.ok()).toBeTruthy();

    const listRes = await request.get("/api/inbox/emails");
    const list = await listRes.json();
    const email = list.data.find((e: { emailId: string }) => e.emailId === "e2e-base64-only");
    expect(email).toBeTruthy();

    // base64 image should be extracted and stored as attachment
    expect(email.attachments).toBeTruthy();
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].type).toBe("image");
    expect(email.attachments[0].url).toContain("http://localhost:9000/e2e-test/");
    expect(email.attachments[0].name).toContain("inline.");

    // HTML should have S3 URL instead of base64
    expect(email.htmlBody).not.toContain("data:");
    expect(email.htmlBody).toContain("http://localhost:9000/e2e-test/");

    // Verify the uploaded image is actually accessible
    await assertImageAccessible(email.attachments[0].url);
  });

  test("4: no images at all — attachments is null", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: webhookPayload("e2e-no-images"),
    });
    expect(res.ok()).toBeTruthy();

    const listRes = await request.get("/api/inbox/emails");
    const list = await listRes.json();
    const email = list.data.find((e: { emailId: string }) => e.emailId === "e2e-no-images");
    expect(email).toBeTruthy();

    // No images means attachments should be null
    expect(email.attachments).toBeNull();

    // HTML should be unchanged plain text
    expect(email.htmlBody).toBe("<p>Hello world, plain email</p>");
  });
});

test.describe("Resend webhook routes to correct assignee", () => {
  const emailA = "assistant-a@example.com";
  const emailB = "assistant-b@example.com";
  let assigneeAId: string;
  let assigneeBId: string;

  test.beforeAll(async ({ request }) => {
    const resA = await request.post("/api/assignees", {
      data: { name: "Assistant A", email: emailA },
    });
    expect(resA.ok()).toBeTruthy();
    assigneeAId = (await resA.json()).id;

    const resB = await request.post("/api/assignees", {
      data: { name: "Assistant B", email: emailB },
    });
    expect(resB.ok()).toBeTruthy();
    assigneeBId = (await resB.json()).id;
  });

  test("webhook to assistant A returns 200 and stores email under A", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.received",
        data: {
          email_id: "e2e-multi-a",
          from: "sender@example.com",
          to: [emailA],
          subject: "Hello Assistant A",
          message_id: "msg-multi-a",
        },
      },
    });
    expect(res.status()).toBe(200);

    const listRes = await request.get("/api/inbox/emails");
    const emails = await listRes.json();
    const email = emails.data.find((e: { emailId: string }) => e.emailId === "e2e-multi-a");
    expect(email).toBeTruthy();
    expect(email.assigneeId).toBe(assigneeAId);
    expect(email.subject).toBe("Hello Assistant A");
  });

  test("webhook to assistant B returns 200 and stores email under B", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.received",
        data: {
          email_id: "e2e-multi-b",
          from: "sender@example.com",
          to: [emailB],
          subject: "Hello Assistant B",
          message_id: "msg-multi-b",
        },
      },
    });
    expect(res.status()).toBe(200);

    const listRes = await request.get("/api/inbox/emails");
    const emails = await listRes.json();
    const email = emails.data.find((e: { emailId: string }) => e.emailId === "e2e-multi-b");
    expect(email).toBeTruthy();
    expect(email.assigneeId).toBe(assigneeBId);
  });

  test("webhook to unknown email returns 404", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.received",
        data: {
          email_id: "e2e-multi-unknown",
          from: "sender@example.com",
          to: ["nobody@example.com"],
          subject: "Hello Nobody",
          message_id: "msg-multi-unknown",
        },
      },
    });
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.message).toContain("No assignee found");
  });
});

test.describe("Resend webhook auto-dispatch", () => {
  // Reuses the "test@example.com" assignee created by the inline images block above

  test("webhook creates a chat session for the assignee to process the email", async ({
    request,
  }) => {
    const emailId = "e2e-auto-dispatch";
    const res = await request.post("/api/webhooks/resend", {
      data: webhookPayload(emailId),
    });
    expect(res.ok()).toBeTruthy();

    // Verify email was stored
    const emailsRes = await request.get("/api/inbox/emails");
    const emails = await emailsRes.json();
    const email = emails.data.find((e: { emailId: string }) => e.emailId === emailId);
    expect(email).toBeTruthy();

    // Verify a chat session was auto-created for the email
    const sessionsRes = await request.get("/api/chat-sessions?limit=100");
    const sessions = await sessionsRes.json();
    const session = sessions.data.find(
      (s: { title: string | null }) => s.title === `Email: Webhook ${emailId}`,
    );
    expect(session).toBeTruthy();
    expect(session.assigneeId).toBeTruthy();
    expect(session.status).toBeTruthy();
  });
});
