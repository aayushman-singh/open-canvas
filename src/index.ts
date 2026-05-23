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
import slotHistoryApi from './routes/api/slot-history';
import canvasEditor from './editor/canvas-index';
import { handlePublicRequest, type PublicEnv } from './routes/public';

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
app.route('/api', slotHistoryApi);
app.route('/api', sectionsApi);

export { SiteRoom } from './live/site-room';
// Phase 0 scaffold — Wave 2 #7 (forms) DO class. The binding lives in
// wrangler.toml; the implementation throws until Wave 2 lands. See
// docs/superpowers/plans/2026-05-23-07-forms.md.
export { FormRateLimiter } from './live/form-rate-limiter';
export default app;
