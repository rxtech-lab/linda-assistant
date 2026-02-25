import { describe, test, expect } from "bun:test";
import type { ModelMessage } from "ai";
import { estimateTokenCount, getContextWindow, CONTEXT_WINDOW } from "./context";

// ── Helper to build ModelMessage ───────────────────────────────────────

function textMsg(role: "user" | "assistant", text: string): ModelMessage {
	return { role, content: [{ type: "text", text }] } as unknown as ModelMessage;
}

function toolCallMsg(toolName: string, input: Record<string, unknown>): ModelMessage {
	return {
		role: "assistant",
		content: [{ type: "tool-call", toolCallId: "tc-1", toolName, input }],
	} as unknown as ModelMessage;
}

function toolResultMsg(toolName: string, output: unknown): ModelMessage {
	return {
		role: "tool",
		content: [{ type: "tool-result", toolCallId: "tc-1", toolName, output }],
	} as unknown as ModelMessage;
}

// ── estimateTokenCount ─────────────────────────────────────────────────

describe("estimateTokenCount", () => {
	test("returns 0 for empty array", () => {
		expect(estimateTokenCount([])).toBe(0);
	});

	test("estimates simple text messages", () => {
		const msgs = [textMsg("user", "Hello world")]; // 11 chars + overhead
		const tokens = estimateTokenCount(msgs);
		// 11 chars text + 20 part overhead + 10 msg overhead = 41 chars / 4 = ~11 tokens
		expect(tokens).toBeGreaterThan(0);
		expect(tokens).toBeLessThan(20);
	});

	test("estimates tool-call messages", () => {
		const input = { title: "Test Task", description: "A test task" };
		const msgs = [toolCallMsg("create_task", input)];
		const tokens = estimateTokenCount(msgs);
		expect(tokens).toBeGreaterThan(0);
	});

	test("estimates tool-result messages", () => {
		const output = { id: "task-1", title: "Test Task" };
		const msgs = [toolResultMsg("create_task", output)];
		const tokens = estimateTokenCount(msgs);
		expect(tokens).toBeGreaterThan(0);
	});

	test("handles string content messages", () => {
		const msg: ModelMessage = { role: "user", content: "Hello world" } as unknown as ModelMessage;
		const tokens = estimateTokenCount([msg]);
		expect(tokens).toBeGreaterThan(0);
	});

	test("scales with message count", () => {
		const oneMsg = [textMsg("user", "Hello")];
		const tenMsgs = Array.from({ length: 10 }, (_, i) =>
			textMsg("user", `Message ${i}`),
		);
		expect(estimateTokenCount(tenMsgs)).toBeGreaterThan(
			estimateTokenCount(oneMsg),
		);
	});

	test("scales with message length", () => {
		const short = [textMsg("user", "Hi")];
		const long = [textMsg("user", "A".repeat(10000))];
		expect(estimateTokenCount(long)).toBeGreaterThan(
			estimateTokenCount(short) * 10,
		);
	});

	test("handles mixed content types", () => {
		const msgs: ModelMessage[] = [
			textMsg("user", "Hello"),
			toolCallMsg("create_task", { title: "Test" }),
			toolResultMsg("create_task", { id: "1" }),
			textMsg("assistant", "Done!"),
		];
		const tokens = estimateTokenCount(msgs);
		expect(tokens).toBeGreaterThan(0);
	});
});

// ── getContextWindow ───────────────────────────────────────────────────

describe("getContextWindow", () => {
	test("returns CONTEXT_WINDOW in non-E2E environment", () => {
		const original = process.env.IS_E2E;
		delete process.env.IS_E2E;
		expect(getContextWindow()).toBe(CONTEXT_WINDOW);
		if (original !== undefined) process.env.IS_E2E = original;
	});

	test("returns 500 in E2E environment", () => {
		const original = process.env.IS_E2E;
		process.env.IS_E2E = "true";
		expect(getContextWindow()).toBe(500);
		if (original !== undefined) {
			process.env.IS_E2E = original;
		} else {
			delete process.env.IS_E2E;
		}
	});
});
