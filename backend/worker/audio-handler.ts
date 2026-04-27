import { and, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { generatePodcastForBriefing } from "@/lib/ai/podcast/generate";
import { db } from "@/lib/db";
import { briefings } from "@/lib/db/schema";
import { publishAudioRetry } from "@/lib/queue/audio-producer";
import {
  computeRetryDelayMs,
  MAX_AUDIO_ATTEMPTS,
  type AudioGenerationTask,
} from "@/lib/queue/audio-types";
import { publishEvent } from "@/lib/queue/producer";
import { sendPushNotification } from "@/lib/push";

export async function handleAudioTask(task: AudioGenerationTask): Promise<void> {
  if (task.type !== "briefing-podcast") {
    console.warn(`[AudioWorker] Unknown task type: ${task.type}`);
    return;
  }

  const { briefingId, userId, sessionId, attempt } = task;
  console.log(
    `[AudioWorker] Processing briefing=${briefingId} attempt=${attempt}/${MAX_AUDIO_ATTEMPTS}`,
  );

  const [briefing] = await db
    .select()
    .from(briefings)
    .where(and(eq(briefings.id, briefingId), eq(briefings.userId, userId)));

  if (!briefing) {
    console.warn(`[AudioWorker] Briefing not found, dropping task: ${briefingId}`);
    return;
  }

  if (briefing.podcastStatus === "ready") {
    console.log(`[AudioWorker] Briefing ${briefingId} already ready, skipping`);
    return;
  }

  // Atomic claim: only proceed if we transitioned from a non-terminal state.
  // The IN list includes 'generating' so a redelivered message after a worker
  // crash can re-claim the job (the previous worker's row was left in
  // 'generating' but its in-memory state is gone).
  const claimed = await db
    .update(briefings)
    .set({
      podcastStatus: "generating",
      podcastAttempts: attempt,
      podcastError: null,
      updatedAt: sql`(datetime('now'))`,
    })
    .where(
      and(
        eq(briefings.id, briefingId),
        inArray(briefings.podcastStatus, ["pending", "failed", "generating"]),
      ),
    )
    .returning({ id: briefings.id });

  if (claimed.length === 0) {
    console.log(`[AudioWorker] Briefing ${briefingId} not claimable, skipping`);
    return;
  }

  if (sessionId) {
    await publishEvent({
      sessionId,
      event: "briefing-podcast-generating",
      data: { briefingId, attempt, maxAttempts: MAX_AUDIO_ATTEMPTS },
      timestamp: Date.now(),
    }).catch((err) => console.warn("[AudioWorker] generating event failed", err));
  }

  try {
    await generatePodcastForBriefing({
      briefingId,
      userId,
      sessionId,
      title: briefing.title,
      content: briefing.content,
      imageUrl: briefing.imageUrl ?? null,
    });
    console.log(`[AudioWorker] Briefing ${briefingId} ready (attempt ${attempt})`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[AudioWorker] Briefing ${briefingId} attempt ${attempt} failed:`,
      errorMessage,
    );

    if (attempt < MAX_AUDIO_ATTEMPTS) {
      const nextAttempt = attempt + 1;
      const delayMs = computeRetryDelayMs(nextAttempt);

      await db
        .update(briefings)
        .set({
          podcastStatus: "pending",
          podcastError: errorMessage,
          updatedAt: sql`(datetime('now'))`,
        })
        .where(eq(briefings.id, briefingId));

      await publishAudioRetry({ ...task, attempt: nextAttempt }, delayMs);
      console.log(
        `[AudioWorker] Scheduled retry for briefing=${briefingId} attempt=${nextAttempt} delayMs=${delayMs}`,
      );
      return;
    }

    // Terminal failure
    await db
      .update(briefings)
      .set({
        podcastStatus: "failed",
        podcastError: errorMessage,
        updatedAt: sql`(datetime('now'))`,
      })
      .where(eq(briefings.id, briefingId));

    if (sessionId) {
      await publishEvent({
        sessionId,
        event: "briefing-podcast-failed",
        data: { briefingId, error: errorMessage, attempts: attempt },
        timestamp: Date.now(),
      }).catch((e) => console.warn("[AudioWorker] failed-event publish failed", e));
    }

    await sendPushNotification(userId, {
      title: "Podcast generation failed",
      body: briefing.title,
      data: {
        type: "briefing-podcast-failed",
        briefingId,
      },
    }).catch((e) => console.warn("[AudioWorker] failure push failed", e));
  }
}
