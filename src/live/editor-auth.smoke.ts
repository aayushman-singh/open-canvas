import { canUseLiveEditorSocket } from './editor-auth';
import { buildOnSiteEditorOptions } from '../routes/public';
import { verifyEditToken } from '../auth/edit-token';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  canUseLiveEditorSocket({ siteCustomerId: 'owner-customer', collaboratorCustomerId: null }, 'owner-customer'),
  'expected site owner to open editor socket',
);

assert(
  canUseLiveEditorSocket(
    { siteCustomerId: 'owner-customer', collaboratorCustomerId: 'collab-customer' },
    'collab-customer',
  ),
  'expected accepted collaborator to open editor socket',
);

assert(
  !canUseLiveEditorSocket({ siteCustomerId: 'owner-customer', collaboratorCustomerId: null }, 'other-customer'),
  'expected unrelated customer to be rejected from editor socket',
);

const env = {
  CLERK_PUBLISHABLE_KEY: 'pk_test_live_auth_smoke',
  CLERK_SECRET_KEY: 'sk_test_live_auth_smoke',
  UNLOCK_SIGNING_SECRET: 'live-auth-smoke-secret',
};

const opts = await buildOnSiteEditorOptions(
  {
    id: 'site-live-auth',
    name: 'Live Auth Smoke',
    subdomain: 'live-auth-smoke',
    styleKit: 'charcoal',
  },
  { siteId: 'site-live-auth', customerId: 'collab-customer', clerkUserId: 'user-live-auth' },
  env,
);

assert(opts.context === 'public', 'expected public editor context');
assert(typeof opts.wsToken === 'string' && opts.wsToken.length > 0, 'expected public editor wsToken');

const wsPayload = await verifyEditToken(opts.wsToken, env.UNLOCK_SIGNING_SECRET);
assert(wsPayload?.siteId === 'site-live-auth', 'expected wsToken siteId to match public editor site');
assert(
  wsPayload?.customerId === 'collab-customer',
  'expected wsToken customerId to preserve collaborator identity',
);
assert(
  wsPayload?.clerkUserId === 'user-live-auth',
  'expected wsToken clerkUserId to preserve editor identity',
);

console.log('[editor-auth:smoke] OK');
