import { Redis } from "@upstash/redis";

class MockRedis {
  private store = new Map<string, string>();
  private lists = new Map<string, string[]>();

  async set(key: string, value: string, _opts?: { ex?: number }) {
    this.store.set(key, value);
    return "OK";
  }

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async del(key: string) {
    this.store.delete(key);
    this.lists.delete(key);
    return 1;
  }

  async rpush(key: string, ...values: string[]) {
    const list = this.lists.get(key) ?? [];
    list.push(...values);
    this.lists.set(key, list);
    return list.length;
  }

  async lrange(key: string, start: number, stop: number) {
    const list = this.lists.get(key) ?? [];
    const end = stop === -1 ? list.length : stop + 1;
    return list.slice(start, end);
  }

  async expire(_key: string, _seconds: number) {
    return 1;
  }
}

let _redis: Redis | undefined;
let _mockRedis: MockRedis | undefined;

function createRedis(): Redis | MockRedis {
  if (process.env.IS_E2E) {
    if (!_mockRedis) _mockRedis = new MockRedis();
    return _mockRedis;
  }
  if (!_redis) {
    _redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
  }
  return _redis;
}

export const redis = new Proxy({} as Redis, {
  get(_, prop) {
    const instance = createRedis();
    return (instance as any)[prop];
  },
});
