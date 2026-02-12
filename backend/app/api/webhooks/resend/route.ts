import { db } from "@/lib/db";
import { assignees, emailInbox } from "@/lib/db/schema";
import { resend } from "@/lib/resend";
import { downloadAndUploadToS3 } from "@/lib/s3";
import { resendWebhookPayloadSchema } from "@/lib/schemas";
import { errorJson } from "@/lib/utils/response";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";

async function processEmailAttachments(
  attachments: Array<{
    id: string;
    filename: string | null;
    content_type: string;
    size?: number;
  }>,
  emailId: string,
): Promise<
  | Array<{
      type: "image" | "pdf" | "file" | "audio";
      url: string;
      name: string;
    }>
  | undefined
> {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  const processedAttachments = [];

  for (const attachment of attachments) {
    console.log(
      `Processing attachment ${attachment.filename} (${attachment.content_type}) for email ${emailId}`,
    );
    try {
      // Skip attachments without a filename
      if (!attachment.filename) {
        console.error(`Attachment ${attachment.id} has no filename, skipping`);
        continue;
      }

      // Retrieve attachment download URL from Resend API
      let downloadUrl: string | undefined;

      if (attachment.id) {
        try {
          const { data: attachmentData, error: attachmentError } =
            await resend.emails.receiving.attachments.get({
              id: attachment.id,
              emailId,
            });

          if (attachmentError || !attachmentData) {
            console.error(
              `Failed to retrieve attachment ${attachment.id}:`,
              attachmentError,
            );
          } else {
            downloadUrl = attachmentData.download_url;
          }
        } catch (error) {
          console.error(
            `Error calling Resend API for attachment ${attachment.id}:`,
            error,
          );
        }
      }

      // Fallback to webhook URL if API call failed
      if (
        !downloadUrl &&
        "url" in attachment &&
        typeof attachment.url === "string"
      ) {
        downloadUrl = attachment.url;
      }

      if (!downloadUrl) {
        console.error(
          `No download URL available for attachment ${attachment.filename}`,
        );
        continue;
      }

      // Download from Resend and re-upload to our S3
      const s3Url = await downloadAndUploadToS3(
        downloadUrl,
        attachment.content_type,
        attachment.filename,
      );

      // Determine attachment type based on content type
      let type: "image" | "pdf" | "file" | "audio" = "file";
      if (attachment.content_type.startsWith("image/")) {
        type = "image";
      } else if (attachment.content_type === "application/pdf") {
        type = "pdf";
      } else if (attachment.content_type.startsWith("audio/")) {
        type = "audio";
      }

      processedAttachments.push({
        type,
        url: s3Url,
        name: attachment.filename,
      });
    } catch (error) {
      console.error(
        `Failed to process attachment ${attachment.filename}:`,
        error,
      );
      // Continue processing other attachments
    }
  }

  return processedAttachments.length > 0 ? processedAttachments : undefined;
}

/**
 * @openapi
 * @operationId handleResendWebhook
 * @response receivedResponseSchema
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing Svix headers" },
      { status: 400 },
    );
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET!;
  const wh = new Webhook(webhookSecret);

  let rawPayload: Record<string, unknown>;
  try {
    rawPayload = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 },
    );
  }

  // Validate webhook payload with zod
  const parsed = resendWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    return errorJson(parsed.error.message, 422);
  }

  const { type: eventType, data } = parsed.data;
  if (eventType !== "email.received") {
    return NextResponse.json({ data: { received: true } });
  }

  // Retrieve full email content from Resend API using email_id
  const emailId = data.email_id;

  const { data: emailData, error: emailError } =
    await resend.emails.receiving.get(emailId);

  if (emailError || !emailData) {
    console.error(`Failed to retrieve email ${emailId}:`, emailError);
    return NextResponse.json(
      { error: "Failed to retrieve full email content" },
      { status: 500 },
    );
  }

  const toEmail = data.to[0] || "";
  const fromEmail = data.from;
  const subject = data.subject || "";
  const htmlBody = emailData.html || null;
  const textBody = emailData.text || null;

  // Find assignee by email to determine user
  const [assignee] = await db
    .select()
    .from(assignees)
    .where(eq(assignees.email, toEmail));

  if (!assignee) {
    // No assignee found for this email address, still acknowledge
    return NextResponse.json(
      { message: "No assignee found for this email, but webhook received" },
      { status: 404 },
    );
  }

  // Process attachments if present
  const processedAttachments = await processEmailAttachments(
    emailData.attachments,
    emailId,
  );

  // Insert email into database with unique emailId constraint
  try {
    await db.insert(emailInbox).values({
      emailId,
      userId: assignee.userId,
      assigneeId: assignee.id,
      fromEmail,
      fromName: data.from_name || null,
      toEmail,
      subject,
      textBody,
      htmlBody,
      receivedAt: new Date().toISOString(),
      attachments: processedAttachments || null,
      metadata: {
        messageId: data.message_id,
        headers: data.headers,
      },
    });
  } catch (error: any) {
    // Handle duplicate email_id (unique constraint violation)
    if (error?.message?.includes("UNIQUE constraint failed")) {
      console.log(`Duplicate email detected: ${emailId}, skipping processing`);
      return NextResponse.json(
        { data: { received: true, duplicate: true } },
        { status: 200 },
      );
    }
    // Re-throw other errors
    throw error;
  }

  return NextResponse.json({ data: { received: true } });
}
