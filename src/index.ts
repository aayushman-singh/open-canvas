import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import { templatesRoute } from './routes/dashboard/templates';
import sites from './routes/api/sites';
import pages from './routes/api/pages';
import agent from './routes/api/agent';
import editor from './editor';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.route('/', landing);

app.route('/dashboard/templates', templatesRoute);
// The legacy theme studio (src/routes/dashboard/theme.tsx) reads removed site
// columns (tokens, templateId) and is retired by T9; leaving it unmounted
// keeps the file from breaking typecheck.
app.route('/dashboard', editor);
app.route('/dashboard', dashboard);
app.route('/api/sites', sites);
app.route('/api/pages', pages);
app.route('/api/agent', agent);

export { PageDocument } from './multiplayer/page-document';
export default app;
