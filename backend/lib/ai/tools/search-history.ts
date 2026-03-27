import { tool } from "ai";
import { z } from "zod";
import { searchHistoryByVector } from "../history";

export const SEARCH_HISTORY_TOOL_NAME = "search_history";

export const searchHistoryTool = (userId: string, assigneeId: string) =>
  tool({
    description:
      "Search past task execution history for this assistant using semantic search. Returns summaries of completed tasks including tools used, results, and timing.",
    needsApproval: false,
    inputSchema: z.object({
      search_query: z.string().describe("Semantic search query to find relevant past task history"),
      limit: z.number().default(5).describe("Maximum number of results to return"),
    }),
    execute: async ({ search_query, limit }) => {
      const results = await searchHistoryByVector(search_query, userId, assigneeId, limit);
      return {
        results: results.map((r) => ({
          taskTitle: r.taskTitle,
          summary: r.summary,
          toolCalls: r.toolCalls,
          status: r.status,
          durationSecs: r.durationSecs,
          score: r.score,
          createdAt: r.createdAt,
        })),
      };
    },
  });
