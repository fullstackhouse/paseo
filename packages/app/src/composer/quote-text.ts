/**
 * Adds a cited fragment to the end of the message as a markdown blockquote and leaves an
 * empty line under it, so the user's comment on it goes right below.
 */
export function appendQuoteToText(text: string, markdown: string): string {
  const trimmed = markdown.trim();
  if (!trimmed) return text;
  const quote = trimmed
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `> ${line}` : ">"))
    .join("\n");
  const base = text.replace(/\s+$/, "");
  return `${base ? `${base}\n\n` : ""}${quote}\n\n`;
}
