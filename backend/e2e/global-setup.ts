import { createClient } from "@libsql/client";
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import amqplib from "amqplib";
import Redis from "ioredis";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const WORKER_PID_FILE = path.resolve(__dirname, "..", "e2e-worker.pid");
const CELERY_MOCK_PID_FILE = path.resolve(__dirname, "..", "e2e-celery-mock.pid");
const MCP_MOCK_PID_FILE = path.resolve(__dirname, "..", "e2e-mcp-mock.pid");

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
  const redis = new Redis("redis://localhost:6379");
  await redis.flushdb();
  await redis.quit();

  // Purge RabbitMQ queue to clear stale tasks from previous runs
  const mqUrl = "amqp://linda:linda@localhost:5672";
  const conn = await amqplib.connect(mqUrl);
  const ch = await conn.createChannel();
  await ch.assertQueue("agent-tasks", { durable: true });
  await ch.purgeQueue("agent-tasks");
  await ch.assertExchange("agent-commands", "topic", { durable: true });
  await ch.close();
  await conn.close();

  // Create MinIO bucket for S3 tests
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: "http://localhost:9000",
    forcePathStyle: true,
    credentials: {
      accessKeyId: "minioadmin",
      secretAccessKey: "minioadmin",
    },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: "e2e-test" }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: "e2e-test" }));
  }

  // Allow public reads so downloadAndUploadToS3 can fetch test fixtures
  await s3.send(
    new PutBucketPolicyCommand({
      Bucket: "e2e-test",
      Policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: "arn:aws:s3:::e2e-test/*",
          },
        ],
      }),
    }),
  );

  // Upload a tiny 1x1 PNG so the Resend mock attachment download_url works
  const testPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  await s3.send(
    new PutObjectCommand({
      Bucket: "e2e-test",
      Key: "test-fixtures/test-image.png",
      Body: testPng,
      ContentType: "image/png",
    }),
  );

  // Start Celery mock server — detached so CI signals don't kill it
  const celeryMock = spawn("bun", ["e2e/helpers/celery-mock-server.ts"], {
    cwd: path.resolve(__dirname, ".."),
    detached: true,
    env: { ...process.env, CELERY_MOCK_PORT: "8099" },
    stdio: "pipe",
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Celery mock startup timeout")), 10000);
    celeryMock.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes("celery-mock-ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    celeryMock.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[celery-mock:err] ${data.toString()}`);
    });
    celeryMock.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    celeryMock.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Celery mock exited with code ${code}`));
      }
    });
  });

  celeryMock.unref();
  fs.writeFileSync(CELERY_MOCK_PID_FILE, String(celeryMock.pid));

  // Start MCP mock server — detached so CI signals don't kill it
  const mcpMock = spawn("bun", ["e2e/helpers/mcp-mock-server.ts"], {
    cwd: path.resolve(__dirname, ".."),
    detached: true,
    env: { ...process.env, MCP_MOCK_PORT: "8098" },
    stdio: "pipe",
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MCP mock startup timeout")), 10000);
    mcpMock.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes("mcp-mock-ready")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    mcpMock.stderr?.on("data", (data: Buffer) => {
      process.stderr.write(`[mcp-mock:err] ${data.toString()}`);
    });
    mcpMock.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    mcpMock.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`MCP mock exited with code ${code}`));
      }
    });
  });

  mcpMock.unref();
  fs.writeFileSync(MCP_MOCK_PID_FILE, String(mcpMock.pid));

  // Start worker process — detached so CI process-group signals don't kill it
  const worker = spawn("bun", ["worker/index.ts"], {
    cwd: path.resolve(__dirname, ".."),
    detached: true,
    env: {
      ...process.env,
      IS_E2E: "true",
      TURSO_DATABASE_URL: `file:${dbPath}`,
      RABBITMQ_URL: "amqp://linda:linda@localhost:5672",
      REDIS_URL: "redis://localhost:6379",
      AWS_ACCESS_KEY_ID: "minioadmin",
      AWS_SECRET_ACCESS_KEY: "minioadmin",
      AWS_REGION: "us-east-1",
      S3_API_URL: "http://localhost:9000",
      S3_BUCKET_NAME: "e2e-test",
      S3_PUBLIC_URL: "http://localhost:9000/e2e-test",
      E2E_MCP_URL: "http://localhost:8098",
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

  // Allow the parent process to exit independently while keeping the worker alive
  worker.unref();

  // Save PID for teardown
  fs.writeFileSync(WORKER_PID_FILE, String(worker.pid));
}
