// src/live/co-edit/client.ts
//
// Browser-side Yjs client wiring. Exported sole entrypoint:
//
//   connectCoEdit(siteId, initialState): CoEditConnection
//
// The connection owns:
//   * A local `Y.Doc` hydrated from `initialState` via `encodeYDoc`.
//   * An `Awareness` instance for presence broadcast.
//   * A WebSocket to `/__live?siteId=<id>` (same endpoint the visitor
//     presence-pill uses; see `src/routes/public.ts`).
//   * Auto-reconnect with exponential backoff (capped + jittered).
//
// The editor host (`src/editor/canvas-client.ts`) consumes this module to
// route mutations through the shared Y.Doc. Specifically:
//   * `connection.applyLocalState(state)` lets the existing direct-mutation
//     editor checkpoint its JSON state into the Y.Doc on every save — the
//     CRDT then computes a minimal update and broadcasts it via the
//     WebSocket.
//   * `connection.onRemoteState(handler)` fires when a remote update lands;
//     the handler is given the projected `EditableSite` and is
//     responsible for re-rendering the editor DOM.
//
// IMPORTANT — environment surface:
// This module is **bundled into the editor inline script** by
// `src/editor/canvas-client.ts`. It must work in the browser environment;
// it deliberately imports `yjs` and `y-protocols` so the build pipeline
// resolves them to browser builds. No Cloudflare-Worker-only globals.

import * as Y from 'yjs';

import type { EditableSite } from '../../canvas/schema.js';
import { decodeYDoc, encodeYDoc } from '../../canvas/yjs-projection.js';
import {
  type Awareness,
  type PresenceState,
  applyAwareness,
  createAwareness,
  encodeAwareness,
  setLocalPresence,
} from './awareness.js';
import {
  Y_SYNC_REMOTE_ORIGIN,
  encodeStateVector,
  handleSyncStep2,
  handleYUpdate,
} from './y-sync.js';

import { decodeBytesField, encodeBytesField } from '../site-room-protocol.js';
import type {
  AwarenessUpdateEnvelope,
  EditableStateReplacedEnvelope,
  SiteRoomMessage,
  YSyncStep1Envelope,
  YSyncStep2Envelope,
  YUpdateEnvelope,
} from '../site-room-protocol.js';

// ----------------------------------------------------------------------------
// Local origin tag for outbound transactions — distinguishes "this update
// originated locally and must be broadcast" from "this update came off the
// wire and must NOT be re-broadcast" (Y_SYNC_REMOTE_ORIGIN).
// ----------------------------------------------------------------------------

const LOCAL_ORIGIN = Symbol('co-edit-local');

export interface CoEditConnection {
  /** The live Y.Doc. Editor host treats this as the source of truth. */
  doc: Y.Doc;
  /** Awareness handle for presence broadcast. */
  awareness: Awareness;
  /**
   * Reconcile a local JSON snapshot into the doc — diff is computed by
   * Yjs and the outbound `y-update` carries only the changed structs.
   *
   * This is the additive seam the existing direct-mutation editor uses:
   * every existing `scheduleSave()` site calls this with the current
   * `state` JSON; the doc absorbs the change; the rest of the network
   * receives an update.
   */
  applyLocalState: (state: EditableSite) => void;
  /**
   * Subscribe to remote-update events. The handler is fired with the
   * decoded `EditableSite` after every wire update arrives. Editor
   * host uses this to refresh its local `state` and re-render.
   *
   * Returns an unsubscribe function.
   */
  onRemoteState: (handler: (state: EditableSite) => void) => () => void;
  /**
   * Publish a presence update (cursor / selection / name+colour). The
   * Awareness instance handles the broadcast clock + outdated timeout.
   */
  setPresence: (presence: PresenceState | null) => void;
  /**
   * Subscribe to remote presence changes. Handler receives a snapshot map
   * of clientID → PresenceState (excluding the local client).
   *
   * Returns an unsubscribe function.
   */
  onRemotePresence: (handler: (peers: Map<number, PresenceState>) => void) => () => void;
  /** Tear down the WebSocket and stop observers. */
  destroy: () => void;
}

export interface ConnectCoEditOptions {
  /** Override the websocket URL — used by smokes that don't run in a browser. */
  websocketUrl?: string;
  /** Inject a custom WebSocket factory — smokes pass a stub here. */
  websocketFactory?: (url: string) => WebSocketLike;
  /**
   * Base delay (ms) for the first reconnect attempt. Subsequent attempts grow
   * exponentially up to `reconnectMaxDelayMs`. Defaults to 1000ms.
   *
   * Name kept for source-compatibility with existing smoke harnesses that pin
   * a large value here to suppress reconnects during in-process tests.
   */
  reconnectDelayMs?: number;
  /** Upper cap for the exponential backoff. Defaults to 30_000ms. */
  reconnectMaxDelayMs?: number;
  /**
   * Presence payload posted as soon as the socket opens — including every
   * reopen after a reconnect. Pass a function (RECOMMENDED for editor hosts)
   * so the connector resolves the fresh snapshot at each open from the
   * caller's source of truth; passing a literal `PresenceState` captures
   * the value at attach time and risks stale data on reconnect (ADR 0065
   * F2 — `editingCollectionTemplateId` was being reset to its boot-time
   * `null` on reopen because the literal snapshot was frozen at attach).
   *
   * `null` from the function is treated as "skip the initial push" — the
   * caller is signalling that no presence should be advertised yet.
   */
  initialPresence?: PresenceState | (() => PresenceState | null);
}

/**
 * Browser/runtime-agnostic WebSocket surface. Matches the lcd of both the
 * browser `WebSocket` and a smoke-time in-memory channel. We don't depend
 * on the browser's full WebSocket type so the same module works inside
 * `bun run` smokes where `WebSocket` is not in scope.
 */
export interface WebSocketLike {
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    event: 'open' | 'message' | 'close' | 'error',
    handler: (ev: { data?: unknown }) => void,
  ) => void;
  /**
   * Numeric ready state — 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED. Optional
   * because the smoke harness's hand-rolled WebSocketLike doesn't model it;
   * production always supplies a real browser WebSocket. send() guards on
   * `readyState !== 1` when the field is present to skip sending into a
   * socket that's still completing its handshake (the InvalidStateError
   * burst the user hit during the I1 retest was the awareness observer
   * firing on selectionchange while a reconnect was mid-flight).
   */
  readonly readyState?: number;
}

/**
 * Establish a co-edit connection for a site. Returns the long-lived
 * connection object; the caller (editor host or smoke) decides when to
 * `destroy()` it.
 *
 * The constructor:
 *   1. Builds a fresh Y.Doc from `initialState`. This is the local seed —
 *      if the server has a more recent doc in memory, the sync handshake
 *      will reconcile.
 *   2. Opens a WebSocket and on `open` sends a `y-sync-step1` envelope
 *      with the local state vector.
 *   3. Wires `doc.on('update', …)` to broadcast outbound `y-update`
 *      envelopes for every local transaction (filtered to skip
 *      remote-origin updates so we don't echo).
 *   4. Wires `awareness.on('update', …)` similarly for the awareness
 *      channel.
 *   5. Reconnects on close with exponential backoff + full jitter — base
 *      delay `reconnectDelayMs`, doubling per attempt, capped at
 *      `reconnectMaxDelayMs`. A successful re-handshake resets the counter.
 */
export function connectCoEdit(
  siteId: string,
  initialState: EditableSite,
  options?: ConnectCoEditOptions,
): CoEditConnection {
  const doc = encodeYDoc(initialState);
  const awareness = createAwareness(doc);

  const url = options?.websocketUrl ?? defaultWebsocketUrl(siteId);
  const factory = options?.websocketFactory ?? defaultWebsocketFactory;
  const reconnectBaseDelayMs = options?.reconnectDelayMs ?? 1000;
  const reconnectMaxDelayMs = options?.reconnectMaxDelayMs ?? 30_000;

  let socket: WebSocketLike | null = null;
  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Consecutive failed reconnect attempts since the last successful open.
  // Cleared to zero in the open handler so a long-stable connection that
  // later drops starts retrying at the base delay rather than the last cap.
  let reconnectAttempt = 0;
  const remoteStateHandlers = new Set<(state: EditableSite) => void>();
  const remotePresenceHandlers = new Set<(peers: Map<number, PresenceState>) => void>();

  function send(envelope: SiteRoomMessage): void {
    if (!socket) return;
    // Skip when the socket is still CONNECTING (readyState 0) or already
    // tearing down (CLOSING/CLOSED). The browser's WebSocket throws
    // InvalidStateError on send() outside OPEN, which our try/catch
    // swallows but used to log every selectionchange-during-reconnect as
    // an error — drowning the console + masking real failures. Local
    // awareness state still updates either way; the next y-protocols
    // heartbeat (~10s) re-publishes once the new socket opens.
    if (typeof socket.readyState === 'number' && socket.readyState !== 1) {
      return;
    }
    try {
      socket.send(JSON.stringify(envelope));
    } catch (error) {
      console.error('[co-edit:client] socket send failed', error);
    }
  }

  function emitRemoteState(): void {
    if (remoteStateHandlers.size === 0) return;
    // Project the doc to JSON once per fan-out so each handler sees the
    // same snapshot. The decode is a pure read; no Y.Doc mutation.
    const projected = decodeYDoc(doc);
    for (const handler of remoteStateHandlers) {
      try {
        handler(projected);
      } catch (error) {
        console.error('[co-edit:client] remote-state handler threw', error);
      }
    }
  }

  function emitRemotePresence(): void {
    if (remotePresenceHandlers.size === 0) return;
    const peers = new Map<number, PresenceState>();
    for (const [clientId, raw] of awareness.getStates()) {
      if (clientId === doc.clientID) continue;
      if (raw === null || typeof raw !== 'object') continue;
      const candidate = raw as Record<string, unknown>;
      if (typeof candidate.name !== 'string' || typeof candidate.color !== 'string') continue;
      peers.set(clientId, candidate as unknown as PresenceState);
    }
    for (const handler of remotePresenceHandlers) {
      try {
        handler(peers);
      } catch (error) {
        console.error('[co-edit:client] remote-presence handler threw', error);
      }
    }
  }

  // Local Y.Doc update observer — broadcasts to the WebSocket. We filter
  // out remote-origin updates so we don't echo wire-received bytes back.
  const docObserver = (update: Uint8Array, origin: unknown): void => {
    if (origin === Y_SYNC_REMOTE_ORIGIN) {
      // Remote update applied to our local doc — re-emit projected state
      // to subscribers, then return without rebroadcasting.
      emitRemoteState();
      return;
    }
    // Local-origin transaction — ship the update to the server.
    const envelope: YUpdateEnvelope = {
      type: 'y-update',
      update: encodeBytesField(update),
    };
    send(envelope);
  };
  doc.on('update', docObserver);

  // Awareness observer — broadcasts local presence + emits remote
  // presence changes to subscribers.
  const awarenessObserver = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changedClients = added.concat(updated).concat(removed);
    if (origin !== Y_SYNC_REMOTE_ORIGIN) {
      // Local change — broadcast.
      const update = encodeAwareness(awareness, changedClients);
      const envelope: AwarenessUpdateEnvelope = {
        type: 'awareness-update',
        update: encodeBytesField(update),
      };
      send(envelope);
    }
    emitRemotePresence();
  };
  awareness.on('update', awarenessObserver);

  function handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.error('[co-edit:client] non-JSON message', error);
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const envelope = parsed as { type?: unknown };
    switch (envelope.type) {
      case 'y-sync-step1': {
        // The server is asking US for our missing updates. Reply with a
        // step2 carrying everything the server doesn't yet know about.
        const step1 = parsed as YSyncStep1Envelope;
        const remoteSv = decodeBytesField(step1.stateVector);
        const reply: YSyncStep2Envelope = {
          type: 'y-sync-step2',
          update: encodeBytesField(Y.encodeStateAsUpdate(doc, remoteSv)),
        };
        send(reply);
        return;
      }
      case 'y-sync-step2': {
        const step2 = parsed as YSyncStep2Envelope;
        handleSyncStep2(doc, decodeBytesField(step2.update));
        // No emitRemoteState here — the docObserver above already fires
        // when applyUpdate produces a real change.
        return;
      }
      case 'y-update': {
        const yu = parsed as YUpdateEnvelope;
        handleYUpdate(doc, decodeBytesField(yu.update));
        return;
      }
      case 'awareness-update': {
        const au = parsed as AwarenessUpdateEnvelope;
        applyAwareness(awareness, decodeBytesField(au.update), Y_SYNC_REMOTE_ORIGIN);
        return;
      }
      case 'editable-state-replaced': {
        const er = parsed as EditableStateReplacedEnvelope;
        // Destructive replacement — version-history restore. Clear the
        // local doc and re-hydrate from the server's authoritative state.
        replaceDocContents(doc, er.newState);
        emitRemoteState();
        return;
      }
      case 'presence-refresh': {
        // Server-initiated nudge: a new editor peer just joined and the
        // server's awareness map (in-memory, dropped across DO
        // hibernations) doesn't yet know about us. Re-publish our local
        // presence so an awareness-update flies back through the server
        // and lands on the joiner. setLocalState bumps the awareness
        // clock unconditionally, so the observer fires even when the
        // payload is byte-identical to the previous state.
        const current = awareness.getLocalState();
        if (current !== null) {
          setLocalPresence(awareness, current as PresenceState);
        }
        return;
      }
      default:
        // Presence pings (`{type:'presence', count: N}`) and arbitrary
        // server messages we don't care about are silently ignored.
        return;
    }
  }

  function connect(): void {
    if (destroyed) return;
    let s: WebSocketLike;
    try {
      s = factory(url);
    } catch (error) {
      console.error('[co-edit:client] websocket factory threw', error);
      scheduleReconnect();
      return;
    }
    socket = s;
    s.addEventListener('open', () => {
      // Successful handshake — reset the backoff counter so the next outage
      // starts retries fresh rather than continuing the previous escalation.
      reconnectAttempt = 0;
      // Initial handshake — ship our state vector so the server can compute
      // the minimal diff to bring us up to date.
      const step1: YSyncStep1Envelope = {
        type: 'y-sync-step1',
        stateVector: encodeBytesField(encodeStateVector(doc)),
      };
      send(step1);
      // Push the initial presence, RESOLVED FRESH at each open. ADR 0065 F2 —
      // a literal-value `initialPresence` captured at attach time silently
      // shipped stale `editingCollectionTemplateId` on every reconnect; the
      // function form lets the caller read its current source of truth here
      // instead of relying on us to track its mutations.
      if (options?.initialPresence !== undefined) {
        const resolved =
          typeof options.initialPresence === 'function'
            ? options.initialPresence()
            : options.initialPresence;
        if (resolved !== null) {
          setLocalPresence(awareness, resolved);
        }
      }
    });
    s.addEventListener('message', (ev) => {
      handleMessage(ev.data);
    });
    s.addEventListener('close', () => {
      socket = null;
      scheduleReconnect();
    });
    s.addEventListener('error', () => {
      // Let the close handler drive reconnect — calling close() ourselves
      // races with the runtime's own close emission on some platforms.
      try {
        s.close();
      } catch {
        /* noop */
      }
    });
  }

  function scheduleReconnect(): void {
    if (destroyed) return;
    if (reconnectTimer !== null) return;
    // Exponential backoff with full jitter — base * 2^attempt, capped at the
    // ceiling, then multiplied by [0.5, 1.0) so a SiteRoom restart doesn't
    // see every editor reconnect on the same tick.
    const exponential = reconnectBaseDelayMs * 2 ** reconnectAttempt;
    const capped = Math.min(exponential, reconnectMaxDelayMs);
    const jittered = Math.round(capped * (0.5 + Math.random() * 0.5));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, jittered);
  }

  function applyLocalState(state: EditableSite): void {
    // Reconciliation strategy — clear the local doc's `state` root map and
    // rebuild it under a single LOCAL_ORIGIN transaction.
    //
    // Why NOT the "transient doc + state-vector diff" technique that looks
    // tempting on first read? Because Y.Map LWW resolves concurrent sets to
    // the same key by `(clientID, clock)` ordering. The transient doc has a
    // freshly-generated random clientID; whether the transient's writes
    // override the local doc's existing keys depends on whether the
    // transient's clientID happens to be numerically greater than the local
    // doc's — a coin-flip per call, which produces the kind of intermittent
    // "ops apparently lost" failures CRDTs are meant to prevent.
    //
    // The fix is to do all the writes under the LOCAL doc's clientID inside
    // one transaction: every set against `root` runs at a monotonically-
    // increasing local clock, so each set wins LWW against any prior set
    // to the same key.
    //
    // We still call `encodeYDoc(state)` to build a transient doc — it owns
    // the schema-aware field walking — and then deep-clone its root-map
    // contents into our doc. Cloning is straightforward because every Y type
    // produced by the projection is either a Y.Map, a Y.Array, or a
    // primitive; `cloneYValue` covers the three cases.
    const transient = encodeYDoc(state);
    doc.transact(() => {
      const root = doc.getMap<unknown>('state');
      for (const key of Array.from(root.keys())) root.delete(key);
      const transientRoot = transient.getMap<unknown>('state');
      for (const [key, value] of transientRoot.entries()) {
        root.set(key, cloneYValue(value));
      }
    }, LOCAL_ORIGIN);
  }

  function onRemoteState(handler: (state: EditableSite) => void): () => void {
    remoteStateHandlers.add(handler);
    return () => {
      remoteStateHandlers.delete(handler);
    };
  }

  function onRemotePresence(handler: (peers: Map<number, PresenceState>) => void): () => void {
    remotePresenceHandlers.add(handler);
    return () => {
      remotePresenceHandlers.delete(handler);
    };
  }

  function setPresence(presence: PresenceState | null): void {
    setLocalPresence(awareness, presence);
  }

  function destroy(): void {
    destroyed = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    doc.off('update', docObserver);
    awareness.off('update', awarenessObserver);
    if (socket) {
      try {
        socket.close();
      } catch {
        /* noop */
      }
      socket = null;
    }
  }

  connect();

  return {
    doc,
    awareness,
    applyLocalState,
    onRemoteState,
    setPresence,
    onRemotePresence,
    destroy,
  };
}

/**
 * Replace the contents of an existing Y.Doc with a fresh encoding of the
 * given state. Used by the `editable-state-replaced` handler — the doc
 * survives (so the clientID and registered observers remain valid) but
 * its `state` root map is wholesale replaced.
 *
 * Implementation note: we can't just delete the root map (a `Y.Map` is
 * bound to the doc forever). Instead we delete every key inside the root
 * map, then re-populate from the transient encoded doc, all inside one
 * transaction tagged as a remote-origin update so observers know not to
 * rebroadcast.
 */
export function replaceDocContents(doc: Y.Doc, newState: EditableSite): void {
  // Same cloning strategy as `applyLocalState` — see the comment there for
  // the LWW reasoning. The origin is Y_SYNC_REMOTE_ORIGIN so the local
  // docObserver doesn't broadcast the replacement back out (it came from
  // the server's editable-state-replaced envelope).
  const transient = encodeYDoc(newState);
  doc.transact(() => {
    const root = doc.getMap<unknown>('state');
    for (const key of Array.from(root.keys())) root.delete(key);
    const transientRoot = transient.getMap<unknown>('state');
    for (const [key, value] of transientRoot.entries()) {
      root.set(key, cloneYValue(value));
    }
  }, Y_SYNC_REMOTE_ORIGIN);
}

/**
 * Recursively rebuild a Y type (Y.Map / Y.Array) so the clone lives in the
 * destination doc with fresh struct IDs under the local clientID. Primitives
 * pass through unchanged. Used by `applyLocalState` to copy a transient
 * encoded doc's content into the live doc inside a local transaction.
 *
 * Yjs intentionally forbids attaching the same Y type to two docs; this
 * helper is the explicit workaround for the "build a transient + copy" flow
 * the projection module's reuse requires.
 */
function cloneYValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const out = new Y.Map<unknown>();
    for (const [k, v] of (value as Y.Map<unknown>).entries()) {
      out.set(k, cloneYValue(v));
    }
    return out;
  }
  if (value instanceof Y.Array) {
    const out = new Y.Array<unknown>();
    const src = value as Y.Array<unknown>;
    for (let i = 0; i < src.length; i += 1) {
      out.push([cloneYValue(src.get(i))]);
    }
    return out;
  }
  // Primitive (string, number, boolean, null). Y.Text would land here too,
  // but the projection doesn't produce Y.Text anywhere (per ADR 0007 the
  // TextElement content is a Y.Array<Y.Map>, handled by the array branch).
  return value;
}

function defaultWebsocketUrl(siteId: string): string {
  // Falls back to `/__live?siteId=...` — same endpoint visitors hit. The
  // app host routes `/__live` to the SiteRoom DO.
  const loc = (globalThis as { location?: { protocol: string; host: string } }).location;
  if (!loc) {
    throw new Error('connectCoEdit: no window.location available; pass websocketUrl explicitly');
  }
  const scheme = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${loc.host}/__live?siteId=${encodeURIComponent(siteId)}`;
}

function defaultWebsocketFactory(url: string): WebSocketLike {
  const WSCtor = (globalThis as { WebSocket?: new (url: string) => WebSocketLike }).WebSocket;
  if (!WSCtor) {
    throw new Error(
      'connectCoEdit: no global WebSocket constructor; pass websocketFactory explicitly',
    );
  }
  return new WSCtor(url);
}
