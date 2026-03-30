import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import * as relations from "./relations";

let _db: ReturnType<typeof drizzle> | undefined;

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    if (!_db) {
      const url = process.env.TURSO_DATABASE_URL!;
      const client = createClient({
        url,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      // For local file-based SQLite, enable WAL mode and busy timeout
      // to avoid SQLITE_BUSY when multiple processes access the DB.
      if (url.startsWith("file:")) {
        client.execute("PRAGMA journal_mode=WAL").catch(() => {});
        client.execute("PRAGMA busy_timeout=5000").catch(() => {});
      }
      _db = drizzle(client, { schema: { ...schema, ...relations } });
    }
    return (_db as any)[prop];
  },
});
