// Mockup states for area V: three placements of in-progress work on the Overview tab.
//
// Frames: desktop is the Explorer panel at 420 wide (tab strip + body); mobile is the 390 workspace
// sheet. Every frame draws the whole tab: Identity, Status, Your move, the option's in-progress
// placement, Tree, Pull requests. Anatomy and primitives are copied from overview-tree (.ot- → .ip-).
// V1, V2 and V3 share the same fixtures and state ids (s1 Busy, s2 Stuck, s3 Nothing in progress,
// s4 mobile sheet of Stuck) so frames compare across options. Data is fictional.

export const IP_ICONS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  dash: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  agent: '<path d="M12 4v16"/><path d="M18.9 8 5.1 16"/><path d="m5.1 8 13.8 8"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
}

export function placementStates({ ic, esc }) {
  const CH = `<span class="ip-chev">${ic('chevron-right')}</span>`

  // ── fixtures (fictional, identical in every option) ─────────────────────
  const WS = { name: 'Track: Billing pages', goal: 'Move billing records onto the shared record page.' }

  // facts: [[text, tone], …] joined by " · "; tone 'dim' is the age.
  const facts = (parts) => parts.map(([t, tone]) => `<span class="${tone === 'dim' ? 'ip-dim' : `ip-t-${tone}`}">${esc(t)}</span>`).join('<span class="ip-dim"> · </span>')

  const AGENT = { name: 'Billing track lead', facts: [['working', 'run'], ['3m', 'dim']] }
  const SUBAGENTS = { name: '6 subagents', facts: [['2 working', 'run']] }
  const SHELL = { name: 'merge-queue.sh', facts: [['running 2h', 'run']], mono: true }
  const ASKS_BUSY = [
    { name: 'PR #2104', facts: [['CI running', 'run'], ['20m', 'dim']] },
    { name: 'PR #2098', facts: [['review requested', 'muted'], ['1h', 'dim']] },
    { name: 'Org-scoped API keys refused', facts: [['fix PR #2111 open', 'muted'], ['4h', 'dim']] },
  ]
  const ASKS_STUCK = [
    { name: 'PR #2104', facts: [['CI running', 'run'], ['20m', 'dim']] },
    { name: 'PR #2098', facts: [['CI running', 'run'], ['35m', 'dim']] },
    { name: 'PR #2091', facts: [['CI running', 'run'], ['50m', 'dim']] },
    { name: 'Release with the cache fix', facts: [['nothing moving', 'warn'], ['9h', 'dim']] },
    { name: 'Org-scoped API keys refused', facts: [['nothing moving', 'warn'], ['6h', 'dim']] },
  ]
  const DECISION = { icon: 'ask', tone: 'warn', title: 'Name the invoices tab', actions: [{ label: 'Invoices', primary: true }, { label: 'Billing documents' }] }

  // ── pieces ─────────────────────────────────────────────────────────────
  const identity = () => `<header class="ip-id"><h1 class="ip-title">${esc(WS.name)}</h1><p class="ip-goal">${esc(WS.goal)}</p></header>`
  const sec = (title, body, { count, warn } = {}) =>
    `<section class="ip-sec"><div class="ip-sec-title">${esc(title)}${count ? `<span class="ip-n ${warn ? 'is-warn' : ''}">${count}</span>` : ''}</div>${body}</section>`

  // Status (V2 adds the "Moving now" line: [[label, tone], …], each count pressable)
  const status = ({ word, tone, pulse, age, summary, moving }) => `<section class="ip-story">
    <div class="ip-state ip-t-${tone}"><i class="ip-dot ${pulse ? 'is-pulse' : ''}"></i>${esc(word)}<span class="ip-age">· updated ${esc(age)} ago</span><span class="ip-chev ip-push">${ic('chevron-right')}</span></div>
    <p class="ip-summary">${esc(summary)}</p>
    ${moving ? `<div class="ip-moving"><span class="ip-moving-k">Moving now</span><span class="ip-moving-v">${moving.map(([t, tn]) => `<span class="ip-link ip-t-${tn}">${esc(t)}</span>`).join('<span class="ip-dim"> · </span>')}</span></div>` : ''}
  </section>`
  const ST_BUSY = { word: 'Working', tone: 'run', pulse: true, age: '3m', summary: 'Invoices and payments are on the shared record page. Credit notes next.' }
  const ST_STUCK = { word: 'Working', tone: 'run', pulse: true, age: '8h', summary: 'Five approved PRs merge one at a time.' }
  const ST_IDLE = { word: 'Waiting on you', tone: 'warn', age: '12m', summary: 'Invoices and payments are on the shared record page. One naming decision left.' }

  // Your move: lead row with buttons (only Your move has buttons)
  const lead = ({ icon, tone, title, actions }) => `<div class="ip-item is-lead" style="--lead: var(--app-${tone})">
    <div class="ip-item-head"><span class="ip-item-icon ip-t-${tone}">${ic(icon)}</span><div class="ip-item-text"><div class="ip-item-title">${esc(title)}</div></div></div>
    <div class="ip-actions">${actions.map((a) => `<button type="button" class="ip-btn ${a.primary ? 'is-primary' : ''}">${esc(a.label)}</button>`).join('')}</div>
  </div>`

  // In-progress rows: one line, name, facts, chevron. fold = indented line under its agent.
  const irow = ({ icon, name, facts: f, fold, mono, muted }) =>
    `<div class="ip-row ${fold ? 'is-fold' : ''} ${muted ? 'is-muted' : ''}">${fold ? '<span class="ip-arr">↳</span>' : ''}${icon ? `<span class="ip-ricon">${ic(icon)}</span>` : ''}<span class="ip-name ${mono ? 'ip-mono' : ''}">${esc(name)}</span><span class="ip-word">${facts(f)}</span>${CH}</div>`
  const askRow = (a, muted) => irow({ icon: 'ask', ...a, muted })

  // V1: own section after Your move
  const inProgress = ({ agent, asks }) => {
    const rows = [
      ...(agent ? [irow({ icon: 'agent', ...AGENT }), irow({ ...SUBAGENTS, fold: true }), irow({ ...SHELL, fold: true })] : []),
      ...asks.map((a) => askRow(a)),
    ]
    return sec('In progress', `<div class="ip-grp">${rows.join('')}</div>`, { count: (agent ? 1 : 0) + asks.length })
  }

  // Your move. V3 adds the muted "Agent's move" group below your rows.
  const move = ({ mine = [], agents = [] }) => {
    if (!mine.length && !agents.length) return ''
    const theirs = agents.length
      ? `<div class="ip-divider"><span>Agent's move</span><span class="ip-n">${agents.length}</span></div><div class="ip-grp">${agents.map((a) => askRow(a, true)).join('')}</div>`
      : ''
    return sec('Your move', `<div class="ip-move">${mine.map(lead).join('')}${theirs}</div>`)
  }

  // Tree: one short lineage (parent, this workspace)
  const tree = () => sec('Tree', `<div class="ip-grp">
    <div class="ip-row"><span class="ip-name">Billing migration roadmap</span><span class="ip-word ip-t-run">Working</span>${CH}</div>
    <div class="ip-row is-here is-sub"><span class="ip-arr">↳</span><span class="ip-name">${esc(WS.name)}</span></div>
  </div>`)

  // Pull requests
  const prow = ({ num, title, facts: f, tone }) => `<div class="ip-row"><span class="ip-pr">#${num}</span><span class="ip-name">${esc(title)}</span><span class="ip-word ip-t-${tone}">${esc(f)}</span>${CH}</div>`
  const prs = (rows) => sec('Pull requests', rows.map(prow).join(''), { count: rows.length > 1 ? rows.length : 0 })
  const PR_BUSY = [
    { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'checks running', tone: 'run' },
    { num: 2098, title: 'feat(billing): payments list', facts: 'review requested', tone: 'muted' },
  ]
  const PR_STUCK = [
    { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'checks running', tone: 'run' },
    { num: 2098, title: 'feat(billing): payments list', facts: 'checks running', tone: 'run' },
  ]
  const PR_IDLE = [
    { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'approved', tone: 'ok' },
    { num: 2098, title: 'feat(billing): payments list', facts: 'merged', tone: 'merged' },
  ]

  // ── frames ─────────────────────────────────────────────────────────────
  const TABS = [['dash', 'Overview'], ['activity', 'Status'], ['ask', 'Asks']]
  const tabs = () => `<div class="ip-tabs">${TABS.map(([i, l], n) => `<div class="ip-tab ${n === 0 ? 'is-on' : ''}">${ic(i)}<span>${l}</span></div>`).join('')}<span class="ip-tabs-end">${ic('plus')}${ic('panel')}</span></div>`
  const desktop = (parts) => `<div class="frame ip-frame"><div class="ip-win dark">${tabs()}<div class="ip-ov">${parts.filter(Boolean).join('')}</div></div></div>`
  const mobile = (parts) => `<div class="frame ip-frame"><div class="ip-win ip-mobile dark">
    <div class="ip-behind"><div class="ip-behind-head">${esc(WS.name)}</div><i class="ip-bub"></i><i class="ip-bub w60"></i><i class="ip-bub w80"></i></div>
    <div class="ip-sheet"><div class="ip-handle"></div><div class="ip-sheet-title">${ic('dash')} Overview</div><div class="ip-ov">${parts.filter(Boolean).join('')}</div></div></div></div>`

  // One builder per option: workspace situation → the tab's parts, top to bottom.
  const SITUATIONS = {
    busy: { st: ST_BUSY, mine: [DECISION], agent: true, asks: ASKS_BUSY, prs: PR_BUSY, moving: [['Agent working', 'run'], ['6 subagents', 'fg'], ['1 shell', 'fg'], ['3 asks', 'fg']] },
    stuck: { st: ST_STUCK, mine: [], agent: false, asks: ASKS_STUCK, prs: PR_STUCK, moving: [['5 asks', 'fg'], ['2 not moving', 'warn']] },
    idle: { st: ST_IDLE, mine: [DECISION], agent: false, asks: [], prs: PR_IDLE, moving: null },
  }
  const OPTIONS = {
    V1: (w) => [identity(), status(w.st), move({ mine: w.mine }), w.agent || w.asks.length ? inProgress(w) : '', tree(), prs(w.prs)],
    V2: (w) => [identity(), status({ ...w.st, moving: w.moving }), move({ mine: w.mine }), tree(), prs(w.prs)],
    V3: (w) => [identity(), status(w.st), move({ mine: w.mine, agents: w.asks }), tree(), prs(w.prs)],
  }
  const statesFor = (build) => [
    { id: 's1', caption: 'Busy', html: desktop(build(SITUATIONS.busy)) },
    { id: 's2', caption: 'Stuck', html: desktop(build(SITUATIONS.stuck)) },
    { id: 's3', caption: 'Nothing in progress', html: desktop(build(SITUATIONS.idle)) },
    { id: 's4', caption: 'Mobile sheet — stuck', html: mobile(build(SITUATIONS.stuck)) },
  ]

  return Object.fromEntries(Object.entries(OPTIONS).map(([id, build]) => [id, statesFor(build)]))
}
