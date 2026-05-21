import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import themeStudio from './routes/dashboard/theme';
import sites from './routes/api/sites';
import pages from './routes/api/pages';
import editor from './editor';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.route('/', landing);

app.route('/dashboard/templates', templatesRoute);
app.route('/dashboard/sites/:siteId/theme', themeStudio);
app.route('/dashboard', editor);
app.route('/dashboard', dashboard);
app.route('/api/sites', sites);
app.route('/api/pages', pages);

export { PageDocument } from './multiplayer/page-document';
export default app;
