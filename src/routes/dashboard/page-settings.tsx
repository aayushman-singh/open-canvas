// src/routes/dashboard/page-settings.tsx
//
// Wishlist #21 — Owner SEO panel for a single page.
//
// Surfaces the per-page SEO fields (title, description, ogImageAssetId,
// canonical, noIndex, locale) plus the site-level `siteNoIndex` switch in
// one dashboard surface. The fields map 1:1 to `CanvasPage` SEO fields
// declared in `src/canvas/schema.ts`; the renderer (`emitPageMeta`)
// reads exactly the same shape.
//
// Mount point — `GET /dashboard/sites/:siteId/pages/:pageId/seo`. The
// main thread wires this in `src/index.ts` after the Wave 3 merge (the
// brief forbids this file from editing `src/index.ts`).
//
// Form submission: the page POSTs back to the same path. Persistence
// goes through the canvas API the same way other editor-side mutations
// do — see the brief's "Files forbidden" note: this surface only
// renders the UI; the canvas API + publish flow remain untouched.
// The inline client script posts a JSON patch to the canvas state
// endpoint; the actual server route handler is intentionally left as
// a follow-up wire-up by the main thread integration step, so this
// file owns only the dashboard render.
//
// Char limit warnings (60 title / 160 description) are SOFT — the
// renderer never truncates. The editor surface flags but does not
// reject input.

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type { CanvasPage, CanvasSiteState } from '../../canvas/schema';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { DashboardShell } from './shell';
import { Button, Card } from '../../ui';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const pageSettingsRoute = new Hono<Env>();

pageSettingsRoute.use('*', clerkAuth());
pageSettingsRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }
  form.seo {
    display: grid;
    gap: 14px;
  }
  form.seo label {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  form.seo input[type="text"],
  form.seo input[type="url"],
  form.seo textarea {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
    font-family: inherit;
  }
  form.seo textarea {
    min-height: 90px;
    resize: vertical;
  }
  form.seo .row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--text);
  }
  form.seo .row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  form.seo .charcount {
    color: var(--faint);
    font-size: 12px;
    margin-top: 2px;
  }
  form.seo .charcount.warn {
    color: #fbbf24;
  }
  form.seo .save-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }
  .err {
    margin-top: 4px;
    color: #fca5a5;
    font-size: 13px;
    min-height: 18px;
  }
  .ok {
    margin-top: 4px;
    color: #86efac;
    font-size: 13px;
    min-height: 18px;
  }
`;

interface OwnedPageContext {
  siteId: string;
  siteName: string;
  page: CanvasPage;
  siteNoIndex: boolean;
}

async function lookupOwnedPage(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
  pageId: string,
): Promise<OwnedPageContext | null> {
  const database = db(env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, clerkUserId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) return null;

  const rows = await database
    .select({
      id: site.id,
      name: site.name,
      editableState: site.editableState,
    })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const state = row.editableState as CanvasSiteState | null;
  if (!state) return null;
  const page = state.pages.find((p) => p.id === pageId);
  if (!page) return null;
  return {
    siteId: row.id,
    siteName: row.name,
    page,
    siteNoIndex: state.siteNoIndex === true,
  };
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

function clientScript(siteId: string, pageId: string): string {
  const sid = JSON.stringify(siteId);
  const pid = JSON.stringify(pageId);
  return String.raw`
(() => {
  const SITE_ID = ${sid};
  const PAGE_ID = ${pid};
  const form = document.querySelector('form.seo');
  if (!form) return;
  const err = document.querySelector('.err');
  const ok = document.querySelector('.ok');
  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }

  // Soft char-limit warnings: 60 chars for title, 160 for description.
  function wireCount(inputName, limit) {
    const input = form.querySelector('[name="' + inputName + '"]');
    const counter = form.querySelector('[data-count-for="' + inputName + '"]');
    if (!input || !counter) return;
    function update() {
      const n = input.value.length;
      counter.textContent = n + ' / ' + limit;
      counter.classList.toggle('warn', n > limit);
    }
    input.addEventListener('input', update);
    update();
  }
  wireCount('title', 60);
  wireCount('description', 160);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const data = {
      title: form.title.value.trim(),
      description: form.description.value.trim(),
      ogImageAssetId: form.ogImageAssetId.value.trim(),
      canonical: form.canonical.value.trim(),
      noIndex: form.noIndex.checked,
      locale: form.locale.value.trim(),
    };
    if (data.title.length === 0) {
      showError('Title is required.');
      if (button) button.disabled = false;
      return;
    }
    try {
      const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/pages/' + encodeURIComponent(PAGE_ID) + '/seo', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e) {
      showError('Network error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (button) button.disabled = false;
    }
  });
})();

// -- Metadata form (page metadata for collections) --
(() => {
  const SITE_ID = ${sid};
  const PAGE_ID = ${pid};
  const form = document.querySelector('#metadata-form');
  if (!form) return;
  const err = form.querySelector('.err');
  const ok = form.querySelector('.ok');
  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    const rawTags = form.tags.value.trim();
    const data = {
      publishedDate: form.publishedDate.value.trim() || null,
      author: form.author.value.trim() || null,
      tags: rawTags.length > 0 ? rawTags.split(',').map(t => t.trim()).filter(Boolean) : null,
      category: form.category.value.trim() || null,
    };
    try {
      const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/pages/' + encodeURIComponent(PAGE_ID) + '/metadata', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        showError(detail);
        if (button) button.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e) {
      showError('Network error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (button) button.disabled = false;
    }
  });
})();
`;
}

pageSettingsRoute.get('/sites/:siteId/pages/:pageId/seo', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('page-settings route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  const pageId = c.req.param('pageId');
  if (!siteId || !pageId) {
    return c.text('page not found', 404);
  }
  const owned = await lookupOwnedPage(c.env, auth.userId, siteId, pageId);
  if (!owned) {
    return c.text('page not found', 404);
  }

  const { page, siteName, siteNoIndex } = owned;
  const titleVal = esc(page.title);
  const descriptionVal = esc(page.description ?? '');
  const ogImageVal = esc(page.ogImageAssetId ?? '');
  const canonicalVal = esc(page.canonical ?? '');
  const localeVal = esc(page.locale ?? '');
  const publishedDateVal = esc(page.publishedDate ?? '');
  const authorVal = esc(page.author ?? '');
  const tagsVal = esc((page.tags ?? []).join(', '));
  const categoryVal = esc(page.category ?? '');

  return c.html(
    <DashboardShell
      title={`${siteName} — ${page.title} — SEO`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: siteName },
        { label: `${page.title} — SEO` },
      ]}
      pageStyles={pageStyles}
    >
      <h1>SEO &amp; metadata</h1>
      <p class="lede">
        How this page appears in search results and social-card unfurls.
        Sharing the published URL on Slack / Twitter / LinkedIn uses these fields.
      </p>

      {siteNoIndex ? (
        <Card style="border-color: rgba(251, 191, 36, 0.5);">
          <h2>Site is set to noindex</h2>
          <p class="sub">
            The site-level <code>siteNoIndex</code> switch is on, so every page
            in this site emits <code>noindex,nofollow</code> regardless of the
            per-page setting below. Turn it off in site settings to expose
            pages individually.
          </p>
        </Card>
      ) : null}

      <Card>
        <h2>Page meta</h2>
        <p class="sub">
          The page title doubles as the browser tab title and the social-card
          headline. Description shows in search snippets and unfurl cards.
        </p>
        <form class="seo" autocomplete="off">
          <label>
            <span>Title</span>
            <input
              type="text"
              name="title"
              value={titleVal}
              required
              maxlength={200}
            />
            <span class="charcount" data-count-for="title">0 / 60</span>
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" maxlength={500}>{raw(descriptionVal)}</textarea>
            <span class="charcount" data-count-for="description">0 / 160</span>
          </label>
          <label>
            <span>OG image asset id</span>
            <input
              type="text"
              name="ogImageAssetId"
              value={ogImageVal}
              placeholder="leave blank to use the auto-generated card"
            />
          </label>
          <label>
            <span>Canonical URL</span>
            <input
              type="url"
              name="canonical"
              value={canonicalVal}
              placeholder="leave blank to use the page's own URL"
            />
          </label>
          <label>
            <span>Locale (BCP-47)</span>
            <input
              type="text"
              name="locale"
              value={localeVal}
              placeholder="en, fr, ar — defaults to site default"
              maxlength={20}
            />
          </label>
          <div class="row">
            <input
              type="checkbox"
              name="noIndex"
              id="noIndex"
              checked={page.noIndex === true}
            />
            <label for="noIndex" style="color: var(--text); font-size: 14px;">
              Hide this page from search engines (<code>noindex,nofollow</code>)
            </label>
          </div>
          <div class="save-row">
            <Button variant="primary" type="submit">Save</Button>
          </div>
          <p class="err" role="alert" aria-live="polite"></p>
          <p class="ok" role="status" aria-live="polite"></p>
        </form>
      </Card>

      <Card>
        <h2>Page metadata</h2>
        <p class="sub">
          Used by page-bound collections for filtering, sorting, and display.
          These fields are optional — fill them in when this page should appear
          in collection listings (blog, portfolio, etc.).
        </p>
        <form class="seo" id="metadata-form" autocomplete="off">
          <label>
            <span>Published date</span>
            <input
              type="date"
              name="publishedDate"
              value={publishedDateVal}
            />
          </label>
          <label>
            <span>Author</span>
            <input
              type="text"
              name="author"
              value={authorVal}
              maxlength={200}
            />
          </label>
          <label>
            <span>Tags (comma-separated)</span>
            <input
              type="text"
              name="tags"
              value={tagsVal}
              maxlength={500}
              placeholder="design, launch, case-study"
            />
          </label>
          <label>
            <span>Category</span>
            <input
              type="text"
              name="category"
              value={categoryVal}
              maxlength={100}
              placeholder="blog, portfolio, news"
            />
          </label>
          <div class="save-row">
            <Button variant="primary" type="submit">Save metadata</Button>
          </div>
          <p class="err" role="alert" aria-live="polite"></p>
          <p class="ok" role="status" aria-live="polite"></p>
        </form>
      </Card>

      <script type="module">{raw(clientScript(siteId, pageId))}</script>
    </DashboardShell>,
  );
});

export default pageSettingsRoute;
