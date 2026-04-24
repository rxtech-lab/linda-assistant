const CELERY_BASE_URL = process.env.CELERY_BASE_URL;
const CELERY_ADMIN_KEY = process.env.CELERY_ADMIN_KEY;

function celeryHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(CELERY_ADMIN_KEY ? { Authorization: `Bearer ${CELERY_ADMIN_KEY}` } : {}),
  };
}

export interface CeleryScheduleView {
  task_id: string;
  cron_schedule: string | null;
  timezone: string | null;
}

/** Fetch Celery's view of a cron schedule. Returns null if CELERY_BASE_URL is
 * not set or if Celery has no entry for this task. */
export async function getCronTask(taskId: string): Promise<CeleryScheduleView | null> {
  if (!CELERY_BASE_URL) return null;
  try {
    const res = await fetch(`${CELERY_BASE_URL}/schedules/${taskId}`, {
      method: "GET",
      headers: celeryHeaders(),
    });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as CeleryScheduleView;
  } catch (err) {
    console.error(`[Celery] Failed to get cron task ${taskId}:`, err);
    return null;
  }
}

/** Register a new cron schedule for a task. No-op if CELERY_BASE_URL is not set. */
export async function registerCronTask(
  taskId: string,
  cronSchedule: string,
  timezone?: string | null,
): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/schedules`, {
      method: "POST",
      headers: celeryHeaders(),
      body: JSON.stringify({
        task_id: taskId,
        cron_schedule: cronSchedule,
        ...(timezone ? { timezone } : {}),
      }),
    });
  } catch (err) {
    console.error(`[Celery] Failed to register cron task ${taskId}:`, err);
  }
}

/** Update an existing cron schedule. No-op if CELERY_BASE_URL is not set. */
export async function updateCronTask(
  taskId: string,
  cronSchedule: string,
  timezone?: string | null,
): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/schedules/${taskId}`, {
      method: "PUT",
      headers: celeryHeaders(),
      body: JSON.stringify({
        cron_schedule: cronSchedule,
        ...(timezone ? { timezone } : {}),
      }),
    });
  } catch (err) {
    console.error(`[Celery] Failed to update cron task ${taskId}:`, err);
  }
}

/** Remove a cron schedule. No-op if CELERY_BASE_URL is not set. */
export async function deleteCronTask(taskId: string): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/schedules/${taskId}`, {
      method: "DELETE",
      headers: celeryHeaders(),
    });
  } catch (err) {
    console.error(`[Celery] Failed to delete cron task ${taskId}:`, err);
  }
}

/** Schedule a one-shot task execution at a specific datetime. No-op if CELERY_BASE_URL is not set. */
export async function scheduleOnceTask(taskId: string, runsAt: string): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/execute-once`, {
      method: "POST",
      headers: celeryHeaders(),
      body: JSON.stringify({ task_id: taskId, eta: new Date(runsAt).toISOString() }),
    });
  } catch (err) {
    console.error(`[Celery] Failed to schedule one-shot task ${taskId}:`, err);
  }
}

/** Schedule a one-shot notification at a specific datetime. No-op if CELERY_BASE_URL is not set. */
export async function scheduleNotification(notificationId: string, sendAt: string): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/schedule-notification`, {
      method: "POST",
      headers: celeryHeaders(),
      body: JSON.stringify({
        notification_id: notificationId,
        eta: new Date(sendAt).toISOString(),
      }),
    });
  } catch (err) {
    console.error(`[Celery] Failed to schedule notification ${notificationId}:`, err);
  }
}

/** Execute a task immediately. No-op if CELERY_BASE_URL is not set. */
export async function executeTaskNow(taskId: string): Promise<void> {
  if (!CELERY_BASE_URL) return;
  try {
    await fetch(`${CELERY_BASE_URL}/execute-now`, {
      method: "POST",
      headers: celeryHeaders(),
      body: JSON.stringify({ task_id: taskId }),
    });
  } catch (err) {
    console.error(`[Celery] Failed to execute task ${taskId}:`, err);
  }
}
