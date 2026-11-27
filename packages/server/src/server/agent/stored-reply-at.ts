// Kept free of imports: agent-projections and agent-manager both need it, and importing it from
// agent-storage closes an import cycle through ../messages.ts.

/** Records written before `lastReplyAt` existed didn't tell prompts apart: every prompt was a reply. */
export function storedReplyAt(record: {
  lastReplyAt?: string | null;
  lastUserMessageAt?: string | null;
}): Date | null {
  const at = record.lastReplyAt !== undefined ? record.lastReplyAt : record.lastUserMessageAt;
  return at ? new Date(at) : null;
}
