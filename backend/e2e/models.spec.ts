import { test, expect } from "@playwright/test";
import { modelsResponseSchema } from "./helpers/schemas";

test.describe("Models API", () => {
  test("GET /api/models returns available models", async ({ request }) => {
    const res = await request.get("/api/models");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    modelsResponseSchema.parse(body);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
  });

  test("GET /api/models requires auth", async ({ request }) => {
    const res = await request.fetch("/api/models", {
      headers: { authorization: "" },
    });
    expect(res.status()).toBe(401);
  });
});
