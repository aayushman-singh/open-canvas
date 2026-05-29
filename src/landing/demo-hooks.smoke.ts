// src/landing/demo-hooks.smoke.ts
//
// Asserts that every value in LANDING_DEMO_IDS / LANDING_DEMO_CMP_NAMES /
// LANDING_DEMO_KIT_NAMES / LANDING_DEMO_TAB_NAMES appears as a string
// literal in LANDING_DEMO_SRC. Catches the drift class where someone
// renames a hook in demo-hooks.ts (which automatically flows into
// HeroPanel.tsx via the import) but forgets to update demo-script.ts.
//
// Run: bun run landing-hooks:smoke

import {
  LANDING_DEMO_IDS,
  LANDING_DEMO_CMP_NAMES,
  LANDING_DEMO_KIT_NAMES,
  LANDING_DEMO_TAB_NAMES,
} from './demo-hooks.js';
import { LANDING_DEMO_SRC } from './demo-script.js';

const missing: string[] = [];

for (const [key, value] of Object.entries(LANDING_DEMO_IDS)) {
  if (!LANDING_DEMO_SRC.includes(value)) {
    missing.push(`LANDING_DEMO_IDS.${key} = ${JSON.stringify(value)}`);
  }
}

for (const name of LANDING_DEMO_CMP_NAMES) {
  // The demo IIFE references these as `data-cmp="<name>"` selector strings.
  if (!LANDING_DEMO_SRC.includes(name)) {
    missing.push(`LANDING_DEMO_CMP_NAMES: ${JSON.stringify(name)}`);
  }
}

for (const name of LANDING_DEMO_KIT_NAMES) {
  // The demo IIFE references these as `data-kit="<name>"` selectors and as
  // direct kit-name strings in the cycle steps.
  if (!LANDING_DEMO_SRC.includes(name)) {
    missing.push(`LANDING_DEMO_KIT_NAMES: ${JSON.stringify(name)}`);
  }
}

for (const name of LANDING_DEMO_TAB_NAMES) {
  if (!LANDING_DEMO_SRC.includes(name)) {
    missing.push(`LANDING_DEMO_TAB_NAMES: ${JSON.stringify(name)}`);
  }
}

if (missing.length > 0) {
  throw new Error(
    `landing-hooks-smoke: LANDING_DEMO_SRC is missing string references to ${missing.length} hook value(s) — rename in demo-hooks.ts must be mirrored in demo-script.ts.\n  - ${missing.join('\n  - ')}`,
  );
}

process.stdout.write(
  `[landing-hooks:smoke] OK — every hook value in demo-hooks.ts is referenced in LANDING_DEMO_SRC (${
    Object.keys(LANDING_DEMO_IDS).length
  } ids + ${LANDING_DEMO_CMP_NAMES.length} cmp + ${LANDING_DEMO_KIT_NAMES.length} kit + ${LANDING_DEMO_TAB_NAMES.length} tab).\n`,
);
