import assert from 'node:assert/strict';
import { dashboardThumbOrigin } from './index.js';

const baseEnv = {
  APP_DOMAIN: 'opencanvas.aayushman.dev',
  AUTHORIZED_PARTIES: 'https://opencanvas.aayushman.dev',
  COOKIE_NAME_PREFIX: 'opencanvas',
  EMAIL_FROM: 'Open Canvas <hello@opencanvas.aayushman.dev>',
};

assert.equal(
  dashboardThumbOrigin(
    {
      ...baseEnv,
      CLERK_TEST_PUBLISHABLE_KEY: 'pk_test_local',
      CLERK_TEST_SECRET_KEY: 'sk_test_local',
      DEV_PUBLIC_HOST: 'http://127.0.0.1:8787',
    },
    'https://opencanvas.aayushman.dev/dashboard/thumbs/site-1',
  ),
  'http://127.0.0.1:8787',
  'local auth dashboard thumbnails must use the browser-visible dev origin',
);

assert.equal(
  dashboardThumbOrigin(
    baseEnv,
    'https://opencanvas.aayushman.dev/dashboard/thumbs/site-1',
  ),
  'https://opencanvas.aayushman.dev',
  'production dashboard thumbnails must use the request origin',
);

assert.throws(
  () =>
    dashboardThumbOrigin(
      { ...baseEnv, CLERK_TEST_PUBLISHABLE_KEY: 'pk_test_local' },
      'https://opencanvas.aayushman.dev/dashboard/thumbs/site-1',
    ),
  /CLERK_TEST_PUBLISHABLE_KEY and CLERK_TEST_SECRET_KEY must be configured together/,
);

console.log('[dashboard-thumb-origin:smoke] OK');
