import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userSettings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectUserSettingsSchema, updateUserSettingsSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @operationId getUserSettings
 * @response selectUserSettingsSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  // Upsert: return existing or create default
  let [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, auth.userId));

  if (!settings) {
    [settings] = await db.insert(userSettings).values({ userId: auth.userId }).returning();
  }

  return successJson(settings);
}

/**
 * @openapi
 * @operationId updateUserSettings
 * @body updateUserSettingsSchema
 * @response selectUserSettingsSchema
 */
export async function PUT(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = updateUserSettingsSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return errorJson(msg, 422);
  }

  // Upsert pattern: try update, if no rows affected, insert then update
  const existing = await db.select().from(userSettings).where(eq(userSettings.userId, auth.userId));

  let settings;
  if (existing.length > 0) {
    [settings] = await db
      .update(userSettings)
      .set({ ...parsed.data, updatedAt: sql`(datetime('now'))` })
      .where(eq(userSettings.userId, auth.userId))
      .returning();
  } else {
    [settings] = await db
      .insert(userSettings)
      .values({ userId: auth.userId, ...parsed.data })
      .returning();
  }

  return successJson(settings);
}
