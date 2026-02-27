import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "./agent";

const today = new Date().toLocaleDateString("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});
const dateSuffix = `\nToday's date is ${today}.`;
const documentGuidance = `\nWhen your response would be very long (e.g., reports, analyses, comprehensive guides), or when the user explicitly asks for a document/report, use the create_document tool instead of writing it inline. Always prefer markdown format unless the user specifically requests HTML. Do NOT include the title as a heading in the document content — the title is displayed separately by the viewer. After creating a document, do NOT repeat the document content in your response — just confirm you created it and provide a brief summary of what it contains.`;
const suffix = `${dateSuffix}${documentGuidance}`;

describe("buildSystemPrompt", () => {
  test("returns generic prompt when no assignee", () => {
    expect(buildSystemPrompt(null)).toBe(
      `You are a helpful personal assistant.${suffix}`,
    );
    expect(buildSystemPrompt(undefined)).toBe(
      `You are a helpful personal assistant.${suffix}`,
    );
  });

  test("uses assignee name when no personality is set", () => {
    expect(buildSystemPrompt({ name: "Linda", personality: null })).toBe(
      `You are Linda, a helpful personal assistant.${suffix}`,
    );
  });

  test("uses personality when set", () => {
    const personality = "You are a sarcastic AI named Bob who loves puns.";
    expect(buildSystemPrompt({ name: "Bob", personality })).toBe(
      `${personality}${suffix}`,
    );
  });

  test("uses personality even when it differs from name", () => {
    const personality = "Act as a formal business assistant.";
    expect(buildSystemPrompt({ name: "Linda", personality })).toBe(
      `${personality}${suffix}`,
    );
  });
});
