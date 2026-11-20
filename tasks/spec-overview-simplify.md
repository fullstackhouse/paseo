# Spec: Overview, simplified: title → goal → status → your move

Status: design approved · 2026-11-20 · reviewed: `fsh` @ 3e3340aae (`packages/app/src/panels/overview-panel.tsx`)

Follows [spec-overview-v2.md](spec-overview-v2.md). Its section order stays. This spec removes what repeats and puts the
four things the operator reads on entering a workspace at the top, with nothing between them.

## Context

**Persona: the operator.** Runs 10–30 agent workspaces in parallel and switches between them dozens of times a day. On
entering a workspace, Overview sits in the Explorer sidebar next to the agent's conversation.

**Top scenarios** (ranked)

1. **Know what this workspace is**: its title and the one-sentence goal.
2. **Read where it stands**: the agent's status summary, in more detail than the goal.
3. **Do my move**: answer an ask, review a permission, merge, archive. One click.
4. Rare: check branch, diff and PR state. The Changes and PR tabs in the same tab bar cover this.

**What each entity is for**

| Entity        | What it's for                                                                   |
| ------------- | ------------------------------------------------------------------------------- |
| Workspace     | The unit of work. Its name is the title of everything on this tab.              |
| Goal          | One sentence: what this workspace is meant to achieve (paseo-status `goal`).    |
| Status        | The agent's account of where the work stands: state word, summary, what's next. |
| Your move     | What waits on the human, then the git step.                                     |
| Focused agent | The conversation driving the workspace. Already open in the main pane.          |
| Branch / PR   | Where the code lives. Already a tab (`Changes`, `#141`) in the same tab bar.    |

## Current state

Example: the screenshot of workspace "Fix blank page on atlas anchor navigation" after PR #141 merged. Top to bottom:

| #   | Element (code)                                                            | Shows                                                                   |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | Header title (`WorkspaceHeader`, `overview-panel.tsx:207`)                | Fix blank page on atlas anchor navigation                               |
| 2   | Header subtitle, project · branch (`:202`)                                | paseo · fix/atlas-anchor-nav-blank-page                                 |
| 3   | Agent row title (`FocusedAgentRow`, `:317`)                               | Fix blank page on atlas anchor navigation                               |
| 4   | Agent row facts, context usage (`:307`)                                   | Context 147k / 1m                                                       |
| 5   | Section label "Goal" + goal (`:154`)                                      | Fix the blank HTML preview when you click an in-page anchor link.       |
| 6   | Section label "Status", badge + age (`StatusSection`, `:516`)             | Done · updated 35m ago                                                  |
| 7   | Status summary (`:522`)                                                   | PR #141 is merged into fsh. In-page anchor links no longer blank…       |
| 8   | Status "Now" line (`:527`)                                                | Now Nothing left.                                                       |
| 9   | Section label "Your move", git row title + facts (`gitMoveTitle`, `:787`) | PR #141 merged · In sync                                                |
| 10  | First move button (`:683`)                                                | Archive workspace                                                       |
| 11  | Section label "Code", branch row (`CodeSection`, `:805`)                  | fix/atlas-anchor-nav-blank-page · In sync                               |
| 12  | PR row (`:840`)                                                           | #141 fix(app): keep fragment links inside the web HTML preview · Merged |

Plus, when present: lineage rows (From / Started / subagents here), the More section (plugin facts).

**Scenario cost (counted from the screenshot)**: text items read, top to bottom, before the item the scenario needs.
No scenario needs a click except S3's button.

| Scenario        | Items read before it                                                                    | Clicks |
| --------------- | --------------------------------------------------------------------------------------- | ------ |
| S1 title + goal | 6 (title, subtitle, agent title, context, "Goal", goal)                                 | 0      |
| S2 status       | 10 (+ "Status", badge, age, summary)                                                    | 0      |
| S3 your move    | 15 (+ Now, "Your move", PR merged, In sync, button)                                     | 1      |
| Whole tab       | 22 items, 5 of them repeats (3 = 1, 11 ⊂ 2, 12 ≈ 9, 11 ≈ 9's facts, PR tab `#141` ≈ 12) | –      |

## Findings

### F1. The workspace title shows twice

- Rule: naming, _one name per thing_; scope, _no text that restates its container_.
- Evidence: element 3 repeats element 1. Agents title their workspace after their own chat, so this is the common case.
  The agent is also already open in the main pane, so the row's press (open agent) is rarely needed on desktop.
- Impact: S1. The second heading-sized line pushes the goal down and reads like a second thing.

### F2. Context usage nobody reads here

- Rule: scope, _every field names the scenario that reads or sets it_.
- Evidence: element 4, `FocusedAgentRow` `:297-312`. None of S1–S4 needs it; the composer already shows context for the
  agent you are talking to.
- Impact: S1, noise.

### F3. "updated 35m ago" carries no decision

- Rule: scope, _every field names the scenario that reads it_; main-scenario, _every status re-renders from live state_.
- Evidence: element 6, `:516`. The age only matters when the card may be outdated (the agent worked or the PR changed
  since). In every other case it is noise, and when it is outdated the age doesn't say so.
- Impact: S2.

### F4. "Now: Nothing left." restates "Done"

- Rule: scope, _no text that restates its container_.
- Evidence: element 8, `:527`, shown whatever the state.
- Impact: S2.

### F5. Section labels between title, goal and status

- Rule: main-scenario, _each step offers one forward action_ / _no click-through holding no decision_ (opinion, extended
  to reading order).
- Evidence: "Goal" and "Status" labels, `:154`, `:534`. Title → goal → status is one paragraph of identity; labels split
  it into three sections and the goal reads as metadata instead of the subtitle.
- Impact: S1, S2.

### F6. Branch and PR shown up to four times

- Rule: naming, _one name per thing_; list-and-detail, _every record has one screen, others link to it_.
- Evidence: branch in the header subtitle (2) and the Code branch row (11); the PR in the move title (9), the Code PR
  row (12) and the `#141` Explorer tab; "In sync" twice (9, 11). The branch name is usually a slug of the title.
- Impact: S3 is pushed down by S4 data; S4 itself is rare and has its own tabs.

### F7. "In sync" shown as a fact

- Rule: empty-states, _a missing value shows nothing; words only where the absence is actionable_.
- Evidence: `syncFacts` `:847` returns "In sync" when ahead and behind are 0. Nothing to do about it, and after a merge
  it means nothing.
- Impact: S3.

Passes: Your move has one button (main-scenario); lifecycle actions sit in ⋯ (main-scenario); status re-renders from
live state (main-scenario); lineage rows by workspace (naming, from v2).

## Desired state

Top to bottom. The first four lines answer S1–S3 with no labels and no repeats.

1. **Title**: workspace name. No ⋯ menu: archive, editor and branch actions already live in the workspace header and the sidebar.
2. **Goal** as the title's subtitle, regular weight, muted, up to 2 lines. No "Goal" label. (F5)
   Without a goal: the project name in its place (Q2, decided).
3. **Status** without a section label: state badge, then the summary, up to 4 lines. Press opens the Status tab
   (unchanged). (F5)
   - No age, unless the card is outdated: then `outdated · 35m` in warning colour (Q1, decided). (F3)
   - "Now" line only when state is not `done`. (F4)
   - No card: one muted line, as today.
4. **Your move** (label stays, it's the only actionable section).
   - Git row after merge: title `PR #141 merged`, no facts, button **Archive workspace**. (F7)
   - Git row before merge: facts only when there is something to say (`↑2`, `+10 −3`, `Uncommitted changes`). No
     "In sync". (F7)
5. **Agent row** (only when it differs, Q3) and **Lineage** rows (unchanged) — From / Started / subagents here.
6. **Code**: at most one row, and none when it repeats Your move. (F6)
   - PR exists and not named by the move row: the PR row (title, checks/review facts). Branch row dropped.
   - No PR: the branch row with diff facts, only when it has facts (ahead/behind, diff, uncommitted).
   - Otherwise no Code section. Changes and PR stay one press away in the tab bar.
7. **More** (unchanged).

Removed: the header's `project · branch` subtitle (F6, replaced by the goal), the agent row (F1, F2; see Q3),
"Goal" and "Status" labels (F5), "updated …" (F3), "In sync" (F7).

**Cost after** (same screenshot)

| Scenario        | Before (items read · clicks) | After (items read · clicks)              |
| --------------- | ---------------------------- | ---------------------------------------- |
| S1 title + goal | 6 · 0                        | 2 · 0 (title, goal)                      |
| S2 status       | 10 · 0                       | 4 · 0 (+ badge, summary)                 |
| S3 your move    | 15 · 1                       | 7 · 1 (+ "Your move", PR merged, button) |
| Whole tab       | 22 items, 5 repeats          | 7 items, 0 repeats                       |

## What stays

- Status press → Status tab; ask entries answered in place; the one-button Your move.
- Lineage block and its rows: answers "where did this come from" (v2 S1), not shown in this screenshot.
- Archive, open in editor, copy branch: in the workspace header and the sidebar, not on Overview. Lineage details: the Lineage tab.
- PR checks and review state: on the PR row, or on the git move row when that row names the PR.
- More: plugin facts that fit nowhere else.

No data or protocol change: everything is presentation in `overview-panel.tsx`. `formatTokens` and the context i18n key
go away.

## Open questions

### Q1. When does the status card show its age? — decided: B (2026-11-20)

Options: A. never / B. only when outdated (the workspace had agent activity or a PR change after `updatedAt`), as
`outdated · 35m` / C. always (today). Recommended: B. The age only matters when the summary may be wrong, and today's
format doesn't say that.

Implemented as: a prompt reached one of the workspace's agents after the card's last update, and no agent runs now.
`lastActivityAt` was rejected because it moves on renames and mode or model changes. PR state carries no timestamp on
the client, so a PR change alone doesn't flag the card.

### Q2. What fills the subtitle when there is no goal? — decided: A, project name (2026-11-20)

Options: A. project name / B. nothing, the status summary moves up / C. project · branch (today). Recommended: A. The
sidebar groups by project, but the Explorer is often seen without the sidebar, and many workspaces have no paseo-status.

### Q3. Remove the agent row, or keep it when it adds something? — decided: B, only when it differs (2026-11-20)

Options: A. remove it / B. show it only when its title differs from the workspace name or the workspace has more than one
root agent / C. keep, without context usage. Recommended: B. The agent is already in the main pane in the common case;
in a workspace with several agents the row tells which one Overview describes.

## Design

Storyboard: [`.ai/prototypes/overview-v3/`](../.ai/prototypes/overview-v3/index.html), 11 states at desktop and mobile. It
designs from the operator's questions rather than today's components: what is this (title, goal), where does it stand
(state word, summary), what do I do (Your move, answered in place), then one-line context. Where it differs from the
Desired state above, the storyboard wins once approved.

## Next step

Approve this spec → one-screen change, so a storyboard is optional; build as one PR with `overview-panel.tsx` tests for
the removed repeats (title equality, merged PR, no-goal fallback).
