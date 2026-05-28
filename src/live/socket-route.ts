// GET /__live — WebSocket upgrade endpoint for the live editor session. The
// caller (canvas-client.ts) opens a WS to this path with ?siteId + ?wsToken;
// we verify the edit-token, check the customer's site access, then hand the
// upgrade off to the SiteRoom DurableObject for that site id.
//
// The /__live path is mounted on the app entry rather than on /__api/* on
// purpose: the WS handshake header set differs from the JSON-RPC traffic
// /__api/* expects, and the public-host router treats /__live as a "pass to
// the worker" path the same way it does /__api/*.

import { Hono } from 'hono';
import { db } from '../db/client';
import { verifyEditToken } from '../auth/edit-token';
import { hasLiveEditorSocketAccess } from './editor-auth';

interface Bindings {
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
  SITE_ROOM: DurableObjectNamespace;
}

const socketRoute = new Hono<{ Bindings: Bindings }>();

socketRoute.get('/', async (c) => {
  const siteId = c.req.query('siteId');
  if (!siteId || !/^[A-Za-z0-9-]+$/.test(siteId)) {
    return c.text('site not found', 404);
  }

  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') {
    return c.text('expected websocket upgrade', 426);
  }

  const wsToken = c.req.query('wsToken');
  const payload = await verifyEditToken(wsToken, c.env.UNLOCK_SIGNING_SECRET);
  if (!payload || payload.siteId !== siteId) {
    return c.text('unauthorized', 401);
  }

  const database = db(c.env);
  const hasAccess = await hasLiveEditorSocketAccess(database, siteId, payload.customerId);
  if (!hasAccess) {
    return c.text('unauthorized', 401);
  }

  const id = c.env.SITE_ROOM.idFromName(siteId);
  const stub = c.env.SITE_ROOM.get(id);
  // The DurableObject stub takes a Request whose URL it never resolves —
  // it's just a carrier for path + query + headers. RFC 2606 reserves the
  // `.invalid` TLD specifically for cases like this where a syntactically
  // valid URL is required but DNS resolution must not happen.
  return stub.fetch(
    new Request(`https://do.invalid/socket?siteId=${encodeURIComponent(siteId)}&role=editor`, {
      method: 'GET',
      headers: c.req.raw.headers,
    }),
  );
});

export default socketRoute;
