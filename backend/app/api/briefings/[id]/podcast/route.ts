import { NextRequest } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { authenticate } from "@/lib/auth/middleware";
import { enqueueBriefingPodcast } from "@/lib/ai/podcast/enqueue";
import { errorJson, successJson } from "@/lib/utils/response";

/**
 * Trigger (or re-trigger) podcast generation for a briefing.
 *
 * Idempotent — concurrent calls for the same briefing are safe:
 * - status='ready' → returns 'ready' with the existing url
 * - status='generating' → returns 'already_running' without re-enqueueing
 * - status='pending' or 'failed' → resets attempts/error and enqueues
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

  if (briefing.podcastStatus === "ready" && briefing.podcastUrl) {
    return successJson({
      status: "ready" as const,
      briefingId: briefing.id,
      podcastUrl: briefing.podcastUrl,
    });
  }

  if (briefing.podcastStatus === "generating") {
    return successJson({
      status: "already_running" as const,
      briefingId: briefing.id,
      podcastUrl: null,
    });
  }

  // Atomic reset: only enqueue if we transitioned a non-running row.
  const reset = await db
    .update(briefings)
    .set({
      podcastStatus: "pending",
      podcastError: null,
      podcastAttempts: 0,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(
      and(
        eq(briefings.id, id),
        eq(briefings.userId, auth.userId),
        inArray(briefings.podcastStatus, ["pending", "failed"]),
      ),
    )
    .returning({ id: briefings.id });

  if (reset.length === 0) {
    return successJson({
      status: "already_running" as const,
      briefingId: briefing.id,
      podcastUrl: null,
    });
  }

  await enqueueBriefingPodcast({
    briefingId: briefing.id,
    userId: auth.userId,
    sessionId: briefing.chatSessionId,
    triggeredBy: "manual_retrigger",
  });

  return successJson(
    {
      status: "queued" as const,
      briefingId: briefing.id,
      podcastUrl: null,
    },
    202,
  );
}
