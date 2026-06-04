// src/routes/public.ts
//
// Public host router for Published Sites.
//
// Inspects the request host. If it matches `<subdomain>.<APP_DOMAIN>`
// we own the request: load the site by subdomain, serve either the rendered
// snapshot (any path) or upgrade /__live to a SiteRoom WebSocket. For any
// other host we return null so the app's existing routes (landing, dashboard,
// /api/*) handle the request as usual.
//
// Visitors are not authenticated — a Published Site is public by design. The
// Owner-gated `/api/publish/sites/:siteId` endpoint is the only writer; this
// router is read-only.

import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { type Context, type Input } from 'hono';
import { getCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { createR2Client } from '../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../assets/read';
import { collectReferencedAssetIds } from '../assets/site-assets';
import { snapshotForPageSlug } from '../canvas/page-routing';
import { resolveClerkKeys, type ClerkAuthVariables } from '../auth/middleware';
import { clerkFrontendApiHost } from '../auth/require-auth';
import {
  type EditTokenPayload,
  verifyEditToken,
  signEditToken,
  buildEditTokenCookieHeader,
} from '../auth/edit-token';
import { verifyInviteToken } from '../auth/invite-token';
import { buildInviteErrorResponse } from '../auth/invite-error-page';
import { hasLiveEditorSocketAccess } from '../live/editor-auth';
import { editorPageJsx, type EditorPageOptions } from '../editor/route';
import { siteCollaborator } from '../db/schema';
import { canvasPublishedStyles } from '../canvas/public-styles';
import { renderCanvasSnapshot } from '../canvas/render';
import { requireTurnstileSiteKey } from '../canvas/elements/form';
import type { PublishedSnapshot } from '../canvas/schema';
import { buildStyleKitCss } from '../canvas/style-kits';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router';
import { db } from '../db/client';
import { customer, ownerAsset, site, siteFont } from '../db/schema';
import { buildCustomerNotif, buildSiteNotif } from '../notifications/constructors';
import { writeNotification } from '../notifications/writer';
import type { CollaboratorEventPayload } from '../notifications/kinds';
import type { NotificationOwnerRoomMarker } from '../notifications/owner-room';
// Wave 2 #8 — per-snapshot Content-Security-Policy frame-src allowlist.
import { buildEmbedCsp, snapshotHasMathRun } from '../embed/csp';
// Wave 2 #9 — password-protected publish gate. Called per request after the
// site row is resolved; returns a gate Response when the visitor must unlock,
// or null to continue serving the snapshot.
import { requireUnlock } from '../password/middleware';
// Wave 3 #21 — per-page <head> meta emission (title / description / OG / Twitter
// / canonical / robots / lang).
import { renderCanvasHead, resolveLang } from '../seo/meta-emit';
// Wave 3 #20 — dual-palette CSS + inline data-mode setter for visitor toggle.
import { emitDualModeCss } from '../themes/visitor-mode/css-emit';
import { getModeSetterScript, getDarkModeSetterScript } from '../themes/visitor-mode/inline-script';
import { renderModeToggleHtml } from '../themes/visitor-mode/toggle-element';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve';
import { prepareRender } from '../i18n/render-hook';
import { emitAllSiteFontFaceBlocks, emitFontFaceBlocks } from '../fonts/face-emit';
import { makeFontLookup, resolveFontTokens } from '../fonts/resolve';
// Wave 4 #17 — vanilla-JS hydration runtime for accordion + carousel elements.
// Wrap is a no-op when no interactive elements present in the snapshot.
import { injectInteractiveRuntime } from '../interactive/inject';
import { emitAddonBodyScripts, emitAddonHeadScripts } from '../addons/emit';
// Open Canvas chrome (MIGRATION.md §5h) — friendly 404 + "coming soon" draft
// pages now consume the shared design tokens, component primitives, brand
// mark, and pre-paint theme-restore script so they match the rest of the
// app surface (landing / dashboard / editor).
import {
  themeCss,
  componentsCss,
  themeFontHeadHtml,
  themeBootScript,
  readThemeCookie,
} from '../ui/theme';
import {
  appDomain,
  appOrigin,
  cookieName,
  publicHostSuffix,
  type HostConfigEnv,
} from '../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_FRONTEND_API_URL?: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
  ASSETS_BUCKET: R2Bucket;
  // Wave 1 #5 — Cloudflare for SaaS Custom Hostnames.
  CF_API_TOKEN?: string;
  CF_ZONE_ID?: string;
  // Wave 2 #7 — Cloudflare Turnstile (form bot-protection).
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
  // Wave 2 #7 — outbound form webhook HMAC signing secret.
  WEBHOOK_SIGNING_SECRET?: string;
  // Wave 2 #9 — HMAC secret signing the visitor unlock cookie. Set via
  // `wrangler secret put UNLOCK_SIGNING_SECRET`.
  UNLOCK_SIGNING_SECRET: string;
  // Wave 2 #7 — forms rate-limiter DO binding (declared in wrangler.toml).
  FORM_RATE_LIMITER?: DurableObjectNamespace;
  // Wave 5 #23 + #24 — Gemini API key for chat agent + auto-translate.
  GEMINI_API_KEY?: string;
  // Resend API key for transactional email (collaborator invitations).
  RESEND_API_KEY: string;
  // ADR 0043 Phase D — SSE pub-sub hub for live notif push to dashboards.
  NOTIFICATION_OWNER_ROOM: DurableObjectNamespace<NotificationOwnerRoomMarker>;
}

export type PublicEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

// Hosts that belong to the app itself (not a Published Site). We short-circuit
// on these so app traffic doesn't pay the DB lookup cost and we never
// accidentally treat the app host as a Published Address. The configured apex
// (`APP_DOMAIN`) is added per-request inside `handlePublicRequest` so a fork
// gets its own apex routed correctly without source edits.
const APP_HOSTS = new Set([
  'opencanvas.test',
  'localhost:8787',
  'localhost',
  '127.0.0.1',
  '127.0.0.1:8787',
]);

const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

// Visitor script: opens a WebSocket to /__live, reacts to publish broadcasts
// by swapping the snapshot HTML inside [data-opencanvas-public-root]. innerHTML is
// safe here because the publish endpoint is the only writer and it always
// runs the snapshot through validate + renderCanvasSnapshot before broadcast
// — there is no path from visitor input to this innerHTML assignment.
//
// The script is built per-request with the server-rendered snapshot version
// baked in as an integer literal (see `buildVisitorLiveScript`). Stale or
// duplicate broadcasts (payload.version <= currentVersion) are ignored, so a
// late-arriving republish from before a full page reload cannot overwrite a
// freshly-loaded snapshot.
// Scroll-entrance animation: IntersectionObserver watches [data-entrance]
// elements and stamps data-visible when they cross the viewport threshold.
// The CSS transition (below, injected into the <style> block) handles the
// visual reveal. Observer unobserves after firing — animate once.
const ENTRANCE_OBSERVER_SCRIPT = String.raw`
(function(){
  if(!("IntersectionObserver" in window))return;
  var els=document.querySelectorAll("[data-entrance],[data-entrance-animation][data-scroll-trigger=\"on-scroll\"]");
  if(!els.length)return;
  var io=new IntersectionObserver(function(entries){
    for(var i=0;i<entries.length;i++){
      if(entries[i].isIntersecting){
        entries[i].target.setAttribute("data-visible","");
        var pagePreset=entries[i].target.getAttribute("data-entrance-animation");
        if(pagePreset)entries[i].target.setAttribute("data-motion-preset",pagePreset);
        io.unobserve(entries[i].target);
      }
    }
  },{threshold:0.15});
  for(var j=0;j<els.length;j++)io.observe(els[j]);
})();
`;

const ENTRANCE_ANIMATION_CSS = [
  '[data-entrance]{opacity:0;transition:opacity var(--motion-duration,0.6s) var(--motion-easing,ease),transform var(--motion-duration,0.6s) var(--motion-easing,ease);}',
  '[data-entrance][data-visible]{opacity:1;transform:none;}',
].join('\n');

function buildVisitorLiveScript(snapshotVersion: number): string {
  // Refuse non-integer/non-finite versions loudly — the caller is supposed to
  // have already validated the snapshot, but the visitor script's stale
  // filter is the only thing standing between a corrupt version stamp and an
  // innerHTML swap, so we double-check.
  if (!Number.isFinite(snapshotVersion)) {
    throw new Error(
      `buildVisitorLiveScript: snapshotVersion must be a finite number, got ${String(snapshotVersion)}`,
    );
  }
  const versionInt = Math.floor(Number(snapshotVersion));
  if (!Number.isInteger(versionInt) || versionInt < 0) {
    throw new Error(
      `buildVisitorLiveScript: snapshotVersion must be a non-negative integer, got ${String(snapshotVersion)}`,
    );
  }
  const versionLiteral = String(versionInt);
  return String.raw`
(() => {
  const ROOT_SELECTOR = '[data-opencanvas-public-root]';
  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 30000;
  // Jitter so N visitors don't all retry on the same tick after a transport
  // blip — without it, a SiteRoom restart triggers a thundering-herd of
  // simultaneous reconnects, each counted as one DO request.
  const RECONNECT_JITTER_MS = 500;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = scheme + '//' + location.host + '/__live';
  let currentVersion = ${versionLiteral};
  let retryCount = 0;
  let pendingReconnect = false;

  function currentSlug(defaultSlug) {
    const raw = location.pathname.replace(/^\/+|\/+$/g, '');
    if (raw === '') return defaultSlug;
    try {
      return decodeURIComponent(raw);
    } catch (err) {
      console.error('[opencanvas-visitor] cannot decode current path for live update', err);
      return null;
    }
  }

  function selectPayloadHtml(payload) {
    if (Object.prototype.hasOwnProperty.call(payload, 'htmlBySlug')) {
      if (!payload.htmlBySlug || typeof payload.htmlBySlug !== 'object') {
        console.error('[opencanvas-visitor] broadcast htmlBySlug is invalid', payload);
        return null;
      }
      if (typeof payload.defaultSlug !== 'string') {
        console.error('[opencanvas-visitor] broadcast missing defaultSlug', payload);
        return null;
      }
      const slug = currentSlug(payload.defaultSlug);
      if (slug === null) return null;
      if (typeof payload.htmlBySlug[slug] === 'string') return payload.htmlBySlug[slug];
      if (typeof payload.htmlBySlug._404 === 'string') return payload.htmlBySlug._404;
      console.error('[opencanvas-visitor] broadcast missing html for current path', { slug, payload });
      return null;
    }
    return typeof payload.html === 'string' ? payload.html : null;
  }

  function connect() {
    // Hidden tabs don't need live publish updates — they aren't painting.
    // Skip the WebSocket entirely; visibilitychange will reconnect when the
    // tab comes back into the foreground. Each suppressed reconnect saves
    // one SITE_ROOM DO request per visitor per drop.
    if (document.visibilityState === 'hidden') {
      pendingReconnect = true;
      return;
    }
    pendingReconnect = false;
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      retryCount = 0;
    });
    ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error('[opencanvas-visitor] invalid live payload', err);
        return;
      }
      if (payload && typeof payload === 'object') {
        const selectedHtml = selectPayloadHtml(payload);
        if (selectedHtml !== null) {
          // Stale-version filter: strict > comparison. An equal version is
          // also stale (the visitor has already rendered it on first load
          // or via a previous broadcast).
          if (typeof payload.version !== 'number' || !Number.isFinite(payload.version)) {
            console.error('[opencanvas-visitor] broadcast missing valid version', payload);
            return;
          }
          if (payload.version <= currentVersion) {
            return;
          }
          const root = document.querySelector(ROOT_SELECTOR);
          if (root) {
            // The server-rendered HTML is the only writer. The publish
            // endpoint validates the snapshot before broadcast; there is no
            // visitor-controlled path into this assignment.
            root.innerHTML = selectedHtml;
          }
          currentVersion = payload.version;
          return;
        }
        if (payload.type === 'presence') {
          // Presence broadcasts are still received over /__live (the DO sends
          // one to every connection) but visitors no longer see a viewer-count
          // pill. The editor side keeps its own "N editing" badge wired
          // through Yjs awareness — that path is independent of this listener.
          return;
        }
      }
    });
    ws.addEventListener('close', () => {
      if (document.visibilityState === 'hidden') {
        pendingReconnect = true;
        return;
      }
      var base = Math.min(RECONNECT_BASE_MS * Math.pow(2, retryCount), RECONNECT_MAX_MS);
      var delay = base + Math.random() * RECONNECT_JITTER_MS;
      retryCount++;
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => {
      // Let the close handler schedule the reconnect; don't double-fire.
      try { ws.close(); } catch (_) { /* noop */ }
    });
  }

  // Reconnect immediately when the tab becomes visible again. retryCount
  // resets so the user doesn't wait the full backoff after switching back
  // to a long-hidden tab.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pendingReconnect) {
      retryCount = 0;
      connect();
    }
  });

  connect();
})();
`;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

interface PublicSiteRow {
  id: string;
  customerId: string;
  name: string;
  subdomain: string;
  styleKit: string;
  publishedSnapshot: PublishedSnapshot | null;
  // Wave 2 #9 — password gate fields read by `requireUnlock`.
  passwordEnabled: boolean;
  passwordHash: string | null;
  passwordSetAt: Date | null;
}

type OnSiteEditorSite = Pick<PublicSiteRow, 'id' | 'name' | 'subdomain' | 'styleKit'>;
type OnSiteEditorTokenPayload = Pick<EditTokenPayload, 'siteId' | 'customerId' | 'clerkUserId'>;
type OnSiteEditorEnv = Pick<
  Bindings,
  | 'CLERK_PUBLISHABLE_KEY'
  | 'CLERK_SECRET_KEY'
  | 'CLERK_FRONTEND_API_URL'
  | 'UNLOCK_SIGNING_SECRET'
  | 'APP_DOMAIN'
  | 'AUTHORIZED_PARTIES'
  | 'COOKIE_NAME_PREFIX'
  | 'EMAIL_FROM'
>;

export async function buildOnSiteEditorOptions(
  siteRow: OnSiteEditorSite,
  payload: OnSiteEditorTokenPayload,
  env: OnSiteEditorEnv,
): Promise<EditorPageOptions> {
  if (payload.siteId !== siteRow.id) {
    throw new Error(
      `buildOnSiteEditorOptions: token siteId ${payload.siteId} does not match ${siteRow.id}`,
    );
  }

  const wsToken = await signEditToken(
    { siteId: siteRow.id, customerId: payload.customerId, clerkUserId: payload.clerkUserId },
    env.UNLOCK_SIGNING_SECRET,
  );

  const { publishableKey } = resolveClerkKeys(env);
  return {
    siteId: siteRow.id,
    siteName: siteRow.name,
    subdomain: siteRow.subdomain,
    styleKit: siteRow.styleKit as EditorPageOptions['styleKit'],
    apex: appDomain(env),
    apexOrigin: appOrigin(env),
    context: 'public',
    clerkPublishableKey: publishableKey,
    clerkFrontendApiHost: clerkFrontendApiHost(publishableKey, env.CLERK_FRONTEND_API_URL),
    wsToken,
    presenceUserId: payload.clerkUserId,
  };
}

/**
 * Resolve the editing identity's display name for the live presence cursor.
 * Returns `customer.displayName ?? customer.email ?? undefined`. Lifted
 * outside `buildOnSiteEditorOptions` so the token-shape smoke
 * (`src/live/editor-auth.smoke.ts`) doesn't gain a hard DB dependency —
 * route handlers thread the result in when constructing editor options.
 */
async function resolvePresenceDisplayName(
  env: Pick<Bindings, 'DATABASE_URL'>,
  customerId: string,
): Promise<string | undefined> {
  const database = db(env);
  const rows = await database
    .select({ displayName: customer.displayName, email: customer.email })
    .from(customer)
    .where(eq(customer.id, customerId))
    .limit(1);
  return rows[0]?.displayName ?? rows[0]?.email ?? undefined;
}

async function loadPublicSite(env: Bindings, subdomain: string): Promise<PublicSiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      customerId: site.customerId,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      publishedSnapshot: site.publishedSnapshot,
      passwordEnabled: site.passwordEnabled,
      passwordHash: site.passwordHash,
      passwordSetAt: site.passwordSetAt,
    })
    .from(site)
    .where(eq(site.subdomain, subdomain))
    .limit(1);
  return rows[0] ?? null;
}

// Loader used by the custom-domain arm. After `resolveCustomDomain` returns
// a siteId, we resolve it to the same PublicSiteRow shape the subdomain arm
// uses so the rendering tail stays one code path.
async function loadPublicSiteById(env: Bindings, siteId: string): Promise<PublicSiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      customerId: site.customerId,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
      publishedSnapshot: site.publishedSnapshot,
      passwordEnabled: site.passwordEnabled,
      passwordHash: site.passwordHash,
      passwordSetAt: site.passwordSetAt,
    })
    .from(site)
    .where(eq(site.id, siteId))
    .limit(1);
  return rows[0] ?? null;
}

function extractSubdomain(env: HostConfigEnv, host: string): string | null {
  const suffix = publicHostSuffix(env);
  if (!host.endsWith(suffix)) return null;
  const prefix = host.slice(0, host.length - suffix.length);
  if (prefix.length === 0) return null;
  // Reject nested subdomains under the public namespace — only one label is
  // allowed (matches the SUBDOMAIN_RE shape enforced at site creation).
  if (prefix.includes('.')) return null;
  return prefix;
}

// On-site editor: validate the edit token cookie and serve the full canvas
// editor shell. If the token is missing or expired, serve a small bootstrap
// page that opens the auth popup on the main domain, receives the token via
// postMessage, and reloads into the editor.
async function handleOnSiteEdit<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  siteRow: PublicSiteRow,
): Promise<Response> {
  // Token transfer: the auth popup passes the signed token via postMessage,
  // and the bootstrap page redirects here with ?__transfer=<token>. The helper
  // decides whether to domain-scope (apex subdomain) or host-scope (custom
  // domain) based on the request host.
  const requestUrl = new URL(c.req.url);
  const transfer = requestUrl.searchParams.get('__transfer');
  if (transfer) {
    const tp = await verifyEditToken(transfer, c.env.UNLOCK_SIGNING_SECRET);
    if (tp && tp.siteId === siteRow.id) {
      const cookie = buildEditTokenCookieHeader(c.env, transfer, requestUrl.host);
      return new Response(null, {
        status: 302,
        headers: { Location: '/?edit', 'Set-Cookie': cookie },
      });
    }
  }

  const token = getCookie(c, cookieName.edit(c.env));
  const payload = await verifyEditToken(token, c.env.UNLOCK_SIGNING_SECRET);

  if (!payload || payload.siteId !== siteRow.id) {
    const siteIdJson = JSON.stringify(siteRow.id);
    const apexOriginJson = JSON.stringify(appOrigin(c.env));
    return c.html(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Open Canvas — sign in to edit</title>
  <style>
    body { margin: 0; display: flex; align-items: center; justify-content: center;
           min-height: 100vh; font-family: system-ui, sans-serif;
           background: #0d1117; color: #e6edf3; }
    .wrap { text-align: center; }
    p { opacity: 0.7; font-size: 14px; }
  </style>
</head>
<body>
  <div class="wrap">
    <p>Opening sign-in…</p>
  </div>
  <script>
    if (!window.crypto || typeof window.crypto.randomUUID !== "function") {
      document.querySelector(".wrap p").textContent =
        "This browser cannot start secure sign-in.";
      throw new Error("on-site edit requires crypto.randomUUID");
    }
    var apexOrigin = ${apexOriginJson};
    var authState = window.crypto.randomUUID();
    var authUrl = apexOrigin + "/api/on-site-edit?siteId=" +
      encodeURIComponent(${siteIdJson}) +
      "&returnOrigin=" + encodeURIComponent(location.origin) +
      "&state=" + encodeURIComponent(authState);
    var popup = window.open(
      authUrl,
      "oc_auth",
      "width=420,height=320,menubar=no,toolbar=no"
    );
    window.addEventListener("message", function(e) {
      if (e.origin !== apexOrigin) return;
      if (e.source !== popup) return;
      if (e.data && e.data.type === "opencanvas:edit-ready") {
        if (e.data.siteId !== ${siteIdJson}) return;
        if (e.data.state !== authState) return;
        if (e.data.token) {
          location.href = "/?edit&__transfer=" + encodeURIComponent(e.data.token);
        } else {
          location.reload();
        }
      }
    });
    if (!popup || popup.closed) {
      document.querySelector(".wrap p").textContent =
        "Pop-up blocked. Please allow pop-ups for this site and try again.";
    }
  </script>
</body>
</html>`,
    );
  }

  const opts = await buildOnSiteEditorOptions(siteRow, payload, c.env);
  const presenceName = await resolvePresenceDisplayName(c.env, payload.customerId);
  if (presenceName) opts.customerDisplayName = presenceName;
  const theme = readThemeCookie(c);
  if (theme) opts.theme = theme;
  return c.html(editorPageJsx(opts));
}

async function handleAcceptInvite<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  siteRow: PublicSiteRow,
): Promise<Response> {
  const requestUrl = new URL(c.req.url);
  const token = requestUrl.searchParams.get('token');
  const result = await verifyInviteToken(token, c.env.UNLOCK_SIGNING_SECRET);

  if (!result.ok) {
    return buildInviteErrorResponse(result.reason);
  }
  if (result.payload.siteId !== siteRow.id) {
    return buildInviteErrorResponse('invalid');
  }

  const database = db(c.env);
  // Snapshot acceptedAt before the COALESCE-UPDATE so we can tell first-time
  // acceptance apart from re-clicking the link (only first acceptance emits
  // the ADR 0043 collaborator_event 'joined' notif).
  const previousRows = await database
    .select({ acceptedAt: siteCollaborator.acceptedAt })
    .from(siteCollaborator)
    .where(
      and(
        eq(siteCollaborator.id, result.payload.collaboratorId),
        eq(siteCollaborator.siteId, siteRow.id),
        eq(siteCollaborator.invitedEmail, result.payload.invitedEmail),
      ),
    )
    .limit(1);
  const wasAlreadyAccepted = previousRows[0]?.acceptedAt != null;

  // COALESCE keeps the original acceptedAt timestamp if the invitee re-clicks
  // an old link after already accepting — preserves audit data and lets the
  // same handler serve both first-accept and re-visit flows.
  //
  // The invitedEmail match is belt-and-suspenders against a row being
  // rewritten under a different invitee out-of-band — not an identity check
  // against the accepting party. The accept flow is bearer-token by design;
  // see ADR-0010.
  const updated = await database
    .update(siteCollaborator)
    .set({ acceptedAt: sql`COALESCE(${siteCollaborator.acceptedAt}, NOW())` })
    .where(
      and(
        eq(siteCollaborator.id, result.payload.collaboratorId),
        eq(siteCollaborator.siteId, siteRow.id),
        eq(siteCollaborator.invitedEmail, result.payload.invitedEmail),
      ),
    )
    .returning({
      id: siteCollaborator.id,
      customerId: siteCollaborator.customerId,
    });

  if (!updated[0]) {
    return buildInviteErrorResponse('cancelled');
  }

  const subjectCustomerId = updated[0].customerId;

  const collabCustomer = await database
    .select({
      clerkUserId: customer.clerkUserId,
      displayName: customer.displayName,
      email: customer.email,
    })
    .from(customer)
    .where(eq(customer.id, subjectCustomerId))
    .limit(1);

  const clerkUserId = collabCustomer[0]?.clerkUserId;
  if (!clerkUserId) {
    return c.text('account not found', 404);
  }

  // ADR 0043: emit collaborator_event 'joined' notification on first
  // acceptance only. actor = null (self-action). Best-effort; failures
  // surface in logs but do not block the editor redirect.
  if (!wasAlreadyAccepted) {
    try {
      const subjectDisplayName =
        collabCustomer[0]?.displayName ?? collabCustomer[0]?.email ?? 'A new collaborator';
      const subjectEmail = collabCustomer[0]?.email ?? result.payload.invitedEmail;
      const payload: CollaboratorEventPayload = {
        siteId: siteRow.id,
        siteName: siteRow.name,
        action: 'joined',
        subjectCustomerId,
        subjectDisplayName,
        subjectEmail,
        actorCustomerId: null,
        actorDisplayName: null,
      };
      await writeNotification(
        { db: database, env: c.env },
        buildCustomerNotif('collaborator_event', subjectCustomerId, payload),
      );
      const otherCollaborators = await database
        .select({ customerId: siteCollaborator.customerId })
        .from(siteCollaborator)
        .where(
          and(
            eq(siteCollaborator.siteId, siteRow.id),
            isNotNull(siteCollaborator.acceptedAt),
            ne(siteCollaborator.customerId, subjectCustomerId),
          ),
        );
      const onlookerIds = Array.from(
        new Set<string>([
          ...(siteRow.customerId !== subjectCustomerId ? [siteRow.customerId] : []),
          ...otherCollaborators.map((row) => row.customerId),
        ]),
      );
      if (onlookerIds.length > 0) {
        await writeNotification(
          { db: database, env: c.env },
          buildSiteNotif('collaborator_event', siteRow.id, payload, onlookerIds),
        );
      }
    } catch (err) {
      console.error('[public/accept-invite] collaborator_event joined notif failed', {
        siteId: siteRow.id,
        subjectCustomerId,
        err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err),
      });
    }
  }

  const editToken = await signEditToken(
    { siteId: siteRow.id, customerId: subjectCustomerId, clerkUserId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = buildEditTokenCookieHeader(c.env, editToken, new URL(c.req.url).host);

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/?edit',
      'Set-Cookie': cookieValue,
    },
  });
}

// Open Canvas brand SVG — inlined (rather than importing OcLogo from
// src/ui/brand.tsx) so this module stays a `.ts` file without a JSX
// dependency. The marks below match the silhouette of `OcLogo({size: N})`
// and the footer wordmark used across landing / dashboard.
function ocLogoSvg(size: number): string {
  return (
    `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" aria-hidden="true">` +
    `<rect x="14" y="9" width="40" height="46" stroke="currentColor" stroke-width="2.4"/>` +
    `<circle cx="34" cy="32" r="11" stroke="currentColor" stroke-width="7"/>` +
    `<rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="var(--red)"/>` +
    `<rect x="6" y="43" width="21" height="3.6" rx="1.8" fill="var(--red)"/>` +
    `</svg>`
  );
}

// "Powered by Open Canvas" mark used by both the 404 and draft scenes.
// Visitors land here unauthenticated; we link the wordmark out to the
// product surface so the brand stays consumable but never injects the
// authenticated chrome.
function poweredByOpenCanvasHtml(env: HostConfigEnv): string {
  return (
    `<div class="powered"><a href="${appOrigin(env)}" target="_blank" rel="noopener">` +
    `<span class="oc-logo" style="color:var(--ink-3)">${ocLogoSvg(18)}</span>` +
    `Powered by Open Canvas</a></div>`
  );
}

// Shared <head> for the two public scene pages (404 + draft). Loads the
// design tokens, component primitives, Open Canvas font stack, and the
// pre-paint theme-restore script so a previously-visited surface doesn't
// flash light/dark on first paint. NO theme-toggle button: the visitor is
// unauthenticated and the gate/draft/404 surfaces stay minimal.
function buildPublicSceneHead(title: string, sceneStyles: string): string {
  return (
    `<meta charset="utf-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
    `<meta name="robots" content="noindex" />` +
    `<title>${title}</title>` +
    `<script>${themeBootScript}</script>` +
    themeFontHeadHtml +
    `<style>${themeCss}\n${componentsCss}\n${sceneStyles}</style>`
  );
}

// Common scene chrome — centred column on `var(--paper)` with the
// "Powered by Open Canvas" lockup pinned to the bottom. Used by both
// the 404 and the draft scenes; the per-scene `.scene` rule lives in
// each page's local style block.
const PUBLIC_SCENE_STYLES = `
html, body { height: 100%; margin: 0; padding: 0; }
body { background: var(--paper); color: var(--ink); }
.scene { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px 24px; position: relative; }
.scene .inner { max-width: 620px; text-align: center; }
.powered { position: absolute; bottom: 24px; left: 0; right: 0; display: flex; justify-content: center; }
.powered a { display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-3); font-weight: 600; }
.powered a:hover { color: var(--ink-2); }
`;

// 404 scene — paper background, oversized "4 0 4" with the lens-red middle
// "0" echoing the Open Canvas logo, plus a "Back to home" CTA. Used by
// the unknown-slug branch below (visitor reaches a real site but the
// requested page doesn't exist and the snapshot has no custom _404 page).
const NOT_FOUND_SCENE_STYLES = `
.bigcode { font-family: var(--display); font-weight: 800; font-size: clamp(80px, 18vw, 160px); letter-spacing: -.04em; line-height: .9; color: var(--ink); }
.scene .mark { margin-bottom: 30px; color: var(--ink); }
.scene .mark svg { display: block; margin: 0 auto; }
.scene h1 { font-size: clamp(26px, 4vw, 38px); letter-spacing: -.03em; line-height: 1.14; margin-top: 22px; }
.scene p { color: var(--ink-2); font-size: 17px; max-width: 44ch; margin: 20px auto 0; line-height: 1.55; }
.scene .acts { display: flex; gap: 12px; justify-content: center; margin-top: 30px; flex-wrap: wrap; }
`;

function buildNotFoundPage<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
): Response {
  const head = buildPublicSceneHead(
    'Page not found — Open Canvas',
    `${PUBLIC_SCENE_STYLES}\n${NOT_FOUND_SCENE_STYLES}`,
  );
  const theme = readThemeCookie(c);
  const themeAttr = theme === 'dark' ? ' data-theme="dark"' : '';
  return c.html(
    `<!doctype html>
<html lang="en"${themeAttr}>
<head>${head}</head>
<body>
  <div class="scene">
    <div class="inner">
      <div class="mark">${ocLogoSvg(78)}</div>
      <div class="bigcode">4<span style="color:var(--red)">0</span>4</div>
      <h1>This page took a wrong turn.</h1>
      <p>The page you&rsquo;re looking for isn&rsquo;t here &mdash; it may have moved, or the link might have a typo.</p>
      <div class="acts">
        <a href="/" class="btn btn-primary btn-lg">Back to home</a>
      </div>
    </div>
    ${poweredByOpenCanvasHtml(c.env)}
  </div>
</body>
</html>`,
    404,
  );
}

// "Coming soon" draft scene — half-built canvas with the lens-red sweep
// shimmer, an owner sign-in nudge, and the wordmark footer. Served when
// the site row exists but `publishedSnapshot` is null. The function name
// is referenced by public-invite:smoke as a body-of-handler boundary
// marker — do not rename without updating the smoke.
const COMING_SOON_SCENE_STYLES = `
.chip-soon { margin-bottom: 22px; }
.scene h1 { font-size: clamp(30px, 5.2vw, 52px); letter-spacing: -.035em; line-height: 1.05; max-width: 16ch; }
.scene p { color: var(--ink-2); font-size: 17px; max-width: 46ch; margin: 18px auto 0; line-height: 1.55; }
.build { position: relative; width: min(360px, 80vw); margin: 38px auto 0; background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; }
.build .ph { height: 78px; background: linear-gradient(135deg,#E9837A,#E84D4A 60%,#C5332F); position: relative; }
.build .ph .scan { position: absolute; left: 0; right: 0; top: 0; bottom: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.25), transparent); animation: sweep 2.4s ease-in-out infinite; }
.build .bd { padding: 16px 18px 20px; text-align: left; }
.build .ln { height: 9px; border-radius: 5px; background: var(--surface-3); margin-bottom: 9px; }
.build .dash { height: 34px; border-radius: 10px; border: 1.5px dashed var(--line-2); display: flex; align-items: center; justify-content: center; color: var(--ink-3); font-size: 11px; margin-top: 6px; }
@keyframes sweep { 0% { transform: translateX(-100%);} 60%,100% { transform: translateX(100%);} }
.owner { margin-top: 30px; font-size: 13.5px; color: var(--ink-3); }
.owner a { color: var(--red-ink); font-weight: 650; }
.owner a:hover { color: var(--red-strong); }
@media (prefers-reduced-motion: reduce) { .build .ph .scan { animation: none; } }
`;

function buildComingSoonPage<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  siteRow: PublicSiteRow,
): Response {
  const safeName = escapeHtmlForPage(siteRow.name);
  const head = buildPublicSceneHead(
    `${safeName} — coming soon`,
    `${PUBLIC_SCENE_STYLES}\n${COMING_SOON_SCENE_STYLES}`,
  );
  const theme = readThemeCookie(c);
  const themeAttr = theme === 'dark' ? ' data-theme="dark"' : '';
  return c.html(
    `<!doctype html>
<html lang="en"${themeAttr}>
<head>${head}</head>
<body>
  <div class="scene">
    <span class="chip chip-red chip-soon"><span class="dot"></span>Building in progress</span>
    <h1>${safeName} is <span class="marker">on the way</span>.</h1>
    <p>This site hasn&rsquo;t been published yet. The owner is still putting it together &mdash; check back soon!</p>
    <div class="build">
      <div class="ph"><div class="scan"></div></div>
      <div class="bd">
        <div class="ln" style="width:55%"></div>
        <div class="ln" style="width:85%"></div>
        <div class="ln" style="width:70%"></div>
        <div class="dash">+ more coming soon</div>
      </div>
    </div>
    <p class="owner">Are you the owner? <a href="/?edit">Sign in</a> to finish and publish your site.</p>
    ${poweredByOpenCanvasHtml(c.env)}
  </div>
</body>
</html>`,
    404,
  );
}

function escapeHtmlForPage(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPublishedFooterHtml(env: HostConfigEnv): string {
  const origin = appOrigin(env);
  return `<footer data-oc-footer style="
  margin-top:40px;padding:20px 0;border-top:1px solid rgba(128,128,128,0.15);
  display:flex;align-items:center;justify-content:center;gap:24px;
  font-family:system-ui,sans-serif;font-size:12px;color:rgba(128,128,128,0.6);
  "><a href="${origin}" target="_blank" rel="noopener"
  style="display:inline-flex;align-items:center;gap:6px;color:inherit;text-decoration:none;opacity:0.8;transition:opacity 0.2s"
  onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'"
  ><span style="display:inline-flex;align-items:center">${ocLogoSvg(14)}</span>made with Open Canvas</a
  ><span style="opacity:0.3">&middot;</span
  ><a href="/?edit"
  style="color:inherit;text-decoration:none;opacity:0.8;transition:opacity 0.2s"
  onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'"
  >edit this site</a
  ><span style="opacity:0.3">&middot;</span
  ><a href="${origin}/dashboard/templates" target="_blank" rel="noopener"
  style="color:inherit;text-decoration:none;opacity:0.8;transition:opacity 0.2s"
  onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'"
  >browse templates</a
  ></footer>`;
}

export async function handlePublicRequest<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
): Promise<Response | null> {
  const requestUrl = new URL(c.req.url);
  const host = requestUrl.host;
  const path = requestUrl.pathname;
  const suffix = publicHostSuffix(c.env);
  const apex = appDomain(c.env);

  if (host === apex || APP_HOSTS.has(host)) {
    return null;
  }
  // Custom domain arm (Wave 1 #5): if the host isn't the app or a subdomain
  // Published Address, see whether it matches an Owner-registered custom
  // hostname whose status is 'active'. resolveCustomDomain returns null for
  // any host that doesn't match an active row, which falls through to the
  // null-return below — the request then lands on the app's regular routes
  // (which will 404 if no route matches the host).
  const customDomainHit = host.endsWith(suffix)
    ? null
    : await resolveCustomDomainWithRuntimeCache(host, c.env);
  if (!host.endsWith(suffix) && !customDomainHit) return null;

  let siteRow: PublicSiteRow | null;
  if (customDomainHit) {
    siteRow = await loadPublicSiteById(c.env, customDomainHit.siteId);
  } else {
    const subdomain = extractSubdomain(c.env, host);
    if (subdomain === null) return null;
    siteRow = await loadPublicSite(c.env, subdomain);
  }
  if (!siteRow) {
    return c.text('site not found', 404);
  }

  // On-site editor: `/?edit` on the published subdomain serves the canvas
  // editor instead of the published snapshot. /__api/* falls through to the
  // app router where duplicated API mounts with edit-token auth handle the
  // request. Both bypass the publishedSnapshot and password-gate checks —
  // the editor operates on editableState and the edit token proves ownership.
  if (path === '/' && requestUrl.searchParams.has('edit')) {
    return handleOnSiteEdit(c, siteRow);
  }
  if (path === '/__accept-invite') {
    return handleAcceptInvite(c, siteRow);
  }
  if (path.startsWith('/__api/')) {
    return null;
  }

  if (!siteRow.publishedSnapshot) {
    return buildComingSoonPage(c, siteRow);
  }

  // Wave 2 #9 — the unlock POST must reach the app router even when the site
  // is protected, otherwise no visitor could ever set the unlock cookie.
  if (path === '/__opencanvas/unlock') {
    return null;
  }

  // Wave 4 #22 — sitemap.xml + robots.txt are public crawler discovery
  // surfaces, not snapshot HTML. Fall through to the app router which
  // mounts `/sitemap.xml` and `/robots.txt` via the sitemap router.
  if (path === '/sitemap.xml' || path === '/robots.txt' || path === '/favicon.ico') {
    return null;
  }

  if (path.startsWith('/og/')) {
    return null;
  }

  // /__live WebSocket. Must run BEFORE the password gate so that the on-site
  // editor (`/?edit`) — which bypasses the gate at the HTML layer above —
  // can also open its socket on a password-protected site. A valid wsToken
  // (edit-token, scoped to siteId, owner or accepted collaborator) is the
  // proof of editor access; visitors without a token still hit the gate
  // below, so editableState updates never leak to anonymous WS subscribers.
  //
  // The token is signed by the apex; access checks (collaborator removal,
  // ownership transfer) flow through hasLiveEditorSocketAccess so a
  // revoked collaborator's stale token can't keep editing.
  if (path === '/__live') {
    const upgrade = c.req.header('upgrade');
    if (upgrade !== 'websocket') {
      return c.text('expected websocket upgrade', 426);
    }
    let socketRole: 'editor' | 'visitor' = 'visitor';
    const wsToken = requestUrl.searchParams.get('wsToken');
    if (wsToken) {
      const payload = await verifyEditToken(wsToken, c.env.UNLOCK_SIGNING_SECRET);
      if (payload && payload.siteId === siteRow.id) {
        const hasAccess = await hasLiveEditorSocketAccess(
          db(c.env),
          siteRow.id,
          payload.customerId,
        );
        if (hasAccess) socketRole = 'editor';
      }
    }
    // Visitors must still satisfy the password gate before they can subscribe
    // to live updates — otherwise an anonymous WS would observe Y.Doc
    // updates carrying editableState content for a gated site. The gate
    // honours the unlock cookie, so a visitor who already unlocked retains
    // presence. Editors with a valid wsToken bypass the gate entirely.
    if (socketRole !== 'editor') {
      const wsGateResponse = await requireUnlock(c, c.env, {
        id: siteRow.id,
        name: siteRow.name,
        passwordEnabled: siteRow.passwordEnabled,
        passwordHash: siteRow.passwordHash,
        passwordSetAt: siteRow.passwordSetAt,
      });
      if (wsGateResponse) return wsGateResponse;
    }
    const id = c.env.SITE_ROOM.idFromName(siteRow.id);
    const stub = c.env.SITE_ROOM.get(id);
    const doRequest = new Request(
      `https://do.invalid/socket?siteId=${encodeURIComponent(siteRow.id)}&role=${socketRole}`,
      {
        method: 'GET',
        headers: c.req.raw.headers,
      },
    );
    return stub.fetch(doRequest);
  }

  // Wave 2 #9 — password gate. Intercepts visitor traffic before snapshot
  // serve. Returns null when the gate is disabled or the cookie is valid;
  // returns a gate Response (401 + HTML) otherwise.
  const gateResponse = await requireUnlock(c, c.env, {
    id: siteRow.id,
    name: siteRow.name,
    passwordEnabled: siteRow.passwordEnabled,
    passwordHash: siteRow.passwordHash,
    passwordSetAt: siteRow.passwordSetAt,
  });
  if (gateResponse) return gateResponse;

  // Internal visitor subsystem routes (search, forms, etc.) fall through only
  // after the password gate has passed. They are not snapshot pages.
  if (path.startsWith('/__opencanvas/')) {
    return null;
  }

  if (path.startsWith('/assets/')) {
    // Visitor-facing asset surface. We serve ONLY assets that the current
    // publishedSnapshot.pages reference (per the snapshot-bound visibility
    // rule that predates the asset re-root: editable-only assets are 404
    // here even when the row exists). The `addr` segment may be a UUID or
    // a content hash; the publish-snapshot reachable set is UUID-keyed via
    // `MediaElement.assetId`, but content-hash addressing is allowed too
    // — see `readOwnerAsset` for the OR lookup. Missing rows are 404; we
    // never leak existence by status code.
    const addr = path.slice('/assets/'.length);
    if (addr.length === 0 || addr.includes('/')) {
      return c.text('asset not found', 404);
    }
    const referencedAssetIds = collectReferencedAssetIds(siteRow.publishedSnapshot);
    // Allow either the UUID or the content hash to satisfy the reachability
    // check. We accept either because the renderer emits UUID URLs, but
    // operators / cache warmers may probe by content hash directly.
    if (!referencedAssetIds.has(addr)) {
      // For content-hash addressing we resolve the current snapshot's
      // referenced UUIDs to their hashes and only allow a match inside that
      // set. A global content-hash hit in ownerAsset is not enough.
      if (!CONTENT_HASH_RE.test(addr)) {
        return c.text('asset not found', 404);
      }
      if (referencedAssetIds.size === 0) {
        return c.text('asset not found', 404);
      }
      const referencedRows = await db(c.env)
        .select({ contentHash: ownerAsset.contentHash })
        .from(ownerAsset)
        .where(inArray(ownerAsset.id, [...referencedAssetIds]));
      if (!referencedRows.some((row) => row.contentHash === addr)) {
        return c.text('asset not found', 404);
      }
    }
    const r2 = createR2Client(c.env.ASSETS_BUCKET);
    const cfImageFetch: CfImageFetcher | null =
      typeof fetch === 'function' ? (url, options) => fetch(url, options as RequestInit) : null;
    const response = await readOwnerAsset(
      {
        db: db(c.env),
        r2,
        cfImageFetch,
        publicOrigin: `${requestUrl.protocol}//${requestUrl.host}`,
      },
      { addr, url: requestUrl },
    );
    if (!response) {
      return c.text('asset not found', 404);
    }
    return response;
  }

  // Wave 4 #17 — wrap rendered snapshot HTML with the interactive runtime
  // <script> tag when the snapshot contains accordion / carousel elements.
  // No-op (string-equality return) for snapshots without any interactives.
  const snapshot = siteRow.publishedSnapshot;
  const prepared = prepareRender(path, snapshot);
  const fallbackPrepared =
    prepared.page === null && (path === '/' || path === '') && snapshot.pages[0]
      ? prepareRender(`/${snapshot.pages[0].slug}`, snapshot)
      : null;
  let activeRender = fallbackPrepared ?? prepared;
  let statusCode: 200 | 404 = 200;
  if (activeRender.page === null) {
    const notFoundRender = prepareRender('/_404', snapshot);
    if (notFoundRender.page !== null) {
      activeRender = notFoundRender;
      statusCode = 404;
    } else {
      // No custom _404 page in the snapshot — serve the Open Canvas
      // friendly 404 scene (MIGRATION.md §5h). The site row exists and
      // the snapshot was published; only this specific slug is missing.
      return buildNotFoundPage(c);
    }
  }
  const renderSnapshot = activeRender.renderSnapshot;
  // After the null-check above, page is guaranteed non-null (we either found a
  // page originally, replaced activeRender with the _404 render, or returned).
  const pageSlug = activeRender.pageSlug;
  const dir = activeRender.dir;
  const pageRenderSnapshot = snapshotForPageSlug(renderSnapshot, pageSlug);
  const currentPage = pageRenderSnapshot.pages[0]!;

  const baseKit = resolveStyleKitWithCustom(pageRenderSnapshot);
  const fontRows = await db(c.env)
    .select({
      contentHash: siteFont.contentHash,
      name: siteFont.name,
      family: siteFont.family,
      weight: siteFont.weight,
      style: siteFont.style,
    })
    .from(siteFont)
    .where(eq(siteFont.siteId, siteRow.id));
  // Two emission paths feed the visitor page's @font-face block:
  //
  //   1. emitFontFaceBlocks(tokens, fonts) walks the kit's `font:<hash>`
  //      tokens. It throws when a token references a hash that no
  //      siteFont row covers — a dangling-token failure mode we want to
  //      keep surfacing loudly per the all-or-nothing policy.
  //   2. emitAllSiteFontFaceBlocks(fonts) ships one face per uploaded row
  //      so the text-inspector font-family picker's element-level
  //      `pinnedStyle["font-family"]` pins actually resolve at visit time
  //      (the picker writes the font *name*, not a `font:<hash>` token,
  //      so the resolver in (1) never sees it).
  //
  // The first call's contract — fail loudly when a kit token is dangling —
  // stays load-bearing. The second call is the superset for element-level
  // pins. Duplicate `@font-face` declarations for the same triple are
  // CSS-legal (last one wins) so emitting both costs a few bytes when the
  // kit and an element pin reference the same font, never a render bug.
  const kitFontFaceCss = emitFontFaceBlocks({ tokens: baseKit, fonts: fontRows });
  const allFontFaceCss = emitAllSiteFontFaceBlocks(fontRows);
  const fontFaceCss = [kitFontFaceCss, allFontFaceCss].filter((s) => s.length > 0).join('\n');
  const resolvedKit = resolveFontTokens(baseKit, makeFontLookup(fontRows));
  const customKitCss =
    pageRenderSnapshot.styleKit === 'custom' ? `\n${buildStyleKitCss('custom', resolvedKit)}` : '';
  const snapshotHtml = injectInteractiveRuntime(
    renderCanvasSnapshot(renderSnapshot, '/assets', siteRow.id, {
      renderPages: [currentPage],
      turnstileSiteKey: requireTurnstileSiteKey(c.env),
    }),
    renderSnapshot,
  );
  // Wave 2 #8 — Content-Security-Policy. Aggregates per-snapshot frame-src
  // origins from embedded media (YouTube, Loom, Figma, etc.) so the iframe
  // sandbox can only load those origins. Header is set once per snapshot
  // response; the value is deterministic given the same snapshot.
  c.header('Content-Security-Policy', buildEmbedCsp(pageRenderSnapshot));
  // Canonical URL is emitted by Wave 3 #21's `renderCanvasHead` (below). It
  // derives the canonical from the visitor-hit host, which is the custom
  // hostname when the visitor used one and the subdomain otherwise.
  const visitorScript = buildVisitorLiveScript(renderSnapshot.version);

  // Wave 3 #21 + Wave 5 #25 — use the locale-aware render hook so the page
  // selected for body, head metadata, lang, and dir is one decision.
  const headMeta = renderCanvasHead(pageRenderSnapshot, {
    siteId: siteRow.id,
    host,
    protocol: requestUrl.protocol === 'http:' ? 'http' : 'https',
    pageSlug,
  });
  const lang = resolveLang(currentPage, pageRenderSnapshot);

  // Wave 3 #20 — light/dark visitor toggle. Per ADR 0035, the
  // `visitorTheme` enum drives three runtime shapes:
  //   - 'light' (or undefined): no dual-palette CSS, no inline script.
  //     Site renders light-only.
  //   - 'dark': dual-palette CSS emitted; dark-only inline script
  //     pins data-mode='dark' before first paint; no toggle element.
  //   - 'toggleable': dual-palette CSS emitted; toggleable inline
  //     script reads cookie -> media query -> light default; toggle
  //     element is auto-injected by the renderer when present.
  const visitorTheme = (renderSnapshot as { visitorTheme?: 'light' | 'dark' | 'toggleable' })
    .visitorTheme;
  const themeEmitsCss = visitorTheme === 'dark' || visitorTheme === 'toggleable';
  let dualModeCss = '';
  let modeSetterScript = '';
  if (themeEmitsCss) {
    dualModeCss = emitDualModeCss(resolvedKit, renderSnapshot.styleKit);
    modeSetterScript = visitorTheme === 'dark'
      ? getDarkModeSetterScript()
      : getModeSetterScript(c.env);
  }
  // Without this, `visitorTheme === 'toggleable'` only emits the
  // dual-palette CSS and the cookie-reader script — there is no button
  // wired to flip the cookie, so visitors are stuck in whatever mode the
  // setter script pinned at first paint. The button is owner-controlled
  // via the visitorTheme setting; it does not appear for light/dark-only.
  const modeToggleHtml = visitorTheme === 'toggleable' ? renderModeToggleHtml(c.env) : '';

  const addonScripts = await emitAddonHeadScripts(db(c.env), siteRow.id);
  const addonBodyScripts = await emitAddonBodyScripts(db(c.env), siteRow.id);

  return c.html(
    html`<!doctype html>
      <html lang="${raw(escapeAttr(lang))}" dir="${raw(escapeAttr(dir))}">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          ${raw(headMeta)} ${themeEmitsCss ? raw(`<script>${modeSetterScript}</script>`) : ''}
          ${snapshotHasMathRun(pageRenderSnapshot)
            ? raw(
                '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.21/dist/katex.min.css" crossorigin="anonymous">',
              )
            : ''}
          <style>
            ${raw(canvasPublishedStyles)}${raw(customKitCss)}${raw(
              fontFaceCss ? `\n${fontFaceCss}` : '',
            )}${themeEmitsCss ? `\n${dualModeCss}` : ''}
            ${raw(ENTRANCE_ANIMATION_CSS)}
          </style>
          ${addonScripts ? raw(addonScripts) : ''}
        </head>
        <body>
          <div data-opencanvas-public-root>${raw(snapshotHtml)}</div>
          ${modeToggleHtml ? raw(modeToggleHtml) : ''}
          ${raw(buildPublishedFooterHtml(c.env))}
          <script type="module">
            ${raw(visitorScript)};
          </script>
          <script>
            ${raw(ENTRANCE_OBSERVER_SCRIPT)};
          </script>
          ${addonBodyScripts ? raw(addonBodyScripts) : ''}
        </body>
      </html>`,
    statusCode,
  );
}
