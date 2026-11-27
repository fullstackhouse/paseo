import { compareMatchScores, scoreTextFields } from "@getpaseo/protocol/search/text-match";

export interface ChangeRequestMentionRange {
  start: number;
  end: number;
  query: string;
}

interface FindActiveChangeRequestMentionInput {
  text: string;
  cursorIndex: number;
}

interface ApplyChangeRequestMentionReplacementInput {
  text: string;
  mention: ChangeRequestMentionRange;
  /** What replaces the typed `#query`: `#123` on GitHub, `!123` on GitLab. */
  reference: string;
}

export interface ChangeRequestMentionCandidate {
  number: number;
  title: string;
  headRefName?: string | null;
}

const MENTION_QUERY = /^[\w-]*$/;
// `#` opens the picker at the start of the text or after whitespace or an opening bracket,
// so `C#`, `foo#bar` and URL fragments stay plain text.
const MENTION_BOUNDARY = /[\s([{]/;

export function findActiveChangeRequestMention(
  input: FindActiveChangeRequestMentionInput,
): ChangeRequestMentionRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);
  const hashIndex = beforeCursor.lastIndexOf("#");
  if (hashIndex < 0) {
    return null;
  }
  if (hashIndex > 0 && !MENTION_BOUNDARY.test(beforeCursor[hashIndex - 1]!)) {
    return null;
  }
  const query = beforeCursor.slice(hashIndex + 1);
  if (!MENTION_QUERY.test(query)) {
    return null;
  }
  return { start: hashIndex, end: clampedCursor, query };
}

export function applyChangeRequestMentionReplacement(
  input: ApplyChangeRequestMentionReplacementInput,
): string {
  const before = input.text.slice(0, input.mention.start);
  const after = input.text.slice(input.mention.end);
  const separator = after.startsWith(" ") ? "" : " ";
  return `${before}${input.reference}${separator}${after}`;
}

/**
 * A number query matches by number prefix (`#12` finds 12, 120 and 1234), with the exact
 * number first; any other query matches the title and branch. Order is otherwise kept for
 * number and empty queries (newest first, as the forge returns them); text queries rank by
 * match.
 */
export function filterChangeRequestMentionCandidates<T extends ChangeRequestMentionCandidate>(
  candidates: readonly T[],
  query: string,
): T[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) {
    return [...candidates];
  }
  if (/^\d+$/.test(trimmed)) {
    const matches = candidates.filter((candidate) => String(candidate.number).startsWith(trimmed));
    const exact = matches.filter((candidate) => String(candidate.number) === trimmed);
    const rest = matches.filter((candidate) => String(candidate.number) !== trimmed);
    return [...exact, ...rest];
  }
  return candidates
    .flatMap((candidate) => {
      const score = scoreTextFields(trimmed, [candidate.title, candidate.headRefName ?? ""]);
      return score ? [{ candidate, score }] : [];
    })
    .sort((left, right) => compareMatchScores(left.score, right.score))
    .map((entry) => entry.candidate);
}

/** Joins candidate lists into one, keeping the first entry for each number. */
export function mergeChangeRequestMentionCandidates<T extends ChangeRequestMentionCandidate>(
  lists: readonly (readonly T[])[],
): T[] {
  const seen = new Set<number>();
  const merged: T[] = [];
  for (const candidate of lists.flat()) {
    if (seen.has(candidate.number)) continue;
    seen.add(candidate.number);
    merged.push(candidate);
  }
  return merged;
}
