import { describe, test, expect } from "bun:test";
import { stripMarkdown } from "./markdown";

describe("stripMarkdown", () => {
  test("removes heading markers", () => {
    expect(stripMarkdown("# Title")).toBe("Title");
    expect(stripMarkdown("## Subtitle")).toBe("Subtitle");
    expect(stripMarkdown("### Deep heading")).toBe("Deep heading");
  });

  test("removes bold markers", () => {
    expect(stripMarkdown("**bold text**")).toBe("bold text");
    expect(stripMarkdown("__bold text__")).toBe("bold text");
  });

  test("removes italic markers", () => {
    expect(stripMarkdown("*italic*")).toBe("italic");
    expect(stripMarkdown("_italic_")).toBe("italic");
  });

  test("removes bold+italic markers", () => {
    expect(stripMarkdown("***bold italic***")).toBe("bold italic");
  });

  test("removes strikethrough markers", () => {
    expect(stripMarkdown("~~deleted~~")).toBe("deleted");
  });

  test("removes inline code backticks", () => {
    expect(stripMarkdown("run `npm install`")).toBe("run npm install");
  });

  test("removes fenced code block markers", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(stripMarkdown(input)).toBe("const x = 1;");
  });

  test("converts links to plain text", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe(
      "click here",
    );
  });

  test("converts images to alt text", () => {
    expect(stripMarkdown("![logo](https://example.com/logo.png)")).toBe(
      "logo",
    );
  });

  test("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  test("removes unordered list markers", () => {
    expect(stripMarkdown("- item one\n- item two")).toBe(
      "item one\nitem two",
    );
    expect(stripMarkdown("* item")).toBe("item");
    expect(stripMarkdown("+ item")).toBe("item");
  });

  test("removes ordered list markers", () => {
    expect(stripMarkdown("1. first\n2. second")).toBe("first\nsecond");
  });

  test("removes horizontal rules", () => {
    expect(stripMarkdown("above\n---\nbelow")).toBe("above\n\nbelow");
  });

  test("handles mixed markdown", () => {
    const input =
      "## Summary\n\nHere is **bold** and *italic* with a [link](http://x.com).\n\n- item 1\n- item 2";
    const expected =
      "Summary\n\nHere is bold and italic with a link.\n\nitem 1\nitem 2";
    expect(stripMarkdown(input)).toBe(expected);
  });

  test("returns plain text unchanged", () => {
    expect(stripMarkdown("Hello world")).toBe("Hello world");
  });

  test("handles empty string", () => {
    expect(stripMarkdown("")).toBe("");
  });
});
