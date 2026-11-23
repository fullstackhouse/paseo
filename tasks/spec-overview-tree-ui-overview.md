# Overview: tree and PRs — cards (O, E)

Map: [spec-overview-tree-ui-map.md](./spec-overview-tree-ui-map.md). Spec: [spec-overview-tree.md](./spec-overview-tree.md).

## Area-wide

- **Who.** The operator, running 10–30 agent workspaces; their agents handle git and PRs.
- **Device.** Desktop: Overview tab in the Explorer sidebar, ~360–480 px wide. Mobile: the workspace
  sheet, full width. Same content, same order.
- **Rows.** Every relation and PR row is one line: a label or name, a muted facts word, a chevron when
  it opens something. Tones as the app's state words: running accent, waiting warning, blocked/failed danger, done
  success; idle, archived and not-loaded muted.
- **Sections** render nothing when empty: no heading, no "none" placeholder.
- **Live.** Rows update in place as other workspaces' status cards and PR facts change; no refresh
  control.
- **Permissions.** None beyond opening the workspace.

## O1 Overview tab (P1)

- **Short.** The workspace at a glance: what it is, where it stands, what waits on you, where it sits,
  its PRs.
- **Extended.** Read top to bottom: Identity (title, goal), Status, Waiting on (PR, person, other
  blockers), Your move (E1), Tree (O2), Context (E2), Pull requests (O3). Only Your move has
  buttons. Git is no longer a move: the agent handles it, and PRs show at the end for information.
- **Get here.** Overview tab in the Explorer sidebar; on mobile, the workspace sheet.
- **Shows.** Title; goal as subtitle; state word and summary; Waiting on; Your move rows; Tree (with
  agents); plugin facts; Pull requests.
- **Scenarios.** Entering a child workspace that waits on an ask: answer it, glance at the parent
  above, leave. Checking a finished workspace: Status says done, Archive in Your move, the PR row says
  merged.
- **Variants.** Working (no move, tree and PRs below); waiting on an ask (move first, rest below);
  done and merged (Archive move, merged PR); a bare workspace with no relations and no PR (only
  identity and status); mobile sheet of the waiting state.
- **Edge cases.** Status card missing → the state word comes from the agents ("Working", "Idle"), as
  today. Git status still loading → the Pull requests section is absent until it loads, without a
  spinner.

## O2 Tree (P1)

- **Short.** Where this workspace sits among others: who started it, what it started, what blocks it,
  what it blocks, and how many agents work in it.
- **Extended.** Up to five groups, each only when it has rows, in this order:
  - **Started by** — the ancestor chain, root first, down to the direct parent. No indentation: every label and row
    starts at the same left edge; the order and the group labels carry the hierarchy.
  - **This workspace** — one highlighted row anchoring the chain; only when there are both ancestors
    and children. With more than one top-level agent it reads "Impl — tree section · 3 agents" and
    opens the Lineage tab; otherwise it is not pressable.
  - **Agents** — "Agents · 3 here", opening the Lineage tab: only with more than one top-level agent
    and no This workspace row. Placed where This workspace would be (after Started by, before
    Started).
  - **Started** — direct children: needing you first (Waiting, Blocked, Failed), then newest first;
    five shown, then "Show all (N)". A child that started
    others shows "· 3 started" after its state word.
  - **Blocked by** — workspaces and agents named in this workspace's status `blockedBy` (only while the
    status says blocked). An agent blocker shows the agent's title and its workspace.
  - **Blocking** — workspaces whose current, blocked status names this workspace or one of its agents.
    Pressing a workspace row opens that workspace (its Overview); an agent row opens that agent.
- **Get here.** Section of O1, directly after Your move.
- **Shows.** Section label "Tree"; per row: name, state word in its tone ("Working", "Waiting",
  "Blocked", "Done · PR merged"), chevron.
- **Scenarios.** An impl workspace started by a spec agent: "Started by: Spec — overview rework"
  above, two review forks below. A workspace waiting on another's PR merge: "Blocked by: Schema — relations model · Working".
- **Variants.** Parent chain + this + children; deep chain (3 ancestors); many children (Show all);
  blocked by a workspace and an agent; blocking two workspaces; only children (a root); several
  agents with no This workspace row (Agents row).
- **Edge cases.** An ancestor or child on a host that isn't connected → its last known name, muted, with the
  word "Not loaded"; not pressable. An archived parent → the row shows "Archived" and still opens it. A blocker
  workspace that no longer exists → "Removed workspace", muted, not pressable. A workspace that both
  blocks and is blocked by the same one shows in both groups.

## O3 Pull requests (P1)

- **Short.** The PRs this workspace's work lives in, for information.
- **Extended.** Lists every PR paseo-prs relates to the workspace: the branch's PRs, their stack and
  PRs linked from any repository. Every open PR shows; merged and closed ones fold into one muted "3 merged" row that expands.
  With no open PR, the merged ones show directly. Each row: `#123`, title,
  facts ("2 failing", "changes requested", "approved", "checks running", "checks passing",
  "merged", "draft"); the
  most urgent fact wins the tone. A PR from another repository prefixes its repo name (`paseo-prs#58`); the owner
  too only when two linked repos share a name. Without
  paseo-prs installed, the branch's PR from the host's git status. With no PR, one row "No PR yet"
  with the branch facts ("3 commits · +120 −8 · uncommitted") and the branch name small and muted at
  the end. No buttons: fixing and merging is the agent's or the asks' job.
- **Get here.** Last section of O1.
- **Shows.** Section label "Pull requests" with a count of all related PRs (merged included) when more than one; the rows above.
- **Scenarios.** A stacked 4-PR feature: all four, the failing one red. A multi-repo change: the paseo
  PR and the paseo-prs plugin PR, the second shown as `paseo-prs#58`.
- **Variants.** One open PR with checks passing; failing checks (red) and changes requested; a stack
  of several PRs with two merged (folded); merged PR; no PR with branch facts; linked PR from
  another repo.
- **Edge cases.** GitHub unreachable or `gh` signed out → rows keep their last facts and the section
  label adds "· not refreshed"; no error block. A branch with nothing to report and no PR → section
  hidden. The default branch with no PR → section hidden.
- **Opens.** Pressing a branch-PR row opens the PR tab in Explorer; any other PR opens on GitHub. The
  "No PR yet" row opens the Changes tab.

## E1 Your move (P1)

- **Short.** What waits on you, and nothing else.
- **Extended.** Asks, permissions and failed agents in the attention order, as today. Once the work
  shipped (PR merged, or status card done) and the workspace is a worktree or its PR merged, Archive
  closes the list. No Create PR, Push, Pull or Merge from base row and no failing-checks row; the PR
  row in O3 carries those facts.
- **Get here.** Section of O1, after Status and Waiting on.
- **Shows.** Section label "Your move" with a count when more than one; one row open with its
  buttons, the rest compact.
- **Variants.** One ask open; ask + permission; failed agent; Archive alone after a merge; empty
  (section hidden) with an unpushed branch, where the old Push row used to be.
- **Edge cases.** The PR merged while an agent still runs → no Archive until the agent stops, as
  today. Archive fails → the row shows the error under its title and stays.

## E2 Context footer (P1)

- **Short.** The remaining one-line facts: plugin facts.
- **Extended.** Loses From, Started and Agents (now O2) and the PR or branch row (now O3). Keeps
  plugin facts without a status or a move.
- **Get here.** Section of O1, between Tree and Pull requests.
- **Shows.** Unlabelled rows: label, value, chevron.
- **Variants.** Two plugin facts; hidden when there is nothing to say.
- **Note.** None of the installed plugins publish plain facts (paseo-status fills Status, paseo-asks
  fills Your move), so today the footer stays hidden; it remains for third-party plugins.
- **Edge cases.** None beyond today's.

## Decisions (cards, 2026-11-23)

1. Children needing you (Waiting, Blocked, Failed) come first, then newest first (A10).
2. Open PRs all show; merged and closed fold into one "N merged" row; with none open, merged show
   directly (A11).
3. Tree group labels: Started by, This workspace, Started, Blocked by, Blocking (A12).
4. The "This workspace" row shows only with both ancestors and children (A13).

## Decisions (atlas, 2026-11-23)

1. The top blocker block is renamed "Waiting on" (PR, person, other); "Blocked by" is the Tree's group
   for workspaces and agents (A15).
2. A linked PR shows its repo name only (`paseo-prs#58`); the owner only when two repos share a name
   (A16).
3. Agents fold into the Tree: on the This workspace row ("· 3 agents"), else an "Agents · 3 here" row;
   the footer keeps only plugin facts (A18).
