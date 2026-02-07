import { test, expect } from "@playwright/test";
import {
  deviceResponseSchema,
  deleteResponseSchema,
  errorResponseSchema,
} from "./helpers/schemas";

const user2Headers = { "x-test-user-id": "e2e-user-2" };

test.describe("Devices CRUD", () => {
  let deviceId: string;

  test("POST /api/devices creates a device", async ({ request }) => {
    const res = await request.post("/api/devices", {
      data: {
        deviceToken: "test-apns-token-abc123",
        platform: "ios",
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    deviceResponseSchema.parse(body);
    expect(body.data).toMatchObject({
      deviceToken: "test-apns-token-abc123",
      platform: "ios",
    });
    expect(body.data.id).toBeTruthy();
    expect(body.data.userId).toBe("e2e-test-user");
    deviceId = body.data.id;
  });

  test("POST /api/devices rejects invalid platform", async ({ request }) => {
    const res = await request.post("/api/devices", {
      data: {
        deviceToken: "token",
        platform: "android",
      },
    });
    expect(res.status()).toBe(422);
  });

  test("DELETE /api/devices/:id removes the device", async ({ request }) => {
    const res = await request.delete(`/api/devices/${deviceId}`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    deleteResponseSchema.parse(body);
    expect(body.data.deleted).toBe(true);
  });

  test("DELETE non-existing device returns 404", async ({ request }) => {
    const res = await request.delete("/api/devices/nonexistent-device-123");
    expect(res.status()).toBe(404);
    const body = await res.json();
    errorResponseSchema.parse(body);
    expect(body.error).toBe("Device not found");
  });
});

test.describe("Devices cross-user isolation", () => {
  let user1DeviceId: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.post("/api/devices", {
      data: { deviceToken: "user1-device-token", platform: "ios" },
    });
    const body = await res.json();
    user1DeviceId = body.data.id;
  });

  test("user2 cannot DELETE user1 device", async ({ request }) => {
    const res = await request.delete(`/api/devices/${user1DeviceId}`, {
      headers: user2Headers,
    });
    expect(res.status()).toBe(404);
  });
});
