# Spec: sidebar groups a workspace by its work in progress

Status: stage 2 (cards) next · 2026-11-25

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

To be written once the UI map and cards are agreed.

## Changelog

- 2026-11-25 — stage 1 UI map drafted; placement options drawn (V1–V3); A27–A30 decided; stage 1 approved (A31).
