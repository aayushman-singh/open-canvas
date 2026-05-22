import { eq, sql } from 'drizzle-orm';
import app from './index';
import { validateCanvasSiteState } from './canvas/validate';
import { db } from './db/client';
import { customer, site } from './db/schema';
import { RESERVED_SUBDOMAINS, SUBDOMAIN_RE, validateSubdomain } from './routes/api/sites';
import { starterTemplate } from './templates/registry';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// The Worker env passed to app.request. The public router's DB lookup needs
// DATABASE_URL even for the 404 path (we want a real "no row" answer, not a
// crash from a missing env var). Pull from process.env so the smoke remains
// deterministic against the empty dev DB.
const smokeEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? '',
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? '',
};

async function responseText(path: string): Promise<{ status: number; body: string }> {
  const response = await app.request(`http://rev01.test${path}`, undefined, smokeEnv);
  return { status: response.status, body: await response.text() };
}

async function responseFromHost(
  host: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const response = await app.request(`http://${host}${path}`, undefined, smokeEnv);
  return { status: response.status, body: await response.text() };
}

const root = await responseText('/');
assert(root.status === 200, `expected public / to return 200, got ${root.status}`);
assert(
  root.body.includes('multiplayer site builder'),
  'expected public / to render the Post-Aero landing',
);
assert(!root.body.includes('Math.random'), 'expected landing counters not to fake live activity');
assert(
  !root.body.includes('editors online'),
  'expected landing copy not to claim simulated editors are online',
);

const OriginalDate = Date;
(globalThis as { Date: DateConstructor }).Date = class extends OriginalDate {
  constructor() {
    super('2030-01-02T00:00:00.000Z');
  }

  static override now(): number {
    return new OriginalDate('2030-01-02T00:00:00.000Z').getTime();
  }
} as DateConstructor;
const shiftedClockRoot = await responseText('/');
(globalThis as { Date: DateConstructor }).Date = OriginalDate;
assert(root.body === shiftedClockRoot.body, 'expected landing HTML not to depend on request time');

const health = await responseText('/health');
assert(health.status === 200, `expected public /health to return 200, got ${health.status}`);
assert(health.body.includes('"ok":true'), 'expected /health to return ok heartbeat JSON');

const emptySubdomain = validateSubdomain('');
assert(!emptySubdomain.valid, 'expected empty subdomain to be invalid');
assert(
  !emptySubdomain.valid && emptySubdomain.error.includes('required'),
  'expected empty subdomain error to mention "required"',
);

const oneCharSubdomain = validateSubdomain('a');
assert(!oneCharSubdomain.valid, 'expected single-character subdomain to be invalid (too short)');

const upperCaseSubdomain = validateSubdomain('Bad');
assert(!upperCaseSubdomain.valid, 'expected uppercase subdomain to be invalid');

const leadingHyphen = validateSubdomain('-bad');
assert(!leadingHyphen.valid, 'expected leading-hyphen subdomain to be invalid');

const trailingHyphen = validateSubdomain('bad-');
assert(!trailingHyphen.valid, 'expected trailing-hyphen subdomain to be invalid');

const reservedSubdomain = validateSubdomain('www');
assert(!reservedSubdomain.valid, 'expected reserved subdomain "www" to be invalid');

const validSubdomain = validateSubdomain('my-site-1');
assert(validSubdomain.valid, 'expected "my-site-1" to be a valid subdomain');

assert(SUBDOMAIN_RE instanceof RegExp, 'expected SUBDOMAIN_RE to be exported as a RegExp');
assert(RESERVED_SUBDOMAINS.has('admin'), 'expected RESERVED_SUBDOMAINS to include "admin"');

const emptyPagesState = validateCanvasSiteState({ styleKit: 'charcoal', pages: [] });
assert(!emptyPagesState.valid, 'expected canvas site state with no pages to be invalid');

const overWidePage = validateCanvasSiteState({
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 600,
          elements: [
            {
              id: 'over-wide',
              type: 'shape',
              variant: 'rect',
              box: { x: 100, y: 100, w: 2000, h: 200, z: 1 },
            },
          ],
        },
      ],
    },
  ],
});
assert(
  !overWidePage.valid,
  'expected element wider than the page width to be rejected (extends beyond page width)',
);
assert(
  !overWidePage.valid &&
    overWidePage.errors.some((message) => message.includes('extends beyond page width')),
  'expected over-wide element error to mention "extends beyond page width"',
);

const unmutedAutoplayVideo = validateCanvasSiteState({
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'video-hero',
          name: 'Hero',
          height: 600,
          elements: [
            {
              id: 'noisy-video',
              type: 'media',
              mediaKind: 'video',
              assetId: 'loop.mp4',
              alt: '',
              fit: 'cover',
              playback: { autoplay: true, muted: false },
              box: { x: 0, y: 0, w: 800, h: 450, z: 1 },
            },
          ],
        },
      ],
    },
  ],
});
assert(
  !unmutedAutoplayVideo.valid,
  'expected autoplay video without muted=true to be rejected (muted required for autoplay)',
);
assert(
  !unmutedAutoplayVideo.valid &&
    unmutedAutoplayVideo.errors.some((message) => message.includes('muted')),
  'expected unmuted-autoplay video error to mention "muted"',
);

// -- Rich text content (Task 4.5) ----------------------------------------
// Build a minimum CanvasSiteState around each broken text element so the
// rejection comes from the rich-text path specifically — not from missing
// pages, sections, or other surrounding shape.

function richTextStateWith(content: unknown): unknown {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'hero-split',
            name: 'Hero',
            height: 400,
            elements: [
              {
                id: 'broken-text',
                type: 'text',
                box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
                content,
                role: 'body',
                fontSize: 16,
                fontWeight: 400,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
  };
}

const emptyContent = validateCanvasSiteState(richTextStateWith([]));
assert(
  !emptyContent.valid,
  'expected text element with content: [] to be rejected (non-empty array required)',
);
assert(
  !emptyContent.valid &&
    emptyContent.errors.some((message) => message.includes('non-empty array')),
  'expected empty-content rejection to mention "non-empty array"',
);

const unknownMarkType = validateCanvasSiteState(
  richTextStateWith([{ text: 'shiny', marks: [{ type: 'rainbow' }] }]),
);
assert(
  !unknownMarkType.valid,
  'expected text element with mark type "rainbow" to be rejected (unknown mark type)',
);
assert(
  !unknownMarkType.valid &&
    unknownMarkType.errors.some((message) => message.includes('rainbow')),
  'expected unknown-mark rejection to mention the offending type "rainbow"',
);

const javascriptLink = validateCanvasSiteState(
  richTextStateWith([{ text: 'go', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }]),
);
assert(
  !javascriptLink.valid,
  'expected text element with javascript:alert(1) link mark to be rejected',
);
assert(
  !javascriptLink.valid &&
    javascriptLink.errors.some((message) => message.includes('javascript:alert(1)')),
  'expected javascript-link rejection to mention the offending href',
);

// -- Task 5: public host router -------------------------------------------
// An unknown subdomain under *.rev01.aayushman.dev should be handled by the
// public router (not the app's landing/health/etc.) and return 404 because
// no site row matches.
const unknownSubdomain = await responseFromHost('unknown-subdomain.rev01.aayushman.dev', '/');
assert(
  unknownSubdomain.status === 404,
  `expected unknown Published Address to 404, got ${unknownSubdomain.status}`,
);
assert(
  unknownSubdomain.body.length > 0,
  'expected unknown-subdomain 404 body to be a non-empty string',
);
assert(
  unknownSubdomain.body.toLowerCase().includes('not found') ||
    unknownSubdomain.body.toLowerCase().includes('not yet published'),
  `expected unknown-subdomain 404 body to mention "not found" or "not yet published" (got ${JSON.stringify(unknownSubdomain.body)})`,
);

// The app host (rev01.aayushman.dev) must still serve the landing page —
// the public router has to return null on this host, not intercept it.
const appHostLanding = await responseFromHost('rev01.aayushman.dev', '/');
assert(
  appHostLanding.status === 200,
  `expected rev01.aayushman.dev / to still serve the landing page, got ${appHostLanding.status}`,
);
assert(
  appHostLanding.body.includes('multiplayer site builder'),
  'expected rev01.aayushman.dev / to render the Post-Aero landing copy',
);

// -- Task 5.5: publish smoke + broadcast payload hardening ----------------
// These assertions sit behind a real DB write — seed a customer + site row
// with a unique subdomain, exercise the unpublished/published/__live paths,
// and clean up in `finally` regardless of outcome. The publish endpoint is
// auth-gated by Clerk so the smoke shortcuts it by writing the snapshot
// directly; the public render path is the thing under test here.

if (!smokeEnv.DATABASE_URL) {
  throw new Error(
    '[review-smoke] DATABASE_URL is required for the Task 5.5 publish smoke (no fallback — set process.env.DATABASE_URL)',
  );
}

const smokeDb = db({ DATABASE_URL: smokeEnv.DATABASE_URL });
const SMOKE_CLERK_USER = 'smoke-user-' + crypto.randomUUID().slice(0, 8);
const SMOKE_SUB = 'smoke-' + crypto.randomUUID().slice(0, 8).toLowerCase();
const SMOKE_HOST = `${SMOKE_SUB}.rev01.aayushman.dev`;

try {
  const insertedCustomer = await smokeDb
    .insert(customer)
    .values({
      clerkUserId: SMOKE_CLERK_USER,
      email: `${SMOKE_CLERK_USER}@example.invalid`,
    })
    .returning({ id: customer.id });
  const seededCustomerId = insertedCustomer[0]?.id;
  assert(
    typeof seededCustomerId === 'string' && seededCustomerId.length > 0,
    'expected seeded customer insert to return an id',
  );

  await smokeDb.insert(site).values({
    customerId: seededCustomerId as string,
    name: 'smoke',
    subdomain: SMOKE_SUB,
    styleKit: starterTemplate.state.styleKit,
    editableState: starterTemplate.state,
    publishedSnapshot: null,
    publishedVersion: 0,
  });

  // 1. Unpublished site → 404 with "not yet published".
  const unpubResp = await responseFromHost(SMOKE_HOST, '/');
  assert(
    unpubResp.status === 404,
    `expected unpublished site to 404, got ${unpubResp.status}`,
  );
  assert(
    /not yet published|not found/i.test(unpubResp.body),
    `expected unpublished body to mention "not yet published" or "not found" (got ${JSON.stringify(unpubResp.body)})`,
  );

  // 2. Insert a Published Snapshot directly. The publish endpoint requires
  // Clerk auth, so the smoke writes the same shape the endpoint would.
  const publishedSnapshot = {
    version: 1,
    publishedAt: new Date().toISOString(),
    styleKit: starterTemplate.state.styleKit,
    pages: starterTemplate.state.pages,
  };
  await smokeDb
    .update(site)
    .set({
      publishedSnapshot,
      publishedVersion: 1,
      updatedAt: sql`now()`,
    })
    .where(eq(site.subdomain, SMOKE_SUB));

  // 3. Published site → 200 with the public root, page id, and version stamp.
  const pubResp = await responseFromHost(SMOKE_HOST, '/');
  assert(
    pubResp.status === 200,
    `expected published site to 200, got ${pubResp.status}`,
  );
  assert(
    pubResp.body.includes('data-rev01-public-root'),
    'expected published body to contain data-rev01-public-root',
  );
  assert(
    pubResp.body.includes('data-rev01-page="page-home"'),
    'expected published body to contain data-rev01-page="page-home"',
  );
  assert(
    pubResp.body.includes('currentVersion = 1'),
    'expected published body to inject currentVersion = 1 in the visitor script',
  );

  // 4. /__live without an Upgrade header → 426 with the canonical message.
  const liveResp = await responseFromHost(SMOKE_HOST, '/__live');
  assert(
    liveResp.status === 426,
    `expected /__live without upgrade to 426, got ${liveResp.status}`,
  );
  assert(
    /expected websocket/i.test(liveResp.body),
    `expected /__live 426 body to mention "expected websocket" (got ${JSON.stringify(liveResp.body)})`,
  );

  // 5. App host /__live → NOT a 426 (public router returns null, app routes
  // take over). The exact status doesn't matter as long as the public router
  // did not handle it as a Published Address.
  const appLive = await responseFromHost('rev01.aayushman.dev', '/__live');
  assert(
    appLive.status !== 426,
    `expected app host /__live not to be a 426 (public router should ignore the app host), got ${appLive.status}`,
  );
} finally {
  // Clean up regardless of assertion outcome. site is FK-cascade-deleted
  // by customer, but we delete in dependency order anyway so the smoke
  // does not rely on the cascade contract.
  await smokeDb.delete(site).where(eq(site.subdomain, SMOKE_SUB));
  await smokeDb.delete(customer).where(eq(customer.clerkUserId, SMOKE_CLERK_USER));
}

console.log('[review-smoke] OK');
