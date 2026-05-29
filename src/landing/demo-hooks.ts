// src/landing/demo-hooks.ts
//
// Single source of truth for the DOM hooks the landing-page demo IIFE
// (src/landing/demo-script.ts) reads from the HTML emitted by
// src/landing/components/HeroPanel.tsx.
//
// HeroPanel.tsx imports these constants and uses them in JSX so a rename
// here flows automatically into the rendered HTML. demo-script.ts cannot
// import TS at runtime — it is a String.raw IIFE — so its body still
// hardcodes the same literal values. The companion smoke
// src/landing/demo-hooks.smoke.ts asserts every value here appears as a
// string literal in LANDING_DEMO_SRC, so a rename here that misses
// demo-script.ts fails CI rather than silently breaking the demo at
// render time.

/** DOM element ids the demo IIFE reads with `document.getElementById`. */
export const LANDING_DEMO_IDS = {
  sidebar: 'demo-sidebar',
  sidebarUpload: 'demo-sb-upload',
  canvas: 'demo-canvas',
  cursorJohn: 'demo-cursor-john',
  cursorAgent: 'demo-cursor-agent',
  feed: 'demo-feed',
} as const;

/** `data-cmp` values the demo IIFE flashes via `flashCmp(name)`. */
export const LANDING_DEMO_CMP_NAMES = [
  'text',
  'image',
  'button',
  'shape',
  'container',
  'nav',
  'chart',
  'form',
] as const;

/** `data-kit` values the demo IIFE toggles via `activateKit(name)`. */
export const LANDING_DEMO_KIT_NAMES = [
  'charcoal',
  'orange-editorial',
  'blue-saas',
  'green-organic',
] as const;

/** `data-tab` / `data-panel` values for the sidebar tab triplet. */
export const LANDING_DEMO_TAB_NAMES = ['add', 'sections', 'pages'] as const;

export type LandingDemoCmpName = (typeof LANDING_DEMO_CMP_NAMES)[number];
export type LandingDemoKitName = (typeof LANDING_DEMO_KIT_NAMES)[number];
export type LandingDemoTabName = (typeof LANDING_DEMO_TAB_NAMES)[number];
