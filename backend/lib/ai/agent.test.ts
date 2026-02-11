import { describe, test, expect } from "bun:test";
import { buildSystemPrompt } from "./agent";

describe("buildSystemPrompt", () => {
  test("returns generic prompt when no assignee", () => {
    expect(buildSystemPrompt(null)).toBe("You are a helpful personal assistant.");
    expect(buildSystemPrompt(undefined)).toBe("You are a helpful personal assistant.");
  });

  test("uses assignee name when no personality is set", () => {
    expect(buildSystemPrompt({ name: "Linda", personality: null })).toBe(
      "You are Linda, a helpful personal assistant.",
    );
  });

  test("uses personality when set", () => {
    const personality = "You are a sarcastic AI named Bob who loves puns.";
    expect(buildSystemPrompt({ name: "Bob", personality })).toBe(personality);
  });

  test("uses personality even when it differs from name", () => {
    const personality = "Act as a formal business assistant.";
    expect(buildSystemPrompt({ name: "Linda", personality })).toBe(personality);
  });
});
