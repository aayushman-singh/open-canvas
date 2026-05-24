import { Hono } from 'hono';
import { raw } from 'hono/html';
import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client';
import { customer, site } from '../../db/schema';
import { clerkAuth } from '../../auth/middleware';
import { buildSignOutUrl, requireAuth } from '../../auth/require-auth';
import type { ClerkAuthVariables } from '../../auth/middleware';
import { DashboardShell } from './shell';
import { renderCanvasSnapshot } from '../../canvas/render';
import { canvasPublishedStyles } from '../../canvas/public-styles';
import type { PublishedSnapshot, CanvasSiteState } from '../../canvas/schema';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

export const dashboard = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

dashboard.use('*', clerkAuth());
dashboard.use('*', requireAuth());

const THUMB_SCALE = 0.24;

function formatDate(d: Date): string {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate())}`;
}

function buildThumbHtml(
  state: CanvasSiteState,
  siteId: string,
  origin: string,
): string {
  const snapshot: PublishedSnapshot = {
    version: 0,
    publishedAt: new Date().toISOString(),
    styleKit: state.styleKit,
    pages: state.pages,
    ...(state.customStyleKit ? { customStyleKit: state.customStyleKit } : {}),
    ...(state.symbols?.length ? { symbols: state.symbols } : {}),
  };
  try {
    const canvasHtml = renderCanvasSnapshot(
      snapshot,
      `/api/canvas/sites/${siteId}/assets`,
      siteId,
    );
    return [
      '<!DOCTYPE html><html><head>',
      `<base href="${origin}/">`,
      '<style>', canvasPublishedStyles, '</style>',
      '</head><body style="margin:0;overflow:hidden;background:#0a0a0a">',
      canvasHtml,
      '</body></html>',
    ].join('');
  } catch {
    return [
      '<html><body style="margin:0;background:#111;color:#555;',
      'display:flex;align-items:center;justify-content:center;',
      'height:100vh;font-family:sans-serif">',
      '<p>Preview unavailable</p></body></html>',
    ].join('');
  }
}

const cardStyles = `
  .dash-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .dash-header h1 { margin: 0; font-size: 28px; }
  .dash-header .new-site {
    font-size: 13px;
    font-weight: 500;
    padding: 6px 14px;
    border-radius: 6px;
    background: var(--accent);
    color: var(--bg);
    text-decoration: none;
  }
  .dash-header .new-site:hover { filter: brightness(0.88); }
  .dash-sub { color: var(--faint); font-size: 13px; margin: 0 0 24px; }

  .site-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 20px;
    margin: 0 0 32px;
  }
  .site-card {
    position: relative;
    background: var(--panel);
    border-radius: 12px;
    border: 1px solid var(--line);
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.25s, box-shadow 0.25s, transform 0.3s ease, opacity 0.25s;
  }
  .site-card:hover {
    border-color: rgba(125,211,252,0.35);
  }

  /* expanded state */
  .card-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
  }
  .card-backdrop[data-open="true"] { display: block; }

  .site-card--expanded {
    position: fixed;
    z-index: 1000;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, calc(100vw - 48px));
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    cursor: default;
    border-color: var(--accent);
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px var(--accent);
  }
  .site-card--expanded .site-card-thumb { height: 240px; }

  .site-card-thumb {
    position: relative;
    width: 100%;
    height: 200px;
    overflow: hidden;
    background: #0a0a0a;
    border-bottom: 1px solid var(--line);
  }
  .site-card-thumb iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 1440px;
    height: 900px;
    transform-origin: top left;
    transform: scale(${String(THUMB_SCALE)});
    border: none;
    pointer-events: none;
  }

  .site-card-body {
    padding: 16px 20px;
  }
  .site-card-body h3 {
    margin: 0 0 4px;
    font-size: 17px;
    font-weight: 600;
    color: var(--text);
  }
  .site-card-addr {
    display: inline-block;
    font-size: 12px;
    color: var(--accent);
    text-decoration: none;
    margin-bottom: 10px;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .site-card-addr:hover { text-decoration: underline; }

  .site-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-bottom: 14px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .badge-kit {
    background: rgba(125,211,252,0.10);
    color: var(--accent);
    border: 1px solid rgba(125,211,252,0.18);
  }
  .badge-pub {
    background: rgba(74,222,128,0.10);
    color: #4ade80;
    border: 1px solid rgba(74,222,128,0.18);
  }
  .badge-draft {
    background: rgba(250,204,21,0.10);
    color: #facc15;
    border: 1px solid rgba(250,204,21,0.18);
  }
  .site-card-date {
    font-size: 12px;
    color: var(--faint);
  }

  /* --- card actions: Edit | Publish/Live | ... --- */
  .site-card-actions {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .site-card-actions a,
  .site-card-actions button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.12s, filter 0.12s;
    cursor: pointer;
    border: none;
    font-family: inherit;
  }
  .btn-edit {
    flex: 1;
    background: var(--accent);
    color: var(--bg);
  }
  .btn-edit:hover { filter: brightness(0.88); }

  .btn-live {
    flex: 1;
    background: rgba(74,222,128,0.12);
    color: #4ade80;
    border: 1px solid rgba(74,222,128,0.22);
  }
  .btn-live:hover { background: rgba(74,222,128,0.20); }
  .btn-live .dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    margin-right: 6px;
  }

  .btn-publish {
    flex: 1;
    background: rgba(250,204,21,0.10);
    color: #facc15;
    border: 1px solid rgba(250,204,21,0.18);
  }
  .btn-publish:hover { background: rgba(250,204,21,0.18); }

  .btn-dots {
    width: 38px;
    min-width: 38px;
    background: var(--panel-strong, #182235);
    color: var(--muted);
    border: 1px solid var(--line);
    font-size: 18px;
    letter-spacing: 1px;
    line-height: 1;
    padding: 0;
  }
  .btn-dots:hover { background: rgba(255,255,255,0.08); color: var(--text); }
  .btn-dots[aria-expanded="true"] {
    background: rgba(125,211,252,0.10);
    color: var(--accent);
    border-color: rgba(125,211,252,0.25);
  }

  /* --- expandable details panel --- */
  .site-card-details {
    display: none;
    border-top: 1px solid var(--line);
    background: var(--bg);
    padding: 16px 20px;
  }
  .site-card-details[data-open="true"] {
    display: block;
  }
  .details-heading {
    margin: 0 0 12px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }
  .details-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .details-table tr {
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .details-table tr:last-child { border-bottom: none; }
  .details-table td {
    padding: 7px 0;
    vertical-align: middle;
  }
  .details-table td:first-child {
    color: var(--muted);
    width: 45%;
  }
  .details-table td:last-child {
    color: var(--text);
    text-align: right;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 12px;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
  }
  .pill-on {
    background: rgba(74,222,128,0.10);
    color: #4ade80;
  }
  .pill-off {
    background: rgba(255,255,255,0.04);
    color: var(--faint);
  }
  .pill-info {
    background: rgba(125,211,252,0.08);
    color: var(--accent);
  }

  .dash-sign-out {
    font-size: 13px;
    color: var(--faint);
  }
`;

const toggleScript = raw(`<script>
var backdrop = document.getElementById('card-backdrop');
var expandedCard = null;

function closeExpanded() {
  if (!expandedCard) return;
  expandedCard.classList.remove('site-card--expanded');
  var panel = expandedCard.querySelector('.site-card-details');
  if (panel) panel.setAttribute('data-open', 'false');
  var btn = expandedCard.querySelector('.btn-dots');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  backdrop.setAttribute('data-open', 'false');
  expandedCard = null;
}

function openExpanded(card) {
  if (expandedCard === card) { closeExpanded(); return; }
  if (expandedCard) closeExpanded();
  expandedCard = card;
  card.classList.add('site-card--expanded');
  var panel = card.querySelector('.site-card-details');
  if (panel) panel.setAttribute('data-open', 'true');
  var btn = card.querySelector('.btn-dots');
  if (btn) btn.setAttribute('aria-expanded', 'true');
  backdrop.setAttribute('data-open', 'true');
}

backdrop.addEventListener('click', closeExpanded);

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeExpanded();
});

document.addEventListener('click', function(e) {
  // Ignore clicks on interactive elements inside the card
  if (e.target.closest('a, button, iframe')) return;
  var card = e.target.closest('.site-card');
  if (!card) return;
  openExpanded(card);
});

// 3-dot button toggles details within expanded card
document.addEventListener('click', function(e) {
  var btn = e.target.closest('.btn-dots');
  if (!btn) return;
  e.stopPropagation();
  var card = btn.closest('.site-card');
  if (!card) return;
  // If card not expanded, expand it
  if (!card.classList.contains('site-card--expanded')) {
    openExpanded(card);
    return;
  }
  // Otherwise toggle details panel
  var panel = card.querySelector('.site-card-details');
  if (!panel) return;
  var open = panel.getAttribute('data-open') === 'true';
  panel.setAttribute('data-open', open ? 'false' : 'true');
  btn.setAttribute('aria-expanded', open ? 'false' : 'true');
});

// Publish button
document.addEventListener('click', function(e) {
  var pubBtn = e.target.closest('.btn-publish');
  if (!pubBtn) return;
  e.preventDefault();
  e.stopPropagation();
  var siteId = pubBtn.getAttribute('data-site-id');
  if (!siteId) return;
  pubBtn.textContent = 'Publishing...';
  pubBtn.style.pointerEvents = 'none';
  fetch('/api/publish/sites/' + siteId, { method: 'POST' })
    .then(function(r) {
      if (!r.ok) throw new Error(r.status + '');
      return r.json();
    })
    .then(function() { location.reload(); })
    .catch(function() {
      pubBtn.textContent = 'Failed';
      pubBtn.style.pointerEvents = '';
    });
});
</script>`);

interface SiteCard {
  siteId: string;
  siteName: string;
  subdomain: string;
  styleKit: string;
  publishedVersion: number;
  updatedAt: Date;
  thumbHtml: string;
  passwordEnabled: boolean;
  darkModeEnabled: boolean;
  searchIndexing: boolean;
  sectionCount: number;
  elementCount: number;
}

function buildCards(
  rows: Array<{
    id: string;
    name: string;
    subdomain: string;
    styleKit: string;
    publishedVersion: number;
    updatedAt: Date;
    editableState: CanvasSiteState;
    passwordEnabled: boolean;
  }>,
  origin: string,
): SiteCard[] {
  return rows.map((row) => {
    const state = row.editableState;
    const page = state.pages[0];
    const sectionCount = page?.sections?.length ?? 0;
    let elementCount = 0;
    if (page?.sections) {
      for (const sec of page.sections) {
        elementCount += sec.elements?.length ?? 0;
      }
    }
    return {
      siteId: row.id,
      siteName: row.name,
      subdomain: row.subdomain,
      styleKit: row.styleKit,
      publishedVersion: row.publishedVersion,
      updatedAt: row.updatedAt,
      thumbHtml: buildThumbHtml(state, row.id, origin),
      passwordEnabled: row.passwordEnabled,
      darkModeEnabled: state.darkModeEnabled ?? false,
      searchIndexing: !(state.siteNoIndex ?? false),
      sectionCount,
      elementCount,
    };
  });
}

function Pill({ on, label }: { on: boolean; label?: string }) {
  const text = label ?? (on ? 'On' : 'Off');
  return <span class={`pill ${on ? 'pill-on' : 'pill-off'}`}>{text}</span>;
}

function InfoPill({ label }: { label: string }) {
  return <span class="pill pill-info">{label}</span>;
}

function DetailsPanel({ s }: { s: SiteCard }) {
  return (
    <div class="site-card-details" data-open="false">
      <p class="details-heading">Site details</p>
      <table class="details-table">
        <tbody>
          <tr>
            <td>Hosting</td>
            <td><InfoPill label="Starter" /></td>
          </tr>
          <tr>
            <td>CDN</td>
            <td><InfoPill label="Cloudflare Edge" /></td>
          </tr>
          <tr>
            <td>Custom domain</td>
            <td><Pill on={false} label="Not configured" /></td>
          </tr>
          <tr>
            <td>Password protection</td>
            <td><Pill on={s.passwordEnabled} /></td>
          </tr>
          <tr>
            <td>Search indexing</td>
            <td><Pill on={s.searchIndexing} /></td>
          </tr>
          <tr>
            <td>Dark mode</td>
            <td><Pill on={s.darkModeEnabled} /></td>
          </tr>
          <tr>
            <td>Analytics</td>
            <td><Pill on={false} label="Not connected" /></td>
          </tr>
          <tr>
            <td>Sections</td>
            <td>{String(s.sectionCount)}</td>
          </tr>
          <tr>
            <td>Elements</td>
            <td>{String(s.elementCount)}</td>
          </tr>
          <tr>
            <td>Style kit</td>
            <td><InfoPill label={s.styleKit} /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

dashboard.get('/', async (c) => {
  const user = c.get('user');
  if (!user) {
    throw new Error('dashboard reached without a resolved user');
  }

  const primaryEmail = user.emailAddresses.find(
    (addr) => addr.id === user.primaryEmailAddressId,
  )?.emailAddress;

  if (!primaryEmail) {
    throw new Error(`clerk user ${user.id} has no primary email address`);
  }

  const database = db(c.env);

  await database
    .insert(customer)
    .values({
      clerkUserId: user.id,
      email: primaryEmail,
    })
    .onConflictDoUpdate({
      target: customer.clerkUserId,
      set: {
        email: primaryEmail,
        updatedAt: sql`now()`,
      },
    });

  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, user.id))
    .limit(1);
  const customerId = customerRow[0]?.id;

  const origin = new URL(c.req.url).origin;

  let cards: SiteCard[] = [];
  if (customerId) {
    const rows = await database
      .select({
        id: site.id,
        name: site.name,
        subdomain: site.subdomain,
        styleKit: site.styleKit,
        publishedVersion: site.publishedVersion,
        updatedAt: site.updatedAt,
        editableState: site.editableState,
        passwordEnabled: site.passwordEnabled,
      })
      .from(site)
      .where(eq(site.customerId, customerId))
      .orderBy(desc(site.createdAt));

    cards = buildCards(rows, origin);
  }

  const signOutUrl = buildSignOutUrl(
    c.env.CLERK_PUBLISHABLE_KEY,
    new URL('/', c.req.url).toString(),
  );

  return c.html(
    <DashboardShell
      title="rev01 — dashboard"
      crumbs={[{ label: 'Dashboard' }]}
      pageStyles={cardStyles}
    >
      <div class="dash-header">
        <h1>Your sites</h1>
        <a class="new-site" href="/dashboard/templates">+ New site</a>
      </div>
      <p class="dash-sub">
        Signed in as {primaryEmail}.{' '}
        <a class="dash-sign-out" href={signOutUrl}>Sign out</a>
      </p>

      {cards.length > 0 ? (
        <div class="site-grid">
          {cards.map((s) => (
            <div class="site-card">
              <div class="site-card-thumb">
                <iframe
                  srcdoc={s.thumbHtml}
                  scrolling="no"
                  tabindex={-1}
                  loading="lazy"
                  sandbox="allow-same-origin"
                  title={`Preview of ${s.siteName}`}
                />
              </div>
              <div class="site-card-body">
                <h3>{s.siteName}</h3>
                <a
                  class="site-card-addr"
                  href={`https://${s.subdomain}.rev01.aayushman.dev`}
                  target="_blank"
                  rel="noopener"
                >
                  {s.subdomain}.rev01.aayushman.dev
                </a>
                <div class="site-card-meta">
                  <span class="badge badge-kit">{s.styleKit}</span>
                  {s.publishedVersion > 0 ? (
                    <span class="badge badge-pub">published v{String(s.publishedVersion)}</span>
                  ) : (
                    <span class="badge badge-draft">draft</span>
                  )}
                  <span class="site-card-date">Updated {formatDate(s.updatedAt)}</span>
                </div>
                <div class="site-card-actions">
                  <a class="btn-edit" href={`/dashboard/sites/${s.siteId}/edit`}>Edit</a>
                  {s.publishedVersion > 0 ? (
                    <a
                      class="btn-live"
                      href={`https://${s.subdomain}.rev01.aayushman.dev`}
                      target="_blank"
                      rel="noopener"
                    >
                      <span class="dot" />
                      Live
                    </a>
                  ) : (
                    <button class="btn-publish" data-site-id={s.siteId} type="button">
                      Publish
                    </button>
                  )}
                  <button
                    class="btn-dots"
                    type="button"
                    aria-expanded="false"
                    aria-label="Site details"
                    title="Site details"
                  >
                    &#x22EE;
                  </button>
                </div>
              </div>
              <DetailsPanel s={s} />
            </div>
          ))}
        </div>
      ) : (
        <p>
          No sites yet — <a href="/dashboard/templates">pick a template</a> to start.
        </p>
      )}
      <div id="card-backdrop" class="card-backdrop" data-open="false" />
      {toggleScript}
    </DashboardShell>,
  );
});
