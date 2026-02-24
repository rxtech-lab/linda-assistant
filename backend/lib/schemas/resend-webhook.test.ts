import { describe, test, expect } from "bun:test";
import { resendWebhookPayloadSchema } from "./index";

describe("resendWebhookPayloadSchema", () => {
  const validPayload = {
    type: "email.received",
    data: {
      email_id: "af731b39-bbf0-4d81-a3f8-c5c8b1db2a69",
      from: "user@example.com",
      to: ["linda@assistant.example.com"],
      subject: "Test Subject",
      message_id: "<test-message-id@example.com>",
      attachments: [
        {
          id: "397cefa5-da1d-4448-852b-f825e090d83a",
          content_disposition: null,
          content_id: "<inline-image-1.png>",
          content_type: "image/png",
          filename: "image-1.png",
        },
        {
          id: "350ff1cc-ccd6-4a6f-92ac-23f5209301b2",
          content_disposition: null,
          content_id: "<inline-image-2.png>",
          content_type: "image/png",
          filename: "image-2.png",
        },
      ],
    },
  };

  test("accepts attachments with null content_disposition", () => {
    const result = resendWebhookPayloadSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  test("accepts attachments with string content_disposition", () => {
    const payload = {
      ...validPayload,
      data: {
        ...validPayload.data,
        attachments: [
          {
            id: "abc",
            content_disposition: "attachment",
            content_type: "image/png",
            filename: "test.png",
          },
        ],
      },
    };
    const result = resendWebhookPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("accepts attachments without content_disposition", () => {
    const payload = {
      ...validPayload,
      data: {
        ...validPayload.data,
        attachments: [
          {
            id: "abc",
            content_type: "image/png",
            filename: "test.png",
          },
        ],
      },
    };
    const result = resendWebhookPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("accepts payload without attachments", () => {
    const { attachments: _, ...dataWithoutAttachments } = validPayload.data;
    const payload = { ...validPayload, data: dataWithoutAttachments };
    const result = resendWebhookPayloadSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});
