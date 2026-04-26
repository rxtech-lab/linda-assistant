import type { ModelMessage } from "ai";

// ── Configuration ──────────────────────────────────────────────────────

/** Shared context window for all models (in tokens). */
export const CONTEXT_WINDOW = 75_000;

/** Trigger compaction when estimated tokens exceed this ratio of CONTEXT_WINDOW. */
export const COMPACTION_THRESHOLD = 0.75;

/** Minimum number of recent messages to keep verbatim (never compacted). */
export const MIN_RECENT_MESSAGES = 6;

/** Target token budget for the summary produced by compaction. */
export const SUMMARY_TARGET_TOKENS = 2_000;

/** Token size of each chunk when splitting an oversized single message. */
export const CHUNK_TOKEN_SIZE = 10_000;

export const IMAGE_GENERATION_MODEL = "google/gemini-3.1-flash-image-preview";

export const CHART_GENERATION_MODEL = "google/gemma-4-31b-it";

// save usage, when in ci, use cheap model for data sheet generation
export const DATA_SHEET_GENERATION_MODEL = process.env.CI
  ? "google/gemini-3.1-flash-image-preview"
  : "anthropic/claude-sonnet-4.6";

export const SLIDE_GENERATION_MODEL = process.env.CI
  ? "google/gemini-3.1-flash-image-preview"
  : "anthropic/claude-sonnet-4.6";

export const PODCAST_GENERATION_MODEL = "google/gemini-3-flash";

export const TASK_SESSION_SUMMARIZATION_MODEL = "google/gemma-4-31b-it";

export const TASK_SESSION_EMBEDDING_MODEL = "google/gemini-embedding-2";

/** Number of recent history entries to inject into standalone chat context. */
export const HISTORY_CONTEXT_LIMIT = 5;

/** Minimum cosine similarity score for vector search results (0–1). */
export const HISTORY_SIMILARITY_THRESHOLD = 0.5;

/** Minimum cosine similarity score for tool search results (0–1). */
export const TOOL_SEARCH_SIMILARITY_THRESHOLD = 0.5;

/** Embedding vector dimensions for gemini-embedding-2. */
export const EMBEDDING_DIMENSIONS = 768;

/** Max tokens per chunk when summarizing large session histories. */
export const HISTORY_SUMMARIZATION_CHUNK_SIZE = 30_000;

export const MAX_STEPS = 20;

/**
 * Model used for generating summaries during compaction.
 * Env: COMPACTION_MODEL (default: fast model with large context window).
 */
export const COMPACTION_MODEL =
  process.env.COMPACTION_MODEL || "google/gemma-4-31b-it";

// ── Token Estimation ───────────────────────────────────────────────────

/** Per-content-part structural overhead in characters. */
const PART_OVERHEAD = 20;
/** Per-message overhead in characters (role, formatting). */
const MESSAGE_OVERHEAD = 10;
/** Characters per token (conservative — overestimates so compaction fires early). */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the token count for an array of model messages.
 *
 * Uses a simple character-based heuristic (4 chars ≈ 1 token).
 * Intentionally overestimates so compaction triggers slightly early
 * rather than too late.
 */
export function estimateTokenCount(messages: ModelMessage[]): number {
  let chars = 0;

  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as Record<string, unknown>[]) {
        if (part.type === "text" && typeof part.text === "string") {
          chars += (part.text as string).length;
        } else if (part.type === "tool-call") {
          chars += JSON.stringify(part.input ?? {}).length;
        } else if (part.type === "tool-result") {
          chars += JSON.stringify(part.output ?? {}).length;
        } else if (part.type === "image") {
          // Images don't count much in token estimation
          chars += 100;
        } else if (part.type === "file") {
          chars += 200;
        }
        chars += PART_OVERHEAD;
      }
    }
    chars += MESSAGE_OVERHEAD;
  }

  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Return the effective context window size.
 * In E2E test mode, returns a small value (500) so compaction triggers easily.
 */
export function getContextWindow(): number {
  if (process.env.IS_E2E) return 500;
  return CONTEXT_WINDOW;
}
