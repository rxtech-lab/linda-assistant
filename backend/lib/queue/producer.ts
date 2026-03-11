import { appendStreamChunk, nextSeq } from "@/lib/streaming/manager";
import { createChannel } from "./connection";
import {
  AGENT_COMMANDS_EXCHANGE,
  AGENT_EVENTS_EXCHANGE,
  AGENT_TASKS_QUEUE,
  type AgentCommand,
  type AgentEvent,
  type AgentTask,
} from "./types";

export async function publishTask(task: AgentTask): Promise<void> {
  const ch = await createChannel();
  ch.sendToQueue(AGENT_TASKS_QUEUE, Buffer.from(JSON.stringify(task)), {
    persistent: true,
  });
  console.log(`[Queue] Published task: session=${task.sessionId} type=${task.type}`);
}

export async function publishEvent(event: AgentEvent): Promise<void> {
  // Assign monotonic sequence number and cache in Redis for replay
  event.seq = await nextSeq(event.sessionId);
  await appendStreamChunk(event.sessionId, JSON.stringify(event));

  const ch = await createChannel();
  const routingKey = `session.${event.sessionId}`;
  ch.publish(AGENT_EVENTS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(event)));
}

export async function publishStopCommand(sessionId: string): Promise<void> {
  const ch = await createChannel();
  const command: AgentCommand = { type: "stop", sessionId, timestamp: Date.now() };
  const routingKey = `session.${sessionId}`;
  ch.publish(AGENT_COMMANDS_EXCHANGE, routingKey, Buffer.from(JSON.stringify(command)));
  console.log(`[Queue] Published stop command: session=${sessionId}`);
}
