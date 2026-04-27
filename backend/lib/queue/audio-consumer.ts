import { createChannel } from "./connection";
import { AUDIO_TASKS_QUEUE, type AudioGenerationTask } from "./audio-types";

export async function consumeAudioTasks(
  handler: (task: AudioGenerationTask) => Promise<void>,
  options: { prefetch?: number } = {},
): Promise<void> {
  const ch = await createChannel();
  await ch.prefetch(options.prefetch ?? 2);

  await ch.consume(
    AUDIO_TASKS_QUEUE,
    async (msg) => {
      if (!msg) return;

      try {
        const task: AudioGenerationTask = JSON.parse(msg.content.toString());
        await handler(task);
        ch.ack(msg);
      } catch (error) {
        console.error("[AudioWorker] Task handler error:", error);
        // Always ack — the handler owns retry orchestration. Letting the
        // message stay unacked would cause RabbitMQ to redeliver immediately
        // (no backoff) and bypass the retry counter.
        ch.ack(msg);
      }
    },
    { noAck: false },
  );
}
