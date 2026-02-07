import fs from "fs";
import path from "path";

export default async function globalTeardown() {
  const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
}
