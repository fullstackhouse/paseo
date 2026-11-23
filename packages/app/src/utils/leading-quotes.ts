const QUOTE_LINE = /^>(?: |$)/;

export interface LeadingQuote {
  /** Line the quote starts on; stable within one message, so it doubles as a React key. */
  line: number;
  text: string;
}

/**
 * Splits the blockquotes a message opens with (what Cite adds above the user's text)
 * from the rest of it. Quotes separated by a blank line come back separately.
 */
export function splitLeadingQuotes(message: string): { quotes: LeadingQuote[]; body: string } {
  const lines = message.split(/\r?\n/);
  const quotes: LeadingQuote[] = [];
  let start = -1;
  let quoteLines: string[] = [];
  const closeQuote = () => {
    if (start >= 0) quotes.push({ line: start, text: quoteLines.join("\n") });
    start = -1;
    quoteLines = [];
  };
  let index = 0;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (QUOTE_LINE.test(line)) {
      if (start < 0) start = index;
      quoteLines.push(line.replace(/^> ?/, ""));
      continue;
    }
    if (start >= 0 && line.trim() === "") {
      closeQuote();
      continue;
    }
    break;
  }
  closeQuote();
  if (quotes.length === 0) return { quotes, body: message };
  return { quotes, body: lines.slice(index).join("\n").trim() };
}
