// Mockup states for areas O and E: the Overview tab with the Tree and Pull requests sections.
//
// Frames: desktop is the Explorer panel at 420 wide (tab strip + body); mobile is the 390 workspace
// sheet. O1 draws the whole tab. O2, O3, E1 and E2 draw the panel cropped around the focus section
// (a "⋯" cut marks what is left out). Anatomy follows overview-v3 (.ov-): title + goal, status card,
// lead "Your move" row with buttons, context rows. Data is fictional.

export const OT_ICONS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  dash: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  files: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  diff: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M9 10h6"/><path d="M12 13V7"/><path d="M9 17h6"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  fork: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  agent: '<path d="M12 4v16"/><path d="M18.9 8 5.1 16"/><path d="m5.1 8 13.8 8"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
}

export function overviewStates({ ic, esc }) {
  const CH = `<span class="ot-chev">${ic('chevron-right')}</span>`

  // ── fixtures (fictional) ───────────────────────────────────────────────
  const SPEC = 'Spec — overview rework'
  const IMPL = { name: 'Impl — tree section', goal: 'Show the workspace tree and its PRs on Overview.' }

  // ── pieces ─────────────────────────────────────────────────────────────
  const identity = (name, goal) => `<header class="ot-id"><h1 class="ot-title">${esc(name)}</h1><p class="ot-goal">${esc(goal)}</p></header>`
  const status = ({ word, tone, pulse, summary, now }) => `<section class="ot-story">
    <div class="ot-state ot-t-${tone}"><i class="ot-dot ${pulse ? 'is-pulse' : ''}"></i>${esc(word)}<span class="ot-chev ot-push">${ic('chevron-right')}</span></div>
    ${summary ? `<p class="ot-summary">${esc(summary)}</p>` : ''}
    ${now ? `<p class="ot-now"><b>Now</b>${esc(now)}</p>` : ''}
  </section>`
  const cut = () => `<div class="ot-cut">⋯</div>`

  const sec = (title, body, { count, warn, suffix } = {}) =>
    `<section class="ot-sec"><div class="ot-sec-title">${esc(title)}${count ? `<span class="ot-n ${warn ? 'is-warn' : ''}">${count}</span>` : ''}${suffix ? `<span class="ot-suffix">${esc(suffix)}</span>` : ''}</div>${body}</section>`

  // Your move (E1)
  const lead = ({ icon, tone, title, sub, actions, error }) => `<div class="ot-item is-lead" style="--lead: var(--app-${tone})">
    <div class="ot-item-head"><span class="ot-item-icon ot-t-${tone}">${ic(icon)}</span>
      <div class="ot-item-text"><div class="ot-item-title">${esc(title)}</div>${sub ? `<div class="ot-item-sub">${esc(sub)}</div>` : ''}${error ? `<div class="ot-item-err">${ic('alert')}${esc(error)}</div>` : ''}</div></div>
    <div class="ot-actions">${actions.map((a) => `<button type="button" class="ot-btn ${a.primary ? 'is-primary' : ''} ${a.ghost ? 'is-ghost' : ''}">${esc(a.label)}${a.note ? `<small>${esc(a.note)}</small>` : ''}</button>`).join('')}</div>
  </div>`
  const next = ({ icon, tone, title, sub }) => `<div class="ot-next"><span class="ot-t-${tone}">${ic(icon)}</span><span class="ot-next-title">${esc(title)}</span>${sub ? `<span class="ot-word ot-t-muted">${esc(sub)}</span>` : ''}${CH}</div>`
  const move = (items) => sec('Your move', `<div class="ot-move">${lead(items[0])}${items.slice(1).map(next).join('')}</div>`, { count: items.length > 1 ? items.length : 0, warn: true })

  const ASK = { icon: 'ask', tone: 'warn', title: 'Show all children or cap at five?', sub: 'Eight children make the Tree longer than the rest of the tab.', actions: [{ label: 'Cap at five', note: 'recommended', primary: true }, { label: 'Show all' }, { label: 'Discuss…', ghost: true }] }
  const PERM = { icon: 'shield', tone: 'warn', title: 'Allow the agent to run npm run typecheck?', sub: 'Runs the app and server typecheck once.', actions: [{ label: 'Allow', primary: true }, { label: 'Allow always' }, { label: 'Deny', ghost: true }] }
  const ASK2 = { icon: 'ask', tone: 'warn', title: 'Name the group "Blocking" or "Unblocks"?' }
  const ARCHIVE = { icon: 'archive', tone: 'merged', title: 'Ready to archive', sub: 'PR #231 merged · nothing uncommitted', actions: [{ label: 'Archive workspace', primary: true }] }

  // Tree (O2). level indents the ancestor chain; off = muted and not pressable; here = the anchor row.
  const trow = ({ name, word, tone = 'muted', started, level = 0, here, off, agent, link, dim }) =>
    `<div class="ot-row ${here ? 'is-here' : ''} ${off ? 'is-off' : ''}" style="--lv:${level}">${agent ? `<span class="ot-ricon">${ic('agent')}</span>` : ''}<span class="ot-name">${esc(name)}${dim ? `<span class="ot-dim"> · ${esc(dim)}</span>` : ''}</span>${word ? `<span class="ot-word"><span class="ot-t-${tone}">${esc(word)}</span>${started ? `<span class="ot-dim"> · ${started} started</span>` : ''}</span>` : ''}${(here && !link) || off ? '' : CH}</div>`
  const grp = (label, rows) => `<div class="ot-grp"><div class="ot-grp-label">${esc(label)}</div>${rows.join('')}</div>`
  const more = (n) => `<div class="ot-row ot-more"><span class="ot-name">Show all (${n})</span>${CH}</div>`
  const tree = (groups) => sec('Tree', groups.join(''))

  const PARENT = { name: SPEC, word: 'Done · PR merged', tone: 'ok' }
  const KIDS2 = [
    { name: 'Review fork — tree rows', word: 'Working', tone: 'run' },
    { name: 'Review fork — PR facts', word: 'Working', tone: 'run' },
  ]
  const startedBy = (rows) => grp('Started by', rows.map((r, i) => trow({ ...r, level: i })))
  const hereRow = grp('This workspace', [trow({ name: IMPL.name, here: true, level: 1 })])
  const hereAgents = grp('This workspace', [trow({ name: IMPL.name, dim: '3 agents', here: true, link: true, level: 1 })])
  const agentsRow = (level = 0) => `<div class="ot-grp">${trow({ name: 'Agents', dim: '3 here', word: '1 working', tone: 'run', agent: true, level })}</div>`
  const started = (rows, extra = []) => grp('Started', [...rows.map((r) => trow(r)), ...extra])

  // Pull requests (O3)
  const prow = ({ num, repo, title, facts, tone = 'muted', indent }) =>
    `<div class="ot-row ${indent ? 'is-indent' : ''}"><span class="ot-pr">${repo ? `<span class="ot-dim">${esc(repo)}</span>` : ''}#${num}</span><span class="ot-name">${esc(title)}</span><span class="ot-word ot-t-${tone}">${esc(facts)}</span>${CH}</div>`
  const fold = (n, open) => `<div class="ot-row ot-fold"><span class="ot-ricon">${ic(open ? 'chevron-down' : 'chevron-right')}</span><span class="ot-name">${n} merged</span></div>`
  const waitingOn = (rows) => sec('Waiting on', rows.map((r) => `<div class="ot-row"><span class="ot-ricon">${ic(r.icon)}</span><span class="ot-name">${esc(r.name)}</span><span class="ot-word ot-t-warn">${esc(r.word)}</span>${CH}</div>`).join(''))
  const nopr = (facts, branch) => `<div class="ot-row"><span class="ot-pr ot-fix">No PR yet</span><span class="ot-word ot-t-muted ot-facts">${esc(facts)}</span><span class="ot-branch">${esc(branch)}</span>${CH}</div>`
  const prs = (rows, { count, suffix } = {}) => sec('Pull requests', rows.join(''), { count, suffix })

  // Context footer (E2)
  const ctx = (rows) => `<footer class="ot-ctx">${rows.map((c) => `<div class="ot-ctx-row"><span class="ot-k">${esc(c.k)}</span><span class="ot-v">${esc(c.v)}</span>${c.w ? `<span class="ot-word ot-t-muted">${esc(c.w)}</span>` : ''}${CH}</div>`).join('')}</footer>`
  const PLUG = [
    { k: 'Release', v: 'Lane 2 of 4', w: 'on track' },
    { k: 'Budget', v: '62% of daily cap' },
  ]

  // ── frames ─────────────────────────────────────────────────────────────
  const TABS = [['dash', 'Overview'], ['files', 'Files'], ['diff', 'Changes'], ['pr', 'PR'], ['ask', 'Asks'], ['fork', 'Lineage']]
  const tabs = () => `<div class="ot-tabs">${TABS.map(([i, l], n) => `<div class="ot-tab ${n === 0 ? 'is-on' : ''}">${ic(i)}<span>${l}</span></div>`).join('')}<span class="ot-tabs-end">${ic('plus')}${ic('panel')}</span></div>`
  const desktop = (body) => `<div class="frame ot-frame"><div class="ot-win dark">${tabs()}<div class="ot-ov">${body}</div></div></div>`
  const mobile = (name, body) => `<div class="frame ot-frame"><div class="ot-win ot-mobile dark">
    <div class="ot-behind"><div class="ot-behind-head">${esc(name)}</div><i class="ot-bub"></i><i class="ot-bub w60"></i><i class="ot-bub w80"></i></div>
    <div class="ot-sheet"><div class="ot-handle"></div><div class="ot-sheet-title">${ic('dash')} Overview</div><div class="ot-ov">${body}</div></div></div></div>`
  const crop = (...parts) => desktop([cut(), ...parts, cut()].join(''))

  // O1 whole-tab builders
  const full = (parts) => parts.filter(Boolean).join('')
  const impl = { head: identity(IMPL.name, IMPL.goal) }
  const STATUS_WORK = status({ word: 'Working', tone: 'run', pulse: true, summary: 'Tree rows render and update live. Wiring the PR facts into the last section.', now: 'Running the app typecheck' })
  const STATUS_WAIT = status({ word: 'Waiting on you', tone: 'warn', summary: 'Tree and PR sections are built and tested (31/31). One decision left before review.' })
  const PR_MAIN = prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'checks running', tone: 'run' })])

  // ── states ─────────────────────────────────────────────────────────────
  return {
    O1: [
      {
        id: 's1',
        caption: 'Working — no move; tree and PRs below',
        html: desktop(full([impl.head, STATUS_WORK, tree([startedBy([PARENT]), hereAgents, started(KIDS2)]), ctx(PLUG), PR_MAIN])),
        notes: ['Rows and facts update in place; there is no refresh control.'],
      },
      {
        id: 's2',
        caption: 'Waiting on an ask — move first, rest below',
        html: desktop(full([impl.head, STATUS_WAIT, move([ASK, ASK2]), tree([startedBy([PARENT]), agentsRow()]), prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'draft', tone: 'muted' })])])),
      },
      {
        id: 's3',
        caption: 'Done and merged — Archive move, merged PR',
        html: desktop(full([impl.head, status({ word: 'Done', tone: 'ok', summary: 'PR #231 is merged. Overview now shows the tree and PRs; git moves are gone.' }), move([ARCHIVE]), tree([startedBy([PARENT]), hereRow, started([{ name: 'Review fork — tree rows', word: 'Done · PR merged', tone: 'ok' }, { name: 'Review fork — PR facts', word: 'Done', tone: 'ok' }])]), prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'merged', tone: 'merged' })])])),
      },
      {
        id: 's4',
        caption: 'Bare workspace — identity and status only',
        html: desktop(full([identity('Notes cleanup', 'Merge the meeting notes into one file per topic.'), status({ word: 'Working', tone: 'run', pulse: true, summary: '9 of 14 notes merged.', now: 'Merging "Roadmap sync"' })])),
      },
      {
        id: 's5',
        caption: 'Mobile sheet — waiting on an ask',
        html: mobile(IMPL.name, full([impl.head, STATUS_WAIT, move([ASK, ASK2]), tree([startedBy([PARENT]), agentsRow()]), prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'draft', tone: 'muted' })])])),
        notes: ['Same content and order as the desktop panel; buttons fill the row width.'],
      },
      {
        id: 's6',
        caption: 'No status card, git loading — state from agents, no PR section',
        html: desktop(full([impl.head, status({ word: 'Working', tone: 'run', pulse: true }), tree([startedBy([PARENT]), agentsRow()])])),
        notes: ['The Pull requests section appears once git status loads, without a spinner.'],
      },
      {
        id: 's7',
        caption: 'Waiting on a PR review and a person, plus Tree Blocked by a workspace',
        html: desktop(full([impl.head, status({ word: 'Blocked', tone: 'danger', summary: 'Tree and PR sections are done. Release needs a review and a sign-off before the PR can open.' }), waitingOn([{ icon: 'pr', name: '#240 release notes', word: 'waiting on review' }, { icon: 'agent', name: 'Maya · design sign-off', word: 'person' }]), tree([grp('Blocked by', [trow({ name: 'Release 0.16', word: 'Working', tone: 'run' })])]), PR_MAIN])),
        notes: ['Waiting on holds PR, person and other blockers; workspace and agent blockers sit in the Tree.'],
      },
    ],

    O2: [
      {
        id: 's1',
        caption: 'Parent chain, this workspace, children',
        html: crop(tree([startedBy([PARENT]), hereRow, started([{ name: 'Review fork — tree rows', word: 'Waiting', tone: 'warn' }, { name: 'Review fork — PR facts', word: 'Working', tone: 'run', started: 3 }])])),
        notes: ['Pressing a workspace row opens that workspace (its Overview).'],
      },
      {
        id: 's2',
        caption: 'Deep chain — three ancestors, no children',
        html: crop(tree([startedBy([{ name: 'Overview roadmap', word: 'Working', tone: 'run' }, { name: SPEC, word: 'Done', tone: 'ok' }, { name: 'Impl — overview shell', word: 'Working', tone: 'run' }])])),
      },
      {
        id: 's3',
        caption: 'Many children — five shown, then Show all',
        html: crop(tree([started([
          { name: 'Fork — empty states', word: 'Blocked', tone: 'danger' },
          { name: 'Fork — mobile sheet', word: 'Waiting', tone: 'warn' },
          { name: 'Fork — PR rows', word: 'Failed', tone: 'danger' },
          { name: 'Fork — tree rows', word: 'Working', tone: 'run', started: 2 },
          { name: 'Fork — docs', word: 'Done · PR merged', tone: 'ok' },
        ], [more(8)])])),
        notes: ['Children needing you (Waiting, Blocked, Failed) come first, then newest first.'],
      },
      {
        id: 's4',
        caption: 'Blocked by a workspace and an agent',
        html: crop(status({ word: 'Blocked', tone: 'danger', summary: 'Waiting for the release branch before opening the PR.' }), tree([grp('Blocked by', [trow({ name: 'Release 0.16', word: 'Working', tone: 'run' }), trow({ name: 'Reviewer · Docs: screenshots', word: 'Waiting', tone: 'warn', agent: true })])])),
        notes: ['An agent row opens that agent; a workspace row opens its Overview.'],
      },
      {
        id: 's5',
        caption: 'Blocking two workspaces',
        html: crop(tree([grp('Blocking', [trow({ name: 'Docs: Overview screenshots', word: 'Blocked', tone: 'danger' }), trow({ name: 'Fix stale PR facts', word: 'Blocked', tone: 'danger' })])])),
      },
      {
        id: 's6',
        caption: 'Only children — a root workspace',
        html: crop(tree([started([{ name: 'Impl — tree section', word: 'Waiting', tone: 'warn', started: 2 }, { name: 'Impl — PR section', word: 'Working', tone: 'run' }, { name: 'Impl — Your move cleanup', word: 'Done · PR merged', tone: 'ok' }])])),
      },
      {
        id: 's7',
        caption: 'Not loaded, Archived, Removed workspace',
        html: crop(tree([
          startedBy([{ name: 'Overview roadmap', word: 'Not loaded', off: true }, { name: 'Release 0.15', word: 'Archived', tone: 'muted' }]),
          started([{ name: 'Fix stale PR facts', word: 'Not loaded', off: true }]),
          grp('Blocked by', [trow({ name: 'Removed workspace', off: true })]),
        ])),
        notes: ['Not loaded and Removed workspace are muted and not pressable; Archived still opens the workspace.'],
      },
      {
        id: 's8',
        caption: 'Blocks and is blocked by the same workspace',
        html: crop(tree([grp('Blocked by', [trow({ name: 'Release 0.16', word: 'Blocked', tone: 'danger' })]), grp('Blocking', [trow({ name: 'Release 0.16', word: 'Blocked', tone: 'danger' })])])),
      },
      {
        id: 's9',
        caption: 'Several agents, no This workspace row (Agents row)',
        html: crop(tree([startedBy([PARENT]), agentsRow()])),
        notes: ['The Agents row opens the Lineage tab; the This workspace row takes its place once there are children.'],
      },
    ],

    O3: [
      {
        id: 's1',
        caption: 'One open PR, checks passing',
        html: crop(prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'checks passing', tone: 'ok' })])),
        notes: ['A branch-PR row opens the PR tab in Explorer; any other PR opens on GitHub.'],
      },
      {
        id: 's2',
        caption: 'Failing checks and changes requested — red',
        html: crop(prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: '2 failing · changes requested', tone: 'danger' })])),
      },
      {
        id: 's3',
        caption: 'Stack of four — two merged, folded',
        html: crop(prs([prow({ num: 233, title: 'feat(app): PR rows', facts: '2 failing', tone: 'danger' }), prow({ num: 234, title: 'feat(app): Your move cleanup', facts: 'draft' }), fold(2)], { count: 4 })),
      },
      {
        id: 's4',
        caption: 'Merged row expanded',
        html: crop(prs([prow({ num: 233, title: 'feat(app): PR rows', facts: '2 failing', tone: 'danger' }), prow({ num: 234, title: 'feat(app): Your move cleanup', facts: 'draft' }), fold(2, true), prow({ num: 231, title: 'feat(app): tree rows', facts: 'merged', tone: 'merged', indent: true }), prow({ num: 232, title: 'feat(app): relations model', facts: 'merged', tone: 'merged', indent: true })], { count: 4 })),
      },
      {
        id: 's5',
        caption: 'Merged PR only — shown directly',
        html: crop(prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'merged', tone: 'merged' })])),
      },
      {
        id: 's6',
        caption: 'No PR yet — branch facts, branch name muted',
        html: crop(prs([nopr('3 commits · +120 −8 · uncommitted', 'fix/stale-pr-facts')])),
        notes: ['The row opens the Changes tab.'],
      },
      {
        id: 's7',
        caption: 'Linked PR from another repository',
        html: crop(prs([prow({ num: 231, title: 'feat(app): tree and PRs', facts: 'approved', tone: 'ok' }), prow({ repo: 'paseo-prs', num: 58, title: 'feat: relate PRs to workspaces', facts: 'checks running', tone: 'run' })], { count: 2 })),
      },
      {
        id: 's8',
        caption: 'GitHub unreachable — last facts, "not refreshed"',
        html: crop(prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'checks running', tone: 'run' })], { suffix: '· not refreshed' })),
      },
    ],

    E1: [
      { id: 's1', caption: 'One ask open', html: crop(move([ASK])) },
      { id: 's2', caption: 'Ask plus permission', html: crop(move([ASK, PERM])), notes: ['Pressing the compact row opens it in place of the first.'] },
      {
        id: 's3',
        caption: 'Failed agent',
        html: crop(status({ word: 'Failed', tone: 'danger', summary: 'The agent stopped: usage limit reached at 14:20.' }), move([{ icon: 'alert', tone: 'danger', title: 'The agent stopped with an error', sub: 'Usage limit reached · resets at 17:00', actions: [{ label: 'Open agent', primary: true }, { label: 'Retry', ghost: true }] }])),
      },
      { id: 's4', caption: 'Archive alone after a merge', html: crop(move([ARCHIVE])) },
      {
        id: 's5',
        caption: 'Empty — section hidden, branch unpushed',
        html: crop(status({ word: 'Working', tone: 'run', pulse: true, summary: 'Tree rows done. Wiring the PR section.' }), tree([startedBy([PARENT])]), prs([nopr('2 commits · +64 −3 · unpushed', 'feat/overview-tree')])),
        notes: ['The old Push row is gone; the PR row carries the branch facts.'],
      },
      {
        id: 's6',
        caption: 'Archive fails — error under the title',
        html: crop(move([{ ...ARCHIVE, error: 'Could not remove the worktree: a file is in use.' }])),
      },
      {
        id: 's7',
        caption: 'PR merged, agent still running — no Archive',
        html: crop(status({ word: 'Working', tone: 'run', pulse: true, summary: 'PR #231 is merged. Cleaning up the follow-up notes.' }), prs([prow({ num: 231, title: 'feat(app): tree and PRs on Overview', facts: 'merged', tone: 'merged' })])),
        notes: ['Archive appears once the agent stops.'],
      },
    ],

    E2: [
      {
        id: 's1',
        caption: 'Two plugin facts',
        html: crop(tree([startedBy([PARENT])]), ctx(PLUG), PR_MAIN),
      },
      {
        id: 's2',
        caption: 'Nothing to say — footer hidden',
        html: crop(tree([startedBy([PARENT])]), PR_MAIN),
      },
    ],
  }
}
