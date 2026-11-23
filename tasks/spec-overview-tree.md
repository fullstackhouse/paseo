# Spec: Overview without git moves, with the workspace's tree and PRs

Status: design (atlas stage 1) · 2026-11-23

Follows [spec-overview-simplify.md](spec-overview-simplify.md). UI map: [spec-overview-tree-ui-map.md](spec-overview-tree-ui-map.md).

## Problem

The operator no longer pushes, pulls or opens PRs by hand: their agents do it. Overview still spends its
only button block (Your move) on git steps (Create PR, Push, Pull, Merge from base) and on failing
checks, and names the branch in their titles. Meanwhile it says little about how the workspace relates to
other work: From and Started sit as single rows in the context footer, and nothing shows which
workspaces this one blocks.

## Goal

- Your move holds only what waits on the human: asks, permissions, failed agents, and Archive once the
  work shipped. No git sync step, no PR row.
- A **Tree** section shows where the workspace sits: its parent chain, its children, the workspaces it is
  blocked by and the ones it blocks. Each row opens that workspace.
- A **Pull requests** section closes the tab: the workspace's PRs, or its branch while it has none.
  Information only; rows open the PR.

Non-goals: changing the git actions in the workspace header, the Changes and PR tabs, or how the
agent manages git.

## Today (`packages/app/src/panels/overview-panel.tsx`)

Identity → Status → Blocked by → Your move (asks, permissions, failed agents, failing checks, one git
step) → Context footer (From, Started, PR or branch row, Agents, plugin facts).

`deriveYourMove` (`panels/overview/model.ts`) appends the `checks` and `git` rows; `deriveCodeRow`
hides the footer's PR row whenever the git move names it.

## Changelog

- 2026-11-23 — stage 1 UI map drafted.
