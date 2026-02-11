import { createClient } from "@libsql/client";
import amqplib from "amqplib";
import { Redis } from "@upstash/redis";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WORKER_PID_FILE = path.resolve(__dirname, "..", "e2e-worker.pid");

export default async function globalSetup() {
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

  // Clean up old test DB
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const client = createClient({ url: `file:${dbPath}` });

  // Read and execute all migration SQL files in lexicographic order
  const drizzleDir = path.resolve(__dirname, "..", "drizzle");
  const sqlFiles = fs
    .readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of sqlFiles) {
    const sqlContent = fs.readFileSync(path.join(drizzleDir, file), "utf-8");
    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.execute(stmt);
    }
  }

  // Enable WAL mode for concurrent access from worker + Next.js server
  await client.execute("PRAGMA journal_mode=WAL");
  await client.execute("PRAGMA busy_timeout=5000");

  client.close();

  // Flush Redis to clear stale data from previous runs
  const redis = new Redis({
    url: "http://localhost:8079",
    token: "token",
  });
  await redis.flushdb();

  // Purge RabbitMQ queue to clear stale tasks from previous runs
  const mqUrl = "amqp://linda:linda@localhost:5672";
  const conn = await amqplib.connect(mqUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue("agent-tasks", { durable: true });
  await ch.purgeQueue("agent-tasks");
  await ch.close();
  await conn.close();

  // Start worker process
  const worker = spawn("bun", ["worker/index.ts"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      IS_E2E: "true",
      TURSO_DATABASE_URL: `file:${dbPath}`,
      RABBITMQ_URL: "amqp://linda:linda@localhost:5672",
      UPSTASH_REDIS_REST_URL: "http://localhost:8079",
      UPSTASH_REDIS_REST_TOKEN: "token",
    },
    stdio: "pipe",
  });

  // Wait for worker to be ready
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Worker startup timeout")), 15000);

    worker.stdout?.on("data", (data: Buffer) => {
      const line = data.toString();
      process.stdout.write(`[worker] ${line}`);
      if (line.includes("Consuming tasks")) {
        clearTimeout(timeout);
        resolve();
      }
    });

    worker.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[worker:err] ${data.toString()}`);
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    worker.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });

  // Save PID for teardown
  fs.writeFileSync(WORKER_PID_FILE, String(worker.pid));
}
