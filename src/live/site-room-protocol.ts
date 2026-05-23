// src/live/site-room-protocol.ts
//
// Wire-protocol surface for SiteRoom WebSocket messages, factored out of
// `src/live/site-room.ts` so consumers that need only the envelope shapes +
// the base64 helpers (Wave 1 #4 co-edit client, smokes, future bundled
// editor entry) don't pull in `cloudflare:workers` — which is a workerd
// virtual module that Bun + browser bundlers can't resolve.
//
// The DO module re-exports everything below so the previously-frozen
// import path (`from '../site-room'`) keeps working byte-for-byte for any
// consumer that's already wired against it. This file is the authoritative
// definition; site-room.ts forwards.
//
// Phase 0 contract: the five message kinds + the two byte helpers are
// frozen surface. Wave 1 #4 fills in handler bodies and the broadcast hook;
// the shapes here do not change between Phase 0 and Wave 1.

import type { CanvasSiteState } from '../canvas/schema.js';

// ----------------------------------------------------------------------------
// Yjs sync message envelopes (Wave 1 #3 + #4 consumers)
// ----------------------------------------------------------------------------

/**
 * Initial sync — client sends its state vector so the server can compute the
 * minimal update that brings the client up to date.
 *
 * Direction: client → server.
 */
export interface YSyncStep1Envelope {
  type: 'y-sync-step1';
  /** Base64-encoded Y.encodeStateVector(localDoc) payload. */
  stateVector: string;
}

/**
 * Second step of the sync — server returns the missing update (response to
 * step1) OR client returns the symmetric update (it also sends its own step2).
 *
 * Direction: bidirectional.
 */
export interface YSyncStep2Envelope {
  type: 'y-sync-step2';
  /** Base64-encoded Y.encodeStateAsUpdate(remoteDoc, theirStateVector) payload. */
  update: string;
}

/**
 * Live incremental update broadcast — emitted from `doc.on('update', …)` and
 * relayed to every other connected client.
 *
 * Direction: bidirectional.
 */
export interface YUpdateEnvelope {
  type: 'y-update';
  /** Base64-encoded Yjs update bytes. */
  update: string;
}

/**
 * Awareness (presence/cursor) update — Y.Awareness encodeAwarenessUpdate.
 *
 * Direction: bidirectional.
 */
export interface AwarenessUpdateEnvelope {
  type: 'awareness-update';
  /** Base64-encoded Yjs awareness update bytes. */
  update: string;
}

/**
 * Server-initiated full-state replacement — version-history restore (Wave 1
 * #3) calls this so every connected editor flips to the restored state in
 * one atomic broadcast. The client clears its local Y.Doc and re-applies the
 * encoded version of `newState`.
 *
 * Direction: server → client.
 */
export interface EditableStateReplacedEnvelope {
  type: 'editable-state-replaced';
  siteId: string;
  newState: CanvasSiteState;
}

/**
 * Discriminated union of every message kind a WebSocket-connected editor (or
 * the server) may send.
 */
export type SiteRoomMessage =
  | YSyncStep1Envelope
  | YSyncStep2Envelope
  | YUpdateEnvelope
  | AwarenessUpdateEnvelope
  | EditableStateReplacedEnvelope;

// ----------------------------------------------------------------------------
// Bytes-over-JSON helpers
//
// WebSocket text frames carry JSON envelopes; binary payloads (Yjs updates,
// awareness updates, state vectors) live as base64-encoded strings inside
// those envelopes. Centralised here so every Wave 1 #4 producer + consumer
// uses the same encoding without re-inventing it.
// ----------------------------------------------------------------------------

/**
 * Encode a Uint8Array as a base64 string for embedding in a JSON envelope.
 * Worker-runtime-safe: uses `btoa` + a `String.fromCharCode` chunking trick
 * rather than `Buffer` (which is not present in the CF Workers runtime).
 */
export function encodeBytesField(bytes: Uint8Array): string {
  // Chunk to avoid `String.fromCharCode.apply` argument-length overflow on
  // large updates; 0x8000 is the conservative threshold that V8 + JSCore +
  // workerd accept.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Decode a base64 string back into a Uint8Array. Inverse of `encodeBytesField`.
 */
export function decodeBytesField(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
