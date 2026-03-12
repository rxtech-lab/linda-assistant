import fs from "fs";
import path from "path";

const WORKER_PID_FILE = path.resolve(__dirname, "..", "e2e-worker.pid");
const CELERY_MOCK_PID_FILE = path.resolve(__dirname, "..", "e2e-celery-mock.pid");

function killPidFile(pidFile: string) {
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }
    fs.unlinkSync(pidFile);
  }
}

export default async function globalTeardown() {
  // Kill worker process
  killPidFile(WORKER_PID_FILE);

  // Kill Celery mock server
  killPidFile(CELERY_MOCK_PID_FILE);

  // Clean up test DB
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}
