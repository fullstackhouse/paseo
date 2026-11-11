# Spec: Overview tab in the Explorer sidebar

Status: implemented · 2026-11-11

Companion: [Open Explorer when entering a workspace](spec-explorer-auto-open.md) is a separate PR. It owns
attention items and workspace summary items, which this tab reuses. Either can land first.

## Problem

On desktop the workspace has three columns: the left nav, the chat in the middle, and Explorer on the right.
Explorer holds Files and Changes, plus PR, Lineage and plugin tabs once something adds them. It starts hidden
in every new workspace and never opens unless you open it.

What it takes to move a workspace forward is spread across the window:

- git actions sit in the header split button (`git/workspace-actions.tsx`);
- PR state appears only once its tab is open;
- open asks appear as a plugin pill label, which the host can't read;
- permission prompts and failures show in the chat and as a sidebar dot;
- scripts and Open in editor are header buttons;
- context usage is in the composer.

Nothing answers "what is this workspace's state, and what do I do next?" in one place.

## Goal

Add an **Overview** tab to Explorer on desktop. It summarizes the workspace and offers one **next step** button
that moves it forward: answer, commit, push, open a PR, merge, archive.

Non-goals: compact layouts (they keep sheets and the overlay), new git RPCs, removing header controls,
changing composer pills, when Explorer opens (companion spec).

## Stories

| ID   | Role → goal → outcome                                                                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| US-1 | When I switch to a workspace, I see its state without reading the chat: agent status, changes, PR, asks.                                   |
| US-2 | When the agent is done, one button does the obvious next thing (commit, push, Create PR, merge, archive), and I can see why it's that one. |

## Design

### Overview panel

New panel kind `overview` (`panels/panel-manifest.ts`): `supportedHosts: ["explorer"]`, `singleton: true`,
`showCloseButton: false` (same as Files and Changes), no `compactSheet`. It is the first Explorer tab on
desktop. `createDefaultExplorerSidebarTabs` adds it to new layouts, and a one-time layout step adds it to
existing ones. A new tab kind touches about 8 files (identity, both tab rows, the tab menu, the launcher, the
legacy filter). Follow the Lineage change as the template.

Top to bottom:

| Section          | Content                                                                                                                                   | Reuses                                                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Next step**    | One `default` button (the surface's only accent), a reason line, and the other git actions as a `ghost` "More" dropdown                   | `useGitActions` → `buildGitActions` primary; see ladder below                          |
| **Agent**        | Focused agent (same rule as Lineage): status, facts line, context meter. A Lineage row ("Started by X · 2 started") when it has relatives | `useAgentFactsLine`, `ContextWindowMeter`, `deriveLineage`                             |
| **Changes**      | Branch → upstream, +/−, ↑/↓, uncommitted yes/no. The row opens Changes                                                                    | `GitSyncCardContent`, `useVisibleWorkspaceDiffStat`                                    |
| **Pull request** | State icon, #number, title, checks summary, review decision. The row opens the PR tab. "No pull request" when there is none               | `useCheckoutPrStatusQuery`, `summarizeChecks`, `PullRequestStateIcon`                  |
| **Plugins**      | One row per workspace summary item (Asks: "2 waiting on you"). The row opens the plugin's panel in Explorer                               | `addWorkspaceSummaryItem` (companion)                                                  |
| **Workspace**    | Open in editor, scripts with run state (start/stop), host                                                                                 | `WorkspaceOpenInEditorButton` targets, `useWorkspaceScriptActions`, `summarizeScripts` |

Sections use settings-style cards (`settingsStyles.card`, rows with `rowBorder`). The next-step button is the
only accent; everything else is rows. A section with nothing to say collapses to one muted row, or is left out
for non-git workspaces. Header controls stay in v1 (Decision 1).

The tab is the first Explorer tab and the selected one in new layouts. With the companion setting on
**Always**, entering a workspace with nothing that needs you lands here.

### Next-step ladder

The first rule that matches wins. Rules 1–3 are the companion's attention items (`useWorkspaceAttention`), in
the same priority order. Each rule is a pure function of data the app already has:
`deriveOverviewNextStep(input) → { kind, label, reason, run }` in `workspace-overview/next-step.ts`,
unit-tested.

| #   | When                                               | Button                                        | Action                                                                                                |
| --- | -------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1   | An agent in the workspace has a pending permission | Review permission                             | Focus that agent's tab                                                                                |
| 2   | A summary item has `needsYou` (Asks)               | Answer 2 asks                                 | Open the plugin's Explorer tab                                                                        |
| 3   | An agent failed                                    | Open agent                                    | Focus it                                                                                              |
| 4   | An agent is running                                | none; the reason line says "Agent is working" | –                                                                                                     |
| 5   | The PR's checks are failing                        | Open pull request                             | Open the PR tab (Decision 2: "Ask agent to fix" later)                                                |
| 6   | Otherwise                                          | The git policy's primary action               | `GitActions.primary`: Commit, Pull and push, Push, Create PR (agent prompt), Merge, Archive workspace |

Rule 6 is the existing header button's primary action, so the Overview and the header never disagree. The
Overview shows the same action in a bigger place. Archive keeps its confirm dialog and risk warnings
(`git/worktree-archive-warning.ts`).

If the companion hasn't landed yet, rule 2 and the Plugins section are left out. Rules 1 and 3 read the
session store directly.

## Decisions

1. **Header duplication:** the scripts, editor and git split buttons stay in the header in v1. Revisit once
   the Overview has been used.
2. **"Ask agent to fix" for failing checks:** later, in phase 3. It needs a daemon prompt like Create PR
   (`useAgentPr`, `checkout.pr.agent_prompt.*`). v1 offers Open pull request.

## Open questions

1. **Dirty file count.** Status has only `isDirty` and `diffStat`. v1 shows "+120 −14 uncommitted" from the
   diff stat. A file count would need the working diff; skip it.

## As built

- The Workspace section (scripts, Open in editor, host) is left out of v1: those stay in the header (Decision 1).
- The agent row shows the focused agent's status and context use; pressing it opens the agent.
- The next step's git action is the header's `GitActionsSplitButton` itself, fed by the same `useGitActions`.
- Git sections show for checkouts and worktrees (`workspaceKind !== "directory"`); the git button waits for git status.
- The tab is added once per workspace on entering it (desktop), first in the rail, with Lineage's close opt-out.

## Phases

1. `deriveOverviewNextStep`, with unit tests for every ladder rule and the priority between them.
2. `overview` panel kind and Explorer tab: sections built from existing hooks and components. Verify in a
   `paseo-run` window against real workspaces (clean, dirty, ahead, PR open/red/green/merged, non-git).
3. "Ask agent to fix checks" prompt (daemon `checkout.pr.agent_prompt` variant). Optional.
4. Docs: `docs/explorer-sidebar.md` (Overview tab), glossary entry for **Overview**, FSH.md patch line.

## Verification

- Unit: `next-step.test.ts` (each ladder rule, priority between them).
- Manual (`paseo-run`, desktop): walk the states (working, permission, asks, commit, push, Create PR, checks red, merge, merged, plain folder) with real workspaces. For each, check the
  button matches the header split button's primary action.
