import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { confirmations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { resolveConfirmationSchema, resolveResponseSchema, idParamSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { resolveConfirmation } from "@/lib/ai/confirmation";

/**
 * @openapi
 * @operationId resolveConfirmation
 * @pathParams idParamSchema
 * @body resolveConfirmationSchema
 * @response resolveResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const body = await request.json();
  const parsed = resolveConfirmationSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  // Verify confirmation belongs to user
  const [confirmation] = await db
    .select()
    .from(confirmations)
    .where(
      and(
        eq(confirmations.id, id),
        eq(confirmations.userId, auth.userId)
      )
    );

  if (!confirmation) return errorJson("Confirmation not found", 404);
  if (confirmation.status !== "pending")
    return errorJson("Confirmation already resolved", 409);

  const result = await resolveConfirmation(id, parsed.data.action);

  return successJson(result);
}

