// Shared .sb- primitives and fixtures for the sidebar mockups (placement options and S1/S2).
// Anatomy follows packages/app/src/components/sidebar (sidebar-nav-rows, sidebar-status-list,
// sidebar-workspace-row-content): nav rows, "Workspaces" header, group headers with their status
// icon, rows with the project avatar and its status badge, title and time, then the project line
// with badges. Light theme. Data is fictional.

export const SB_ICONS = {
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  'calendar-clock': '<path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h5"/><path d="M17.5 17.5 16 16.3V14"/><circle cx="16" cy="16" r="6"/>',
  ask: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  'circle-alert': '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  'circle-dot': '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>',
  'circle-pause': '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="15" y2="9"/><line x1="14" x2="14" y1="15" y2="9"/>',
  'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  'circle-dashed': '<path d="M10.1 2.182a10 10 0 0 1 3.8 0"/><path d="M13.9 21.818a10 10 0 0 1-3.8 0"/><path d="M17.609 3.721a10 10 0 0 1 2.69 2.7"/><path d="M2.182 13.9a10 10 0 0 1 0-3.8"/><path d="M20.279 17.609a10 10 0 0 1-2.7 2.69"/><path d="M21.818 10.1a10 10 0 0 1 0 3.8"/><path d="M3.721 6.391a10 10 0 0 1 2.7-2.69"/><path d="M6.391 20.279a10 10 0 0 1-2.69-2.7"/>',
  'panel-left': '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
}

export function sbPieces({ ic, esc }) {
  // Groups in their fixed order; empty groups are hidden.
  const GROUPS = [
    ['needs_input', 'Needs input', 'circle-alert'],
    ['failed', 'Failed', 'circle-x'],
    ['attention', 'Ready to review', 'circle-check'],
    ['running', 'Working', 'circle-dot'],
    ['done', 'Done', 'circle-check'],
    ['blocked', 'Blocked', 'circle-pause'],
  ]

  // Badges on the project line, in S2's order: needs you, not moving, in progress. attr: a kit.change() mark.
  const needsYou = (n) => ({ icon: 'hand', text: `needs you (${n})`, tone: 'warn' })
  const notMoving = (n, attr) => ({ icon: 'circle-alert', text: `${n} not moving`, tone: 'warn', attr })
  const inProgress = (n, attr) => ({ icon: 'circle-dashed', text: `${n} in progress`, tone: 'muted', attr })

  // Workspaces; min = minutes since last activity, which orders rows inside a group.
  const PROJECT = 'casteo'
  const W = {
    FIX: { title: 'Fix login redirect', group: 'needs_input', badge: 'needs_input', min: 2, time: '2m' },
    SEARCH: { title: 'Track: Search', group: 'attention', badge: 'attention', min: 17, time: '17m', badges: [needsYou(1)] },
    DOCS: { title: 'Docs: release notes', group: 'running', badge: 'running', min: 0, time: 'now' },
    CATALOG: { title: 'Track: Catalog', group: 'attention', badge: 'attention', min: 180, time: '3h', badges: [notMoving(2)] },
    EXPO: { title: 'Upgrade Expo', group: 'done', badge: 'done', min: 1440, time: '1d' },
    SCHEMA: { title: 'Schema: relations', group: 'blocked', badge: 'blocked', min: 120, time: '2h' },
  }
  const BILLING = { title: 'Track: Billing pages', min: 12, time: '12m', focus: true }

  // The status badge on the project avatar: ring while a turn runs, glyphs for needs input and
  // blocked, a dot for ready to review, nothing for done. 'moving' is Working without a turn of its
  // own: a still dot in the running colour instead of the ring. attr: a kit.change() mark.
  const statusBadge = (kind, attr = '') => {
    if (kind === 'running') return '<i class="sb-badge is-ring"></i>'
    if (kind === 'moving') return `<i class="sb-badge is-dot is-run"${attr}></i>`
    if (kind === 'attention') return '<i class="sb-badge is-dot is-ok"></i>'
    if (kind === 'needs_input') return `<i class="sb-badge is-glyph sb-c-warn">${ic('circle-alert')}</i>`
    if (kind === 'blocked') return `<i class="sb-badge is-glyph sb-c-blocked">${ic('circle-pause')}</i>`
    return ''
  }
  const badgeLine = (badges = []) => badges.map((b) => `<span class="sb-sep">·</span><span class="sb-chip sb-c-${b.tone}"${b.attr || ''}>${ic(b.icon)}${esc(b.text)}</span>`).join('')
  // w.attr marks the whole row; w.dotAttr marks the still dot.
  const row = (w) => `<div class="sb-row ${w.focus ? 'is-focus' : ''}"${w.attr || ''}>
    <span class="sb-avatar">C${statusBadge(w.badge, w.dotAttr)}</span>
    <div class="sb-row-text">
      <div class="sb-row-top"><span class="sb-row-title">${esc(w.title)}</span><span class="sb-time">${esc(w.time)}</span></div>
      <div class="sb-row-meta">${ic('folder')}<span>${PROJECT}</span>${badgeLine(w.badges)}</div>
    </div>
  </div>`
  const groupHead = ([key, label, icon]) => `<div class="sb-group-head"><span class="sb-c-${key}">${ic(icon)}</span>${esc(label)}</div>`
  const group = (g, rows) => (rows.length
    ? `<div class="sb-group">${groupHead(g)}${rows.sort((a, b) => a.min - b.min).map(row).join('')}</div>`
    : '')
  const groups = (workspaces) => GROUPS.map((g) => group(g, workspaces.filter((w) => w.group === g[0]))).join('')

  const NAV = [['plus', 'New workspace'], ['history', 'History'], ['search', 'Search'], ['calendar-clock', 'Schedules'], ['ask', 'Asks', '16', 'warn'], ['inbox', 'Inbox']]
  const sidebar = (workspaces) => `<div class="frame sb-frame"><div class="sb-win">
    <div class="sb-chrome"><i></i><i></i><i></i><span class="sb-chrome-icon">${ic('panel-left')}</span></div>
    <nav class="sb-nav">${NAV.map(([i, l, n, tone]) => `<div class="sb-nav-row">${ic(i)}<span>${l}</span>${n ? `<span class="sb-nav-n sb-c-${tone}">${n}</span>` : ''}</div>`).join('')}</nav>
    <div class="sb-ws-head"><span>Workspaces</span>${ic('sliders')}</div>
    ${groups(workspaces)}
  </div></div>`
  // A cropped sidebar around a few rows; "⋯" marks what is left out. width: a narrower sidebar.
  const crop = (workspaces, { width } = {}) => `<div class="frame sb-frame"><div class="sb-win is-crop"${width ? ` style="width:${width}px"` : ''}><div class="sb-cut">⋯</div>${groups(workspaces)}<div class="sb-cut">⋯</div></div></div>`

  return { GROUPS, needsYou, notMoving, inProgress, W, BILLING, row, group, groups, sidebar, crop }
}
