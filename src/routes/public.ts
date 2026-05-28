// src/routes/public.ts
//
// Public host router for Published Sites.
//
// Inspects the request host. If it matches `<subdomain>.rev01.aayushman.dev`
// we own the request: load the site by subdomain, serve either the rendered
// snapshot (any path) or upgrade /__live to a SiteRoom WebSocket. For any
// other host we return null so the app's existing routes (landing, dashboard,
// /api/*) handle the request as usual.
//
// Visitors are not authenticated — a Published Site is public by design. The
// Owner-gated `/api/publish/sites/:siteId` endpoint is the only writer; this
// router is read-only.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { type Context, type Input } from 'hono';
import { getCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { createR2Client } from '../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../assets/read';
import { collectReferencedAssetIds } from '../assets/site-assets';
import { snapshotForPageSlug } from '../canvas/page-routing';
import { resolveClerkKeys, type ClerkAuthVariables } from '../auth/middleware';
import {
  type EditTokenPayload,
  verifyEditToken,
  EDIT_TOKEN_COOKIE,
  signEditToken,
  EDIT_TOKEN_MAX_AGE,
} from '../auth/edit-token';
import { verifyInviteToken } from '../auth/invite-token';
import { editorPageJsx, type EditorPageOptions } from '../editor/canvas-index';
import { siteCollaborator } from '../db/schema';
import { canvasPublishedStyles } from '../canvas/public-styles';
import { renderCanvasSnapshot } from '../canvas/render';
import type { PublishedSnapshot } from '../canvas/schema';
import { buildStyleKitCss } from '../canvas/style-kits';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router';
import { db } from '../db/client';
import { customer, ownerAsset, site, siteFont } from '../db/schema';
// Wave 2 #8 — per-snapshot Content-Security-Policy frame-src allowlist.
import { buildEmbedCsp } from '../embed/csp';
// Wave 2 #9 — password-protected publish gate. Called per request after the
// site row is resolved; returns a gate Response when the visitor must unlock,
// or null to continue serving the snapshot.
import { requireUnlock } from '../password/middleware';
// Wave 3 #21 — per-page <head> meta emission (title / description / OG / Twitter
// / canonical / robots / lang).
import { renderCanvasHead, resolveLang } from '../seo/meta-emit';
// Wave 3 #20 — dual-palette CSS + inline data-mode setter for visitor toggle.
import { emitDualModeCss } from '../themes/visitor-mode/css-emit';
import { getModeSetterScript } from '../themes/visitor-mode/inline-script';
import { resolveStyleKitWithCustom } from '../themes/custom-resolve';
import { prepareRender } from '../i18n/render-hook';
import { emitFontFaceBlocks } from '../fonts/face-emit';
import { makeFontLookup, resolveFontTokens } from '../fonts/resolve';
// Wave 4 #17 — vanilla-JS hydration runtime for accordion + carousel elements.
// Wrap is a no-op when no interactive elements present in the snapshot.
import { injectInteractiveRuntime } from '../interactive/inject';
import { emitAddonBodyScripts, emitAddonHeadScripts } from '../addons/emit';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
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
  RESEND_API_KEY?: string;
}

export type PublicEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

const PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev';

// Hosts that belong to the rev01 app itself (not a Published Site). We
// short-circuit on these so app traffic doesn't pay the DB lookup cost and we
// never accidentally treat the app host as a Published Address.
const APP_HOSTS = new Set([
  'rev01.aayushman.dev',
  'rev01.test',
  'localhost:8787',
  'localhost',
  '127.0.0.1',
  '127.0.0.1:8787',
]);

const CONTENT_HASH_RE = /^[0-9a-f]{64}$/;

// Visitor script: opens a WebSocket to /__live, reacts to publish broadcasts
// by swapping the snapshot HTML inside [data-rev01-public-root]. innerHTML is
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
  const ROOT_SELECTOR = '[data-rev01-public-root]';
  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 30000;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = scheme + '//' + location.host + '/__live';
  let currentVersion = ${versionLiteral};
  let retryCount = 0;

  function currentSlug(defaultSlug) {
    const raw = location.pathname.replace(/^\/+|\/+$/g, '');
    if (raw === '') return defaultSlug;
    try {
      return decodeURIComponent(raw);
    } catch (err) {
      console.error('[rev01-visitor] cannot decode current path for live update', err);
      return null;
    }
  }

  function selectPayloadHtml(payload) {
    if (Object.prototype.hasOwnProperty.call(payload, 'htmlBySlug')) {
      if (!payload.htmlBySlug || typeof payload.htmlBySlug !== 'object') {
        console.error('[rev01-visitor] broadcast htmlBySlug is invalid', payload);
        return null;
      }
      if (typeof payload.defaultSlug !== 'string') {
        console.error('[rev01-visitor] broadcast missing defaultSlug', payload);
        return null;
      }
      const slug = currentSlug(payload.defaultSlug);
      if (slug === null) return null;
      if (typeof payload.htmlBySlug[slug] === 'string') return payload.htmlBySlug[slug];
      if (typeof payload.htmlBySlug._404 === 'string') return payload.htmlBySlug._404;
      console.error('[rev01-visitor] broadcast missing html for current path', { slug, payload });
      return null;
    }
    return typeof payload.html === 'string' ? payload.html : null;
  }

  function connect() {
    const ws = new WebSocket(url);
    ws.addEventListener('open', () => {
      retryCount = 0;
    });
    ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error('[rev01-visitor] invalid live payload', err);
        return;
      }
      if (payload && typeof payload === 'object') {
        const selectedHtml = selectPayloadHtml(payload);
        if (selectedHtml !== null) {
          // Stale-version filter: strict > comparison. An equal version is
          // also stale (the visitor has already rendered it on first load
          // or via a previous broadcast).
          if (typeof payload.version !== 'number' || !Number.isFinite(payload.version)) {
            console.error('[rev01-visitor] broadcast missing valid version', payload);
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
      var delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, retryCount), RECONNECT_MAX_MS);
      retryCount++;
      setTimeout(connect, delay);
    });
    ws.addEventListener('error', () => {
      // Let the close handler schedule the reconnect; don't double-fire.
      try { ws.close(); } catch (_) { /* noop */ }
    });
  }

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
  'CLERK_PUBLISHABLE_KEY' | 'CLERK_SECRET_KEY' | 'UNLOCK_SIGNING_SECRET'
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

  return {
    siteId: siteRow.id,
    siteName: siteRow.name,
    subdomain: siteRow.subdomain,
    styleKit: siteRow.styleKit as EditorPageOptions['styleKit'],
    context: 'public',
    clerkPublishableKey: resolveClerkKeys(env).publishableKey,
    wsToken,
  };
}

async function loadPublicSite(env: Bindings, subdomain: string): Promise<PublicSiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
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

function extractSubdomain(host: string): string | null {
  if (!host.endsWith(PUBLIC_HOST_SUFFIX)) return null;
  const prefix = host.slice(0, host.length - PUBLIC_HOST_SUFFIX.length);
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
  // and the bootstrap page redirects here with ?__transfer=<token>. We verify
  // it and set a cookie scoped to the current host (critical for custom
  // domains where the .rev01.aayushman.dev cookie isn't readable).
  const requestUrl = new URL(c.req.url);
  const transfer = requestUrl.searchParams.get('__transfer');
  if (transfer) {
    const tp = await verifyEditToken(transfer, c.env.UNLOCK_SIGNING_SECRET);
    if (tp && tp.siteId === siteRow.id) {
      const cookie = [
        `${EDIT_TOKEN_COOKIE}=${transfer}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        `Max-Age=${EDIT_TOKEN_MAX_AGE}`,
      ].join('; ');
      return new Response(null, {
        status: 302,
        headers: { Location: '/?edit', 'Set-Cookie': cookie },
      });
    }
  }

  const token = getCookie(c, EDIT_TOKEN_COOKIE);
  const payload = await verifyEditToken(token, c.env.UNLOCK_SIGNING_SECRET);

  if (!payload || payload.siteId !== siteRow.id) {
    const siteIdJson = JSON.stringify(siteRow.id);
    return c.html(
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>rev01 — sign in to edit</title>
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
      throw new Error("rev01 on-site edit requires crypto.randomUUID");
    }
    var authState = window.crypto.randomUUID();
    var authUrl = "https://rev01.aayushman.dev/api/on-site-edit?siteId=" +
      encodeURIComponent(${siteIdJson}) +
      "&returnOrigin=" + encodeURIComponent(location.origin) +
      "&state=" + encodeURIComponent(authState);
    var popup = window.open(
      authUrl,
      "rev01_auth",
      "width=420,height=320,menubar=no,toolbar=no"
    );
    window.addEventListener("message", function(e) {
      if (e.origin !== "https://rev01.aayushman.dev") return;
      if (e.source !== popup) return;
      if (e.data && e.data.type === "rev01:edit-ready") {
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
  return c.html(editorPageJsx(opts));
}

type InviteErrorKind = 'expired' | 'invalid' | 'cancelled';

function renderInviteErrorPage<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  kind: InviteErrorKind,
): Response {
  const copy: Record<InviteErrorKind, { title: string; body: string; status: 400 | 404 | 410 }> = {
    expired: {
      title: 'Invitation expired',
      body: 'This invitation link has expired. Ask the site owner to send a new one.',
      status: 410,
    },
    invalid: {
      title: 'Invalid invitation link',
      body: 'This invitation link could not be verified. Check the URL or ask the site owner to resend.',
      status: 400,
    },
    cancelled: {
      title: 'Invitation no longer available',
      body: 'The site owner has cancelled or removed this invitation.',
      status: 410,
    },
  };
  const { title, body, status } = copy[kind];
  return c.html(
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/>
    <title>rev01 — ${title}</title>
    <style>body{margin:0;display:flex;align-items:center;justify-content:center;
    min-height:100vh;font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;}
    .wrap{text-align:center;max-width:400px;padding:32px;}
    h1{font-size:20px;margin:0 0 12px;}
    p{font-size:14px;opacity:0.7;line-height:1.5;margin:0;}</style></head>
    <body><div class="wrap"><h1>${title}</h1><p>${body}</p></div></body></html>`,
    status,
  );
}

async function handleAcceptInvite<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  siteRow: PublicSiteRow,
): Promise<Response> {
  const requestUrl = new URL(c.req.url);
  const token = requestUrl.searchParams.get('token');
  const result = await verifyInviteToken(token, c.env.UNLOCK_SIGNING_SECRET);

  if (!result.ok) {
    return renderInviteErrorPage(c, result.reason);
  }
  if (result.payload.siteId !== siteRow.id) {
    return renderInviteErrorPage(c, 'invalid');
  }

  const database = db(c.env);
  // COALESCE keeps the original acceptedAt timestamp if the invitee re-clicks
  // an old link after already accepting — preserves audit data and lets the
  // same handler serve both first-accept and re-visit flows.
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
    return renderInviteErrorPage(c, 'cancelled');
  }

  const collabCustomer = await database
    .select({ clerkUserId: customer.clerkUserId })
    .from(customer)
    .where(eq(customer.id, updated[0].customerId))
    .limit(1);

  const clerkUserId = collabCustomer[0]?.clerkUserId;
  if (!clerkUserId) {
    return c.text('account not found', 404);
  }

  const editToken = await signEditToken(
    { siteId: siteRow.id, customerId: updated[0].customerId, clerkUserId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const cookieValue = [
    `${EDIT_TOKEN_COOKIE}=${editToken}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${EDIT_TOKEN_MAX_AGE}`,
  ].join('; ');

  return new Response(null, {
    status: 302,
    headers: {
      Location: '/?edit',
      'Set-Cookie': cookieValue,
    },
  });
}

function buildComingSoonPage<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
  siteRow: PublicSiteRow,
): Response {
  return c.html(
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtmlForPage(siteRow.name)} — not yet published</title>
  <style>
    body { margin: 0; min-height: 100vh; display: flex; flex-direction: column;
           align-items: center; justify-content: center; font-family: system-ui, sans-serif;
           background: #0d1117; color: #e6edf3; }
    .wrap { text-align: center; max-width: 480px; padding: 32px; }
    h1 { font-size: 28px; font-weight: 700; margin: 0 0 12px; }
    p { font-size: 14px; opacity: 0.6; line-height: 1.6; margin: 0; }
    .badge { display: inline-block; margin-top: 32px; padding: 6px 14px;
             border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
             font-size: 11px; opacity: 0.4; }
    .badge a { color: inherit; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtmlForPage(siteRow.name)}</h1>
    <p>This site is not yet published.</p>
    <div class="badge"><a href="https://rev01.aayushman.dev">made with rev01</a></div>
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

function buildPublishedFooterHtml(): string {
  return `<footer data-rev01-footer style="
  margin-top:40px;padding:20px 0;border-top:1px solid rgba(128,128,128,0.15);
  display:flex;align-items:center;justify-content:center;gap:24px;
  font-family:system-ui,sans-serif;font-size:12px;color:rgba(128,128,128,0.6);
  "><a href="https://rev01.aayushman.dev" target="_blank" rel="noopener"
  style="color:inherit;text-decoration:none;opacity:0.8;transition:opacity 0.2s"
  onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'"
  >made with rev01</a
  ><span style="opacity:0.3">&middot;</span
  ><a href="/?edit"
  style="color:inherit;text-decoration:none;opacity:0.8;transition:opacity 0.2s"
  onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'"
  >edit this site</a
  ><span style="opacity:0.3">&middot;</span
  ><a href="https://rev01.aayushman.dev/dashboard/templates" target="_blank" rel="noopener"
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

  if (APP_HOSTS.has(host)) {
    return null;
  }
  // Custom domain arm (Wave 1 #5): if the host isn't the app or a subdomain
  // Published Address, see whether it matches an Owner-registered custom
  // hostname whose status is 'active'. resolveCustomDomain returns null for
  // any host that doesn't match an active row, which falls through to the
  // null-return below — the request then lands on the app's regular routes
  // (which will 404 if no route matches the host).
  const customDomainHit = host.endsWith(PUBLIC_HOST_SUFFIX)
    ? null
    : await resolveCustomDomainWithRuntimeCache(host, c.env);
  if (!host.endsWith(PUBLIC_HOST_SUFFIX) && !customDomainHit) return null;

  let siteRow: PublicSiteRow | null;
  if (customDomainHit) {
    siteRow = await loadPublicSiteById(c.env, customDomainHit.siteId);
  } else {
    const subdomain = extractSubdomain(host);
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
  if (path === '/__rev01/unlock') {
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
  if (path.startsWith('/__rev01/')) {
    return null;
  }

  if (path === '/__live') {
    const upgrade = c.req.header('upgrade');
    if (upgrade !== 'websocket') {
      return c.text('expected websocket upgrade', 426);
    }
    const id = c.env.SITE_ROOM.idFromName(siteRow.id);
    const stub = c.env.SITE_ROOM.get(id);
    const doRequest = new Request(
      `https://do.invalid/socket?siteId=${encodeURIComponent(siteRow.id)}&role=visitor`,
      {
        method: 'GET',
        headers: c.req.raw.headers,
      },
    );
    return stub.fetch(doRequest);
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
      return c.text('page not found', 404);
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
  const fontFaceCss = emitFontFaceBlocks({ tokens: baseKit, fonts: fontRows });
  const resolvedKit = resolveFontTokens(baseKit, makeFontLookup(fontRows));
  const customKitCss =
    pageRenderSnapshot.styleKit === 'custom' ? `\n${buildStyleKitCss('custom', resolvedKit)}` : '';
  const snapshotHtml = injectInteractiveRuntime(
    renderCanvasSnapshot(renderSnapshot, '/assets', siteRow.id, { renderPages: [currentPage] }),
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

  // Wave 3 #20 — light/dark visitor toggle. Only emit dual-palette CSS +
  // early mode setter when the Owner has enabled dark mode for this site.
  // The flag lives at the editable level and is mirrored into snapshots by a
  // future Wave 5 patch; until then we read it off the snapshot defensively.
  const darkModeEnabled =
    (renderSnapshot as { darkModeEnabled?: boolean }).darkModeEnabled === true;
  let dualModeCss = '';
  let modeSetterScript = '';
  if (darkModeEnabled) {
    dualModeCss = emitDualModeCss(resolvedKit, renderSnapshot.styleKit);
    modeSetterScript = getModeSetterScript();
  }

  const addonScripts = await emitAddonHeadScripts(db(c.env), siteRow.id);
  const addonBodyScripts = await emitAddonBodyScripts(db(c.env), siteRow.id);

  return c.html(
    html`<!doctype html>
      <html lang="${raw(escapeAttr(lang))}" dir="${raw(escapeAttr(dir))}">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          ${raw(headMeta)} ${darkModeEnabled ? raw(`<script>${modeSetterScript}</script>`) : ''}
          <style>
            ${raw(canvasPublishedStyles)}${raw(customKitCss)}${raw(
              fontFaceCss ? `\n${fontFaceCss}` : '',
            )}${darkModeEnabled ? `\n${dualModeCss}` : ''}
            ${raw(ENTRANCE_ANIMATION_CSS)}
          </style>
          ${addonScripts ? raw(addonScripts) : ''}
        </head>
        <body>
          <div data-rev01-public-root>${raw(snapshotHtml)}</div>
          ${raw(buildPublishedFooterHtml())}
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
