import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectDocumentSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectDocumentSchema),
});

/**
 * @openapi
 * @operationId listDocuments
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const chatSessionId = request.nextUrl.searchParams.get("chatSessionId");
  if (!chatSessionId) return errorJson("chatSessionId is required", 400);

  const items = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, auth.userId), eq(documents.chatSessionId, chatSessionId)))
    .orderBy(desc(documents.createdAt));

  return successJson({ data: items });
}
