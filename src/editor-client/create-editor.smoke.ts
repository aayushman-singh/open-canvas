// src/editor-client/create-editor.smoke.ts
//
// ADR 0058 Phase 2q.m — typing smoke for the createEditor wiring.
//
// This file does NOT call `createEditor` — invocation would throw inside
// Bun because the DOM-ref caches assume `document.getElementById` exists.
// What we DO verify is that the function's static type signature accepts
// a real `EditorBoot` payload and that the imported context-shape stays
// consistent with what the wiring expects.
//
// Behavioural parity for the boot sequence itself stays pinned by the
// inline IIFE smokes (canvas-state-gate, host-config, etc.) until Phase 3
// cutover swaps the editor route to serve the bundle.

import type { EditorBoot } from './editor-context.js';
import { createEditor } from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[create-editor:smoke] ${message}`);
}

// ---- Type-only fixture --------------------------------------------------

const boot: EditorBoot = {
  siteId: 'site-smoke',
  apiBase: '/api',
  wsToken: '',
  displayName: 'Smoke',
  userId: 'user-smoke',
};

// Pull a reference to createEditor so the import doesn't tree-shake away
// and the signature gets compared against EditorBoot at type-check time.
const create: (boot: EditorBoot) => void = createEditor;
assert(typeof create === 'function', 'createEditor must be exported as a function');
assert(create.length >= 1, 'createEditor must accept a boot argument');

// Touch every field on the boot payload so a future EditorBoot field
// rename (e.g. siteId → projectId) breaks here loudly.
assert(boot.siteId === 'site-smoke', 'siteId fixture round-trips');
assert(boot.apiBase === '/api', 'apiBase fixture round-trips');
assert(boot.wsToken === '', 'wsToken fixture round-trips');
assert(boot.displayName === 'Smoke', 'displayName fixture round-trips');
assert(boot.userId === 'user-smoke', 'userId fixture round-trips');

console.log('[create-editor:smoke] OK');
