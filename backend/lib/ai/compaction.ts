import crypto from "crypto";
import { generateText, type ModelMessage } from "ai";
import {
	estimateTokenCount,
	getContextWindow,
	COMPACTION_THRESHOLD,
	MIN_RECENT_MESSAGES,
	SUMMARY_TARGET_TOKENS,
	CHUNK_TOKEN_SIZE,
	COMPACTION_MODEL,
} from "./context";
import { getModelProvider } from "./model";
import { compactMessages as dbCompactMessages } from "@/lib/db/messages";
import { createMem0Client } from "@/lib/mem0/client";

// ── Types ──────────────────────────────────────────────────────────────

export interface CompactionResult {
	messages: ModelMessage[];
	compacted: boolean;
	compactedCount: number;
}

// ── Pure helpers (exported for unit testing) ───────────────────────────

/**
 * Extract plain text from a model message's content.
 */
export function extractTextFromMessage(msg: ModelMessage): string {
	if (typeof msg.content === "string") return msg.content;
	if (!Array.isArray(msg.content)) return "";

	const parts = msg.content as Record<string, unknown>[];
	return parts
		.map((p) => {
			if (p.type === "text" && typeof p.text === "string")
				return p.text as string;
			if (p.type === "tool-call")
				return `[Tool call: ${p.toolName}(${JSON.stringify(p.input ?? {})})]`;
			if (p.type === "tool-result") {
				const output = JSON.stringify(p.output ?? "");
				return `[Tool result: ${p.toolName} → ${output.slice(0, 200)}]`;
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

/**
 * Find a safe split point that doesn't break tool-call / tool-result pairs.
 *
 * Starting from `targetIndex`, scans backward to ensure we don't split
 * between an assistant message with tool-calls and its corresponding
 * tool-result messages.
 *
 * Returns the index that should be the first element of the "recent" group.
 */
export function findSafeSplitPoint(
	messages: ModelMessage[],
	targetIndex: number,
): number {
	if (targetIndex <= 0) return 0;
	if (targetIndex >= messages.length) return messages.length;

	let idx = targetIndex;

	// Walk backward: if the message at idx is a tool-result message,
	// keep going back to include the assistant tool-call message that triggered it.
	while (idx > 0) {
		const msg = messages[idx];
		if (!msg) break;

		// If this is a tool message (role=tool), the preceding assistant message
		// likely contains the tool-call. Include both.
		if (msg.role === "tool") {
			idx--;
			continue;
		}

		// If this is an assistant message with tool-calls, check that the
		// next message(s) contain the tool-results.
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			const hasToolCalls = (msg.content as Record<string, unknown>[]).some(
				(p) => p.type === "tool-call",
			);
			if (hasToolCalls) {
				// We must keep this assistant message and all its tool-result messages.
				// The tool-results come AFTER this message, so they're already in the "recent" group.
				// But we need to ensure this assistant message is included too.
				break;
			}
		}

		break;
	}

	return idx;
}

/**
 * Split messages into old (to compact) and recent (to keep).
 * Returns { oldMessages, recentMessages, splitSeq }.
 *
 * `splitSeq` is the seq value of the first recent message (for DB compaction).
 */
export function splitMessages(
	messages: ModelMessage[],
	minRecent: number = MIN_RECENT_MESSAGES,
): {
	oldMessages: ModelMessage[];
	recentMessages: ModelMessage[];
	splitIndex: number;
} {
	if (messages.length <= minRecent) {
		return { oldMessages: [], recentMessages: messages, splitIndex: 0 };
	}

	const rawSplitIndex = messages.length - minRecent;
	const safeSplitIndex = findSafeSplitPoint(messages, rawSplitIndex);

	return {
		oldMessages: messages.slice(0, safeSplitIndex),
		recentMessages: messages.slice(safeSplitIndex),
		splitIndex: safeSplitIndex,
	};
}

/**
 * Build the prompt for summarizing a set of messages.
 */
export function buildSummaryPrompt(messages: ModelMessage[]): string {
	const formatted = messages
		.map((msg) => {
			const text = extractTextFromMessage(msg);
			return `[${msg.role}]: ${text}`;
		})
		.join("\n\n");

	return `Summarize the following conversation while preserving ALL factual information, decisions, user preferences, tool call outcomes, and any unresolved items. Be concise but thorough. Target approximately ${SUMMARY_TARGET_TOKENS} tokens.

<conversation>
${formatted}
</conversation>

Produce a structured summary:`;
}

/**
 * Split a text string into chunks of approximately `chunkTokens` tokens.
 * Splits at word boundaries to avoid breaking words.
 */
export function splitTextIntoChunks(
	text: string,
	chunkTokens: number = CHUNK_TOKEN_SIZE,
): string[] {
	const chunkChars = chunkTokens * 4; // 4 chars per token estimate
	if (text.length <= chunkChars) return [text];

	const chunks: string[] = [];
	let start = 0;

	while (start < text.length) {
		let end = start + chunkChars;
		if (end >= text.length) {
			chunks.push(text.slice(start));
			break;
		}

		// Find word boundary near the chunk end
		const spaceIdx = text.lastIndexOf(" ", end);
		if (spaceIdx > start) {
			chunks.push(text.slice(start, spaceIdx));
			start = spaceIdx + 1; // skip the space
		} else {
			// No word boundary found — hard-split at chunk size
			chunks.push(text.slice(start, end));
			start = end;
		}
	}

	return chunks;
}

/**
 * Truncate a message's text content to fit within a token budget.
 * Returns a new ModelMessage with truncated content (does not mutate original).
 */
export function truncateMessage(
	msg: ModelMessage,
	maxTokens: number,
): ModelMessage {
	const maxChars = maxTokens * 4;

	if (typeof msg.content === "string") {
		if (msg.content.length <= maxChars) return msg;
		return {
			...msg,
			content:
				msg.content.slice(0, maxChars) +
				`\n[...message truncated due to length. Original: ${msg.content.length} characters]`,
		} as ModelMessage;
	}

	if (!Array.isArray(msg.content)) return msg;

	const parts = (msg.content as Record<string, unknown>[]).map((p) => {
		if (p.type === "text" && typeof p.text === "string") {
			const text = p.text as string;
			if (text.length <= maxChars) return p;
			return {
				...p,
				text:
					text.slice(0, maxChars) +
					`\n[...message truncated due to length. Original: ${text.length} characters]`,
			};
		}
		return p;
	});

	return { ...msg, content: parts } as unknown as ModelMessage;
}

// ── LLM-dependent helpers ──────────────────────────────────────────────

/**
 * Use the compaction model to summarize a set of messages.
 */
async function generateSummary(messages: ModelMessage[]): Promise<string> {
	const prompt = buildSummaryPrompt(messages);
	const result = await generateText({
		model: getModelProvider(COMPACTION_MODEL),
		prompt,
	});
	return result.text;
}

/**
 * Compact an oversized single message by splitting into chunks
 * and summarizing sequentially with a rolling summary.
 */
export async function compactOversizedMessage(
	text: string,
	maxTokens: number,
): Promise<string> {
	const chunks = splitTextIntoChunks(text);
	if (chunks.length <= 1) {
		// Can't chunk further — just truncate
		const maxChars = maxTokens * 4;
		return (
			text.slice(0, maxChars) +
			`\n[...message truncated due to length. Original: ${text.length} characters]`
		);
	}

	let rollingSummary = "";

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const isFirst = i === 0;

		const prompt = isFirst
			? `Summarize the following text while preserving all key information, questions, and intent. Be concise.\n\n<text>\n${chunk}\n</text>\n\nSummary:`
			: `Given the running summary of earlier sections and the next section of a user's message, produce an updated summary preserving all key information, questions, and intent. Be concise.\n\n<running_summary>\n${rollingSummary}\n</running_summary>\n\n<next_section>\n${chunk}\n</next_section>\n\nUpdated summary:`;

		try {
			const result = await generateText({
				model: getModelProvider(COMPACTION_MODEL),
				prompt,
			});
			rollingSummary = result.text;
		} catch (err) {
			console.warn(`[compaction] Chunk ${i + 1}/${chunks.length} summarization failed:`, err);
			// Use whatever summary we have so far, plus truncated remaining text
			const remaining = chunks
				.slice(i)
				.join(" ")
				.slice(0, maxTokens * 4);
			rollingSummary += `\n\n[Partial summary — remaining text truncated]\n${remaining}`;
			break;
		}
	}

	return rollingSummary;
}

// ── Main entry point ───────────────────────────────────────────────────

/**
 * Prepare messages for the next streamText() call.
 *
 * Analogous to Vercel AI SDK's `prepareStep`:
 * 1. Checks if total tokens exceed the compaction threshold
 * 2. If so, splits messages, summarizes old ones, persists to DB
 * 3. Handles oversized single messages via chunked compaction
 * 4. Emits "compacting" SSE events for frontend visibility
 *
 * On any failure, returns the original messages (graceful degradation).
 */
export async function prepareMessages(opts: {
	sessionId: string;
	userId: string;
	messages: ModelMessage[];
	modelId: string;
	systemPrompt: string;
	assigneeId?: string | null;
	onEvent?: (event: string, data: unknown) => void | Promise<void>;
}): Promise<CompactionResult> {
	const {
		sessionId,
		userId,
		messages,
		systemPrompt,
		assigneeId,
		onEvent,
	} = opts;

	const contextWindow = getContextWindow();
	const threshold = contextWindow * COMPACTION_THRESHOLD;

	// Estimate current token usage (system prompt + messages)
	const systemTokens = Math.ceil(systemPrompt.length / 4);
	const messageTokens = estimateTokenCount(messages);
	const totalTokens = systemTokens + messageTokens;

	console.log(
		`[compaction] session=${sessionId} tokens=${totalTokens} (system=${systemTokens} + messages=${messageTokens}) threshold=${threshold} messages=${messages.length}`,
	);

	if (totalTokens <= threshold) {
		// Still within budget — check if the last message alone is oversized
		return handleOversizedLastMessage(messages, contextWindow, onEvent);
	}

	// ── Compaction needed ───────────────────────────────────────────────

	try {
		const { oldMessages, recentMessages, splitIndex } =
			splitMessages(messages);

		if (oldMessages.length === 0) {
			// Nothing to compact — all messages are "recent". Handle oversized.
			return handleOversizedLastMessage(messages, contextWindow, onEvent);
		}

		// Emit compacting event
		await onEvent?.("compacting", {
			id: crypto.randomUUID(),
			messageCount: oldMessages.length,
		});

		// Fire-and-forget: send old messages to mem0 for long-term memory
		const mem0 = createMem0Client();
		mem0
			.addMemories(
				oldMessages.map((m) => ({
					role: m.role,
					content: extractTextFromMessage(m),
				})),
				userId,
				{ agentId: assigneeId ?? undefined, runId: sessionId },
			)
			.catch((err) =>
				console.warn("[compaction] mem0 addMemories failed:", err),
			);

		// Generate summary of old messages
		const summaryText = await generateSummary(oldMessages);

		const summaryMessage: ModelMessage = {
			id: crypto.randomUUID(),
			role: "user",
			content: [
				{
					type: "text",
					text: `[CONVERSATION SUMMARY]\n${summaryText}\n[END SUMMARY]\n\nThe conversation continues below:`,
				},
			],
		} as unknown as ModelMessage;

		// Persist compaction to DB.
		// Prefer the actual DB seq from the first recent message; if that is
		// missing (e.g. in-memory message without seq), derive the boundary
		// from the max seq of oldMessages (first seq *after* the compacted
		// range). Only fall back to splitIndex if no seq info is available.
		const firstRecentMsg = recentMessages[0] as Record<string, unknown>;
		let keepFromSeq = firstRecentMsg?.seq as number | undefined;

		if (typeof keepFromSeq !== "number") {
			const oldSeqs = oldMessages
				.map((m) => (m as Record<string, unknown>).seq as number | undefined)
				.filter((seq): seq is number => typeof seq === "number");

			if (oldSeqs.length > 0) {
				const maxOldSeq = Math.max(...oldSeqs);
				keepFromSeq = maxOldSeq + 1;
			} else {
				// Last-resort fallback: no seqs anywhere, use splitIndex which
				// matches the logical boundary used to split messages above.
				keepFromSeq = splitIndex;
			}
		}
		await dbCompactMessages(sessionId, summaryMessage, keepFromSeq);

		const compactedMessages = [summaryMessage, ...recentMessages];
		const compactedTokens = estimateTokenCount(compactedMessages) + systemTokens;
		console.log(
			`[compaction] session=${sessionId} done: ${oldMessages.length} messages compacted, tokens ${totalTokens} → ${compactedTokens}, messages ${messages.length} → ${compactedMessages.length}`,
		);

		// Check if still over budget after compaction (oversized last message)
		const result = await handleOversizedLastMessage(
			compactedMessages,
			contextWindow,
			onEvent,
		);

		return {
			messages: result.messages,
			compacted: true,
			compactedCount: oldMessages.length,
		};
	} catch (err) {
		console.warn("[compaction] Failed, continuing with original messages:", err);
		return { messages, compacted: false, compactedCount: 0 };
	}
}

/**
 * If the last user message alone is too large, compact it via chunked summarization.
 * Only modifies the in-memory copy — the original stays in DB.
 */
async function handleOversizedLastMessage(
	messages: ModelMessage[],
	contextWindow: number,
	onEvent?: (event: string, data: unknown) => void | Promise<void>,
): Promise<CompactionResult> {
	if (messages.length === 0) {
		return { messages, compacted: false, compactedCount: 0 };
	}

	const lastMsg = messages[messages.length - 1];
	if (lastMsg.role !== "user") {
		return { messages, compacted: false, compactedCount: 0 };
	}

	const lastMsgTokens = estimateTokenCount([lastMsg]);
	const maxSingleTokens = contextWindow * 0.5;

	if (lastMsgTokens <= maxSingleTokens) {
		return { messages, compacted: false, compactedCount: 0 };
	}

	// Message is oversized — compact it
	try {
		await onEvent?.("compacting", {
			id: crypto.randomUUID(),
			messageCount: 1,
		});

		const originalText = extractTextFromMessage(lastMsg);
		const summarized = await compactOversizedMessage(
			originalText,
			Math.floor(maxSingleTokens),
		);

		const compactedMsg: ModelMessage = {
			...(lastMsg as Record<string, unknown>),
			content: [
				{
					type: "text",
					text: `[SUMMARIZED USER MESSAGE — original was ${originalText.length} characters]\n${summarized}`,
				},
			],
		} as unknown as ModelMessage;

		return {
			messages: [...messages.slice(0, -1), compactedMsg],
			compacted: true,
			compactedCount: 0,
		};
	} catch (err) {
		console.warn("[compaction] Oversized message compaction failed, truncating:", err);
		const truncated = truncateMessage(lastMsg, Math.floor(maxSingleTokens));
		return {
			messages: [...messages.slice(0, -1), truncated],
			compacted: false,
			compactedCount: 0,
		};
	}
}
