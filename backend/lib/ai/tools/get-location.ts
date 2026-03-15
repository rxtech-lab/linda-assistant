import { tool } from "ai";
import { z } from "zod";
import { redis } from "@/lib/redis";

const LOCATION_DATA_KEY = (toolCallId: string) => `location:data:${toolCallId}`;

export const getLocationTool = () =>
  tool({
    description:
      "Request the user's current GPS location. Use this when you need the user's geographic coordinates, for example to find nearby places, get weather information, or provide location-based recommendations. The user will be prompted to share their location and may decline.",
    inputSchema: z.object({
      reason: z
        .string()
        .optional()
        .describe("Brief explanation of why the location is needed, shown to the user"),
    }),
    needsApproval: true,
    execute: async (_input, { toolCallId }) => {
      // When this executes, the user has already shared (or rejected) their location.
      // Read the location data from Redis.
      const raw = await redis.get(LOCATION_DATA_KEY(toolCallId));

      if (!raw) {
        return { error: "Location data not found or expired" };
      }

      const data = typeof raw === "string" ? JSON.parse(raw) : raw;

      if (data.rejected) {
        return { error: "User declined to share their location" };
      }

      return {
        latitude: data.latitude,
        longitude: data.longitude,
        accuracy: data.accuracy,
      };
    },
  });

export const GET_LOCATION_TOOL_NAME = "get_location";
