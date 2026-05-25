// Canvas editor route — GET /dashboard/sites/:siteId/edit
//
// Server-renders the desktop Canvas Editor shell: topbar (crumbs, address
// chip, style-kit toggles, Save, Publish), canvas area (#canvas-root), the
// inspector (#canvas-inspector), and the status line. The browser bootstrap
// is shipped inline via canvasClientScript and takes over from there.
//
// Owner auth is required: the route looks up the customer for the current
// Clerk user, then the site scoped to that customer. Missing or unowned sites
// return 404 to match the canvas API behaviour.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, resolveClerkKeys, type ClerkAuthVariables } from '../auth/middleware';
import { requireAuth } from '../auth/require-auth';
import { BUILT_IN_STYLE_KITS, type StyleKit } from '../canvas/schema';
import { canvasClientScript } from './canvas-client';
import { canvasEditorStyles } from './canvas-styles';
import { CO_EDIT_BUNDLE } from '../live/co-edit/bundled';
import { db } from '../db/client';
import { customer, site } from '../db/schema';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

const SITE_ID_RE = /^[A-Za-z0-9-]+$/;

export const canvasEditor = new Hono<Env>();

canvasEditor.use('*', clerkAuth());
canvasEditor.use('*', requireAuth());

interface OwnedSite {
  id: string;
  name: string;
  subdomain: string;
  styleKit: StyleKit;
}

export interface EditorPageOptions {
  siteId: string;
  siteName: string;
  subdomain: string;
  styleKit: StyleKit;
  context?: 'dashboard' | 'public';
  clerkPublishableKey?: string;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSite | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const siteRow = await database
    .select({
      id: site.id,
      name: site.name,
      subdomain: site.subdomain,
      styleKit: site.styleKit,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  return siteRow[0] ?? null;
}

export function editorPageJsx(opts: EditorPageOptions) {
  const { siteId, siteName, subdomain, styleKit, context = 'dashboard', clerkPublishableKey } = opts;
  const apiBase = context === 'public' ? '/__api' : '/api';
  const inlineScript = canvasClientScript({ siteId, apiBase });
  const publicAddress = `${subdomain}.rev01.aayushman.dev`;

  const breadcrumbs =
    context === 'public' ? (
      <span class="crumbs">
        <a href={`/`} style="color: inherit; text-decoration: none;">
          {publicAddress}
        </a>
        <span class="sep">/</span>
        <span class="here">editing</span>
      </span>
    ) : (
      <span class="crumbs">
        <span>rev01</span>
        <span class="sep">/</span>
        <a href="/dashboard" style="color: inherit; text-decoration: none;">
          dashboard
        </a>
        <span class="sep">/</span>
        <span class="here">{siteName}</span>
      </span>
    );

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>rev01 — editing {siteName}</title>
        <style>{raw(canvasEditorStyles)}</style>
        {clerkPublishableKey && raw(`<script>
(function(){
  var pk = "${clerkPublishableKey}";
  var raw = atob(pk.replace(/^pk_(test|live)_/, ""));
  if (raw.endsWith("$")) raw = raw.slice(0, -1);
  var s = document.createElement("script");
  s.src = "https://" + raw + "/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";
  s.crossOrigin = "anonymous";
  s.async = true;
  s.onload = function() { if (window.Clerk) window.Clerk.load(); };
  document.head.appendChild(s);
})();
</script>`)}
      </head>
      <body>
        <main class="rev01-editor" data-style-kit={styleKit}>
          <header class="rev01-editor-topbar">
            {breadcrumbs}
            <span class="address">{publicAddress}</span>
            <span class="spacer" />
            <button id="canvas-save" type="button">
              Save
            </button>
            <button id="canvas-publish" type="button">
              Publish
            </button>
            <button id="canvas-save-template" type="button">
              Save as template
            </button>
            {/* Presence indicator — visible only when count > 1. The DO
                broadcasts `{ type: "presence", count }` over the same /__live
                WebSocket used by the visitor live-update path. The client
                script unhides this element when count > 1 and removes it
                when count drops back to 1. */}
            <span
              data-rev01-presence
              hidden
              role="status"
              aria-live="polite"
              aria-label="People viewing"
            >
              <span data-rev01-presence-count>0</span> viewing
            </span>
          </header>
          <aside id="canvas-sidebar" class="rev01-editor-sidebar" aria-label="Canvas tools">
            <button type="button" class="sidebar-toggle" id="sidebar-toggle" aria-label="Toggle sidebar" title="Toggle sidebar">&#x2039;</button>
            <div class="rev01-sidebar-tabs" role="tablist" aria-label="Canvas tools">
              <button
                type="button"
                class="active"
                role="tab"
                aria-selected="true"
                data-sidebar-tab="add"
              >
                Add
              </button>
              <button type="button" role="tab" aria-selected="false" data-sidebar-tab="sections">
                Sections
              </button>
              <button type="button" role="tab" aria-selected="false" data-sidebar-tab="pages">
                Pages
              </button>
            </div>
            <div
              class="rev01-sidebar-panel"
              role="tabpanel"
              aria-label="Add"
              data-sidebar-panel="add"
            >
              <section class="rev01-sidebar-group">
                <h2>Sections</h2>
                <button
                  type="button"
                  class="rev01-sidebar-command"
                  data-sidebar-add-section="blank"
                >
                  Blank section
                </button>
              </section>
              <section class="rev01-sidebar-group">
                <h2>Components</h2>
                <div class="rev01-sidebar-command-grid">
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="text"
                  >
                    Text
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="image"
                  >
                    Image
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="video"
                  >
                    Video
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="action"
                  >
                    Button
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="shape"
                  >
                    Shape
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="container"
                  >
                    Container
                  </button>
                  <button
                    type="button"
                    class="rev01-sidebar-command"
                    data-sidebar-add-component="chart"
                  >
                    Chart
                  </button>
                </div>
              </section>
              <section class="rev01-sidebar-group">
                <h2>Colors</h2>
                <div class="rev01-sidebar-kit-grid" role="group" aria-label="Style kit">
                  {BUILT_IN_STYLE_KITS.map((kit) => {
                    const isActive = kit === styleKit;
                    return (
                      <button
                        type="button"
                        data-sidebar-style-kit={kit}
                        class={isActive ? 'active' : ''}
                        aria-pressed={isActive ? 'true' : 'false'}
                      >
                        {kit}
                      </button>
                    );
                  })}
                </div>
              </section>
              <section id="canvas-sidebar-selection" class="rev01-sidebar-group" hidden />
            </div>
            <div
              class="rev01-sidebar-panel"
              role="tabpanel"
              aria-label="Sections"
              data-sidebar-panel="sections"
              hidden
            >
              <div class="rev01-section-picker" data-section-picker-root>
                <p class="rev01-section-picker-empty">Loading sections…</p>
              </div>
            </div>
            <div
              class="rev01-sidebar-panel"
              role="tabpanel"
              aria-label="Pages"
              data-sidebar-panel="pages"
              hidden
            >
              <div class="rev01-page-list" id="canvas-page-list"></div>
              <button
                class="rev01-sidebar-action"
                id="canvas-add-page"
                type="button"
              >
                + New Page
              </button>
            </div>
          </aside>
          <div id="canvas-root" data-site-id={siteId} />
          <aside id="canvas-inspector" hidden />
          <footer class="rev01-editor-status">
            <span id="canvas-status">Ready</span>
          </footer>
        </main>
        {raw(`<script>${CO_EDIT_BUNDLE}</script>`)}
        {raw(`<script type="module">${inlineScript}</script>`)}
      </body>
    </html>
  );
}

canvasEditor.get('/sites/:siteId/edit', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('canvas editor route reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  if (!siteId || !SITE_ID_RE.test(siteId)) {
    return c.text('site not found', 404);
  }

  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found', 404);
  }

  const { publishableKey } = resolveClerkKeys(c.env);
  return c.html(
    editorPageJsx({
      siteId: owned.id,
      siteName: owned.name,
      subdomain: owned.subdomain,
      styleKit: owned.styleKit,
      context: 'dashboard',
      clerkPublishableKey: publishableKey,
    }),
  );
});

export default canvasEditor;
