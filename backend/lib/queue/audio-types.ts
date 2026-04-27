export const AUDIO_TASKS_QUEUE = "audio-generation-tasks";
export const AUDIO_RETRY_QUEUE = "audio-generation-retry";
export const AUDIO_RETRY_EXCHANGE = "audio-generation-retry-x";

export const MAX_AUDIO_ATTEMPTS = 3;
export const AUDIO_RETRY_BASE_MS = 60_000;
export const AUDIO_RETRY_MAX_MS = 600_000;

export interface AudioGenerationTask {
  type: "briefing-podcast";
  briefingId: string;
  userId: string;
  sessionId: string | null;
  attempt: number;
  enqueuedAt: number;
  triggeredBy: "create_briefing" | "manual_retrigger";
}

export function computeRetryDelayMs(nextAttempt: number): number {
  const exp = Math.max(0, nextAttempt - 2);
  return Math.min(AUDIO_RETRY_BASE_MS * 2 ** exp, AUDIO_RETRY_MAX_MS);
}
