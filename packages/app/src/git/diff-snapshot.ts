import type { DiffState, DiffEntry } from "@getpaseo/client";
import type {
  DiffError,
  ParsedDiffFile,
  SubscribeCheckoutDiffRequest,
} from "@getpaseo/protocol/messages";
export type DiffFileHeader = Omit<ParsedDiffFile, "hunks">;
export interface CheckoutDiffSnapshot {
  requestId: string;
  cwd: string;
  files: ParsedDiffFile[];
  entries?: DiffEntry[];
  error: DiffError | null;
  diffTooLarge?: boolean;
}
/**
 * `subscriptionEpoch` must be unique per diff subscription in this app session: stream
 * revisions restart at 1 on every subscription.
 */
export function checkoutDiffSnapshot(
  cwd: string,
  state: DiffState,
  subscriptionEpoch: number,
): CheckoutDiffSnapshot {
  const common = { cwd, requestId: `diff:${state.revision}:${state.phase}` };
  if (state.phase === "loading")
    return { ...common, files: [], entries: state.entries, error: null };
  if (state.phase === "error") return { ...common, files: [], error: state.error };
  const files = stampBinaryRevisions(state.files, `${subscriptionEpoch}:${state.revision}`);
  return { ...common, files, error: null, diffTooLarge: state.diffTooLarge };
}

// FSH: image previews cache by `revision`. Streamed binary entries carry no content identity,
// so an image rewritten in place yields an identical entry. Stamp them with the snapshot: the
// daemon commits a new snapshot whenever the worktree changes, so visible previews refetch then.
function stampBinaryRevisions(files: ParsedDiffFile[], revision: string): ParsedDiffFile[] {
  return files.map((file) =>
    file.status === "binary" && file.revision === undefined ? { ...file, revision } : file,
  );
}
export function diffEntryHeaders(entries: DiffEntry[]): DiffFileHeader[] {
  return entries.map((entry) => ({
    path: entry.path,
    ...(entry.oldPath === null ? {} : { oldPath: entry.oldPath }),
    isNew: entry.change === "added",
    isDeleted: entry.change === "deleted",
    additions: entry.additions,
    deletions: entry.deletions,
    status: entry.content === "binary" ? "binary" : "ok",
  }));
}
export interface CheckoutDiffResult {
  files: ParsedDiffFile[];
  entries: DiffEntry[] | null;
  payloadError: CheckoutDiffSnapshot["error"];
  diffTooLarge: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: null;
}

/**
 * The result derives from the payload alone. Until a payload arrives there is no
 * diff to describe, so the boundary reports loading rather than an empty diff —
 * whether the query is idle (an inactive retained panel), in flight, or the host
 * is disconnected. Reporting `files: []` as settled made callers render "+0 -0"
 * and "No changes" for a diff nobody has fetched yet.
 */
export function deriveCheckoutDiffResult(payload: CheckoutDiffSnapshot | null): CheckoutDiffResult {
  const payloadError = payload?.error ?? null;
  return {
    files: payload?.files ?? [],
    entries: payload?.entries ?? null,
    payloadError,
    diffTooLarge: payload?.diffTooLarge === true,
    isLoading: payload === null || payload.entries !== undefined,
    isFetching: false,
    isError: Boolean(payloadError),
    error: null,
  };
}

export function checkoutDiffComparisonError(
  compare: Pick<SubscribeCheckoutDiffRequest["compare"], "mode" | "baseRef">,
): DiffError | null {
  if (compare.mode === "uncommitted" || compare.baseRef?.trim()) return null;
  return {
    code: "INVALID_COMPARE",
    message: "Comparison base is unavailable. Select Uncommitted to view pending changes.",
  };
}
