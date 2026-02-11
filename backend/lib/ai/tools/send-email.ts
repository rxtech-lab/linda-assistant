import { tool } from "ai";
import { z } from "zod";
import { resend } from "@/lib/resend";

export const sendEmailTool = (fromAddress: string, needsApproval: boolean) =>
  tool({
    description:
      "Send an email on behalf of the assignee. This action may require user confirmation before execution.",
    inputSchema: z.object({
      to: z.string().email().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in HTML format"),
      replyToEmailId: z.string().optional().describe("ID of the email being replied to"),
    }),
    needsApproval,
    execute: async ({ to, subject, body }) => {
      const result = await resend.emails.send({
        from: fromAddress,
        to: [to],
        subject,
        html: body,
      });

      return { sent: true, emailId: result.data?.id };
    },
  });

export const SEND_EMAIL_TOOL_NAME = "send_email";
