# Spec: Overview shows work in progress

Status: stage 2 (cards) in progress · 2026-11-25

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

To be written once the UI map and cards are agreed. Known gaps:

- **Waits on (A7).** paseo-asks gains an optional `waitingOn` string on an ask, set by the agent with
  `ask_update(status: "in_progress", waitingOn: "…")` and cleared when the ask leaves in progress; the
  agent instructions get one line asking for it. PR asks derive the word from the PR state the plugin
  already polls. The workspace summary item carries in-progress entries with that word.
- **Nothing moving (A8).** The host decides, per in-progress ask: its owner agent's turn runs, the
  workspace has live background work (`isRunning` without `agentRunning`), or the ask watches an open PR
  (`subscribe` and PR state open, from the summary entry). None of these → "nothing moving".
- **Status age and warning (A9).** Host-only: the card's `updatedAt`, and the workspace's live state
  from the session store.
- **Take it back / Remind agent (A10).** Two new human actions in paseo-asks: `reopen` sets an
  in-progress ask to open with its existing actions and tells the owner "[asks] A174: the human took it
  back"; `remind` sends the owner "[asks] A174 shows nothing moving: update it or hand it back". Overview
  renders in-progress entries with the plugin's `EntryComponent`, as it does for waiting ones.
- **Archive (A11).** `deriveYourMove` treats in-progress asks as open work: no Archive while any exists.
- Provider subagents and background shells are visible to the host as `isRunning` without a list of
  what runs (`workspace-attention/model.ts`, `subagents/track.tsx`).

## Changelog

- 2026-11-25 — stage 1 UI map drafted; placement options drawn (V1–V3); A4–A11 decided; stage 1 approved (A12).
