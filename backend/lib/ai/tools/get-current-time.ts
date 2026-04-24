import { tool } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { chatSessions } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export const getCurrentTimeTool = (
  needsApproval: boolean,
  userId?: string,
  sessionId?: string,
) =>
  tool({
    description:
      "Get the current date and time. Defaults to the chat session's timezone when no timezone is provided.",
    needsApproval,
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe(
          "IANA timezone (e.g. 'America/New_York'). Defaults to the chat session's timezone, or UTC if none is set.",
        ),
    }),
    execute: async ({ timezone }) => {
      let tz = timezone;
      if (!tz && sessionId && userId) {
        const [session] = await db
          .select({ timezone: chatSessions.timezone })
          .from(chatSessions)
          .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
        tz = session?.timezone ?? undefined;
      }
      tz = tz || "UTC";
      const now = new Date();
      return {
        currentTime: now.toLocaleString("en-US", { timeZone: tz }),
        timezone: tz,
        iso: now.toISOString(),
      };
    },
  });

export const GET_CURRENT_TIME_TOOL_NAME = "get_current_time";
