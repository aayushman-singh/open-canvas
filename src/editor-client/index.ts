// src/editor-client/index.ts
//
// ADR 0015 editor-client module tree — Phase 1 stub entry point.
//
// As the migration proceeds (Phase 2+), the contents of
// src/editor/canvas-client.ts move into this tree as normal TS modules
// with normal imports. The Phase 1 stub exists only to give
// scripts/build-editor-client.ts a real entrypoint that produces a
// hashed JS + CSS pair under dist/_assets/ — proving the pipeline end
// to end before any editor code moves.
//
// The route does not load this bundle yet. Phase 3 is the atomic
// cutover where editor/route.tsx stops inlining canvas-client and
// starts serving the asset.

import './styles.css';

console.log('[editor-client] Phase 1 stub bootstrapping');
