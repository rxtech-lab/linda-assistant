import { Redis } from "@upstash/redis";

let _redis: Redis | undefined;

function createRedis(): Redis | null {
  if (process.env.IS_E2E === "true") return null;

  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
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
      case "expire":
        return () => 1;
      default:
        return () => null;
    }
  },
});
