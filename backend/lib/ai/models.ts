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
