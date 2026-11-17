# Spec: Overview v2: where am I, what's the status, what's my move

Status: draft · 2026-11-17 · storyboard: [`.ai/prototypes/overview-v2/`](../.ai/prototypes/overview-v2/index.html)

Supersedes the layout in [spec-explorer-overview.md](spec-explorer-overview.md). The next-step ladder and attention model stay.
Scope: the Overview tab only. The other Explorer tabs (Files, Changes, PR, Asks, Lineage, Status) stay as they are and act as
"more detail" behind the Overview's rows.

## Context

**Persona: Jacek, the operator.** Runs 10–30 agent workspaces in parallel and switches between them dozens of times a day.
Each time he enters a workspace he needs to find out where he is and whether he has to do something there.

**Top scenarios** (ranked):

1. **Re-orient on entering a workspace**: which workspace and agent this is, where it came from and what it started.
2. **Read where the work stands**: the agent's own report (paseo-status) without opening the Status tab.
3. **Find and do my move**: an ask, a permission, a failure or the git step (merge, archive), then act in one click.
4. Check the code state: branch, diff, PR. Rare: the PR tab and Changes tab cover this in depth.

**Entities on the tab**

| Entity                    | What it's for                                                               |
| ------------------------- | --------------------------------------------------------------------------- |
| Workspace                 | The unit being looked at. Name, project, branch.                            |
| Focused agent             | The conversation driving this workspace.                                    |
| Parent / child workspaces | Where this work came from, and the work it handed off.                      |
| Status card (plugin)      | The agent's own account: state, one-sentence summary, what it is doing now. |
| Ask (plugin)              | A question or approval the agent left for the human.                        |
| Attention item            | Something blocked on the human: permission, failed agent, failing checks.   |
| Git next action           | Commit, push, Create PR, merge, archive: the header's primary action.       |

## Current state (fsh @ 2da7a623a)

Sections, top to bottom (`packages/app/src/panels/overview-panel.tsx:84`): **Next step** · **Agent** · **Lineage** · **Plugins** ·
**Changes** · **Pull request**.

Example from the user's screenshot: a merged docs PR. The tab shows the **Archive workspace** split button as the hero.
Lineage shows `In other workspaces` with 4 rows. Each row's title is the child agent's title, and its subtitle is that
workspace's name, which repeats the same text. Plugins shows `Status · waiting on you · 19h`. It doesn't show Asks.

**Scenario cost (counted)**

| #   | Scenario                                 | Now                                                                                                                                               |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Which workspace is this, parent/children | Workspace name not on the tab; the parent is listed only as an agent; children appear as agents → 0 clicks, but it can't be answered from the tab |
| 2   | Read the status summary                  | 1 click (Status row → Status tab), then read the card                                                                                             |
| 3   | See which asks wait, answer one          | 1 click (Asks tab) + 1 click (ask). With 0 waiting, the tab doesn't show Asks at all                                                              |
| 4   | PR state                                 | 0 clicks (row)                                                                                                                                    |

## Findings

| #   | Rule                                                                                     | Evidence                                                                                                                                                                                                          | Impact |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| F1  | main-scenario: _the choice that shapes later steps comes first_                          | The tab opens on a git action. The workspace identity and status come after it (`overview-panel.tsx:86-99`)                                                                                                       | S1, S2 |
| F2  | main-scenario: _only the main scenario's action visible; rare lifecycle actions under ⋯_ | With nothing pending, the hero is the split button, often **Archive workspace**                                                                                                                                   | S3     |
| F3  | naming: _one name per thing; persona says it aloud_                                      | Lineage row title = child agent title, subtitle = workspace name + project (`lineage-panel.tsx:175-190`). These are usually the same text. `In other workspaces` doesn't say whether they are parents or children | S1     |
| F4  | scope: _every field names the scenario that reads it_                                    | Lineage is agent-centric. The user's question is about workspaces (where did this come from, what did it hand off)                                                                                                | S1     |
| F5  | naming: _no system names in labels_                                                      | Section titled **Plugins** (`overview-panel.tsx:96`). The user thinks "status" and "asks", not "plugins"                                                                                                          | S2, S3 |
| F6  | main-scenario: _every status shows what the user needs to do_                            | The Status summary item carries only a `label` (`paseo-status client/summary.ts`). The summary and "now" text are one click away                                                                                  | S2     |
| F7  | empty-states: _a count of nothing shows 0_                                               | paseo-asks reports only workspaces with waiting asks (`index.client.tsx refreshCounts`). With 0 waiting, Asks is absent rather than "0"                                                                           | S3     |
| F8  | main-scenario: _status re-renders from live state_                                       | The status card says "waiting on you · 19h", but the PR merged afterwards. Nothing marks it as outdated                                                                                                           | S2     |
| F9  | scope: _each new field names the existing one considered_                                | Changes and Pull request take two sections and three rows for facts the header and the PR tab already show                                                                                                        | S4     |

## Desired state

Four blocks, in the order the user asks the questions. No "Plugins" section.

### 1. Header: where am I (no section label)

- **Workspace name** (title), then `project · branch` and a ⋯ menu on the right. The ⋯ menu holds lifecycle actions: Archive
  workspace, Open in editor, Copy branch name.
- **Agent row**: icon with status dot, agent title, `provider · context used`. Pressing it opens the agent.
- **Lineage, as workspaces**:
  - `↑ From` + the parent workspace's name (one row, only when there is a parent);
  - `↓ Started` + child workspaces: one row per **workspace**, not per agent. Each row shows the workspace name and a status
    word (`done · PR merged`, `working`, `waiting on you`). The first 3 show, then `Show all 6`;
  - subagents in this same workspace: one muted line, `2 subagents here`.
  - Pressing a row opens that workspace.
- With no parent and no children, no lineage line is shown.

### 2. Status

- One card: a state badge (Working / Waiting on you / Blocked / Done), the **summary** (≤3 lines), the **Now** line, and
  `updated 19h ago`. Pressing it opens the Status tab for the Done/Next lists.
- **Outdated**: when the workspace changed after the card was written (newer agent turn, PR merged), the age turns into
  `outdated · 19h` and the badge goes muted. paseo-status's `answered` already covers the case where a newer turn exists.
- **No card**: Paseo's own state in one line (`Agent idle · finished 3 min ago`).
- Data: a summary item with `workState` set renders here. paseo-status sets `workState`. The item needs two new optional
  fields, `summary` and `now`.

### 3. Your move

- A list of everything that waits on the human, in the ladder's order: permissions, asks (one row **per ask**, with id and
  title), failed agent, failing checks, then the git next action (Merge PR / Archive workspace / Create PR / Commit).
- Only the **first row** has the filled button. The rest are rows with a chevron.
- Nothing to do while the agent is working: one muted line, `Nothing needs you · agent is working`.
- Data: a summary item with `needsYou` renders its rows here. paseo-asks needs a new optional `entries: {id, title}[]` field
  (≤5), plus a count (0 included) for every workspace that has any asks (F7).

### 4. Code (compact)

- One row: branch, `↑2 ↓0`, `+309 −0`. Pressing it opens Changes.
- One row: PR `#817 title` with a state pill (Open / Checks failing / Ready / Merged). Pressing it opens the PR tab.
- With no PR, the second row is left out. A non-git workspace has no Code block.

### Other summary items

Items with neither `workState` nor `needsYou` (future plugins) render as plain rows at the bottom, under **More**.

### Scenario cost after

| #   | Scenario                    | Before                                    | After                                           |
| --- | --------------------------- | ----------------------------------------- | ----------------------------------------------- |
| 1   | Where am I, parent/children | Can't answer from the tab                 | 0 clicks: header                                |
| 2   | Status summary              | 1 click                                   | 0 clicks                                        |
| 3   | Answer an ask               | 2 clicks (1 when it's first in Next step) | 1 click (the row opens the ask in the Asks tab) |
| 4   | PR state                    | 0                                         | 0                                               |

## What stays

- The next-step ladder (`overview/next-step.ts`) and the attention model. Your move is the ladder shown as a list instead of
  as one item.
- The header's git split button. Decision 1 of the previous spec is unchanged.
- The Lineage tab, agent-level, for the detail: detached links, subagents, other hosts.
- The Status and Asks tabs: "more detail".

## Data / API consequences

- `PluginWorkspaceSummaryItemState` gains optional `summary?: string`, `now?: string`, `updatedAt?: number` and
  `entries?: {id: string; title: string}[]`. All are optional and FSH-only, like `workState`. Older hosts ignore them.
- paseo-status fills `summary/now/updatedAt`. paseo-asks fills `entries` and reports a count of 0.
- Lineage needs a workspace-level derivation: group `deriveLineage` children by `workspaceId`, and take the nearest ancestor
  whose workspace differs.

## Open questions

1. **Outdated rule.** Mark the card outdated when (a) any agent turn started after it, (b) the PR state changed after it, or
   (c) both? Recommend (c).
2. **Child workspace status word.** Decided 2026-11-17: the child's status card when present, else its agent state + PR.
3. **Archive after merge.** Decided 2026-11-17: the filled button in Your move once the PR is merged; under ⋯ otherwise.

## Next step

Approve the storyboard, then `split-prs`: (1) host layout plus the summary-item fields, (2) paseo-status fields,
(3) paseo-asks entries and count 0.
