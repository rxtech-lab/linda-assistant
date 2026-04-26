import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { authenticate } from "@/lib/auth/middleware";
import { generatePodcastForBriefing } from "@/lib/ai/podcast/generate";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * Trigger podcast generation for a briefing that does not yet have one.
 * Returns immediately; actual generation runs asynchronously and notifies the
 * client via the existing `briefing-podcast-ready` SSE event + APNs push.
 *
 * @openapi
 * @operationId generateBriefingPodcast
 * @pathParams idParamSchema
 * @response generateBriefingPodcastResponseSchema
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const { id } = await params;

  const [briefing] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, id), eq(briefings.userId, auth.userId)));

  if (!briefing) return errorJson("Briefing not found", 404);

  if (briefing.podcastUrl) {
    return successJson({
      status: "already_exists" as const,
      briefingId: briefing.id,
      podcastUrl: briefing.podcastUrl,
    });
  }

  generatePodcastForBriefing({
    briefingId: briefing.id,
    userId: auth.userId,
    sessionId: briefing.chatSessionId,
    title: briefing.title,
    content: briefing.content,
    imageUrl: briefing.imageUrl ?? null,
  }).catch((err) => {
    console.error(
      "[briefings/podcast] background generation failed:",
      err,
    );
  });

  return successJson(
    {
      status: "generating" as const,
      briefingId: briefing.id,
      podcastUrl: null,
    },
    202,
  );
}
