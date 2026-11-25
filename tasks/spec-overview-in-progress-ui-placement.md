# Overview: work in progress — placement options (V)

Map: [spec-overview-in-progress-ui-map.md](./spec-overview-in-progress-ui-map.md). Spec: [spec-overview-in-progress.md](./spec-overview-in-progress.md).

## Area-wide

- **Purpose.** Compare three placements of in-progress work for A4. Every option is drawn on the same
  three workspaces, in the same order, so frames with the same state id compare directly.
- **Workspaces.** Busy: the agent's turn runs, it has 6 subagents (2 working), a background shell, 3
  asks in progress and 1 ask waiting on you. Stuck: the turn ended 8 hours ago, the status card still
  says Working, nothing runs, 5 asks are in progress (3 wait on CI, 2 have nothing moving them).
  Nothing in progress: one ask waits on you, nothing else moves.
- **Device.** Desktop: Overview tab in the Explorer sidebar, ~420 px wide. Mobile: the workspace sheet,
  390 px. Same content, same order.
- **Rows.** As in the approved Overview: one line per row, a name, a muted facts word, a chevron when
  it opens something. Tones as the app's state words: running accent, waiting warning, blocked/failed
  danger, done success, idle muted.
- **Buttons.** Only Your move has buttons, in every option.
- **Permissions.** None beyond opening the workspace.

## V1 Own section (P1)

- **Short.** In-progress work gets its own section, "In progress", directly after Your move.
- **Change.** New.
- **Extended.** One row per agent with a running turn and one per ask in progress. Each agent's
  subagents and background work fold under it as indented lines with counts. Ask rows say what they
  wait on and how long; an ask with nothing moving it is flagged in the warning tone. The section is
  hidden when nothing is in progress. Your move stays above it, so what you must do still comes first.
- **Get here.** Overview tab.
- **Shows.** Section label "In progress" with a count; agent rows ("Track lead · working · 3m"),
  indented "6 subagents · 2 working" and "merge-queue.sh · running 2h" lines, ask rows ("PR #1379 · CI
  running · 20m").
- **Variants.** Busy; stuck; nothing in progress (section absent); mobile sheet of stuck.
- **Edge cases.** A long list (more than five asks) shows five, then "Show all (8)". An agent whose
  turn ends while you look drops out of the section in place.

## V2 Inside Status (P1)

- **Short.** In-progress work is one summary line inside the Status section, under the card's summary.
- **Change.** New.
- **Extended.** The Status section gains a "Moving now" line with counts per kind: "Agent working ·
  6 subagents · 1 shell · 3 asks". Pressing a count opens where those items already live: the agent tab,
  its subagents popover, the Asks tab. No rows, so nothing says what an ask waits on; a stuck ask
  shows only as "2 not moving" in the warning tone. The line is absent when nothing moves.
- **Get here.** Overview tab, Status section.
- **Shows.** Status pill and summary as today, then the "Moving now" line of counts.
- **Variants.** Busy; stuck; nothing in progress (line absent); mobile sheet of stuck.
- **Edge cases.** With no status card the line shows under the state word taken from the agents.

## V3 Under Your move (P1)

- **Short.** In-progress asks join Your move as muted rows after yours, under an "Agent's move" divider.
- **Change.** New.
- **Extended.** Only asks: agents, subagents and background work stay where they are today (tab rings,
  composer pills). The muted rows have no buttons and expand read-only. Your move's heading shows
  whenever either group has rows, so a workspace with only in-progress asks shows "Your move" with
  nothing for you in it.
- **Get here.** Overview tab, Your move section.
- **Shows.** Your rows with buttons; divider "Agent's move · 3"; muted ask rows ("PR #1379 · CI running").
- **Variants.** Busy; stuck; nothing in progress (divider absent); mobile sheet of stuck.
- **Edge cases.** An ask moving from in progress to open moves above the divider and gains its buttons.
