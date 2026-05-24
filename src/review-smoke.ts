import { eq, sql } from 'drizzle-orm';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from './index';
import { applyCanvasAgentOp } from './agent/canvas-ops';
import { CANVAS_AGENT_TOOLS } from './agent/canvas-tools';
import {
  collectReferencedAssetIds,
  collectReferencedAssets,
  findAssetReferenceErrors,
} from './assets/site-assets';
import { resolveAuthRedirectUrl, resolveClerkKeys } from './auth/middleware';
import { canvasPublishedStyles } from './canvas/public-styles';
import { createSectionFromRecipe } from './canvas/recipes';
import type { CanvasSiteState, SectionRecipeId } from './canvas/schema';
import { SECTION_RECIPE_IDS } from './canvas/schema';
import { SEED_ASSET_REGISTRY } from './canvas/seed-assets';
import { STYLE_KIT_PRESETS } from './canvas/style-kits';
import {
  validateCanvasSiteState,
  validatePublishedSnapshot,
  validateSeedFixture,
} from './canvas/validate';
import { db } from './db/client';
import { customer, ownerAsset, site } from './db/schema';
import { canvasClientScript } from './editor/canvas-client';
import { buildSignInUrl, buildSignOutUrl } from './auth/require-auth';
import {
  prepareSeedAssetsForCustomer,
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_RE,
  validateSubdomain,
} from './routes/api/sites';
import { canReadScopedLibraryRow, escapeHtmlText } from './routes/api/library-access';
import { allTemplateSeeds, getTemplateSeed, starterTemplate } from './templates/registry';

function assert(condition: boolean, message: string): asserts condition {
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

async function readSource(relativePath: string): Promise<string> {
  const response = await fetch(new URL(relativePath, import.meta.url));
  if (!response.ok) {
    throw new Error(`failed to read ${relativePath}: ${String(response.status)}`);
  }
  return response.text();
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

assert(
  canReadScopedLibraryRow({ visibility: 'global', customerId: null }, null),
  'expected global library/template rows to be readable without a customer row',
);
assert(
  canReadScopedLibraryRow({ visibility: 'private', customerId: 'owner-a' }, 'owner-a'),
  'expected private library/template rows to be readable by their owner',
);
assert(
  !canReadScopedLibraryRow({ visibility: 'private', customerId: 'owner-a' }, 'owner-b'),
  'expected private library/template rows to be hidden from other owners',
);
assert(
  escapeHtmlText('<template "x" & y>') === '&lt;template &quot;x&quot; &amp; y&gt;',
  'expected custom template preview titles to be HTML-escaped',
);

const emptyPagesState = validateCanvasSiteState({ styleKit: 'charcoal', pages: [] });
assert(!emptyPagesState.valid, 'expected canvas site state with no pages to be invalid');

const editableEmptyMediaState: CanvasSiteState = {
  styleKit: 'charcoal',
  symbols: [],
  pages: [
    {
      id: 'page-empty-media',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'section-empty-media',
          recipeId: 'hero-split',
          name: 'Empty media',
          height: 400,
          elements: [
            {
              id: 'empty-media',
              type: 'media',
              mediaKind: 'image',
              assetId: '',
              alt: '',
              fit: 'cover',
              box: { x: 0, y: 0, w: 320, h: 180, z: 1 },
            },
          ],
        },
      ],
    },
  ],
};
const editableEmptyMedia = validateCanvasSiteState(editableEmptyMediaState);
assert(
  editableEmptyMedia.valid,
  editableEmptyMedia.valid
    ? ''
    : `expected editable empty media slot to remain saveable: ${editableEmptyMedia.errors.join('; ')}`,
);
const publishedEmptyMedia = validatePublishedSnapshot({
  version: 1,
  publishedAt: '2030-01-02T00:00:00.000Z',
  styleKit: editableEmptyMediaState.styleKit,
  pages: editableEmptyMediaState.pages,
});
assert(!publishedEmptyMedia.valid, 'expected published snapshots to reject empty media asset ids');
assert(
  !publishedEmptyMedia.valid &&
    publishedEmptyMedia.errors.some((message) =>
      message.includes('assetId must be non-empty in published snapshots'),
    ),
  'expected published empty-media rejection to name the empty assetId',
);

// Task 5.6 invariant: a two-page state must be rejected. Clone the starter
// template's single page and push another copy so the only reason for
// rejection is the length rule itself.
const twoPageStarter = {
  ...starterTemplate.state,
  pages: [
    structuredClone(starterTemplate.state.pages[0]),
    structuredClone(starterTemplate.state.pages[0]),
  ],
};
const twoPageResult = validateCanvasSiteState(twoPageStarter);
assert(
  !twoPageResult.valid,
  'expected validator to reject a two-page state (single-page POC invariant)',
);
assert(
  !twoPageResult.valid &&
    twoPageResult.errors.some((message) => message.includes('exactly one canvas page')),
  'expected two-page rejection to mention "exactly one canvas page"',
);

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
  !emptyContent.valid && emptyContent.errors.some((message) => message.includes('non-empty array')),
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
  !unknownMarkType.valid && unknownMarkType.errors.some((message) => message.includes('rainbow')),
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

// -- Template picker -------------------------------------------------------
// Site creation must expose an actual user choice, not a hidden default. The
// registry carries multiple canvas seeds, the dashboard renders them as a
// visible radio group, and the API rejects missing templateId instead of
// silently substituting starter-canvas.

assert(allTemplateSeeds.length >= 3, 'expected at least three selectable template seeds');
const templateIds = new Set<string>();
for (const seed of allTemplateSeeds) {
  assert(!templateIds.has(seed.id), `expected template id ${seed.id} to be unique`);
  templateIds.add(seed.id);
  assert(getTemplateSeed(seed.id) === seed, `expected getTemplateSeed to resolve ${seed.id}`);
  const seedStateResult = validateCanvasSiteState(seed.state);
  assert(
    seedStateResult.valid,
    seedStateResult.valid
      ? ''
      : `expected template ${seed.id} to pass canvas validation: ${seedStateResult.errors.join('; ')}`,
  );
  const seedAssetResult = validateSeedFixture(seed.state);
  assert(
    seedAssetResult.valid,
    seedAssetResult.valid
      ? ''
      : `expected template ${seed.id} to pass seed asset validation: ${seedAssetResult.errors.join('; ')}`,
  );
}

const templatesPageSource = await readSource('./routes/dashboard/templates.tsx');
assert(
  templatesPageSource.includes('allTemplateSeeds.map'),
  'expected templates page to render every TemplateSeed',
);
assert(
  templatesPageSource.includes('type="radio"') && templatesPageSource.includes('name="templateId"'),
  'expected templates page to use visible templateId radio inputs',
);
assert(
  !/<input\s+type="hidden"\s+name="templateId"/.test(templatesPageSource),
  'expected templates page not to hide templateId in a single fixed input',
);
assert(
  templatesPageSource.includes('<iframe') && templatesPageSource.includes('/preview'),
  'expected templates page to render iframe previews for selectable templates',
);
assert(
  templatesPageSource.includes('sandbox=""'),
  'expected template preview iframes to be sandboxed without extra permissions',
);
assert(
  templatesPageSource.includes("templatesRoute.get('/:templateId/preview'"),
  'expected templates route to expose a per-template preview page',
);
assert(
  templatesPageSource.includes("templatesRoute.get('/:templateId/assets/:assetId'"),
  'expected templates route to serve seed assets used by template previews',
);
assert(
  templatesPageSource.includes('renderCanvasSnapshot') &&
    templatesPageSource.includes('canvasPublishedStyles'),
  'expected template previews to use the real canvas renderer and published styles',
);

const sitesApiSource = await readSource('./routes/api/sites.ts');
assert(
  !sitesApiSource.includes("input.templateId.trim() === '' ? 'starter-canvas'"),
  'expected site creation API not to silently default a missing templateId',
);
const sectionsApiSource = await readSource('./routes/api/sections.ts');
assert(
  sectionsApiSource.includes('.where(and(eq(site.id, siteId), eq(site.customerId, customerId)))'),
  'expected section import site lookup to be scoped by both site id and owner customer',
);
assert(
  !sectionsApiSource.includes("return c.json({ error: 'forbidden' }, 403)"),
  'expected section import to hide unowned site ids behind the same 404 contract as canvas APIs',
);

const dashboardSource = await readSource('./routes/dashboard/index.tsx');
assert(
  dashboardSource.includes('interface SiteCard') &&
    dashboardSource.includes('let cards: SiteCard[] = []'),
  'expected dashboard to model all owned sites as cards, not only one editor link',
);
assert(
  dashboardSource.includes('cards.map'),
  'expected dashboard to render every owned site card in a list/grid',
);
assert(
  !dashboardSource.includes('const latestSite'),
  'expected dashboard not to query only the latest site',
);
assert(
  !dashboardSource.includes('let editorLink'),
  'expected dashboard not to collapse owned sites into a single editorLink',
);

const publicRouteSource = await readSource('./routes/public.ts');
const publishRouteSource = await readSource('./routes/api/publish.ts');
const indexSource = await readSource('./index.ts');
const siteRoomSource = await readSource('./live/site-room.ts');
const unlockRouteSource = await readSource('./password/unlock-route.ts');
const renderSource = await readSource('./canvas/render.ts');
assert(
  /renderCanvasSnapshot\(\s*renderSnapshot,\s*'\/assets',\s*siteRow\.id\s*\)/.test(
    publicRouteSource,
  ),
  'expected public render to pass site id through so Form elements post to /__rev01/forms/:siteId/:formId',
);
assert(
  /renderCanvasSnapshot\(\s*snapshot,\s*'\/assets',\s*row\.id\s*\)/.test(publishRouteSource),
  'expected publish broadcast render to pass site id through so live-updated forms keep a valid action',
);
assert(
  publicRouteSource.includes('prepareRender(path, snapshot)') &&
    publicRouteSource.includes('renderSnapshot') &&
    publicRouteSource.includes('dir="${raw(escapeAttr(dir))}"'),
  'expected public route to use the i18n render hook for locale routing, RTL mirroring, and html dir',
);
assert(
  !publicRouteSource.includes('const pageSlug =\n    path ===') &&
    !publicRouteSource.includes('path.replace(/^\\//, \'\').split(\'/\')[0]'),
  'expected public route not to use first-path-segment slug matching after i18n routing lands',
);
assert(
  !renderSource.includes('lang="en" data-style-kit'),
  'expected canvas body renderer not to force lang="en" inside locale-aware documents',
);
assert(
  publicRouteSource.includes('emitFontFaceBlocks') &&
    publicRouteSource.includes('resolveFontTokens') &&
    publicRouteSource.includes('siteFont'),
  'expected public route to resolve custom font tokens and emit @font-face CSS for Published Sites',
);
assert(
  publicRouteSource.includes('role=visitor') &&
    indexSource.includes("app.get('/__live'") &&
    indexSource.includes('requireAuth()') &&
    indexSource.includes('role=editor'),
  'expected /__live to separate unauthenticated visitor sockets from authenticated editor sockets',
);
assert(
  siteRoomSource.includes('socketRoles') &&
    siteRoomSource.includes('isEditorSocket') &&
    siteRoomSource.includes('rejected visitor websocket message'),
  'expected SiteRoom to reject visitor-originated Yjs writes and fan out Yjs payloads only to editors',
);
assert(
  unlockRouteSource.includes('resolveCustomDomainWithRuntimeCache') &&
    unlockRouteSource.includes('loadSiteById'),
  'expected password unlock route to resolve custom-domain Published Addresses, not only subdomains',
);

const enterpriseTemplate = getTemplateSeed('enterprise-scale-canvas');
assert(enterpriseTemplate !== null, 'expected enterprise-scale-canvas template seed to exist');
assert(
  enterpriseTemplate.name === 'Enterprise Scale',
  `expected enterprise-scale-canvas name to be Enterprise Scale (got ${enterpriseTemplate.name})`,
);
const enterprisePage = enterpriseTemplate.state.pages[0];
assert(enterprisePage !== undefined, 'expected enterprise template to contain one canvas page');
assert(
  enterprisePage.title === 'Enterprise Scale',
  `expected enterprise page title to be Enterprise Scale (got ${enterprisePage.title})`,
);
assert(
  enterprisePage.sections.length >= 6,
  `expected enterprise template to carry a full multi-section page (got ${String(enterprisePage.sections.length)})`,
);
assert(
  enterprisePage.sections.some((section) => section.id === 'enterprise-proof'),
  'expected enterprise template to include a proof section',
);
assert(
  enterprisePage.sections.some((section) => section.id === 'enterprise-governance'),
  'expected enterprise template to include a governance section',
);
// -- Dev Clerk auth URL regressions ----------------------------------------
// Wrangler dev rewrites c.req.url to the prod custom-domain route. When
// CLERK_TEST_* keys are present, every Clerk portal redirect must use the same
// local origin as the request passed into clerk.authenticateRequest; otherwise
// sign-in/sign-out bounces between localhost and prod.

const authMiddlewareSource = await readSource('./auth/middleware.ts');
const requireAuthSource = await readSource('./auth/require-auth.ts');
assert(
  authMiddlewareSource.includes('export function resolveAuthRedirectUrl'),
  'expected auth middleware to expose a shared local/prod redirect URL resolver',
);
assert(
  requireAuthSource.includes('resolveAuthRedirectUrl(c.env, c.req.url)'),
  'expected requireAuth sign-in redirect_url to use the shared local/prod URL resolver',
);
assert(
  dashboardSource.includes('resolveClerkKeys(c.env)'),
  'expected dashboard sign-out to use the same resolved Clerk key pair as clerkAuth',
);
assert(
  dashboardSource.includes("resolveAuthRedirectUrl(c.env, c.req.url, '/')"),
  'expected dashboard sign-out redirect_url to resolve to local origin in dev',
);

const livePublishableKey = `pk_live_${btoa('clerk.rev01.aayushman.dev$')}`;
const testPublishableKey = `pk_test_${btoa('local-dev.clerk.accounts.dev$')}`;
const devClerkEnv = {
  CLERK_PUBLISHABLE_KEY: livePublishableKey,
  CLERK_SECRET_KEY: 'sk_live_review_smoke',
  CLERK_TEST_PUBLISHABLE_KEY: testPublishableKey,
  CLERK_TEST_SECRET_KEY: 'sk_test_review_smoke',
  DEV_PUBLIC_HOST: 'http://localhost:8787',
};
const liveClerkEnv = {
  CLERK_PUBLISHABLE_KEY: livePublishableKey,
  CLERK_SECRET_KEY: 'sk_live_review_smoke',
};
const devSignInRedirect = resolveAuthRedirectUrl(
  devClerkEnv,
  'https://rev01.aayushman.dev/dashboard?next=sites',
);
assert(
  devSignInRedirect === 'http://localhost:8787/dashboard?next=sites',
  `expected dev sign-in redirect_url to stay local, got ${devSignInRedirect}`,
);
const devSignInUrl = new URL(
  buildSignInUrl(resolveClerkKeys(devClerkEnv).publishableKey, devSignInRedirect),
);
assert(
  devSignInUrl.origin === 'https://local-dev.accounts.dev',
  `expected dev sign-in to use the test Clerk portal, got ${devSignInUrl.origin}`,
);
assert(
  devSignInUrl.searchParams.get('redirect_url') === devSignInRedirect,
  'expected dev sign-in redirect_url query param to match the resolved local URL',
);
const devSignOutRedirect = resolveAuthRedirectUrl(
  devClerkEnv,
  'https://rev01.aayushman.dev/dashboard',
  '/',
);
assert(
  devSignOutRedirect === 'http://localhost:8787/',
  `expected dev sign-out redirect_url to stay local, got ${devSignOutRedirect}`,
);
const devSignOutUrl = new URL(
  buildSignOutUrl(resolveClerkKeys(devClerkEnv).publishableKey, devSignOutRedirect),
);
assert(
  devSignOutUrl.origin === 'https://local-dev.accounts.dev',
  `expected dev sign-out to use the test Clerk portal, got ${devSignOutUrl.origin}`,
);
assert(
  devSignOutUrl.searchParams.get('redirect_url') === devSignOutRedirect,
  'expected dev sign-out redirect_url query param to match the resolved local URL',
);
const liveRedirect = resolveAuthRedirectUrl(
  liveClerkEnv,
  'https://rev01.aayushman.dev/dashboard?next=sites',
);
assert(
  liveRedirect === 'https://rev01.aayushman.dev/dashboard?next=sites',
  `expected live sign-in redirect_url to keep the request URL, got ${liveRedirect}`,
);
const liveSignOutRedirect = resolveAuthRedirectUrl(
  liveClerkEnv,
  'https://rev01.aayushman.dev/dashboard',
  '/',
);
assert(
  liveSignOutRedirect === 'https://rev01.aayushman.dev/',
  `expected live sign-out redirect_url to use the live origin, got ${liveSignOutRedirect}`,
);
try {
  resolveAuthRedirectUrl(
    devClerkEnv,
    'https://rev01.aayushman.dev/dashboard',
    'https://example.invalid/',
  );
  throw new Error('expected absolute auth redirect override paths to be rejected');
} catch (error) {
  assert(
    error instanceof Error &&
      error.message.includes('auth redirect override path must be root-relative'),
    `expected root-relative override path failure, got ${String(error)}`,
  );
}

// -- Canvas-first review regressions --------------------------------------
// These are source-level checks for the browser-only editor script. They keep
// the POC's "Owner can save/publish/ask AI without losing local edits" flow
// wired even though review-smoke does not boot a browser.

const canvasIndexSource = await readSource('./editor/canvas-index.tsx');
const canvasClientSource = await readSource('./editor/canvas-client.ts');
const canvasApiSource = await readSource('./routes/api/canvas.ts');
const publishApiSource = await readSource('./routes/api/publish.ts');
assert(
  !/<button\s+id="canvas-publish"[^>]*\sdisabled\b/.test(canvasIndexSource),
  'expected Publish button to be enabled in the canvas editor shell',
);
assert(
  canvasClientSource.includes('const publishButton = document.getElementById("canvas-publish")'),
  'expected canvas client to look up #canvas-publish',
);
assert(
  canvasClientSource.includes('API_BASE + "/publish/sites/" + SITE_ID'),
  'expected canvas client to POST to the selected publish API base for :siteId',
);
assert(
  canvasApiSource.includes('cannot save: missing assets'),
  'expected canvas save API to reject stale editable states that reference deleted assets',
);
assert(
  publishApiSource.includes('cannot publish: unfilled media slots'),
  'expected publish API to reject empty media slots with a 400-level owner error',
);
assert(
  canvasClientSource.includes('API_BASE + "/owner/assets"'),
  'expected media picker delete/gallery flow to use the selected owner asset API base',
);
assert(
  !canvasClientSource.includes('/api/me/assets'),
  'expected media picker not to call the retired /api/me/assets route after main asset-pipeline merge',
);
assert(
  canvasClientSource.includes('function clearDeletedAssetFromLocalState'),
  'expected media picker delete success to clear every local reference before any later full-state save',
);
assert(
  canvasClientSource.includes(
    'Live published sites that will show missing media until you re-publish',
  ),
  'expected media picker delete confirmation to distinguish published breakage from editable clearing',
);
assert(
  canvasClientSource.includes('async function flushPendingSave()'),
  'expected canvas client to expose a flushPendingSave helper before server-derived edits',
);
assert(
  /async function runAiPreview[\s\S]*await flushPendingSave\(\)/.test(canvasClientSource),
  'expected AI preview to flush pending local saves before asking the server',
);
assert(
  /async function applyPreview[\s\S]*await flushPendingSave\(\)/.test(canvasClientSource),
  'expected AI apply to flush pending local saves before applying server ops',
);
assert(
  /async function publishSite[\s\S]*await flushPendingSave\(\)/.test(canvasClientSource),
  'expected publish to flush pending local saves before snapshotting editable state',
);
assert(
  /async function importPendingSectionAt[\s\S]*const saved = await flushPendingSave\(\);[\s\S]*if \(!saved\) return;/.test(
    canvasClientSource,
  ),
  'expected section import to flush pending local saves before asking the server',
);
assert(
  canvasIndexSource.includes('id="canvas-sidebar"'),
  'expected canvas editor shell to include the left add/style sidebar',
);
assert(
  canvasIndexSource.includes('data-sidebar-add-section="blank"'),
  'expected canvas sidebar to expose a blank-section add button',
);
for (const component of ['text', 'image', 'video', 'action', 'shape', 'container']) {
  assert(
    canvasIndexSource.includes(`data-sidebar-add-component="${component}"`),
    `expected canvas sidebar to expose ${component} component add button`,
  );
}
assert(
  canvasIndexSource.includes('data-sidebar-style-kit={kit}'),
  'expected style-kit controls to live in the sidebar',
);
assert(
  canvasIndexSource.includes('id="canvas-sidebar-selection"'),
  'expected selected-element color controls to reserve a sidebar region',
);
assert(
  !canvasIndexSource.includes('<span class="style-kits"'),
  'expected style-kit controls to move out of the topbar',
);
assert(
  canvasClientSource.includes('const sidebar = document.getElementById("canvas-sidebar")'),
  'expected canvas client to look up #canvas-sidebar',
);
assert(
  canvasClientSource.includes(
    'const sidebarSelection = document.getElementById("canvas-sidebar-selection")',
  ),
  'expected canvas client to look up the sidebar selected-element region',
);
assert(
  canvasClientSource.includes('function attachSidebarActions()'),
  'expected canvas client to wire sidebar add/style actions',
);
assert(
  canvasClientSource.includes('function renderSidebarSelection()'),
  'expected canvas client to render selected-element color controls in the sidebar',
);
assert(
  !canvasClientSource.includes('appendPinnedColor(element);'),
  'expected text color control to move out of the right inspector',
);
assert(
  canvasClientSource.includes('function addBlankSectionFromSidebar()'),
  'expected canvas client to add blank sections from the sidebar',
);
assert(
  canvasClientSource.includes("querySelectorAll('[data-sidebar-style-kit]')"),
  'expected style-kit click handling to bind sidebar style-kit buttons',
);
const inlineCanvasClient = canvasClientScript({ siteId: 'site-smoke' });
const inlineCanvasClientParseDir = await mkdtemp(join(tmpdir(), 'rev01-canvas-client-'));
const inlineCanvasClientParsePath = join(inlineCanvasClientParseDir, 'client.mjs');
try {
  await writeFile(inlineCanvasClientParsePath, `if (false) {\n${inlineCanvasClient}\n}\n`);
  await import(pathToFileURL(inlineCanvasClientParsePath).href);
} finally {
  await rm(inlineCanvasClientParseDir, { recursive: true, force: true });
}
assert(
  inlineCanvasClient.includes("querySelectorAll('[data-sidebar-style-kit]')"),
  'expected style-kit click handling to bind sidebar style-kit buttons',
);
assert(
  !inlineCanvasClient.includes("querySelectorAll('[data-style-kit]')"),
  'expected style-kit click handling not to bind generic data-style-kit nodes',
);
assert(
  inlineCanvasClient.includes('function isEditableShortcutTarget('),
  'expected canvas interaction shortcuts to ignore inputs, textareas, selects, buttons, and contenteditable targets',
);
assert(
  inlineCanvasClient.includes('temporaryPanPreviousMode'),
  'expected temporary Space pan to restore the previous interaction mode instead of always selecting',
);
assert(
  inlineCanvasClient.includes('window.addEventListener("blur"'),
  'expected temporary Space pan to recover if the window loses focus before keyup',
);
assert(
  inlineCanvasClient.includes('mbtn.setAttribute("aria-label"'),
  'expected icon-only interaction-mode toolbar buttons to expose accessible labels',
);

const tsconfigSource = await readSource('../tsconfig.json');
const tsconfig = JSON.parse(tsconfigSource) as { exclude?: string[] };
assert(
  !(tsconfig.exclude ?? []).some((entry) => entry.startsWith('src/')),
  'expected tsconfig not to exclude legacy src code from typecheck; retired code should be removed',
);
const eslintConfigSource = await readSource('../eslint.config.js');
assert(
  !eslintConfigSource.includes("'src/multiplayer/**'") &&
    !eslintConfigSource.includes("'src/editor/client.ts'") &&
    !eslintConfigSource.includes("'src/agent/ops.ts'") &&
    !eslintConfigSource.includes("'src/routes/api/pages.ts'"),
  'expected eslint config not to hide retired src code from lint',
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
    customerId: seededCustomerId,
    name: 'smoke',
    subdomain: SMOKE_SUB,
    styleKit: starterTemplate.state.styleKit,
    editableState: starterTemplate.state,
    publishedSnapshot: null,
    publishedVersion: 0,
  });

  // 1. Unpublished site → 404 with "not yet published".
  const unpubResp = await responseFromHost(SMOKE_HOST, '/');
  assert(unpubResp.status === 404, `expected unpublished site to 404, got ${unpubResp.status}`);
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
  assert(pubResp.status === 200, `expected published site to 200, got ${pubResp.status}`);
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

// -- Task 6: seed-asset registry + site-creation materialisation ----------
// Positive case: the bundled fixture passes validateSeedFixture (every media
// `assetId` and `posterAssetId` resolves in SEED_ASSET_REGISTRY).
const seedOk = validateSeedFixture(starterTemplate.state);
assert(
  seedOk.valid,
  seedOk.valid
    ? ''
    : `expected validateSeedFixture(starterTemplate.state) to pass: ${seedOk.errors.join('; ')}`,
);

// Negative case: a fixture whose media references an unregistered assetId is
// rejected, with the rejection message mentioning the offending id.
const T6_BOGUS_ID = 't6-bogus-asset-id';
const bogusFixture: CanvasSiteState = structuredClone(starterTemplate.state);
const bogusPage = bogusFixture.pages[0];
if (!bogusPage) throw new Error('starterTemplate must have at least one page');
const bogusSection = bogusPage.sections.find((s) => s.id === 'section-hero');
if (!bogusSection) throw new Error('starterTemplate must have a hero section');
const bogusMedia = bogusSection.elements.find((el) => el.id === 'hero-media');
if (!bogusMedia || bogusMedia.type !== 'media') {
  throw new Error('starterTemplate hero must contain media element hero-media');
}
bogusMedia.assetId = T6_BOGUS_ID;
const bogusSeed = validateSeedFixture(bogusFixture);
assert(
  !bogusSeed.valid,
  'expected validateSeedFixture to reject a fixture with an unregistered assetId',
);
assert(
  !bogusSeed.valid && bogusSeed.errors.some((m) => m.includes(T6_BOGUS_ID)),
  `expected validateSeedFixture rejection to mention the offending id ${T6_BOGUS_ID}`,
);

const kindMismatchFixture: CanvasSiteState = structuredClone(starterTemplate.state);
const kindMismatchPage = kindMismatchFixture.pages[0];
if (!kindMismatchPage) throw new Error('starterTemplate must have at least one page');
const kindMismatchSection = kindMismatchPage.sections.find((s) => s.id === 'section-hero');
if (!kindMismatchSection) throw new Error('starterTemplate must have a hero section');
const kindMismatchMedia = kindMismatchSection.elements.find((el) => el.id === 'hero-media');
if (!kindMismatchMedia || kindMismatchMedia.type !== 'media') {
  throw new Error('starterTemplate hero must contain media element hero-media');
}
kindMismatchMedia.mediaKind = 'video';
kindMismatchMedia.assetId = 'seed-hero-poster-1';
const kindMismatchSeed = validateSeedFixture(kindMismatchFixture);
assert(
  !kindMismatchSeed.valid,
  'expected validateSeedFixture to reject mediaKind/seed asset kind mismatches',
);
assert(
  !kindMismatchSeed.valid &&
    kindMismatchSeed.errors.some((m) => m.includes('seed-hero-poster-1') && m.includes('image')),
  'expected seed kind mismatch rejection to mention the image asset id',
);

const posterReferenceState: CanvasSiteState = structuredClone(starterTemplate.state);
const posterReferencePage = posterReferenceState.pages[0];
if (!posterReferencePage) throw new Error('starterTemplate must have at least one page');
const posterReferenceSection = posterReferencePage.sections.find((s) => s.id === 'section-hero');
if (!posterReferenceSection) throw new Error('starterTemplate must have a hero section');
const posterReferenceMedia = posterReferenceSection.elements.find((el) => el.id === 'hero-media');
if (!posterReferenceMedia || posterReferenceMedia.type !== 'media') {
  throw new Error('starterTemplate hero must contain media element hero-media');
}
posterReferenceMedia.mediaKind = 'video';
posterReferenceMedia.assetId = 'video-asset-id';
posterReferenceMedia.posterAssetId = 'poster-asset-id';
const referencedAssets = collectReferencedAssets(posterReferenceState.pages);
assert(
  referencedAssets.some(
    (ref) =>
      ref.assetId === 'poster-asset-id' && ref.expectedKind === 'image' && ref.role === 'poster',
  ),
  'expected collectReferencedAssets to include poster ids as image references',
);
const referenceErrors = findAssetReferenceErrors(posterReferenceState.pages, [
  { id: 'video-asset-id', kind: 'image' },
  { id: 'poster-asset-id', kind: 'image' },
]);
assert(
  referenceErrors.some(
    (error) =>
      error.assetId === 'video-asset-id' &&
      error.reason === 'kind-mismatch' &&
      error.expectedKind === 'video' &&
      error.actualKind === 'image',
  ),
  'expected findAssetReferenceErrors to reject a video element backed by an image asset row',
);
for (const [assetId, asset] of Object.entries(SEED_ASSET_REGISTRY)) {
  if (asset.kind === 'image') {
    assert(
      asset.mediaType.startsWith('image/'),
      `expected seed image ${assetId} to use an image/* mediaType`,
    );
  } else {
    assert(
      asset.mediaType.startsWith('video/'),
      `expected seed video ${assetId} to use a video/* mediaType`,
    );
    // Post-ADR-0006 the seed registry does not carry bytes inline. The
    // per-byte sanity check we used to run on `bytesBase64` is now
    // performed at upload time by the `seed:assets` script (verifies
    // contentHash matches the bytes file). The registry-level
    // image/video kind discriminator is the only assertion the smoke
    // can make here without re-decoding source bytes.
    assert(
      asset.contentHash.length === 64,
      `expected seed ${assetId} to carry a sha256 contentHash (64 hex chars)`,
    );
  }
}

// Site-creation materialisation: after creating a smoke site, the count of
// `ownerAsset` rows for that Owner MUST equal the count of seed asset ids
// referenced by `starterTemplate.state`. Per ADR 0004 the asset root is
// the Owner — two sites under the same Owner share seed rows; we exercise
// only the single-Owner path here so the row count comparison stays
// straightforward.
const T6_CLERK_USER = 'smoke-t6-' + crypto.randomUUID().slice(0, 8);
const T6_SUB = 't6-' + crypto.randomUUID().slice(0, 8).toLowerCase();
const referencedSeedIds = [...collectReferencedAssetIds(starterTemplate.state.pages)];
assert(
  referencedSeedIds.length > 0,
  'expected starterTemplate to reference at least one seed asset id',
);
const preparedForCustomerA = prepareSeedAssetsForCustomer('customer-a', starterTemplate.state);
const preparedForCustomerB = prepareSeedAssetsForCustomer('customer-b', starterTemplate.state);
assert(preparedForCustomerA.ok, 'expected seed asset preparation for customer-a to succeed');
assert(preparedForCustomerB.ok, 'expected seed asset preparation for customer-b to succeed');
const preparedAIds = new Set(
  preparedForCustomerA.ok ? preparedForCustomerA.seedRows.map((row) => row.id) : [],
);
const preparedBIds = new Set(
  preparedForCustomerB.ok ? preparedForCustomerB.seedRows.map((row) => row.id) : [],
);
for (const originalId of referencedSeedIds) {
  assert(
    !preparedAIds.has(originalId) && !preparedBIds.has(originalId),
    `expected materialised asset ids not to reuse global seed id "${originalId}"`,
  );
}
const preparedAStateIds = collectReferencedAssetIds(preparedForCustomerA.editableState.pages);
for (const originalId of referencedSeedIds) {
  assert(
    !preparedAStateIds.has(originalId),
    `expected editable state not to retain global seed asset id "${originalId}" after materialisation`,
  );
}
for (const row of preparedForCustomerA.seedRows) {
  assert(
    preparedAStateIds.has(row.id),
    `expected editable state to reference materialised Owner Asset id "${row.id}"`,
  );
}
for (const id of preparedAIds) {
  assert(!preparedBIds.has(id), `expected per-customer materialised asset id ${id} not to collide`);
}
let t6SiteId: string | null = null;
try {
  const inserted = await smokeDb
    .insert(customer)
    .values({
      clerkUserId: T6_CLERK_USER,
      email: `${T6_CLERK_USER}@example.invalid`,
    })
    .returning({ id: customer.id });
  const t6CustomerId = inserted[0]?.id;
  assert(
    typeof t6CustomerId === 'string' && t6CustomerId.length > 0,
    'expected T6 smoke customer insert to return an id',
  );

  t6SiteId = crypto.randomUUID();
  const preparedT6 = prepareSeedAssetsForCustomer(t6CustomerId, starterTemplate.state);
  assert(preparedT6.ok, 'expected T6 seed asset preparation to succeed');
  await smokeDb.insert(site).values({
    id: t6SiteId,
    customerId: t6CustomerId,
    name: 'smoke-t6',
    subdomain: T6_SUB,
    styleKit: preparedT6.editableState.styleKit,
    editableState: preparedT6.editableState,
    publishedSnapshot: null,
    publishedVersion: 0,
  });
  const seedRows = preparedT6.seedRows;
  await smokeDb.insert(ownerAsset).values(seedRows).onConflictDoNothing();

  const assetRows = await smokeDb
    .select({ id: ownerAsset.id })
    .from(ownerAsset)
    .where(eq(ownerAsset.customerId, t6CustomerId));
  assert(
    assetRows.length === seedRows.length,
    `expected owner_asset row count (${assetRows.length}) to equal prepared seed row count (${seedRows.length})`,
  );
  const presentIds = new Set(assetRows.map((r) => r.id));
  for (const row of seedRows) {
    assert(
      presentIds.has(row.id),
      `expected materialised owner_asset row "${row.id}" but it was missing`,
    );
  }
} finally {
  if (t6SiteId) {
    await smokeDb.delete(site).where(eq(site.id, t6SiteId));
  }
  await smokeDb.delete(customer).where(eq(customer.clerkUserId, T6_CLERK_USER));
}

// -- Task 7: canvas agent — apply function + route shell -----------------
// Pure smoke for the apply function so review-smoke fails loudly if the op
// translation regresses. We do not call the live LLM here — the canvas-agent
// preview/apply LLM call is exercised only when GEMINI_API_KEY is set; the
// route shell mount is what we verify below.

const baseT7State: CanvasSiteState = structuredClone(starterTemplate.state);
const baseT7Page = baseT7State.pages[0];
if (!baseT7Page) throw new Error('starterTemplate must have at least one page');
const baseT7Section = baseT7Page.sections[0];
if (!baseT7Section) throw new Error('starterTemplate first page must have at least one section');
const t7TextElement = baseT7Section.elements.find((e) => e.type === 'text');
if (!t7TextElement) throw new Error('starterTemplate hero must have a text element');
const t7MediaElement = baseT7Section.elements.find((e) => e.type === 'media');
if (!t7MediaElement) throw new Error('starterTemplate hero must have a media element');

// rewriteText: writes a new content array and revalidates clean.
const t7Rewrite = applyCanvasAgentOp(baseT7State, {
  kind: 'rewriteText',
  elementId: t7TextElement.id,
  content: [{ text: 'review-smoke ' }, { text: 'rewrite', marks: [{ type: 'bold' }] }],
});
const t7RewriteValidation = validateCanvasSiteState(t7Rewrite);
assert(
  t7RewriteValidation.valid,
  t7RewriteValidation.valid
    ? ''
    : `T7 rewriteText apply produced invalid state: ${t7RewriteValidation.errors.join('; ')}`,
);

// replaceMedia: overwrites assetId/alt and keeps state valid.
const t7Replace = applyCanvasAgentOp(baseT7State, {
  kind: 'replaceMedia',
  elementId: t7MediaElement.id,
  mediaKind: 'image',
  assetId: 'up-review-smoke-asset',
  alt: 'review-smoke alt',
});
const t7ReplaceValidation = validateCanvasSiteState(t7Replace);
assert(
  t7ReplaceValidation.valid,
  t7ReplaceValidation.valid
    ? ''
    : `T7 replaceMedia apply produced invalid state: ${t7ReplaceValidation.errors.join('; ')}`,
);

// insertSection: appends a feature-grid section via the registry factory.
const t7Insert = applyCanvasAgentOp(baseT7State, {
  kind: 'insertSection',
  afterSectionId: baseT7Section.id,
  recipeId: 'feature-grid',
  input: { brief: 'Three reasons it works.', styleKit: baseT7State.styleKit },
});
const t7InsertValidation = validateCanvasSiteState(t7Insert);
assert(
  t7InsertValidation.valid,
  t7InsertValidation.valid
    ? ''
    : `T7 insertSection apply produced invalid state: ${t7InsertValidation.errors.join('; ')}`,
);
const t7InsertedPage = t7Insert.pages[0];
assert(
  t7InsertedPage !== undefined && t7InsertedPage.sections.length === baseT7Page.sections.length + 1,
  'expected T7 insertSection to add exactly one section',
);

// Every recipe in the registry is exercised by canvas-agent-smoke.ts; here we
// only smoke that the entry point + tool set still names every recipe so the
// LLM cannot reach for a missing factory.
const t7ToolNames = CANVAS_AGENT_TOOLS.map((t) => t.name).sort();
assert(
  JSON.stringify(t7ToolNames) === JSON.stringify(['createSection', 'replaceMedia', 'rewriteText']),
  `expected CANVAS_AGENT_TOOLS to expose three tools (got [${t7ToolNames.join(', ')}])`,
);
for (const recipeId of SECTION_RECIPE_IDS as readonly SectionRecipeId[]) {
  const section = createSectionFromRecipe(recipeId, {
    brief: 'review smoke',
    styleKit: baseT7State.styleKit,
  });
  assert(section.recipeId === recipeId, `expected recipe factory for ${recipeId} to set recipeId`);
}

// Route shell: hitting /api/canvas-agent/sites/:siteId/preview without auth
// MUST redirect to the Clerk sign-in URL (clerkAuth + requireAuth gate). The
// public host router only intercepts *.rev01.aayushman.dev; the app host
// (rev01.test by default in review-smoke) falls through to the app routes.
const t7PreviewProbe = await app.request(
  'http://rev01.test/api/canvas-agent/sites/probe/preview',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"x"}' },
  smokeEnv,
);
assert(
  t7PreviewProbe.status === 302 || t7PreviewProbe.status === 401,
  `expected canvas-agent preview without auth to redirect or 401, got ${t7PreviewProbe.status}`,
);
const t7ApplyProbe = await app.request(
  'http://rev01.test/api/canvas-agent/sites/probe/apply',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ops":[]}' },
  smokeEnv,
);
assert(
  t7ApplyProbe.status === 302 || t7ApplyProbe.status === 401,
  `expected canvas-agent apply without auth to redirect or 401, got ${t7ApplyProbe.status}`,
);

// -- Task 8: public stylesheet must differ across kits -------------------
// The same `canvasPublishedStyles` string ships to every Published Site; we
// assert it contains a distinct `[data-style-kit="charcoal"] { ... }` block
// vs `[data-style-kit="orange-editorial"] { ... }` block and their accent
// declarations differ. This is the visitor-facing equivalent of the
// canvas:smoke kit-distinctness check.
const charcoalAnchor = '[data-style-kit="charcoal"] {';
const orangeAnchor = '[data-style-kit="orange-editorial"] {';
const charcoalStart = canvasPublishedStyles.indexOf(charcoalAnchor);
const orangeStart = canvasPublishedStyles.indexOf(orangeAnchor);
assert(
  charcoalStart >= 0,
  'expected public stylesheet to include a [data-style-kit="charcoal"] block',
);
assert(
  orangeStart >= 0,
  'expected public stylesheet to include a [data-style-kit="orange-editorial"] block',
);
const charcoalBlock = canvasPublishedStyles.slice(charcoalStart, charcoalStart + 600);
const orangeBlock = canvasPublishedStyles.slice(orangeStart, orangeStart + 600);
assert(
  charcoalBlock !== orangeBlock,
  'expected charcoal and orange-editorial blocks in public stylesheet to differ verbatim',
);
const charcoalAccent = STYLE_KIT_PRESETS.charcoal.accent;
const orangeAccent = STYLE_KIT_PRESETS['orange-editorial'].accent;
assert(
  charcoalAccent !== orangeAccent,
  'expected charcoal and orange-editorial kit accents to differ',
);
assert(
  canvasPublishedStyles.includes(charcoalAccent) && canvasPublishedStyles.includes(orangeAccent),
  'expected public stylesheet to reference both charcoal and orange-editorial accent values',
);

console.log('[review-smoke] OK');
