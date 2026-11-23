const QUOTE_LINE = /^>(?: |$)/;
const FENCE_LINE = /^\s*(```|~~~)/;

export interface MessageSegment {
  kind: "quote" | "text";
  /** Line the segment starts on; stable within one message, so it doubles as a React key. */
  line: number;
  text: string;
}

/**
 * Splits a user message into blockquotes (what Cite writes) and the text around them, in
 * order, so each quote shows with the comment under it. `>` lines inside code fences stay
 * text. A message without quotes comes back as one text segment, untouched.
 */
export function splitQuotedMessage(message: string): MessageSegment[] {
  const lines = message.split(/\r?\n/);
  const segments: MessageSegment[] = [];
  let kind: MessageSegment["kind"] | null = null;
  let start = 0;
  let buffer: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buffer.join("\n");
    if (kind === "quote" || (kind === "text" && text.trim())) {
      segments.push({ kind, line: start, text: kind === "text" ? text.trim() : text });
    }
    kind = null;
    buffer = [];
  };
  lines.forEach((line, index) => {
    if (FENCE_LINE.test(line)) inFence = !inFence;
    const isQuote = !inFence && QUOTE_LINE.test(line);
    if (isQuote !== (kind === "quote") && kind !== null) flush();
    if (kind === null) {
      if (!isQuote && !line.trim()) return;
      kind = isQuote ? "quote" : "text";
      start = index;
    }
    buffer.push(isQuote ? line.replace(/^> ?/, "") : line);
  });
  flush();
  if (!segments.some((segment) => segment.kind === "quote")) {
    return [{ kind: "text", line: 0, text: message }];
  }
  return segments;
}
