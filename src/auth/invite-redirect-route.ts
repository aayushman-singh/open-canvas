// src/auth/invite-redirect-route.ts
//
// Stable invite landing page on the main domain. Invitation emails point
// here instead of at a specific published subdomain, so an owner renaming
// their subdomain after the email is sent doesn't break pending links.
//
// Flow:
//   /__invite?token=<jwt>
//     -> verify token (signature + exp + invite-shape)
//     -> look up site by id (NOT by stale subdomain in the email)
//     -> 302 to https://<currentSubdomain>.<apex>/__accept-invite?token=<jwt>
//     -> the subdomain handler in src/routes/public.ts:handleAcceptInvite
//        does the actual acceptedAt UPDATE and edit-cookie issue.

import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { verifyInviteToken } from './invite-token';
import { buildInviteErrorResponse } from './invite-error-page';
import { db } from '../db/client';
import { site } from '../db/schema';
import { appDomain, type HostConfigEnv } from '../host-config';

type Bindings = HostConfigEnv & {
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
};

const inviteRedirectRoute = new Hono<{ Bindings: Bindings }>();

inviteRedirectRoute.get('/', async (c) => {
  const token = new URL(c.req.url).searchParams.get('token');
  const result = await verifyInviteToken(token, c.env.UNLOCK_SIGNING_SECRET);
  if (!result.ok) {
    return buildInviteErrorResponse(result.reason);
  }

  const database = db(c.env);
  const rows = await database
    .select({ subdomain: site.subdomain })
    .from(site)
    .where(eq(site.id, result.payload.siteId))
    .limit(1);

  const subdomain = rows[0]?.subdomain;
  if (!subdomain) {
    return buildInviteErrorResponse('site-missing');
  }

  // Pass the same token through — the subdomain handler re-verifies it,
  // so there's no need (and no benefit) to re-sign.
  const target = `https://${subdomain}.${appDomain(c.env)}/__accept-invite?token=${encodeURIComponent(
    token ?? '',
  )}`;
  return c.redirect(target, 302);
});

export default inviteRedirectRoute;
