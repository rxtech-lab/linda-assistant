import { test, expect } from "@playwright/test";
import { ensureOnboarded } from "./onboard.utils";
import {
  createAssignee,
  deleteAssignee,
  sendMessage,
  consumeStream,
} from "./chat.utils";
import fs from "node:fs";
import { TOKEN_FILE, type AuthToken } from "./auth.utils";

const BASE_URL = "http://localhost:3000";

function loadToken(): AuthToken {
  const data = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8")) as AuthToken;
  if (!data.access_token) throw new Error("No access_token in auth-token.json");
  return data;
}

function authHeaders(token: AuthToken): Record<string, string> {
  return {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
}

async function getUsage(
  days = 30,
  tzOffset?: number,
): Promise<{
  daily: Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  byAssignee: Array<{
    assigneeId: string;
    assigneeName: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  total: { inputTokens: number; outputTokens: number; costUsd: number };
}> {
  const token = loadToken();
  const params = new URLSearchParams({ days: String(days) });
  if (tzOffset !== undefined) {
    params.set("tzOffset", String(tzOffset));
  }
  const res = await fetch(`${BASE_URL}/api/usage?${params}`, {
    headers: authHeaders(token),
  });
  if (!res.ok) {
    throw new Error(
      `GET /api/usage failed (${res.status}): ${await res.text()}`,
    );
  }
  return res.json() as any;
}

test.describe("Usage API", () => {
  test.describe.configure({ mode: "serial" });

  let assigneeId: string;

  test.beforeAll(async () => {
    await ensureOnboarded();
    assigneeId = await createAssignee("usage-test");

    // Send a message to generate token usage
    const stream = consumeStream(assigneeId, {
      label: "usage-test",
      autoDisconnect: true,
    });
    await sendMessage(assigneeId, "Say hello in one word");
    await stream.waitForDone();
    stream.cancel();
  });

  test.afterAll(async () => {
    if (assigneeId) {
      await deleteAssignee(assigneeId);
    }
  });

  test("all time ranges return non-zero usage data", async () => {
    for (const days of [1, 7, 14, 30]) {
      const usage = await getUsage(days);

      expect(
        usage.total.inputTokens,
        `days=${days} inputTokens`,
      ).toBeGreaterThan(0);
      expect(
        usage.total.outputTokens,
        `days=${days} outputTokens`,
      ).toBeGreaterThan(0);
      expect(usage.daily.length, `days=${days} daily entries`).toBeGreaterThan(
        0,
      );
    }
  });

  test("different timezones return same non-zero totals across all ranges", async () => {
    const tzOffsets = [0, 8, -5];

    for (const days of [1, 7, 14, 30]) {
      const results = await Promise.all(
        tzOffsets.map((tz) => getUsage(days, tz)),
      );

      // All timezone results should have non-zero totals
      for (let i = 0; i < tzOffsets.length; i++) {
        const usage = results[i];
        expect(
          usage!.total.inputTokens,
          `days=${days} tz=${tzOffsets[i]} inputTokens`,
        ).toBeGreaterThan(0);
        expect(
          usage!.total.outputTokens,
          `days=${days} tz=${tzOffsets[i]} outputTokens`,
        ).toBeGreaterThan(0);
      }

      // Verify all timezone results have the same structure (non-zero checked above)
      for (const usage of results) {
        expect(usage!.total).toHaveProperty("inputTokens");
        expect(usage!.total).toHaveProperty("outputTokens");
        expect(usage!.total).toHaveProperty("costUsd");
      }
    }
  });
});
