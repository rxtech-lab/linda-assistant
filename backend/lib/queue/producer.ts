import { createChannel } from "./connection";
import { AGENT_TASKS_QUEUE, AGENT_EVENTS_EXCHANGE, type AgentTask, type AgentEvent } from "./types";

export async function publishTask(task: AgentTask): Promise<void> {
  const ch = await createChannel();
  ch.sendToQueue(AGENT_TASKS_QUEUE, Buffer.from(JSON.stringify(task)), {
    persistent: true,
  });
  console.log(`[Queue] Published task: session=${task.sessionId} type=${task.type}`);
}

export async function publishEvent(event: AgentEvent): Promise<void> {
  const ch = await createChannel();
  const routingKey = `session.${event.sessionId}`;
  ch.publish(AGENT_EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)));
}
