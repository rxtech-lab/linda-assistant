import type { ModelMessage } from "ai";

/**
 * Truncate a string to ~400 words if it exceeds 300 words.
 * Keeps the first 200 words + " ... " + last 200 words.
 */
export function truncateString(text: string, maxWords = 300): string {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  const head = words.slice(0, 200).join(" ");
  const tail = words.slice(-200).join(" ");
  return `${head} ... ${tail}`;
}

/**
 * Recursively compress string values in a value tree.
 * - string → truncateString
 * - Array → map each element
 * - plain object → shallow-clone, recurse each value
 * - else → return as-is
 */
export function compressValue(value: unknown): unknown {
  if (typeof value === "string") return truncateString(value);
  if (Array.isArray(value)) return value.map(compressValue);
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = compressValue(v);
    }
    return result;
  }
  return value;
}

/**
 * Compress tool-call input and tool-result output in messages from previous runs.
 * Only clones messages that contain tool-call or tool-result parts.
 * Does not mutate the original messages.
 */
export function compressToolCallContent(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;

    const parts = msg.content as Record<string, unknown>[];
    const hasCompressible = parts.some(
      (p) => p.type === "tool-call" || p.type === "tool-result",
    );
    if (!hasCompressible) return msg;

    const newParts = parts.map((part) => {
      if (part.type === "tool-call" && part.input != null) {
        return { ...part, input: compressValue(part.input) };
      }
      if (part.type === "tool-result" && part.output != null) {
        return { ...part, output: compressValue(part.output) };
      }
      return part;
    });

    return { ...(msg as Record<string, unknown>), content: newParts } as unknown as ModelMessage;
  });
}
