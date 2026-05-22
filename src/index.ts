import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import sites from './routes/api/sites';
import canvasApi from './routes/api/canvas';
import canvasAgentApi from './routes/api/canvas-agent';
import publishApi from './routes/api/publish';
import assetsApi from './routes/api/assets';
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
app.route('/api', assetsApi);

export { SiteRoom } from './live/site-room';
export default app;
