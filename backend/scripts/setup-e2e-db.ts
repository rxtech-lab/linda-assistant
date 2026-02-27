/**
 * Initialize the E2E dev database by running all Drizzle migration SQL files.
 * Always recreates the DB from scratch to ensure a clean state.
 */

import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const dbPath = path.resolve(__dirname, "..", "e2e-dev.db");

// Always clean up old DB
for (const suffix of ["", "-shm", "-wal"]) {
  const p = dbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

console.log(`Creating E2E dev DB at ${dbPath}...`);
const client = createClient({ url: `file:${dbPath}` });

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
  console.log(`  Applied: ${file}`);
}

// Enable WAL mode for concurrent access from worker + Next.js server
await client.execute("PRAGMA journal_mode=WAL");
await client.execute("PRAGMA busy_timeout=5000");

// Seed a default assignee for E2E dev testing
await client.execute({
  sql: `INSERT OR IGNORE INTO assignees (id, user_id, name, email) VALUES (?, ?, ?, ?)`,
  args: ["e2e-assignee", "e2e-test-user", "Linda", "linda@e2e.test"],
});
console.log("  Seeded default assignee: e2e-assignee");

client.close();
console.log("E2E dev DB ready.");
