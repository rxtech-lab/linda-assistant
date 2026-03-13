import { redis } from "@/lib/redis";

const CHUNK_KEY = (sessionId: string) => `stream:chunks:${sessionId}`;
const SEQ_KEY = (sessionId: string) => `stream:seq:${sessionId}`;
const ACTIVE_KEY = (sessionId: string) => `stream:active:${sessionId}`;
const CHUNK_TTL = 60 * 60; // 1 hour

export async function appendStreamChunk(sessionId: string, chunk: string) {
  console.log(
    `[StreamManager] session=${sessionId} appendChunk len=${chunk.length}`,
  );
  await redis.rpush(CHUNK_KEY(sessionId), chunk);
  await redis.expire(CHUNK_KEY(sessionId), CHUNK_TTL);
}

export async function getStreamChunks(sessionId: string): Promise<unknown[]> {
  const chunks = (await redis.lrange(
    CHUNK_KEY(sessionId),
    0,
    -1,
  )) as unknown[];
  console.log(
    `[StreamManager] session=${sessionId} getChunks count=${chunks.length}`,
  );
  return chunks;
}

export async function clearStreamChunks(sessionId: string) {
  console.log(`[StreamManager] session=${sessionId} clearChunks`);
  await redis.del(CHUNK_KEY(sessionId), SEQ_KEY(sessionId));
}

export async function nextSeq(sessionId: string): Promise<number> {
  const seq = await redis.incr(SEQ_KEY(sessionId));
  await redis.expire(SEQ_KEY(sessionId), CHUNK_TTL);
  console.log(`[StreamManager] session=${sessionId} nextSeq=${seq}`);
  return seq;
}

export async function setStreamActive(sessionId: string, active: boolean) {
  console.log(
    `[StreamManager] session=${sessionId} setActive=${active}`,
  );
  if (active) {
    await redis.set(ACTIVE_KEY(sessionId), "1", { ex: 300 });
  } else {
    await redis.del(ACTIVE_KEY(sessionId));
  }
}

export async function isStreamActive(sessionId: string): Promise<boolean> {
  const val = await redis.get(ACTIVE_KEY(sessionId));
  const active = val === "1";
  console.log(
    `[StreamManager] session=${sessionId} isActive=${active}`,
  );
  return active;
}
