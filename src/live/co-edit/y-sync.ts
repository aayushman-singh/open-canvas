// src/live/co-edit/y-sync.ts
//
// Yjs sync helpers used by `SiteRoom` to dispatch the three sync envelopes
// (`y-sync-step1`, `y-sync-step2`, `y-update`) against an in-memory `Y.Doc`.
//
// These are deliberately **pure-ish** helpers — they take a `Y.Doc` and the
// already-decoded `Uint8Array` payload from a base64 envelope, and either
// mutate the doc or return bytes to send back. The DO orchestrates the
// transport; this module owns the protocol-level semantics.
//
// Wire-protocol shape (kept opaque-clean JSON for visibility in logs and
// trivial routing through the existing text-frame WebSocket; the binary Yjs
// payloads live as base64 strings inside the envelopes):
//
//   client → server  : y-sync-step1   { stateVector: base64(Y.encodeStateVector(clientDoc)) }
//   server → client  : y-sync-step2   { update:      base64(Y.encodeStateAsUpdate(serverDoc, clientStateVector)) }
//   client → server  : y-sync-step2   { update:      base64(Y.encodeStateAsUpdate(clientDoc, serverStateVector)) }
//   bidirectional    : y-update       { update:      base64(updateBytes) }
//
// Why not `writeSyncStep1` / `readSyncMessage` from y-protocols/sync? Those
// helpers prefix each payload with a varUint message-type tag and expect to
// be read off a single binary stream. The project's existing SiteRoom
// envelope uses **explicit named JSON kinds** with base64 binary fields
// (defined in `src/live/site-room.ts` as a frozen Phase 0 contract). We
// implement the same client-server semantics directly against Yjs's core
// `encodeStateVector` / `encodeStateAsUpdate` / `applyUpdate` so the
// envelope shape stays the source of truth.
//
// Origin tagging — every `applyUpdate` call passes a project-local sentinel
// (`Y_SYNC_REMOTE_ORIGIN`) so observers can distinguish "this update came
// over the wire" from "this update came from a local transaction". The DO
// uses that to avoid echoing wire-updates back to the socket that sent
// them (would otherwise produce an infinite ping-pong on the y-update path).

import * as Y from 'yjs';

/**
 * Sentinel passed as the `origin` argument to `Y.applyUpdate` whenever a
 * Yjs payload arrives off the network. Local `doc.transact(...)` writes
 * either omit the origin or pass a different sentinel; downstream observers
 * compare identity (`===`) to route the update.
 *
 * Exported so the autosave hook and the broadcast hook can both reach the
 * same identity without re-declaring the value.
 */
export const Y_SYNC_REMOTE_ORIGIN: unique symbol = Symbol('y-sync-remote');

/**
 * Apply an inbound `y-sync-step1` payload to the doc. Returns the bytes the
 * caller should ship back as a `y-sync-step2` envelope — namely, the diff
 * the remote needs to catch up to the doc's current state.
 *
 * Reading the remote's state-vector and computing the response is a pure
 * read on the doc; no mutation happens here.
 */
export function handleSyncStep1(doc: Y.Doc, remoteStateVector: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, remoteStateVector);
}

/**
 * Apply an inbound `y-sync-step2` payload to the doc. The bytes carry the
 * remote's missing updates; we merge them into the local doc via
 * `applyUpdate` tagged with the remote origin.
 *
 * No return value — the caller proceeds to await further `y-update` frames.
 */
export function handleSyncStep2(doc: Y.Doc, updateBytes: Uint8Array): void {
  Y.applyUpdate(doc, updateBytes, Y_SYNC_REMOTE_ORIGIN);
}

/**
 * Apply an inbound `y-update` payload to the doc. Same semantics as step2 —
 * we tag the origin so the doc's own `update` observer knows not to relay
 * this update back to the socket it came from.
 */
export function handleYUpdate(doc: Y.Doc, updateBytes: Uint8Array): void {
  Y.applyUpdate(doc, updateBytes, Y_SYNC_REMOTE_ORIGIN);
}

/**
 * Encode the doc's current state vector. Used by clients on connect to
 * include in their outbound `y-sync-step1` envelope. Re-exported here so
 * client code consuming this module never has to import `yjs` directly.
 */
export function encodeStateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

/**
 * Encode the doc's full state (no state-vector filter). Used by the
 * `editable-state-replaced` broadcast path — the DO ships the entire doc
 * to every connected client so they replace their local copy wholesale.
 */
export function encodeFullState(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}
