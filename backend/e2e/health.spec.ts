import { test, expect } from "@playwright/test";
import { healthResponseSchema } from "./helpers/schemas";

test.describe("Health API", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    healthResponseSchema.parse(body);
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeTruthy();
  });
});
