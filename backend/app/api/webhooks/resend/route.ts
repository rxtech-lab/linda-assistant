import { NextRequest, NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/lib/db";
import { emailInbox, assignees } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { receivedResponseSchema } from "@/lib/schemas";

/**
 * @openapi
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
      { status: 400 }
    );
  }

  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET!;
  const wh = new Webhook(webhookSecret);

  let payload: Record<string, unknown>;
  try {
    payload = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid webhook signature" },
      { status: 400 }
    );
  }

  const eventType = payload.type as string;
  if (eventType !== "email.received") {
    return NextResponse.json({ data: { received: true } });
  }

  const data = payload.data as Record<string, unknown>;
  const toEmail = ((data.to as string[]) || [])[0] || "";
  const fromEmail = (data.from as string) || "";
  const subject = (data.subject as string) || "";
  const html = (data.html as string) || (data.text as string) || "";

  // Find assignee by email to determine user
  const [assignee] = await db
    .select()
    .from(assignees)
    .where(eq(assignees.email, toEmail));

  if (!assignee) {
    // No assignee found for this email address, still acknowledge
    return NextResponse.json({ data: { received: true } });
  }

  await db.insert(emailInbox).values({
    userId: assignee.userId,
    assigneeId: assignee.id,
    fromEmail,
    fromName: (data.from_name as string) || null,
    toEmail,
    subject,
    body: html,
    receivedAt: new Date().toISOString(),
    metadata: {
      messageId: data.message_id,
      headers: data.headers,
    },
  });

  return NextResponse.json({ data: { received: true } });
}
