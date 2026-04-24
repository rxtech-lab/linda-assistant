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
import { convertRunsAtToUTC } from "@/lib/utils/timezone";
import { isValidCronExpression } from "@/lib/utils/cron";

export const updateTaskTool = (userId: string, needsApproval: boolean, sessionId?: string) =>
  tool({
    description:
      "Update an existing task's status, details, or scheduling. " +
      "Can add, modify, or remove cron schedules and one-shot execution times. " +
      "When updating scheduled tasks, times should be specified in the user's timezone.",
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
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone (e.g. 'America/New_York') to interpret cronSchedule and runsAt in. Overrides the chat session's timezone when provided.",
        ),
    }),
    execute: async ({ taskId, cronSchedule, isCronEnabled, runsAt, timezone, ...updates }) => {
      // Validate cron expression if provided
      if (cronSchedule && !isValidCronExpression(cronSchedule)) {
        return { error: "Invalid cron expression" };
      }

      // Validate mutual exclusivity: reject when both cron and runsAt are provided
      if ((cronSchedule || isCronEnabled) && runsAt) {
        return { error: "A task cannot have both cron scheduling and a one-shot runsAt schedule" };
      }

      // Resolve effective timezone: explicit param overrides the chat session's timezone
      let effectiveTimezone: string | null = timezone ?? null;
      if (!effectiveTimezone && sessionId) {
        const [session] = await db
          .select({ timezone: chatSessions.timezone })
          .from(chatSessions)
          .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
        effectiveTimezone = session?.timezone ?? null;
      }

      // Fetch existing task to check current state
      const [existingTask] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
      if (!existingTask) return { error: "Task not found" };

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
          setValues.cronSchedule = cronSchedule;
          setValues.isCronEnabled = true;
          setValues.runsAt = null; // Clear runsAt when setting cron
          if (effectiveTimezone) setValues.timezone = effectiveTimezone;
        }
      }
      if (isCronEnabled !== undefined) {
        if (isCronEnabled && !cronSchedule && !existingTask.cronSchedule) {
          return { error: "Cannot enable cron without a cron schedule" };
        }
        setValues.isCronEnabled = isCronEnabled;
        if (!isCronEnabled) {
          setValues.cronSchedule = null;
        }
      }
      if (runsAt !== undefined) {
        if (runsAt === null) {
          setValues.runsAt = null;
        } else {
          setValues.runsAt = convertRunsAtToUTC(runsAt, effectiveTimezone);
          setValues.isCronEnabled = false; // Clear cron when setting runsAt
          setValues.cronSchedule = null;
          if (effectiveTimezone) setValues.timezone = effectiveTimezone;
        }
      }

      const [updated] = await db
        .update(tasks)
        .set(setValues)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();

      if (!updated) return { error: "Task not found" };

      // Sync with Celery
      const wasCronEnabled = existingTask.isCronEnabled && existingTask.cronSchedule;
      const isCronNow = updated.isCronEnabled && updated.cronSchedule;

      if (isCronNow) {
        if (wasCronEnabled) {
          await updateCronTask(taskId, updated.cronSchedule!, updated.timezone);
        } else {
          await registerCronTask(taskId, updated.cronSchedule!, updated.timezone);
        }
      } else if (wasCronEnabled && !isCronNow) {
        // Cron was active but is now disabled/removed
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
