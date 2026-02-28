import { test, expect, type APIRequestContext } from "@playwright/test";
import { consumeSSE } from "./helpers/sse-client";
import {
	assigneeResponseSchema,
	chatSessionResponseSchema,
	sendMessageResponseSchema,
} from "./helpers/schemas";

async function waitForStatus(
	request: APIRequestContext,
	sessionId: string,
	status: string,
	timeoutMs = 15000,
) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const res = await request.get(`/api/chat-sessions/${sessionId}`);
		const body = await res.json();
		if (body.status === status) return body;
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(
		`Timeout: session ${sessionId} did not reach status "${status}"`,
	);
}

/** Send a message and wait for the agent to finish processing */
async function sendAndWait(
	request: APIRequestContext,
	sessionId: string,
	content: string,
) {
	const res = await request.post(
		`/api/chat-sessions/${sessionId}/messages`,
		{ data: { content } },
	);
	expect(res.ok()).toBeTruthy();
	sendMessageResponseSchema.parse(await res.json());
	await waitForStatus(request, sessionId, "stopped");
}

/** Small delay to ensure SSE subscription is established before posting */
const SUB_DELAY = 200;

test.describe("Compaction", () => {
	let assigneeId: string;

	test.beforeAll(async ({ request }) => {
		const res = await request.post("/api/assignees", {
			data: {
				name: "Compaction Test Assistant",
				email: "compaction-test@example.com",
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		assigneeResponseSchema.parse(body);
		assigneeId = body.id;
	});

	test("compaction triggers and emits compacting event after many messages", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// E2E context window is 500 tokens, threshold = 500 * 0.75 = 375 tokens.
		// Use short messages during buildup to stay well under threshold (~10 tokens/round trip).
		// Then use a long trigger message to push past the threshold.

		// Build up message history without SSE subscription
		for (let i = 0; i < 8; i++) {
			await sendAndWait(request, sessionId, `hi ${i}`);
		}

		// Verify we have accumulated messages
		const msgsBefore = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsBeforeBody = await msgsBefore.json();
		expect(msgsBeforeBody.messages.length).toBeGreaterThanOrEqual(16); // 8 user + 8 assistant

		// Subscribe to SSE BEFORE sending the message that should trigger compaction
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 30000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		// This long message should push total tokens past the 375-token threshold
		const longContent = "A".repeat(1500); // ~375 tokens, well over remaining budget
		const msgRes = await request.post(
			`/api/chat-sessions/${sessionId}/messages`,
			{ data: { content: `${longContent} trigger compaction` } },
		);
		expect(msgRes.ok()).toBeTruthy();
		sendMessageResponseSchema.parse(await msgRes.json());

		const events = await eventsPromise;
		const eventTypes = events.map((e) => e.event);

		// Should see the compacting event
		expect(eventTypes).toContain("compacting");

		// Should still complete successfully
		expect(eventTypes).toContain("done");

		// Verify messages in DB still contain old messages (compaction preserves history)
		const msgsAfter = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsAfterBody = await msgsAfter.json();
		// After compaction: old messages (compacted) + summary + recent messages + new user + new assistant
		// Total should be >= before + 2 (at least the new user message, new assistant response, and summary)
		expect(msgsAfterBody.messages.length).toBeGreaterThanOrEqual(
			msgsBeforeBody.messages.length + 2,
		);

		// Verify that compacted messages are marked with isCompacted flag
		const compactedMsgs = msgsAfterBody.messages.filter(
			(m: { isCompacted?: boolean }) => m.isCompacted === true,
		);
		expect(compactedMsgs.length).toBeGreaterThan(0);

		// Non-compacted messages should include the summary and recent messages
		const activeMsgs = msgsAfterBody.messages.filter(
			(m: { isCompacted?: boolean }) => !m.isCompacted,
		);
		expect(activeMsgs.length).toBeGreaterThan(0);

		// Verify that all messages have a seq number
		for (const msg of msgsAfterBody.messages) {
			expect(typeof msg.seq).toBe("number");
		}

		// Session should be stopped
		const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
		const statusBody = await statusRes.json();
		expect(statusBody.status).toBe("stopped");
	});

	test("session detail endpoint returns all messages including compacted", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// Build up message history
		for (let i = 0; i < 8; i++) {
			await sendAndWait(request, sessionId, `hello ${i}`);
		}

		const msgsBeforeRes = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsBeforeBody = await msgsBeforeRes.json();
		const messageCountBefore = msgsBeforeBody.messages.length;

		// Subscribe to SSE and trigger compaction
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 30000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		const longContent = "B".repeat(1500);
		const msgRes = await request.post(
			`/api/chat-sessions/${sessionId}/messages`,
			{ data: { content: `${longContent} trigger` } },
		);
		expect(msgRes.ok()).toBeTruthy();

		const events = await eventsPromise;
		expect(events.map((e) => e.event)).toContain("compacting");

		// GET /api/chat-sessions/:id should return messages including compacted ones
		const detailRes = await request.get(`/api/chat-sessions/${sessionId}`);
		expect(detailRes.ok()).toBeTruthy();
		const detailBody = await detailRes.json();

		// The session detail endpoint should include messages
		expect(detailBody.messages).toBeDefined();
		expect(detailBody.messages.length).toBeGreaterThanOrEqual(
			messageCountBefore + 2,
		);

		// Should contain both compacted and non-compacted messages
		const compactedInDetail = detailBody.messages.filter(
			(m: { isCompacted?: boolean }) => m.isCompacted === true,
		);
		const activeInDetail = detailBody.messages.filter(
			(m: { isCompacted?: boolean }) => !m.isCompacted,
		);
		expect(compactedInDetail.length).toBeGreaterThan(0);
		expect(activeInDetail.length).toBeGreaterThan(0);
	});

	test("agent works correctly after compaction on subsequent messages", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// Build up history and trigger compaction
		for (let i = 0; i < 8; i++) {
			await sendAndWait(request, sessionId, `msg ${i}`);
		}

		// Trigger compaction
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 30000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		const longContent = "C".repeat(1500);
		await request.post(`/api/chat-sessions/${sessionId}/messages`, {
			data: { content: `${longContent} trigger` },
		});

		const events = await eventsPromise;
		expect(events.map((e) => e.event)).toContain("compacting");
		expect(events.map((e) => e.event)).toContain("done");

		// Now send a normal follow-up message AFTER compaction
		const followUpPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 15000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		const followUpRes = await request.post(
			`/api/chat-sessions/${sessionId}/messages`,
			{ data: { content: "Follow-up after compaction" } },
		);
		expect(followUpRes.ok()).toBeTruthy();

		const followUpEvents = await followUpPromise;
		const followUpTypes = followUpEvents.map((e) => e.event);

		// Agent should respond normally
		expect(followUpTypes).toContain("text-delta");
		expect(followUpTypes).toContain("done");

		// Should NOT have errors
		const errorEvents = followUpEvents.filter((e) => e.event === "error");
		expect(errorEvents).toHaveLength(0);

		// Session should be stopped
		const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
		const statusBody = await statusRes.json();
		expect(statusBody.status).toBe("stopped");
	});

	test("agent responds without error to oversized message", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// Subscribe to SSE
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 30000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		// Send a very large message that exceeds the E2E context window (500 tokens = ~2000 chars)
		const hugeContent = "The quick brown fox ".repeat(200); // ~4000 chars ≈ 1000 tokens
		const msgRes = await request.post(
			`/api/chat-sessions/${sessionId}/messages`,
			{ data: { content: hugeContent } },
		);
		expect(msgRes.ok()).toBeTruthy();
		sendMessageResponseSchema.parse(await msgRes.json());

		const events = await eventsPromise;
		const eventTypes = events.map((e) => e.event);

		// Should get a compacting event (oversized message handling)
		expect(eventTypes).toContain("compacting");

		// Should still get a response without error
		expect(eventTypes).toContain("text-delta");
		expect(eventTypes).toContain("done");

		// Should NOT contain an error event
		const errorEvents = events.filter((e) => e.event === "error");
		expect(errorEvents).toHaveLength(0);

		// Session should be stopped (not errored)
		const statusRes = await request.get(`/api/chat-sessions/${sessionId}`);
		const statusBody = await statusRes.json();
		expect(statusBody.status).toBe("stopped");

		// Original message should be preserved in DB (not truncated)
		const msgsRes = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsBody = await msgsRes.json();
		expect(msgsBody.messages.length).toBeGreaterThanOrEqual(2);
		const userMsg = msgsBody.messages.find(
			(m: { role: string }) => m.role === "user",
		);
		expect(userMsg).toBeDefined();
	});

	test("normal messages work without compaction when under threshold", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// Subscribe to SSE
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		// Send a short message — should NOT trigger compaction
		const msgRes = await request.post(
			`/api/chat-sessions/${sessionId}/messages`,
			{ data: { content: "Hi" } },
		);
		expect(msgRes.ok()).toBeTruthy();
		sendMessageResponseSchema.parse(await msgRes.json());

		const events = await eventsPromise;
		const eventTypes = events.map((e) => e.event);

		// Should NOT see compacting event for short messages
		expect(eventTypes).not.toContain("compacting");

		// Should still work normally
		expect(eventTypes).toContain("text-delta");
		expect(eventTypes).toContain("done");

		// Messages should not be marked as compacted
		const msgsRes = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsBody = await msgsRes.json();
		for (const msg of msgsBody.messages) {
			expect(msg.isCompacted).toBe(false);
		}
	});

	test("paginated messages endpoint returns compacted messages", async ({
		request,
		baseURL,
	}) => {
		// Create session
		const sessionRes = await request.post("/api/chat-sessions", {
			data: { assigneeId },
		});
		expect(sessionRes.ok()).toBeTruthy();
		const session = await sessionRes.json();
		chatSessionResponseSchema.parse(session);
		const sessionId = session.id;

		// Build up history and trigger compaction
		for (let i = 0; i < 8; i++) {
			await sendAndWait(request, sessionId, `page ${i}`);
		}

		// Trigger compaction
		const eventsPromise = consumeSSE(
			`${baseURL}/api/chat-sessions/${sessionId}/stream`,
			{
				headers: { authorization: "Bearer e2e-test-token" },
				timeoutMs: 30000,
			},
		);
		await new Promise((r) => setTimeout(r, SUB_DELAY));

		const longContent = "D".repeat(1500);
		await request.post(`/api/chat-sessions/${sessionId}/messages`, {
			data: { content: `${longContent} trigger` },
		});

		const events = await eventsPromise;
		expect(events.map((e) => e.event)).toContain("compacting");

		// Fetch all messages via paginated endpoint
		const msgsRes = await request.get(
			`/api/chat-sessions/${sessionId}/messages`,
		);
		const msgsBody = await msgsRes.json();

		// Should contain both compacted and non-compacted messages
		const compactedMsgs = msgsBody.messages.filter(
			(m: { isCompacted?: boolean }) => m.isCompacted === true,
		);
		const activeMsgs = msgsBody.messages.filter(
			(m: { isCompacted?: boolean }) => !m.isCompacted,
		);
		expect(compactedMsgs.length).toBeGreaterThan(0);
		expect(activeMsgs.length).toBeGreaterThan(0);

		// Verify messages are in seq order
		const seqs = msgsBody.messages.map((m: { seq: number }) => m.seq);
		for (let i = 1; i < seqs.length; i++) {
			expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
		}

		// Paginate with smaller limit to test cursor works with compacted messages
		const page1Res = await request.get(
			`/api/chat-sessions/${sessionId}/messages?limit=5`,
		);
		const page1Body = await page1Res.json();
		expect(page1Body.messages.length).toBe(5);
		expect(page1Body.nextCursor).toBeTruthy();

		// Load next page
		const page2Res = await request.get(
			`/api/chat-sessions/${sessionId}/messages?limit=5&before=${page1Body.nextCursor}`,
		);
		const page2Body = await page2Res.json();
		expect(page2Body.messages.length).toBeGreaterThan(0);

		// Pages should not overlap
		const page1Ids = page1Body.messages.map((m: { id: string }) => m.id);
		const page2Ids = page2Body.messages.map((m: { id: string }) => m.id);
		for (const id of page1Ids) {
			expect(page2Ids).not.toContain(id);
		}
	});
});
