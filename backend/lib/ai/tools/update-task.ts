import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatSessions, tasks } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import {
  registerCronTask,
  updateCronTask,
  deleteCronTask,
  scheduleOnceTask,
} from "@/lib/celery/client";
import { convertCronToUTC, convertRunsAtToUTC } from "@/lib/utils/timezone";
import { isValidCronExpression } from "@/lib/utils/cron";

export const updateTaskTool = (userId: string, needsApproval: boolean, sessionId?: string) =>
  tool({
    description:
      "Update an existing task's status, details, or scheduling. " +
      "Can add, modify, or remove cron schedules and one-shot execution times. " +
      "When updating scheduled tasks, times should be specified in the user's timezone — they will be automatically converted to UTC.",
    needsApproval,
    inputSchema: z.object({
      taskId: z.string().describe("ID of the task to update"),
      title: z.string().optional().describe("New task title"),
      description: z.string().optional().describe("New task description"),
      status: z
        .enum(["pending", "running", "finished", "cancelled"])
        .optional()
        .describe("New task status"),
      tags: z.array(z.string()).optional().describe("Updated tags"),
      categories: z.array(z.string()).optional().describe("Updated categories"),
      cronSchedule: z
        .string()
        .optional()
        .nullable()
        .describe(
          "Cron expression for recurring execution (e.g. '0 7 * * *'). Set to null to remove. Specify in the user's local timezone.",
        ),
      isCronEnabled: z.boolean().optional().describe("Enable or disable cron scheduling"),
      runsAt: z
        .string()
        .optional()
        .nullable()
        .describe(
          "ISO datetime for one-shot scheduled execution. Set to null to remove. Specify in the user's local timezone.",
        ),
    }),
    execute: async ({ taskId, cronSchedule, isCronEnabled, runsAt, ...updates }) => {
      // Validate cron expression if provided
      if (cronSchedule && !isValidCronExpression(cronSchedule)) {
        return { error: "Invalid cron expression" };
      }

      // Validate mutual exclusivity
      if (isCronEnabled && runsAt) {
        return { error: "A task cannot have both cron scheduling and a one-shot runsAt schedule" };
      }

      // Get session timezone for conversion
      let sessionTimezone: string | null = null;
      if (sessionId) {
        const [session] = await db
          .select({ timezone: chatSessions.timezone })
          .from(chatSessions)
          .where(eq(chatSessions.id, sessionId));
        sessionTimezone = session?.timezone ?? null;
      }

      const setValues: Record<string, unknown> = {
        updatedAt: sql`(datetime('now'))`,
      };
      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.tags !== undefined) setValues.tags = updates.tags;
      if (updates.categories !== undefined) setValues.categories = updates.categories;

      // Handle scheduling updates
      if (cronSchedule !== undefined) {
        if (cronSchedule === null) {
          setValues.cronSchedule = null;
          setValues.isCronEnabled = false;
        } else {
          setValues.cronSchedule = convertCronToUTC(cronSchedule, sessionTimezone);
          setValues.isCronEnabled = true;
          setValues.runsAt = null; // Clear runsAt when setting cron
        }
      }
      if (isCronEnabled !== undefined) {
        setValues.isCronEnabled = isCronEnabled;
        if (isCronEnabled && !cronSchedule) {
          // Enabling cron without new schedule — keep existing
        }
        if (!isCronEnabled) {
          setValues.cronSchedule = null;
        }
      }
      if (runsAt !== undefined) {
        if (runsAt === null) {
          setValues.runsAt = null;
        } else {
          setValues.runsAt = convertRunsAtToUTC(runsAt, sessionTimezone);
          setValues.isCronEnabled = false; // Clear cron when setting runsAt
          setValues.cronSchedule = null;
        }
      }

      const [updated] = await db
        .update(tasks)
        .set(setValues)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();

      if (!updated) return { error: "Task not found" };

      // Sync with Celery
      if (updated.isCronEnabled && updated.cronSchedule) {
        if (cronSchedule !== undefined) {
          await updateCronTask(taskId, updated.cronSchedule);
        } else {
          await registerCronTask(taskId, updated.cronSchedule);
        }
      } else if (isCronEnabled === false || runsAt) {
        await deleteCronTask(taskId);
      }

      if (runsAt !== undefined && updated.runsAt) {
        await scheduleOnceTask(taskId, updated.runsAt);
      }

      return {
        taskId: updated.id,
        title: updated.title,
        status: updated.status,
        cronSchedule: updated.cronSchedule,
        isCronEnabled: updated.isCronEnabled,
        runsAt: updated.runsAt,
      };
    },
  });

export const UPDATE_TASK_TOOL_NAME = "update_task";
