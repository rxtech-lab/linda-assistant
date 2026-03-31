import fs from "fs";
import path from "path";

const WORKER_PID_FILE = path.resolve(__dirname, "..", "e2e-worker.pid");
const CELERY_MOCK_PID_FILE = path.resolve(__dirname, "..", "e2e-celery-mock.pid");
const MCP_MOCK_PID_FILE = path.resolve(__dirname, "..", "e2e-mcp-mock.pid");

function killPidFile(pidFile: string) {
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
    try {
      // Kill the process group (negative PID) since processes are spawned with detached: true
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        // Fallback to killing just the process
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited
      }
    }
    fs.unlinkSync(pidFile);
  }
}

export default async function globalTeardown() {
  // Kill worker process
  killPidFile(WORKER_PID_FILE);

  // Kill Celery mock server
  killPidFile(CELERY_MOCK_PID_FILE);

  // Kill MCP mock server
  killPidFile(MCP_MOCK_PID_FILE);

  // Clean up test DB
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}
