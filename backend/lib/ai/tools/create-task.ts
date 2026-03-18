import { db } from "@/lib/db";
import { chatSessions, tasks } from "@/lib/db/schema";
import { registerCronTask, scheduleOnceTask } from "@/lib/celery/client";
import { convertCronToUTC, convertRunsAtToUTC } from "@/lib/utils/timezone";
import { isValidCronExpression } from "@/lib/utils/cron";
import { inheritAssigneeToolset } from "@/lib/db/task-toolset";
import { eq, and } from "drizzle-orm";
import { tool } from "ai";
import { z } from "zod";

export const createTaskTool = (
  userId: string,
  needsApproval: boolean,
  sessionId?: string,
  defaultAssigneeId?: string | null,
) =>
  tool({
    description:
      "Create a new task for the user. Can optionally set up a recurring cron schedule or a one-shot scheduled execution. " +
      "When creating scheduled tasks, times should be specified in the user's timezone — they will be automatically converted to UTC.",
    needsApproval,
    inputSchema: z.object({
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task description"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      categories: z.array(z.string()).optional().describe("Task categories"),
      cronSchedule: z
        .string()
        .optional()
        .describe(
          "Cron expression for recurring execution (e.g. '0 7 * * *' for 7 AM daily). Specify in the user's local timezone.",
        ),
      runsAt: z
        .string()
        .optional()
        .describe(
          "ISO datetime for one-shot scheduled execution (e.g. '2025-01-15T09:00:00'). Specify in the user's local timezone.",
        ),
    }),
    execute: async ({ title, description, tags, categories, cronSchedule, runsAt }) => {
      const assigneeId = defaultAssigneeId ?? undefined;
      // Validate mutual exclusivity
      if (cronSchedule && runsAt) {
        return { error: "A task cannot have both cron scheduling and a one-shot runsAt schedule" };
      }

      // Validate cron expression
      if (cronSchedule && !isValidCronExpression(cronSchedule)) {
        return { error: "Invalid cron expression" };
      }

      // Get session timezone for conversion
      let sessionTimezone: string | null = null;
      if (sessionId) {
        const [session] = await db
          .select({ timezone: chatSessions.timezone })
          .from(chatSessions)
          .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
        sessionTimezone = session?.timezone ?? null;
      }

      // Convert schedule times to UTC
      const utcCronSchedule = cronSchedule
        ? convertCronToUTC(cronSchedule, sessionTimezone)
        : undefined;
      const utcRunsAt = runsAt ? convertRunsAtToUTC(runsAt, sessionTimezone) : undefined;

      const isCronEnabled = !!utcCronSchedule;
      const status = isCronEnabled || utcRunsAt ? "running" : "pending";

      const [created] = await db
        .insert(tasks)
        .values({
          userId,
          title,
          description,
          tags,
          categories,
          assigneeId,
          ...(utcCronSchedule !== undefined ? { cronSchedule: utcCronSchedule } : {}),
          isCronEnabled,
          ...(utcRunsAt !== undefined ? { runsAt: utcRunsAt } : {}),
          status,
        })
        .returning();

      // Register with Celery for scheduling
      if (isCronEnabled && utcCronSchedule) {
        await registerCronTask(created.id, utcCronSchedule);
      }
      if (utcRunsAt) {
        await scheduleOnceTask(created.id, utcRunsAt);
      }

      // Inherit assignee's tool permissions and enabled extensions
      if (assigneeId) {
        const toolPermissions = await inheritAssigneeToolset(created.id, assigneeId);
        if (toolPermissions) {
          await db.update(tasks).set({ toolPermissions }).where(eq(tasks.id, created.id));
        }
      }

      return {
        taskId: created.id,
        title: created.title,
        status: created.status,
        cronSchedule: created.cronSchedule,
        isCronEnabled: created.isCronEnabled,
        runsAt: created.runsAt,
      };
    },
  });

export const CREATE_TASK_TOOL_NAME = "create_task";
