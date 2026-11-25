# Sidebar: work in progress — placement options (V)

Map: [spec-sidebar-in-progress-ui-map.md](./spec-sidebar-in-progress-ui-map.md). Spec: [spec-sidebar-in-progress.md](./spec-sidebar-in-progress.md).

## Area-wide

- **Purpose.** Compare three groups for an idle workspace whose open work is all in progress and moving.
  Every option is drawn on the same sidebar, so frames with the same state id compare directly.
- **Sidebar.** Seven workspaces in one project: "Fix login redirect" (an agent asks a permission →
  Needs input), "Track: Billing pages" (the one in question: turn ended, 3 asks wait on CI and review, a
  merge queue runs, nothing waits on you), "Track: Search" (asks you to name a tab → Ready to review),
  "Docs: release notes" (agent running → Working), "Track: Catalog" (5 asks in progress, 2 with nothing
  moving them), "Upgrade Expo" (Done), "Schema: relations" (Blocked on another workspace).
- **Device.** Desktop sidebar, ~300 px wide, light theme as in the Overview atlas.
- **Rows.** As today: status ring or dot, title, project, a badge line ("needs you (2)") and the time since
  last activity.
- **Permissions.** None.

## V1 Working (P1)

- **Short.** A workspace whose in-progress work is all moving groups under Working.
- **Change.** New.
- **Extended.** "Track: Billing pages" sits under Working next to "Docs: release notes", whose agent runs.
  Its row has no spinning ring (nothing of its own runs a turn) and its badge line says "3 in progress".
  "Track: Catalog", with 2 asks nothing moves, stays in Ready to review and says "2 not moving" in the
  warning tone.
- **Get here.** The sidebar.
- **Shows.** The seven rows in their groups; the Billing row under Working with "3 in progress".
- **Variants.** All seven workspaces; the Billing PRs' CI finishes and two asks go stuck (the row moves to
  Ready to review with "2 not moving").
- **Edge cases.** A merge queue job still running keeps the row under Working even after the asks are
  resolved; it leaves when the job ends.

## V2 Blocked (P1)

- **Short.** A workspace whose in-progress work is all moving groups under Blocked.
- **Change.** New.
- **Extended.** Blocked already means "waits on something other than you: other workspaces, a reviewer,
  CI". "Track: Billing pages" joins "Schema: relations" there, at the bottom of the sidebar, with "3 in
  progress". "Track: Catalog" stays in Ready to review with "2 not moving".
- **Get here.** The sidebar.
- **Shows.** The seven rows; Billing under Blocked, last group.
- **Variants.** All seven workspaces; two of Billing's asks go stuck (the row moves to Ready to review).
- **Edge cases.** Blocked can be collapsed past its limit like Done, so the row may be hidden until you
  expand the group.

## V3 Stays in Ready to review (P1)

- **Short.** No group change; the row's badge line tells moving work apart from work that needs you.
- **Change.** New.
- **Extended.** "Track: Billing pages" stays in Ready to review with a muted "3 in progress" badge and no
  "needs you". "Track: Search" next to it says "needs you (1)"; "Track: Catalog" says "2 not moving" in the
  warning tone. Reading the badges is how you tell them apart.
- **Get here.** The sidebar.
- **Shows.** The seven rows; three under Ready to review with different badges.
- **Variants.** All seven workspaces; two of Billing's asks go stuck (badge turns to "2 not moving").
- **Edge cases.** Move to Done from the row menu still moves it, as today.
