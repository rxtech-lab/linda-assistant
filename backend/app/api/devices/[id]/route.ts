import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { successJson, errorJson } from "@/lib/utils/response";

/**
 * @openapi
 * @response 200 - z.object({ data: z.object({ deleted: z.boolean() }) })
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const [deleted] = await db
    .delete(devices)
    .where(and(eq(devices.id, id), eq(devices.userId, auth.userId)))
    .returning();

  if (!deleted) return errorJson("Device not found", 404);
  return successJson({ deleted: true });
}
