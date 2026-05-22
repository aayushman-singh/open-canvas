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

import { DurableObject } from 'cloudflare:workers';

interface BroadcastPayload {
  version: number;
  html: string;
}

export class SiteRoom extends DurableObject<unknown> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.json<BroadcastPayload>();
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
