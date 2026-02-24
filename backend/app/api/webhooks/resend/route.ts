import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import { assignees, emailInbox } from "@/lib/db/schema";
import { resend } from "@/lib/resend";
import { downloadAndUploadToS3 } from "@/lib/s3";
import { resendWebhookPayloadSchema } from "@/lib/schemas";
import { createAssigneeFollowUp } from "@/lib/utils/chat-session";
import { replaceInlineImages } from "@/lib/utils/html";
import { errorJson } from "@/lib/utils/response";

interface ProcessedAttachment {
  type: "image" | "pdf" | "file" | "audio";
  url: string;
  name: string;
  contentHash: string;
}

interface AttachmentResult {
  attachments: ProcessedAttachment[] | undefined;
  cidMap: Map<string, string>;
}

async function processEmailAttachments(
  attachments: Array<{
    id: string;
    filename: string | null;
    content_type: string;
    content_id?: string | null;
    size?: number;
  }>,
  emailId: string,
): Promise<AttachmentResult> {
  const cidMap = new Map<string, string>();

  if (!attachments || attachments.length === 0) {
    return { attachments: undefined, cidMap };
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
            console.error(`Failed to retrieve attachment ${attachment.id}:`, attachmentError);
          } else {
            downloadUrl = attachmentData.download_url;
          }
        } catch (error) {
          console.error(`Error calling Resend API for attachment ${attachment.id}:`, error);
        }
      }

      // Fallback to webhook URL if API call failed
      if (!downloadUrl && "url" in attachment && typeof attachment.url === "string") {
        downloadUrl = attachment.url;
      }

      if (!downloadUrl) {
        console.error(`No download URL available for attachment ${attachment.filename}`);
        continue;
      }

      // Download from Resend and re-upload to our S3
      const { url: s3Url, contentHash } = await downloadAndUploadToS3(
        downloadUrl,
        attachment.content_type,
        attachment.filename,
      );

      // Build CID → S3 URL map for inline image replacement
      if (attachment.content_id) {
        cidMap.set(attachment.content_id, s3Url);
      }

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
        contentHash,
      });
    } catch (error) {
      console.error(`Failed to process attachment ${attachment.filename}:`, error);
      // Continue processing other attachments
    }
  }

  return {
    attachments: processedAttachments.length > 0 ? processedAttachments : undefined,
    cidMap,
  };
}

/**
 * @openapi
 * @operationId handleResendWebhook
 * @response receivedResponseSchema
 */
export async function POST(request: NextRequest) {
  const start = Date.now();
  const log = (step: string) => console.log(`[webhook:resend] ${step} (+${Date.now() - start}ms)`);

  log("start");

  const body = await request.text();

  let rawPayload: Record<string, unknown>;

  if (process.env.IS_E2E) {
    rawPayload = JSON.parse(body);
    log("e2e mode — skipped signature verification");
  } else {
    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      log("missing svix headers");
      return NextResponse.json({ error: "Missing Svix headers" }, { status: 400 });
    }

    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET!;
    const wh = new Webhook(webhookSecret);

    try {
      rawPayload = wh.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as Record<string, unknown>;
    } catch {
      log("invalid signature");
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
    }

    log("signature verified");
  }

  // Validate webhook payload with zod
  const parsed = resendWebhookPayloadSchema.safeParse(rawPayload);
  if (!parsed.success) {
    log(`validation failed: ${parsed.error.message}`);
    return errorJson(parsed.error.message, 422);
  }

  const { type: eventType, data } = parsed.data;
  if (eventType !== "email.received") {
    log(`ignoring event type: ${eventType}`);
    return NextResponse.json({ data: { received: true } });
  }

  // Retrieve full email content from Resend API using email_id
  const emailId = data.email_id;
  log(`email.received from=${data.from} to=${data.to[0]} emailId=${emailId}`);

  const { data: emailData, error: emailError } = await resend.emails.receiving.get(emailId);

  log("resend API get email done");

  if (emailError || !emailData) {
    console.error(`Failed to retrieve email ${emailId}:`, emailError);
    log(`resend API error: ${JSON.stringify(emailError)}`);
    return NextResponse.json({ error: "Failed to retrieve full email content" }, { status: 500 });
  }

  const toEmail = data.to[0] || "";
  const fromEmail = data.from;
  const subject = data.subject || "";
  const textBody = emailData.text || null;

  // Find assignee by email to determine user
  const [assignee] = await db.select().from(assignees).where(eq(assignees.email, toEmail));

  log(`db assignee lookup done (found=${!!assignee})`);

  if (!assignee) {
    // No assignee found for this email address, still acknowledge
    return NextResponse.json(
      { message: "No assignee found for this email, but webhook received" },
      { status: 404 },
    );
  }

  // Process attachments if present
  log(`processing ${emailData.attachments?.length ?? 0} attachments`);
  const { attachments: processedAttachments, cidMap } = await processEmailAttachments(
    emailData.attachments,
    emailId,
  );
  log("attachments done");

  // Replace inline images (cid: refs and base64 data URIs) with S3 URLs
  let htmlBody: string | null = null;
  let allAttachments:
    | Array<{ type: "image" | "pdf" | "file" | "audio"; url: string; name: string }>
    | undefined = processedAttachments?.map(({ contentHash: _, ...rest }) => rest);

  if (emailData.html) {
    const result = await replaceInlineImages(emailData.html, cidMap);
    htmlBody = result.html;

    // Merge base64-extracted images, skipping duplicates by content hash
    if (result.inlineImages.length > 0) {
      const existingHashes = new Set((processedAttachments || []).map((a) => a.contentHash));
      const uniqueInlineImages = result.inlineImages
        .filter((img) => !existingHashes.has(img.contentHash))
        .map(({ contentHash: _, ...rest }) => rest);

      if (uniqueInlineImages.length > 0) {
        allAttachments = [...(allAttachments || []), ...uniqueInlineImages];
      }
    }
  }
  log("html inline images processed");

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
      attachments: allAttachments || null,
      metadata: {
        messageId: data.message_id,
        headers: data.headers,
      },
    });
    log("db insert done");
  } catch (error: any) {
    // Handle duplicate email_id (unique constraint violation)
    if (error?.message?.includes("UNIQUE constraint failed")) {
      console.log(`Duplicate email detected: ${emailId}, skipping processing`);
      log("duplicate, skipped");
      return NextResponse.json({ data: { received: true, duplicate: true } }, { status: 200 });
    }
    log(`db insert error: ${error?.message}`);
    // Re-throw other errors
    throw error;
  }

  // Auto-dispatch: create a chat session and queue the agent to process the email
  try {
    const emailContent = [
      "You received a new email. Please process it and respond appropriately.",
      "",
      `**From:** ${data.from_name ? `${data.from_name} <${fromEmail}>` : fromEmail}`,
      `**To:** ${toEmail}`,
      `**Subject:** ${subject || "(no subject)"}`,
      "",
      "**Body:**",
      textBody || "(no text body)",
    ].join("\n");

    const session = await createAssigneeFollowUp(
      emailContent,
      assignee,
      `Email: ${subject || "(no subject)"}`,
    );

    log(`auto-dispatched to session ${session.id}`);
  } catch (dispatchError) {
    // Log but don't fail the webhook — the email is already stored
    console.error("[webhook:resend] Auto-dispatch failed:", dispatchError);
    log("auto-dispatch failed (email still stored)");
  }

  log("complete");
  return NextResponse.json({ data: { received: true } });
}
