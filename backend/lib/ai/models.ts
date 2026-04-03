import { z } from "zod";

export const AVAILABLE_MODEL_IDS = [
  "google/gemini-3.1-flash-image-preview",
  "openai/gpt-5.4",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-oss-120b",
  "google/gemma-4-26b-a4b-it",
] as const;

export const availableModelSchema = z.enum(AVAILABLE_MODEL_IDS);
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const DEFAULT_MODEL: AvailableModel = "google/gemma-4-26b-a4b-it";

/** Per-million-token USD pricing for each model (input / output). */
export const MODEL_PRICING: Record<
  AvailableModel,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "anthropic/claude-haiku-4.5": { inputPerMillion: 1.0, outputPerMillion: 5.0 },
  "anthropic/claude-sonnet-4.6": {
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  },
  "google/gemini-3.1-flash-image-preview": {
    inputPerMillion: 0.5,
    outputPerMillion: 3.0,
  },
  "google/gemini-3.1-flash-lite-preview": {
    inputPerMillion: 0.25,
    outputPerMillion: 1.5,
  },
  "google/gemini-3.1-pro-preview": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
  },
  "openai/gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 15.0 },
  "openai/gpt-oss-120b": { inputPerMillion: 0.35, outputPerMillion: 0.75 },
  "google/gemma-4-26b-a4b-it": { inputPerMillion: 0.13, outputPerMillion: 0.4 },
};

/**
 * Calculate the USD cost for a given model and token counts.
 * Returns undefined when the model is not in the pricing map.
 */
export function calculateCostUsd(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = MODEL_PRICING[modelId as AvailableModel];
  if (!pricing) return undefined;
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMillion +
    (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}
