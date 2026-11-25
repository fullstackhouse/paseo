# Spec: Overview shows work in progress

Status: design approved (atlas `.ai/prototypes/overview-in-progress/`) · 2026-11-25 · 2026-11-25

Follows [spec-overview-tree.md](spec-overview-tree.md). UI map: [spec-overview-in-progress-ui-map.md](spec-overview-in-progress-ui-map.md).

## Problem

Overview answers "what waits on me", but says nothing about work that is moving without the human. A
workspace can look finished, or show nothing at all, while its agent's subagents run, a background shell
works through a merge queue, and five asks sit in progress waiting on CI or a release.

Seen 2026-11-24: Track: Detail pages sat in Ready to review with 5 asks in progress. Overview showed a
"Working" status card 8 hours old and nothing else, so there was nothing to read and nothing to act on.
Two of those asks had nothing behind them: their watchers had died in a session restart.

A first attempt, an "Asks · N in progress" fact row that opened the Asks panel (paseo-asks#87), was
rejected: it read as a footnote and hid the asks behind another click.

## Goal

From Overview alone the human can tell:

- what is running right now in this workspace, and since when;
- what the agent has taken on but not finished (asks in progress), and what each waits on;
- when a status says "Working" but nothing is running behind it.

Non-goals: changing what Your move holds; acting on another agent's work from Overview; the sidebar
grouping (Ready to review vs Working), which may follow in a later spec.

## Today (`packages/app/src/panels/overview-panel.tsx`)

Identity → Status → Waiting on → Your move → Tree → Context → Pull requests. None of them lists a running
agent, subagents, background shells or in-progress asks. Inventory of where in-progress work shows
elsewhere: [UI map → Baseline](spec-overview-in-progress-ui-map.md#baseline).

## Mechanism

Two PRs. paseo-asks ships first; hosts without the new field ignore it, and the new Overview sections
render nothing until a plugin sends it.

### Contract (`packages/plugin/src/client/contracts.ts`, FSH-only)

`PluginWorkspaceSummaryItemState` gains `inProgress?: PluginWorkspaceInProgressEntry[]`: things this
plugin's agents have taken on but not finished, one In progress row each. An empty list says there are
none. Like `entries`, the host renders an expanded row with the item's `EntryComponent`.

```ts
export interface PluginWorkspaceInProgressEntry {
  id: string; // "A158"
  title: string; // "PR #2104 — invoices list"
  /** What it waits on: "CI running", "review requested", "next release". Age only when omitted. */
  waitingOn?: string;
  /** Colors `waitingOn`. */
  tone?: "success" | "warning" | "danger" | "muted";
  /** The agent that holds it; its running turn counts as movement. */
  agentId?: string;
  /** True while something outside the agent will report back, such as a watched open PR. */
  watched?: boolean;
  /** When it last changed, epoch ms: the row's age and its sort key. */
  updatedAt: number;
}
```

`PluginWorkspaceSummaryEntryProps` gains `nothingMoving?: boolean`, so the expanded entry's facts line
agrees with the row.

### paseo-asks

- **Waits on (A7).** Optional `waitingOn` on an ask: `ask_update(status: "in_progress", waitingOn: "…")`,
  cleared when the ask leaves in progress; one line in the agent instructions asks for it (stay under the
  4096-character cap). PR asks derive it from the polled PR state: checks running → "CI running",
  review required → "review requested", merged → "merged · waiting on the agent" (muted).
- **Summary.** `client/summary.ts` publishes `inProgress` on the existing `asks` item (`watched` = a
  subscribed ask whose PR is open). Snoozed workspaces still list them: they are information.
- **Actions (A10).** `reopen`: in progress → open, existing actions kept, owner told "[asks] A174: the human
  took it back". `remind`: owner told "[asks] A174 shows nothing moving: update it or hand it back"; the
  ask records `remindedAt` (field exists) and the entry shows "Reminded just now" until it changes.
- **Entry (O5).** `OverviewAskEntry` renders in-progress asks: body (first lines, More), facts line
  ("Waits on … · taken 20m ago · last moved 5m ago", warning tone with `nothingMoving`), links, and quiet
  buttons Take it back, Remind agent (absent when the owner is archived), Show in chat.

### Host (fsh)

- **O4 rows.** A new `InProgress` section after Your move, from three sources:
  - in-progress entries from summary items (`inProgress`);
  - agents in the workspace with a running turn, subagents running (`subagents/` track data) or live
    background work (`agent.background_work.list`, gated on `server_info.features.agentBackgroundWork`);
  - per agent, one folded subagents line (counts as in the track pill) and one line per background item
    (`description`, else kind; age from `startedAt`).
    Each row's time is "since it last changed" (A21): entry `updatedAt`, agent last activity, job
    `startedAt`. Rows sort oldest first (A13); five, then Show all (A14).
- **Nothing moving (A8, A19).** An entry is flagged when its `agentId` has no running turn, the workspace
  has no live background work, it is not `watched`, and its `updatedAt` is over 10 minutes old.
- **One open row (A15).** The pinned-row state that Your move keeps today covers In progress rows too.
- **Archive (A11, A17).** `deriveYourMove` counts in-progress entries as open work; the `archive-held` row
  goes.
- **Status (A9, A18).** "· updated 8h ago" next to the state word; the warning line when the card says
  Working and the workspace runs nothing (`isRunning` false).

## Changelog

- 2026-11-25 — stage 1 UI map drafted; placement options drawn (V1–V3); A4–A11 decided; stage 1 approved (A12).
- 2026-11-25 — stage 2 cards and mockups approved (A13–A20); A21 times since last change; mechanism and contract written (A22).
