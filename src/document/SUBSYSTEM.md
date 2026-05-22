# document (legacy — superseded)

> Status: **SUPERSEDED** by `src/canvas/` as of the canvas-first POC (T9-partial, 2026-05-22).
> The current document vocabulary lives in `src/canvas/schema.ts` (positioned primitives + Style Kit selector) and the current renderer lives in `src/canvas/render.ts`. See [ADR 0003](../../docs/adr/0003-canvas-first-reset.md) and the implementation plan at `docs/superpowers/plans/2026-05-22-canvas-first-poc.md`.

This directory is retained on disk so the option to revive a ProseMirror-shaped document model lives in commit history. It is **excluded from typecheck** (`tsconfig.json` `exclude`) and **excluded from lint** (`eslint.config.js` `ignores`); `src/index.ts` does not import it. The pure type aliases (`DocumentJSON`, `ThemeTokenSet`) are still imported by `src/db/schema.ts` for the legacy `page` and `template` tables, and the renderer + validator remain self-contained (no `prosemirror-*` or `yjs` dep).

---

## Original definition (preserved for context)

`document` owned the vocabulary of a page: the set of node and mark kinds, their attributes, the structural rules that say which children belong inside which parent, and the deterministic mapping from a document tree to an HTML string. It was the contract every other subsystem in rev01 either produced or consumed — the editor (multiplayer task) emitted trees that conformed here, the agent (tool-use task) constructed trees whose shape was constrained by the same registry, the template catalogue stored trees that satisfied this contract, and the public-facing renderer turned one of those trees plus a theme token set into the bytes a browser received.

## Why it was retired

The canvas-first reset replaced the flow-document model (sections containing blocks containing inlines) with a positioned-primitive canvas (free-positioned elements with explicit coordinates + a deterministic Style Kit), because the lived Owner experience of "drag this thing here" cannot be expressed cleanly in a ProseMirror-shaped tree. See ADR 0003 for the full reasoning.
