import { NextRequest } from "next/server";
import { authenticate } from "@/lib/auth/middleware";
import { locationResponseSchema, locationResponseResultSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { resolveLocationRequest } from "@/lib/ai/location";

/**
 * Submit a location response (confirm with coordinates or reject).
 *
 * Called by iOS when the user shares their location from the map sheet
 * or when the app responds to a silent push in the background.
 *
 * @openapi
 * @operationId sendLocationResponse
 * @body locationResponseSchema
 * @response locationResponseResultSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = locationResponseSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const { toolCallId, action, latitude, longitude, accuracy, alwaysAllow } = parsed.data;

  if (action === "confirm" && (latitude == null || longitude == null)) {
    return errorJson("latitude and longitude are required when action is confirm", 422);
  }

  try {
    const result = await resolveLocationRequest(
      toolCallId,
      auth.userId,
      action,
      action === "confirm"
        ? { latitude: latitude!, longitude: longitude!, accuracy: accuracy ?? 0 }
        : undefined,
      { alwaysAllow },
    );

    return successJson(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return errorJson(message, 400);
  }
}
