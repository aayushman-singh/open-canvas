import { Hono } from 'hono';
import ownerAssetsApi from './assets/route';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import sites from './routes/api/sites';
import canvasApi from './routes/api/canvas';
import canvasAgentApi from './routes/api/canvas-agent';
import publishApi from './routes/api/publish';
import sectionsApi from './routes/api/sections';
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

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.route('/', landing);

app.route('/dashboard/templates', templatesRoute);
app.route('/dashboard', canvasEditor);
app.route('/dashboard', dashboard);
app.route('/api/sites', sites);
app.route('/api/canvas', canvasApi);
app.route('/api/canvas-agent', canvasAgentApi);
app.route('/api/publish', publishApi);
// Owner-rooted asset endpoints per ADR 0004 + ADR 0006. Mounted alongside
// the legacy `/api/canvas/sites/:siteId/assets` bridge in canvas.ts; the
// editor still calls the legacy path during this Phase 0 cutover.
app.route('/api/owner/assets', ownerAssetsApi);
app.route('/api', sectionsApi);
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
// Wave 3 mounts. Per-feature plans in docs/superpowers/plans/2026-05-23-*.md.
// Symbols (#14) and a11y (#15) live under /api/sites/:siteId/...
app.route('/api/sites/:siteId/symbols', symbolsRouter);
app.route('/api/sites', a11yRoute);
app.route('/dashboard', a11yReportRoute);
app.route('/dashboard', pageSettingsRoute);
// Site search (#13) — visitor-facing endpoint on the public-host path.
// public.ts returns null for `/__rev01/*` so the search request falls through
// to this app router. The handler reads the request Host to resolve site id.
app.route('/__rev01/search', searchRouter);

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
