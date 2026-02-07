import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { authenticate } from "@/lib/auth/middleware";
import { insertDeviceSchema, selectDeviceSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

/**
 * @openapi
 * @body insertDeviceSchema
 * @response 201:selectDeviceSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertDeviceSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [created] = await db
    .insert(devices)
    .values({ ...parsed.data, userId: auth.userId })
    .returning();

  return successJson(created, 201);
}

