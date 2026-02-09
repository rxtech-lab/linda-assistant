import fs from "fs";
import path from "path";

const WORKER_PID_FILE = path.resolve(__dirname, "..", "e2e-worker.pid");

export default async function globalTeardown() {
  // Kill worker process
  if (fs.existsSync(WORKER_PID_FILE)) {
    const pid = parseInt(fs.readFileSync(WORKER_PID_FILE, "utf-8"), 10);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }
    fs.unlinkSync(WORKER_PID_FILE);
  }

  // Clean up test DB
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}
