import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const createTaskTool = (userId: string) =>
  tool({
    description: "Create a new task for the user",
    inputSchema: z.object({
      title: z.string().describe("Task title"),
      description: z.string().optional().describe("Task description"),
      tags: z.array(z.string()).optional().describe("Tags for categorization"),
      categories: z.array(z.string()).optional().describe("Task categories"),
    }),
    execute: async ({ title, description, tags, categories }) => {
      const [created] = await db
        .insert(tasks)
        .values({
          userId,
          title,
          description,
          tags,
          categories,
        })
        .returning();

      return { taskId: created.id, title: created.title, status: created.status };
    },
  });

export const CREATE_TASK_TOOL_NAME = "create_task";
