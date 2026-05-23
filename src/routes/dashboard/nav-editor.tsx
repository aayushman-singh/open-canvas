// src/routes/dashboard/nav-editor.tsx
//
// Wave 4 #16 — site-level nav editor.
//
// Mounts at GET /dashboard/sites/:siteId/nav. One surface per site; the nav
// lives once on the site as a SymbolMaster (see src/symbols/nav-bootstrap.ts)
// and renders on every page through a Symbol Instance, so editing it here
// propagates everywhere automatically. There is intentionally NO per-page
// nav editor — the open-question in the brief is decided in favour of
// "one site-wide nav, suppress-per-page by deleting the instance" (see
// `removeSiteNavFromPage` in nav-bootstrap.ts and the design note at the
// end of this file).
//
// ---------------------------------------------------------------------------
// PAGE LAYOUT
//
//   1. "Site nav" card — top-level controls:
//        - layout selector (left-center-right / left-right)
//        - sticky toggle
//        - logo asset id (free-text for the POC; Wave 2 asset picker can plug
//          in later)
//   2. "Links" card — ordered list of link rows:
//        - label
//        - kind (internal / external)
//        - href: a dropdown of `state.pages[].slug` when kind === 'internal',
//          a URL input when kind === 'external'
//        - remove button per row
//        - "Add link" button appends a fresh empty row
//   3. Save button — POSTs the whole config to
//      `PUT /api/canvas/sites/:siteId/nav`. The main thread wires that
//      endpoint (the brief forbids this file from editing `src/index.ts`);
//      this surface only renders the UI + the submit script. When the API
//      lands, the handler calls `ensureSiteNavSymbol(state)` then
//      `updateSymbolMaster(state, SITE_NAV_SYMBOL_ID, { section: <new> })`
//      with a fresh master section whose first element is the edited
//      NavElement.
//
// ---------------------------------------------------------------------------
// FAILURE POSTURE
//
// The submit handler shows a loud error message on non-2xx response. No
// silent retry, no fallback to a cached value. The "all-or-nothing" posture
// from the user's global preferences is preserved client-side.
//
// ---------------------------------------------------------------------------
// SCOPE
//
// This file owns:
//   - The dashboard surface (server-rendered HTML + the inline client script).
//   - The shape of the JSON payload submitted to the API endpoint.
//
// This file does NOT:
//   - Mutate `editableState` directly — that path goes through the API.
//   - Touch the canvas editor (`src/editor/canvas-client.ts` is owned by
//     Wave 4 #18; we deliberately stay clear of it per the brief).

import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { raw } from 'hono/html';
import { clerkAuth, type ClerkAuthVariables } from '../../auth/middleware';
import { requireAuth } from '../../auth/require-auth';
import type {
  CanvasPage,
  CanvasSiteState,
} from '../../canvas/schema';
import type { NavElement, NavLayout, NavLink } from '../../canvas/elements/nav';
import { SITE_NAV_SYMBOL_ID } from '../../canvas/elements/nav';
import { SITE_NAV_INNER_ELEMENT_ID } from '../../symbols/nav-bootstrap';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { DashboardShell } from './shell';

interface Bindings {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
}

type Env = { Bindings: Bindings; Variables: ClerkAuthVariables };

export const navEditorRoute = new Hono<Env>();

navEditorRoute.use('*', clerkAuth());
navEditorRoute.use('*', requireAuth());

const pageStyles = `
  .lede { margin: 8px 0 24px; color: var(--muted); max-width: 640px; line-height: 1.55; }
  .card {
    padding: 20px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--panel);
    margin-bottom: 18px;
  }
  .card h2 {
    margin: 0 0 6px;
    font-size: 18px;
    letter-spacing: -0.005em;
  }
  .card .sub {
    margin: 0 0 16px;
    color: var(--muted);
    font-size: 13.5px;
    line-height: 1.55;
  }
  form.nav-config {
    display: grid;
    gap: 14px;
  }
  form.nav-config label.field {
    display: grid;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
  }
  form.nav-config input[type="text"],
  form.nav-config input[type="url"],
  form.nav-config select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 10px 12px;
    font-size: 15px;
    font-family: inherit;
  }
  form.nav-config .row {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 14px;
    color: var(--text);
  }
  form.nav-config .row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
  }
  .links-list {
    display: grid;
    gap: 10px;
  }
  .link-row {
    display: grid;
    grid-template-columns: 1.4fr 0.9fr 2fr auto;
    gap: 8px;
    align-items: end;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
  }
  .link-row label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--faint);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .link-row input,
  .link-row select {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: #0c1220;
    color: var(--text);
    padding: 8px 10px;
    font-size: 14px;
    font-family: inherit;
  }
  .link-row button.remove {
    border: 1px solid var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 8px 10px;
    height: fit-content;
    align-self: end;
  }
  .link-row button.remove:hover {
    color: #fca5a5;
    border-color: rgba(252, 165, 165, 0.4);
  }
  .add-link {
    border: 1px dashed var(--line);
    border-radius: 6px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    padding: 10px;
    width: 100%;
    font-size: 13px;
  }
  .add-link:hover { color: var(--text); border-color: var(--accent); }
  .save-row {
    display: flex;
    gap: 10px;
    align-items: center;
    margin-top: 6px;
  }
  form.nav-config button.save {
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: #05111a;
    padding: 11px 16px;
    font-weight: 700;
    cursor: pointer;
  }
  form.nav-config button.save[disabled] { opacity: 0.5; cursor: not-allowed; }
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
  .empty-state {
    color: var(--faint);
    padding: 18px;
    text-align: center;
    border: 1px dashed var(--line);
    border-radius: 6px;
    font-size: 13px;
  }
`;

interface OwnedSiteContext {
  siteId: string;
  siteName: string;
  state: CanvasSiteState;
  nav: NavElement | null;
}

async function lookupOwnedSite(
  env: Bindings,
  clerkUserId: string,
  siteId: string,
): Promise<OwnedSiteContext | null> {
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

  // The nav lives on the master with id SITE_NAV_SYMBOL_ID. When the Owner
  // has not yet added a nav, the master is absent — the editor renders the
  // empty starting state and saves bootstrap the master on first submit.
  const master = state.symbols.find((s) => s.id === SITE_NAV_SYMBOL_ID);
  let navElement: NavElement | null = null;
  if (master) {
    const inner = master.section.elements.find((e) => e.id === SITE_NAV_INNER_ELEMENT_ID);
    if (inner && inner.type === 'nav') navElement = inner;
  }

  return {
    siteId: row.id,
    siteName: row.name,
    state,
    nav: navElement,
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

function clientScript(siteId: string, pageSlugs: string[]): string {
  const sid = JSON.stringify(siteId);
  const slugs = JSON.stringify(pageSlugs);
  return String.raw`
(() => {
  const SITE_ID = ${sid};
  const PAGE_SLUGS = ${slugs};
  const form = document.querySelector('form.nav-config');
  if (!form) return;
  const list = form.querySelector('.links-list');
  const addBtn = form.querySelector('.add-link');
  const err = form.querySelector('.err');
  const ok = form.querySelector('.ok');

  function clearStatus() {
    if (err) err.textContent = '';
    if (ok) ok.textContent = '';
  }
  function showError(msg) { clearStatus(); if (err) err.textContent = msg; }
  function showOk(msg) { clearStatus(); if (ok) ok.textContent = msg; }

  function escAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function internalOptionsHtml(selectedHref) {
    const sel = (slug) => '/' + slug === selectedHref ? ' selected' : '';
    return PAGE_SLUGS.map((slug) => '<option value="/' + escAttr(slug) + '"' + sel(slug) + '>/' + escAttr(slug) + '</option>').join('');
  }

  function buildLinkRow(link) {
    const row = document.createElement('div');
    row.className = 'link-row';
    const kind = link && link.kind === 'external' ? 'external' : 'internal';
    const label = link && typeof link.label === 'string' ? link.label : '';
    const href = link && typeof link.href === 'string' ? link.href : '';

    const internalHref = kind === 'internal' && href.length > 0 ? href : (PAGE_SLUGS[0] ? '/' + PAGE_SLUGS[0] : '');
    const externalHref = kind === 'external' ? href : '';

    row.innerHTML = ''
      + '<label><span>Label</span><input type="text" name="label" value="' + escAttr(label) + '" placeholder="Home" /></label>'
      + '<label><span>Kind</span>'
      + '  <select name="kind">'
      + '    <option value="internal"' + (kind === 'internal' ? ' selected' : '') + '>Internal</option>'
      + '    <option value="external"' + (kind === 'external' ? ' selected' : '') + '>External</option>'
      + '  </select>'
      + '</label>'
      + '<label class="href-cell"><span>Target</span>'
      + (kind === 'internal'
          ? '<select name="href">' + internalOptionsHtml(internalHref) + '</select>'
          : '<input type="url" name="href" value="' + escAttr(externalHref) + '" placeholder="https://example.com" />'
        )
      + '</label>'
      + '<button type="button" class="remove" aria-label="Remove link">Remove</button>';

    const kindSelect = row.querySelector('select[name="kind"]');
    const hrefCell = row.querySelector('.href-cell');
    kindSelect.addEventListener('change', () => {
      const newKind = kindSelect.value;
      const span = hrefCell.querySelector('span');
      const oldCtl = hrefCell.querySelector('[name="href"]');
      const oldVal = oldCtl ? oldCtl.value : '';
      if (oldCtl) oldCtl.remove();
      if (newKind === 'internal') {
        const sel = document.createElement('select');
        sel.name = 'href';
        sel.innerHTML = internalOptionsHtml(oldVal && oldVal.startsWith('/') ? oldVal : (PAGE_SLUGS[0] ? '/' + PAGE_SLUGS[0] : ''));
        hrefCell.appendChild(sel);
      } else {
        const inp = document.createElement('input');
        inp.type = 'url';
        inp.name = 'href';
        inp.placeholder = 'https://example.com';
        inp.value = oldVal && !oldVal.startsWith('/') ? oldVal : '';
        hrefCell.appendChild(inp);
      }
      void span;
    });

    row.querySelector('button.remove').addEventListener('click', () => {
      row.remove();
    });
    return row;
  }

  // Render initial rows from server-supplied data-* on the list element.
  try {
    const seed = JSON.parse(list.dataset.seed || '[]');
    for (const link of seed) list.appendChild(buildLinkRow(link));
  } catch (_) { /* corrupt seed: render empty */ }

  if (addBtn) {
    addBtn.addEventListener('click', () => {
      list.appendChild(buildLinkRow({ label: '', href: '', kind: 'internal' }));
    });
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();
    const saveBtn = form.querySelector('button.save');
    if (saveBtn) saveBtn.disabled = true;

    const layout = form.querySelector('select[name="layout"]').value;
    const sticky = form.querySelector('input[name="sticky"]').checked;
    const logoAssetId = form.querySelector('input[name="logoAssetId"]').value.trim();

    const links = [];
    const rows = list.querySelectorAll('.link-row');
    for (const row of rows) {
      const label = row.querySelector('input[name="label"]').value.trim();
      const kind = row.querySelector('select[name="kind"]').value;
      const href = row.querySelector('[name="href"]').value.trim();
      if (label.length === 0 || href.length === 0) {
        showError('Every link needs a label and a target.');
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      links.push({ label, kind, href });
    }

    const payload = {
      layout,
      sticky,
      logoAssetId: logoAssetId.length > 0 ? logoAssetId : null,
      links,
    };

    try {
      const response = await fetch('/api/canvas/sites/' + encodeURIComponent(SITE_ID) + '/nav', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        let detail = response.statusText;
        try {
          const body = await response.json();
          if (body && body.error) detail = body.error;
        } catch (_) { /* noop */ }
        showError(detail);
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      showOk('Saved.');
    } catch (e) {
      showError('Network error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });
})();
`;
}

navEditorRoute.get('/sites/:siteId/nav', async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('nav-editor route reached without an authenticated user');
  }
  const siteId = c.req.param('siteId');
  if (!siteId) {
    return c.text('site not found', 404);
  }
  const owned = await lookupOwnedSite(c.env, auth.userId, siteId);
  if (!owned) {
    return c.text('site not found', 404);
  }

  const { state, siteName, nav } = owned;
  const layout: NavLayout = nav?.layout ?? 'left-center-right';
  const sticky: boolean = nav?.sticky ?? false;
  const logoAssetId: string = nav?.logoAssetId ?? '';
  const links: NavLink[] = nav?.links ?? [];

  // Slugs for the internal link picker. We pass them to the client script
  // verbatim — the editor cannot pick a slug that does not exist.
  const pageSlugs: string[] = state.pages.map((p: CanvasPage) => p.slug);

  return c.html(
    <DashboardShell
      title={`${siteName} — Site nav`}
      crumbs={[
        { href: '/dashboard', label: 'Dashboard' },
        { href: `/dashboard/sites/${esc(siteId)}/edit`, label: siteName },
        { label: 'Site nav' },
      ]}
      pageStyles={pageStyles}
    >
      <h1>Site nav</h1>
      <p class="lede">
        The site nav is one bar that appears on every page. Edit it once here
        and the change rolls out across the whole site. To hide the bar on a
        specific page, delete its nav instance from the canvas editor for that
        page.
      </p>

      <section class="card">
        <h2>Bar configuration</h2>
        <p class="sub">
          Layout slots, sticky behaviour, and the optional logo. Layout
          `left-center-right` reserves a third slot for a future CTA.
        </p>
        <form class="nav-config" autocomplete="off">
          <label class="field">
            <span>Layout</span>
            <select name="layout">
              <option value="left-center-right" selected={layout === 'left-center-right'}>
                left / center / right (logo · links · cta)
              </option>
              <option value="left-right" selected={layout === 'left-right'}>
                left / right (logo · links)
              </option>
            </select>
          </label>
          <label class="field">
            <span>Logo asset id</span>
            <input
              type="text"
              name="logoAssetId"
              value={esc(logoAssetId)}
              placeholder="leave blank for no logo"
            />
          </label>
          <div class="row">
            <input
              type="checkbox"
              name="sticky"
              id="sticky"
              checked={sticky}
            />
            <label for="sticky" style="color: var(--text); font-size: 14px;">
              Stick the bar to the top of the viewport on scroll
            </label>
          </div>

          <h2 style="margin-top: 18px;">Links</h2>
          <p class="sub">
            Internal links route to one of this site&rsquo;s pages by slug.
            External links open in a new tab with <code>rel="noopener"</code>.
          </p>

          <div
            class="links-list"
            data-seed={raw(esc(JSON.stringify(links)))}
          ></div>

          {pageSlugs.length === 0 ? (
            <p class="empty-state">
              This site has no pages yet — internal links will have nothing to
              point at. Add a page first.
            </p>
          ) : null}

          <button type="button" class="add-link">+ Add link</button>

          <div class="save-row">
            <button type="submit" class="save">Save</button>
          </div>
          <p class="err" role="alert" aria-live="polite"></p>
          <p class="ok" role="status" aria-live="polite"></p>
        </form>
      </section>

      <section class="card">
        <h2>Per-page suppression</h2>
        <p class="sub">
          The schema is intentionally narrow — pages do not carry a
          <code>hideSiteNav</code> flag. To omit the bar on a specific page,
          open that page in the canvas editor and delete the nav instance
          from it. Saving link or layout changes here updates the shared bar
          without touching individual page placements, so a deletion stays
          deleted. Adding the bar back to a page that had it removed is an
          explicit &ldquo;Show site nav here&rdquo; action on that page.
        </p>
      </section>

      <script type="module">{raw(clientScript(siteId, pageSlugs))}</script>
    </DashboardShell>,
  );
});

export default navEditorRoute;
