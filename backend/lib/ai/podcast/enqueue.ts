import { publishAudioTask } from "@/lib/queue/audio-producer";
import { publishEvent } from "@/lib/queue/producer";

interface EnqueueArgs {
  briefingId: string;
  userId: string;
  sessionId: string | null;
  triggeredBy: "create_briefing" | "manual_retrigger";
}

/**
 * Enqueue briefing podcast generation. Used by both the create_briefing tool
 * and the manual re-trigger endpoint so they share retry/status semantics.
 * The caller is responsible for setting podcast_status='pending' on the row
 * (or letting it stay 'pending' from the default) before calling this.
 */
export async function enqueueBriefingPodcast(args: EnqueueArgs): Promise<void> {
  const { briefingId, userId, sessionId, triggeredBy } = args;

  await publishAudioTask({
    type: "briefing-podcast",
    briefingId,
    userId,
    sessionId,
    attempt: 1,
    enqueuedAt: Date.now(),
    triggeredBy,
  });

  if (sessionId) {
    await publishEvent({
      sessionId,
      event: "briefing-podcast-queued",
      data: { briefingId, triggeredBy },
      timestamp: Date.now(),
    }).catch((err) => console.warn("[podcast] queued event failed", err));
  }
}
