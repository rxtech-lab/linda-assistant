import { tool } from "ai";
import { z } from "zod";

export const getCurrentTimeTool = (needsApproval: boolean) =>
  tool({
    description: "Get the current date and time",
    needsApproval,
    inputSchema: z.object({
      timezone: z
        .string()
        .optional()
        .describe("IANA timezone (e.g. 'America/New_York'). Defaults to UTC."),
    }),
    execute: async ({ timezone }) => {
      const tz = timezone || "UTC";
      const now = new Date();
      return {
        currentTime: now.toLocaleString("en-US", { timeZone: tz }),
        timezone: tz,
        iso: now.toISOString(),
      };
    },
  });

export const GET_CURRENT_TIME_TOOL_NAME = "get_current_time";
