// Mockup states for areas O and E: the chosen in-progress design (V1's anatomy) on the Overview tab.
//
// O4 frames draw the whole tab; O5, E1 and E2 crop the panel around their section (a "⋯" cut marks
// what is left out). E1 and E2 are Changed views: kit.change() marks what is new or removed.
// Primitives and fixtures live in mockups-shared.mjs. Data is fictional.
import { ipPieces } from './mockups-shared.mjs'

export function overviewStates(kit) {
  const { ic, esc, change } = kit
  const { sec, status, lead, irow, askRow, identity, tree, prs, desktop, mobile, crop, cut, F } = ipPieces(kit)
  // E2 frames start at the top of the tab: cut only below.
  const top = (...parts) => desktop([...parts, cut()])

  // ── in-progress fixtures ───────────────────────────────────────────────
  // ago: minutes since the agent took the ask or started its current turn. The section sorts on it,
  // oldest first across all kinds (A13); an ask's age word is derived from it.
  const age = (m) => (m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`)
  const ask = (name, waits, tone, ago) => ({ name, ago, facts: [[waits, tone], [age(ago), 'dim']] })
  const A = {
    REL: ask('Release with the cache fix', 'nothing moving', 'warn', 540),
    KEYS_STUCK: ask('Org-scoped API keys refused', 'nothing moving', 'warn', 360),
    KEYS_BUSY: ask('Org-scoped API keys refused', 'fix PR #2111 open', 'muted', 240),
    SEED: ask('Seed demo invoices', 'waits on the staging reset', 'muted', 120),
    PAY_REVIEW: ask('PR #2098 — payments list', 'review requested', 'muted', 60),
    CRED: ask('PR #2091 — credit notes', 'CI running', 'run', 50),
    PAY_CI: ask('PR #2098 — payments list', 'CI running', 'run', 35),
    INV: ask('PR #2104 — invoices list', 'CI running', 'run', 20),
    REFUND: ask('PR #2112 — refunds list', 'CI running', 'run', 10),
    // merged PRs: the warning tone starts 10 minutes after the merge, not after the ask was taken
    CRED_MERGED_OLD: ask('PR #2091 — credit notes', 'merged · waiting on the agent', 'warn', 60),
    PAY_MERGED_NEW: ask('PR #2098 — payments list', 'merged · waiting on the agent', 'muted', 35),
  }
  // Agent groups: the agent row carries its folded subagent and job lines. A working agent sorts by
  // its turn ("working · 3m"); an idle one by the turn that started its job (running 2h).
  const agentWorking = { ago: 3, html: [irow({ icon: 'agent', ...F.AGENT }), irow({ ...F.SUBAGENTS, fold: true }), irow({ ...F.SHELL, fold: true })].join('') }
  const agentIdleJob = { ago: 125, html: [irow({ icon: 'agent', name: 'Billing track lead', facts: [['idle', 'muted']] }), irow({ ...F.SHELL, fold: true })].join('') }
  const agentArchivedJob = { ago: 125, html: [irow({ icon: 'archive', name: 'Archived agent', facts: [], off: true }), irow({ ...F.SHELL, facts: [['running 2h', 'muted']], fold: true, off: true })].join('') }
  const STUCK = [A.REL, A.KEYS_STUCK, A.CRED, A.PAY_CI, A.INV]

  // items: ask fixtures or { ago, html } (agent groups, an expanded ask). Oldest first; five show,
  // then Show all (N).
  const inProgress = (items) => {
    const rows = [...items].sort((a, b) => b.ago - a.ago).map((it) => it.html ?? askRow(it))
    const more = rows.length > 5 ? `<div class="ip-row ip-more"><span class="ip-name">Show all (${rows.length})</span><span class="ip-chev">${ic('chevron-right')}</span></div>` : ''
    return sec('In progress', `<div class="ip-grp">${rows.slice(0, 5).join('')}${more}</div>`, { count: rows.length })
  }
  const move = (items, attr) => (items.length ? sec('Your move', `<div class="ip-move">${items.join('')}</div>`, { attr }) : '')

  // ── status fixtures ───────────────────────────────────────────────────
  const NOTHING = 'Nothing is running in this workspace.'
  const REPLIED = "You replied 4m ago; the agent hasn't updated this since."
  const ST_STUCK_O = { ...F.ST_STUCK, warn: NOTHING }
  const ST_JOB = { word: 'Working', tone: 'run', pulse: true, age: '25m', summary: 'Five approved PRs merge one at a time through merge-queue.sh.' }
  const ST_DONE = { word: 'Done', tone: 'ok', age: '30m', summary: 'PR #2104 is merged. Two follow-ups are with the agent.' }

  // ── O5: an ask expanded in place ───────────────────────────────────────
  const openAsk = (a, { body, line, lineTone = 'muted', links, reminded, archived }) => ({ ago: a.ago, html: `<div class="ip-open">
    <div class="ip-row is-open-head"><span class="ip-ricon">${ic('ask')}</span><span class="ip-name">${esc(a.name)}</span><span class="ip-word">${a.facts.map(([t, tn]) => `<span class="${tn === 'dim' ? 'ip-dim' : `ip-t-${tn}`}">${esc(t)}</span>`).join('<span class="ip-dim"> · </span>')}</span><span class="ip-chev">${ic('chevron-down')}</span></div>
    <div class="ip-open-body">
      <p class="ip-body">${esc(body)} <span class="ip-more">More</span></p>
      <p class="ip-factsline ip-t-${lineTone}">${esc(line)}</p>
      <div class="ip-links">${links.map(([i, t]) => `<span class="ip-linkchip">${ic(i)}${esc(t)}</span>`).join('')}</div>
      <div class="ip-open-actions"><button type="button" class="ip-btn is-quiet">Take it back</button>${archived ? '' : reminded ? `<span class="ip-reminded">${ic('check')}Reminded just now</span>` : '<button type="button" class="ip-btn is-quiet">Remind agent</button>'}<button type="button" class="ip-btn is-quiet">Show in chat</button></div>
    </div>
  </div>` })
  const REL_OPEN = {
    body: 'Cut release 4.12 once the cache fix is merged, then post the release notes in #billing-release.',
    line: 'Nothing moving · taken 9h ago · last moved 9h ago',
    lineTone: 'warn',
    links: [['pr', '#2087 fix(cache): stale invoice totals'], ['link', 'Release checklist']],
  }
  const REL_TAKEN = { icon: 'ask', tone: 'warn', title: 'Release with the cache fix', sub: 'Cut release 4.12 once the cache fix is merged, then post the release notes.', actions: [{ label: 'Cut release', primary: true }, { label: 'Not yet' }] }
  const ARCHIVE = { icon: 'archive', tone: 'merged', title: 'Ready to archive', sub: 'PRs #2104 and #2098 merged · nothing in progress', actions: [{ label: 'Archive workspace', primary: true }] }
  const PR_MERGED = [{ num: 2104, title: 'feat(billing): invoices on the record page', facts: 'merged', tone: 'merged' }]
  const PR_ALL_MERGED = [
    { num: 2104, title: 'feat(billing): invoices on the record page', facts: 'merged', tone: 'merged' },
    { num: 2098, title: 'feat(billing): payments list', facts: 'merged', tone: 'merged' },
  ]
  const afterTakeBack = () => [move([lead(REL_TAKEN)]), inProgress([A.KEYS_STUCK, A.CRED, A.PAY_CI, A.INV])]

  // ── states ─────────────────────────────────────────────────────────────
  const stuckTab = () => [identity(), status(ST_STUCK_O), inProgress(STUCK), tree(), prs(F.PR_STUCK)]

  return {
    O4: [
      {
        id: 's1',
        caption: 'Busy — agent with subagents and a shell, three asks',
        html: desktop([identity(), status(F.ST_BUSY), move([lead(F.DECISION)]), inProgress([agentWorking, A.KEYS_BUSY, A.PAY_REVIEW, A.INV]), tree(), prs(F.PR_BUSY)]),
      },
      { id: 's2', caption: 'Stuck — only asks, two with nothing moving first', html: desktop(stuckTab()) },
      {
        id: 's3',
        caption: 'Idle agent with only a background job',
        html: desktop([identity(), status(ST_JOB), inProgress([agentIdleJob]), tree(), prs(F.PR_STUCK)]),
      },
      {
        id: 's4',
        caption: 'More than five rows — five, then Show all (8)',
        html: desktop([identity(), status(F.ST_BUSY), inProgress([A.REL, A.KEYS_STUCK, agentWorking, A.SEED, A.CRED, A.PAY_CI, A.INV, A.REFUND]), tree(), prs(F.PR_STUCK)]),
      },
      {
        id: 's5',
        caption: 'Nothing in progress — section absent',
        html: desktop([identity(), status(F.ST_IDLE), move([lead(F.DECISION)]), tree(), prs(F.PR_IDLE)]),
      },
      { id: 's6', caption: 'Mobile sheet — stuck', html: mobile(stuckTab()) },
      {
        id: 's7',
        caption: 'Agent archived while its job runs — muted, not pressable',
        html: desktop([identity(), status(ST_JOB), inProgress([agentArchivedJob, A.INV]), tree(), prs(F.PR_STUCK)]),
      },
      {
        id: 's8',
        caption: 'PR merged while the ask is in progress — warning after 10 minutes',
        html: desktop([identity(), status({ ...F.ST_STUCK, age: '15m', summary: 'Merging the approved PRs one at a time.', warn: NOTHING }), inProgress([A.CRED_MERGED_OLD, A.INV, A.PAY_MERGED_NEW]), tree(), prs([{ num: 2104, title: 'feat(billing): invoices on the record page', facts: 'checks running', tone: 'run' }, { num: 2091, title: 'feat(billing): credit notes', facts: 'merged', tone: 'merged' }])]),
      },
    ],

    O5: [
      {
        id: 's1',
        caption: 'PR ask waiting on CI',
        html: crop(inProgress([A.REL, A.KEYS_STUCK, A.CRED, A.PAY_CI, openAsk(A.INV, {
          body: 'Merge #2104 once CI passes. The merge queue rebases it onto #2098 first, so expect one more CI run.',
          line: 'Waits on CI for #2104 · taken 20m ago · last moved 5m ago',
          links: [['pr', '#2104 invoices on the record page'], ['link', 'CI run']],
        })])),
      },
      { id: 's2', caption: 'Nothing moving — warning facts line', html: crop(inProgress([openAsk(A.REL, REL_OPEN), A.KEYS_STUCK, A.CRED, A.PAY_CI, A.INV])) },
      { id: 's3', caption: 'Just reminded', html: crop(inProgress([openAsk(A.REL, { ...REL_OPEN, reminded: true }), A.KEYS_STUCK, A.CRED, A.PAY_CI, A.INV])) },
      { id: 's4', caption: 'After Take it back — open in Your move, gone from In progress', html: crop(...afterTakeBack()) },
      {
        id: 's5',
        caption: 'Owner agent archived — no Remind agent',
        html: crop(inProgress([A.REL, openAsk(A.KEYS_STUCK, {
          body: 'Org-scoped API keys get 403 on /billing/export. Fix in #2111; confirm with the customer once it ships.',
          line: 'Agent archived · taken 6h ago · last moved 6h ago',
          lineTone: 'warn',
          links: [['pr', '#2111 fix(api): accept org-scoped keys']],
          archived: true,
        }), A.CRED, A.PAY_CI, A.INV])),
      },
    ],

    E1: [
      {
        id: 's1',
        caption: 'PR merged, two asks in progress — no Archive',
        html: crop(status(ST_DONE), inProgress([A.SEED, A.PAY_CI]), prs(PR_MERGED)),
        notes: ['No Your move: Archive waits until In progress is empty.'],
      },
      {
        id: 's2',
        caption: 'PR merged, background job running — no placeholder row',
        html: crop(status({ ...ST_DONE, summary: 'PR #2104 is merged. The merge queue is still draining.' }), move([`<div class="ip-next ip-t-muted"><span>${ic('archive')}</span><span class="ip-next-title">Archive waits for background work</span></div>`], change('removed')), inProgress([agentIdleJob]), prs(PR_MERGED)),
        notes: ['Archive appears once merge-queue.sh stops.'],
      },
      {
        id: 's3',
        caption: 'Everything finished — Archive',
        html: crop(status({ ...ST_DONE, age: '5m', summary: 'Both PRs are merged; nothing is left running.' }), move([lead(ARCHIVE)]), prs(PR_ALL_MERGED)),
      },
      { id: 's4', caption: 'Ask taken back — open here with its buttons', html: crop(...afterTakeBack()) },
    ],

    E2: [
      { id: 's1', caption: 'Fresh working card — age only', html: top(identity(), status({ ...F.ST_BUSY, ageAttr: change('new') })) },
      { id: 's2', caption: 'Stale working card, nothing running — warning', html: top(identity(), status({ ...F.ST_STUCK, ageAttr: change('new'), warn: NOTHING, warnAttr: change('new') })) },
      { id: 's3', caption: 'Working, only a background job live — age only', html: top(identity(), status({ ...ST_JOB, ageAttr: change('new') }), inProgress([agentIdleJob])) },
      { id: 's4', caption: 'Done card — age only', html: top(identity(), status({ ...ST_DONE, age: '5m', summary: 'Both PRs are merged; nothing is left running.', ageAttr: change('new') })) },
      { id: 's5', caption: 'You replied, then the warning', html: top(identity(), status({ ...F.ST_STUCK, ageAttr: change('new'), replied: REPLIED, warn: NOTHING, warnAttr: change('new') })) },
      { id: 's6', caption: 'No status card — state from the agents, no age', html: top(identity(), status({ word: 'Working', tone: 'run', pulse: true })) },
      { id: 's7', caption: 'Updated under a minute ago', html: top(identity(), status({ ...F.ST_BUSY, age: 'just now', ageAttr: change('new') })) },
    ],
  }
}
