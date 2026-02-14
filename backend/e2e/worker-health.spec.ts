import { expect, test } from "@playwright/test";

const WORKER_HEALTH_URL = "http://localhost:3002/healthz";
const RABBITMQ_API = "http://localhost:15672/api";
const RABBITMQ_AUTH = `Basic ${Buffer.from("linda:linda").toString("base64")}`;

test.describe("Worker Health Check", () => {
  test("GET /healthz returns 200 when RabbitMQ is connected", async () => {
    const res = await fetch(WORKER_HEALTH_URL);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  test("GET unknown path returns 404", async () => {
    const res = await fetch("http://localhost:3002/unknown");
    expect(res.status).toBe(404);
  });

  test("GET /healthz returns 503 after RabbitMQ connection is closed", async () => {
    // Verify healthy first
    const healthyRes = await fetch(WORKER_HEALTH_URL);
    expect(healthyRes.status).toBe(200);

    // List connections via RabbitMQ management API
    const connRes = await fetch(`${RABBITMQ_API}/connections`, {
      headers: { Authorization: RABBITMQ_AUTH },
    });
    expect(connRes.ok).toBeTruthy();
    const connections: { name: string }[] = await connRes.json();
    expect(connections.length).toBeGreaterThan(0);

    // Close all connections to simulate broker disconnection
    for (const conn of connections) {
      await fetch(`${RABBITMQ_API}/connections/${encodeURIComponent(conn.name)}`, {
        method: "DELETE",
        headers: { Authorization: RABBITMQ_AUTH },
      });
    }

    // Wait for connection close events to propagate
    await new Promise((r) => setTimeout(r, 1000));

    // Health check should now return 503
    const unhealthyRes = await fetch(WORKER_HEALTH_URL);
    expect(unhealthyRes.status).toBe(503);
    expect(await unhealthyRes.text()).toBe("not ready");
  });
});
