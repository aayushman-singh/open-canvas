// src/live/co-edit/browser-entry.ts
//
// Browser-side entry that the bundler (scripts/bundle-co-edit.ts) emits as
// an IIFE wrapped around the co-edit client module. The editor's
// canvas-client.ts reads `window.__opencanvasCoEdit.connectCoEdit` on init.
//
// Previously the esbuild build script attached this global via its
// `globalName: '__opencanvasCoEdit'` option. Bun.build (ADR 0015 follow-up:
// move off the Wrangler-hoisted esbuild transitive) emits format='iife'
// without an equivalent globalName option, so the global assignment
// lives here in source. The shape on the global stays identical:
// `{ connectCoEdit }`.

import { connectCoEdit } from './client.js';

// `window` is the actual runtime target but is not in the Worker tsconfig's
// lib (this entry file is bundled for the browser by scripts/bundle-co-edit.ts
// and never reaches the Worker isolate). Reach through `globalThis` so the
// type-check passes without dragging the DOM lib into the entire src/ tree.
(globalThis as unknown as {
  __opencanvasCoEdit: { connectCoEdit: typeof connectCoEdit };
}).__opencanvasCoEdit = { connectCoEdit };
