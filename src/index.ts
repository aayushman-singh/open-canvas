import { Hono } from 'hono';

const app = new Hono();

app.get('/', (c) => c.text('rev01'));
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

export default app;
