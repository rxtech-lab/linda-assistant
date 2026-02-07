import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import * as relations from "./relations";

let _db: ReturnType<typeof drizzle> | undefined;

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    if (!_db) {
      const client = createClient({
        url: process.env.TURSO_DATABASE_URL!,
        authToken: process.env.TURSO_AUTH_TOKEN,
      });
      _db = drizzle(client, { schema: { ...schema, ...relations } });
    }
    return (_db as any)[prop];
  },
});
