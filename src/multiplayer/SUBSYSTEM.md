# multiplayer (legacy — superseded)

> Status: **SUPERSEDED** by `src/live/site-room.ts` as of the canvas-first POC (T9-partial, 2026-05-22).
> The current live surface is `SiteRoom` — one Durable Object per site, used for publish broadcasts and presence rather than per-keystroke CRDT merging. See [ADR 0003](../../docs/adr/0003-canvas-first-reset.md).

This directory is retained on disk so the option to revive a Yjs-backed per-keystroke multiplayer surface lives in commit history. It is **excluded from typecheck** (`tsconfig.json` `exclude`) and **excluded from lint** (`eslint.config.js` `ignores`); `src/index.ts` no longer imports `./multiplayer/page-document` and the `PAGE_DO` Durable Object binding has been removed from `wrangler.toml`. A `v3` migration tag with `deleted_classes = ["PageDocument"]` drops the class on next deploy. The `prosemirror-*`, `y-prosemirror`, `y-protocols`, and `yjs` dependencies that powered this subsystem have been removed from `package.json`.

---

## Original definition (preserved for context)

`multiplayer` owned the live, converging state of a page while one or more editors were looking at it. It was the single authority that decided "what does this page look like right now to every connected editor": every keystroke and every awareness change passed through here, got merged into a conflict-free shared document (Yjs CRDT), and was broadcast to all other editors of the same page within a few hundred milliseconds. It also owned the durability fence — periodically promoting the live state into the long-term page record. Each page had its own independent multiplayer session, identified by the page identity. One identity in the participant list was reserved for the AI agent collaborator.

## Why it was retired

A canvas of positioned primitives does not benefit from CRDT-style per-keystroke merging — Owners drop items, drag them, swap kits, and click Publish. Conflict resolution on a fixed-size primitive list is trivial and does not warrant a 250KB Yjs+ProseMirror dependency chain in the edge bundle. The live wire collapsed to publish broadcasts + presence (`SiteRoom`), which fits the lived behaviour. See ADR 0003.
