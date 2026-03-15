import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { documents } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectDocumentSchema, insertDocumentSchema } from "@/lib/schemas";
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

/**
 * @openapi
 * @operationId createDocument
 * @body insertDocumentSchema
 * @response 201:selectDocumentSchema
 */
export async function POST(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const parsed = insertDocumentSchema.safeParse(body);
  if (!parsed.success) return errorJson(parsed.error.message, 422);

  const [created] = await db
    .insert(documents)
    .values({
      ...parsed.data,
      userId: auth.userId,
    })
    .returning();

  return successJson(created, 201);
}
