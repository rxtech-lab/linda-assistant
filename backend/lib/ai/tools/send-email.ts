import { tool } from "ai";
import { z } from "zod";

export const sendEmailTool = tool({
  description:
    "Send an email on behalf of the assignee. This action requires user confirmation before execution.",
  inputSchema: z.object({
    to: z.string().email().describe("Recipient email address"),
    subject: z.string().describe("Email subject line"),
    body: z.string().describe("Email body in HTML format"),
    replyToEmailId: z
      .string()
      .optional()
      .describe("ID of the email being replied to"),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
    emailId: z.string().optional(),
  }),
  // No execute function - requires confirmation
});

export const SEND_EMAIL_TOOL_NAME = "send_email";
