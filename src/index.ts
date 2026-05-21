import { Hono } from 'hono';
import { dashboard } from './routes/dashboard';

const app = new Hono();

app.get('/', (c) => c.text('rev01'));
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/dashboard', dashboard);

export default app;
