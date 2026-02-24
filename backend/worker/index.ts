import { createServer } from "node:http";
import { runAgent } from "@/lib/ai/agent";
import { closeConnection, isConnected, setupTopology } from "@/lib/queue/connection";
import { consumeTasks } from "@/lib/queue/consumer";
import { publishEvent } from "@/lib/queue/producer";
import { notifySessionResponse } from "@/lib/utils/chat-session";
import type { AgentTask } from "@/lib/queue/types";
import { isStreamActive } from "@/lib/streaming/manager";

async function handleTask(task: AgentTask): Promise<void> {
  const { sessionId, userId } = task;
  console.log(`[Worker] Processing task: session=${sessionId} type=${task.type}`);

  // Check if another worker is already handling this session
  const active = await isStreamActive(sessionId);
  if (active) {
    console.log(`[Worker] Session ${sessionId} already active, skipping`);
    return;
  }

  let responseText = "";

  try {
    await runAgent({
      sessionId,
      userId,
      onEvent: async (event, data) => {
        // Collect text for push notification
        if (event === "text-delta" && typeof (data as Record<string, unknown>)?.text === "string") {
          responseText += (data as { text: string }).text;
        }

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

  // Send push notification if the agent generated a text response
  if (responseText.trim()) {
    console.log(`[Worker] Sending push for session=${sessionId} responseText=${responseText.length} chars`);
    try {
      await notifySessionResponse(sessionId, userId, responseText);
    } catch (pushError) {
      console.error(`[Worker] Push notification failed for session ${sessionId}:`, pushError);
    }
  } else {
    console.log(`[Worker] No text response for session=${sessionId}, skipping push notification`);
  }

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
