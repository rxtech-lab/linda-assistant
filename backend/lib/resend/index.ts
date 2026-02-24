import { Resend } from "resend";

let _resend: Resend | undefined;

// Tiny 1x1 red PNG as base64 for e2e test inline images
const TEST_BASE64_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

function getE2eMockEmail(emailId: string) {
  switch (emailId) {
    // Scenario 1: Attachments only, no base64 in HTML
    case "e2e-attachments-only":
      return {
        id: emailId,
        to: ["test@example.com"],
        from: "sender@example.com",
        subject: "Attachments Only",
        html: '<p>Hello</p><img src="cid:inline-img.png">',
        text: "Hello",
        attachments: [
          {
            id: "att-1",
            filename: "inline-img.png",
            content_type: "image/png",
            content_id: "<inline-img.png>",
            size: 68,
          },
        ],
      };

    // Scenario 2: Both attachment (with CID) and base64 inline (same image)
    case "e2e-both-attachment-and-base64":
      return {
        id: emailId,
        to: ["test@example.com"],
        from: "sender@example.com",
        subject: "Both Attachment and Base64",
        html: `<p>Hello</p><img src="cid:inline-img.png"><img src="data:image/png;base64,${TEST_BASE64_PNG}">`,
        text: "Hello",
        attachments: [
          {
            id: "att-2",
            filename: "inline-img.png",
            content_type: "image/png",
            content_id: "<inline-img.png>",
            size: 68,
          },
        ],
      };

    // Scenario 3: Base64 only, no attachments
    case "e2e-base64-only":
      return {
        id: emailId,
        to: ["test@example.com"],
        from: "sender@example.com",
        subject: "Base64 Only",
        html: `<p>Hello</p><img src="data:image/png;base64,${TEST_BASE64_PNG}">`,
        text: "Hello",
        attachments: [],
      };

    // Scenario 4: No images at all
    case "e2e-no-images":
      return {
        id: emailId,
        to: ["test@example.com"],
        from: "sender@example.com",
        subject: "No Images",
        html: "<p>Hello world, plain email</p>",
        text: "Hello world, plain email",
        attachments: [],
      };

    // Default: plain HTML, no attachments (existing behavior)
    default:
      return {
        id: emailId,
        to: ["test@example.com"],
        from: "sender@example.com",
        subject: "Test Email",
        html: "<p>Test HTML body</p>",
        text: "Test text body",
        attachments: [],
      };
  }
}

function createResend(): Resend {
  if (process.env.IS_E2E) {
    return {
      emails: {
        send: async () => ({ data: { id: "mock-email-id" }, error: null }),
        receiving: {
          get: async (emailId: string) => ({
            data: getE2eMockEmail(emailId),
            error: null,
          }),
          attachments: {
            get: async ({ id }: { id: string; emailId: string }) => ({
              data: {
                id,
                filename: "test-image.png",
                content_type: "image/png",
                size: 68,
                download_url: "http://localhost:9000/e2e-test/test-fixtures/test-image.png",
                expires_at: new Date(Date.now() + 3600000).toISOString(),
              },
              error: null,
            }),
          },
        },
      },
    } as unknown as Resend;
  }
  if (!_resend) {
    // Use a placeholder key during build time when env var is not available
    const apiKey = process.env.RESEND_API_KEY || "re_placeholder_key_for_build";
    _resend = new Resend(apiKey);
  }
  return _resend;
}

// Create instance once on module load to avoid Proxy issues with nested properties
export const resend = createResend();
