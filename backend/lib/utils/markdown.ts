import { db } from "@/lib/db";
import { slidePages } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

/**
 * Replace `{{slide:deckId}}` tokens in content with rendered image references.
 * For markdown, produces `![Slide N](url)` syntax.
 * For HTML, produces `<img>` tags.
 */
export async function replaceSlideTokens(
  content: string,
  format: "markdown" | "html",
): Promise<string> {
  const slidePattern = /\{\{slide:([a-zA-Z0-9_-]+)\}\}/g;
  const matches = [...content.matchAll(slidePattern)];
  let result = content;

  for (const match of matches) {
    const deckId = match[1];
    const pages = await db
      .select({ imageUrl: slidePages.imageUrl, pageNumber: slidePages.pageNumber })
      .from(slidePages)
      .where(eq(slidePages.deckId, deckId))
      .orderBy(asc(slidePages.pageNumber));

    const filtered = pages.filter((p) => p.imageUrl);
    let replacement: string;

    if (format === "html") {
      replacement = filtered
        .map(
          (p) =>
            `<div style="margin: 16px 0;"><img src="${p.imageUrl}" style="width: 100%; border-radius: 8px;" alt="Slide ${p.pageNumber}" /></div>`,
        )
        .join("\n");
    } else {
      replacement = filtered.map((p) => `![Slide ${p.pageNumber}](${p.imageUrl})`).join("\n\n");
    }

    result = result.replace(match[0], replacement);
  }

  return result;
}

/**
 * Strip common Markdown syntax from a string, returning plain text suitable
 * for contexts like push-notification bodies where formatting is not rendered.
 */
export function stripMarkdown(text: string): string {
  return (
    text
      // Remove images ![alt](url)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Convert links [text](url) → text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Remove headings (## heading → heading)
      .replace(/^#{1,6}\s+/gm, "")
      // Remove fenced code block markers (``` or ~~~, with optional language/info string)
      .replace(/^[ \t]*(`{3,}|~{3,})[^\r\n]*$/gm, "")
      // Remove bold/italic markers (*** / ** / * / ___ / __ / _)
      .replace(/(\*{1,3}|_{1,3})(.+?)\1/g, "$2")
      // Remove strikethrough ~~text~~
      .replace(/~~(.+?)~~/g, "$1")
      // Remove inline code `code`
      .replace(/`([^`]+)`/g, "$1")
      // Remove blockquote markers
      .replace(/^>\s?/gm, "")
      // Remove unordered list markers (-, *, +)
      .replace(/^[\t ]*[-*+]\s+/gm, "")
      // Remove ordered list markers (1., 2., etc.)
      .replace(/^[\t ]*\d+\.\s+/gm, "")
      // Remove horizontal rules (---, ***, ___)
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Collapse multiple blank lines into one
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
