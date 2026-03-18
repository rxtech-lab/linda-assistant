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

      // All timezone results should have approximately the same totals
      // (small differences possible if parallel tests generate usage between queries)
      const [first, ...rest] = results;
      const TOKEN_TOLERANCE = 0.01; // 1% tolerance
      for (let i = 0; i < rest.length; i++) {
        const inputRatio = Math.abs(rest[i]!.total.inputTokens - first!.total.inputTokens) / Math.max(first!.total.inputTokens, 1);
        expect(
          inputRatio,
          `days=${days} tz=${tzOffsets[i + 1]} inputTokens differ by ${(inputRatio * 100).toFixed(2)}%`,
        ).toBeLessThan(TOKEN_TOLERANCE);
        const outputRatio = Math.abs(rest[i]!.total.outputTokens - first!.total.outputTokens) / Math.max(first!.total.outputTokens, 1);
        expect(
          outputRatio,
          `days=${days} tz=${tzOffsets[i + 1]} outputTokens differ by ${(outputRatio * 100).toFixed(2)}%`,
        ).toBeLessThan(TOKEN_TOLERANCE);
        const costRatio = Math.abs(rest[i]!.total.costUsd - first!.total.costUsd) / Math.max(first!.total.costUsd, 0.001);
        expect(
          costRatio,
          `days=${days} tz=${tzOffsets[i + 1]} costUsd differ by ${(costRatio * 100).toFixed(2)}%`,
        ).toBeLessThan(TOKEN_TOLERANCE);
      }
    }
  });
});
