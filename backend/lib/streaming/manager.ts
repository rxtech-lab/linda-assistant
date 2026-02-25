import { redis } from "@/lib/redis";

const CHUNK_KEY = (sessionId: string) => `stream:chunks:${sessionId}`;
const ACTIVE_KEY = (sessionId: string) => `stream:active:${sessionId}`;
const CHUNK_TTL = 60 * 60; // 1 hour

export async function appendStreamChunk(sessionId: string, chunk: string) {
  await redis.rpush(CHUNK_KEY(sessionId), chunk);
  await redis.expire(CHUNK_KEY(sessionId), CHUNK_TTL);
}

export async function getStreamChunks(sessionId: string): Promise<string[]> {
  return (await redis.lrange(CHUNK_KEY(sessionId), 0, -1)) as string[];
}

export async function clearStreamChunks(sessionId: string) {
  await redis.del(CHUNK_KEY(sessionId));
}

export async function setStreamActive(sessionId: string, active: boolean) {
  if (active) {
    await redis.set(ACTIVE_KEY(sessionId), "1", { ex: 300 });
  } else {
    await redis.del(ACTIVE_KEY(sessionId));
  }
}

export async function isStreamActive(sessionId: string): Promise<boolean> {
  const val = await redis.get(ACTIVE_KEY(sessionId));
  return val === "1";
}
