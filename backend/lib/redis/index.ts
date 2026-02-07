import { Redis } from "@upstash/redis";

let _redis: Redis | undefined;

export const redis = new Proxy({} as Redis, {
  get(_, prop) {
    if (!_redis) {
      _redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      });
    }
    return (_redis as any)[prop];
  },
});
