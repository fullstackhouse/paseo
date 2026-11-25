// Mockup states for area V: three placements of in-progress work on the Overview tab.
//
// Frames: desktop is the Explorer panel at 420 wide (tab strip + body); mobile is the 390 workspace
// sheet. Every frame draws the whole tab: Identity, Status, Your move, the option's in-progress
// placement, Tree, Pull requests. Primitives live in mockups-shared.mjs.
// V1, V2 and V3 share the same fixtures and state ids (s1 Busy, s2 Stuck, s3 Nothing in progress,
// s4 mobile sheet of Stuck) so frames compare across options. Data is fictional.
import { IP_ICONS, ipPieces } from './mockups-shared.mjs'

export { IP_ICONS }

export function placementStates(kit) {
  const { sec, status, lead, irow, askRow, identity, tree, prs, desktop, mobile, F } = ipPieces(kit)

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

  // V1: own section after Your move
  const inProgress = ({ agent, asks }) => {
    const rows = [
      ...(agent ? [irow({ icon: 'agent', ...F.AGENT }), irow({ ...F.SUBAGENTS, fold: true }), irow({ ...F.SHELL, fold: true })] : []),
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

  const SITUATIONS = {
    busy: { st: F.ST_BUSY, mine: [F.DECISION], agent: true, asks: ASKS_BUSY, prs: F.PR_BUSY, moving: [['Agent working', 'run'], ['6 subagents', 'fg'], ['1 shell', 'fg'], ['3 asks', 'fg']] },
    stuck: { st: F.ST_STUCK, mine: [], agent: false, asks: ASKS_STUCK, prs: F.PR_STUCK, moving: [['5 asks', 'fg'], ['2 not moving', 'warn']] },
    idle: { st: F.ST_IDLE, mine: [F.DECISION], agent: false, asks: [], prs: F.PR_IDLE, moving: null },
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
