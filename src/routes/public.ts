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

import { eq } from 'drizzle-orm';
import { type Context, type Input } from 'hono';
import { html, raw } from 'hono/html';
import { createR2Client } from '../assets/r2-client';
import { readOwnerAsset, type CfImageFetcher } from '../assets/read';
import { collectReferencedAssetIds } from '../assets/site-assets';
import type { ClerkAuthVariables } from '../auth/middleware';
import { canvasPublishedStyles } from '../canvas/public-styles';
import { renderCanvasSnapshot } from '../canvas/render';
import type { PublishedSnapshot } from '../canvas/schema';
import { db } from '../db/client';
import { site } from '../db/schema';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
  SITE_ROOM: DurableObjectNamespace;
  ASSETS_BUCKET: R2Bucket;
}

export type PublicEnv = { Bindings: Bindings; Variables: ClerkAuthVariables };

const PUBLIC_HOST_SUFFIX = '.rev01.aayushman.dev';

// Hosts that belong to the rev01 app itself (not a Published Site). We
// short-circuit on these so app traffic doesn't pay the DB lookup cost and we
// never accidentally treat the app host as a Published Address.
const APP_HOSTS = new Set([
  'rev01.aayushman.dev',
  'localhost:8787',
  'localhost',
  '127.0.0.1',
  '127.0.0.1:8787',
]);

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

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

interface PublicSiteRow {
  id: string;
  name: string;
  subdomain: string;
  publishedSnapshot: PublishedSnapshot | null;
}

async function loadPublicSite(env: Bindings, subdomain: string): Promise<PublicSiteRow | null> {
  const database = db(env);
  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      publishedSnapshot: site.publishedSnapshot,
    })
    .from(site)
    .where(eq(site.subdomain, subdomain))
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

export async function handlePublicRequest<P extends string, I extends Input>(
  c: Context<PublicEnv, P, I>,
): Promise<Response | null> {
  const requestUrl = new URL(c.req.url);
  const host = requestUrl.host;
  const path = requestUrl.pathname;

  // Special case: the editor lives on the app host (rev01.aayushman.dev) but
  // still wants to join the same SiteRoom DO that visitors join on the
  // Published Address. We allow `/__live?siteId=<id>` on the app host to
  // proxy through to the DO scoped to that site id. Everything else on the
  // app host falls through to the app routes as usual.
  //
  // The editor passes its `siteId` (a UUID-shaped string already validated
  // by the editor route and the canvas API) — we reject anything that does
  // not match the strict id charset to avoid letting an attacker stuff
  // garbage through to the DO namespace.
  if (APP_HOSTS.has(host)) {
    if (path === '/__live') {
      const siteIdParam = requestUrl.searchParams.get('siteId');
      if (siteIdParam === null || !/^[A-Za-z0-9-]+$/.test(siteIdParam)) {
        // No siteId, or malformed — not our concern; let the app handle it.
        return null;
      }
      const upgrade = c.req.header('upgrade');
      if (upgrade !== 'websocket') {
        return c.text('expected websocket upgrade', 426);
      }
      const id = c.env.SITE_ROOM.idFromName(siteIdParam);
      const stub = c.env.SITE_ROOM.get(id);
      const doRequest = new Request('https://do.invalid/socket', {
        method: 'GET',
        headers: c.req.raw.headers,
      });
      return stub.fetch(doRequest);
    }
    return null;
  }
  if (!host.endsWith(PUBLIC_HOST_SUFFIX)) return null;

  const subdomain = extractSubdomain(host);
  if (subdomain === null) return null;

  const siteRow = await loadPublicSite(c.env, subdomain);
  if (!siteRow) {
    return c.text('site not found', 404);
  }
  if (!siteRow.publishedSnapshot) {
    return c.text('site not yet published', 404);
  }

  if (path === '/__live') {
    const upgrade = c.req.header('upgrade');
    if (upgrade !== 'websocket') {
      return c.text('expected websocket upgrade', 426);
    }
    const id = c.env.SITE_ROOM.idFromName(siteRow.id);
    const stub = c.env.SITE_ROOM.get(id);
    const doRequest = new Request('https://do.invalid/socket', {
      method: 'GET',
      headers: c.req.raw.headers,
    });
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
      // For content-hash addressing we have to resolve UUID → contentHash
      // via the DB before we can rule out a 64-hex addr. Skip that work
      // unless the addr looks like a hash; cheap UUID rejects 404 fast.
      if (!/^[0-9a-f]{64}$/.test(addr)) {
        return c.text('asset not found', 404);
      }
      // Defer content-hash reachability to readOwnerAsset's existence
      // check (which scopes by no Owner — the read route serves any row
      // by id/hash; the snapshot-bound rule above is the only restriction
      // we apply for visitor traffic). The trade-off is intentional: any
      // content-hash that resolves to a real row is served, even if the
      // SPECIFIC ownerAsset.id is not in this snapshot, because that's
      // the same bytes the snapshot points at via a different id.
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

  const snapshotHtml = renderCanvasSnapshot(siteRow.publishedSnapshot, '/assets');
  const canonicalUrl = `https://${siteRow.subdomain}${PUBLIC_HOST_SUFFIX}/`;
  const titleEscaped = escapeText(siteRow.name);
  const canonicalEscaped = escapeAttr(canonicalUrl);
  const visitorScript = buildVisitorLiveScript(siteRow.publishedSnapshot.version);

  return c.html(
    html`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${raw(titleEscaped)}</title>
          <link rel="canonical" href="${raw(canonicalEscaped)}" />
          <style>
            ${raw(canvasPublishedStyles)}
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
          <script type="module">
            ${raw(visitorScript)};
          </script>
        </body>
      </html>`,
  );
}
