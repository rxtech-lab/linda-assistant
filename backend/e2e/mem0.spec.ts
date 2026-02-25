import { type APIResponse, expect, test } from "@playwright/test";

const MEM0_URL = process.env.MEM0_API_URL || "http://localhost:8000";
const TEST_USER_ID = "e2e-test-user";

async function isMem0Available(): Promise<boolean> {
	try {
		const res = await fetch(`${MEM0_URL}/`, { signal: AbortSignal.timeout(3_000) });
		return res.ok;
	} catch {
		return false;
	}
}

async function expectOk(res: APIResponse) {
	if (!res.ok()) {
		const body = await res.text();
		throw new Error(`${res.status()} ${res.statusText()}: ${body}`);
	}
}

test.describe("Mem0 API", () => {
	test.describe.configure({ mode: "serial" });

	test.beforeAll(async () => {
		test.skip(!(await isMem0Available()), "Mem0 server not reachable, skipping suite");
	});

	test("GET / health check", async ({ request }) => {
		const res = await request.get(`${MEM0_URL}/`);
		await expectOk(res);
		const body = await res.json();
		expect(body.message).toBe("Mem0 Server is running");
	});

	test("POST /memories → add memory", async ({ request }) => {
		const res = await request.post(`${MEM0_URL}/memories`, {
			data: {
				messages: [
					{ role: "user", content: "My favorite color is blue." },
					{
						role: "assistant",
						content: "Got it, your favorite color is blue!",
					},
				],
				user_id: TEST_USER_ID,
			},
		});
		await expectOk(res);
		const body = await res.json();
		expect(body.results).toBeDefined();
	});

	test("POST /search → search memories", async ({ request }) => {
		const res = await request.post(`${MEM0_URL}/search`, {
			data: {
				query: "favorite color",
				user_id: TEST_USER_ID,
				limit: 5,
			},
		});
		await expectOk(res);
		const body = await res.json();
		expect(body.results).toBeDefined();
		expect(Array.isArray(body.results)).toBe(true);
	});

	test("GET /memories → list memories", async ({ request }) => {
		const res = await request.get(
			`${MEM0_URL}/memories?user_id=${TEST_USER_ID}`,
		);
		await expectOk(res);
		const body = await res.json();
		expect(body.results).toBeDefined();
		expect(Array.isArray(body.results)).toBe(true);
		expect(body.results.length).toBeGreaterThan(0);
	});

	test("GET /memories/:id → get single memory", async ({ request }) => {
		const listRes = await request.get(
			`${MEM0_URL}/memories?user_id=${TEST_USER_ID}`,
		);
		const list = await listRes.json();
		const memoryId = list.results[0]?.id;
		expect(memoryId).toBeDefined();

		const res = await request.get(`${MEM0_URL}/memories/${memoryId}`);
		await expectOk(res);
		const body = await res.json();
		expect(body.id).toBe(memoryId);
	});

	test("PUT /memories/:id → update memory", async ({ request }) => {
		const listRes = await request.get(
			`${MEM0_URL}/memories?user_id=${TEST_USER_ID}`,
		);
		const list = await listRes.json();
		const memoryId = list.results[0]?.id;
		expect(memoryId).toBeDefined();

		const res = await request.put(`${MEM0_URL}/memories/${memoryId}`, {
			data: { data: "My favorite color is green." },
		});
		await expectOk(res);
	});

	test("DELETE /memories/:id → delete single memory", async ({ request }) => {
		const addRes = await request.post(`${MEM0_URL}/memories`, {
			data: {
				messages: [
					{ role: "user", content: "I like pineapple on pizza." },
				],
				user_id: TEST_USER_ID,
			},
		});
		await expectOk(addRes);
		const added = await addRes.json();
		const memoryId = added.results?.[0]?.id;

		if (memoryId) {
			const res = await request.delete(
				`${MEM0_URL}/memories/${memoryId}`,
			);
			await expectOk(res);
		}
	});

	test("DELETE /memories → cleanup test user memories", async ({
		request,
	}) => {
		const res = await request.delete(
			`${MEM0_URL}/memories?user_id=${TEST_USER_ID}`,
		);
		await expectOk(res);

		const listRes = await request.get(
			`${MEM0_URL}/memories?user_id=${TEST_USER_ID}`,
		);
		const body = await listRes.json();
		expect(body.results.length).toBe(0);
	});
});
