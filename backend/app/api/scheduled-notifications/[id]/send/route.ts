import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { scheduledNotifications } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { sendPushNotification } from "@/lib/push";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId sendScheduledNotification
 * @pathParams idParamSchema
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authHeader = request.headers.get("authorization");
  const adminKey = process.env.CELERY_ADMIN_KEY;

  if (!adminKey || authHeader !== `Bearer ${adminKey}`) {
    return errorJson("Unauthorized", 401);
  }

  const { id } = await params;

  const [notification] = await db
    .select()
    .from(scheduledNotifications)
    .where(and(eq(scheduledNotifications.id, id), eq(scheduledNotifications.sent, false)));

  if (!notification) return errorJson("Notification not found or already sent", 404);

  try {
    await sendPushNotification(notification.userId, {
      title: notification.title,
      body: notification.body,
      data: { type: "scheduled_notification" },
    });

    await db
      .update(scheduledNotifications)
      .set({ sent: true })
      .where(eq(scheduledNotifications.id, id));

    return successJson({ notificationId: id, sent: true });
  } catch (error) {
    console.error(`[scheduled-notification] Failed to send ${id}:`, error);
    return errorJson("Failed to send notification", 500);
  }
}
