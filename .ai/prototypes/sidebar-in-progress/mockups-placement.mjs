// Mockup states for area V: three groups for an idle workspace whose open work is all in progress
// and moving. Frames are the desktop sidebar at ~300 wide; primitives live in mockups-shared.mjs.
// V1, V2 and V3 share the same workspaces and state ids (s1 all seven, s2 Billing's asks go stuck).
import { SB_ICONS, sbPieces } from './mockups-shared.mjs'

export { SB_ICONS }

export function placementStates(kit) {
  const { inProgress, notMoving, W, BILLING, sidebar } = sbPieces(kit)

  // Billing per option: s1 = all moving (the option's group), s2 = two asks stuck (Ready to review).
  const BILLING_MOVING = {
    V1: { ...BILLING, group: 'running', badge: 'moving', badges: [inProgress(3)] }, // under Working, no ring
    V2: { ...BILLING, group: 'blocked', badge: 'blocked', badges: [inProgress(3)] },
    V3: { ...BILLING, group: 'attention', badge: 'attention', badges: [inProgress(3)] },
  }
  const BILLING_STUCK = { ...BILLING, group: 'attention', badge: 'attention', badges: [notMoving(2)] }

  const OTHERS = Object.values(W)
  return Object.fromEntries(['V1', 'V2', 'V3'].map((id) => [id, [
    { id: 's1', caption: 'All seven workspaces', html: sidebar([...OTHERS, BILLING_MOVING[id]]) },
    { id: 's2', caption: "Billing's CI finishes, two asks go stuck", html: sidebar([...OTHERS, BILLING_STUCK]) },
  ]]))
}
