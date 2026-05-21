# multiplayer

## Definition

`multiplayer` owns the live, converging state of a page while one or more editors are looking at it. It is the single authority that decides "what does this page look like right now to every connected editor": every keystroke and every awareness change passes through here, gets merged into a conflict-free shared document, and is broadcast to all other editors of the same page within a few hundred milliseconds. It also owns the durability fence — periodically promoting the live state into the long-term page record so that closing every browser tab and re-opening hours later reveals the same page contents. Each page has its own independent multiplayer session, identified by the page identity; sessions for different pages do not interact. One identity in the participant list is reserved for the AI agent collaborator so that the agent appears alongside human editors rather than as an out-of-band actor.

## Inputs

- **editor (browser)** → a stream of document operations and per-editor presence updates (cursor position, identity, colour) for one specific page.
- **page store** → the most recently durable version of the page contents, used to bootstrap the session when no editors are currently connected.
- **environment clock** → ticks that drive the time-based durability fence even when no edits are happening.
- **AI agent (future)** → document operations attributed to a reserved participant identity, indistinguishable on the wire from a human editor.

## Outputs

- **editor (browser)** → the merged document state on first connect, plus the live stream of every other participant's operations and presence updates.
- **page store** → a periodic snapshot of the page contents written back at a fixed cadence (op-count or wall-clock, whichever fires first), so the durable record never drifts more than a small window behind the live state.
- **operator / logs** → loud diagnostics on protocol violations, snapshot failures, and ownership-check rejections; no silent fallbacks.

## Schema

The ProseMirror schema in `pm-schema.ts` is the rev01 document vocabulary — every node and mark in `src/document/schema.ts` (`NODE_SCHEMA` + `MARK_TYPES`) is mirrored with matching attrs, content groups, parseDOM, and toDOM. The editor (`src/editor/client.ts`) declares the same set via `Node.create` / `Mark.create`, so both sides of the wire produce identical Y.XmlFragments. No StarterKit derivation: that vocabulary doesn't cover sections, columns, actions, media or dividers and would silently truncate every save.

Optional attrs default to `null` at the PM layer; `y-prosemirror` therefore skips writing them to the Y.XmlElement. On the way back out, `snapshot.ts` strips null-valued attrs, empty `attrs` objects, empty `marks` arrays, and empty `content` arrays so the serialised `DocumentJSON` matches the seed shape byte-for-byte after `JSON.stringify`.

Round-trip guarantee is enforced by `bun run multiplayer:smoke`, which hydrates a Y.Doc from each of the three seed pages (`maple-coffee`, `foundry-type`, `lighthouse-launch`), serialises back, asserts string equality with the seed, and replays the binary Yjs update on a second client to confirm convergence.

## Cold-start hydration

`PageDocument.ensureHydrated` reads the `page.doc` JSONB column from Postgres on first WS upgrade for a given pageId, runs it through `hydrateYDoc` to produce the initial Y.Doc, and persists subsequent updates back via `persistSnapshot`. `persistSnapshot` calls `validateDocument` before writing — a malformed snapshot throws loudly instead of poisoning the column. Once a DO has hydrated for a pageId it refuses requests for any other pageId on the same instance (DOs are keyed by pageId via `idFromName`, so a mismatch indicates an upstream routing bug).
