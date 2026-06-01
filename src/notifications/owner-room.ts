// src/notifications/owner-room.ts
//
// NotificationOwnerRoom Durable Object per ADR 0043 decision 4. One instance
// per Customer (key = customer id). Acts as a pub-sub hub for SSE streams
// the Customer's open dashboard / editor tabs hold against
// GET /api/notifications/stream.
//
// Two HTTP paths:
//
//   GET  /subscribe?clientId=...
//        → 200 text/event-stream. The body stays open. Each event payload is
//          a `notification` or `read-state-changed` line carrying the row id
//          (clients call /api/notifications?since=... to backfill the
//          payload, per ADR dec 4's Last-Event-ID reconnect contract — we
//          intentionally do not buffer payloads in the DO).
//
//   POST /push  body { kind: 'notification' | 'read-state-changed', id }
//        → 200 { subscriberCount }. The writer fires this once per recipient
//          when a row commits or its read-state flips.
//
// No persistent storage. Subscriber map is in-memory; on isolate restart
// every SSE stream drops and reconnects fresh — the ReadableStream's `cancel`
// callback runs on disconnect and removes the subscriber.
//
// Heartbeat every 25s keeps intermediate proxies from culling the connection.

export interface OwnerRoomPushBody {
  kind: 'notification' | 'read-state-changed';
  id: string;
}

import { DurableObject } from 'cloudflare:workers';

const HEARTBEAT_MS = 25_000;

export class NotificationOwnerRoom extends DurableObject<unknown> {
  private subscribers: Map<string, ReadableStreamDefaultController<Uint8Array>> = new Map();
  private heartbeats: Map<string, ReturnType<typeof setInterval>> = new Map();
  private encoder = new TextEncoder();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/subscribe' && request.method === 'GET') {
      return Promise.resolve(this.handleSubscribe(request));
    }
    if (url.pathname === '/push' && request.method === 'POST') {
      return await this.handlePush(request);
    }
    return new Response('not found', { status: 404 });
  }

  private handleSubscribe(request: Request): Response {
    const url = new URL(request.url);
    const clientId = url.searchParams.get('clientId') ?? crypto.randomUUID();

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.subscribers.set(clientId, controller);
        // Opening comment line so the client knows the stream is alive.
        controller.enqueue(this.encoder.encode(`: connected ${clientId}\n\n`));
        const interval = setInterval(() => {
          try {
            controller.enqueue(this.encoder.encode(`: heartbeat\n\n`));
          } catch {
            this.removeSubscriber(clientId);
          }
        }, HEARTBEAT_MS);
        this.heartbeats.set(clientId, interval);
      },
      cancel: () => {
        this.removeSubscriber(clientId);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      },
    });
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
    const line = `event: ${body.kind}\ndata: ${JSON.stringify({ id: body.id })}\n\n`;
    const encoded = this.encoder.encode(line);
    let delivered = 0;
    for (const [clientId, controller] of this.subscribers) {
      try {
        controller.enqueue(encoded);
        delivered += 1;
      } catch {
        this.removeSubscriber(clientId);
      }
    }
    return Response.json({ ok: true, subscriberCount: delivered });
  }

  private removeSubscriber(clientId: string): void {
    const interval = this.heartbeats.get(clientId);
    if (interval !== undefined) {
      clearInterval(interval);
      this.heartbeats.delete(clientId);
    }
    this.subscribers.delete(clientId);
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
