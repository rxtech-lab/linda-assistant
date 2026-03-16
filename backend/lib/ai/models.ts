import { z } from "zod";

export const AVAILABLE_MODEL_IDS = [
  "google/gemini-3.1-flash-image-preview",
  "openai/gpt-5.4",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.1-pro-preview",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-oss-120b",
] as const;

export const availableModelSchema = z.enum(AVAILABLE_MODEL_IDS);
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const DEFAULT_MODEL: AvailableModel = "openai/gpt-5.4";

/** Per-million-token USD pricing for each model (input / output). */
export const MODEL_PRICING: Record<
  AvailableModel,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "anthropic/claude-haiku-4.5": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  "anthropic/claude-sonnet-4.6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "google/gemini-3.1-flash-image-preview": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "google/gemini-3.1-flash-lite-preview": { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  "google/gemini-3.1-pro-preview": { inputPerMillion: 1.25, outputPerMillion: 5.0 },
  "openai/gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 10.0 },
  "openai/gpt-oss-120b": { inputPerMillion: 1.0, outputPerMillion: 4.0 },
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
