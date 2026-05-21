import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';
import sites from './routes/api/sites';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.route('/', landing);

app.route('/dashboard', dashboard);
app.route('/api/sites', sites);

export default app;
