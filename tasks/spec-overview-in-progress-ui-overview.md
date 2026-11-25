# Overview: work in progress — cards (O, E)

Map: [spec-overview-in-progress-ui-map.md](./spec-overview-in-progress-ui-map.md). Spec: [spec-overview-in-progress.md](./spec-overview-in-progress.md).

## Area-wide

- **Who.** The operator, running 10–30 agent workspaces; agents take asks on, run subagents and leave
  background jobs (merge queues, watchers, dev servers) running.
- **Device.** Desktop: Overview tab in the Explorer sidebar, ~360–480 px wide. Mobile: the workspace
  sheet, full width. Same content, same order.
- **Rows.** As in the approved Overview: one line per row, a name, a muted facts word, a chevron when it
  opens something. Tones as the app's state words: running accent, waiting warning, blocked/failed danger,
  done success, idle muted.
- **Live.** Rows appear, change and leave in place as turns start and end, jobs stop and asks move; no
  refresh control.
- **Buttons.** Your move keeps its buttons. In progress has buttons only inside an expanded ask (O5).
- **Permissions.** None beyond opening the workspace.

## O4 In progress (P1)

- **Short.** What is moving in this workspace without you: agents, their subagents and background work,
  and asks the agent has taken on.
- **Change.** New.
- **Extended.** A section directly after Your move, hidden when nothing is in progress. One row per agent
  that has a running turn, subagents running or background work, and one row per ask in progress
  (A5, A6). Under an agent row, its subagents fold into one indented line ("↳ 6 subagents · 2 working")
  and each background job into its own indented line ("↳ merge-queue.sh · running 2h"). An ask row shows
  its title, what it waits on and its age; PR asks take the word from the PR ("CI running", "review
  requested", "merged"), other asks the agent's own "waits on" line, otherwise only the age (A7). An ask
  that nothing moves (no running turn of its agent, no live background job, no watched open PR) shows
  "nothing moving" in the warning tone (A8). Every time on a row means "since it last changed", as in Your move, Status and the sidebar: an ask since
  its last update, an agent since its last activity, a background job since it started (A21). Order: oldest
  first by that time, across all kinds, so what moved least recently comes first (A13, A21). Five rows show, then "Show all (N)".
- **Get here.** Overview tab, after Your move.
- **Shows.** Section label "In progress" with the row count; agent rows ("Billing track lead · working ·
  3m"), indented subagent and background lines, ask rows ("PR #2104 — invoices list · CI running · 20m").
- **Scenarios.** Coming back to a track lead after lunch: "In progress · 4", one agent working with two
  subagents, three PR asks on CI; nothing to do. Opening a workspace that looks finished: Status says
  Working 8h ago, In progress lists five asks, two "nothing moving"; expand one and take it back.
- **Variants.** Busy (agent, subagents, shell, asks); stuck (only asks, two nothing moving); idle agent
  with a background job only; more than five rows (Show all); nothing in progress (section absent);
  mobile sheet of stuck.
- **Edge cases.** An agent row opens its tab; a subagent line opens that agent's subagents popover; a
  background line opens the owning agent's tab. Archiving an agent ends its background jobs (the daemon
  closes its session), so its rows leave the section with it. An ask whose PR merged while in progress →
  "merged · waiting on the agent", in the warning tone once 10 minutes pass with nothing moving.

## O5 In-progress ask (P1, expanded row on O4)

- **Short.** One in-progress ask opened in place: what it is, what it waits on, and a way to take it back.
- **Change.** New.
- **Extended.** Pressing an ask row expands it in place, like an open Your move row; one row is open at
  a time across Your move and In progress. It shows the ask's body (rendered markdown, first lines, then
  "More"), a facts line ("Waits on CI for #2104 · taken 20m ago · last moved 5m ago"), its links, and
  three actions (A10): **Take it back** sets the ask open and moves it to Your move with its own buttons;
  the agent is told. **Remind agent** asks the owner to update the ask or hand it back; the row says
  "Reminded just now" until the agent updates it. **Show in chat** opens the agent at the ask.
- **Get here.** An ask row in O4.
- **Shows.** The expanded row: title, body, facts line, links, the three actions as quiet buttons.
- **Variants.** PR ask waiting on CI; ask with nothing moving (warning facts line); just reminded; after
  Take it back (the row leaves In progress and opens in Your move).
- **Edge cases.** The owner agent is archived → Remind agent is absent and the facts line says "agent
  archived"; Take it back still works. The ask changes while open (the agent resolves it) → the row
  collapses and leaves with the section's normal update.

## E1 Your move (P1)

- **Short.** What waits on you, and nothing else; Archive now also waits for asks in progress.
- **Change.** Changed — the muted "Archive waits for background work" row is removed; Archive does not
  appear while any ask is in progress.
- **Extended.** Asks, permissions, failed agents and Archive once shipped, as approved. Archive now waits
  while any ask is in progress, as it waits for background work (A11); In progress below says what it
  waits for, so Your move shows no placeholder row.
- **Get here.** Overview tab, after Status and Waiting on.
- **Shows.** Your move rows as today; no Archive row while In progress lists work.
- **Variants.** PR merged with two asks in progress (no Archive; In progress below); PR merged with a
  background job running (no Archive, no placeholder row; the job in In progress); everything finished
  (Archive).
- **Edge cases.** An ask taken back from In progress lands here, open, with its buttons.

## E2 Status (P1)

- **Short.** The status card now says how old it is and warns when it claims work that nothing is doing.
- **Change.** Changed — the card's age is new next to the state word; a warning line is new when the card
  says Working and nothing runs.
- **Extended.** The state word reads "Working · updated 8h ago" (A9). When the card says Working and the
  workspace has no running agent turn, subagent or background job, a warning line under the summary
  reads "Nothing is running in this workspace." The existing "You replied 4m ago; the agent hasn't updated
  this since." line stays and shows above the warning when both apply.
- **Get here.** Overview tab, under the title.
- **Shows.** State pill, "· updated 8h ago", summary, the warning line in the warning tone.
- **Variants.** Fresh working card (age only); stale working card with nothing running (warning); working
  card with only a background job live (age only, no warning); done card (age only).
- **Edge cases.** No status card → nothing changes: the state word comes from the agents, with no age. A
  card updated under a minute ago reads "updated just now".

## Decisions (cards, 2026-11-25)

1. In progress rows go oldest first across all kinds (A13).
2. Five rows show, then "Show all (N)" (A14).
3. One open row for the whole tab across Your move and In progress; a Your move ask you started replying to stays open (A15).
4. Take it back acts at once, with no confirmation; the row moving into Your move is the feedback (A16).
5. No placeholder row in Your move while Archive waits; In progress below is the explanation (A17).
6. The "Nothing is running" warning covers Working cards only (A18).
7. An ask whose PR merged while in progress reads "merged · waiting on the agent", muted; it turns into "nothing moving" in the warning tone after 10 minutes with no turn running (A19).
8. Stage 2 approved (A20).
9. Times on In progress rows mean "since it last changed", as everywhere else on Overview: ask since its last
   update, agent since its last activity, background job since it started; rows sort by that time (A21).
