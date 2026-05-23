// src/live/site-room.ts
//
// SiteRoom — one Durable Object per Published Site. Owns the WebSocket fan-out
// for visitor live-update: when an Owner publishes a new snapshot, the publish
// endpoint POSTs to /broadcast and the DO ships the rendered HTML to every
// connected visitor socket. Also tracks a tiny presence count broadcast so
// open tabs know how many other visitors are watching live.
//
// Keyed by site.id via SITE_ROOM.idFromName(siteId). One DO per Published
// Site; Visitors are not auth-gated (Visitor !== Owner).
//
// ----------------------------------------------------------------------------
// Phase 0 — Yjs message envelope scaffold.
//
// The five message kinds reserved below (`y-sync-step1`, `y-sync-step2`,
// `y-update`, `awareness-update`, `editable-state-replaced`) are the contract
// that Wave 1 #3 (version history) and #4 (co-edit) consume. Their handlers
// throw with a clear TODO so a misrouted client during Phase 0 fails loudly
// rather than silently no-oping.
//
// The four Yjs sync kinds (every kind ending in `-update` or starting with
// `y-`) carry `Uint8Array` payloads that we base64-encode inside the JSON
// envelope so the WebSocket text frames stay opaque-string clean. The two
// helpers `encodeBytesField` / `decodeBytesField` keep that contract in one
// place so Wave 1 #4 doesn't re-invent the encoding.
//
// The `editable-state-replaced` kind is the server→client broadcast that
// Wave 1 #3 fires from its restore handler — the version-history restore
// path calls `SiteRoom.broadcast` with this kind to flip every connected
// editor to the restored state. The Phase 0 scaffold defines the shape and
// leaves the handler body to Wave 1.
// ----------------------------------------------------------------------------

import { DurableObject } from 'cloudflare:workers';

import type { CanvasSiteState } from '../canvas/schema.js';

// ----------------------------------------------------------------------------
// Existing message kinds (Phase 0 unchanged)
// ----------------------------------------------------------------------------

interface BroadcastPayload {
  version: number;
  html: string;
}

// Runtime check for the /broadcast body. The publish endpoint is the only
// caller, but the DO HTTP boundary is treated as untrusted: if a malformed
// payload ever reaches this point (test harness mistake, future internal
// caller drift, etc.), we reject loudly rather than letting unvalidated
// data flow into every visitor's `innerHTML` swap.
function isBroadcastPayload(value: unknown): value is BroadcastPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const version = candidate.version;
  if (typeof version !== 'number') return false;
  if (!Number.isFinite(version)) return false;
  if (!Number.isInteger(version)) return false;
  if (version < 1) return false;
  if (typeof candidate.html !== 'string') return false;
  return true;
}

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
 * the server) may send. Phase 0 leaves handler bodies as TODO; Wave 1 #4
 * fills in the four Y-* handlers and Wave 1 #3 fills in the broadcast hook
 * for `editable-state-replaced`.
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

// ----------------------------------------------------------------------------
// Message-shape guards (untrusted boundary)
// ----------------------------------------------------------------------------

function hasStringField(obj: Record<string, unknown>, key: string): boolean {
  return typeof obj[key] === 'string';
}

function isSiteRoomMessage(value: unknown): value is SiteRoomMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'y-sync-step1':
      return hasStringField(v, 'stateVector');
    case 'y-sync-step2':
    case 'y-update':
    case 'awareness-update':
      return hasStringField(v, 'update');
    case 'editable-state-replaced':
      return (
        hasStringField(v, 'siteId') && typeof v.newState === 'object' && v.newState !== null
      );
    default:
      return false;
  }
}

// ----------------------------------------------------------------------------
// SiteRoom Durable Object
// ----------------------------------------------------------------------------

export class SiteRoom extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload: unknown = await request.json();
      if (!isBroadcastPayload(payload)) {
        console.error('[SiteRoom] rejected malformed broadcast', payload);
        return new Response('invalid broadcast payload', { status: 400 });
      }
      const message = JSON.stringify(payload);
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(message);
        } catch (error) {
          console.error('[SiteRoom] broadcast send failed', error);
        }
      }
      // Update presence after a broadcast too — keeps a fresh count visible.
      this.broadcastPresence();
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/socket' && request.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      // Presence updates run inline; the count is sent on connect.
      queueMicrotask(() => {
        this.broadcastPresence();
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('not found', { status: 404 });
  }

  /**
   * Inbound WebSocket message dispatcher. The existing presence/publish
   * fan-out runs over server→client text broadcasts only — no client→server
   * messages were previously expected. Phase 0 wires the Yjs message kinds
   * as TODO stubs so a Wave 1 #4 client connecting at this point fails
   * loudly with a precise pointer to the owning plan.
   *
   * Existing kinds keep working byte-for-byte because:
   *   * `/broadcast` HTTP path is unchanged.
   *   * Presence broadcast is server-initiated, never client-initiated.
   *   * This handler did not exist before — adding it is additive.
   */
  override webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): void {
    let parsed: unknown;
    try {
      parsed = typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
      console.error('[SiteRoom] rejected non-JSON websocket message', error);
      return;
    }

    if (!isSiteRoomMessage(parsed)) {
      console.error('[SiteRoom] rejected unknown websocket message kind', parsed);
      return;
    }

    switch (parsed.type) {
      case 'y-sync-step1':
      case 'y-sync-step2':
      case 'y-update':
      case 'awareness-update':
        // Wave 1 #4 (co-edit) replaces these stubs with a real Yjs sync
        // implementation. The throw is deliberate — silently no-op'ing
        // would mask the missing wiring during Phase 0 / inter-wave merges.
        throw new Error(
          'TODO: implement in Wave 1 — see docs/superpowers/plans/2026-05-23-04-co-edit.md',
        );
      case 'editable-state-replaced':
        // The version-history restore (Wave 1 #3) broadcasts this kind FROM
        // the server to every connected editor. Clients never send it
        // upstream; a client→server occurrence is a protocol violation.
        // Wave 1 #3 broadcasts via a server-side hook that calls into the
        // DO directly (not through this inbound message handler), so this
        // branch stays a guard rather than a handler.
        void ws;
        throw new Error(
          'TODO: implement in Wave 1 — see docs/superpowers/plans/2026-05-23-03-version-history.md',
        );
      default: {
        const _exhaustive: never = parsed;
        console.error('[SiteRoom] unreachable message kind', _exhaustive);
      }
    }
  }

  override webSocketClose(): void {
    this.broadcastPresence();
  }

  override webSocketError(): void {
    this.broadcastPresence();
  }

  private broadcastPresence(): void {
    const count = this.ctx.getWebSockets().length;
    const message = JSON.stringify({ type: 'presence', count });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(message);
      } catch (error) {
        console.error('[SiteRoom] presence send failed', error);
      }
    }
  }
}
