import { test, expect } from "@playwright/test";
import { z } from "zod";
import { errorResponseSchema } from "./helpers/schemas";

const onboardResponseSchema = z.object({
  assignee: z.object({
    check: z.boolean(),
    required: z.array(z.string()).optional(),
  }),
  overall: z.boolean(),
});

const freshUserHeaders = { "x-test-user-id": "e2e-onboard-fresh" };

test.describe("Onboard API", () => {
  test("unauthenticated request returns 401", async ({ request }) => {
    const res = await request.fetch("/api/onboard", {
      headers: { authorization: "" },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    errorResponseSchema.parse(body);
  });

  test("new user with no assignees returns 400", async ({ request }) => {
    const res = await request.get("/api/onboard", {
      headers: freshUserHeaders,
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    onboardResponseSchema.parse(body);
    expect(body.overall).toBe(false);
    expect(body.assignee.check).toBe(false);
    expect(body.assignee.required).toContain("assignee:create");
  });

  test("user with assignee returns 200", async ({ request }) => {
    // Create an assignee first
    const createRes = await request.post("/api/assignees", {
      headers: freshUserHeaders,
      data: {
        name: "Onboard Test",
        email: "onboard@example.com",
      },
    });
    expect(createRes.status()).toBe(201);

    const res = await request.get("/api/onboard", {
      headers: freshUserHeaders,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    onboardResponseSchema.parse(body);
    expect(body.overall).toBe(true);
    expect(body.assignee.check).toBe(true);
    expect(body.assignee.required).toBeUndefined();
  });
});
