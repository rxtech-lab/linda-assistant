import { Resend } from "resend";

let _resend: Resend | undefined;

function createResend(): Resend {
  if (process.env.IS_E2E) {
    return {
      emails: {
        send: async () => ({ data: { id: "mock-email-id" }, error: null }),
        receiving: {
          get: async (emailId: string) => ({
            data: {
              id: emailId,
              to: ["test@example.com"],
              from: "sender@example.com",
              subject: "Test Email",
              html: "<p>Test HTML body</p>",
              text: "Test text body",
              attachments: [],
            },
            error: null,
          }),
          attachments: {
            get: async ({ id, emailId }: { id: string; emailId: string }) => ({
              data: {
                id,
                filename: "test.png",
                content_type: "image/png",
                size: 1024,
                download_url: "https://example.com/test.png",
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
