import amqplib, { type Channel, type ChannelModel } from "amqplib";
import { assertAudioTopology } from "./audio-producer";
import { AGENT_COMMANDS_EXCHANGE, AGENT_EVENTS_EXCHANGE, AGENT_TASKS_QUEUE } from "./types";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let topologyReady = false;
let reconnecting = false;

/** Callback invoked after a successful reconnection so the worker can re-register its consumer. */
let onReconnect: (() => Promise<void>) | null = null;

/**
 * Register a callback that fires after the RabbitMQ connection is
 * re-established (e.g. to re-consume the task queue).
 */
export function setReconnectHandler(handler: () => Promise<void>): void {
  onReconnect = handler;
}

async function reconnect(): Promise<void> {
  if (reconnecting) return;
  reconnecting = true;
  const maxRetries = 10;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[RabbitMQ] Reconnecting (attempt ${attempt}/${maxRetries})...`);
      // getConnection() will create a fresh connection since we nulled the old one
      await getConnection();
      await setupTopology();
      console.log("[RabbitMQ] Reconnected successfully");

      if (onReconnect) {
        await onReconnect();
      }

      reconnecting = false;
      return;
    } catch (err) {
      console.error(`[RabbitMQ] Reconnect attempt ${attempt} failed:`, (err as Error).message);
      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * 2 ** (attempt - 1), 30000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error("[RabbitMQ] All reconnect attempts failed, exiting");
  reconnecting = false;
  process.exit(1);
}

export async function getConnection(): Promise<ChannelModel> {
  if (connection) return connection;

  const url = process.env.RABBITMQ_URL || "amqp://linda:linda@localhost:5672";
  connection = await amqplib.connect(url);

  connection.on("error", (err: Error) => {
    console.error("[RabbitMQ] Connection error:", err.message);
    connection = null;
    channel = null;
    topologyReady = false;
  });

  connection.on("close", () => {
    console.log("[RabbitMQ] Connection closed");
    connection = null;
    channel = null;
    topologyReady = false;
    // Auto-reconnect on unexpected close (skip if shutting down gracefully)
    if (!closingGracefully) {
      reconnect();
    }
  });

  return connection;
}

export async function createChannel(): Promise<Channel> {
  if (channel) return channel;

  const conn = await getConnection();
  channel = await conn.createChannel();

  channel.on("error", (err: Error) => {
    console.error("[RabbitMQ] Channel error:", err.message);
    channel = null;
    topologyReady = false;
  });

  channel.on("close", () => {
    channel = null;
    topologyReady = false;
  });

  // Ensure topology exists on first channel creation
  if (!topologyReady) {
    await channel.assertQueue(AGENT_TASKS_QUEUE, { durable: true });
    await channel.assertExchange(AGENT_EVENTS_EXCHANGE, "topic", { durable: false });
    await channel.assertExchange(AGENT_COMMANDS_EXCHANGE, "topic", { durable: true });
    await assertAudioTopology(channel);
    topologyReady = true;
  }

  return channel;
}

export async function setupTopology(): Promise<void> {
  const ch = await createChannel();

  // Durable queue for agent task distribution
  await ch.assertQueue(AGENT_TASKS_QUEUE, { durable: true });

  // Topic exchange for real-time agent events
  await ch.assertExchange(AGENT_EVENTS_EXCHANGE, "topic", { durable: false });

  // Topic exchange for API→worker control commands (e.g. stop)
  await ch.assertExchange(AGENT_COMMANDS_EXCHANGE, "topic", { durable: true });

  // Audio generation queue + retry/DLX topology
  await assertAudioTopology(ch);
}

export async function isConnected(): Promise<boolean> {
  if (!connection || !channel) return false;
  try {
    await channel.checkQueue(AGENT_TASKS_QUEUE);
    return true;
  } catch (err) {
    console.warn("[RabbitMQ] Connection check failed:", (err as Error).message);
    return false;
  }
}

let closingGracefully = false;

export async function closeConnection(): Promise<void> {
  closingGracefully = true;
  if (channel) {
    try {
      await channel.close();
    } catch {
      // Already closed
    }
    channel = null;
  }
  if (connection) {
    try {
      await connection.close();
    } catch {
      // Already closed
    }
    connection = null;
  }
}
