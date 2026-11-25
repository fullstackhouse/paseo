// Shared .ip- primitives and fixtures for the Overview in-progress mockups (placement options and
// the chosen Overview views). Anatomy copied from overview-tree (.ot- → .ip-). Data is fictional.

export const IP_ICONS = {
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  dash: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  activity: '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  agent: '<path d="M12 4v16"/><path d="M18.9 8 5.1 16"/><path d="m5.1 8 13.8 8"/>',
  panel: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
}

export function ipPieces({ ic, esc }) {
  const CH = `<span class="ip-chev">${ic('chevron-right')}</span>`
  const WS = { name: 'Track: Billing pages', goal: 'Move billing records onto the shared record page.' }

  // facts: [[text, tone], …] joined by " · "; tone 'dim' is the age.
  const facts = (parts) => parts.map(([t, tone]) => `<span class="${tone === 'dim' ? 'ip-dim' : `ip-t-${tone}`}">${esc(t)}</span>`).join('<span class="ip-dim"> · </span>')

  const identity = () => `<header class="ip-id"><h1 class="ip-title">${esc(WS.name)}</h1><p class="ip-goal">${esc(WS.goal)}</p></header>`
  const sec = (title, body, { count, warn, attr = '' } = {}) =>
    `<section class="ip-sec"${attr}><div class="ip-sec-title">${esc(title)}${count ? `<span class="ip-n ${warn ? 'is-warn' : ''}">${count}</span>` : ''}</div>${body}</section>`
  const cut = () => `<div class="ip-cut">⋯</div>`

  // Status. age: '8h' → "updated 8h ago", 'just now' → "updated just now", absent → no age (no card).
  // moving: V2's "Moving now" counts. replied / warn: the E2 lines under the summary, replied first.
  // ageAttr / warnAttr: kit.change() marks for Changed views.
  const status = ({ word, tone, pulse, age, summary, moving, replied, warn, ageAttr = '', warnAttr = '' }) => `<section class="ip-story">
    <div class="ip-state ip-t-${tone}"><i class="ip-dot ${pulse ? 'is-pulse' : ''}"></i>${esc(word)}${age ? `<span class="ip-age"${ageAttr}>· updated ${esc(age === 'just now' ? age : `${age} ago`)}</span>` : ''}<span class="ip-chev ip-push">${ic('chevron-right')}</span></div>
    ${summary ? `<p class="ip-summary">${esc(summary)}</p>` : ''}
    ${replied ? `<p class="ip-replied">${esc(replied)}</p>` : ''}${warn ? `<p class="ip-warnline"${warnAttr}>${ic('alert')}${esc(warn)}</p>` : ''}
    ${moving ? `<div class="ip-moving"><span class="ip-moving-k">Moving now</span><span class="ip-moving-v">${moving.map(([t, tn]) => `<span class="ip-link ip-t-${tn}">${esc(t)}</span>`).join('<span class="ip-dim"> · </span>')}</span></div>` : ''}
  </section>`

  // Your move: lead row with buttons
  const lead = ({ icon, tone, title, sub, actions }) => `<div class="ip-item is-lead" style="--lead: var(--app-${tone})">
    <div class="ip-item-head"><span class="ip-item-icon ip-t-${tone}">${ic(icon)}</span><div class="ip-item-text"><div class="ip-item-title">${esc(title)}</div>${sub ? `<div class="ip-item-sub">${esc(sub)}</div>` : ''}</div></div>
    <div class="ip-actions">${actions.map((a) => `<button type="button" class="ip-btn ${a.primary ? 'is-primary' : ''}">${esc(a.label)}</button>`).join('')}</div>
  </div>`

  // In-progress rows: one line, name, facts, chevron. fold = indented line under its agent;
  // off = muted, not pressable (no chevron).
  const irow = ({ icon, name, facts: f, fold, mono, muted, off }) =>
    `<div class="ip-row ${fold ? 'is-fold' : ''} ${muted ? 'is-muted' : ''}${off ? ' is-off' : ''}">${fold ? '<span class="ip-arr">↳</span>' : ''}${icon ? `<span class="ip-ricon">${ic(icon)}</span>` : ''}<span class="ip-name ${mono ? 'ip-mono' : ''}">${esc(name)}</span><span class="ip-word">${facts(f)}</span>${off ? '' : CH}</div>`
  const askRow = (a, muted) => irow({ icon: 'ask', ...a, muted })

  const tree = () => sec('Tree', `<div class="ip-grp">
    <div class="ip-row"><span class="ip-name">Billing migration roadmap</span><span class="ip-word ip-t-run">Working</span>${CH}</div>
    <div class="ip-row is-here is-sub"><span class="ip-arr">↳</span><span class="ip-name">${esc(WS.name)}</span></div>
  </div>`)

  const prow = ({ num, title, facts: f, tone }) => `<div class="ip-row"><span class="ip-pr">#${num}</span><span class="ip-name">${esc(title)}</span><span class="ip-word ip-t-${tone}">${esc(f)}</span>${CH}</div>`
  const prs = (rows) => sec('Pull requests', rows.map(prow).join(''), { count: rows.length > 1 ? rows.length : 0 })

  const TABS = [['dash', 'Overview'], ['activity', 'Status'], ['ask', 'Asks']]
  const tabs = () => `<div class="ip-tabs">${TABS.map(([i, l], n) => `<div class="ip-tab ${n === 0 ? 'is-on' : ''}">${ic(i)}<span>${l}</span></div>`).join('')}<span class="ip-tabs-end">${ic('plus')}${ic('panel')}</span></div>`
  const desktop = (parts) => `<div class="frame ip-frame"><div class="ip-win dark">${tabs()}<div class="ip-ov">${parts.filter(Boolean).join('')}</div></div></div>`
  const mobile = (parts) => `<div class="frame ip-frame"><div class="ip-win ip-mobile dark">
    <div class="ip-behind"><div class="ip-behind-head">${esc(WS.name)}</div><i class="ip-bub"></i><i class="ip-bub w60"></i><i class="ip-bub w80"></i></div>
    <div class="ip-sheet"><div class="ip-handle"></div><div class="ip-sheet-title">${ic('dash')} Overview</div><div class="ip-ov">${parts.filter(Boolean).join('')}</div></div></div></div>`
  const crop = (...parts) => desktop([cut(), ...parts, cut()])

  // ── fixtures ───────────────────────────────────────────────────────────
  const F = {
    AGENT: { name: 'Billing track lead', facts: [['working', 'run'], ['3m', 'dim']] },
    SUBAGENTS: { name: '6 subagents', facts: [['2 working', 'run']] },
    SHELL: { name: 'merge-queue.sh', facts: [['running 2h', 'run']], mono: true },
    DECISION: { icon: 'ask', tone: 'warn', title: 'Name the invoices tab', actions: [{ label: 'Invoices', primary: true }, { label: 'Billing documents' }] },
    ST_BUSY: { word: 'Working', tone: 'run', pulse: true, age: '3m', summary: 'Invoices and payments are on the shared record page. Credit notes next.' },
    ST_STUCK: { word: 'Working', tone: 'run', pulse: true, age: '8h', summary: 'Five approved PRs merge one at a time.' },
    ST_IDLE: { word: 'Waiting on you', tone: 'warn', age: '12m', summary: 'Invoices and payments are on the shared record page. One naming decision left.' },
    PR_BUSY: [
      { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'checks running', tone: 'run' },
      { num: 2098, title: 'feat(billing): payments list', facts: 'review requested', tone: 'muted' },
    ],
    PR_STUCK: [
      { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'checks running', tone: 'run' },
      { num: 2098, title: 'feat(billing): payments list', facts: 'checks running', tone: 'run' },
    ],
    PR_IDLE: [
      { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'approved', tone: 'ok' },
      { num: 2098, title: 'feat(billing): payments list', facts: 'merged', tone: 'merged' },
    ],
  }

  return { CH, WS, facts, identity, sec, cut, status, lead, irow, askRow, tree, prow, prs, tabs, desktop, mobile, crop, F }
}
