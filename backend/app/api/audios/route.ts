import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { audios } from "@/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { authenticate } from "@/lib/auth/middleware";
import { selectAudioSchema } from "@/lib/schemas";
import { successJson, errorJson } from "@/lib/utils/response";
import { z } from "zod";

const listResponseSchema = z.object({
  data: z.array(selectAudioSchema),
});

/**
 * @openapi
 * @operationId listAudios
 * @response listResponseSchema
 */
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const chatSessionId = request.nextUrl.searchParams.get("chatSessionId");
  if (!chatSessionId) return errorJson("chatSessionId is required", 400);

  const items = await db
    .select()
    .from(audios)
    .where(and(eq(audios.userId, auth.userId), eq(audios.chatSessionId, chatSessionId)))
    .orderBy(desc(audios.createdAt));

  return successJson({ data: items });
}
