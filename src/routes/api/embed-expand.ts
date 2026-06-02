// src/routes/api/embed-expand.ts
//
// POST /api/embed/expand-shortlink
//
// Server-side resolver for URL shortener short links. Used by the editor's
// embed inspector to turn a Google Maps "Share" sheet URL
// (`https://maps.app.goo.gl/...`) into the canonical
// `https://www.google.com/maps/...` form before saving. Without this hop the
// browser tries to frame the short link, follows the 30x to the full Google
// Maps app page, and the destination's X-Frame-Options header refuses the
// frame - the iframe renders blank with "This content is blocked."
//
// Why a route instead of expanding inline in canvas-client?
//
//   - The editor IIFE runs in the browser; cross-origin HEAD requests to
//     maps.app.goo.gl are CORS-blocked. The expansion has to happen
//     server-side.
//   - The pure expansion logic in src/embed/expand-short-link.ts is shared
//     with publish-time and any future render-time hooks; this route is
//     just the HTTP edge.

import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import { expandShortLink, isShortLinkUrl } from '../../embed/expand-short-link';

type Env = { Bindings: object; Variables: ClerkAuthVariables };

const embedExpandRoute = new Hono<Env>();

embedExpandRoute.use('*', clerkAuth());
embedExpandRoute.use('*', requireAuth());

embedExpandRoute.post('/expand-shortlink', async (c) => {
  let body: { url?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'request body must be JSON' }, 400);
  }
  const url = body.url;
  if (typeof url !== 'string' || url.length === 0) {
    return c.json({ ok: false, error: 'url must be a non-empty string' }, 400);
  }
  if (url.length > 2048) {
    return c.json({ ok: false, error: 'url too long (cap 2048 chars)' }, 400);
  }
  if (!isShortLinkUrl(url)) {
    // No-op: caller can hit this unconditionally. We tell them nothing
    // happened by echoing the URL and a hops count of 0.
    return c.json({ ok: true, finalUrl: url, hops: 0 });
  }
  const result = await expandShortLink(url);
  if (!result.ok) {
    // 502 because we tried to fulfil the request but the upstream short-link
    // host either timed out, didn't return a Location header, or chained
    // past our redirect cap. The author can still save the raw URL - the
    // embed just won't render until they fix it.
    return c.json({ ok: false, error: result.error }, 502);
  }
  return c.json({ ok: true, finalUrl: result.finalUrl, hops: result.hops });
});

export default embedExpandRoute;
