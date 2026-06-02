// src/notifications/owner-room.ts
//
// NotificationOwnerRoom Durable Object per ADR 0043 decision 4. One instance
// per Customer (key = customer id). Acts as a pub-sub hub for live
// notification delivery to the Customer's open dashboard / editor tabs.
//
// Two HTTP paths:
//
//   GET  /subscribe  (with `upgrade: websocket` header)
//        → 101 Switching Protocols. The WebSocket stays open. The DO accepts
//          the socket via the Hibernation API (`ctx.acceptWebSocket`) so the
//          isolate hibernates between pushes — duration billing only applies
//          while pushes / handshakes are actively running, not for the idle
//          time clients hold the connection. Each delivered frame is a JSON
//          object `{ kind: 'notification' | 'read-state-changed', id }`;
//          clients call /api/notifications?since=... to backfill on reconnect,
//          per ADR dec 4's no-buffer-in-DO contract.
//
//   POST /push  body { kind: 'notification' | 'read-state-changed', id }
//        → 200 { subscriberCount }. The writer fires this once per recipient
//          when a row commits or its read-state flips. Iterates the
//          hibernation-tracked socket set and sends one JSON frame per peer.
//
// No persistent storage. Hibernation tracks the live socket set; on isolate
// restart Cloudflare re-attaches the WebSockets transparently and the
// client's reconnect path backfills any rows that landed during the gap.
//
// Prior version held subscribers in a setInterval-driven SSE map, which kept
// the isolate active 24/7 while any tab was open and burned DO duration.
// Switching to the WebSocket Hibernation API is the architectural fix called
// out in the post-mortem on the 2026-06-02 duration cap email.

export interface OwnerRoomPushBody {
  kind: 'notification' | 'read-state-changed';
  id: string;
}

import { DurableObject } from 'cloudflare:workers';

export class NotificationOwnerRoom extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname === '/subscribe' &&
      request.method === 'GET' &&
      request.headers.get('upgrade') === 'websocket'
    ) {
      return Promise.resolve(this.handleSubscribe());
    }
    if (url.pathname === '/push' && request.method === 'POST') {
      return await this.handlePush(request);
    }
    return new Response('not found', { status: 404 });
  }

  private handleSubscribe(): Response {
    const pair = new WebSocketPair();
    // acceptWebSocket is the hibernation entry point — once called, the DO
    // can fully hibernate between requests and the runtime re-injects the
    // socket on wake via webSocketMessage / webSocketClose / webSocketError.
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async handlePush(request: Request): Promise<Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid JSON body' }, { status: 400 });
    }
    if (!isOwnerRoomPushBody(body)) {
      return Response.json({ error: 'invalid push body' }, { status: 400 });
    }
    const payload = JSON.stringify({ kind: body.kind, id: body.id });
    let delivered = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
        delivered += 1;
      } catch {
        // Hibernation API surfaces sends to dead sockets as throws. close()
        // is the documented cleanup — the runtime then drops the socket
        // from getWebSockets().
        try {
          ws.close(1011, 'send failed');
        } catch {
          // Already torn down — drop silently.
        }
      }
    }
    return Response.json({ ok: true, subscriberCount: delivered });
  }

  // Hibernation API handlers. We do not expect inbound frames — clients only
  // listen. Overriding these is required so the runtime knows the class
  // implements the hibernation contract; the bodies stay no-ops because
  // `getWebSockets()` already reflects the live set and close/error events
  // are observed via the next push attempt.
  override webSocketMessage(): void {
    // Inbound frames ignored — the wire protocol is server → client only.
  }

  override webSocketClose(): void {
    // No bookkeeping needed; getWebSockets() reflects the current set.
  }

  override webSocketError(): void {
    // Same as close — no bookkeeping needed.
  }
}

function isOwnerRoomPushBody(value: unknown): value is OwnerRoomPushBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { kind?: unknown; id?: unknown };
  if (v.kind !== 'notification' && v.kind !== 'read-state-changed') return false;
  if (typeof v.id !== 'string' || v.id.length === 0) return false;
  return true;
}

// Type-only marker for the binding namespace in env. Lets callers declare
// `NOTIFICATION_OWNER_ROOM: DurableObjectNamespace<NotificationOwnerRoomMarker>`
// without exposing the class internals.
export type NotificationOwnerRoomMarker = NotificationOwnerRoom;
