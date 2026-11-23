// tokens.css for a storyboard of an app that is not Open Mercato.
//
// The engine (components.css, screens.css, prototype.css, prototype.js) reads a fixed set of
// CSS variables. This file maps the app's own design tokens onto that contract and also exposes
// the ramps under an app prefix (--app-*) for the surface styles at the end of screens.css.
//
// Fill the source: import the app's token module directly when it is TypeScript (Node strips
// types: `await import('../../src/theme/tokens.ts')`), or parse its CSS. Never re-type values.
// Then: node tokens.mjs && node <skill>/scripts/sync-tokens.mjs --verify .
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ── 1. The app's tokens ─────────────────────────────────────────────────
// Example for a TypeScript token module:
//   const { colors, radius, shadow } = await import(path.resolve(here, '../../../src/ui/tokens.ts'))
// Source: packages/app/src/styles/theme.ts (light base + paseoDarkColors). Paseo themes are
// built by functions there, so the values are copied by hand; keep them in step with theme.ts.
const app = {
  white: '#ffffff',
  gray: { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 500: '#71717a', 600: '#71717a', 700: '#3f3f46', 900: '#1a1a1e' },
  brand: { 50: '#e8f3ed', 100: '#cfe6d9', 200: '#a3cfb5', 500: '#2a8a59', 600: '#20744A', 700: '#1a5f3c', 900: '#0f3622' },
  error: { 50: '#9d433b1f', 100: '#9d433b2f', 200: '#9d433b55', 500: '#9d433b', 600: '#9d433b', 700: '#9d433b' },
  warning: { 50: '#7b5d391f', 100: '#7b5d392f', 200: '#7b5d3955', 500: '#7b5d39', 600: '#7b5d39', 700: '#7b5d39' },
  success: { 50: '#3e704a1f', 100: '#3e704a2f', 200: '#3e704a55', 500: '#3e704a', 600: '#3e704a', 700: '#3e704a' },
  font: '-apple-system, BlinkMacSystemFont, "Inter", ui-sans-serif, system-ui, sans-serif',
  radius: { sm: '4px', md: '6px', lg: '8px', xl: '12px' },
  shadow: { xs: '0 1px 2px rgb(10 13 18 / 0.05)', md: '0 4px 6px -1px rgb(10 13 18 / 0.1)', lg: '0 12px 16px -4px rgb(10 13 18 / 0.08)', xl: '0 20px 24px -4px rgb(10 13 18 / 0.08)' },
  extra: {
    'surface0': '#ffffff', 'surface1': '#fafafa', 'surface2': '#f4f4f5', 'surface3': '#e4e4e7',
    'fg': '#1a1a1e', 'fg-muted': '#71717a', 'fg-xmuted': '#a1a1aa', 'line': '#e4e4e7',
    'accent': '#20744A', 'accent-fg': '#ffffff', 'hl': 'rgba(0, 0, 0, 0.06)',
    'ok': '#3e704a', 'danger': '#9d433b', 'warn': '#7b5d39', 'merged': '#7347af',
    'ok-tint': '#3e704a1f', 'danger-tint': '#9d433b1f', 'warn-tint': '#7b5d391f', 'merged-tint': '#7347af1f',
  },
}

const ramp = (name) => Object.entries(app[name]).map(([step, value]) => `  --app-${name}-${step}: ${value};`).join('\n')

// ── 2. The engine contract ──────────────────────────────────────────────
const css = `/* GENERATED — do not edit by hand. Regenerate with: node tokens.mjs (this directory). */

:root {
  color-scheme: light;

${['gray', 'brand', 'error', 'warning', 'success'].map(ramp).join('\n')}
  --app-white: ${app.white};
${Object.entries(app.extra).map(([k, v]) => `  --app-${k}: ${v};`).join('\n')}

  --font-geist-sans: ${app.font};
  --font-geist-mono: ui-monospace, "SFMono-Regular", Menlo, monospace;
  --radius: ${app.radius.lg};
  --radius-sm: ${app.radius.sm};
  --radius-md: ${app.radius.md};
  --radius-lg: ${app.radius.lg};
  --radius-xl: ${app.radius.xl};
  --background: var(--app-white);
  --foreground: var(--app-gray-900);
  --card: var(--app-white);
  --card-foreground: var(--app-gray-900);
  --popover: var(--app-white);
  --popover-foreground: var(--app-gray-900);
  --primary: var(--app-brand-600);
  --primary-foreground: var(--app-white);
  --primary-hover: var(--app-brand-700);
  --accent-indigo: var(--app-brand-600);
  --accent-indigo-foreground: var(--app-white);
  --secondary: var(--app-gray-50);
  --secondary-foreground: var(--app-gray-900);
  --muted: var(--app-gray-50);
  --muted-foreground: var(--app-gray-600);
  --accent: var(--app-gray-50);
  --accent-foreground: var(--app-gray-900);
  --destructive: var(--app-error-600);
  --border: var(--app-gray-200);
  --input: var(--app-gray-300);
  --ring: var(--app-brand-500);
  --bg-disabled: var(--app-gray-100);
  --text-disabled: var(--app-gray-500);
  --border-disabled: var(--app-gray-300);
  --sidebar: var(--app-brand-900);
  --sidebar-foreground: var(--app-white);
  --sidebar-border: var(--app-brand-700);
  --chart-blue: var(--app-brand-600);
  --status-error-bg: var(--app-error-50);
  --status-error-text: var(--app-error-700);
  --status-error-border: var(--app-error-200);
  --status-error-icon: var(--app-error-500);
  --status-success-bg: var(--app-success-50);
  --status-success-text: var(--app-success-700);
  --status-success-border: var(--app-success-200);
  --status-success-icon: var(--app-success-500);
  --status-warning-bg: var(--app-warning-50);
  --status-warning-text: var(--app-warning-700);
  --status-warning-border: var(--app-warning-200);
  --status-warning-icon: var(--app-warning-500);
  --status-info-bg: var(--app-brand-50);
  --status-info-text: var(--app-brand-700);
  --status-info-border: var(--app-brand-200);
  --status-info-icon: var(--app-brand-500);
  --status-neutral-bg: var(--app-gray-50);
  --status-neutral-text: var(--app-gray-700);
  --status-neutral-border: var(--app-gray-200);
  --status-neutral-icon: var(--app-gray-500);
  --status-pink-bg: var(--app-brand-50);
  --status-pink-text: var(--app-brand-700);
  --status-pink-border: var(--app-brand-200);
  --status-pink-icon: var(--app-brand-500);
  --brand-lime: var(--app-brand-500);
  --brand-violet: var(--app-brand-600);
  --font-size-overline: 0.6875rem;
  --font-size-overline--line-height: 1rem;
  --z-index-base: 0;
  --z-index-sticky: 10;
  --z-index-dropdown: 20;
  --z-index-overlay: 30;
  --z-index-modal: 40;
  --z-index-popover: 45;
  --z-index-toast: 50;
  --z-index-tooltip: 60;
  --z-index-top: 100;
  --shadow-xs: ${app.shadow.xs};
  --shadow-sm: ${app.shadow.xs};
  --shadow-md: ${app.shadow.md};
  --shadow-lg: ${app.shadow.lg};
  --shadow-xl: ${app.shadow.xl};
  --shadow-2xl: ${app.shadow.xl};
  --shadow-focus: 0 0 0 2px var(--app-white), 0 0 0 4px var(--app-brand-500);
}

.dark {
  color-scheme: dark;
  --app-surface0: #181B1A; --app-surface1: #1E2120; --app-surface2: #272A29; --app-surface3: #434645;
  --app-fg: #E6E8E7; --app-fg-muted: #A1A5A4; --app-fg-xmuted: #717574; --app-line: #252B2A;
  --app-accent: #20744A; --app-accent-fg: #ffffff; --app-hl: rgba(255, 255, 255, 0.06);
  --app-ok: #6cb17b; --app-danger: #d8847b; --app-warn: #c09664; --app-merged: #a890d5;
  --app-ok-tint: #6cb17b29; --app-danger-tint: #d8847b29; --app-warn-tint: #c0966429; --app-merged-tint: #a890d529;
  --background: #181B1A; --foreground: #E6E8E7; --card: #1E2120; --muted: #1E2120; --muted-foreground: #A1A5A4; --border: #252B2A;
}
`

const unfilled = JSON.stringify(app).includes('"TODO"')
if (unfilled) {
  console.error('tokens.mjs still has placeholder values; fill them from the app\'s design tokens.')
  process.exitCode = 2
} else {
  fs.writeFileSync(path.join(here, 'tokens.css'), css)
  console.log('wrote tokens.css')
}
