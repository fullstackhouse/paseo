# Spec: Lineage tab in the Explorer sidebar

Status: implemented · 2026-11-09

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
  most recently active root agent (`isWorkspaceRootAgent`).
- **Ancestors:** follow the parent address labels (`paseo.parent-agent-id` + `paseo.parent-server-id`, so across
  hosts too) up to the root. Guard against cycles, and cap the walk at 10 levels.
- **Children:** live (unarchived) agents whose parent address is the focus agent.
- **Missing:** a parent with no agent in the store becomes a `missing` row ("Not loaded"), as t3code does. The
  chain stays visible.

The derivation is one pure function, `deriveLineage(sessionSnapshot, focusAddress) → { ancestors, children }`, in
`subagents/lineage.ts`, with a memoized selector like `subagents/select.ts`.

### UI

New panel kind `lineage` (`panels/panel-manifest.ts`). It is an Explorer-only singleton and opens from the
Explorer + menu. It has no `compactSheet`: compact layouts already show Explorer as an overlay.

```
Started by
  Spec production orders          helmet-mercato · casteo
  Similarly as we wrote…          casteo · casteo
[this agent]
In other workspaces
  Impl: HR planner                impl-hr · casteo
In this workspace
  Explore settings usage
```

- Rows reuse `useAgentDescriptor` (icon, label, status bucket) and `navigateToAgent`, the same as
  `useParentAgent`. Rows in another workspace show the workspace and project, plus the host for another host.
- Children in this workspace are listed too, under their own heading. The subagents track is a composer
  popover that a panel can't open, so a single row pointing to it would lead nowhere.
- Empty states: "No parent or child agents", or "Open an agent to see its lineage" when nothing is focused.

### Discoverability

The + menu alone hides the feature. When the focus agent has a parent in another workspace, or a child in one,
the Explorer rail shows the Lineage tab once per workspace. This works like automatic PR discovery: closing the tab
stops it from coming back for that workspace (`open-supporting-view.ts` pattern).

## Open questions

1. **Detach erases lineage.** Resolved: yes, as a follow-up. Detach clears `paseo.parent-agent-id`, so a detached
   agent drops out of Lineage. Detach will also write `paseo.detached-from`, and Lineage will show "started by X
   (detached)". It's a label, so the protocol doesn't change.
2. **Archived parents.** A parent that has been archived may not be in the store. Fetch it on demand through the
   History lookup, or leave it as `missing`? Recommend `missing` for v1.
3. **Sidebar hint.** Should a cross-workspace child's sidebar row also show "↳ from <workspace>"? Leave it out of
   v1 and revisit after using the tab.

## Phases

1. `deriveLineage` + unit tests (ancestors, cross/same-workspace children, missing parent, cycle).
2. `lineage` panel kind + Explorer tab UI, verified in a `paseo-run` window (no browser test: the panel needs the
   full app's providers).
3. Automatic reveal once per workspace, with the close opt-out.
4. Update `docs/explorer-sidebar.md` (panel list, reveal rule) and `docs/agent-lifecycle.md`
   (Relationships → where lineage is shown). Add an FSH.md patch line.
5. Detach writes `paseo.detached-from` (plus `paseo.detached-from-server-id` when the parent was on another
   host), also when an archived parent detaches a child. Lineage follows it both ways and marks the row "Detached".

## Verification

- Unit: `subagents/lineage.test.ts` (ancestors, cross-host parent, missing, archived, cycle, depth cap, memoized
  selector), and the store test for the once-per-workspace add.
- Manual (`paseo-run`): a parent agent, one child in another workspace and one in its own. The tab is added in the
  background in both workspaces. The parent's Lineage lists both children under their headings. Clicking the
  other-workspace child opens it, and that workspace's Lineage shows the parent under "Started by".
