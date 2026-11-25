// Spec: sidebar groups a workspace by its work in progress — UI atlas generator: configuration only.
//
// atlas.mjs (from the design-atlas skill, never edited here) reads the text from the markdown:
// the view list and flow from the UI map, the cards from one file per area. This file only
// says which files to read and which mockup modules draw the states. One module per area
// (mockups-<area>.mjs), each exporting `(kit) => ({ A1: [{ id: 's1', caption, html, notes? }] })`;
// mockups-example.mjs shows the contract.
//
// Run from anywhere: node .ai/prototypes/sidebar-in-progress/generate.mjs
// Never edit index.html by hand. View ids (A3) and state ids (A3-s2) are review anchors:
// append new ones, never renumber.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAtlas } from './atlas.mjs'
import { SB_ICONS, placementStates } from './mockups-placement.mjs'

const OUT = path.dirname(fileURLToPath(import.meta.url))

runAtlas({
  outDir: OUT,
  specsDir: path.resolve(OUT, '../../../tasks'),
  // = the directory name; comments.js must declare the same id.
  prototypeId: 'sidebar-in-progress',
  title: 'Spec: sidebar groups a workspace by its work in progress — UI atlas',
  mapFile: 'spec-sidebar-in-progress-ui-map.md',
  // Stage 2: one entry per cards file, in the order the atlas shows them. `mockups: false`
  // renders the cards with "mockups pending"; `overview: true` (one file at most) puts that
  // file's area-wide rules and decisions on the overview page instead of an area page.
  areaFiles: [
    { file: 'spec-sidebar-in-progress-ui-placement.md', areas: ['V'], title: 'Placement options', mockups: true },
  ],
  // Stage 3: areas whose every card needs states (and every state a card).
  mockupAreas: ['V'],
  frameLabel: 'Desktop sidebar · 300',
  // CSS variable → frame width it must fit; the atlas sets it to scale frames to the column.
  frameScales: { '--sb-scale': 320 },
  icons: SB_ICONS,
  states: [placementStates],
})
