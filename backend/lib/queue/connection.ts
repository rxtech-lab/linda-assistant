import amqplib, { type ChannelModel, type Channel } from "amqplib";
import { AGENT_TASKS_QUEUE, AGENT_EVENTS_EXCHANGE } from "./types";

let connection: ChannelModel | null = null;
let channel: Channel | null = null;
let topologyReady = false;

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

export async function closeConnection(): Promise<void> {
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
