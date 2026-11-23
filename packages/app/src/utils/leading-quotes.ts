const QUOTE_LINE = /^>(?: |$)/;

export interface MessageSegment {
  kind: "quote" | "text";
  /** Line the segment starts on; stable within one message, so it doubles as a React key. */
  line: number;
  text: string;
}

/**
 * Splits a message that opens with a blockquote (what Cite sends) into quote and text
 * segments in order, so each quote shows with the comment written under it. A message
 * that doesn't start with a quote comes back as one text segment.
 */
export function splitQuotedMessage(message: string): MessageSegment[] {
  const lines = message.split(/\r?\n/);
  if (!QUOTE_LINE.test(lines[0] ?? "")) {
    return [{ kind: "text", line: 0, text: message }];
  }
  const segments: MessageSegment[] = [];
  let kind: MessageSegment["kind"] | null = null;
  let start = 0;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join("\n");
    if (kind && (kind === "quote" || text.trim())) {
      segments.push({ kind, line: start, text: kind === "text" ? text.trim() : text });
    }
    kind = null;
    buffer = [];
  };
  lines.forEach((line, index) => {
    const isQuote = QUOTE_LINE.test(line);
    if (kind === "quote" && !isQuote) flush();
    if (isQuote && kind !== "quote") {
      flush();
      kind = "quote";
      start = index;
    }
    if (isQuote) {
      buffer.push(line.replace(/^> ?/, ""));
      return;
    }
    if (kind === null) {
      if (!line.trim()) return;
      kind = "text";
      start = index;
    }
    buffer.push(line);
  });
  flush();
  return segments;
}
