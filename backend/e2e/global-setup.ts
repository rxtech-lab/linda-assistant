import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

export default async function globalSetup() {
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");

  // Clean up old test DB
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  const client = createClient({ url: `file:${dbPath}` });

  // Read migration SQL
  const sqlPath = path.resolve(__dirname, "..", "drizzle", "0000_gray_tarantula.sql");
  const sqlContent = fs.readFileSync(sqlPath, "utf-8");

  // Split by statement breakpoint and execute each CREATE TABLE
  const statements = sqlContent
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await client.execute(stmt);
  }

  client.close();
}
