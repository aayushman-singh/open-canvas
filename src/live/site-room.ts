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
// Yjs message envelopes (`y-sync-step1`, `y-sync-step2`, `y-update`,
// `awareness-update`, `editable-state-replaced`) carry binary payloads
// base64-encoded into JSON so WebSocket text frames stay opaque-string clean.
// Envelope shapes + the byte helpers live in `./site-room-protocol.ts` so
// browser-bundled consumers don't need to import `cloudflare:workers`.

import { DurableObject } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import * as Y from 'yjs';

import type { EditableSite } from '../canvas/schema.js';
import { isSiteId } from '../canvas/validate.js';
import { encodeYDoc } from '../canvas/yjs-projection.js';
import { db } from '../db/client.js';
import { site as siteTable } from '../db/schema.js';
import { attachAutosaveToDO } from './co-edit/autosave.js';
import {
  type Awareness,
  applyAwareness,
  createAwareness,
  encodeAwareness,
  removeAwarenessClientIds,
} from './co-edit/awareness.js';
import {
  Y_SYNC_REMOTE_ORIGIN,
  encodeFullState,
  encodeStateVector,
  handleSyncStep1,
  handleSyncStep2,
  handleYUpdate,
} from './co-edit/y-sync.js';

// ----------------------------------------------------------------------------
// SiteRoom environment surface
//
// The DO binding is declared with `class_name = "SiteRoom"` in wrangler.toml;
// the env reaches the DO through its constructor. We type only the
// `DATABASE_URL` (Postgres connection string read by the autosave hook) so
// the rest of the env stays opaque. The detach contract is identical to
// every other DO in this project.
// ----------------------------------------------------------------------------

interface SiteRoomEnv {
  DATABASE_URL: string;
}

// ----------------------------------------------------------------------------
// Message kinds
// ----------------------------------------------------------------------------

interface BroadcastPayload {
  version: number;
  html: string;
  htmlBySlug?: Record<string, string>;
  defaultSlug?: string;
}

type SocketRole = 'visitor' | 'editor';

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
  if (candidate.htmlBySlug !== undefined) {
    if (
      typeof candidate.htmlBySlug !== 'object' ||
      candidate.htmlBySlug === null ||
      Array.isArray(candidate.htmlBySlug)
    ) {
      return false;
    }
    const htmlBySlug = candidate.htmlBySlug as Record<string, unknown>;
    if (typeof candidate.defaultSlug !== 'string') return false;
    if (!(candidate.defaultSlug in htmlBySlug)) return false;
    for (const value of Object.values(htmlBySlug)) {
      if (typeof value !== 'string') return false;
    }
  } else if (candidate.defaultSlug !== undefined) {
    return false;
  }
  return true;
}

// ----------------------------------------------------------------------------
// Yjs sync message envelopes + bytes helpers
//
// Defined in `./site-room-protocol.ts` so consumers that need only the wire
// shape (browser-bundled editor, Bun-runnable smokes) don't pull
// `cloudflare:workers` through this module. Re-exported here so the
// previously-frozen import surface (`from '../site-room'`) keeps working
// byte-for-byte for any consumer already wired against it.
// ----------------------------------------------------------------------------

export {
  type AwarenessUpdateEnvelope,
  type EditableStateReplacedEnvelope,
  type SiteRoomMessage,
  type YSyncStep1Envelope,
  type YSyncStep2Envelope,
  type YUpdateEnvelope,
  decodeBytesField,
  encodeBytesField,
} from './site-room-protocol.js';

import type {
  AwarenessUpdateEnvelope,
  EditableStateReplacedEnvelope,
  PresenceRefreshEnvelope,
  SiteRoomMessage,
  YSyncStep1Envelope,
  YSyncStep2Envelope,
  YUpdateEnvelope,
} from './site-room-protocol.js';
import { decodeBytesField, encodeBytesField } from './site-room-protocol.js';

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
      return hasStringField(v, 'siteId') && typeof v.newState === 'object' && v.newState !== null;
    default:
      return false;
  }
}

/**
 * Body shape for the `editable-state-replaced` POST. Wave 1 #3 (version
 * history) POSTs to `https://do.invalid/broadcast` with this payload so the
 * DO can wipe its in-memory Y.Doc and ship a `y-sync-step2` carrying the
 * authoritative new state to every connected editor.
 */
interface EditableStateReplacedBroadcast {
  kind: 'editable-state-replaced';
  siteId: string;
  newState: EditableSite;
}

function isEditableStateReplacedBroadcast(value: unknown): value is EditableStateReplacedBroadcast {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'editable-state-replaced') return false;
  if (typeof v.siteId !== 'string' || v.siteId.length === 0) return false;
  if (typeof v.newState !== 'object' || v.newState === null) return false;
  return true;
}

/**
 * Internal options used to override autosave wiring during smokes. Production
 * code path always uses the defaults; smokes pass `disableAutosave: true` or
 * a stubbed `onPersist` to keep Postgres out of the loop.
 */
export interface SiteRoomTestHooks {
  /** Skip the autosave attach entirely. Used by the smoke. */
  disableAutosave?: boolean;
  /** Custom persist sink — receives the projected state on every flush. */
  onPersist?: (state: EditableSite) => void | Promise<void>;
}

// ----------------------------------------------------------------------------
// SiteRoom Durable Object
// ----------------------------------------------------------------------------

export class SiteRoom extends DurableObject<SiteRoomEnv> {
  // ----------------------------------------------------------------------
  // Co-edit state — Wave 1 #4
  //
  // The Y.Doc and Awareness instances are held in memory for the lifetime of
  // the DO. Hydration is lazy: the first `/socket` connect (or first
  // `/broadcast/editable-state-replaced`) seeds the doc from Postgres. The
  // doc itself never re-reads from Postgres after that — Postgres receives
  // a debounced write from the autosave hook in the other direction.
  //
  // If every editor disconnects, the doc lingers in memory until the DO is
  // evicted by the runtime (no explicit teardown). The autosave fires at
  // most once per debounce window, so a transient last-edit just before
  // eviction is flushed.
  // ----------------------------------------------------------------------

  private yDoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private siteId: string | null = null;
  private detachAutosave: (() => void) | null = null;
  private hydrationPromise: Promise<void> | null = null;
  private docUpdateObserver: ((update: Uint8Array) => void) | null = null;
  private awarenessUpdateObserver:
    | ((change: { added: number[]; updated: number[]; removed: number[] }) => void)
    | null = null;
  /** Map socket → its observed clientID(s) (added during awareness handshake). */
  private socketClientIds: WeakMap<WebSocket, Set<number>> = new WeakMap();
  /** Visitor sockets receive publish/presence broadcasts; only editors speak Yjs. */
  private socketRoles: WeakMap<WebSocket, SocketRole> = new WeakMap();
  /** When the wire-update dispatcher is mid-handle for a socket, remember it so the
   * broadcast observer can skip echoing back. */
  private currentOriginSocket: WebSocket | null = null;
  /** Optional test hooks; production stays at defaults. */
  private testHooks: SiteRoomTestHooks | null = null;
  /**
   * Throttle map keyed by log tag — a misbehaving client that sends garbage
   * every WS frame would otherwise drown the DO logs. We keep one timestamp
   * per category and skip emitting the same tag more than once per window.
   */
  private lastLogAtMs: Map<string, number> = new Map();
  private static readonly LOG_THROTTLE_WINDOW_MS = 5_000;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload: unknown = await request.json();

      // The publish broadcast (snapshot html) and the editable-state-replaced
      // broadcast share the same endpoint — branch on shape.
      if (isEditableStateReplacedBroadcast(payload)) {
        this.handleEditableStateReplaced(payload);
        return new Response('ok', { status: 200 });
      }

      if (!isBroadcastPayload(payload)) {
        console.error('[SiteRoom] rejected malformed broadcast', payload);
        return new Response('invalid broadcast payload', { status: 400 });
      }
      const message = JSON.stringify(payload);
      for (const ws of this.ctx.getWebSockets()) {
        this.safeSend(ws, message, '[SiteRoom] broadcast send failed');
      }
      // Update presence after a broadcast too — keeps a fresh count visible.
      this.broadcastPresence();
      return new Response('ok', { status: 200 });
    }

    if (url.pathname === '/socket' && request.headers.get('upgrade') === 'websocket') {
      const roleParam = url.searchParams.get('role');
      if (roleParam !== 'visitor' && roleParam !== 'editor') {
        console.error('[SiteRoom] rejected socket without valid role', { role: roleParam });
        return new Response('invalid socket role', { status: 400 });
      }
      // Both the public visitor route and the app-host editor route pass the
      // canonical site id. The role param decides whether this socket may
      // speak Yjs or only receive publish/presence broadcasts.
      const siteIdParam = url.searchParams.get('siteId');
      if (isSiteId(siteIdParam)) {
        this.siteId = siteIdParam;
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.socketRoles.set(pair[1], roleParam);
      // Presence updates run inline; the count is sent on connect.
      // When a NEW editor socket joins, nudge every OTHER editor socket to
      // republish its current awareness. Without this, peers wait for the
      // next y-protocols/awareness heartbeat (default 10s) before the
      // joiner sees them — the DO hibernates between idle periods and the
      // in-memory awareness map is dropped, so the joiner's y-sync-step1
      // initial-awareness reply contains only the joiner itself.
      const joinedEditor = roleParam === 'editor';
      const newSocket = pair[1];
      queueMicrotask(() => {
        this.broadcastPresence();
        if (joinedEditor) {
          this.requestPresenceRefresh(newSocket);
        }
      });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response('not found', { status: 404 });
  }

  /**
   * Lazily hydrate the in-memory Y.Doc from Postgres `site.editableState`.
   * Idempotent — subsequent calls await the same hydration promise so two
   * concurrent connects don't race two encodes.
   *
   * Smoke harness short-circuits this by directly invoking
   * `__primeForTest(state)` (see below), which avoids needing a DB.
   */
  private async ensureHydrated(): Promise<void> {
    if (this.yDoc !== null) return;
    if (this.hydrationPromise !== null) {
      await this.hydrationPromise;
      return;
    }
    this.hydrationPromise = (async () => {
      if (this.siteId === null) {
        throw new Error('[SiteRoom] cannot hydrate Y.Doc without siteId');
      }
      const client = db(this.env);
      const rows = await client
        .select({ editableState: siteTable.editableState })
        .from(siteTable)
        .where(eq(siteTable.id, this.siteId))
        .limit(1);
      const row = rows[0];
      if (!row) {
        throw new Error(`[SiteRoom] site not found while hydrating Y.Doc: ${this.siteId}`);
      }
      this.installDoc(row.editableState);
    })();
    try {
      await this.hydrationPromise;
    } finally {
      this.hydrationPromise = null;
    }
  }

  /**
   * Install a freshly-encoded Y.Doc plus Awareness instance and wire the
   * autosave + broadcast observers. Called by the lazy-hydration path and
   * by `handleEditableStateReplaced` (for destructive wholesale replacement).
   */
  private installDoc(state: EditableSite): void {
    // Tear down any previous doc.
    if (this.detachAutosave) {
      this.detachAutosave();
      this.detachAutosave = null;
    }
    if (this.yDoc && this.docUpdateObserver) {
      this.yDoc.off('update', this.docUpdateObserver);
    }
    if (this.awareness && this.awarenessUpdateObserver) {
      this.awareness.off('update', this.awarenessUpdateObserver);
    }

    this.yDoc = encodeYDoc(state);
    this.awareness = createAwareness(this.yDoc);

    // Broadcast every doc update to every connected socket EXCEPT the one
    // that originated it (currentOriginSocket). Remote-origin updates from
    // the wire are tagged with Y_SYNC_REMOTE_ORIGIN; locally-installed
    // updates (e.g. from initial encode) carry no origin and don't reach
    // here (the encode happens inside the encodeYDoc call which observers
    // attached AFTER it don't see).
    this.docUpdateObserver = (update: Uint8Array) => {
      const envelope: YUpdateEnvelope = {
        type: 'y-update',
        update: encodeBytesField(update),
      };
      const message = JSON.stringify(envelope);
      const origin = this.currentOriginSocket;
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === origin) continue;
        if (!this.isEditorSocket(ws)) continue;
        this.safeSend(ws, message, '[SiteRoom] y-update fan-out failed');
      }
    };
    this.yDoc.on('update', this.docUpdateObserver);

    this.awarenessUpdateObserver = ({
      added,
      updated,
      removed,
    }: {
      added: number[];
      updated: number[];
      removed: number[];
    }) => {
      if (!this.awareness) return;
      // Bookkeep clientID → socket so webSocketClose knows which awareness
      // entries to tombstone when this socket disconnects. Without this
      // association, the WeakMap stays empty and the close handler skips
      // every cleanup, leaving the disconnected tab's clientID in every
      // peer's awareness map. On a solo refresh the next session sees the
      // ghost as a peer and the editor pill reads "2 editing" until the
      // y-protocols 30s outdated-state sweep finally drops it. This was
      // the fix the comment in webSocketClose claimed shipped — the
      // socketClientIds.set() call was missing all along.
      const origin = this.currentOriginSocket;
      if (origin) {
        if (added.length > 0) {
          let ids = this.socketClientIds.get(origin);
          if (!ids) {
            ids = new Set();
            this.socketClientIds.set(origin, ids);
          }
          for (const id of added) ids.add(id);
        }
        if (removed.length > 0) {
          const ids = this.socketClientIds.get(origin);
          if (ids) for (const id of removed) ids.delete(id);
        }
      }

      // Skip the encode + fan-out when no peer would receive it. Awareness
      // updates fire on every cursor move / selection change from the
      // origin editor — when they're solo in the room every one of those
      // events used to encode an awareness payload and walk the socket
      // list to find zero targets. Short-circuit when the targetable
      // editor count is zero so the per-update cost drops to the
      // bookkeeping above and one socket-roster scan.
      let targetableEditorCount = 0;
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) {
        if (ws === origin) continue;
        if (this.isEditorSocket(ws)) {
          targetableEditorCount += 1;
          break;
        }
      }
      if (targetableEditorCount === 0) return;

      const changed = added.concat(updated).concat(removed);
      const update = encodeAwareness(this.awareness, changed);
      const envelope: AwarenessUpdateEnvelope = {
        type: 'awareness-update',
        update: encodeBytesField(update),
      };
      const message = JSON.stringify(envelope);
      for (const ws of sockets) {
        if (ws === origin) continue;
        if (!this.isEditorSocket(ws)) continue;
        this.safeSend(ws, message, '[SiteRoom] awareness fan-out failed');
      }
    };
    this.awareness.on('update', this.awarenessUpdateObserver);

    // Attach the debounced Postgres autosave. Test hooks can disable this
    // path to avoid a real DB connection from the smoke harness.
    if (!this.testHooks?.disableAutosave && this.siteId !== null) {
      const onPersist = this.testHooks?.onPersist;
      this.detachAutosave = attachAutosaveToDO(
        this.yDoc,
        this.env,
        this.siteId,
        onPersist ? { onPersist } : {},
      );
    }
  }

  /**
   * Wave 1 #3 entry — replace the in-memory Y.Doc with a fresh encoding of
   * the restored state, then broadcast a `y-sync-step2` carrying the FULL
   * doc to every connected editor. Clients clear their local doc and
   * apply the update wholesale.
   *
   * The full-state broadcast (vs an incremental update) is deliberate:
   * restoring a historical snapshot is a destructive operation and must
   * not be merge-resolved against in-flight edits — the contract is "the
   * timeline rewinds for everyone". The `editable-state-replaced` envelope
   * type signals the destructive intent explicitly so the client can
   * tear down its UI before applying.
   */
  private handleEditableStateReplaced(payload: EditableStateReplacedBroadcast): void {
    if (this.siteId === null) {
      this.siteId = payload.siteId;
    }
    this.installDoc(payload.newState);
    if (!this.yDoc) return;

    // First, ship an explicit replacement envelope so clients know to wipe
    // their local doc before applying the new state.
    const replaceEnvelope: EditableStateReplacedEnvelope = {
      type: 'editable-state-replaced',
      siteId: payload.siteId,
      newState: payload.newState,
    };
    const replaceMessage = JSON.stringify(replaceEnvelope);

    // Then, ship a full-state y-sync-step2 carrying the entire doc. Clients
    // apply it after wiping (the EditableStateReplacedEnvelope handler in
    // the browser client re-encodes from `newState` directly, but for
    // peers that joined mid-replacement we also send the full state via
    // step2 so the doc-level sync is consistent).
    const step2Envelope: YSyncStep2Envelope = {
      type: 'y-sync-step2',
      update: encodeBytesField(encodeFullState(this.yDoc)),
    };
    const step2Message = JSON.stringify(step2Envelope);

    this.sendToEditorSockets(
      replaceMessage,
      null,
      '[SiteRoom] editable-state-replaced fan-out failed',
    );
    this.sendToEditorSockets(
      step2Message,
      null,
      '[SiteRoom] editable-state-replaced fan-out failed',
    );
  }

  /**
   * Inbound WebSocket message dispatcher. The y-sync handlers route inbound
   * Yjs payloads to the in-memory doc; the autosave observer + the broadcast
   * observer pick up from there.
   */
  override async webSocketMessage(ws: WebSocket, raw: ArrayBuffer | string): Promise<void> {
    let parsed: unknown;
    try {
      parsed =
        typeof raw === 'string' ? JSON.parse(raw) : JSON.parse(new TextDecoder().decode(raw));
    } catch (error) {
      // A misbehaving client can hammer non-JSON frames; throttle the log so
      // it doesn't drown out everything else the DO has to say.
      this.logThrottled('[SiteRoom] rejected non-JSON websocket message', error);
      return;
    }

    if (!isSiteRoomMessage(parsed)) {
      this.logThrottled('[SiteRoom] rejected unknown websocket message kind', parsed);
      return;
    }

    if (!this.isEditorSocket(ws)) {
      this.logThrottled('[SiteRoom] rejected visitor websocket message', parsed);
      return;
    }

    // Lazy-hydrate the Y.Doc on first message rather than on first connect.
    //
    // Tradeoff: this defers the Postgres read until a real Yjs frame arrives,
    // which keeps idle WebSocket connects (visitors, dead tabs, port-scans)
    // off the DB. It also lets the smoke harness call `__primeForTest()`
    // between accept and the first inbound frame, so the smoke can seed an
    // in-memory doc without a DB round-trip. Both reasons are deliberate —
    // production behaviour is "don't hit Postgres until we have to" and the
    // smoke contract is "prime before first frame".
    if (this.yDoc === null) {
      try {
        await this.ensureHydrated();
      } catch (error) {
        console.error('[SiteRoom] Y.Doc hydration failed', error);
        return;
      }
    }
    const doc = this.yDoc;
    const awareness = this.awareness;
    if (!doc || !awareness) {
      console.error('[SiteRoom] no Y.Doc after hydration — refusing to dispatch');
      return;
    }

    // Tag this socket as the origin so the broadcast observer can skip it.
    this.currentOriginSocket = ws;
    try {
      switch (parsed.type) {
        case 'y-sync-step1': {
          const stateVector = decodeBytesField(parsed.stateVector);
          const reply: YSyncStep2Envelope = {
            type: 'y-sync-step2',
            update: encodeBytesField(handleSyncStep1(doc, stateVector)),
          };
          this.safeSend(ws, JSON.stringify(reply), '[SiteRoom] y-sync-step2 reply send failed');
          // Also send our own state vector so the client can ship US the
          // updates we don't yet have (symmetric client-server sync).
          const ourStep1: YSyncStep1Envelope = {
            type: 'y-sync-step1',
            stateVector: encodeBytesField(encodeStateVector(doc)),
          };
          this.safeSend(ws, JSON.stringify(ourStep1), '[SiteRoom] y-sync-step1 reply send failed');
          // Bootstrap awareness for the new peer — ship our current view of
          // every connected client's presence so they render without
          // waiting for the next setLocalState bump.
          const knownClients = Array.from(awareness.getStates().keys());
          if (knownClients.length > 0) {
            const update = encodeAwareness(awareness, knownClients);
            const envelope: AwarenessUpdateEnvelope = {
              type: 'awareness-update',
              update: encodeBytesField(update),
            };
            this.safeSend(
              ws,
              JSON.stringify(envelope),
              '[SiteRoom] initial awareness send failed',
            );
          }
          return;
        }
        case 'y-sync-step2': {
          handleSyncStep2(doc, decodeBytesField(parsed.update));
          return;
        }
        case 'y-update': {
          handleYUpdate(doc, decodeBytesField(parsed.update));
          return;
        }
        case 'awareness-update': {
          applyAwareness(awareness, decodeBytesField(parsed.update), Y_SYNC_REMOTE_ORIGIN);
          return;
        }
        case 'editable-state-replaced': {
          // Wave 1 #3 broadcasts this kind FROM the server. Clients never
          // send it upstream — a client→server occurrence is a protocol
          // violation. Reject and log loudly per the project's posture
          // (throttled so a stuck client doesn't drown the DO logs).
          this.logThrottled(
            '[SiteRoom] rejected client-originated editable-state-replaced',
            parsed,
          );
          return;
        }
        case 'presence-refresh': {
          // Server-originated nudge only — a client→server occurrence is a
          // protocol violation, same shape as editable-state-replaced.
          // isSiteRoomMessage already rejects this (it's not in the
          // accepted list), so reaching here means the validator drifted;
          // throttle the log either way.
          this.logThrottled(
            '[SiteRoom] rejected client-originated presence-refresh',
            parsed,
          );
          return;
        }
        default: {
          const _exhaustive: never = parsed;
          console.error('[SiteRoom] unreachable message kind', _exhaustive);
        }
      }
    } finally {
      this.currentOriginSocket = null;
    }
  }

  override webSocketClose(ws: WebSocket): void {
    // Tombstone the disconnecting socket's awareness state via y-protocols'
    // removeAwarenessStates: it bumps the awareness clock and fires the
    // 'update' event, so the fan-out observer encodes a removal payload that
    // every peer applies — they drop the dead clientID from their local
    // Awareness immediately instead of waiting ~30s for the outdated-state
    // timeout. The old direct Map.delete() variant didn't fire the event,
    // which left a solo refresh seeing the previous tab's ghost clientID
    // as a "peer" and counting "2 editing".
    if (this.awareness) {
      const ids = this.socketClientIds.get(ws);
      if (ids && ids.size > 0) {
        removeAwarenessClientIds(this.awareness, Array.from(ids), 'webSocketClose');
      }
    }
    this.broadcastPresence();
  }

  override webSocketError(): void {
    this.broadcastPresence();
  }

  private lastPresenceCount: number | null = null;

  private broadcastPresence(): void {
    const sockets = this.ctx.getWebSockets();
    const count = sockets.length;
    // Skip the fan-out when nothing actually changed. broadcastPresence
    // fires on every connect / close / role-bound broadcast — including
    // the publish path that touches no socket roster — so the count is
    // unchanged on most calls. Each skipped iteration is one Durable
    // Object request × N peers we no longer bill.
    if (count === this.lastPresenceCount) return;
    this.lastPresenceCount = count;
    const message = JSON.stringify({ type: 'presence', count });
    for (const ws of sockets) {
      this.safeSend(ws, message, '[SiteRoom] presence send failed');
    }
  }

  private isEditorSocket(ws: WebSocket): boolean {
    return this.socketRoles.get(ws) === 'editor';
  }

  /**
   * Send a `presence-refresh` nudge to every editor socket EXCEPT the one
   * that just joined. Each peer responds by re-publishing its local
   * awareness state, which fans back through this DO and lands on the new
   * socket — collapsing the 0–10s window between connect and presence
   * convergence. Skips visitor sockets and the joiner itself; safeSend
   * evicts any dead socket the way every other fan-out does.
   */
  private requestPresenceRefresh(joinerSocket: WebSocket): void {
    const envelope: PresenceRefreshEnvelope = { type: 'presence-refresh' };
    const message = JSON.stringify(envelope);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === joinerSocket) continue;
      if (!this.isEditorSocket(ws)) continue;
      this.safeSend(ws, message, '[SiteRoom] presence-refresh send failed');
    }
  }

  private sendToEditorSockets(message: string, skip: WebSocket | null, errorMessage: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (skip !== null && ws === skip) continue;
      if (!this.isEditorSocket(ws)) continue;
      this.safeSend(ws, message, errorMessage);
    }
  }

  /**
   * Send a message to a socket; on send failure, log loudly and evict the
   * socket so we don't keep fanning out to a dead handle. Cloudflare's
   * hibernation API surfaces sends to dead sockets as throws — once that
   * happens the socket is unusable and `close()` is the documented cleanup.
   */
  private safeSend(ws: WebSocket, message: string, errorTag: string): void {
    try {
      ws.send(message);
    } catch (error) {
      this.logThrottled(errorTag, error);
      try {
        ws.close(1011, 'send failed');
      } catch {
        // Already torn down — drop silently.
      }
    }
  }

  /**
   * Rate-limited `console.error`. The first emission per tag inside the
   * throttle window logs at full fidelity; subsequent emissions are
   * silently dropped until the window rolls over. A persistent fault
   * therefore reports once every 5s rather than once per frame.
   */
  private logThrottled(tag: string, payload: unknown): void {
    const now = Date.now();
    const last = this.lastLogAtMs.get(tag) ?? 0;
    if (now - last < SiteRoom.LOG_THROTTLE_WINDOW_MS) return;
    this.lastLogAtMs.set(tag, now);
    console.error(tag, payload);
  }

  // ----------------------------------------------------------------------
  // Test hooks — used ONLY by `src/live/co-edit/smoke.ts`. Not part of the
  // production protocol; do not call from feature code.
  //
  // The smoke harness needs to prime an in-memory Y.Doc without a Postgres
  // round-trip (the DO normally hydrates by querying `site.editableState`).
  // `__primeForTest` accepts a seed state + autosave hooks; the doc is
  // installed eagerly and the autosave path is either disabled or routed
  // to a stubbed sink.
  // ----------------------------------------------------------------------

  /** @internal Test-only entrypoint. Wires the DO without a DB hop. */
  __primeForTest(siteId: string, state: EditableSite, hooks: SiteRoomTestHooks): void {
    this.siteId = siteId;
    this.testHooks = hooks;
    this.installDoc(state);
  }
}
