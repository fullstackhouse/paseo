# Spec: Open Explorer when entering a workspace

Status: draft · 2026-11-11 · storyboard: [`.ai/prototypes/explorer-auto-open/`](../.ai/prototypes/explorer-auto-open/index.html)

Companion: [Overview tab](spec-explorer-overview.md) is a separate PR. Either can land first.

## Problem

On desktop, each workspace remembers whether its Explorer is shown. A new workspace starts with it hidden,
and nothing opens it unless you do: Cmd+E, the toggle, the Changes pill, or a side-panel plugin pill. PR and
Lineage tabs are added in the background but don't make Explorer visible.

So when something in a workspace needs you (open asks, a permission prompt, a PR turning red), entering the
workspace shows nothing on the right. Asks stay hidden until you click their pill.

## Goal

A desktop setting, **Open Explorer when entering a workspace**: Never / When something needs you / Always.
When Explorer opens, it lands on the tab that needs you. Hiding it is respected until something new happens.

Non-goals: compact layouts (overlay and sheets unchanged), opening Explorer while you're already in a
workspace, the Overview tab itself (companion spec).

## Stories

| ID   | Role → goal → outcome                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-1 | When something needs me (a permission prompt, asks, a failure, a PR turning red or green), Explorer shows it when I enter, and it opens on the tab that needs me. |
| US-2 | If I hide Explorer with Cmd+E, it stays hidden in that workspace until something new needs me.                                                                    |
| US-3 | I choose the rule in Settings, and **Never** keeps today's behavior exactly.                                                                                      |

Acceptance criteria per state are in the storyboard (s1–s3), each with notes.

## Design

### Attention items

"Something needs you" is a workspace-level list of **attention items**, each with a stable key:

| Key                                | Source                                         | Tab it opens       |
| ---------------------------------- | ---------------------------------------------- | ------------------ |
| `permission:<agentId>:<requestId>` | session store `pendingPermissions`             | that agent's tab   |
| `plugin:<pluginId>:<itemId>:<key>` | workspace summary item with `needsYou` (below) | the plugin's panel |
| `failed:<agentId>`                 | agent status `error`                           | that agent's tab   |
| `pr-checks-failed:<number>:<sha>`  | `useCheckoutPrStatusQuery`                     | PR tab             |
| `pr-ready:<number>:<sha>`          | checks pass, mergeable, review ok              | PR tab             |
| `pr-merged:<number>`               | PR status                                      | PR tab             |

The table order is the priority order. `useWorkspaceAttention(workspaceKey) → AttentionItem[]` lives in
`workspace-attention/attention.ts`, with a pure `deriveAttentionItems(input)` for tests. "Ready to review"
(an agent finished) is deliberately not an item: it would fire on every turn. The sidebar keeps showing it.
The Overview companion reuses this list for its first next-step rules.

PR items depend on PR status, which today is requested only while discovery runs
(`panels/pull-request/activity.ts`). On entering a workspace, read the cached status, and request one refresh
if there is no cached status yet. Don't add polling.

### Workspace summary items

The Asks plugin only sets its pill label to a count, so the host can't tell that anything waits on you. Add a
plugin client contribution, `addWorkspaceSummaryItem`, next to `addWorkspaceRowItem`
(`packages/plugin/src/client/contracts.ts`). It's data, not a component, because the host needs the facts
to decide what to open:

```ts
const asks = paseo.addWorkspaceSummaryItem({
  id: "asks",
  title: "Asks",
  icon: "message-circle-question",
});
asks.set(workspaceId, {
  label: "2 waiting on you",
  count: 2,
  needsYou: true,
  key: newestAskId,
  panelId: "asks",
});
asks.clear(workspaceId);
```

- One value per workspace, so the plugin aggregates across that workspace's agents. Registration returns a
  cleanup, as other contributions do.
- `key` changes with each new item (for example the newest ask id), so a new ask after a hide counts as new.
- `panelId` names the plugin panel to open in Explorer (`navigation.openWorkspacePanel(..., "explorer")`).
  Asks moves its side-panel tab to a workspace panel.
- The host keeps values in a client store keyed by `(serverId, workspaceId)`. It needs no protocol change. It
  is FSH-only, like the side-panel opt-in. The Overview's Plugins section renders these rows (companion spec).
- The Asks plugin (`paseo-asks`, a separate repo) registers the item and keeps its pill.

### Setting

`explorerOnWorkspaceEnter: "never" | "needed" | "always"` in `AppSettings` (`hooks/use-settings/storage.ts`),
shown on desktop under **Open location**, next to the PR destination
(`screens/settings/open-location/open-location-section.tsx`). Label: **Open Explorer when entering a
workspace**. Options and hints:

- **Never**: only when you open it
- **When something needs you**: permission prompts, asks, failures, PR status
- **Always**: on the tab that needs you, otherwise where you left it

Default: **When something needs you**.

### Auto-show

Hook `useExplorerAutoShow({ workspaceKey, workspaceActive })`, called in `WorkspaceScreenContent` next to
`useLineageAutoOpen` (`workspace-screen.tsx:~1312`) and gated the same way (route focused, layout hydrated,
not compact). It runs once per entry, on the transition from inactive to active:

| Setting | Unseen items | Result                                                                               |
| ------- | ------------ | ------------------------------------------------------------------------------------ |
| never   | any          | Nothing. Today's behavior                                                            |
| needed  | none         | Nothing; the workspace's saved visibility stands                                     |
| needed  | some         | Show Explorer on the top item's tab                                                  |
| always  | none         | Show Explorer on its selected tab (Overview once the companion lands), unless hidden |
| always  | some         | Show Explorer on the top item's tab                                                  |

Agent tabs live in the main pane, not Explorer. For a permission or failed item, show Explorer and focus the
agent tab as `navigateToWorkspace` does for attention today. Explorer's selected tab doesn't change.

**Hide memory.** When you hide Explorer in a workspace (Cmd+E, toggle, close gesture), store
`explorerHiddenByWorkspace[key] = { attentionKeys }`: the keys present at that moment. Persist it next to
`lineageTabAutoOpenedByWorkspace` (`stores/workspace-layout-storage.ts`). **Unseen** items are those whose key
isn't in that set. Showing Explorer by hand clears the record. A workspace with no record treats every item as
unseen.

Auto-show never opens Explorer while you are in the workspace. Changes there only update tab badges.

## Decisions

1. **Default value:** **When something needs you**. **Always** and **Never** stay available.
2. **How the host learns about asks:** a new `addWorkspaceSummaryItem` contribution, not a field on composer
   buttons and not a hard-coded Asks plugin.

## Phases

1. `deriveAttentionItems` and `useWorkspaceAttention`, with unit tests for every key and the priority order.
2. `addWorkspaceSummaryItem`: contract, client runtime, host store, and an `explorer` panel open. Then update the Asks plugin.
3. Setting, `useExplorerAutoShow` and hide memory, with store and persistence tests.
4. Docs: `docs/explorer-sidebar.md` (auto-show rule, hide memory), `docs/plugins.md` (workspace summary items), FSH.md patch
   line.

## Verification

- Unit: `attention.test.ts` (keys, priority, unseen against the hidden set), store tests for the hide record,
  and the auto-show decision table as a pure function.
- Manual (`paseo-run`, desktop): for each setting value, enter a workspace with no items, with open asks, and
  with a permission prompt. Hide, re-enter, add an ask, re-enter.
- Never: diff against `fsh`. Entering workspaces must behave exactly as today.
