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

// Seed a chat session for briefing data
await client.execute({
  sql: `INSERT OR IGNORE INTO chat_sessions (id, user_id, assignee_id, title, status) VALUES (?, ?, ?, ?, ?)`,
  args: [
    "e2e-briefing-session",
    "e2e-test-user",
    "e2e-assignee",
    "Briefing Seed Session",
    "stopped",
  ],
});

// Seed sample documents linked to briefings
await client.execute({
  sql: `INSERT OR IGNORE INTO documents (id, user_id, chat_session_id, title, format, content) VALUES (?, ?, ?, ?, ?, ?)`,
  args: [
    "e2e-doc-1",
    "e2e-test-user",
    "e2e-briefing-session",
    "Q1 Revenue Analysis",
    "markdown",
    "## Revenue Summary\n\nTotal revenue for Q1 was $2.3M, up 15% from last quarter.",
  ],
});
await client.execute({
  sql: `INSERT OR IGNORE INTO documents (id, user_id, chat_session_id, title, format, content) VALUES (?, ?, ?, ?, ?, ?)`,
  args: [
    "e2e-doc-2",
    "e2e-test-user",
    "e2e-briefing-session",
    "Weekly Team Updates",
    "markdown",
    "## Team Updates — Week 12\n\n**Engineering:** Shipped v2.4 with performance improvements.",
  ],
});

// Seed sample briefings
await client.execute({
  sql: `INSERT OR IGNORE INTO briefings (id, user_id, chat_session_id, assignee_id, title, content) VALUES (?, ?, ?, ?, ?, ?)`,
  args: [
    "e2e-briefing-1",
    "e2e-test-user",
    "e2e-briefing-session",
    "e2e-assignee",
    "Morning Briefing: Market Overview",
    "## Market Summary\n\nMarkets opened slightly higher today with tech leading gains.\n\n### Key Points\n\n- **Tech sector** continues its recovery\n- **Interest rates** remain steady\n\n### Your Action Items\n\n1. Review the Q1 revenue analysis\n2. Prepare talking points for the board meeting",
  ],
});
await client.execute({
  sql: `INSERT OR IGNORE INTO briefings (id, user_id, chat_session_id, assignee_id, title, content) VALUES (?, ?, ?, ?, ?, ?)`,
  args: [
    "e2e-briefing-2",
    "e2e-test-user",
    "e2e-briefing-session",
    "e2e-assignee",
    "Weekly Digest: Team Progress & Goals",
    "## This Week's Highlights\n\nThe team made significant progress across all departments.\n\n### Engineering\n- Shipped 12 PRs, closing 8 tickets\n- Performance improvements reduced API latency by 40%",
  ],
});

// Link documents to briefings
await client.execute({
  sql: `INSERT OR IGNORE INTO briefing_documents (id, briefing_id, document_id) VALUES (?, ?, ?)`,
  args: ["e2e-bd-1", "e2e-briefing-1", "e2e-doc-1"],
});
await client.execute({
  sql: `INSERT OR IGNORE INTO briefing_documents (id, briefing_id, document_id) VALUES (?, ?, ?)`,
  args: ["e2e-bd-2", "e2e-briefing-2", "e2e-doc-2"],
});
console.log("  Seeded briefings with linked documents");

client.close();
console.log("E2E dev DB ready.");
