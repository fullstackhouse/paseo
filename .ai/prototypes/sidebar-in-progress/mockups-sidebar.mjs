// Mockup states for area S: the sidebar once in-progress work decides an idle workspace's group.
// S1 draws the whole sidebar per state; S2 crops it around one or two rows. Both are Changed views:
// in S1 a row that moved groups is marked 'changed' where it lands and 'removed' where it sat
// today; in S2 the new badges and the still dot are marked 'new'. Primitives in mockups-shared.mjs.
import { sbPieces } from './mockups-shared.mjs'

export function sidebarStates(kit) {
  const { change } = kit
  const { needsYou, notMoving, inProgress, W, BILLING, sidebar, crop } = sbPieces(kit)

  const OTHERS = Object.values(W)
  const others = (...skip) => OTHERS.filter((w) => !skip.includes(w))

  // A row that moved: today's placement marked removed, the new one marked changed.
  const moved = (w, today) => [
    { ...w, ...today, badges: [], focus: false, attr: change('removed') },
    { ...w, attr: change('changed') },
  ]
  const TODAY_READY = { group: 'attention', badge: 'attention' }
  const TODAY_DONE = { group: 'done', badge: 'done' }

  const billingWorking = { ...BILLING, group: 'running', badge: 'moving', badges: [inProgress(3)] }
  const billingBlocked = { ...BILLING, group: 'blocked', badge: 'blocked', badges: [inProgress(3)] }
  // Schema: relations whose only in-progress item is PR #88, waiting on a requested review.
  const schemaReview = { ...W.SCHEMA, badges: [inProgress(1)] }

  return {
    S1: [
      { id: 's1', caption: 'CI running — Billing moves to Working', html: sidebar([...OTHERS, ...moved(billingWorking, TODAY_READY)]) },
      { id: 's2', caption: 'Review only — Billing moves to Blocked', html: sidebar([...OTHERS, ...moved(billingBlocked, TODAY_READY)]) },
      {
        id: 's3',
        caption: 'CI and review mixed — Billing under Working; Schema: relations (PR #88 on review) under Blocked',
        html: sidebar([...others(W.SCHEMA), ...moved(billingWorking, TODAY_READY), ...moved(schemaReview, TODAY_READY)]),
      },
      {
        id: 's4',
        caption: 'One item not moving among moving ones — Billing stays in Ready to review',
        html: sidebar([...OTHERS, { ...BILLING, group: 'attention', badge: 'attention', badges: [notMoving(1)] }]),
      },
      { id: 's5', caption: 'Done card with moving asks — Billing moves from Done to Working', html: sidebar([...OTHERS, ...moved(billingWorking, TODAY_DONE)]) },
      {
        id: 's6',
        caption: "All items finished — today's rules (Done card → Done)",
        html: sidebar([...OTHERS, { ...BILLING, group: 'done', badge: 'done' }]),
      },
    ],

    S2: [
      {
        id: 's1',
        caption: 'Working via in-progress work — "3 in progress", still dot',
        html: crop([{ ...billingWorking, focus: false, dotAttr: change('new'), badges: [inProgress(3, change('new'))] }]),
      },
      {
        id: 's2',
        caption: 'Blocked on a review — "1 in progress"',
        html: crop([{ ...schemaReview, badges: [inProgress(1, change('new'))] }]),
      },
      {
        id: 's3',
        caption: 'Ready to review — "needs you (1)" and "2 not moving"',
        html: crop([{ ...W.CATALOG, badges: [needsYou(1), notMoving(2, change('new'))] }]),
      },
      {
        id: 's4',
        caption: 'Working because the agent runs — ring, no in-progress badge',
        html: crop([W.DOCS, { ...billingWorking, focus: false, dotAttr: change('new'), badges: [inProgress(3, change('new'))] }]),
      },
      {
        id: 's5',
        caption: 'Narrow sidebar — the title truncates before any badge',
        html: crop([{ ...W.CATALOG, title: 'Track: Catalog and product variants', badges: [needsYou(1), notMoving(2, change('new'))] }], { width: 290 }),
      },
    ],
  }
}
