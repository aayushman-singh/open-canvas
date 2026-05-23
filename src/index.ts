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

const app = new Hono<PublicEnv>();

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
