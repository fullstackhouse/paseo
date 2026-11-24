# Paseo — FSH fork

Full Stack House's fork of [getpaseo/paseo](https://github.com/getpaseo/paseo). Branch `fsh`
(the default) = upstream `main` + FSH patches that haven't landed upstream yet. The fork is
temporary by design: every patch is meant to go upstream and then drop out of `fsh`.

## Patches on `fsh`

- FSH-only (upstreamable): archiving a workspace replies once its records are archived; worktree teardown and deletion keep running inside the same archive operation (upstream's archive lane), so **Undo** still waits for them or cancels them before the folder is deleted. Removals for one repo run in order. Creating or restoring a worktree at the same path waits for the pending removal. `paseo worktree archive` and the MCP `archive_workspace` tool still wait for the directory to be removed
- FSH-only (upstreamable): opening an archived workspace's agent from History shows its conversation read-only under a banner with the recovery actions (Restore, Unarchive or Recreate empty folder), instead of a full-screen gate. Nothing changes until you pick one
- FSH-only (upstreamable): archived workspaces restore in more cases. A worktree whose branch git proves is gone (say, deleted after its PR merged) restores as a new branch of that name from the base; an unreachable origin keeps the saved branch and shows the error. A Paseo worktree whose record lost its worktree fields restores from the base too. When a plain folder is missing, **Workspace unavailable** offers **Recreate empty folder**: the workspace opens at an empty folder in the same place and its agents keep their conversations. Not offered for worktrees, or when the folder's parent is also missing, as on an unplugged drive. `workspace.recovery.restore.request` takes an optional `recreate`, and the unavailable state an optional `canRecreate`
- FSH-only (upstreamable): History has an **Archived workspaces** view next to Agents: archived workspaces newest first, grouped by date and searchable by name, project and branch. A row opens the workspace with its Restore or Unarchive action, including workspaces that never had an agent. Hosts without `features.archivedWorkspaces` (`workspace.archived.list`) are named in the view as needing an update

- FSH-only (upstreamable): a file tab's right-click menu has **Reveal in Finder** (Explorer / Files on other OSes) on desktop with a local daemon, next to **Copy file path**.
- FSH-only (upstreamable): plugins get the app's menu as `Menu` from `@getpaseo/plugin/client/ui`: rows as data (icon, destructive, disabled, separators), a host-drawn icon trigger, a popover on wide layouts and a bottom sheet on compact ones. Older hosts leave the export undefined
- FSH-only (upstreamable): plugins get `useRevealInScroll` from `@getpaseo/plugin/client/ui`: it scrolls the nearest host scroll container (an SDK `ScrollView`, a popover, the composer sheet or side panel) just enough to show a view, so a card folded after an answer stays in sight. Older hosts leave the export undefined
- FSH-only (upstreamable): select text in an agent's reply and a **Cite** button appears next to it. It adds the fragment to a numbered list above that agent's composer, in the order cited. Each quote is editable and has its own comment field, which Cite focuses. Backspace works like in text: from the start of the message into the last comment, from the start of a comment into its quote, and in an emptied quote it removes the quote. On send, each quote goes out as a `> ` blockquote with its comment under it, inside the message text. Your message bubble shows the quotes and comments in that order. Web and desktop only, because native has no selection there
- FSH-only (upstreamable): right-clicking a file link in an agent's reply opens a menu with **Open in <editor>**, **Reveal in Finder** and **Copy path**. Cmd/Ctrl+click opens the file in its default app, so an `.html` file goes to the system browser. Both work on desktop with a local daemon. The new `paseo:opener:openPath` IPC only opens documents, images, media and folders (an allow-list, checked on the symlink-resolved path), because `shell.openPath` runs anything the OS treats as a program; everything else shows a toast.
- FSH-only (upstreamable): plugins can render the Explorer pull-request panel through `PullRequestPanel`, using their own checks and activity data without a workspace checkout. Inbox uses it for its read-only GitHub tab.

- FSH-only: `latestTurn()` in `@getpaseo/plugin/server` reads an agent's last turn (its last user message and everything after it). Upstream took the rest of getpaseo/paseo#9307 as #9573 but reads turns with `timeline.refetch({ wholeTurns: true })`; paseo-asks and paseo-status still call `latestTurn()`. Drop it once they don't
- FSH-only: a Claude turn that ends on a usage limit, login or API error keeps Claude's reply as a plain assistant message and adds no `[System Error]` copy of the same text; the turn still fails (upstream #8480). Upstream shows only the `[System Error]` row, which paseo-limits' anchored patterns don't match, so its Retry / Log in card would never appear
- FSH-only (upstreamable): plugins mark the workspaces they create in the sidebar. `workspaces.ref(id).setAppearance({ avatar, titleIcon })` puts an avatar in place of the project icon (status badge kept) and a Lucide icon before the title. Gated on `features.workspaceAppearance`. Inbox uses it for reviews: the PR author's avatar and an `Inbox` icon

- FSH-only (upstreamable): agent snapshots carry `capabilities.supportsSteering` (Claude, Codex, OpenCode, Pi, OMP, and provider plugins that negotiate `prompt.steer`), so plugins steer a running agent when it joins the turn and wait for the turn to end when a steer would interrupt it.

- FSH-only: don't automatically show the worktree scripts setup callout; configure scripts in project settings.

- FSH-only (upstreamable): `paseo://h/<server>/workspace/<id>` and `…/agent/<id>` links in chat open inside the app on every platform; before, the app dropped them. An archived workspace's link shows **Workspace archived · Unarchive**. MCP `create_workspace`, `list_workspaces` and `create_agent` return the link as `url`, and the Paseo skill tells agents to link the workspaces they point you at.

- FSH-only (not upstream yet): plugin Markdown supports inline review annotations with source line ranges and advertises `supportsBlockAnnotations`. Inbox and Asks use the shared renderer, including Mermaid diagrams; older hosts show update guidance for annotated documents.

- FSH-only (upstreamable): plugin and SDK agent handles read an agent's provider subagents (`agents.ref(id).providerSubagents.list()/subscribe()`, gated on `features.providerSubagents`) and the heartbeats that prompt it (`agents.ref(id).heartbeats.list()`). Event subscriptions take an optional `providerSubagentFilter` (parent agents, update kinds) so a subagent subscription receives only its agent's changes, gated on `features.providerSubagentEventFilter`
- FSH-only (upstreamable): the subagents list behind the composer pill shows children still working above finished ones, so a long session's finished fan-outs don't bury them
- FSH-only (upstreamable): a turn that ends while provider subagents still run doesn't notify or mark the agent unread; the wake turn after they report back does, or the held-back finish fires 5 s after the last subagent settles when no wake turn starts (#72)
- FSH-only (upstreamable): a failed agent shows a **Failed** pill above its composer with the error and **Retry**, which sends the host's resume prompt. When turns fail on a network or provider outage (DNS, connection reset, 5xx, overloaded, but not usage limits), a sidebar callout and the command palette offer **Retry all** across every workspace. `classifyAgentError` in `@getpaseo/protocol/agent-error-kind` sorts the error text
- FSH-only (upstreamable): forking a chat gives the new agent the images from the history (up to the 10 most recent, 5 MB each) as real images after the chat summary. Before, it only got a link to the temp file
- FSH-only (not upstream yet): host setting for the mode an agent switches to after plan approval, per provider (Claude, Codex), under host Settings → Agents. Applies to approvals from the app, MCP and CLI
- FSH-only (upstreamable): approving a Claude plan from Bypass offers **Implement with Auto mode** as the highlighted action, next to **Implement with Bypass**, when the host can run Auto
- FSH-only (not upstream yet): changed images in the Changes diff and commit diffs show a before/after preview instead of "Binary file" (PNG, JPEG, GIF, WebP, BMP up to 8 MB per side). getpaseo/paseo#1813 tried this upstream and was closed; discussion getpaseo/paseo#5689 tracks it
- FSH-only (upstreamable): F-Droid builds link the app's own native modules (`packages/app/modules`); before, `paseo-scroll` was never linked and the build failed to compile
- FSH-only (not upstream yet): project categories. Put each project in a category from its menu or its settings page (Settings → Projects → project), then pick a category in the Workspaces header so the sidebar shows only that category's projects. Categories are stored per device
- FSH-only (not upstream yet): docs and a `paseo-run` skill for running a branch, or testing a plugin, next to the Paseo you work in
- FSH-only (not upstream yet): new workspaces branch off the repo's default branch, not whatever branch the source checkout is on. The daemon picks the ref: the default branch's upstream (any remote), then origin's copy, then local
- FSH-only (not upstream yet): remove a project from its settings page (Settings → Projects → project → Danger zone), not just from the sidebar menu
- FSH-only (upstreamable, getpaseo/paseo#8373): Linux desktop notifications play a sound when **Play sound** is on. Electron sends them without a sound hint, so GNOME and KDE stayed silent; they now go through `notify-send` with `sound-name:message-new-instant`, and the notification server plays it (Do Not Disturb and per-app sound settings apply). Without `notify-send` the silent Electron banner shows as before. getpaseo/paseo#8370 proposes the same idea upstream
- FSH-only: macOS builds are signed with a self-signed FSH certificate instead of ad hoc, so folder-access answers survive updates (see Install below)
- FSH-only: the desktop app's update callout installs new FSH builds through `scripts/install-fsh.sh`, on macOS (DMG) and Fedora (RPM) (see Install below)
- FSH-only: Settings → About has no **Release channel** picker. FSH builds update from GitHub's latest release, which has no beta channel
- FSH-only (upstreamable): the desktop update callout offers **Install when idle**: the update installs once no workspace on the local host has been running or waiting on a permission prompt for 15 seconds. Settings → About → **Install updates when idle** does this for every update
- FSH-only (upstreamable): while a desktop update is ready, the command palette lists **Update Paseo**. It asks for confirmation, then installs and restarts
- FSH-only (upstreamable): **Create PR** in a feature branch's git menu sends the workspace's agent a prompt to commit, push and open the PR, instead of the daemon writing the PR on its own. The daemon builds the prompt (`checkout.pr.agent_prompt.*`, also `workspaces.ref(id).pullRequestPrompt()` for plugins) with the base branch, the repo's `pull_request_template.md` and the project's Pull request prompt from `paseo.json`. **Create PR & Merge** sends the same prompt plus steps to get CI green and merge. With no agent in the workspace, either opens a new agent tab with the prompt filled in. Shown until the branch has a PR
- FSH-only (upstreamable): workspace diffs show unpushed and behind counts (`↑1 ↓327`) in the composer pill and the Changes header, opening a sync card (upstream, uncommitted files, unpushed commits, commits to pull, next step); a branch both ahead and behind its remote offers Pull and push as the primary action
- FSH-only (upstreamable): WebSocket upgrades through the service proxy reach the workspace service instead of getting a 400 from the daemon's own `/ws` server, so worktree web apps opened by proxy URL stop reload-looping
- FSH-only (not upstream yet): `app-main` worktree service runs the branch's web app against your main daemon, to review UI changes with real workspaces and no restart
- FSH-only (upstreamable): the app automatically applies plugin updates per connected host using the daemon's validated preview/apply. Only failures show a sidebar retry callout; directory-installed plugins stay untouched. It waits while the Plugins gallery or a plugin page is open on that host, where you update by hand
- FSH-only (upstreamable): `openScreen` and `navigation.openPluginScreen` take an optional `workspaceId`. The plugin screen then opens as a tab in that workspace instead of over the app, so a review stays one tab away from its agent. Older hosts ignore the field. Timeline items get the agent's `workspaceId` so chat cards can pass it. With `location: "explorer"` the tab opens in the workspace's Explorer sidebar, so a review sits beside its reviewer chat; plugins check `screenTabLocations` for it. Entering a workspace that way keeps that tab selected instead of switching Explorer to the tab for its first attention item
- FSH-only (upstreamable): plugin screens get an optional `setTitle({ label, tooltip? })` prop that replaces the registered title in the screen header and its workspace tab. A tab keeps it in its persisted state across reloads, so two review tabs read `#115 …` and `#114 …` instead of both "Review"
- FSH-only (upstreamable): plugin timeline items and button popovers get `navigation` (`openAgent`, `openWorkspace`, `openBrowser`), like screens and panels, so a plugin card in the chat can open the agent it just created

- FSH-only (upstreamable): agents whose turn a daemon restart or crash cut short are marked interrupted; the sidebar then offers **Resume all**. It is the manual side of upstream's restart recovery: the same agents, and the same prompt (Host settings → Agents, default `Resume working.`), which upstream sends by itself only when you turn recovery on
- FSH-only (upstreamable): workspace scripts work when the daemon's shell is fish, nu or PowerShell. paseo.json commands are POSIX `sh`; for those shells Paseo runs them through `/bin/sh` instead of typing them into the shell

- FSH-only (upstreamable): `paseo.json` service commands run through `bash -c '…'`, so workspace scripts start when the login shell is fish (the daemon types commands into `$SHELL`, and they use bash syntax)
- FSH-only (upstreamable): `agents.create` with `worktree: { mode: "checkout-pr" }` takes an optional `projectPath` (`owner/name` on GitHub) naming the repo the PR lives in. Without it the daemon asks `gh repo view`, which picks the `upstream` remote over `origin` when no gh default is set, so a PR on origin was looked up in the wrong repo
- FSH-only (upstreamable): when a workspace's pull request turns merged, the daemon fetches origin right away instead of on its 3-minute background fetch, so the composer pill stops counting the squash-merged branch as uncommitted work within one PR status poll
- FSH-only (upstreamable): auto-archive after a PR merge skips a workspace while one of its agents is running, instead of archiving it and killing the run. It isn't retried: the workspace stays until you archive it or its git state changes
- FSH-only (not upstream yet): plugins can send notifications. Plugin server code calls `paseo.notifications.send({ title, body, open, key })`; Paseo pushes it to the phone or shows it on desktop/web like agent attention, and a tap opens the plugin's screen (or an agent). Per-plugin switch in Settings → Plugins (actions menu) or `pluginNotifications.<id>` in daemon config; duplicate keys and more than 20 a minute are dropped. Gated on `server_info.features.pluginNotifications`
- FSH-only (upstreamable): an existing workspace can move into or out of the background (`workspace.background.set`, `workspaces.ref(id).setBackground()` for plugins), so a plugin can show a hidden workspace in the sidebar once you start working in it. Gated on `server_info.features.workspaceBackgroundSet`
- FSH-only (upstreamable): a workspace with one agent shares one name with it. When the workspace's title is generated, an agent still carrying its prompt-derived name takes the workspace's title, and an agent with its own title names the workspace instead. `paseo run --title X --new-workspace …` creates the workspace with that title, so the sidebar stops showing the branch. Titles set by hand are never overwritten
- FSH-only (upstreamable): PR status polling finds a PR opened inside a GitHub fork (like `fullstackhouse/paseo`). It used to look only in the fork's parent, so a branch whose PR was opened after the workspace started kept showing **Create PR** and never offered **Archive** once merged
- FSH-only (upstreamable): on Android, a vertical `ScrollView` from `@getpaseo/plugin/client/react-native` scrolls the focused input above the keyboard, as settings pages do. Before, typing an Asks reply on a phone happened under the keyboard
- FSH-only (not upstream yet): a permission prompt wakes a snoozed workspace only if it is still open 1.5 s later, so a prompt a plugin answers by itself (paseo-status allowing `status_set`) leaves the snooze alone
- FSH-only (not upstream yet): snooze a workspace from its menu (until tonight, tomorrow morning, next week, a typed time such as `fri 14:00`, `2h` or `2026-11-20 9:30`, or until you wake it). It moves to a collapsed **Snoozed** section at the bottom of the sidebar, unpins, and stops notifying; agents keep running. Host Settings → Workspaces picks what a permission prompt does to it: wake it (default), count it on the Snoozed header, or stay silent. Plugins see `snoozedAt`/`snoozedUntil` on workspace snapshots and `workspaces.ref(id).setSnoozed()`. Gated on `server_info.features.workspaceSnooze`. Turning on **Continue work when it ends** in the Snooze menu also tells the workspace's agent to continue when the snooze ends (`wakePrompt`, gated on `features.workspaceSnoozeWakePrompt`). Plugins can report that a snoozed workspace needs you (`workspaces.ref(id).reportNeedsYou()`, gated on `features.workspaceAttentionReport`). The report follows the same setting as a permission prompt, so paseo-status wakes a workspace once its work waits on you or is done. Sending a message to one of its agents (typed or spoken) wakes it too; a message from another agent, a plugin nudge, a Hub follow-up or **Resume all** after a daemon restart does not
- FSH-only (not upstream yet): scheduled runs that need you. A run is marked **Needs you** when its agent stops on a permission prompt, when it fails, or when a plugin flags it through the `schedule.run.finish.before` hook (Asks flags runs that leave open asks). Its workspace is kept instead of archived. The Schedules sidebar row shows a count, and the Schedules screen lists these runs under Needs you with **Open** and **Dismiss**. Archiving the run's workspace dismisses it too. A run that stops on a permission prompt used to be recorded as failed and archived. Runs carry an optional `attention`, schedule summaries carry `attentionRuns`, and `schedule.run.resolve.request` dismisses a run. Gated on `server_info.features.scheduleRunAttention`
- Fork-only (upstreamable): archiving a worktree workspace with an open pull request asks first, like uncommitted changes and unpushed commits already do. The dialog names the PR (`Open pull request #42`, `Open merge request !7` on GitLab); merged and closed PRs archive without asking
- FSH-only (upstreamable): the Explorer sidebar keeps one width across workspaces instead of a width per workspace, so switching workspaces no longer resizes it. Existing per-workspace widths migrate to the most recently added one

- FSH-only (not upstream yet): composer plugins can opt into a tab in the existing resizable Explorer sidebar on desktop; clicking the badge shows or closes it. Existing plugins retain anchored popovers, and compact layouts retain bottom sheets. Asks opts in.
- FSH-only (upstreamable): plugins can open another plugin's screen (`navigation.openPluginScreen`, checked with `navigation.hasPluginScreen`), so a paseo-prs row can open its review in paseo-inbox
- FSH-only (upstreamable): MCP `create_schedule`/`update_schedule` take `archiveOnFinish` and `isolation`, and `paseo schedule create`/`update` take `--archive-on-finish`/`--no-archive-on-finish` and `--isolation`, so runs can stay in the sidebar without the app. Before, `update_schedule` dropped an unknown `archiveOnFinish` without an error
- FSH-only (upstreamable): a schedule's **View runs** menu item lists its runs newest first, each with its status, start time, how long it took and the error if it failed. Tapping a run opens the agent it started
- FSH-only (upstreamable): Codex agents learn about `alwaysLoad` MCP servers (plugin tools like `status_set`, `ask_create`, `prs_link`). Codex defers every MCP tool behind its tool search and has no per-server eager setting, so the daemon names these servers in the developer instructions and tells the agent to load their tools before its first reply. Before, Codex agents rarely used them: 20% created asks and 3% published a status card, against 92% and 72% for Claude
- FSH-only (upstreamable): stdio MCP servers started by Codex receive `PASEO_AGENT_ID`. Codex starts them with only a few default variables, so plugin bridges such as Asks couldn't tell which agent was calling and fell back to guessing by working directory, which failed when two agents ran in one worktree. The daemon lists the variable in each server's `env_vars`
- FSH-only (upstreamable): **Collapse tool calls** is the default chat display. Upstream defaults new installs to Collapse turns and maps existing ones from the legacy tool call preference to Full or Collapse tool calls; a one-time settings migration moves every existing install to Collapse tool calls, and picking another display afterwards sticks
- FSH-only (upstreamable): opening History focuses its search box when a mouse drives a wide layout (desktop app, desktop browsers), so you can type a query straight away. Touch screens and compact layouts skip it so the on-screen keyboard doesn't cover the list
- FSH-only (upstreamable): a workspace whose worktree was deleted, for example by its own agent, is archived together with its agents and terminals on the next reconciliation pass, once none of its agents is running. Before, its agents stayed idle and every message to them failed with `Working directory does not exist`, so a plugin like Asks lost the human's click. A missing directory inside Paseo's worktrees root counts as deleted even when the workspace's project is rooted at that same directory
- FSH-only (not upstream yet): a finished turn in a background workspace notifies nobody (no push, no in-app alert); the plugin that started it notifies instead. Errors and permission prompts still notify
- FSH-only (upstreamable): a **Lineage** tab in the Explorer sidebar lists the focused agent's parents and the agents it started, with the workspace each runs in; clicking one opens it. It's added once per workspace the first time a parent or child runs in another workspace, and stays closed once you close it. Also in the Explorer + menu. Detaching a subagent records its former parent (`paseo.detached-from`), so it stays in Lineage marked "Detached"
- FSH-only (not upstream yet): **Ready to review** stays until you send the agent a prompt or choose **Mark as read**. Opening, focusing or leaving the chat no longer clears it. Errors still clear on view. Upstream declined a setting for this (getpaseo/paseo#9155; discussion getpaseo/paseo#4495); getpaseo/paseo#2892 did the same and was closed unmerged
- FSH-only (not upstream yet): opening a workspace without naming a tab (sidebar, Command Center, a shortcut, a workspace link) focuses an agent waiting on a permission prompt, then one that failed, and otherwise shows the tab you left (agent, terminal, file or plugin). Ready to review no longer takes focus on entry: it stays after a visit, so the oldest finished agent kept winning over the tab you were on. A named tab (notification, link to an agent, plugin `openAgent`) still opens that tab
- FSH-only (upstreamable): a Paseo worktree with no commits of its own shows **Archive workspace** as its main git action, not **Update from <base>**. Its work is done or went to another repo, so there is nothing to update
- FSH-only (upstreamable): after a squash or rebase merge, the Changes panel and the diff badge stop counting the branch's merged commits and show only work that isn't in base yet. Before, a merged branch kept its full diff until it was archived

- FSH-only (not upstream yet): desktop can show the Explorer sidebar when you enter a workspace. Settings → Open location → **Entering a workspace opens the Explorer sidebar**: Never, When something needs you (default), Always. Something needs you means a permission prompt, a failed agent, failing PR checks, a PR ready to merge or merged, or a plugin's workspace summary item (`addWorkspaceSummaryItem`, used by Asks). Explorer opens on that tab; hiding it keeps it hidden in that workspace until something new needs you
- FSH-only (not upstream yet): an **Overview** tab in the desktop Explorer sidebar answers what's the goal and status (a plugin's `status` card, with its optional `goal` in its own section above and, while blocked, its optional `blockedBy` PRs, people and other blockers as **Waiting on** under it; a row opens its link), and what's my move (permissions, plugin `entries` such as asks, one open at a time, failures, and Archive once the PR merged or the status card says done and nothing else in the workspace still runs or reports open work; no git steps or failing checks, since the agent handles git), then **Pull requests** for information: a plugin's `pullRequests` list (paseo-prs: the branch's PRs, their stack and linked PRs) or else the branch's PR, merged ones folded, and "No PR yet" with what a PR would propose. Between them a **Tree** shows where the workspace sits: its ancestor workspaces root first, itself (with its agent count when it has several), and its children (those needing you first), each generation indented behind a ↳; then the workspaces and agents it is **Blocked by** and the workspaces whose blocked status names it (**Blocking**). It's added once per workspace, first in the rail
- FSH-only (upstreamable): New workspace drafts you leave unsent, forks from **Fork chat from here** included, are listed under **Drafts** at the top of the sidebar. A draft joins the list once you leave its screen and then stays in place, highlighted while open; the list is ordered by when each draft first appeared in this session, so typing doesn't reorder it (after a restart it starts from last edit). A row shows the project and the first line of the text; clicking it reopens the draft and hovering shows a discard button. Before, a fork's draft kept its text but nothing led back to it once you switched to another workspace. A fork's chat history stays in memory only, so after an app restart its draft reopens without it
- FSH-only (upstreamable): the New workspace screen lists your most recently used projects on the selected host as **Recent projects** cards, under the composer on desktop and above the fields on mobile. Each card shows the setup the project's last agent ran with (model, mode, thinking); choosing a card selects the project and applies that setup in one click. Recency is the latest prompt, or the newest workspace. The daemon saves each project's last prompted setup on the project (`projectLastAgentSetup`), so it survives archiving that agent and its workspace; older hosts fall back to open agents only
- FSH-only (not upstream yet): the sidebar groups idle workspaces by what their agents reported instead of by whether the last turn was read. Plugins set `workState` (`waiting`/`blocked`/`working`/`done`) and `needsYou` on workspace summary items; needs-you and waiting go to Ready to review, working to Working, done to Done, and blocked (work waiting on other workspaces, a reviewer or CI; working wins over it) to a **Blocked** group below the others, marked with a yellow pause glyph on its header and rows (the Overview status pill uses the same yellow). Hosts before `blocked` drop it and group the workspace by its turn. The desktop dock badge counts by this grouping, so Blocked and reported-Done workspaces don't count. Live state (a running turn, a failure, a permission prompt) still wins; a workspace held in Working only by an idle agent's background shells (e.g. a dev server it started) is grouped by the report too; a live Monitor watch keeps it in Working
- FSH-only (not upstream yet): **Move to** in a workspace's menu puts an idle workspace in Ready to review, Done or Blocked by hand, on every device. The move holds until an agent there starts a turn (the daemon clears it) or publishes a newer status; live state still wins. It replaces Mark as read / Mark as unread: Done also reads the workspace, Ready to review also marks it unread. It's offered whenever the turn is idle, including a workspace held in Working by a report or a dev server; while a turn runs, fails or waits on a permission it isn't, and Mark as read stays for a failed turn. Gated on `server_info.features.workspaceManualGroup`; older hosts keep the old items
- FSH-only (upstreamable): the HTML file preview inlines the `.css` stylesheets and `.js`/`.mjs` scripts a page links from its own folder, so a page split across files (design storyboards, `index.html` + `styles.css`) renders styled instead of as bare markup. Hidden files, other file types, symlinks that resolve outside the folder, and remote URLs are not inlined; the preview's CSP is unchanged
- FSH-only (upstreamable): a search field at the top of Settings finds sections and individual settings ("code font", "scrollback", "restart daemon") in the app's language and opens the section. The searchable settings are a list in `packages/app/src/screens/settings/search/settings-search-index.ts`; add new setting rows there
- FSH-only (upstreamable): git status and PR status requests from the app skip ahead of background git refreshes in the workspace-refresh queue, and a background refresh a client joins leaves upstream's `background` git lane. With about 100 observed workspaces they used to wait behind every startup and watcher refresh, taking 45s to 5 minutes; now about 4s
- FSH-only (upstreamable): creating a worktree workspace no longer waits for the source checkout's git status. When you picked no branch and the status hasn't loaded, the daemon resolves the default base itself. That status request took up to five minutes on a busy daemon while the create itself took seconds
- FSH-only (upstreamable): while a workspace is being created, the New workspace screen shows **Start another**. It clears the form for the next workspace and lets the first one finish in the background without navigating to it; it appears in the sidebar when ready
- FSH-only (upstreamable): bare `file://` URLs in Markdown (chat, asks, plugin Markdown) are links, like bare `http(s)://` URLs, and open at the line in a `#L42` or `:42` suffix. Before, `file:///Users/…/index.html` in prose stayed plain text unless written as `[label](file:///…)`
- FSH-only (upstreamable): a Markdown table right under a text line, with no blank line between (like `**Widgets**` then `| A | B |`), renders as a table in chat, asks and plugin Markdown. GitHub allows it; the engine only started a table on a paragraph's first line, so the whole table showed as pipes
- FSH-only (upstreamable): the home screen leads with a **New workspace** tile once any host has a project, opening the New workspace screen. Before, the home screen only offered setup tiles, so a returning user had to open the sidebar to start work. First runs still see only the setup tiles
- FSH-only (upstreamable): inline-code paths with spaces in a folder or file name (`~/Dropbox/my notes/plan.pdf`) are file links when they start at `/`, `~/` or a drive and end in a file name. Any whitespace used to rule a token out, so such paths stayed plain text. Commands and lists of paths (`cat ~/a.md`, `~/a.md ~/b.md`, `/x.sh --watch`) stay text
- FSH-only (upstreamable): starting a worktree workspace in a repository with no commits, such as a fresh clone of an empty GitHub repo, opens a sheet instead of failing with `Base branch not found: main`. **Create main** makes the branch HEAD names with an empty first commit, pushes it to origin when there is one, and starts the worktree; **Use local checkout** starts in the checkout itself, which needs no commit. The daemon rejects the worktree with `repository_has_no_commits`, and `checkout.create_initial_branch.request` (with `dryRun` to read the branch name first) creates the branch. Gated on `server_info.features.checkoutCreateInitialBranch`
- FSH-only (upstreamable): `browser_new_tab` no longer times out when Electron announces the new tab before the app can read its id, which often happened in a workspace not open in the desktop window (getpaseo/paseo#7348). Registration waits one IPC round trip. getpaseo/paseo#8128 waits for `dom-ready` instead, which times out on pages slower than five seconds, downloads and 204s
- FSH-only (upstreamable): when the last workspace you used was archived on another device, **Workspace unavailable** offers **Home** and **New workspace** instead of an unlabelled **Back**, and the app forgets that workspace, so the next launch opens the home screen instead of the same dead end. Links to an archived workspace still show its screen
- FSH-only (upstreamable): a plugin's `navigation.openAgent` takes an optional `timelinePosition: { epoch, seq }` and opens the chat scrolled to that timeline entry, opening its collapsed turn, on web and desktop. paseo-asks uses it for **Show in chat**, which jumps to the ask in its agent's chat

Keep this list in sync with what's merged into `fsh`.

## Install the desktop app and plugins (macOS, Fedora)

Requires macOS 13 (Ventura) or newer on Apple Silicon, or x86_64 Linux with `dnf` (Fedora, RHEL and derivatives).
One script installs the latest FSH release, links the `paseo` CLI, and installs or updates the
[FSH plugins](#fsh-plugins). Run it again to update:

```bash
curl -fsSL https://raw.githubusercontent.com/fullstackhouse/paseo/fsh/scripts/install-fsh.sh | bash
```

When a newer build is out, the script quits Paseo and stops the daemon before swapping the app, so run it when no agent
is mid-turn. It asks first; `--yes` skips the question. Every FSH build reports the same `0.13.0-beta.1`, so neither
the app nor the daemon notices a swap underneath it — that's why the script stops both. It records the installed
release tag in `~/.paseo/fsh-release` and does nothing when that matches the latest (`--force` reinstalls).

macOS builds are signed with the self-signed FSH certificate "Paseo FSH" (not notarized, not a Developer ID), so macOS
remembers your answers to its folder-access prompts (Documents, Downloads, network volumes) across updates. Ad-hoc
builds asked again after every update. You don't need to trust the certificate. Its public half is
`.github/fsh-macos-signing.crt`; the `.p12` is in GCP Secret Manager (`paseo-macos-signing-p12{,-password}`) and in the
fork secrets `PASEO_MACOS_SIGNING_P12_{BASE64,PASSWORD}`. Rotating it makes every Mac ask once more.

To see which build you're running, open Paseo → About Paseo: it shows the commit (`Version 0.13.0-beta.1 (fsh.<sha>)`),
the build time, and links to the release and the commit.

On macOS it also removes the Homebrew `paseo-fsh` or upstream `paseo` cask if either is installed, since `brew upgrade`
would put its own build back. On Linux it installs the RPM with `dnf` (into `/opt/Paseo`, CLI at
`~/.local/bin/paseo`) and asks for your password through `sudo`. The RPM's release field carries the CI run number, so
each build is a `dnf` upgrade of the last. Your `~/.paseo` data and hosts are kept. Plugins you installed from a local directory are left
alone. `--no-plugins` skips the plugin step.

Once installed, Paseo checks every 30 minutes whether GitHub's latest release is newer than its own build (`fshBuild`,
the release tag stamped into the app). If it is, an **Update available** callout appears at the bottom of the sidebar.
**Install & restart** runs this script with `--yes` in the background and writes its output to `fsh-update.log` in
the app's log folder (`~/Library/Logs/Paseo`, `~/.config/Paseo/logs` on Linux). With no terminal to type a `sudo`
password into, the Linux install asks through `pkexec`'s desktop dialog. Releases from before the Linux build have no
RPM, so Linux installs aren't offered them. Settings → App updates runs the same check. If the app was replaced on
disk some other way, the callout offers a plain restart. Builds from before this updater have no stamp, so run the
script by hand once.

Then install at least one agent CLI (Claude Code, Codex) and `gh`, both signed in. Paseo runs them; it doesn't ship
one.

A DMG built before the `hardenedRuntime=false` fix dies at launch on macOS 26 with
`Library not loaded: @rpath/Electron Framework.framework/Electron Framework` and
`different Team IDs`. Download a newer DMG, or re-sign the installed copy ad-hoc:

```bash
codesign --force --deep --sign - /Applications/Paseo.app
```

That drops hardened runtime, which is what blocked the load. It also drops the
entitlements, including `com.apple.security.device.audio-input` — so prefer a newer
DMG if you use voice input.

## Install the Android app

Our own build of the mobile app, from `fsh`: package `house.fullstack.paseo`, installs next to
the store app. Push notifications go through our own Expo project (`@fullstackhouse/paseo-fsh`)
and Firebase (`fsh-paseo-push`, managed in fsh-monorepo `infra/paseo-push`): the daemon sends
the notification text (agent name, message preview) through Expo and Google.

**FSH people: install it from Google Play.** Open
**[the internal test invite](https://play.google.com/apps/internaltest/4701430887974252619)** on the
phone, accept it, then install "Paseo FSH" from the Play Store. It updates itself. You must be on
the "FSH" tester list in Play Console (ask Jacek) and signed in to Play with that
`@fullstack.house` Google account. Every push to `fsh` uploads a new build to that track
(`fsh-android.yml`). Then continue at step 3 below.

**Everyone else, or without Play:**

1. On the phone, open **[paseo-fsh-arm64.apk](https://github.com/fullstackhouse/paseo/releases/download/fsh-android-latest/paseo-fsh-arm64.apk)**,
   a link that always serves the newest build, or scan:

   <img src="docs/fsh/android-apk-qr.png" width="160" alt="QR code: Paseo FSH Android APK">

   **Automatic updates:** install [Obtainium](https://github.com/ImranR98/Obtainium) and add an app:
   source URL `https://github.com/fullstackhouse/paseo`, **Filter release titles by regular
   expression** `^Paseo Android \d`, **Filter APKs by regular expression** `paseo-fsh-.*-arm64\.apk`.
   The title filter matters: most releases here are desktop DMGs with no APK.

2. Allow installs from that app when Android asks.
3. Allow notifications when the app asks.
4. Add hosts as a direct connection: e.g. `jaceks-macbook-pro.tailc790a0.ts.net`, port `443`,
   SSL on, plus the daemon password. Tailscale must be on.

Play installs and APK installs are the same app signed with the same key (Play App Signing uses
our key), so either can update the other. Every build is signed with the FSH key (GCP Secret Manager: `paseo-android-keystore`,
`paseo-android-keystore-password`; GitHub secrets `PASEO_ANDROID_KEYSTORE_BASE64`,
`PASEO_ANDROID_KEYSTORE_PASSWORD`). Android only accepts updates signed with the same key, so
never rotate it casually.

## FSH plugins

These work on upstream Paseo too (0.12+). The [install script](#install-the-desktop-app-and-plugins-macos-fedora) enables plugins and installs all of them on the local daemon. On another daemon:

```bash
paseo daemon config set pluginsEnabled true && paseo daemon reload
paseo plugin install git:fullstackhouse/<plugin>
paseo plugin ls   # should show "running"
```

- [paseo-asks](https://github.com/fullstackhouse/paseo-asks): what agents need from you (decisions, PRs to merge, manual steps), as a list with answer buttons
- [paseo-status](https://github.com/fullstackhouse/paseo-status): a plain-language status card per agent, written by the agent
- [paseo-limits](https://github.com/fullstackhouse/paseo-limits): Retry and Log in buttons on usage-limit, login and connection errors
- [paseo-prs](https://github.com/fullstackhouse/paseo-prs): composer pills for an agent's PRs, with Create PR when there is none
- [paseo-inbox](https://github.com/fullstackhouse/paseo-inbox): drafts reviews of the PRs you're asked to review, read and posted from a review screen; idle until you add sources and rules in Settings → Plugins → paseo-inbox

Agents that already existed when a plugin was installed don't get its MCP tools. Start a new agent.

## Working on the fork

- **Upstreamable change**: open the PR against `getpaseo/paseo` from your personal fork, then merge
  its branch into `fsh` and add it to the list above.
- **FSH-only change**: open a PR against `fsh` on this repo. CI runs on it.
- **Refresh**: rebase `fsh` onto the latest stable upstream release tag (`v*`, no prerelease), dropping patches upstream merged. Before dropping one as upstreamed, diff what it adds against upstream's version and search the [FSH plugins](#fsh-plugins) for callers of anything upstream left out (#69's `latestTurn()` and #122's plain error text were dropped this way, which would have broken Asks, Status and Limits). A Paseo schedule tries this every Sunday: a low-risk result lands on `fsh` by itself; anything else stays a draft PR for you to land. Keep the
  `fsh`-only commits (this file, the pointers at the top of
  `README.md` / `CLAUDE.md`, `.github/workflows/fsh-desktop.yml`, `.github/workflows/fsh-android.yml`, `.github/workflows/fsh-cli.yml`, `scripts/install-fsh.sh`,
  the `fsh` variant in `packages/app/app.config.js` and `plugins/with-fsh-release-signing.js`).
- **Build**: every push to `fsh` (except edits to this file, `README.md` or `docs/fsh/`) builds the DMG, the Linux RPM and the Android APK
  and publishes a release for the desktop pair and one for Android (`fsh-*`, `fsh-android-*`). The desktop release
  waits for both: if one build fails, nothing ships, so macOS and Linux stay on the same commit. For a flaky build, use
  **Re-run failed jobs**.
- **Servers**: the same pushes build the Linux CLI and daemon bundle (`fsh-cli-*`, `.github/workflows/fsh-cli.yml`). The FSH agent box pins one by tag and sha256.
  The build runs upstream's packaged-app smoke test first. You can also start it by hand:
  Actions → FSH desktop build → Run workflow.
  To test a PR's desktop build, add the `deploy` label: every push then publishes a prerelease `fsh-pr<N>-<sha>`
  with the DMG and RPM (a manual run on another branch publishes `fsh-test-<sha>`). `install-fsh.sh` and the in-app updater
  only install the latest release, which never points at a prerelease. Closing the PR deletes its prereleases.
- **Upstream workflows**: they trigger on pushes to `main` and on `v*` tags, and need upstream's
  secrets. Don't push `main` or `v*` tags here. Our release tags are `fsh-*`.
