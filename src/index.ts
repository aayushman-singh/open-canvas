import { Hono } from 'hono';
import landing from './landing';
import { dashboard } from './routes/dashboard';

const app = new Hono();

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));
app.route('/', landing);

app.route('/dashboard', dashboard);

export default app;
