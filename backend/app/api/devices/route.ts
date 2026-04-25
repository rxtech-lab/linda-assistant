import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { authenticate } from "@/lib/auth/middleware";
import { insertDeviceSchema, selectDeviceSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

/**
 * @openapi
 * @operationId registerDevice
 * @body insertDeviceSchema
 * @response 201:selectDeviceSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertDeviceSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const updateSet: {
    userId: string;
    platform: string;
    liveActivityStartToken?: string | null;
  } = {
    userId: auth.userId,
    platform: parsed.data.platform,
  };
  // Only overwrite the LA token when the client sent a value. Omitting it
  // (e.g. on a regular device-token re-registration) preserves the existing one.
  if (parsed.data.liveActivityStartToken !== undefined) {
    updateSet.liveActivityStartToken = parsed.data.liveActivityStartToken;
  }

  const [upserted] = await db
    .insert(devices)
    .values({ ...parsed.data, userId: auth.userId })
    .onConflictDoUpdate({
      target: devices.deviceToken,
      set: updateSet,
    })
    .returning();

  console.log(
    `[device] registered device=${upserted.id} token=${upserted.deviceToken.slice(0, 8)}... userId=${auth.userId} liveActivity=${upserted.liveActivityStartToken ? "yes" : "no"}`,
  );
  return successJson(upserted, 201);
}
