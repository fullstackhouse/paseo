# Spec: sidebar groups a workspace by its work in progress

Status: host in review (fullstackhouse/paseo#240), paseo-asks side in fullstackhouse/paseo-asks#92 · 2026-11-25

Follows [spec-overview-in-progress.md](spec-overview-in-progress.md) (shipped in fullstackhouse/paseo#237 and
fullstackhouse/paseo-asks#91). UI map: [spec-sidebar-in-progress-ui-map.md](spec-sidebar-in-progress-ui-map.md).

## Problem

The sidebar puts an idle workspace in **Ready to review** whenever its last turn finished, unless a plugin
reports something else. A workspace whose agent is waiting on CI for five PRs, with a merge queue running,
sits in Ready to review next to workspaces that really need you. Opening it shows nothing to do: everything
is in progress (Overview now lists it, #237).

Seen 2026-11-24: Track: Detail pages, 5 asks in progress, nothing waiting on the human, in Ready to review
for hours. paseo-status's Working card had gone stale (no live work for 5 minutes), so its report no longer
counted and the finished turn decided the group.

## Goal

- An idle workspace whose open work is all in progress **and moving** (a watched PR, a live background job)
  leaves Ready to review.
- One whose in-progress work has **nothing moving** says so, so the human knows to step in.
- Everything that waits on the human still wins: a permission, a failure, an open ask.

Non-goals: Overview (shipped); automatic hand-back of stuck asks (a separate phase); changing how a running
turn, a permission or a failure groups.

## Today

`packages/app/src/workspace-status/index.ts` → `deriveEffectiveWorkspaceStatus`: the turn state, then
plugin-reported work (`reported-work.ts`, `foldReportedWork`: needs_you > working > blocked > done) for idle
workspaces, then a manual group. paseo-asks reports `needsYou` only for open asks; its `inProgress` entries
(#91) don't count. Group order: Needs input, Failed, Ready to review, Working, Done, Blocked
(`STATUS_BUCKET_ORDER`).

## Mechanism

Two PRs: paseo-asks first (older hosts ignore the new field), then the host.

### Contract (`packages/plugin/src/client/contracts.ts`, FSH-only)

`PluginWorkspaceInProgressEntry` gains one optional field:

```ts
/** True while a watched entry waits on a person's review rather than on machines (checks, a merge). */
waitingOnReview?: boolean;
```

Only meaningful with `watched: true`. Absent or false means a watched entry waits on machines.

### paseo-asks

`client/summary.ts` sets `waitingOnReview: true` on a watched PR ask whose PR waits on a requested review
(review required, no checks running); false otherwise. Its derived `waitingOn` word already says "review
requested" in that case (#91).

### Host (fsh)

- **Moving.** Reuse #237's per-entry rule (`panels/overview/model.ts`): an entry moves while its agent's turn
  runs, the workspace has live background work, or it is `watched`; otherwise, after 10 minutes, it is not
  moving. Move the rule somewhere both Overview and `workspace-status` import, so the two never disagree.
- **Fold (S1).** `reported-work.ts` gains an in-progress contribution per workspace, from every summary
  item's `inProgress`:
  - stuck ≥ moving (and at least one stuck) → `needs_you` (Ready to review);
  - otherwise any moving entry not waiting on review, or live background work, or a running turn → `working`;
  - otherwise all moving entries wait on review → `blocked`;
  - no entries → nothing.
    It folds with the other items under the existing rank (needs_you > working > blocked > done), so an open
    ask still wins and moving work beats a Done card (A30). Read/unread stays hidden while a report decides
    the group, as today.
- **Row (S2).** `sidebar-workspace-row-content.tsx` adds badges after "needs you (N)": "N not moving"
  (warning, alert icon) whenever stuck entries exist; "N in progress" (muted, dashed circle) when the
  in-progress contribution decided the group as `working`; "awaiting review" / "N awaiting review" (muted,
  eye icon) when it decided `blocked`. The avatar's state mark is a still dot, not the spinning ring, when
  the row is under Working only because of in-progress work.

## Changelog

- 2026-11-25 — stage 1 UI map drafted; placement options drawn (V1–V3); A27–A30 decided; stage 1 approved (A31).
- 2026-11-25 — stage 2 cards and mockups approved (A33–A36).
- 2026-11-25 — mechanism and contract written (A37).
- 2026-11-25 — host implemented (contract, shared moving rule, S1 fold, S2 badges) in fullstackhouse/paseo#240.
