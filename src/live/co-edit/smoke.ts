// src/live/co-edit/smoke.ts
//
// Smoke for Wave 1 #4 (Realtime co-editing). Bun-runnable end-to-end
// exercise of the Yjs sync + awareness + autosave plumbing WITHOUT a
// Cloudflare Worker runtime or a Postgres database.
//
// Topology — fully in-process, no sockets, no network:
//
//   Client A  ───── MockSocket pair ─────►  StubSiteRoom  ◄───── MockSocket pair ─────  Client B
//
// The `StubSiteRoom` is a faithful re-implementation of the inbound message
// dispatch logic in `src/live/site-room.ts`, expressed against the same
// y-sync + awareness modules and the same SiteRoomMessage envelopes. We
// don't construct the real DurableObject because `cloudflare:workers` is
// not available outside `wrangler dev`.
//
// What the smoke proves (per plan §"Smoke"):
//   1. Two mock clients connect; sync handshake completes.
//   2. Client A inserts a TextElement; B receives the op <500ms.
//   3. decodeYDoc(A.doc) deep-equals decodeYDoc(B.doc).
//   4. B disconnects; A keeps editing; autosave fires; persisted state == A.
//   5. Fresh client C reconnects from `encodeYDoc(persisted)`; doc matches.
//   6. Awareness update from A is received by B with correct clientID.
//
// Exit code is non-zero on any failure; success prints a one-line summary
// per assertion so a failure narrows quickly.

import * as Y from 'yjs';

import type { CanvasSiteState, TextElement } from '../../canvas/schema.js';
import { decodeYDoc, encodeYDoc } from '../../canvas/yjs-projection.js';
import {
  type AwarenessUpdateEnvelope,
  type SiteRoomMessage,
  type YSyncStep1Envelope,
  type YSyncStep2Envelope,
  type YUpdateEnvelope,
  decodeBytesField,
  encodeBytesField,
} from '../site-room-protocol.js';

import {
  type Awareness,
  applyAwareness,
  createAwareness,
  encodeAwareness,
} from './awareness.js';
import {
  type WebSocketLike,
  connectCoEdit,
} from './client.js';
import {
  Y_SYNC_REMOTE_ORIGIN,
  encodeStateVector,
  handleSyncStep1,
  handleSyncStep2,
  handleYUpdate,
} from './y-sync.js';

// ----------------------------------------------------------------------------
// assertion harness
// ----------------------------------------------------------------------------

function assert(condition: boolean, label: string): void {
  if (!condition) {
    process.stderr.write(`[coedit:smoke] FAIL ${label}\n`);
    process.exit(1);
  }
  process.stdout.write(`[coedit:smoke] OK   ${label}\n`);
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  const a = stableStringify(actual);
  const e = stableStringify(expected);
  if (a !== e) {
    process.stderr.write(`[coedit:smoke] FAIL ${label}\n`);
    process.stderr.write(`  actual:   ${a.slice(0, 800)}\n`);
    process.stderr.write(`  expected: ${e.slice(0, 800)}\n`);
    process.exit(1);
  }
  process.stdout.write(`[coedit:smoke] OK   ${label}\n`);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// ----------------------------------------------------------------------------
// MockSocket — paired in-process socket. Mirrors the WebSocketLike surface so
// `connectCoEdit` accepts it without modification.
// ----------------------------------------------------------------------------

interface MockSocketEvents {
  open: Array<(ev: { data?: unknown }) => void>;
  message: Array<(ev: { data?: unknown }) => void>;
  close: Array<(ev: { data?: unknown }) => void>;
  error: Array<(ev: { data?: unknown }) => void>;
}

class MockSocket implements WebSocketLike {
  partner: MockSocket | null = null;
  private events: MockSocketEvents = { open: [], message: [], close: [], error: [] };
  private closed = false;

  send(data: string): void {
    if (this.closed) return;
    if (!this.partner) return;
    // Deliver asynchronously so the send/recv order matches a real socket.
    queueMicrotask(() => {
      if (this.partner && !this.partner.closed) {
        for (const h of this.partner.events.message) h({ data });
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => {
      for (const h of this.events.close) h({});
      if (this.partner && !this.partner.closed) {
        this.partner.close();
      }
    });
  }

  addEventListener(
    event: 'open' | 'message' | 'close' | 'error',
    handler: (ev: { data?: unknown }) => void,
  ): void {
    this.events[event].push(handler);
  }

  /** Synthesise an open event (the smoke calls this after pairing). */
  fireOpen(): void {
    queueMicrotask(() => {
      for (const h of this.events.open) h({});
    });
  }
}

function makeMockSocketPair(): { clientSide: MockSocket; serverSide: MockSocket } {
  const a = new MockSocket();
  const b = new MockSocket();
  a.partner = b;
  b.partner = a;
  return { clientSide: a, serverSide: b };
}

// ----------------------------------------------------------------------------
// StubSiteRoom — re-implementation of the DO inbound dispatch in-process.
// ----------------------------------------------------------------------------

class StubSiteRoom {
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<MockSocket> = new Set();
  /** Captured persisted state from the autosave hook. */
  lastPersisted: CanvasSiteState | null = null;
  /** Allow tests to await the next autosave flush. */
  pendingPersistResolvers: Array<(state: CanvasSiteState) => void> = [];
  private currentOriginSocket: MockSocket | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(initialState: CanvasSiteState, debounceMs: number) {
    this.doc = encodeYDoc(initialState);
    this.awareness = createAwareness(this.doc);
    this.debounceMs = debounceMs;

    // Wire the broadcast observer — every doc update fans out to all
    // sockets except the originating one. Matches the SiteRoom DO behaviour.
    this.doc.on('update', (update: Uint8Array) => {
      const envelope: YUpdateEnvelope = {
        type: 'y-update',
        update: encodeBytesField(update),
      };
      const msg = JSON.stringify(envelope);
      for (const s of this.sockets) {
        if (s === this.currentOriginSocket) continue;
        s.send(msg);
      }
      // Schedule a debounced persist — same shape as the autosave hook,
      // but the sink is the in-memory `lastPersisted` slot.
      this.scheduleAutosave();
    });

    this.awareness.on(
      'update',
      ({
        added,
        updated,
        removed,
      }: {
        added: number[];
        updated: number[];
        removed: number[];
      }) => {
        const changed = added.concat(updated).concat(removed);
        const update = encodeAwareness(this.awareness, changed);
        const envelope: AwarenessUpdateEnvelope = {
          type: 'awareness-update',
          update: encodeBytesField(update),
        };
        const msg = JSON.stringify(envelope);
        for (const s of this.sockets) {
          if (s === this.currentOriginSocket) continue;
          s.send(msg);
        }
      },
    );
  }

  private scheduleAutosave(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      const projected = decodeYDoc(this.doc);
      this.lastPersisted = projected;
      const resolvers = this.pendingPersistResolvers;
      this.pendingPersistResolvers = [];
      for (const r of resolvers) r(projected);
    }, this.debounceMs);
  }

  /** Promise that resolves on the next debounced persist. */
  nextPersist(): Promise<CanvasSiteState> {
    return new Promise((resolve) => {
      this.pendingPersistResolvers.push(resolve);
    });
  }

  attach(socket: MockSocket): void {
    this.sockets.add(socket);
    socket.addEventListener('message', (ev) => {
      this.handleMessage(socket, ev.data);
    });
    socket.addEventListener('close', () => {
      this.sockets.delete(socket);
    });
  }

  private handleMessage(socket: MockSocket, raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      process.stderr.write(`[stub-site-room] non-JSON ${String(error)}\n`);
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const env = parsed as SiteRoomMessage;
    this.currentOriginSocket = socket;
    try {
      switch (env.type) {
        case 'y-sync-step1': {
          const sv = decodeBytesField(env.stateVector);
          const reply: YSyncStep2Envelope = {
            type: 'y-sync-step2',
            update: encodeBytesField(handleSyncStep1(this.doc, sv)),
          };
          socket.send(JSON.stringify(reply));
          const ourStep1: YSyncStep1Envelope = {
            type: 'y-sync-step1',
            stateVector: encodeBytesField(encodeStateVector(this.doc)),
          };
          socket.send(JSON.stringify(ourStep1));
          // Ship awareness bootstrap for the new peer.
          const known = Array.from(this.awareness.getStates().keys());
          if (known.length > 0) {
            const update = encodeAwareness(this.awareness, known);
            const envelope: AwarenessUpdateEnvelope = {
              type: 'awareness-update',
              update: encodeBytesField(update),
            };
            socket.send(JSON.stringify(envelope));
          }
          return;
        }
        case 'y-sync-step2':
          handleSyncStep2(this.doc, decodeBytesField(env.update));
          return;
        case 'y-update':
          handleYUpdate(this.doc, decodeBytesField(env.update));
          return;
        case 'awareness-update':
          applyAwareness(this.awareness, decodeBytesField(env.update), Y_SYNC_REMOTE_ORIGIN);
          return;
        default:
          process.stderr.write(`[stub-site-room] unhandled ${String(env.type)}\n`);
      }
    } finally {
      this.currentOriginSocket = null;
    }
  }
}

// ----------------------------------------------------------------------------
// Helper: wait for a condition with timeout.
// ----------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      process.stderr.write(`[coedit:smoke] FAIL timed out waiting for ${label}\n`);
      process.exit(1);
    }
    await sleep(10);
  }
}

// ----------------------------------------------------------------------------
// Fixtures + scenario.
// ----------------------------------------------------------------------------

const initialState: CanvasSiteState = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'sec-1',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 600,
          elements: [],
        },
      ],
    },
  ],
};

const room = new StubSiteRoom(initialState, 80);

// ----------------------------------------------------------------------------
// Wire client A.
// ----------------------------------------------------------------------------

const pairA = makeMockSocketPair();
room.attach(pairA.serverSide);
const connA = connectCoEdit('site-smoke', initialState, {
  websocketUrl: 'mock://A',
  websocketFactory: () => pairA.clientSide,
  reconnectDelayMs: 99_999, // disable auto-reconnect for the smoke
});
// MockSocket needs an explicit open trigger so handlers attached after the
// constructor see the open event.
pairA.clientSide.fireOpen();

const remoteOnA: Array<CanvasSiteState> = [];
const presenceOnA: Array<Map<number, unknown>> = [];
connA.onRemoteState((s) => {
  remoteOnA.push(s);
});
connA.onRemotePresence((peers) => {
  presenceOnA.push(new Map(peers));
});

// ----------------------------------------------------------------------------
// Wire client B.
// ----------------------------------------------------------------------------

const pairB = makeMockSocketPair();
room.attach(pairB.serverSide);
const connB = connectCoEdit('site-smoke', initialState, {
  websocketUrl: 'mock://B',
  websocketFactory: () => pairB.clientSide,
  reconnectDelayMs: 99_999,
});
pairB.clientSide.fireOpen();

const remoteOnB: Array<CanvasSiteState> = [];
const presenceOnB: Array<Map<number, unknown>> = [];
connB.onRemoteState((s) => {
  remoteOnB.push(s);
});
connB.onRemotePresence((peers) => {
  presenceOnB.push(new Map(peers));
});

// Drain initial sync handshake.
await sleep(50);

// At this point both clients should hold the same doc + initial state.
assertDeepEqual(decodeYDoc(connA.doc), initialState, 'A doc matches initial state post-sync');
assertDeepEqual(decodeYDoc(connB.doc), initialState, 'B doc matches initial state post-sync');

// ----------------------------------------------------------------------------
// 1. Client A inserts a TextElement. Client B receives the op within 500ms.
// ----------------------------------------------------------------------------

const insertedAt = Date.now();
const newElement: TextElement = {
  id: 'tx-1',
  type: 'text',
  box: { x: 10, y: 20, w: 300, h: 60, z: 1 },
  content: [{ text: 'Hello from A' }],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};

const nextStateAfterA: CanvasSiteState = {
  ...initialState,
  pages: [
    {
      ...initialState.pages[0]!,
      sections: [
        {
          ...initialState.pages[0]!.sections[0]!,
          elements: [newElement],
        },
      ],
    },
  ],
};

connA.applyLocalState(nextStateAfterA);

await waitFor(() => {
  const projected = decodeYDoc(connB.doc);
  return projected.pages[0]?.sections[0]?.elements.length === 1;
}, 500, 'B receives A insert within 500ms');

const elapsedMs = Date.now() - insertedAt;
assert(elapsedMs < 500, `B received insert in ${String(elapsedMs)}ms (<500ms)`);

// 2. Project both docs and assert deep-equal.
assertDeepEqual(decodeYDoc(connA.doc), decodeYDoc(connB.doc), 'A and B projections match after insert');

// ----------------------------------------------------------------------------
// 3. Client B disconnects; A keeps editing; autosave fires; persisted state
//    matches A's doc.
// ----------------------------------------------------------------------------

connB.destroy();
await sleep(20);

const elementUpdated: TextElement = {
  ...newElement,
  content: [{ text: 'Hello from A — edited' }],
};
const stateAfterAEdit: CanvasSiteState = {
  ...nextStateAfterA,
  pages: [
    {
      ...nextStateAfterA.pages[0]!,
      sections: [
        {
          ...nextStateAfterA.pages[0]!.sections[0]!,
          elements: [elementUpdated],
        },
      ],
    },
  ],
};

const persistPromise = room.nextPersist();
connA.applyLocalState(stateAfterAEdit);
const persisted = await persistPromise;
assertDeepEqual(persisted, decodeYDoc(connA.doc), 'persisted state matches A doc post-edit');

// ----------------------------------------------------------------------------
// 4. Fresh client C reconnects via encodeYDoc(persisted); doc state matches.
// ----------------------------------------------------------------------------

// Simulate "cold start" — a new SiteRoom with the persisted state, and a
// fresh client connecting in.
const room2 = new StubSiteRoom(persisted, 80);
const pairC = makeMockSocketPair();
room2.attach(pairC.serverSide);
const connC = connectCoEdit('site-smoke', persisted, {
  websocketUrl: 'mock://C',
  websocketFactory: () => pairC.clientSide,
  reconnectDelayMs: 99_999,
});
pairC.clientSide.fireOpen();
await sleep(50);
assertDeepEqual(
  decodeYDoc(connC.doc),
  persisted,
  'fresh client C doc matches persisted state (cold-start recovery)',
);

// ----------------------------------------------------------------------------
// 5. Awareness update from A is received by B with correct clientID.
//
// We rebuild a fresh B-client against `room` so the awareness fan-out has a
// second connected peer. (connB was destroyed earlier.)
// ----------------------------------------------------------------------------

const pairB2 = makeMockSocketPair();
room.attach(pairB2.serverSide);
const connB2 = connectCoEdit('site-smoke', decodeYDoc(connA.doc), {
  websocketUrl: 'mock://B2',
  websocketFactory: () => pairB2.clientSide,
  reconnectDelayMs: 99_999,
});
pairB2.clientSide.fireOpen();
const presenceSeenByB2: Array<Map<number, unknown>> = [];
connB2.onRemotePresence((peers) => {
  presenceSeenByB2.push(new Map(peers));
});

await sleep(50);

const aClientId = connA.doc.clientID;
connA.setPresence({ name: 'Owner A', color: '#ff6600' });

await waitFor(
  () => presenceSeenByB2.some((m) => m.has(aClientId)),
  500,
  'B2 receives presence from A',
);

const seenPresence = presenceSeenByB2[presenceSeenByB2.length - 1];
assert(seenPresence !== undefined, 'presenceSeenByB2 has at least one entry');
const seenA = seenPresence!.get(aClientId) as { name?: string; color?: string } | undefined;
assert(seenA !== undefined, 'B2 sees presence keyed by A clientID');
assert(seenA!.name === 'Owner A', `presence name is "Owner A" (got ${String(seenA!.name)})`);
assert(seenA!.color === '#ff6600', `presence color is "#ff6600" (got ${String(seenA!.color)})`);

// ----------------------------------------------------------------------------
// Cleanup.
// ----------------------------------------------------------------------------

connA.destroy();
connB2.destroy();
connC.destroy();

process.stdout.write('[coedit:smoke] PASS\n');
process.exit(0);
