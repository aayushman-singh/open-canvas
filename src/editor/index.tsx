// Editor route — GET /dashboard/sites/:siteId/pages/:pageId/edit
//
// Server-renders the editor shell (Post-Aero chrome + #editor + #avatars +
// importmap + bootstrap script). All multiplayer logic runs in-browser; this
// route's only job is to gate auth and ship HTML.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../auth/middleware';
import { requireAuth } from '../auth/require-auth';
import { db } from '../db/client';
import { customer, page, site } from '../db/schema';
import { buildImportMap, editorClientScript, ESM_PINS, type ClientScriptParams } from './client';
import { Y_XML_FRAGMENT_NAME } from '../multiplayer/pm-schema';
import { editorStyles } from './styles';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const editor = new Hono<Env>();

editor.use('*', clerkAuth());
editor.use('*', requireAuth());

interface OwnedPage {
  pageId: string;
  pageTitle: string;
  siteId: string;
  siteName: string;
}

async function lookupOwnedPage(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
  pageId: string,
): Promise<OwnedPage | null> {
  const database = db(env);
  const rows = await database
    .select({
      pageId: page.id,
      pageTitle: page.title,
      siteId: site.id,
      siteName: site.name,
    })
    .from(page)
    .innerJoin(site, eq(site.id, page.siteId))
    .innerJoin(customer, eq(customer.id, site.customerId))
    .where(and(eq(page.id, pageId), eq(site.id, siteId), eq(customer.clerkUserId, clerkUserId)))
    .limit(1);
  return rows[0] ?? null;
}

editor.get('/sites/:siteId/pages/:pageId/edit', async (c) => {
  const auth = c.get('auth');
  const user = c.get('user');
  if (!auth.userId || !user) {
    throw new Error('editor route reached without an authenticated user');
  }

  const siteId = c.req.param('siteId');
  const pageId = c.req.param('pageId');
  if (!siteId || !pageId) {
    return c.text('missing route params', 400);
  }

  const owned = await lookupOwnedPage(c.env, auth.userId, siteId, pageId);
  if (!owned) {
    return c.text('page not found or not owned by current user', 404);
  }

  const requestUrl = new URL(c.req.url);
  const wsScheme = requestUrl.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${wsScheme}://${requestUrl.host}/api/pages`;

  const userName =
    user.firstName ?? user.username ?? user.emailAddresses[0]?.emailAddress ?? 'editor';
  const userInitial = (userName || 'E').slice(0, 1).toUpperCase();
  const userColor = pickUserColor(user.id);

  const scriptParams: ClientScriptParams = {
    pageId,
    wsUrl,
    userId: user.id,
    userName,
    userInitial,
    userColor,
    yFragmentName: Y_XML_FRAGMENT_NAME,
  };
  const inlineScript = editorClientScript(scriptParams);
  const importMap = buildImportMap();

  return c.html(
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="dark" />
        <title>rev01 — editing {owned.pageTitle}</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
        />
        <style>{raw(editorStyles)}</style>
        {raw(`<script type="importmap">${importMap}</script>`)}
      </head>
      <body>
        <main>
          <div class="topbar">
            <span class="status connecting" data-status>
              <span class="dot" />
              <span class="k">SOCKET</span>
              <span class="v" data-status-label>
                connecting
              </span>
            </span>
            <span class="crumbs">
              <span>rev01</span>
              <span class="sep">/</span>
              <span>{owned.siteName}</span>
              <span class="sep">/</span>
              <span class="here">{owned.pageTitle}</span>
            </span>
            <span class="avatars" id="avatars" aria-label="connected editors" />
            <a href="/dashboard" class="back">
              back to dashboard
            </a>
          </div>

          <section class="editor-shell">
            <div class="titlebar">
              <span class="glyphs">
                <span class="glyph close" />
                <span class="glyph min" />
                <span class="glyph max" />
              </span>
              <span class="path">
                <span class="accent">~/rev01</span>/sites/{owned.siteName}/{owned.pageTitle}
              </span>
              <span class="right">collab // yjs / DO</span>
            </div>
            <div class="editor-body">
              <div id="editor" />
            </div>
          </section>

          <div class="statusline">
            <span class="k">page</span>
            <span class="v">{pageId.slice(0, 8)}</span>
            <span class="sep">·</span>
            <span class="k">peers</span>
            <span class="v" data-peers>
              0
            </span>
            <span class="sep">·</span>
            <span class="k">local ops</span>
            <span class="v" data-ops>
              0
            </span>
            <span class="sep">·</span>
            <span class="k">tiptap</span>
            <span class="v">{ESM_PINS['@tiptap/core']}</span>
            <span class="sep">·</span>
            <span class="k">yjs</span>
            <span class="v">{ESM_PINS.yjs}</span>
          </div>
        </main>
        {raw(`<script type="module">${inlineScript}</script>`)}
      </body>
    </html>,
  );
});

// Deterministic colour from Clerk user id — hash to hue, fix OKLCH chroma+L.
function pickUserColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i += 1) {
    h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return `oklch(0.74 0.16 ${hue})`;
}

// keep html import used so the build tracks it
void html;

export default editor;
