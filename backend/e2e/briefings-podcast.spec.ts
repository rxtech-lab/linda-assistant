import { createClient } from "@libsql/client";
import { expect, test } from "@playwright/test";
import { nanoid } from "nanoid";
import path from "path";
import { generateBriefingPodcastResponseSchema } from "../lib/schemas";

const dbPath = path.resolve(__dirname, "..", "e2e-test.db");
const userId = "e2e-test-user";

async function insertBriefing(opts: {
  podcastStatus: "pending" | "generating" | "ready" | "failed";
  podcastUrl?: string | null;
}): Promise<string> {
  const id = nanoid();
  const client = createClient({ url: `file:${dbPath}` });
  await client.execute({
    sql: `INSERT INTO briefings (id, user_id, title, content, podcast_status, podcast_url)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      userId,
      "Test Briefing",
      "# Hello",
      opts.podcastStatus,
      opts.podcastUrl ?? null,
    ],
  });
  client.close();
  return id;
}

test.describe("POST /api/briefings/[id]/podcast", () => {
  test("returns 'queued' for a pending briefing and matches the response schema", async ({
    request,
  }) => {
    const briefingId = await insertBriefing({ podcastStatus: "pending" });

    const res = await request.post(`/api/briefings/${briefingId}/podcast`);
    expect(res.status()).toBe(202);

    const body = await res.json();
    // Schema parse — ensures iOS/OpenAPI contract holds. If this drifts, iOS decode breaks.
    generateBriefingPodcastResponseSchema.parse(body);
    expect(body.status).toBe("queued");
    expect(body.briefingId).toBe(briefingId);
    expect(body.podcastUrl).toBeNull();
  });

  test("returns 'ready' with the existing url when podcast already exists", async ({
    request,
  }) => {
    const url = "https://example.com/test-podcast.mp3";
    const briefingId = await insertBriefing({
      podcastStatus: "ready",
      podcastUrl: url,
    });

    const res = await request.post(`/api/briefings/${briefingId}/podcast`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    generateBriefingPodcastResponseSchema.parse(body);
    expect(body.status).toBe("ready");
    expect(body.briefingId).toBe(briefingId);
    expect(body.podcastUrl).toBe(url);
  });

  test("returns 'already_running' when generation is in flight", async ({ request }) => {
    const briefingId = await insertBriefing({ podcastStatus: "generating" });

    const res = await request.post(`/api/briefings/${briefingId}/podcast`);
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    generateBriefingPodcastResponseSchema.parse(body);
    expect(body.status).toBe("already_running");
    expect(body.briefingId).toBe(briefingId);
    expect(body.podcastUrl).toBeNull();
  });

  test("retriggers a failed briefing and returns 'queued'", async ({ request }) => {
    const briefingId = await insertBriefing({ podcastStatus: "failed" });

    const res = await request.post(`/api/briefings/${briefingId}/podcast`);
    expect(res.status()).toBe(202);

    const body = await res.json();
    generateBriefingPodcastResponseSchema.parse(body);
    expect(body.status).toBe("queued");
  });

  test("returns 404 for a non-existent briefing", async ({ request }) => {
    const res = await request.post(`/api/briefings/${nanoid()}/podcast`);
    expect(res.status()).toBe(404);
  });

  test("does not leak briefings across users", async ({ request }) => {
    const briefingId = await insertBriefing({ podcastStatus: "pending" });

    const res = await request.post(`/api/briefings/${briefingId}/podcast`, {
      headers: { "x-test-user-id": "e2e-user-2" },
    });
    expect(res.status()).toBe(404);
  });
});
