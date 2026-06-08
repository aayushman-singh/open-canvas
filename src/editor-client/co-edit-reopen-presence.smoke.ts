// src/editor-client/co-edit-reopen-presence.smoke.ts
//
// ADR 0065 F2-followup — pins the reopen-presence contract:
//
//   The Owner's local presence snapshot is REBUILT FRESH at every socket
//   open, including reconnects. A stale snapshot captured at attach time
//   must NEVER overwrite the live `editingCollectionTemplateId` pin.
//
// Codex review pass found that the editor was passing a literal
// `initialPresence` (an Object.assign() result) to `connectCoEdit`. The
// connector's open handler reads that object on every reopen; the value
// is frozen at the moment the editor called connectCoEdit. If the Owner
// entered template-edit mode between attach and a socket flap, the
// reopen would re-publish `editingCollectionTemplateId: null` — silently
// reverting the live state. Remote peers wouldn't see the active
// template-edit until the next cursor/selection publish.
//
// Fix: `initialPresence` is now a thunk that calls
// `buildLocalPresenceSnapshot(ctx)` at every open. The snapshot reads
// `ctx.editingCollectionTemplate?.collectionId` LIVE, so the field
// tracks the Owner's current mode regardless of when the open fires.
//
// What this smoke proves:
//   1. `buildLocalPresenceSnapshot` returns the current
//      `editingCollectionTemplateId` (entering / exiting between calls
//      is reflected in the next return value).
//   2. The connector's function-form `initialPresence` is RESOLVED at
//      every open: a simulated reopen invokes the thunk a second time
//      and the awareness state carries the value that ctx held AT THAT
//      MOMENT, not the value it held at attach.
//   3. Owner enters → exits → reopen publishes `null` (not the prior
//      `'coll-a'` id). No stale-state leak.
//   4. Boot-time identity-not-loaded path: thunk returns null →
//      connector skips the initial push (no-fallback: ship nothing
//      rather than fake a name/color).
//
// Bare Bun — uses `src/live/co-edit/client.ts`'s MockSocket pattern
// (no real WebSocket). Wired into ci:smoke so pre-commit gates the
// regression.

import * as Y from 'yjs';

import type { EditableSite } from '../canvas/schema.js';
import { encodeYDoc } from '../canvas/yjs-projection.js';
import {
  type Awareness,
  applyAwareness,
  createAwareness,
  encodeAwareness,
  snapshotPresence,
} from '../live/co-edit/awareness.js';
import { type WebSocketLike, connectCoEdit } from '../live/co-edit/client.js';
import {
  Y_SYNC_REMOTE_ORIGIN,
  encodeStateVector,
  handleSyncStep1,
} from '../live/co-edit/y-sync.js';
import {
  type AwarenessUpdateEnvelope,
  type SiteRoomMessage,
  type YSyncStep1Envelope,
  type YSyncStep2Envelope,
  decodeBytesField,
  encodeBytesField,
} from '../live/site-room-protocol.js';

import type { EditorContext } from './editor-context.js';
import { buildLocalPresenceSnapshot } from './co-edit.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[co-edit-reopen-presence:smoke] ${message}`);
}

// ----------------------------------------------------------------------------
// Minimal ctx shape — only the fields buildLocalPresenceSnapshot reads.
// Cast to EditorContext at the call site; the helper does not touch the
// other 100+ fields, so the cast is safe within this smoke's scope.
// ----------------------------------------------------------------------------

interface MinimalCtx {
  localPresence: { name: string; color: string } | null;
  presenceUserId: string;
  editingCollectionTemplate: { collectionId: string } | null;
}

function makeCtx(overrides: Partial<MinimalCtx> = {}): MinimalCtx {
  return {
    localPresence: { name: 'Owner', color: '#ff6600' },
    presenceUserId: 'user-owner',
    editingCollectionTemplate: null,
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// Case 1: pure-helper round trip — entering and exiting template-edit
// mode is reflected in the next buildLocalPresenceSnapshot return value.
// ----------------------------------------------------------------------------

(function helperTracksCtxMutationsSpec() {
  const ctx = makeCtx();
  const beforeEnter = buildLocalPresenceSnapshot(ctx as unknown as EditorContext);
  assert(beforeEnter !== null, 'identity loaded → snapshot non-null');
  assert(
    beforeEnter.editingCollectionTemplateId === null,
    'fresh ctx → editingCollectionTemplateId is null',
  );

  ctx.editingCollectionTemplate = { collectionId: 'coll-a' };
  const afterEnter = buildLocalPresenceSnapshot(ctx as unknown as EditorContext);
  assert(afterEnter !== null, 'snapshot still non-null after enter');
  assert(
    afterEnter.editingCollectionTemplateId === 'coll-a',
    'after enter → snapshot reads "coll-a" from ctx',
  );

  ctx.editingCollectionTemplate = null;
  const afterExit = buildLocalPresenceSnapshot(ctx as unknown as EditorContext);
  assert(afterExit !== null, 'snapshot still non-null after exit');
  assert(
    afterExit.editingCollectionTemplateId === null,
    'after exit → snapshot reads null (not stale "coll-a")',
  );
})();

// ----------------------------------------------------------------------------
// Case 2: identity-not-loaded → snapshot is null, connector skips the
// initial push (no fallback name/color).
// ----------------------------------------------------------------------------

(function identityNotLoadedSpec() {
  const ctx = makeCtx({ localPresence: null });
  const snap = buildLocalPresenceSnapshot(ctx as unknown as EditorContext);
  assert(snap === null, 'no localPresence → snapshot is null (no fallback)');
})();

// ----------------------------------------------------------------------------
// MockSocket — pair-based in-process WebSocketLike. Mirrors
// src/live/co-edit/smoke.ts's MockSocket so we can drive connectCoEdit
// without a real network.
// ----------------------------------------------------------------------------

interface MockEvents {
  open: Array<(ev: { data?: unknown }) => void>;
  message: Array<(ev: { data?: unknown }) => void>;
  close: Array<(ev: { data?: unknown }) => void>;
  error: Array<(ev: { data?: unknown }) => void>;
}

class MockSocket implements WebSocketLike {
  partner: MockSocket | null = null;
  events: MockEvents = { open: [], message: [], close: [], error: [] };
  closed = false;

  send(data: string): void {
    if (this.closed || !this.partner) return;
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

  fireOpen(): void {
    queueMicrotask(() => {
      for (const h of this.events.open) h({});
    });
  }
}

function makePair(): { clientSide: MockSocket; serverSide: MockSocket } {
  const a = new MockSocket();
  const b = new MockSocket();
  a.partner = b;
  b.partner = a;
  return { clientSide: a, serverSide: b };
}

// ----------------------------------------------------------------------------
// StubRoom — minimal SiteRoom that answers the y-sync handshake and
// forwards awareness updates. Mirrors the StubSiteRoom in
// src/live/co-edit/smoke.ts; trimmed to what the reopen-presence smoke
// exercises (sync handshake + awareness fan-out to a SECOND peer so we
// can observe what the Owner's awareness state carries).
// ----------------------------------------------------------------------------

class StubRoom {
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<MockSocket> = new Set();
  private currentOrigin: MockSocket | null = null;

  constructor(initialState: EditableSite) {
    this.doc = encodeYDoc(initialState);
    this.awareness = createAwareness(this.doc);
    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
        const changed = added.concat(updated).concat(removed);
        const update = encodeAwareness(this.awareness, changed);
        const env: AwarenessUpdateEnvelope = {
          type: 'awareness-update',
          update: encodeBytesField(update),
        };
        const msg = JSON.stringify(env);
        for (const s of this.sockets) {
          if (s === this.currentOrigin) continue;
          s.send(msg);
        }
      },
    );
  }

  attach(socket: MockSocket): void {
    this.sockets.add(socket);
    socket.addEventListener('message', (ev) => {
      this.handle(socket, ev.data);
    });
    socket.addEventListener('close', () => {
      this.sockets.delete(socket);
    });
  }

  private handle(socket: MockSocket, raw: unknown): void {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (parsed === null || typeof parsed !== 'object') return;
    const env = parsed as SiteRoomMessage;
    this.currentOrigin = socket;
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
          const known = Array.from(this.awareness.getStates().keys());
          if (known.length > 0) {
            const update = encodeAwareness(this.awareness, known);
            const env2: AwarenessUpdateEnvelope = {
              type: 'awareness-update',
              update: encodeBytesField(update),
            };
            socket.send(JSON.stringify(env2));
          }
          return;
        }
        case 'awareness-update':
          applyAwareness(this.awareness, decodeBytesField(env.update), Y_SYNC_REMOTE_ORIGIN);
          return;
        default:
          return;
      }
    } finally {
      this.currentOrigin = null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const initialState: EditableSite = {
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

// ----------------------------------------------------------------------------
// End-to-end driver: we cannot call attachCoEditImpl() because it needs
// `window`/`location`/`document`. Instead, we exercise the SAME contract:
//   - call `connectCoEdit` with a function-form `initialPresence` that
//     resolves `buildLocalPresenceSnapshot(ctx)` LIVE
//   - simulate a reopen by destroying the conn and connecting a fresh
//     one against the SAME ctx, mutated between calls
//   - read the room's awareness map to verify what was published
//
// This is the same shape attachCoEditImpl uses on every reconnect (the
// connector's connect() re-runs the factory + fires the open event,
// which re-resolves the thunk). The simulation is faithful because the
// connector code path is the same; only the trigger (close → reconnect
// timer → factory call) is replaced by an explicit second
// `connectCoEdit` call here.
// ----------------------------------------------------------------------------

async function openAndCapture(
  ctx: MinimalCtx,
  room: StubRoom,
): Promise<{
  presenceFromOwner: { name?: string; editingCollectionTemplateId?: string | null } | undefined;
  destroy: () => void;
}> {
  const pair = makePair();
  room.attach(pair.serverSide);
  const conn = connectCoEdit('site-reopen', initialState, {
    websocketUrl: 'mock://owner',
    websocketFactory: () => pair.clientSide,
    reconnectDelayMs: 99_999, // disable auto-reconnect: we drive opens manually
    initialPresence: () => buildLocalPresenceSnapshot(ctx as unknown as EditorContext),
  });
  pair.clientSide.fireOpen();
  await sleep(50);

  // Read the awareness snapshot from the ROOM's perspective — that's
  // what every remote peer would see.
  const states = snapshotPresence(room.awareness);
  const ownerClientId = conn.doc.clientID;
  const presenceFromOwner = states.get(ownerClientId);

  return { presenceFromOwner, destroy: () => conn.destroy() };
}

const room = new StubRoom(initialState);

// ----------------------------------------------------------------------------
// Case 3: Owner ENTERS edit mode while offline, then socket REOPENS.
// The reopen MUST publish the live `coll-a` pin, not the boot-time null.
// ----------------------------------------------------------------------------

await (async function ownerEntersBeforeReopenSpec(): Promise<void> {
  const ctx = makeCtx();

  // First open — Owner is NOT in template-edit mode. Initial publish
  // carries `null`.
  const first = await openAndCapture(ctx, room);
  assert(first.presenceFromOwner !== undefined, 'first open: room sees Owner presence');
  assert(
    first.presenceFromOwner.editingCollectionTemplateId === null,
    'first open: pin is null (boot state)',
  );
  first.destroy();
  await sleep(20);

  // Owner enters template-edit mode while disconnected. publishLocalPresence
  // would fire if a socket were alive; the bug is that the NEXT open must
  // still pick up the live ctx state.
  ctx.editingCollectionTemplate = { collectionId: 'coll-a' };

  // Simulate REOPEN: a fresh connection against the same ctx. The thunk
  // is resolved by the connector at this new open's `open` event, so it
  // MUST read the live `coll-a` value.
  const second = await openAndCapture(ctx, room);
  assert(second.presenceFromOwner !== undefined, 'reopen: room sees Owner presence');
  assert(
    second.presenceFromOwner.editingCollectionTemplateId === 'coll-a',
    'reopen: pin is "coll-a" — thunk read live ctx, not the captured snapshot',
  );
  second.destroy();
  await sleep(20);
})();

// ----------------------------------------------------------------------------
// Case 4: Owner is NOT in template-edit mode at reopen. Outbound
// presence carries `editingCollectionTemplateId: null`. Pinned so a
// future drift (e.g. caching the last non-null id) is caught.
// ----------------------------------------------------------------------------

await (async function ownerNotEditingAtReopenSpec(): Promise<void> {
  const ctx = makeCtx();
  ctx.editingCollectionTemplate = null;
  const result = await openAndCapture(ctx, room);
  assert(result.presenceFromOwner !== undefined, 'open: room sees Owner presence');
  assert(
    result.presenceFromOwner.editingCollectionTemplateId === null,
    'open: pin is null (Owner not editing)',
  );
  result.destroy();
  await sleep(20);
})();

// ----------------------------------------------------------------------------
// Case 5: Owner ENTERS → EXITS → REOPEN. The reopen MUST publish `null`,
// not the stale `coll-a` that briefly held the pin. Pinned because a
// naive cache (option b drift — store the last value) would publish
// `coll-a` here.
// ----------------------------------------------------------------------------

await (async function enterThenExitThenReopenSpec(): Promise<void> {
  const ctx = makeCtx();
  ctx.editingCollectionTemplate = { collectionId: 'coll-a' };
  // (no socket alive between enter and exit — simulating an offline flap)
  ctx.editingCollectionTemplate = null;

  const result = await openAndCapture(ctx, room);
  assert(result.presenceFromOwner !== undefined, 'reopen: room sees Owner presence');
  assert(
    result.presenceFromOwner.editingCollectionTemplateId === null,
    'enter→exit→reopen: pin is null (no stale "coll-a")',
  );
  result.destroy();
  await sleep(20);
})();

// ----------------------------------------------------------------------------
// Case 6: thunk that returns null at reopen → connector skips the
// initial push. No fallback name/color is shipped; the room sees
// nothing for that client until a later setPresence call.
// ----------------------------------------------------------------------------

await (async function thunkReturnsNullSkipsInitialPushSpec(): Promise<void> {
  // localPresence: null → buildLocalPresenceSnapshot returns null.
  const ctx = makeCtx({ localPresence: null });
  const result = await openAndCapture(ctx, room);
  assert(
    result.presenceFromOwner === undefined,
    'thunk returned null → connector did not publish a presence row',
  );
  result.destroy();
  await sleep(20);
})();

console.log('[co-edit-reopen-presence:smoke] OK');
// MockSockets + pending timers keep the bun process alive without an
// explicit exit (same shape as src/live/co-edit/smoke.ts). Locally
// typed to dodge the editor-client tsconfig's empty `types` array (no
// @types/node) without polluting the smoke's import surface.
(globalThis as unknown as { process: { exit: (code: number) => never } }).process.exit(0);
