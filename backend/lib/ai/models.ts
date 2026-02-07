import { z } from "zod";

export const AVAILABLE_MODEL_IDS = [
  "google/gemini-3-flash",
  "openai/gpt-5.2",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-haiku-4.5",
] as const;

export const availableModelSchema = z.enum(AVAILABLE_MODEL_IDS);
export type AvailableModel = z.infer<typeof availableModelSchema>;

export const DEFAULT_MODEL: AvailableModel = "openai/gpt-5.2";
