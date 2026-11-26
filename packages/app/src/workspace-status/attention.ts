import type {
  PluginWorkspaceAgentCard,
  PluginWorkspaceBlocker,
  PluginWorkspaceStatus,
} from "@getpaseo/plugin/client";
import type { WorkspaceSummaryItem } from "@/plugins/workspace-summary/store";
import { isEntryMoving, nextNothingMovingAt, type MovementContext } from "./moving";

/**
 * Whether a workspace needs you, works, or is blocked or done, decided once from what plugins report.
 * The sidebar, the dock badge and Overview all read `deriveWorkspaceAttention`; see
 * docs/workspace-attention.md.
 */

/** Where a workspace's work stands by what plugins reported, folded across their summary items. */
export type ReportedWork = "needs_you" | "blocked" | "working" | "done";

/** A workspace's in-progress entries, counted, and the group they ask for. */
export interface InProgressTally {
  moving: number;
  stuck: number;
  /** Moving entries that wait on a person's review rather than on machines. */
  awaitingReview: number;
  /** needs_you when nothing moves most of them, working when machines move any, else blocked. */
  work: ReportedWork;
}

/** An agent whose card waits on you while no open ask records what for. */
export interface UnrecordedWait {
  agentId: string;
  /** The item that sent the card; its `EntryComponent` renders the row. */
  item: WorkspaceSummaryItem;
  /** When the card was written: a newer card is new attention. */
  updatedAt: number;
}

export interface WorkspaceAttention {
  /** Everything folded: items, cards and in-progress entries. */
  work: ReportedWork | null;
  /** What the items report without their in-progress entries. */
  reported: ReportedWork | null;
  inProgress: InProgressTally | null;
  /** When the newest status card among the items was written (epoch ms), if any. */
  updatedAt: number | null;
}

/**
 * How long a `working` card keeps counting once nothing live backs it, from the later of its update
 * and the last live work seen for its agent. Covers the gap between turns.
 */
export const WORKING_GRACE_MS = 5 * 60_000;

/** Most to least telling: done only when nothing else is reported. */
const RANK: readonly ReportedWork[] = ["needs_you", "working", "blocked", "done"];

export function moreTelling(a: ReportedWork | null, b: ReportedWork | null): ReportedWork | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK.indexOf(b) < RANK.indexOf(a) ? b : a;
}

/** Agents that own an open ask, and agents that hold one in progress, across every item. */
interface Recorded {
  open: ReadonlySet<string>;
  inProgress: ReadonlySet<string>;
}

function recordedAsks(items: readonly WorkspaceSummaryItem[]): Recorded {
  const open = new Set<string>();
  const inProgress = new Set<string>();
  for (const item of items) {
    for (const entry of item.entries ?? []) if (entry.agentId) open.add(entry.agentId);
    for (const entry of item.inProgress ?? []) if (entry.agentId) inProgress.add(entry.agentId);
  }
  return { open, inProgress };
}

/** What one card says about the human: nothing, waits on them, or waits with nothing recorded. */
type CardWait = "none" | "answered" | "blocked" | "needs_you" | "unrecorded";

/**
 * A card waiting on you that a turn hasn't answered needs you, unless its agent has no open ask and
 * either holds an ask in progress or has children live elsewhere: then those say what it waits on,
 * the card is out of date, and it reads blocked. Needing you with no open ask is unrecorded.
 */
function cardWait(card: PluginWorkspaceAgentCard, recorded: Recorded): CardWait {
  if (card.state !== "waiting_on_you") return "none";
  if (card.answered) return "answered";
  if (recorded.open.has(card.agentId)) return "needs_you";
  const elsewhere = recorded.inProgress.has(card.agentId) || (card.liveChildren?.length ?? 0) > 0;
  return elsewhere ? "blocked" : "unrecorded";
}

/**
 * The cards' verdict: needing you wins; a waiting card that was answered leaves the workspace to its
 * turn state; then a working card that live work backs or that is within `WORKING_GRACE_MS`; then
 * blocked; done only when every card is done.
 */
function cardsWork(
  cards: readonly PluginWorkspaceAgentCard[],
  recorded: Recorded,
  now: number,
): ReportedWork | null {
  let needsYou = false;
  let answeredWait = false;
  let working = false;
  let blocked = false;
  for (const card of cards) {
    const wait = cardWait(card, recorded);
    if (wait === "needs_you" || wait === "unrecorded") needsYou = true;
    else if (wait === "answered") answeredWait = true;
    else if (wait === "blocked" || card.state === "blocked") blocked = true;
    else if (card.state === "working") {
      const since = Math.max(card.updatedAt, card.lastLiveAt ?? 0);
      if (card.live || now - since < WORKING_GRACE_MS) working = true;
    }
  }
  if (needsYou) return "needs_you";
  if (answeredWait) return null;
  if (working) return "working";
  if (blocked) return "blocked";
  if (cards.length > 0 && cards.every((card) => card.state === "done")) return "done";
  return null;
}

/**
 * Agents whose card waits on you while no open ask of theirs records what for, in card order. Your
 * move lists one row each; the human can't answer the card itself.
 */
export function unrecordedWaits(items: readonly WorkspaceSummaryItem[]): UnrecordedWait[] {
  const recorded = recordedAsks(items);
  const waits: UnrecordedWait[] = [];
  for (const item of items) {
    for (const card of item.cards ?? []) {
      if (cardWait(card, recorded) === "unrecorded") {
        waits.push({ agentId: card.agentId, item, updatedAt: card.updatedAt });
      }
    }
  }
  return waits;
}

/**
 * One item's report. An item with `cards` is decided from them, plus its own entries when it marks
 * them as needing you; the item's `workState` is a plugin's old verdict and only counts without cards.
 */
function itemWork(
  item: WorkspaceSummaryItem,
  recorded: Recorded,
  now: number,
): ReportedWork | null {
  if (item.cards === undefined) {
    // COMPAT(plugin-work-state): added in v0.17.2, remove after 2027-02-28. paseo-status before
    // cards sent its own verdict.
    if (item.needsYou || item.workState === "waiting") return "needs_you";
    return item.workState ?? null;
  }
  const entries = item.needsYou && (item.entries?.length ?? 0) > 0 ? "needs_you" : null;
  return moreTelling(cardsWork(item.cards, recorded, now), entries);
}

/**
 * Counts in-progress entries by `isEntryMoving` and picks the group they ask for: as many stuck as
 * moving (and any stuck) needs the human; otherwise machines moving any entry (one not waiting on a
 * review, or live work) keep it working; otherwise every moving entry waits on a reviewer, so it is
 * blocked. Null without entries.
 */
function tallyInProgress(
  items: readonly WorkspaceSummaryItem[],
  movement: MovementContext,
): InProgressTally | null {
  let moving = 0;
  let stuck = 0;
  let awaitingReview = 0;
  for (const item of items) {
    for (const entry of item.inProgress ?? []) {
      if (!isEntryMoving(entry, movement)) stuck += 1;
      else {
        moving += 1;
        if (entry.watched && entry.waitingOnReview) awaitingReview += 1;
      }
    }
  }
  if (moving + stuck === 0) return null;
  let work: ReportedWork = "blocked";
  if (stuck > 0 && stuck >= moving) work = "needs_you";
  else if (movement.liveWork || awaitingReview < moving) work = "working";
  return { moving, stuck, awaitingReview, work };
}

/**
 * Where one workspace's work stands, from every plugin summary item it has. Something waiting on the
 * human wins, then work still going, then work waiting on someone else; done only when nothing else
 * is reported. Live turn state (a running agent, a permission prompt, a failure) is not in here: it
 * wins over all of this where the caller groups the workspace.
 */
export function deriveWorkspaceAttention(
  items: readonly WorkspaceSummaryItem[],
  movement: MovementContext,
): WorkspaceAttention {
  const recorded = recordedAsks(items);
  let reported: ReportedWork | null = null;
  let updatedAt: number | null = null;
  for (const item of items) {
    reported = moreTelling(reported, itemWork(item, recorded, movement.now));
    const at = item.status?.updatedAt;
    if (at !== undefined && (updatedAt === null || at > updatedAt)) updatedAt = at;
  }
  const inProgress = tallyInProgress(items, movement);
  return { work: moreTelling(reported, inProgress?.work ?? null), reported, inProgress, updatedAt };
}

/**
 * The earliest moment after `now` at which time alone changes some workspace's attention: an
 * in-progress entry stops moving, or a working card's grace runs out. Null when nothing will.
 */
export function nextAttentionChangeAt(
  items: readonly WorkspaceSummaryItem[],
  now: number,
): number | null {
  let next = nextNothingMovingAt(
    items.flatMap((item) => item.inProgress ?? []),
    now,
  );
  for (const item of items) {
    for (const card of item.cards ?? []) {
      if (card.state !== "working" || card.live) continue;
      const at = Math.max(card.updatedAt, card.lastLiveAt ?? 0) + WORKING_GRACE_MS;
      if (at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

/**
 * The Status card as Overview shows it. The plugin sends its newest card as written; when that card
 * waits on you but reads blocked here (its agent holds an ask in progress or has children live
 * elsewhere, and owns no open ask), it shows Blocked, with those asks and children as what it waits
 * on, so the card agrees with the sidebar. Otherwise the card is unchanged.
 */
export function deriveStatusCard(
  statusItem: WorkspaceSummaryItem | null,
  items: readonly WorkspaceSummaryItem[],
  agentTitle: (agentId: string) => string | null = () => null,
): PluginWorkspaceStatus | null {
  const status = statusItem?.status ?? null;
  if (!status || status.state !== "waiting_on_you" || status.answered) return status;
  const card = newestCard(statusItem?.cards ?? []);
  if (!card || card.state !== status.state || card.updatedAt !== status.updatedAt) return status;
  if (cardWait(card, recordedAsks(items)) !== "blocked") return status;
  const blockedBy = [...askBlockers(items, card.agentId), ...childBlockers(card, agentTitle)];
  return { ...status, state: "blocked", ...(blockedBy.length > 0 ? { blockedBy } : {}) };
}

/** The agent's asks in progress, as what its card waits on. */
function askBlockers(
  items: readonly WorkspaceSummaryItem[],
  agentId: string,
): PluginWorkspaceBlocker[] {
  return items.flatMap((item) =>
    (item.inProgress ?? [])
      .filter((entry) => entry.agentId === agentId)
      .map((entry) => {
        const blocker: PluginWorkspaceBlocker = { kind: "other", label: entry.title };
        if (entry.waitingOn) blocker.detail = entry.waitingOn;
        if (entry.tone) blocker.tone = entry.tone;
        return blocker;
      }),
  );
}

/** The card's children live elsewhere, by title. */
function childBlockers(
  card: PluginWorkspaceAgentCard,
  agentTitle: (agentId: string) => string | null,
): PluginWorkspaceBlocker[] {
  return (card.liveChildren ?? []).map((agentId) => ({
    kind: "agent",
    agentId,
    label: agentTitle(agentId) ?? agentId,
  }));
}

function newestCard(
  cards: readonly PluginWorkspaceAgentCard[],
): PluginWorkspaceAgentCard | undefined {
  return cards.reduce<PluginWorkspaceAgentCard | undefined>(
    (newest, card) => (!newest || card.updatedAt > newest.updatedAt ? card : newest),
    undefined,
  );
}
