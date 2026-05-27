// src/auth/refresh-route.ts
//
// POST /__api/edit-token/refresh
//
// Proactive edit-token refresh endpoint. Called by the canvas editor client
// ~15 minutes before the current token expires. Reads the existing edit token
// cookie, verifies it is still valid, then issues a fresh token with a new
// 4-hour TTL and sets it as a cookie. Returns { ok: true, ttl: <seconds> }
// so the client can schedule the next refresh.

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { ClerkAuthVariables } from './middleware';
import {
  verifyEditToken,
  signEditToken,
  EDIT_TOKEN_COOKIE,
  EDIT_TOKEN_MAX_AGE,
} from './edit-token';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  UNLOCK_SIGNING_SECRET: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const refreshRoute = new Hono<Env>();

refreshRoute.post('/refresh', async (c) => {
  const token = getCookie(c, EDIT_TOKEN_COOKIE);
  const payload = await verifyEditToken(token, c.env.UNLOCK_SIGNING_SECRET);
  if (!payload) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const fresh = await signEditToken(
    {
      siteId: payload.siteId,
      customerId: payload.customerId,
      clerkUserId: payload.clerkUserId,
    },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = [
    `${EDIT_TOKEN_COOKIE}=${fresh}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${EDIT_TOKEN_MAX_AGE}`,
  ].join('; ');

  return c.json({ ok: true, ttl: EDIT_TOKEN_MAX_AGE }, 200, {
    'Set-Cookie': cookieValue,
  });
});

export default refreshRoute;
