import { createChannel, getConnection } from "./connection";
import { AGENT_TASKS_QUEUE, AGENT_EVENTS_EXCHANGE, type AgentTask, type AgentEvent } from "./types";

export async function consumeTasks(
  handler: (task: AgentTask) => Promise<void>,
  options: { prefetch?: number } = {},
): Promise<void> {
  const ch = await createChannel();
  await ch.prefetch(options.prefetch ?? 5);

  await ch.consume(
    AGENT_TASKS_QUEUE,
    async (msg) => {
      if (!msg) return;

      try {
        const task: AgentTask = JSON.parse(msg.content.toString());
        await handler(task);
        ch.ack(msg);
      } catch (error) {
        console.error("[Worker] Task handler error:", error);
        // Ack anyway — agent saves partial state to DB
        ch.ack(msg);
      }
    },
    { noAck: false },
  );
}

export interface EventSubscription {
  close: () => Promise<void>;
}

export async function subscribeToEvents(
  sessionId: string,
  handler: (event: AgentEvent) => void,
): Promise<EventSubscription> {
  // Each subscription gets its own channel to avoid interference
  const conn = await getConnection();
  const ch = await conn.createChannel();
  const routingKey = `session.${sessionId}`;

  // Ensure exchange exists
  await ch.assertExchange(AGENT_EVENTS_EXCHANGE, "topic", { durable: false });

  // Create exclusive auto-delete queue for this SSE connection
  const { queue } = await ch.assertQueue("", {
    exclusive: true,
    autoDelete: true,
  });

  await ch.bindQueue(queue, AGENT_EVENTS_EXCHANGE, routingKey);

  const { consumerTag } = await ch.consume(
    queue,
    (msg) => {
      if (!msg) return;
      try {
        const event: AgentEvent = JSON.parse(msg.content.toString());
        handler(event);
      } catch (error) {
        console.error("[Consumer] Failed to parse event:", error);
      }
    },
    { noAck: true },
  );

  return {
    close: async () => {
      try {
        await ch.cancel(consumerTag);
        await ch.close();
      } catch {
        // Channel may already be closed
      }
    },
  };
}
