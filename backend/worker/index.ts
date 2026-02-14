import { createServer } from "node:http";
import { setupTopology, closeConnection, isConnected } from "@/lib/queue/connection";
import { consumeTasks } from "@/lib/queue/consumer";
import { publishEvent } from "@/lib/queue/producer";
import { runAgent } from "@/lib/ai/agent";
import { isStreamActive } from "@/lib/streaming/manager";
import type { AgentTask } from "@/lib/queue/types";

async function handleTask(task: AgentTask): Promise<void> {
  const { sessionId, userId } = task;
  console.log(`[Worker] Processing task: session=${sessionId} type=${task.type}`);

  // Check if another worker is already handling this session
  const active = await isStreamActive(sessionId);
  if (active) {
    console.log(`[Worker] Session ${sessionId} already active, skipping`);
    return;
  }

  try {
    await runAgent({
      sessionId,
      userId,
      onEvent: async (event, data) => {
        // Publish to RabbitMQ for live SSE subscribers
        await publishEvent({
          sessionId,
          event,
          data: data as object,
          timestamp: Date.now(),
        });
      },
      // No signal — run to completion
    });
  } catch (error) {
    console.error(`[Worker] Agent error for session ${sessionId}:`, error);
    // Agent already saves partial state to DB
  }

  console.log(`[Worker] Task complete: session=${sessionId}`);
}

// Simple HTTP health check for k8s liveness/readiness probes
let healthy = false;
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || "3002", 10);

const healthServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    if (healthy && !shuttingDown && isConnected()) {
      res.writeHead(200).end("ok");
    } else {
      res.writeHead(503).end("not ready");
    }
  } else {
    res.writeHead(404).end("not found");
  }
}).listen(HEALTH_PORT);

async function main() {
  console.log("[Worker] Starting...");

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
