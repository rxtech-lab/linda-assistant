import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { assignees, devices, liveActivityTokens, tasks } from "@/lib/db/schema";
import {
  type LiveActivityContentState,
  sendLiveActivityPush,
} from "@/lib/push";

const LIVE_ACTIVITY_TTL_SECONDS = 8 * 60 * 60;

async function loadTaskForActivity(taskId: string) {
  const [row] = await db
    .select({
      id: tasks.id,
      userId: tasks.userId,
      title: tasks.title,
      assigneeId: tasks.assigneeId,
      liveActivityEnabled: tasks.liveActivityEnabled,
    })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!row) return null;
  if (row.liveActivityEnabled === false) return null;
  return row;
}

async function loadAssigneeName(assigneeId: string | null) {
  if (!assigneeId) return null;
  const [row] = await db
    .select({ name: assignees.name })
    .from(assignees)
    .where(eq(assignees.id, assigneeId));
  return row?.name ?? null;
}

function nowState(
  status: LiveActivityContentState["status"],
  currentStep?: string | null,
): LiveActivityContentState {
  return {
    status,
    currentStep: currentStep ?? null,
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Send a Live Activity push-to-start for every registered start token belonging
 * to the task's owner. The iOS client will then register a per-activity token
 * that subsequent updates use.
 */
export async function startTaskActivity(taskId: string, currentStep?: string | null) {
  const task = await loadTaskForActivity(taskId);
  if (!task) return;

  const startTokenRows = await db
    .select({ liveActivityStartToken: devices.liveActivityStartToken })
    .from(devices)
    .where(
      and(eq(devices.userId, task.userId), isNotNull(devices.liveActivityStartToken)),
    );
  const startTokens = startTokenRows
    .map((row) => row.liveActivityStartToken)
    .filter((token): token is string => Boolean(token));
  if (startTokens.length === 0) return;

  const assigneeName = await loadAssigneeName(task.assigneeId);
  const contentState = nowState("starting", currentStep);
  const staleDate = Math.floor(Date.now() / 1000) + LIVE_ACTIVITY_TTL_SECONDS;

  await Promise.allSettled(
    startTokens.map((token) =>
      sendLiveActivityPush({
        token,
        event: "start",
        contentState,
        staleDate,
        attributes: {
          taskId: task.id,
          taskTitle: task.title,
          assigneeName,
        },
      }),
    ),
  );
}

/**
 * Update every active per-activity token bound to this task with the new
 * content state. Activities that have been ended server-side (`endedAt` set)
 * are skipped.
 */
export async function updateTaskActivity(
  taskId: string,
  status: LiveActivityContentState["status"],
  currentStep?: string | null,
) {
  const task = await loadTaskForActivity(taskId);
  if (!task) return;

  const tokens = await db
    .select()
    .from(liveActivityTokens)
    .where(and(eq(liveActivityTokens.taskId, taskId), isNull(liveActivityTokens.endedAt)));
  if (tokens.length === 0) return;

  const contentState = nowState(status, currentStep);

  await Promise.allSettled(
    tokens.map((row) =>
      sendLiveActivityPush({
        token: row.token,
        event: "update",
        contentState,
      }),
    ),
  );
}

/**
 * End every active per-activity token for this task, marking them ended in the
 * DB so future status changes don't push to them.
 */
export async function endTaskActivity(
  taskId: string,
  status: Extract<LiveActivityContentState["status"], "completed" | "failed">,
  currentStep?: string | null,
) {
  const task = await loadTaskForActivity(taskId);
  if (!task) return;

  const tokens = await db
    .select()
    .from(liveActivityTokens)
    .where(and(eq(liveActivityTokens.taskId, taskId), isNull(liveActivityTokens.endedAt)));
  if (tokens.length === 0) return;

  const contentState = nowState(status, currentStep);
  const dismissalDate = Math.floor(Date.now() / 1000) + 60 * 5;

  await Promise.allSettled(
    tokens.map((row) =>
      sendLiveActivityPush({
        token: row.token,
        event: "end",
        contentState,
        dismissalDate,
      }),
    ),
  );

  const endedAtIso = new Date().toISOString();
  await db
    .update(liveActivityTokens)
    .set({ endedAt: endedAtIso })
    .where(and(eq(liveActivityTokens.taskId, taskId), isNull(liveActivityTokens.endedAt)));
}
