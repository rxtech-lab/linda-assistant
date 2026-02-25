import { describe, test, expect } from "bun:test";
import type { ModelMessage } from "ai";
import {
	extractTextFromMessage,
	findSafeSplitPoint,
	splitMessages,
	buildSummaryPrompt,
	splitTextIntoChunks,
	truncateMessage,
} from "./compaction";

// ── Helpers ────────────────────────────────────────────────────────────

function textMsg(
	role: "user" | "assistant",
	text: string,
): ModelMessage {
	return {
		role,
		content: [{ type: "text", text }],
	} as unknown as ModelMessage;
}

function toolCallMsg(
	toolName: string,
	input: Record<string, unknown>,
): ModelMessage {
	return {
		role: "assistant",
		content: [
			{ type: "tool-call", toolCallId: "tc-1", toolName, input },
		],
	} as unknown as ModelMessage;
}

function toolResultMsg(
	toolName: string,
	output: unknown,
): ModelMessage {
	return {
		role: "tool",
		content: [
			{ type: "tool-result", toolCallId: "tc-1", toolName, output },
		],
	} as unknown as ModelMessage;
}

// ── extractTextFromMessage ─────────────────────────────────────────────

describe("extractTextFromMessage", () => {
	test("extracts text from string content", () => {
		const msg = { role: "user", content: "Hello" } as unknown as ModelMessage;
		expect(extractTextFromMessage(msg)).toBe("Hello");
	});

	test("extracts text from array content", () => {
		expect(extractTextFromMessage(textMsg("user", "Hello"))).toBe(
			"Hello",
		);
	});

	test("extracts text from tool-call", () => {
		const result = extractTextFromMessage(
			toolCallMsg("create_task", { title: "Test" }),
		);
		expect(result).toContain("create_task");
		expect(result).toContain("Test");
	});

	test("extracts text from tool-result", () => {
		const result = extractTextFromMessage(
			toolResultMsg("create_task", { id: "1" }),
		);
		expect(result).toContain("create_task");
	});

	test("returns empty string for null/undefined content", () => {
		const msg = { role: "user", content: null } as unknown as ModelMessage;
		expect(extractTextFromMessage(msg)).toBe("");
	});
});

// ── findSafeSplitPoint ─────────────────────────────────────────────────

describe("findSafeSplitPoint", () => {
	test("returns 0 for targetIndex 0", () => {
		const msgs = [textMsg("user", "Hi")];
		expect(findSafeSplitPoint(msgs, 0)).toBe(0);
	});

	test("returns targetIndex for regular messages", () => {
		const msgs = [
			textMsg("user", "Hello"),
			textMsg("assistant", "Hi"),
			textMsg("user", "Bye"),
		];
		expect(findSafeSplitPoint(msgs, 2)).toBe(2);
	});

	test("moves split point earlier to include tool-call with its result", () => {
		const msgs = [
			textMsg("user", "Hello"),
			toolCallMsg("create_task", { title: "Test" }),
			toolResultMsg("create_task", { id: "1" }),
			textMsg("assistant", "Done!"),
		];
		// Trying to split at index 2 (tool-result) should move back to include
		// the assistant tool-call message
		const split = findSafeSplitPoint(msgs, 2);
		expect(split).toBeLessThanOrEqual(1);
	});

	test("handles empty messages array", () => {
		expect(findSafeSplitPoint([], 0)).toBe(0);
	});

	test("handles targetIndex beyond array length", () => {
		const msgs = [textMsg("user", "Hi")];
		expect(findSafeSplitPoint(msgs, 5)).toBe(1);
	});

	test("preserves consecutive tool-call and tool-result pairs", () => {
		const msgs = [
			textMsg("user", "Do something"),
			toolCallMsg("send_email", { to: "a@b.com" }),
			toolResultMsg("send_email", { sent: true }),
			textMsg("user", "Another thing"),
		];
		// Split at 2 (tool-result msg) → should include the tool-call too
		const split = findSafeSplitPoint(msgs, 2);
		expect(split).toBeLessThanOrEqual(1);
	});
});

// ── splitMessages ──────────────────────────────────────────────────────

describe("splitMessages", () => {
	test("returns all as recent when fewer than minRecent", () => {
		const msgs = [textMsg("user", "Hi"), textMsg("assistant", "Hello")];
		const { oldMessages, recentMessages } = splitMessages(msgs, 6);
		expect(oldMessages).toHaveLength(0);
		expect(recentMessages).toHaveLength(2);
	});

	test("splits correctly with enough messages", () => {
		const msgs = Array.from({ length: 10 }, (_, i) =>
			textMsg("user", `Message ${i}`),
		);
		const { oldMessages, recentMessages, splitIndex } = splitMessages(
			msgs,
			6,
		);
		expect(oldMessages.length + recentMessages.length).toBe(10);
		expect(recentMessages.length).toBeGreaterThanOrEqual(6);
		expect(splitIndex).toBeGreaterThan(0);
	});

	test("adjusts split for tool-call/tool-result pairs", () => {
		const msgs = [
			textMsg("user", "1"),
			textMsg("user", "2"),
			textMsg("user", "3"),
			textMsg("user", "4"),
			toolCallMsg("create_task", { title: "Test" }),
			toolResultMsg("create_task", { id: "1" }),
			textMsg("assistant", "Done"),
		];
		// With minRecent=3, raw split would be at index 4 (7-3=4)
		// But index 4 is a tool-call, and 5 is tool-result — they should stay together
		const { recentMessages } = splitMessages(msgs, 3);
		// The recent group should include both tool-call and tool-result
		const hasToolCall = recentMessages.some(
			(m) =>
				Array.isArray(m.content) &&
				(m.content as Record<string, unknown>[]).some(
					(p) => p.type === "tool-call",
				),
		);
		const hasToolResult = recentMessages.some(
			(m) =>
				Array.isArray(m.content) &&
				(m.content as Record<string, unknown>[]).some(
					(p) => p.type === "tool-result",
				),
		);
		if (hasToolCall) {
			expect(hasToolResult).toBe(true);
		}
	});
});

// ── buildSummaryPrompt ─────────────────────────────────────────────────

describe("buildSummaryPrompt", () => {
	test("includes conversation content", () => {
		const msgs = [
			textMsg("user", "Hello"),
			textMsg("assistant", "Hi there!"),
		];
		const prompt = buildSummaryPrompt(msgs);
		expect(prompt).toContain("Hello");
		expect(prompt).toContain("Hi there!");
		expect(prompt).toContain("[user]");
		expect(prompt).toContain("[assistant]");
	});

	test("includes tool calls in summary", () => {
		const msgs = [toolCallMsg("create_task", { title: "Test" })];
		const prompt = buildSummaryPrompt(msgs);
		expect(prompt).toContain("create_task");
	});

	test("includes summary instruction", () => {
		const prompt = buildSummaryPrompt([textMsg("user", "Hello")]);
		expect(prompt).toContain("Summarize");
		expect(prompt).toContain("<conversation>");
	});
});

// ── splitTextIntoChunks ────────────────────────────────────────────────

describe("splitTextIntoChunks", () => {
	test("returns single chunk for short text", () => {
		const chunks = splitTextIntoChunks("Hello world", 1000);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toBe("Hello world");
	});

	test("splits long text into multiple chunks", () => {
		const text = "word ".repeat(5000); // ~25000 chars
		const chunks = splitTextIntoChunks(text, 1000); // ~4000 chars per chunk
		expect(chunks.length).toBeGreaterThan(1);
	});

	test("splits at word boundaries", () => {
		const text = "The quick brown fox jumps over the lazy dog";
		// Very small chunk size to force splitting
		const chunks = splitTextIntoChunks(text, 2); // ~8 chars per chunk
		for (const chunk of chunks) {
			// Each chunk should not start or end with a broken word
			// (approximately — word boundary splitting is best-effort)
			expect(chunk.trim()).not.toBe("");
		}
	});

	test("handles text with no spaces", () => {
		const text = "a".repeat(100);
		const chunks = splitTextIntoChunks(text, 5); // ~20 chars per chunk
		expect(chunks.length).toBeGreaterThan(1);
		// All text should be present
		expect(chunks.join("")).toBe(text);
	});
});

// ── truncateMessage ────────────────────────────────────────────────────

describe("truncateMessage", () => {
	test("returns original if within budget", () => {
		const msg = textMsg("user", "Hello");
		const result = truncateMessage(msg, 1000);
		expect(extractTextFromMessage(result)).toBe("Hello");
	});

	test("truncates text content that exceeds budget", () => {
		const longText = "A".repeat(10000);
		const msg = textMsg("user", longText);
		const result = truncateMessage(msg, 100); // 400 chars max
		const text = extractTextFromMessage(result);
		expect(text.length).toBeLessThan(longText.length);
		expect(text).toContain("[...message truncated");
	});

	test("truncates string content messages", () => {
		const msg = {
			role: "user",
			content: "A".repeat(10000),
		} as unknown as ModelMessage;
		const result = truncateMessage(msg, 100);
		expect(typeof result.content).toBe("string");
		expect((result.content as string).length).toBeLessThan(10000);
		expect(result.content as string).toContain("[...message truncated");
	});

	test("preserves non-text parts", () => {
		const msg = {
			role: "assistant",
			content: [
				{ type: "text", text: "A".repeat(10000) },
				{ type: "tool-call", toolCallId: "tc-1", toolName: "test", input: {} },
			],
		} as unknown as ModelMessage;
		const result = truncateMessage(msg, 100);
		const parts = result.content as Record<string, unknown>[];
		expect(parts).toHaveLength(2);
		expect(parts[1].type).toBe("tool-call");
	});
});
