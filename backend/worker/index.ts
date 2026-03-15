import { createServer } from "node:http";
import { runAgent } from "@/lib/ai/agent";
import { closeConnection, isConnected, setupTopology } from "@/lib/queue/connection";
import { consumeTasks, subscribeToCommands, type CommandSubscription } from "@/lib/queue/consumer";
import { publishEvent } from "@/lib/queue/producer";
import type { AgentTask } from "@/lib/queue/types";
import { clearStreamChunks, isStreamActive } from "@/lib/streaming/manager";
import { notifySessionResponse } from "@/lib/utils/chat-session";

async function handleTask(task: AgentTask): Promise<void> {
  const { sessionId, userId } = task;
  console.log(`[Worker] Processing task: session=${sessionId} type=${task.type}`);

  // Check if another worker is already handling this session
  const active = await isStreamActive(sessionId);
  if (active) {
    console.log(`[Worker] Session ${sessionId} already active, skipping`);
    return;
  }

  // Clear cached stream chunks from any previous run so replay starts fresh
  await clearStreamChunks(sessionId);

  const controller = new AbortController();
  let commandSub: CommandSubscription | null = null;

  try {
    // Subscribe to stop commands BEFORE starting agent to avoid race conditions
    commandSub = await subscribeToCommands(sessionId, (command) => {
      if (command.type === "stop") {
        console.log(`[Worker] Stop command received for session ${sessionId}`);
        controller.abort();
      }
    });

    let responseText = "";

    await runAgent({
      sessionId,
      userId,
      taskType: task.type,
      signal: controller.signal,
      onEvent: async (event, data) => {
        // Stop emitting events immediately after abort
        if (controller.signal.aborted) return;

        // Collect text for push notification
        if (event === "text-delta" && typeof (data as Record<string, unknown>)?.text === "string") {
          responseText += (data as { text: string }).text;
        }

        // Log non-text events for debugging SSE delivery
        if (event !== "text-delta") {
          console.log(`[Worker] SSE event: session=${sessionId} event=${event}`);
        }

        // Publish to RabbitMQ for live SSE subscribers
        await publishEvent({
          sessionId,
          event,
          data: data as object,
          timestamp: Date.now(),
        });
      },
    });

    // Skip push notification if the stream was aborted
    if (!controller.signal.aborted && responseText.trim()) {
      console.log(
        `[Worker] Sending push for session=${sessionId} responseText=${responseText.length} chars`,
      );
      try {
        await notifySessionResponse(sessionId, userId, responseText);
      } catch (pushError) {
        console.error(`[Worker] Push notification failed for session ${sessionId}:`, pushError);
      }
    } else if (!controller.signal.aborted) {
      console.log(`[Worker] No text response for session=${sessionId}, skipping push notification`);
    }
  } catch (error) {
    if (controller.signal.aborted) {
      console.log(`[Worker] Agent aborted for session ${sessionId}`);
    } else {
      console.error(`[Worker] Agent error for session ${sessionId}:`, error);
    }
    // Agent already saves partial state to DB
  } finally {
    await commandSub?.close();
  }

  // Clear cached stream chunks so late connectors don't replay stale events
  await clearStreamChunks(sessionId);

  console.log(`[Worker] Task complete: session=${sessionId}`);
}

// Simple HTTP health check for k8s liveness/readiness probes
let healthy = false;
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3002", 10);

const healthServer = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    try {
      if (healthy && !shuttingDown && (await isConnected())) {
        res.writeHead(200).end("ok");
      } else {
        res.writeHead(503).end("not ready");
      }
    } catch {
      res.writeHead(503).end("not ready");
    }
  } else {
    res.writeHead(404).end("not found");
  }
}).listen(HEALTH_PORT);

async function main() {
  console.log("[Worker] Starting...");
  console.log(
    "[Worker] MEM0_API_URL:",
    process.env.MEM0_API_URL || "(not set, default: http://mem0:8000)",
  );

  await setupTopology();
  console.log("[Worker] Connected to RabbitMQ, topology ready");

  await consumeTasks(handleTask, { prefetch: 5 });
  console.log("[Worker] Consuming tasks from agent-tasks queue");

  healthy = true;
  console.log(`[Worker] Health check listening on :${HEALTH_PORT}/healthz`);
}

// Graceful shutdown
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[Worker] Shutting down...");
  healthServer.close();
  closeConnection().then(() => {
    console.log("[Worker] Disconnected");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});
