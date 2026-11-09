# Spec: Lineage tab in the Explorer sidebar

Status: draft · 2026-11-09

## Problem

An agent created with `create_agent` gets `paseo.parent-agent-id`. When it runs in another workspace,
that workspace's sidebar row looks like any other one. The only links between the two are inside a chat:

- on the child, the parent pill in the composer (`panels/agent-tracks.tsx:132`) or the parent callout;
- on the parent, the subagents pill and track (`subagents/track.tsx`).

Nothing answers "where did this workspace come from, and what did it start?" from one place.
If you have fan-outs across many workspaces (a spec agent starting impl workspaces), you find the
children by scanning the sidebar.

## Goal

Add a **Lineage** tab to the Explorer sidebar. It shows the chain of parents above the focused agent
and the agents it started, along with the workspace each one runs in. Clicking a row opens that agent wherever it lives.

Non-goals: forks, provider handoff, merge-back (t3code models these; Paseo has no such
relationships), sidebar tree grouping, protocol changes.

## Prior art: t3code

`packages/client-runtime/src/state/threadRelationships.ts` derives a graph from
`thread.lineage.parentThreadId` + `relationshipToParent`. Edges are `parent | fork | subagent | transfer`, and each node has a
`missing` flag for threads the client doesn't have. The graph appears as a "Lineage" section in the thread
details panel (`apps/web/src/components/chat/threadDetailsItems.ts`, on by default), with rows such as
"Previous agents · 149 >".

What to take: derive the graph on the client from data already loaded, and render missing nodes
instead of dropping them. Skip: the relationship kinds, since Paseo has only `subagent`.

## Design

### Data

The only source is the session store (`agents` + `agentDetails`) for the server. There are no new RPCs.

- **Focus agent:** the agent of the workspace's focused agent tab. If no agent tab is focused, the workspace's
  root agent (`isWorkspaceRootAgent`).
- **Ancestors:** follow `parentAgentId` up to the root. Guard against cycles, and cap the walk at 10 levels.
- **Children:** agents whose `parentAgentId` is the focus agent. Archived children appear only while the store still
  holds them.
- **Missing:** a parent id with no agent in the store becomes a `missing` row
  ("Parent agent — not loaded"), as t3code does. Don't hide the chain.

Put the derivation in one pure function,
`deriveLineage(sessionSnapshot, focusAgentId) → { ancestors, children }`, next to
`subagents/select.ts`. It is unit-tested like `select.test.ts`.

### UI

New panel kind `lineage` (`panels/panel-manifest.ts`). It is an Explorer singleton, uses `compactSheet` on
compact layouts, and opens from the Explorer + menu.

```
Lineage
  ↑ Spec production orders        helmet-mercato   ● done
  ↑ Similarly as we wrote…        casteo           ● running   ← parent
  ─ this agent ─
  In this workspace     9 subagents  >      (opens existing subagents track)
  In other workspaces
    Impl: HR planner              casteo           ● needs you
    feat/work-centers             casteo           ● done
```

- Rows reuse `useAgentDescriptor` (icon, label, status bucket) and `navigateToAgent`, the same as
  `useParentAgent`. Each row adds the workspace name.
- Children in the focus agent's own workspace collapse into one row that opens the subagents track
  we already have. Lineage only lists cross-workspace children, so nothing is listed twice.
- Empty state: "No parent or child agents".
- Follow `docs/design.md` and `docs/hover.md`.

### Discoverability

The + menu alone hides the feature. When the focus agent has a parent in another workspace, or a child in one,
the Explorer rail shows the Lineage tab once per workspace. This works like automatic PR discovery: closing the tab
stops it from coming back for that workspace (`open-supporting-view.ts` pattern).

## Open questions

1. **Detach erases lineage.** Detach clears `paseo.parent-agent-id`, so a detached agent drops out of
   Lineage. Should detach write a `paseo.detached-from` label so Lineage can show "started by X
   (detached)"? Recommend yes, as a follow-up. It's a label, so it needs no protocol change.
2. **Archived parents.** A parent that has been archived may not be in the store. Fetch it on demand through the
   History lookup, or leave it as `missing`? Recommend `missing` for v1.
3. **Sidebar hint.** Should a cross-workspace child's sidebar row also show "↳ from <workspace>"? Leave it out of
   v1 and revisit after using the tab.

## Phases

1. `deriveLineage` + unit tests (ancestors, cross/same-workspace children, missing parent, cycle).
2. `lineage` panel kind + Explorer tab UI, with a browser test in the `tracks-panel.browser.test.tsx` style.
3. Automatic reveal once per workspace, with the close opt-out.
4. Update `docs/explorer-sidebar.md` (panel list, reveal rule) and `docs/agent-lifecycle.md`
   (Relationships → where lineage is shown). Add an FSH.md patch line.

## Verification

- Unit: `deriveLineage` cases above.
- Manual (`paseo-run`): a parent agent creates a child via `create_agent` with a new workspace. The child
  workspace's Lineage shows the parent, and the parent's Lineage lists the child under "In other workspaces".
  Both rows navigate. Detaching removes the child from the list.
