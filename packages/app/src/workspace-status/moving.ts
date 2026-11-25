import type { PluginWorkspaceInProgressEntry } from "@getpaseo/plugin/client";

/**
 * Whether a plugin's in-progress entry is moving. Overview flags entries that aren't, and the sidebar
 * groups a workspace by them; both read this one rule so they never disagree.
 */

/** An entry unchanged this long, with nothing else moving it, is "not moving". */
export const NOTHING_MOVING_AFTER_MS = 10 * 60_000;

export interface MovementContext {
  /** Agents that run a turn; an entry held by one of them moves. */
  runningAgentIds: ReadonlySet<string>;
  /** Live work in the workspace that could report back (a background shell, a monitor). */
  liveWork: boolean;
  now: number;
}

/**
 * Something moves this entry: its agent runs a turn, live work could report back, something outside
 * watches it, or it changed within `NOTHING_MOVING_AFTER_MS`.
 */
export function isEntryMoving(
  entry: PluginWorkspaceInProgressEntry,
  ctx: MovementContext,
): boolean {
  if (entry.agentId && ctx.runningAgentIds.has(entry.agentId)) return true;
  if (ctx.liveWork || entry.watched) return true;
  return ctx.now - entry.updatedAt <= NOTHING_MOVING_AFTER_MS;
}

/**
 * The earliest moment after `now` at which one of `entries` stops moving by age alone, so a caller
 * can re-evaluate then instead of on a fixed tick. Null when none will.
 */
export function nextNothingMovingAt(
  entries: Iterable<PluginWorkspaceInProgressEntry>,
  now: number,
): number | null {
  let next: number | null = null;
  for (const entry of entries) {
    if (entry.watched) continue;
    const at = entry.updatedAt + NOTHING_MOVING_AFTER_MS + 1;
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}
