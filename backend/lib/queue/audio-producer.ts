import type { Channel } from "amqplib";
import { createChannel } from "./connection";
import {
  AUDIO_RETRY_EXCHANGE,
  AUDIO_RETRY_QUEUE,
  AUDIO_TASKS_QUEUE,
  type AudioGenerationTask,
} from "./audio-types";

export async function assertAudioTopology(ch: Channel): Promise<void> {
  // Direct exchange that DLXes from the retry queue back to the main queue
  await ch.assertExchange(AUDIO_RETRY_EXCHANGE, "direct", { durable: true });

  // Main work queue. Failures dead-letter into the retry exchange when the
  // worker republishes them with a per-message TTL.
  await ch.assertQueue(AUDIO_TASKS_QUEUE, { durable: true });

  // Holding queue for backoff: per-message TTL + DLX back to the main queue
  // (default exchange + routing key === main queue name).
  await ch.assertQueue(AUDIO_RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": AUDIO_TASKS_QUEUE,
    },
  });
  await ch.bindQueue(AUDIO_RETRY_QUEUE, AUDIO_RETRY_EXCHANGE, "");
}

export async function publishAudioTask(task: AudioGenerationTask): Promise<void> {
  const ch = await createChannel();
  ch.sendToQueue(AUDIO_TASKS_QUEUE, Buffer.from(JSON.stringify(task)), {
    persistent: true,
  });
  console.log(
    `[Queue] Published audio task: briefing=${task.briefingId} attempt=${task.attempt} triggeredBy=${task.triggeredBy}`,
  );
}

export async function publishAudioRetry(
  task: AudioGenerationTask,
  delayMs: number,
): Promise<void> {
  const ch = await createChannel();
  ch.publish(AUDIO_RETRY_EXCHANGE, "", Buffer.from(JSON.stringify(task)), {
    persistent: true,
    expiration: String(delayMs),
  });
  console.log(
    `[Queue] Published audio retry: briefing=${task.briefingId} nextAttempt=${task.attempt} delayMs=${delayMs}`,
  );
}
