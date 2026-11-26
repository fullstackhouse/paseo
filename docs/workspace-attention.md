# Workspace attention

Whether a workspace needs you, is working, is blocked on someone else, or is done. Plugins report facts; the app decides, in one function. Every surface reads that one result: the sidebar group, the dock badge, Overview's Your move and In progress, and the "no ask" check.

Before this, Paseo core and paseo-status each decided it, with different rules. paseo-status read paseo-asks' files from disk, counted only open asks, ignored snoozes, and published its own `workState` and row badge. Core folded that `workState` with Asks' items again. The two disagreed whenever an ask was in progress, a workspace was snoozed, or a working card aged out on a different clock. About 40 Overview and status PRs in three weeks each patched one rule.

## Who reports what

| Fact                                              | Reported by  | Field                                                 |
| ------------------------------------------------- | ------------ | ----------------------------------------------------- |
| Agent turns, permissions, errors, background work | core         | agent state                                           |
| Every agent's status card                         | paseo-status | `cards`                                               |
| The newest card, for the Status section           | paseo-status | `status`                                              |
| Open asks, with their agent                       | paseo-asks   | `needsYou`, `entries[].agentId`                       |
| Asks in progress                                  | paseo-asks   | `inProgress`                                          |
| Pull request state                                | core         | the host PR service ([Pull requests](#pull-requests)) |

A plugin never sends a verdict. `workState` and `needsYou` from a plugin that also sends facts are ignored, except `needsYou` on an item with `entries`, which means "these entries wait on you".

### Status cards

```ts
interface PluginWorkspaceAgentCard {
  agentId: string;
  state: "working" | "waiting_on_you" | "blocked" | "done";
  /** A turn started after the card was written: the human replied, or a child reported back. */
  answered?: boolean;
  updatedAt: number;
  /** The agent, its background work, or a descendant agent is live right now. */
  live?: boolean;
  /** When live work was last seen for this agent. */
  lastLiveAt?: number;
  /** Descendant agents live in other workspaces, for an idle agent with a waiting card. */
  liveChildren?: string[];
}
```

paseo-status sends `answered`, `live` and `liveChildren` because only its server sees turn counts and descendants in other workspaces. Those are facts about one agent; what they mean for the workspace is decided in the app.

## The rules

`deriveWorkspaceAttention` in `packages/app/src/workspace-status/attention.ts`. In order:

1. A card **needs you** when it is `waiting_on_you` and not `answered`.
2. A card that needs you reads **blocked** instead when its agent has no open ask and either has an ask in progress or has `liveChildren`. Its asks or children say what it waits on; the card is out of date.
3. A card that still needs you with no open ask and nothing in progress is **unrecorded**: Your move shows one row per such agent, named, with Sync asks.
4. A `working` card counts while `live`, or for 5 minutes after the later of `updatedAt` and `lastLiveAt`.
5. In-progress entries: stuck after 10 minutes unless their agent runs, live work exists, or they are watched (`workspace-status/moving.ts`).
6. The workspace takes the most telling of: needs you, working, blocked, done. Done only when every card is done.

Live state still wins over all of this: a running agent, a permission prompt or a failure decides the sidebar group (`isStatusDecidedByReport`).

## Pull requests

Plugin servers read pull request state from the daemon, not from `gh`. Before this, core, paseo-prs and paseo-asks each polled GitHub for the same PRs on their own clocks and rate-limit handling, so a PR could read merged in one place and open in another.

```ts
paseo.changeRequests.read(urls: string[]): Promise<ChangeRequestRead[]>;

type ChangeRequestRead =
  | {
      url: string;
      ok: true;
      number: number;
      title: string;
      state: "open" | "merged" | "closed";
      isDraft: boolean;
      mergeable?: "mergeable" | "conflicting" | "unknown";
      reviewDecision: "approved" | "changes_requested" | "review_required" | null;
      checksState: "passing" | "failing" | "pending" | "none";
      checks: { name: string; state: "passing" | "failing" | "pending" | "skipped" }[];
      headSha: string;
    }
  | { url: string; ok: false; error: string };
```

It uses the reader behind `subscribe_change_request` (`services/change-request-source.ts`): any URL on any forge the router knows, batched, sharing one rate-limit pause, cached for 30 seconds. Plugins keep their own refresh intervals; repeated reads inside the cache window cost nothing.

What stays in plugins: finding which PRs belong to a workspace (paseo-prs' branch and stack lookups), deployments (paseo-asks), and paseo-inbox's review runs, which need files, threads and timeline events no other surface uses.

## Rollout

1. **Core:** `cards` and `entries[].agentId` in the plugin contract; `deriveWorkspaceAttention` replaces `foldReportedWork`, `foldInProgress`'s verdict and Overview's own checks; Your move renders unrecorded rows through the status item's `EntryComponent`. Items without `cards` keep their `workState` (`COMPAT(plugin-work-state)`).
2. **paseo-status:** send `cards`; stop reading asks files; delete `workspaceWorkState`, `summarize`, `unrecordedWaits`, the `status.summary` RPC and the row badge. The snooze wake keeps its own trigger (a card newer than the snooze that needs you or says done), since it runs on the server.
3. **Core:** `paseo.changeRequests.read` on the plugin server API, behind a `changeRequestsRead` feature flag.
4. **paseo-asks:** set `entries[].agentId`; read PR state through `changeRequests.read`.
5. **paseo-prs:** read linked and branch PR state through `changeRequests.read`.
