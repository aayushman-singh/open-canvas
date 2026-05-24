import { Hono } from 'hono';
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
    ...(state.symbols.length > 0 ? { symbols: state.symbols } : {}),
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
    background: var(--panel);
    border-radius: 12px;
    border: 1px solid var(--line);
    overflow: hidden;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .site-card:hover {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
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
  .site-card-actions {
    display: flex;
    gap: 10px;
  }
  .site-card-actions a {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 8px 14px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: background 0.12s;
  }
  .btn-edit {
    background: var(--accent);
    color: var(--bg);
  }
  .btn-edit:hover { filter: brightness(0.88); }
  .btn-view {
    background: var(--panel-strong, #182235);
    color: var(--text);
    border: 1px solid var(--line);
  }
  .btn-view:hover { background: rgba(255,255,255,0.08); }
  .dash-sign-out {
    font-size: 13px;
    color: var(--faint);
  }
`;

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

  interface SiteCard {
    siteId: string;
    siteName: string;
    subdomain: string;
    styleKit: string;
    publishedVersion: number;
    updatedAt: Date;
    thumbHtml: string;
  }

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
      })
      .from(site)
      .where(eq(site.customerId, customerId))
      .orderBy(desc(site.createdAt));

    cards = rows.map((row) => ({
      siteId: row.id,
      siteName: row.name,
      subdomain: row.subdomain,
      styleKit: row.styleKit,
      publishedVersion: row.publishedVersion,
      updatedAt: row.updatedAt,
      thumbHtml: buildThumbHtml(row.editableState, row.id, origin),
    }));
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
                      class="btn-view"
                      href={`https://${s.subdomain}.rev01.aayushman.dev`}
                      target="_blank"
                      rel="noopener"
                    >
                      View live
                    </a>
                  ) : (
                    <a class="btn-view" href={`/dashboard/sites/${s.siteId}/edit`}>
                      Open editor
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p>
          No sites yet — <a href="/dashboard/templates">pick a template</a> to start.
        </p>
      )}
    </DashboardShell>,
  );
});
