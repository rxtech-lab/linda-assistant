import { Redis } from "@upstash/redis";

let _redis: Redis | undefined;

function createRedis(): Redis {
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
