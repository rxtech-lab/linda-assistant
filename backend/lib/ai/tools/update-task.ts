import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";

export const updateTaskTool = (userId: string, needsApproval: boolean) =>
  tool({
    description: "Update an existing task's status or details",
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
    }),
    execute: async ({ taskId, ...updates }) => {
      const setValues: Record<string, unknown> = {
        updatedAt: sql`(datetime('now'))`,
      };
      if (updates.title !== undefined) setValues.title = updates.title;
      if (updates.description !== undefined) setValues.description = updates.description;
      if (updates.status !== undefined) setValues.status = updates.status;
      if (updates.tags !== undefined) setValues.tags = updates.tags;
      if (updates.categories !== undefined) setValues.categories = updates.categories;

      const [updated] = await db
        .update(tasks)
        .set(setValues)
        .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
        .returning();

      if (!updated) return { error: "Task not found" };
      return {
        taskId: updated.id,
        title: updated.title,
        status: updated.status,
      };
    },
  });

export const UPDATE_TASK_TOOL_NAME = "update_task";
