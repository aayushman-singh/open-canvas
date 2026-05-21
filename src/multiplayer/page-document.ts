// PageDocument — one Durable Object per page.
//
// Owns the live Y.Doc and the WebSocket connections of the editors currently
// pointing at this page. Uses the Hibernatable WebSocket API so the DO can
// be evicted between bursts of traffic without dropping connections.
//
// Wire protocol matches y-websocket so the browser can use the off-the-shelf
// WebsocketProvider client. Each binary frame begins with one byte:
//   0 = messageSync       (y-protocols/sync)
//   1 = messageAwareness  (y-protocols/awareness)
//
// Snapshot cadence: 50 ops OR 10s since last snapshot, whichever first.
// Time fence is enforced by a DO alarm so it fires even with no traffic.
//
// On boot: hydrate the Y.Doc from page.doc (Postgres). On WS upgrade: ship the
// current Y state to the connecting client (sync step 2 + awareness state).
//
// ADR 0001 decisions 4 + 5: agent reserves clientID = 1; editors get a
// random clientID assigned by Yjs (collision probability with 1 is 1/2^32, so
// we don't enforce — we just document and let new connections take a random
// id by leaving ydoc.clientID alone).

import { DurableObject } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { db } from '../db/client';
import { page } from '../db/schema';
import { hydrateYDoc, persistSnapshot, serializeYDoc } from './snapshot';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

const OPS_FENCE = 50;
const TIME_FENCE_MS = 10_000;

interface PageDocumentEnv {
  DATABASE_URL: string;
}

interface ConnectionAttachment {
  pageId: string;
  controlledIds: number[];
}

export class PageDocument extends DurableObject<PageDocumentEnv> {
  private ydoc: Y.Doc | null = null;
  private awareness: Awareness | null = null;
  private hydrated = false;
  private pageId: string | null = null;
  private opCount = 0;
  private lastSnapshotAt = 0;
  private snapshotInFlight = false;
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;
  private awarenessHandler:
    | ((
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: unknown,
      ) => void)
    | null = null;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const pageId = url.searchParams.get('pageId');
    if (!pageId) {
      return new Response('missing pageId', { status: 400 });
    }

    const upgradeHeader = request.headers.get('upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    await this.ensureHydrated(pageId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const ydoc = this.requireYDoc();
    const awareness = this.requireAwareness();

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      pageId,
      controlledIds: [],
    } satisfies ConnectionAttachment);

    // Sync step 1 from server -> peer kicks off the handshake; the peer
    // responds with sync step 2 carrying any updates the server doesn't have.
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, ydoc);
    server.send(encoding.toUint8Array(syncEncoder));

    // Push the full server state immediately so the peer has the latest doc.
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, ydoc);
    server.send(encoding.toUint8Array(stateEncoder));

    // Push current awareness state of all connected peers to the new peer.
    const awarenessClients = Array.from(awareness.getStates().keys());
    if (awarenessClients.length > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        encodeAwarenessUpdate(awareness, awarenessClients),
      );
      server.send(encoding.toUint8Array(awarenessEncoder));
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === 'string') {
      // y-protocol traffic is binary; ignore stray text frames.
      return;
    }
    if (!this.hydrated) {
      const attachment = ws.deserializeAttachment() as { pageId?: string } | null;
      const pageId = attachment?.pageId ?? this.pageId;
      if (!pageId) {
        ws.close(1011, 'page document not hydrated');
        return;
      }
      await this.ensureHydrated(pageId);
    }

    const ydoc = this.requireYDoc();
    const awareness = this.requireAwareness();
    const payload = new Uint8Array(message);
    const decoder = decoding.createDecoder(payload);
    const encoder = encoding.createEncoder();
    const kind = decoding.readVarUint(decoder);

    switch (kind) {
      case MESSAGE_SYNC: {
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws);
        // If readSyncMessage produced bytes beyond the leading varuint, ship
        // the reply back to the originating socket. syncMessageType is 0 for
        // step1 (needs a response) or 2 for step2/update (no immediate reply
        // beyond the bytes already written).
        if (encoding.length(encoder) > 1) {
          ws.send(encoding.toUint8Array(encoder));
        }
        if (syncMessageType === syncProtocol.messageYjsUpdate) {
          this.opCount += 1;
        }
        break;
      }
      case MESSAGE_AWARENESS: {
        const awarenessUpdate = decoding.readVarUint8Array(decoder);
        const before = new Set(awareness.getStates().keys());
        applyAwarenessUpdate(awareness, awarenessUpdate, ws);
        const after = awareness.getStates();
        const attachment = (ws.deserializeAttachment() as ConnectionAttachment) ?? {
          pageId: this.pageId ?? '',
          controlledIds: [],
        };
        const controlled = new Set(attachment.controlledIds);
        for (const [clientID] of after) {
          if (!before.has(clientID)) controlled.add(clientID);
        }
        // Treat all clientIDs added by this WS as ours; on close we remove them.
        // We also record any clientID we have already seen on this WS.
        if (controlled.size !== attachment.controlledIds.length) {
          ws.serializeAttachment({
            pageId: attachment.pageId,
            controlledIds: Array.from(controlled),
          } satisfies ConnectionAttachment);
        }
        break;
      }
      default: {
        // Unknown message type — fail loud (per repo policy: no silent skips).
        console.error('PageDocument: unknown wire message kind', kind);
        ws.close(1003, `unknown message kind ${kind}`);
        return;
      }
    }

    await this.maybeSnapshot();
  }

  override webSocketClose(ws: WebSocket): void {
    this.removeAwarenessForSocket(ws);
  }

  override webSocketError(ws: WebSocket, error: unknown): void {
    console.error('PageDocument WS error', error);
    this.removeAwarenessForSocket(ws);
  }

  override async alarm(): Promise<void> {
    if (this.hydrated) {
      const now = Date.now();
      if (this.opCount > 0 && now - this.lastSnapshotAt >= TIME_FENCE_MS) {
        await this.snapshot('alarm');
      }
    }
    const sockets = this.ctx.getWebSockets();
    if (sockets.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + TIME_FENCE_MS);
    }
  }

  private async ensureHydrated(pageId: string): Promise<void> {
    if (this.hydrated && this.pageId === pageId) {
      return;
    }
    if (this.hydrated && this.pageId !== pageId) {
      // A single DO instance is keyed by pageId via idFromName; mismatched
      // pageId here means someone is calling us wrong. Fail loud.
      throw new Error(
        `PageDocument hydrated for ${this.pageId} but received request for ${pageId}`,
      );
    }
    const database = db(this.env);
    const rows = await database
      .select({ doc: page.doc })
      .from(page)
      .where(eq(page.id, pageId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw new Error(`PageDocument: no page row for id ${pageId}`);
    }
    this.ydoc = hydrateYDoc(row.doc);
    this.awareness = new Awareness(this.ydoc);
    this.awareness.setLocalState(null);
    this.pageId = pageId;
    this.opCount = 0;
    this.lastSnapshotAt = Date.now();
    this.hydrated = true;
    this.wireBroadcast();
    await this.ctx.storage.setAlarm(Date.now() + TIME_FENCE_MS);
  }

  private wireBroadcast(): void {
    const ydoc = this.requireYDoc();
    const awareness = this.requireAwareness();

    this.updateHandler = (update, origin) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const bytes = encoding.toUint8Array(encoder);
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === origin) continue;
        try {
          ws.send(bytes);
        } catch (err) {
          console.error('PageDocument broadcast send failed', err);
        }
      }
    };
    ydoc.on('update', this.updateHandler);

    this.awarenessHandler = ({ added, updated, removed }, origin) => {
      const changedClients = [...added, ...updated, ...removed];
      if (changedClients.length === 0) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(awareness, changedClients));
      const bytes = encoding.toUint8Array(encoder);
      for (const ws of this.ctx.getWebSockets()) {
        if (ws === origin) continue;
        try {
          ws.send(bytes);
        } catch (err) {
          console.error('PageDocument awareness send failed', err);
        }
      }
    };
    awareness.on('update', this.awarenessHandler);
  }

  private removeAwarenessForSocket(ws: WebSocket): void {
    if (!this.awareness) return;
    const attachment = ws.deserializeAttachment() as ConnectionAttachment | null;
    const ids = attachment?.controlledIds ?? [];
    if (ids.length === 0) return;
    // The awareness `update` listener wired in wireBroadcast() will broadcast
    // the removal to all surviving peers.
    removeAwarenessStates(this.awareness, ids, ws);
  }

  private async maybeSnapshot(): Promise<void> {
    if (!this.hydrated) return;
    const now = Date.now();
    if (this.opCount >= OPS_FENCE || now - this.lastSnapshotAt >= TIME_FENCE_MS) {
      await this.snapshot(this.opCount >= OPS_FENCE ? 'op-fence' : 'time-fence');
    }
  }

  private async snapshot(reason: 'op-fence' | 'time-fence' | 'alarm'): Promise<void> {
    if (this.snapshotInFlight) return;
    if (!this.hydrated || !this.pageId) return;
    const ydoc = this.requireYDoc();
    this.snapshotInFlight = true;
    const env = this.env;
    const pageId = this.pageId;
    try {
      const doc = serializeYDoc(ydoc);
      await persistSnapshot(env, pageId, doc);
      this.opCount = 0;
      this.lastSnapshotAt = Date.now();
    } catch (err) {
      console.error(`PageDocument snapshot failed (${reason})`, err);
      // One retry on failure, then surface — per repo policy, no silent retry chain.
      try {
        const doc = serializeYDoc(ydoc);
        await persistSnapshot(env, pageId, doc);
        this.opCount = 0;
        this.lastSnapshotAt = Date.now();
      } catch (retryErr) {
        console.error('PageDocument snapshot retry failed', retryErr);
      }
    } finally {
      this.snapshotInFlight = false;
    }
  }

  private requireYDoc(): Y.Doc {
    if (!this.ydoc) {
      throw new Error('PageDocument: Y.Doc accessed before hydration');
    }
    return this.ydoc;
  }

  private requireAwareness(): Awareness {
    if (!this.awareness) {
      throw new Error('PageDocument: Awareness accessed before hydration');
    }
    return this.awareness;
  }
}
