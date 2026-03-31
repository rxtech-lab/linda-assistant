import Redis from "ioredis";

let _redis: Redis | undefined;

function createRedis(): Redis | null {
  if (!process.env.REDIS_URL) return null;
  if (!_redis) {
    _redis = new Redis(process.env.REDIS_URL);
  }
  return _redis;
}

/**
 * Ping Redis to verify connectivity. Returns true if connected, false if using in-memory fallback.
 * Throws if REDIS_URL is set but the connection fails.
 */
export async function pingRedis(): Promise<boolean> {
  const instance = createRedis();
  if (!instance) return false;
  const result = await instance.ping();
  if (result !== "PONG") throw new Error(`Redis ping failed: ${result}`);
  return true;
}

// In-memory fallback for E2E
const memoryStore = new Map<string, string | string[]>();

export const redis = new Proxy({} as Redis, {
  get(_, prop) {
    const instance = createRedis();
    if (instance) return (instance as any)[prop];

    switch (prop) {
      case "get":
        return (key: string) => memoryStore.get(key) ?? null;
      case "set":
        return (key: string, value: string) => {
          memoryStore.set(key, value);
          return "OK";
        };
      case "del":
        return (key: string) => {
          memoryStore.delete(key);
          return 1;
        };
      case "rpush":
        return (key: string, value: string) => {
          const list = (memoryStore.get(key) as string[]) ?? [];
          list.push(value);
          memoryStore.set(key, list);
          return list.length;
        };
      case "lrange":
        return (key: string) => (memoryStore.get(key) as string[]) ?? [];
      case "incr":
        return (key: string) => {
          const current = parseInt((memoryStore.get(key) as string) ?? "0", 10);
          const next = current + 1;
          memoryStore.set(key, String(next));
          return next;
        };
      case "expire":
        return () => 1;
      case "flushdb":
        return () => {
          memoryStore.clear();
          return "OK";
        };
      default:
        return () => null;
    }
  },
});
