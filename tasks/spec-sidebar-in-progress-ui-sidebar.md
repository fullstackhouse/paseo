# Sidebar: work in progress — cards (S)

Map: [spec-sidebar-in-progress-ui-map.md](./spec-sidebar-in-progress-ui-map.md). Spec: [spec-sidebar-in-progress.md](./spec-sidebar-in-progress.md).

## Area-wide

- **Who.** The operator scanning 10–30 workspaces to pick the next one that needs them.
- **Device.** Desktop sidebar, ~300 px; the mobile drawer shows the same groups and rows.
- **Moving.** As on Overview: an in-progress item moves while its agent's turn runs, a live background job
  runs, or it watches an open PR; otherwise, after 10 minutes, it is "not moving" (Overview A8, A19).
- **Precedence**, first match wins, for an idle workspace: a permission (Needs input) or a failure (Failed),
  as today → an open ask or "not moving" work (Ready to review) → moving work on machines (Working) → work
  waiting only on a reviewer (Blocked) → the status card's report → the finished turn.
- **Permissions.** None.

## S1 Sidebar groups (P1)

- **Short.** Where an idle workspace lands now that its in-progress work counts.
- **Change.** Changed — in-progress work now decides the group of an idle workspace: moving on machines →
  Working, waiting only on a reviewer → Blocked, not moving → Ready to review; a Done card no longer wins
  over moving work.
- **Extended.** Groups and their order are unchanged. An idle workspace whose open items are all in
  progress joins Working while any of them waits on machines (CI checks running, a live background job, a
  running turn), and Blocked when all of them wait on a requested review (A27). Any item not moving puts it
  in Ready to review (A28). A Done status card loses to moving work (A30). When the last in-progress item
  finishes, the workspace falls back to today's rules.
- **Get here.** The sidebar.
- **Shows.** The usual groups; rows that moved because of in-progress work carry the S2 badge.
- **Scenarios.** Back from lunch: Ready to review holds only "Track: Search" (an ask for you) and "Track:
  Catalog" (2 not moving); Billing's merge train sits under Working, the schema PR waiting on a reviewer
  under Blocked.
- **Variants.** CI running (Working); review only (Blocked); CI and review mixed (Working); one item not
  moving among moving ones (Ready to review); Done card with moving asks (Working); all items finished (back
  to Ready to review or Done by today's rules).
- **Edge cases.** The agent starts a turn → Working with the spinning ring, as today. An open ask arrives →
  Ready to review with "needs you (1)". A row moved by hand (Move to Done) stays until a newer status or a
  turn, as today.

## S2 Workspace row (P1)

- **Short.** The row's badge line says why in-progress work put it where it is.
- **Change.** Changed — a muted "3 in progress" badge is new on rows that sit under Working or Blocked because
  of in-progress work; a warning "2 not moving" badge is new wherever some work is stuck.
- **Extended.** Badges in order: "needs you (N)" (unchanged), "N not moving" (warning tone, alert icon),
  "N in progress" (muted, dashed-circle icon). "N in progress" shows only when in-progress work is the
  reason for the row's group (A29): not on a row that is under Working because its agent runs a turn. A row
  under Working because of in-progress work shows a still dot on its avatar instead of the spinning ring:
  nothing of its own runs a turn.
- **Get here.** Any workspace row.
- **Shows.** Avatar with state dot, title, project, badges, time since last activity.
- **Variants.** Working via in-progress work ("3 in progress", still dot); Blocked on a review ("awaiting
  review"); Ready to review with "needs you (1)" and "2 not moving"; Working because the agent runs (no
  in-progress badge, spinning ring).
- **Edge cases.** A narrow sidebar truncates the title before any badge; badges never wrap to a third line.

## Decisions (cards, 2026-11-25)

1. A row under Blocked because of a requested review says "awaiting review" ("2 awaiting review" for several); rows under Working keep "N in progress" (A33).
2. A row under Working because of in-progress work shows a still dot, not the spinning ring (A34).
