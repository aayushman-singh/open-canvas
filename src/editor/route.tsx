// Canvas editor route — GET /dashboard/sites/:siteId/edit
//
// Server-renders the desktop Canvas Editor shell: header (crumbs, address
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
import { clerkFrontendApiHost, requireAuth } from '../auth/require-auth';
import { BUILT_IN_STYLE_KITS, type StyleKit } from '../canvas/schema';
import { SIDEBAR_DISPATCH } from '../canvas/elements';
import { SITE_ID_RE } from '../canvas/validate';
import { canvasClientScript } from './canvas-client';
import { canvasEditorStyles } from './canvas-styles';
import {
  themeBootScript,
  themeFontHeadHtml,
  themeToggleScript,
  readThemeCookie,
} from '../ui/theme';
import type { Theme } from '../ui/theme';
import { CO_EDIT_BUNDLE } from '../live/co-edit/bundled';
import { signEditToken } from '../auth/edit-token';
import { db } from '../db/client';
import { customer, site } from '../db/schema';
import { appDomain, appOrigin, type HostConfigEnv } from '../host-config';

type Bindings = HostConfigEnv & {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  CLERK_FRONTEND_API_URL?: string;
  CLERK_TEST_PUBLISHABLE_KEY?: string;
  CLERK_TEST_SECRET_KEY?: string;
  DATABASE_URL: string;
  UNLOCK_SIGNING_SECRET: string;
};

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const canvasEditor = new Hono<Env>();

canvasEditor.use('*', clerkAuth());
canvasEditor.use('*', requireAuth());

interface OwnedSite {
  id: string;
  customerId: string;
  name: string;
  subdomain: string;
  styleKit: StyleKit;
}

export interface EditorPageOptions {
  siteId: string;
  siteName: string;
  subdomain: string;
  styleKit: StyleKit;
  /** Apex host (ADR 0013) — drives published-address chip and Settings link. */
  apex: string;
  /** Canonical app origin (`https://<apex>`). */
  apexOrigin: string;
  /**
   * Display name for the local presence cursor label seen by remote peers.
   * Resolved by callers from `customer.displayName` (fallback to
   * `customer.email`) for whichever customer the current session represents
   * — owner on the dashboard route, accepted collaborator on the on-site
   * editor route. Optional because the smoke / fixture builder paths don't
   * always have a real customer row.
   */
  customerDisplayName?: string;
  context?: 'dashboard' | 'public';
  clerkPublishableKey?: string;
  /**
   * Host that serves clerk-js (and against which the runtime API talks).
   * Server-resolved via `clerkFrontendApiHost` so the bundle URL doesn't
   * depend on the publishable key's encoded host — which can go stale
   * when a Clerk instance is reconfigured (rebrand domain change) without
   * re-issuing keys. Required when `clerkPublishableKey` is set.
   */
  clerkFrontendApiHost?: string;
  wsToken?: string;
  // SSR pre-paint theme stamp. Resolved from the `oc-theme` cookie by the
  // caller (see readThemeCookie). 'dark' becomes `data-theme="dark"` on
  // <html>; undefined leaves the attribute off so light (the implicit
  // default) renders without flash. The editor artboard itself stays
  // kit-token-driven regardless of chrome theme (see canvas-styles.ts).
  // The `| undefined` keeps callers free of conditional spread under
  // exactOptionalPropertyTypes.
  theme?: Theme | undefined;
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
  const row = siteRow[0];
  if (!row) return null;
  return { ...row, customerId };
}

export function editorPageJsx(opts: EditorPageOptions) {
  const {
    siteId,
    siteName,
    subdomain,
    styleKit,
    apex,
    apexOrigin,
    customerDisplayName,
    context = 'dashboard',
    clerkPublishableKey,
    clerkFrontendApiHost: clerkHost,
    wsToken,
    theme,
  } = opts;
  if (clerkPublishableKey && !clerkHost) {
    throw new Error('editorPageJsx requires clerkFrontendApiHost when clerkPublishableKey is set');
  }
  const apiBase = context === 'public' ? '/__api' : '/api';
  const inlineScript = canvasClientScript({
    siteId,
    apiBase,
    ...(wsToken ? { wsToken } : {}),
    ...(customerDisplayName ? { displayName: customerDisplayName } : {}),
  });
  const publicAddress = `${subdomain}.${apex}`;
  const settingsPath = `/dashboard/sites/${encodeURIComponent(siteId)}/settings`;
  const settingsHref =
    context === 'public'
      ? `${apexOrigin}/dashboard/sites/${encodeURIComponent(siteId)}/settings`
      : settingsPath;

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
        <span>Open Canvas</span>
        <span class="sep">/</span>
        <a href="/dashboard" style="color: inherit; text-decoration: none;">
          dashboard
        </a>
        <span class="sep">/</span>
        <span class="here">{siteName}</span>
        <span class="sep">/</span>
        <button
          type="button"
          id="canvas-page-crumb"
          class="crumb-page-switcher"
          aria-haspopup="menu"
          aria-expanded="false"
          aria-label="Switch page"
        >
          <span data-page-crumb-label>…</span>
          <span class="crumb-caret" aria-hidden="true">
            &#9662;
          </span>
        </button>
      </span>
    );

  return (
    <html lang="en" data-theme={theme === 'dark' ? 'dark' : undefined}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>Open Canvas — editing {siteName}</title>
        <script>{raw(themeBootScript)}</script>
        {raw(themeFontHeadHtml)}
        <style>{raw(canvasEditorStyles)}</style>
        {clerkPublishableKey &&
          raw(`<script>
(function(){
  var pk = ${JSON.stringify(clerkPublishableKey)};
  var s = document.createElement("script");
  s.src = "https://${clerkHost}/npm/@clerk/clerk-js@latest/dist/clerk.browser.js";
  s.crossOrigin = "anonymous";
  s.async = true;
  s.setAttribute("data-clerk-publishable-key", pk);
  s.onload = function() { if (window.Clerk) window.Clerk.load(); };
  document.head.appendChild(s);
})();
</script>`)}
      </head>
      <body>
        <main class="rev01-editor" data-style-kit={styleKit}>
          <header class="rev01-editor-header">
            {breadcrumbs}
            <span class="address">{publicAddress}</span>
            <span class="spacer" />
            <button id="canvas-chat-toggle" type="button" title="Chat with AI to edit your site">
              AI Chat
            </button>
            <a id="canvas-settings-link" href={settingsHref} title="Open site settings">
              <svg
                class="canvas-settings-gear"
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              Settings
            </a>
            <button id="canvas-save" type="button">
              Save
            </button>
            <button id="canvas-publish" type="button">
              Publish
            </button>
            {/* Persistent version badge — initial label is the draft sentinel.
                The client script swaps it to `v{n}` once the site state loads
                and again after each successful publish. Click opens an OG
                preview pill anchored to the badge so the Owner can confirm
                what social cards will render. */}
            <button id="canvas-version" type="button" data-version="0" aria-haspopup="dialog">
              v0
            </button>
            <button id="canvas-save-template" type="button">
              Save as template
            </button>
            {/* Presence indicator — visible only when count > 1. The DO
                broadcasts `{ type: "presence", count }` over the same /__live
                WebSocket used by the visitor live-update path. The client
                script unhides this element when count > 1 and removes it
                when count drops back to 1. */}
            {/* Presence pill — pre-seeded with solo (1 editing) so the
                visible state is correct from first paint. The WS callback
                overwrites this once it attaches with the real peer count. */}
            <span data-rev01-presence role="status" aria-live="polite" aria-label="People editing">
              <span data-rev01-presence-count>1</span> editing
            </span>
          </header>
          <aside id="canvas-sidebar" class="rev01-editor-sidebar" aria-label="Canvas tools">
            <button
              type="button"
              class="sidebar-toggle"
              id="sidebar-toggle"
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
            >
              &#x2039;
            </button>
            <div class="rev01-sidebar-tabs" role="tablist" aria-label="Canvas tools">
              <button
                type="button"
                class="active"
                role="tab"
                aria-selected="true"
                data-sidebar-tab="add"
                title="Add components and sections to the page"
              >
                Add
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                data-sidebar-tab="sections"
                title="Browse and reuse saved sections"
              >
                Sections
              </button>
              <button
                type="button"
                role="tab"
                aria-selected="false"
                data-sidebar-tab="pages"
                title="Manage your site pages"
              >
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
                  title="Add a new empty section to the page"
                >
                  Blank section
                </button>
              </section>
              <section class="rev01-sidebar-group">
                <h2>Components</h2>
                <div class="rev01-sidebar-command-grid">
                  {/* Sidebar grid is built from SIDEBAR_DISPATCH per ADR 0011
                      Step 3. Each element type contributes 0..N commands; the
                      previous 14 hardcoded <button> entries lived in lockstep
                      with canvas-client.ts's componentActionForSidebar +
                      handleSectionAction switches. Order follows dispatch
                      insertion order — see src/canvas/elements/index.ts. */}
                  {Object.values(SIDEBAR_DISPATCH)
                    .flatMap((spec) => spec.commands)
                    .map((cmd) => (
                      <button
                        type="button"
                        class="rev01-sidebar-command"
                        data-sidebar-add-component={cmd.key}
                        title={cmd.sidebarTip}
                      >
                        {cmd.sidebarLabel}
                      </button>
                    ))}
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
                title="Create a new page for your site"
              >
                + New Page
              </button>
            </div>
          </aside>
          <div id="canvas-root" data-site-id={siteId} />
          <aside id="canvas-inspector" hidden />
          {/* Inspector toggle — fixed-positioned sibling so it stays
              reachable when the inspector is collapsed (width:0) or
              hidden (no selection). Mirrors the existing left
              #sidebar-toggle pattern. The arrow character flips between
              ‹ (open: click to collapse) and › (collapsed: click to
              expand) via the client script. */}
          <button
            type="button"
            id="inspector-toggle"
            class="inspector-toggle"
            aria-label="Toggle inspector"
            title="Toggle inspector"
          >
            &#x203A;
          </button>
          <aside id="canvas-chat-panel" class="rev01-chat-panel" hidden>
            <div class="rev01-chat-header">
              <span>AI Chat</span>
              <button type="button" id="canvas-chat-close" title="Close chat">
                &times;
              </button>
            </div>
            <div id="canvas-chat-messages" class="rev01-chat-messages" />
            <form id="canvas-chat-form" class="rev01-chat-input">
              <input
                type="text"
                id="canvas-chat-input"
                placeholder="Ask the agent to edit your site..."
                autocomplete="off"
              />
              <button type="submit">Send</button>
            </form>
          </aside>
          <footer class="rev01-editor-status">
            <span id="canvas-status">Saved</span>
          </footer>
        </main>
        {raw(`<script>${CO_EDIT_BUNDLE}</script>`)}
        {raw(`<script type="module">${inlineScript}</script>`)}
        <script>{raw(themeToggleScript)}</script>
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

  // Pull the owner's display name (falling back to email) so the live
  // presence cursor label seen by collaborators reads as the human, not
  // "Editor <uuid-prefix>".
  const database = db(c.env);
  const ownerRow = await database
    .select({ displayName: customer.displayName, email: customer.email })
    .from(customer)
    .where(eq(customer.id, owned.customerId))
    .limit(1);
  const presenceName = ownerRow[0]?.displayName ?? ownerRow[0]?.email ?? undefined;

  const wsToken = await signEditToken(
    { siteId: owned.id, customerId: owned.customerId, clerkUserId: auth.userId },
    c.env.UNLOCK_SIGNING_SECRET,
  );

  const { publishableKey } = resolveClerkKeys(c.env);
  return c.html(
    editorPageJsx({
      siteId: owned.id,
      siteName: owned.name,
      subdomain: owned.subdomain,
      styleKit: owned.styleKit,
      apex: appDomain(c.env),
      apexOrigin: appOrigin(c.env),
      ...(presenceName ? { customerDisplayName: presenceName } : {}),
      context: 'dashboard',
      clerkPublishableKey: publishableKey,
      clerkFrontendApiHost: clerkFrontendApiHost(publishableKey, c.env.CLERK_FRONTEND_API_URL),
      wsToken,
      theme: readThemeCookie(c),
    }),
  );
});

export default canvasEditor;
