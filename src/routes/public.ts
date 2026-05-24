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

import { eq, inArray } from 'drizzle-orm';
import { type Context, type Input } from 'hono';
import { getCookie } from 'hono/cookie';
import { html, raw } from 'hono/html';
import { createR2Client } from '../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../assets/read';
import { collectReferencedAssetIds } from '../assets/site-assets';
import type { ClerkAuthVariables } from '../auth/middleware';
import { verifyEditToken, EDIT_TOKEN_COOKIE } from '../auth/edit-token';
import { editorPageJsx, type EditorPageOptions } from '../editor/canvas-index';
import { canvasPublishedStyles } from '../canvas/public-styles';
import { renderCanvasSnapshot } from '../canvas/render';
import type { PublishedSnapshot } from '../canvas/schema';
import { buildStyleKitCss } from '../canvas/style-kits';
import { resolveCustomDomainWithRuntimeCache } from '../custom-domain/router';
import { db } from '../db/client';
import { ownerAsset, site, siteFont } from '../db/schema';
// Wave 2 #8 — per-snapshot Content-Security-Policy frame-src allowlist.
import { buildEmbedCsp } from '../embed/csp';
// Wave 2 #9 — password-protected publish gate. Called per request after the
// site row is resolved; returns a gate Response when the visitor must unlock,
// or null to continue serving the snapshot.
import { requireUnlock } from '../password/middleware';
// Wave 3 #14 — symbol-instance render needs the site's symbols table injected
// before renderCanvasSnapshot runs. The configure call is per-render scope.
import { configureSymbolInstanceRender } from '../canvas/elements/symbol-instance';
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
  const RECONNECT_DELAY_MS = 1000;
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = scheme + '//' + location.host + '/__live';
  let currentVersion = ${versionLiteral};

  function connect() {
    const ws = new WebSocket(url);
    ws.addEventListener('message', (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch (err) {
        console.error('[rev01-visitor] invalid live payload', err);
        return;
      }
      if (payload && typeof payload === 'object') {
        if (typeof payload.html === 'string') {
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
            root.innerHTML = payload.html;
          }
          currentVersion = payload.version;
          return;
        }
        if (payload.type === 'presence') {
          // Task 8: surface the visitor count in the corner pill. Show only
          // when count > 1 — a lone "1 viewing" is meaningless and would
          // just leak the fact that the visitor is alone.
          const count = typeof payload.count === 'number' && Number.isFinite(payload.count)
            ? payload.count
            : 0;
          const pill = document.querySelector('[data-rev01-presence]');
          const counter = document.querySelector('[data-rev01-presence-count]');
          if (pill && counter) {
            if (count > 1) {
              counter.textContent = String(count);
              pill.hidden = false;
            } else {
              pill.hidden = true;
            }
          }
          return;
        }
      }
    });
    ws.addEventListener('close', () => {
      setTimeout(connect, RECONNECT_DELAY_MS);
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
    var popup = window.open(
      "https://rev01.aayushman.dev/api/on-site-edit?siteId=" + encodeURIComponent(${siteIdJson}),
      "rev01_auth",
      "width=420,height=320,menubar=no,toolbar=no"
    );
    window.addEventListener("message", function(e) {
      if (e.data && e.data.type === "rev01:edit-ready") {
        location.reload();
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

  const opts: EditorPageOptions = {
    siteId: siteRow.id,
    siteName: siteRow.name,
    subdomain: siteRow.subdomain,
    styleKit: siteRow.styleKit as EditorPageOptions['styleKit'],
    context: 'public',
  };
  return c.html(editorPageJsx(opts));
}

// Floating edit button injected into every published page. Navigates to
// /__edit on click — the edit handler deals with auth (popup if needed).
function buildEditButtonHtml(siteId: string): string {
  return `<a href="/__edit" data-rev01-edit aria-label="Edit this site"
  style="position:fixed;bottom:16px;right:16px;z-index:9999;
  width:40px;height:40px;border-radius:50%;
  background:#0d1117;border:1px solid rgba(255,255,255,0.1);
  display:flex;align-items:center;justify-content:center;
  color:#e6edf3;text-decoration:none;font-size:18px;
  opacity:0.6;transition:opacity 0.2s;cursor:pointer;"
  onmouseover="this.style.opacity='1'"
  onmouseout="this.style.opacity='0.6'"
  title="Edit this site">&#9998;</a>`;
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

  // On-site editor: /__edit serves the canvas editor on the published
  // subdomain. /__api/* falls through to the app router where duplicated
  // API mounts with edit-token auth handle the request. Both bypass the
  // publishedSnapshot and password-gate checks — the editor operates on
  // editableState and the edit token proves ownership.
  if (path === '/__edit') {
    return handleOnSiteEdit(c, siteRow);
  }
  if (path.startsWith('/__api/')) {
    return null;
  }

  if (!siteRow.publishedSnapshot) {
    return c.text('site not yet published', 404);
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
    const referencedAssetIds = collectReferencedAssetIds(siteRow.publishedSnapshot.pages);
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

  // Wave 3 #14 — inject the site's symbol-master table into the symbol-instance
  // render fn before the snapshot is materialised. snapshot.symbols is the
  // single source of truth; missing means the site has zero symbols.
  configureSymbolInstanceRender({ symbols: siteRow.publishedSnapshot.symbols ?? [] });

  // Wave 4 #17 — wrap rendered snapshot HTML with the interactive runtime
  // <script> tag when the snapshot contains accordion / carousel elements.
  // No-op (string-equality return) for snapshots without any interactives.
  const snapshot = siteRow.publishedSnapshot;
  const prepared = prepareRender(path, snapshot);
  const fallbackPrepared =
    prepared.page === null && (path === '/' || path === '') && snapshot.pages[0]
      ? prepareRender(`/${snapshot.pages[0].slug}`, snapshot)
      : null;
  const activeRender = fallbackPrepared ?? prepared;
  if (activeRender.page === null) {
    return c.text('page not found', 404);
  }
  const renderSnapshot = activeRender.renderSnapshot;
  const currentPage = activeRender.page;
  const pageSlug = activeRender.pageSlug;
  const dir = activeRender.dir;

  const baseKit = resolveStyleKitWithCustom(renderSnapshot);
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
    renderSnapshot.styleKit === 'custom' ? `\n${buildStyleKitCss('custom', resolvedKit)}` : '';
  const snapshotHtml = injectInteractiveRuntime(
    renderCanvasSnapshot(renderSnapshot, '/assets', siteRow.id),
    renderSnapshot,
  );
  // Wave 2 #8 — Content-Security-Policy. Aggregates per-snapshot frame-src
  // origins from embedded media (YouTube, Loom, Figma, etc.) so the iframe
  // sandbox can only load those origins. Header is set once per snapshot
  // response; the value is deterministic given the same snapshot.
  c.header('Content-Security-Policy', buildEmbedCsp(renderSnapshot));
  // Canonical URL is emitted by Wave 3 #21's `renderCanvasHead` (below). It
  // derives the canonical from the visitor-hit host, which is the custom
  // hostname when the visitor used one and the subdomain otherwise.
  const visitorScript = buildVisitorLiveScript(renderSnapshot.version);

  // Wave 3 #21 + Wave 5 #25 — use the locale-aware render hook so the page
  // selected for body, head metadata, lang, and dir is one decision.
  const headMeta = renderCanvasHead(renderSnapshot, {
    siteId: siteRow.id,
    host,
    protocol: requestUrl.protocol === 'http:' ? 'http' : 'https',
    pageSlug,
  });
  const lang = resolveLang(currentPage, renderSnapshot);

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
            )}${darkModeEnabled
              ? `\n${dualModeCss}`
              : ''}
          </style>
        </head>
        <body>
          <div data-rev01-public-root>${raw(snapshotHtml)}</div>
          <aside
            data-rev01-presence
            hidden
            role="status"
            aria-live="polite"
            aria-label="People viewing"
          >
            👀 <span data-rev01-presence-count>0</span> viewing
          </aside>
          ${raw(buildEditButtonHtml(siteRow.id))}
          <script type="module">
            ${raw(visitorScript)};
          </script>
        </body>
      </html>`,
  );
}
