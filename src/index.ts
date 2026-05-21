import { Hono } from 'hono';
import { clerkAuth, type ClerkAuthVariables } from './auth/middleware';
import { dashboard } from './routes/dashboard';

type Bindings = {
  CLERK_PUBLISHABLE_KEY: string;
  CLERK_SECRET_KEY: string;
  DATABASE_URL: string;
};

const app = new Hono<{ Bindings: Bindings; Variables: ClerkAuthVariables }>();

app.use('*', clerkAuth());

app.get('/', (c) => c.text('rev01'));
app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }));

app.route('/dashboard', dashboard);

export default app;
