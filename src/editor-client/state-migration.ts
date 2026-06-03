// src/editor-client/state-migration.ts
//
// ADR 0015 Phase 2b — in-memory legacy-state migration. Runs on every
// editor load by design: per ADR 0007's Yjs co-edit model, a one-shot
// DB migration is rejected because old peers writing legacy string
// hrefs would silently break a "migrated" database. The operation is
// cheap (linear over elements, no I/O); the loud failure mode is
// "Action hrefs render as #" which the migration fixes in memory
// before render.
//
// The legacy shapes this migration handles:
//   - ActionElement.href as a bare string  →  { type: 'external', url }
//   - ActionElement.label as a bare string →  [{ text: <string> }]
//
// The Owner-facing memory note for 2026-06-02 records that the label
// shape broke production once when a PR flipped string → InlineRun[]
// without a DB migration; this migration is the editor's safety net
// against that class of regression for older rows.

import type { EditableSite, CanvasSection } from '../canvas/schema.js';

// The migration runs against potentially-legacy data whose shape predates
// the current type definitions. We cast through a permissive `unknown`
// record at the per-element boundary so the legacy-string detection
// compiles — the current TS types declare `href` and `label` as their
// post-migration shapes only, so without a cast TypeScript correctly
// flags the `typeof === 'string'` checks as unreachable.
type LegacyActionFields = { href: unknown; label: unknown };

export function migrateState(state: EditableSite | null): EditableSite | null {
  if (!state || !state.pages) return state;
  for (const page of state.pages) {
    for (const section of page.sections) {
      migrateSection(section);
    }
  }
  migrateSection(state.header);
  migrateSection(state.footer);
  return state;
}

function migrateSection(section: CanvasSection | undefined): void {
  if (!section || !Array.isArray(section.elements)) return;
  for (const el of section.elements) {
    if (el.type !== 'action') continue;
    const action = el as unknown as LegacyActionFields;
    if (typeof action.href === 'string') {
      action.href = { type: 'external', url: action.href };
    }
    if (typeof action.label === 'string') {
      action.label = [{ text: action.label }];
    }
  }
}
