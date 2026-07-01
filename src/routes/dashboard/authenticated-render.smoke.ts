import { Hono } from 'hono';
import type { createClerkClient, User } from '@clerk/backend';
import { dashboard } from './index';
import { db, runWithDbRequestScope } from '../../db/client';
import { customer } from '../../db/schema';
import type { ClerkAuthVariables } from '../../auth/middleware';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[dashboard-authenticated-render:smoke] ${message}`);
}

const databaseUrl = process.env['DATABASE_URL'];
assert(databaseUrl, 'DATABASE_URL is required');

const rows = await runWithDbRequestScope(async () => {
  const database = db({ DATABASE_URL: databaseUrl });
  return await database.select().from(customer).limit(1);
});
const customerRecord = rows[0];
assert(customerRecord, 'expected at least one customer row');

const env = {
  DATABASE_URL: databaseUrl,
  APP_DOMAIN: process.env['APP_DOMAIN'] ?? 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES:
    process.env['AUTHORIZED_PARTIES'] ??
    'https://opencanvas.aayushman.dev,http://127.0.0.1:8787,http://localhost:8787',
  CLERK_PUBLISHABLE_KEY: process.env['CLERK_PUBLISHABLE_KEY'] ?? 'pk_test_dummy',
  CLERK_SECRET_KEY: process.env['CLERK_SECRET_KEY'] ?? 'sk_test_dummy',
  CLERK_FRONTEND_API_URL:
    process.env['CLERK_FRONTEND_API_URL'] ?? 'https://clerk.opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: process.env['COOKIE_NAME_PREFIX'] ?? '__opencanvas_',
  EMAIL_FROM: process.env['EMAIL_FROM'] ?? 'Open Canvas <noreply@example.com>',
};

const app = new Hono<{ Variables: ClerkAuthVariables }>();
app.use('/dashboard/*', async (c, next) => {
  c.set('auth', {
    userId: customerRecord.clerkUserId,
    sessionId: 'sess_dashboard_smoke',
    getToken: null,
  });
  c.set('user', {
    id: customerRecord.clerkUserId,
    firstName: customerRecord.displayName,
    imageUrl: '',
  } as User);
  c.set('clerk', null as unknown as ReturnType<typeof createClerkClient>);
  c.set('customer', customerRecord);
  await next();
});
app.route('/dashboard', dashboard);

const response = await app.request('/dashboard', undefined, env);
assert(response.status !== 500, `expected non-500 dashboard response, got ${String(response.status)}`);
assert(response.status === 200, `expected 200 dashboard response, got ${String(response.status)}`);

const html = await response.text();
assert(html.includes('Your sites'), 'expected dashboard heading');
assert(html.includes('+ New site') || html.includes('Upgrade to add sites'), 'expected create-site action');

console.log('[dashboard-authenticated-render:smoke] OK');
