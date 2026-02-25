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
      // Remove fenced code block markers (``` or ~~~, with optional language)
      .replace(/^(`{3,}|~{3,})\w*$/gm, "")
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
