import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import ownerAssetsApi from './assets/route';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import sites from './routes/api/sites';
import { importRouter } from './routes/api/import';
import canvasApi from './routes/api/canvas';
import canvasAgentApi from './routes/api/canvas-agent';
import publishApi from './routes/api/publish';
import sectionsApi from './routes/api/sections';
import slotHistoryApi from './routes/api/slot-history';
import canvasEditor from './editor/canvas-index';
import { handlePublicRequest, type PublicEnv } from './routes/public';
// Wave 1 routers wired by main thread after parallel-agent merge.
import versionRoute from './version/route';
import customDomainRouter from './custom-domain/route';
import ogRoute from './og-image/route';
import { scheduled as customDomainScheduled } from './custom-domain/cron';
// Wave 2 routers wired by main thread after parallel-agent merge.
import formsRouter from './forms/route';
import formsInboxRoute from './routes/dashboard/forms-inbox';
import unlockRoute from './password/unlock-route';
import passwordAdminRoute from './password/admin-route';
import siteSettingsRoute from './routes/dashboard/site-settings';
import themeRoute from './themes/route';
import { configureFormRender } from './canvas/elements/form';
// Wave 3 routers wired by main thread after parallel-agent merge.
import searchRouter from './search/route';
import symbolsRouter from './symbols/route';
import a11yRoute from './a11y/route';
import a11yReportRoute from './routes/dashboard/a11y-report';
import pageSettingsRoute from './routes/dashboard/page-settings';
// Wave 4 routers wired by main thread after parallel-agent merge.
import navEditorRoute from './routes/dashboard/nav-editor';
import sitemapRouter from './seo/sitemap/route';
// Wave 5 routers wired by main thread after parallel-agent merge.
import fontsRouter from './fonts/route';
import chatApi from './agent/chat/route';
import translateApi from './i18n/route';
import chatPanelRoute from './routes/dashboard/chat-panel';
import addonShopRoute from './routes/dashboard/addon-shop';
import siteAddonsRoute from './routes/dashboard/site-addons';
import addonsApi from './routes/api/addons';
// Section library + custom template routes
import {
  librarySectionsOwner,
  librarySectionsAdmin,
} from './routes/api/library-sections';
import {
  customTemplatesOwner,
  customTemplatesAdmin,
} from './routes/api/custom-templates';
import { clerkAuth, editTokenAuth } from './auth/middleware';
import { requireAuth } from './auth/require-auth';
import { db } from './db/client';
import { customer, site } from './db/schema';
import onSiteEditRoute from './routes/api/on-site-edit';
import collaboratorsApi from './routes/api/collaborators';

const app = new Hono<PublicEnv>();

// Wave 2 #7 — Forms boot hook. The Turnstile public site key is read from
// env on first request and cached at module scope (the renderer reads from a
// module-local config, see src/canvas/elements/form.ts). Without it the form
// element renders no Turnstile widget; the server-side verifier still hard-
// fails any submission missing the token, so the bot-protection invariant
// holds. One-shot — runs once per isolate cold-start.
let formRenderConfigured = false;
app.use('*', async (c, next) => {
  if (!formRenderConfigured) {
    const turnstileSiteKey =
      typeof c.env.TURNSTILE_SITE_KEY === 'string' && c.env.TURNSTILE_SITE_KEY.length > 0
        ? c.env.TURNSTILE_SITE_KEY
        : null;
    configureFormRender({ turnstileSiteKey });
    formRenderConfigured = true;
  }
  await next();
});

// Public host router runs FIRST. If the request host belongs to a Published
// Site (*.rev01.aayushman.dev minus the app host), serve the snapshot here.
// Otherwise return null and let the app-host mounts (landing, dashboard,
// /api/*) handle the request as usual.
app.use('*', async (c, next) => {
  const handled = await handlePublicRequest(c);
  if (handled) return handled;
  await next();
});

app.get('/__live', clerkAuth(), requireAuth(), async (c) => {
  const auth = c.get('auth');
  if (!auth.userId) {
    throw new Error('__live editor route reached without authenticated user');
  }

  const siteId = c.req.query('siteId');
  if (!siteId || !/^[A-Za-z0-9-]+$/.test(siteId)) {
    return c.text('site not found', 404);
  }

  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') {
    return c.text('expected websocket upgrade', 426);
  }

  const database = db(c.env);
  const customerRow = await database
    .select({ id: customer.id })
    .from(customer)
    .where(eq(customer.clerkUserId, auth.userId))
    .limit(1);
  const customerId = customerRow[0]?.id;
  if (!customerId) {
    return c.text('site not found', 404);
  }

  const ownedRows = await database
    .select({ id: site.id })
    .from(site)
    .where(and(eq(site.id, siteId), eq(site.customerId, customerId)))
    .limit(1);
  if (!ownedRows[0]) {
    return c.text('site not found', 404);
  }

  const id = c.env.SITE_ROOM.idFromName(siteId);
  const stub = c.env.SITE_ROOM.get(id);
  return stub.fetch(
    new Request(
      `https://do.invalid/socket?siteId=${encodeURIComponent(siteId)}&role=editor`,
      {
        method: 'GET',
        headers: c.req.raw.headers,
      },
    ),
  );
});

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.get('/favicon.ico', (c) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0d1117"/><text x="4" y="24" font-family="monospace" font-size="22" font-weight="700" fill="#22d3ee">r1</text></svg>`;
  return c.body(svg, 200, {
    'content-type': 'image/svg+xml',
    'cache-control': 'public, max-age=86400',
  });
});

app.route('/', landing);

app.route('/dashboard/templates', templatesRoute);
app.route('/dashboard', canvasEditor);
app.route('/dashboard', dashboard);
app.route('/api/sites', sites);
app.route('/api/import', importRouter);
app.route('/api/canvas', canvasApi);
app.route('/api/canvas-agent', canvasAgentApi);
app.route('/api/publish', publishApi);
// Owner-rooted asset endpoints per ADR 0004 + ADR 0006. Mounted alongside
// the legacy `/api/canvas/sites/:siteId/assets` bridge in canvas.ts; the
// editor still calls the legacy path during this Phase 0 cutover.
app.route('/api/owner/assets', ownerAssetsApi);
app.route('/api', slotHistoryApi);
app.route('/api', sectionsApi);
// Section library + custom template mounts.
app.route('/api/library', librarySectionsOwner);
app.route('/api/admin/library', librarySectionsAdmin);
app.route('/api/custom-templates', customTemplatesOwner);
app.route('/api/admin/custom-templates', customTemplatesAdmin);
app.route('/api', collaboratorsApi);
// Wave 1 mounts. Per-feature plans in docs/superpowers/plans/2026-05-23-*.md.
app.route('/api/sites/:siteId/snapshots', versionRoute);
app.route('/api/sites/:siteId/domains', customDomainRouter);
app.route('/og', ogRoute);
// Wave 2 mounts. The themes router exposes /api/sites/:siteId/custom-theme;
// the password admin router exposes /api/sites/:siteId/password.
app.route('/api/forms', formsRouter);
app.route('/dashboard', formsInboxRoute);
app.route('/dashboard', siteSettingsRoute);
app.route('/api/sites', themeRoute);
app.route('/api/sites/:siteId/password', passwordAdminRoute);
// Visitor-facing unlock POST. Lives at the public-host path `/__rev01/unlock`;
// public.ts's handlePublicRequest explicitly returns null for `/__rev01/*` so
// the request falls through here. The handler reads the request Host to scope
// the cookie to the right site.
app.route('/__rev01/unlock', unlockRoute);
// Visitor-facing form submissions. The public-host router lets this path fall
// through only after the password gate has passed.
app.route('/__rev01/forms', formsRouter);
// Wave 3 mounts. Per-feature plans in docs/superpowers/plans/2026-05-23-*.md.
// Symbols (#14) and a11y (#15) live under /api/sites/:siteId/...
app.route('/api/sites/:siteId/symbols', symbolsRouter);
app.route('/api/sites', a11yRoute);
app.route('/dashboard', a11yReportRoute);
app.route('/dashboard', pageSettingsRoute);
// Site search (#13) — visitor-facing endpoint on the public-host path.
// public.ts lets this path fall through only after the password gate has
// passed. The handler reads the request Host to resolve site id.
app.route('/__rev01/search', searchRouter);
// Wave 4 mounts.
// Nav editor UI (#16) lives under /dashboard.
app.route('/dashboard', navEditorRoute);
// Sitemap.xml + robots.txt (#22) on public-host root paths. public.ts must
// fall through (return null) for `/sitemap.xml` and `/robots.txt` — see the
// fallthrough block in handlePublicRequest.
app.route('/', sitemapRouter);
// Wave 5 mounts.
// Custom fonts (#12) — public `GET /fonts/:contentHash` + Owner-scoped
// `/api/sites/:siteId/fonts` verbs. The router is root-mounted so both
// paths reach their handlers.
app.route('/', fontsRouter);
// AI chat (#23) — multi-turn agent over CanvasSiteState. Mounts at
// /api/sites so the inner routes become /api/sites/:siteId/chat and
// /api/sites/:siteId/chat/stream.
app.route('/api/sites', chatApi);
app.route('/api/sites', translateApi);
app.route('/dashboard', chatPanelRoute);
// Addon system (ADR 0009)
app.route('/dashboard', addonShopRoute);
app.route('/dashboard', siteAddonsRoute);
app.route('/api/addons', addonsApi);
// On-site editor auth popup — main domain endpoint that sets the edit token
// cookie scoped to .rev01.aayushman.dev so subdomain editors can read it.
app.route('/api/on-site-edit', onSiteEditRoute);

// On-site editor API proxy — same sub-app handlers mounted under /__api with
// edit-token auth instead of Clerk sessions. The public host router
// (public.ts) returns null for /__api/* paths so they fall through here.
// editTokenAuth() validates the __rev01_edit cookie and populates the same
// auth context variables that clerkAuth()+requireAuth() would, so the
// sub-apps' built-in clerkAuth() short-circuits (auth already set).
app.use('/__api/*', editTokenAuth());
app.route('/__api/canvas', canvasApi);
app.route('/__api/canvas-agent', canvasAgentApi);
app.route('/__api/publish', publishApi);
app.route('/__api/owner/assets', ownerAssetsApi);
app.route('/__api', slotHistoryApi);
app.route('/__api', sectionsApi);
app.route('/__api/library', librarySectionsOwner);
app.route('/__api/custom-templates', customTemplatesOwner);
app.route('/__api/sites', chatApi);

export { SiteRoom } from './live/site-room';
// Phase 0 scaffold — Wave 2 #7 (forms) DO class. The binding lives in
// wrangler.toml; the implementation throws until Wave 2 lands. See
// docs/superpowers/plans/2026-05-23-07-forms.md.
export { FormRateLimiter } from './live/form-rate-limiter';
// Named export so tests can use Hono's `.request(...)` helper directly.
// (The default export is the Worker module-object Cloudflare expects:
// `{ fetch, scheduled }`. That shape does NOT expose `.request`.)
export { app };

// Worker default export carries both the request handler and the cron
// `scheduled` handler. The cron-trigger expression lives in wrangler.toml
// `[triggers]`; the handler dispatches to per-feature scheduled tasks.
// Wave 1 #5 (custom domains) owns the only scheduled task today.
export default {
  fetch: app.fetch.bind(app),
  scheduled: customDomainScheduled,
};
