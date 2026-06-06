import { eq, sql } from 'drizzle-orm';
import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from './index';
import { applyCanvasAgentOp } from './agent/canvas-ops';
import { CANVAS_AGENT_TOOLS } from './agent/canvas-tools';
import {
  collectReferencedAssetIds,
  collectReferencedAssets,
  findAssetReferenceErrors,
} from './assets/site-assets';
import { resolveAuthRedirectUrl, resolveClerkKeys } from './auth/middleware';
import { SIDEBAR_DISPATCH } from './canvas/elements';
import { canvasPublishedStyles } from './canvas/public-styles';
import { createSectionFromRecipe } from './canvas/recipes';
import type { EditableSite, SectionRecipeId } from './canvas/schema';
import { SECTION_RECIPE_IDS } from './canvas/schema';
import { SEED_ASSET_REGISTRY } from './canvas/seed-assets';
import { STYLE_KIT_PRESETS } from './canvas/style-kits';
import {
  validateEditableSite,
  validatePublishedSnapshot,
  validateSeedFixture,
} from './canvas/validate';
import { db } from './db/client';
import { customer, ownerAsset, site } from './db/schema';
import { signEditToken } from './auth/edit-token';
import { buildLocalSignInUrl, buildSignInUrl } from './auth/require-auth';
import { resolveLocalSignInRedirect } from './auth/sign-in-route';
import {
  prepareSeedAssetsForCustomer,
  RESERVED_SUBDOMAINS,
  SUBDOMAIN_RE,
  validateSubdomain,
} from './routes/api/sites';
import { canReadScopedLibraryRow, escapeHtmlText } from './routes/api/library-access';
import { getAddon } from './addons/registry';
import {
  allTemplateSeeds,
  getTemplateSeed,
  instantiateTemplate,
  starterTemplate,
} from './templates/registry';

// ADR 0061 Phase D — materialise once, reuse the EditableSite shape
// throughout. Pre-Phase-D code that read `.state` on a TemplateSeed now
// reads from this `starterState` (and per-id materialisations below).
const starterState = instantiateTemplate(starterTemplate.id);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// The Worker env passed to app.request. The public router's DB lookup needs
// DATABASE_URL even for the 404 path (we want a real "no row" answer, not a
// crash from a missing env var). Pull from process.env so the smoke remains
// deterministic against the empty dev DB.
const SMOKE_UNLOCK_SIGNING_SECRET = process.env.UNLOCK_SIGNING_SECRET ?? 'smoke-test-secret';

// Test APP_DOMAIN (ADR 0013 decision 7) — smokes assert against the configured
// apex via env, never the canonical brand literal. A future apex rename does
// not require touching this file.
const SMOKE_APP_DOMAIN = 'opencanvas.aayushman.dev';
const SMOKE_APP_ORIGIN = `https://${SMOKE_APP_DOMAIN}`;
const SMOKE_CLERK_PUBLISHABLE_KEY = `pk_live_${btoa(`clerk.${SMOKE_APP_DOMAIN}$`)}`;
const SMOKE_CLERK_SECRET_KEY = 'sk_live_review_smoke';

const smokeEnv: Record<string, string> = {
  DATABASE_URL: process.env.DATABASE_URL ?? '',
  CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY ?? SMOKE_CLERK_PUBLISHABLE_KEY,
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? SMOKE_CLERK_SECRET_KEY,
  UNLOCK_SIGNING_SECRET: SMOKE_UNLOCK_SIGNING_SECRET,
  APP_DOMAIN: SMOKE_APP_DOMAIN,
  AUTHORIZED_PARTIES: `http://localhost:8787,http://127.0.0.1:8787,${SMOKE_APP_ORIGIN}`,
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: `noreply@${SMOKE_APP_DOMAIN}`,
  // Required at the render boundary now that Turnstile threads through ctx
  // (see ADR-touched batch 1 finding #3). Real production keys live in
  // wrangler secrets; smoke uses a stub the renderer treats as a valid key.
  TURNSTILE_SITE_KEY: 'turnstile-smoke-key',
};

const smokeExecutionCtx = {
  waitUntil(promise: Promise<unknown>): void {
    void promise.catch((err: unknown) => {
      console.error('[review-smoke] waitUntil task failed', err);
    });
  },
  passThroughOnException(): void {},
  props: {},
};

async function responseText(path: string): Promise<{ status: number; body: string }> {
  const response = await app.request(
    `http://opencanvas.test${path}`,
    undefined,
    smokeEnv,
    smokeExecutionCtx,
  );
  return { status: response.status, body: await response.text() };
}

async function responseFromHost(
  host: string,
  path: string,
): Promise<{ status: number; body: string }> {
  const response = await app.request(
    `http://${host}${path}`,
    undefined,
    smokeEnv,
    smokeExecutionCtx,
  );
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
  root.body.includes('site builder for the rest of us'),
  'expected public / to render the Open Canvas landing eyebrow',
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

const emptyPagesState = validateEditableSite({ styleKit: 'charcoal', pages: [] });
assert(!emptyPagesState.valid, 'expected canvas site state with no pages to be invalid');

const editableEmptyMediaState: EditableSite = {
  styleKit: 'charcoal',
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
const editableEmptyMedia = validateEditableSite(editableEmptyMediaState);
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

// Multipage invariant: a two-page state is valid when page ids/slugs are unique.
const secondStarterPage = structuredClone(starterState.pages[0]);
if (!secondStarterPage) throw new Error('starterTemplate must have at least one page');
secondStarterPage.id = 'page-review-second';
secondStarterPage.slug = 'review-second';
secondStarterPage.title = 'Review Second';
const twoPageStarter = {
  ...starterState,
  pages: [structuredClone(starterState.pages[0]), secondStarterPage],
};
const twoPageResult = validateEditableSite(twoPageStarter);
assert(
  twoPageResult.valid,
  twoPageResult.valid
    ? ''
    : 'expected validator to accept a two-page state: ' + twoPageResult.errors.join('; '),
);
const duplicatePageStarter = structuredClone(twoPageStarter);
duplicatePageStarter.pages[1]!.id = duplicatePageStarter.pages[0]!.id;
duplicatePageStarter.pages[1]!.slug = duplicatePageStarter.pages[0]!.slug;
const duplicatePageResult = validateEditableSite(duplicatePageStarter);
assert(
  !duplicatePageResult.valid &&
    duplicatePageResult.errors.some((message) => message.includes('duplicated across pages')),
  'expected duplicate-page rejection to mention cross-page duplication',
);

const overWidePage = validateEditableSite({
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

const unmutedAutoplayVideo = validateEditableSite({
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
// Build a minimum EditableSite around each broken text element so the
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

const emptyContent = validateEditableSite(richTextStateWith([]));
assert(
  !emptyContent.valid,
  'expected text element with content: [] to be rejected (non-empty array required)',
);
assert(
  !emptyContent.valid && emptyContent.errors.some((message) => message.includes('non-empty array')),
  'expected empty-content rejection to mention "non-empty array"',
);

const unknownMarkType = validateEditableSite(
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

const javascriptLink = validateEditableSite(
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
  const seedState = instantiateTemplate(seed.id);
  const seedStateResult = validateEditableSite(seedState);
  assert(
    seedStateResult.valid,
    seedStateResult.valid
      ? ''
      : `expected template ${seed.id} to pass canvas validation: ${seedStateResult.errors.join('; ')}`,
  );
  const seedAssetResult = validateSeedFixture(seedState);
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
  templatesPageSource.includes('sandbox="allow-scripts"'),
  'expected template preview iframes to allow scripts while staying cross-origin sandboxed',
);
assert(
  !templatesPageSource.includes('sandbox="allow-same-origin"'),
  'expected template picker previews not to grant same-origin sandbox capability',
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
const wantsJsonSource = sitesApiSource.match(/function wantsJson[\s\S]*?\n}/)?.[0] ?? '';
assert(
  wantsJsonSource.includes('content-type') && wantsJsonSource.includes('application/json'),
  'expected site creation API to return JSON for JSON request bodies even without an Accept header',
);
const customTemplatesSource = await readSource('./routes/api/custom-templates.ts');
assert(
  !customTemplatesSource.includes('opencanvas-preview-stage'),
  'expected custom template previews to rely on the outer thumbnail iframe scaling',
);
assert(
  !customTemplatesSource.includes('transform: scale(0.22)'),
  'expected custom template previews not to apply their own inner scale transform',
);
const siteLimitMigration = await readSource('../drizzle/0005_site_limit_guard.sql');
assert(
  siteLimitMigration.includes('rev01_enforce_free_site_limit') &&
    siteLimitMigration.includes('pg_advisory_xact_lock') &&
    siteLimitMigration.includes('CREATE TRIGGER'),
  'expected a database trigger migration to enforce the free site limit under concurrent inserts',
);
const planAwareSiteLimitMigration = await readSource('../drizzle/0008_plan_aware_site_limit.sql');
assert(
  planAwareSiteLimitMigration.includes("WHEN 'free' THEN 3") &&
    planAwareSiteLimitMigration.includes("WHEN 'pro' THEN NULL") &&
    planAwareSiteLimitMigration.includes("WHEN 'team' THEN NULL"),
  'expected plan-aware site limit trigger to cap free sites and leave paid plans uncapped',
);
const importApiLimitSource = await readSource('./routes/api/import.ts');
for (const [name, source] of [
  ['sites API', sitesApiSource],
  ['import API', importApiLimitSource],
] as const) {
  assert(
    source.includes('plan: customer.plan') &&
      source.includes('const customerPlan = customerRecord.plan') &&
      source.includes('siteLimitForPlan(customerPlan)') &&
      source.includes('isSiteLimitViolation(err)'),
    `expected ${name} site-limit enforcement to honor customer.plan and route trigger errors through the shared detector`,
  );
}
assert(
  sitesApiSource.includes("e.message.includes('site limit exceeded')"),
  'expected site-limit trigger detector to recognize the new plan-aware trigger message',
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
    dashboardSource.includes('function buildCards') &&
    dashboardSource.includes('): SiteCard[]') &&
    dashboardSource.includes(
      'const cards = buildCards(rows, origin, requireTurnstileSiteKey(c.env));',
    ),
  'expected dashboard to model all owned sites as SiteCard[] rows, not only one editor link',
);
assert(
  dashboardSource.includes('cards.map'),
  'expected dashboard to render every owned site card in a list/grid',
);
assert(
  dashboardSource.includes('ownedByCurrent: boolean') &&
    dashboardSource.includes('ownedByCurrent: row.ownedByCurrent') &&
    dashboardSource.includes('{s.ownedByCurrent ? ('),
  'expected dashboard site cards to carry ownership and hide owner-only publish controls from collaborator cards',
);
assert(
  dashboardSource.includes('const ownedSiteCount = ownedRows.length') &&
    dashboardSource.includes('<div class="stat-label">Owned sites</div>') &&
    dashboardSource.includes('<div class="stat-value">{String(ownedSiteCount)}</div>'),
  'expected dashboard quota meter to count owned sites, not collaborator-accessible cards',
);
assert(
  !dashboardSource.includes('const latestSite'),
  'expected dashboard not to query only the latest site',
);
assert(
  !dashboardSource.includes('let editorLink'),
  'expected dashboard not to collapse owned sites into a single editorLink',
);
const billingSettingsSource = await readSource('./routes/dashboard/settings.tsx');
for (const [name, source] of [
  ['templates page', templatesPageSource],
  ['dashboard', dashboardSource],
  ['billing settings', billingSettingsSource],
] as const) {
  assert(
    source.includes('const customerPlan = customerRecord.plan') &&
      source.includes('siteLimitForPlan(customerPlan)'),
    `expected ${name} site-limit UI to honor customer.plan instead of hardcoding the Free cap`,
  );
}
assert(
  dashboardSource.includes('const atSiteLimit = siteLimit !== null') &&
    !templatesPageSource.includes("You've reached your Free plan limit (3 sites)") &&
    billingSettingsSource.includes('ADR 0042 (2026-06-04 amendment)') &&
    billingSettingsSource.includes('data-tab="tab-plan"') &&
    billingSettingsSource.includes('<PlanTiles currentPlan={customerPlan} />') &&
    billingSettingsSource.includes('const siteLimitLabel = siteLimit === null') &&
    billingSettingsSource.includes('String(siteCount)') &&
    billingSettingsSource.includes('siteLimitLabel') &&
    dashboardSource.includes('id="plan-upgrade-btn"') &&
    dashboardSource.includes('plan-modal-overlay') &&
    dashboardSource.includes('plan switch modal helper unavailable') &&
    billingSettingsSource.includes('plan switch modal helper unavailable') &&
    !dashboardSource.includes("alert(err.message || 'Could not switch plan.'") &&
    !billingSettingsSource.includes("alert(err.message || 'Could not switch plan.'"),
  'expected paid-plan dashboard UI to honor plan limits and to expose the ADR 0042 mock-billing plan picker on dashboard + settings',
);

const publicRouteSource = await readSource('./routes/public.ts');
const publishRouteSource = await readSource('./routes/api/publish.ts');
const indexSource = await readSource('./index.ts');
const ownerApiSource = await readSource('./routes/api/owner-app.ts');
const socketRouteSource = await readSource('./live/socket-route.ts');
const siteRoomSource = await readSource('./live/site-room.ts');
const unlockRouteSource = await readSource('./password/unlock-route.ts');
const renderSource = await readSource('./canvas/render.ts');
assert(
  publicRouteSource.includes('snapshotForPageSlug(renderSnapshot, pageSlug)') &&
    /renderCanvasSnapshot\(\s*renderSnapshot,\s*'\/assets',\s*siteRow\.id[\s\S]*renderPages:\s*\[currentPage\]/.test(
      publicRouteSource,
    ),
  'expected public render to select one page while keeping whole-snapshot link context',
);
assert(
  publishRouteSource.includes('buildPublishBroadcastPayload') &&
    publishRouteSource.includes('htmlBySlug') &&
    /renderCanvasSnapshot\(\s*snapshot,\s*'\/assets',\s*siteId,\s*\{\s*renderPages:\s*\[targetPage\],\s*turnstileSiteKey,?\s*\}/.test(
      publishRouteSource,
    ),
  'expected publish broadcast render to emit page-scoped html and pass site id + turnstile key through so live-updated forms keep a valid action and bot protection',
);
assert(
  publishRouteSource.includes('published side effects failed; restored previous published state') &&
    publishRouteSource.includes('[publish]'),
  'expected publish broadcast failure to restore previous published state after logging instead of returning ok',
);
assert(
  publicRouteSource.includes('prepareRender(path, snapshot)') &&
    publicRouteSource.includes('renderSnapshot') &&
    publicRouteSource.includes('dir="${raw(escapeAttr(dir))}"'),
  'expected public route to use the i18n render hook for locale routing, RTL mirroring, and html dir',
);
assert(
  !publicRouteSource.includes('const pageSlug =\n    path ===') &&
    !publicRouteSource.includes("path.replace(/^\\//, '').split('/')[0]"),
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
  // The public route distinguishes editor and visitor socket roles when
  // handling the /__live upgrade; the canonical shape is a typed local
  // `socketRole: 'editor' | 'visitor'` (see src/routes/public.ts ~L959
  // after the H3 password-gate fix in 12ed4dc).
  publicRouteSource.includes("let socketRole: 'editor' | 'visitor' = 'visitor'") &&
    publicRouteSource.includes('role=${socketRole}') &&
    publicRouteSource.includes('verifyEditToken') &&
    indexSource.includes("app.route('/__live', socketRoute)") &&
    socketRouteSource.includes('verifyEditToken') &&
    socketRouteSource.includes('role=editor'),
  'expected /__live to separate unauthenticated visitor sockets from authenticated editor sockets',
);
assert(
  siteRoomSource.includes('socketRoles') &&
    siteRoomSource.includes('isEditorSocket') &&
    siteRoomSource.includes('rejected visitor websocket message'),
  'expected SiteRoom to reject visitor-originated Yjs writes and fan out Yjs payloads only to editors',
);
assert(
  indexSource.includes("app.route('/api', ownerApi)") &&
    indexSource.includes("app.route('/__api', ownerApi)") &&
    ownerApiSource.includes("import notificationsApi from './notifications'") &&
    ownerApiSource.includes("ownerApi.route('/', notificationsApi)"),
  'expected notifications API to be mounted through ownerApi so both /api and /__api inbox clients work',
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
const enterprisePage = instantiateTemplate(enterpriseTemplate.id).pages[0];
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
  'expected dashboard to use the shared Clerk key resolver (clerk-script injection)',
);
// Sign-out is now handled by the worker-local /sign-out endpoint
// (src/auth/sign-out-route.ts) — dashboard pages link to it directly
// instead of constructing a (non-existent) Account Portal /sign-out URL.
assert(
  dashboardSource.includes('href="/sign-out"'),
  'expected dashboard Sign out anchor to point at the worker-local /sign-out route',
);

const livePublishableKey = `pk_live_${btoa(`clerk.${SMOKE_APP_DOMAIN}$`)}`;
const testPublishableKey = `pk_test_${btoa('local-dev.clerk.accounts.dev$')}`;
const hostEnvForRedirects = {
  APP_DOMAIN: SMOKE_APP_DOMAIN,
  AUTHORIZED_PARTIES: SMOKE_APP_ORIGIN,
  COOKIE_NAME_PREFIX: '__opencanvas_',
  EMAIL_FROM: `noreply@${SMOKE_APP_DOMAIN}`,
};
const devClerkEnv = {
  ...hostEnvForRedirects,
  CLERK_PUBLISHABLE_KEY: livePublishableKey,
  CLERK_SECRET_KEY: 'sk_live_review_smoke',
  CLERK_TEST_PUBLISHABLE_KEY: testPublishableKey,
  CLERK_TEST_SECRET_KEY: 'sk_test_review_smoke',
  DEV_PUBLIC_HOST: 'http://localhost:8787',
};
const liveClerkEnv = {
  ...hostEnvForRedirects,
  CLERK_PUBLISHABLE_KEY: livePublishableKey,
  CLERK_SECRET_KEY: 'sk_live_review_smoke',
};
const devSignInRedirect = resolveAuthRedirectUrl(
  devClerkEnv,
  `${SMOKE_APP_ORIGIN}/dashboard?next=sites`,
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
const devLocalSignInUrl = new URL(buildLocalSignInUrl(devClerkEnv, devSignInRedirect));
assert(
  devLocalSignInUrl.origin === 'http://localhost:8787',
  `expected dev local sign-in surface to stay on DEV_PUBLIC_HOST, got ${devLocalSignInUrl.origin}`,
);
assert(
  devLocalSignInUrl.searchParams.get('redirect_url') === devSignInRedirect,
  'expected dev local sign-in redirect_url query param to match the resolved local URL',
);
const resolvedDirectAuthRedirect = resolveLocalSignInRedirect(
  devClerkEnv,
  `${SMOKE_APP_ORIGIN}/auth?redirect_url=${encodeURIComponent(devSignInRedirect)}`,
);
assert(
  resolvedDirectAuthRedirect === devSignInRedirect,
  `expected direct /auth redirect_url to resolve to the dev-safe redirect, got ${resolvedDirectAuthRedirect}`,
);
const resolvedRelativeAuthRedirect = resolveLocalSignInRedirect(
  devClerkEnv,
  `${SMOKE_APP_ORIGIN}/auth?redirect_url=${encodeURIComponent('/dashboard/sites')}`,
);
assert(
  resolvedRelativeAuthRedirect === 'http://localhost:8787/dashboard/sites',
  `expected root-relative /auth redirect_url to resolve through DEV_PUBLIC_HOST, got ${resolvedRelativeAuthRedirect}`,
);
try {
  resolveLocalSignInRedirect(
    liveClerkEnv,
    `${SMOKE_APP_ORIGIN}/auth?redirect_url=${encodeURIComponent('https://evil.example/dashboard')}`,
  );
  throw new Error('expected cross-origin /auth redirect_url to be rejected');
} catch (error) {
  assert(
    error instanceof Error && error.message.includes('redirect_url origin must match'),
    `expected cross-origin /auth redirect_url failure, got ${String(error)}`,
  );
}
// Sign-out is no longer a Clerk Account Portal URL — see
// src/auth/sign-out-route.ts. The `overridePath='/'` form of
// resolveAuthRedirectUrl is still validated below since other callers
// (e.g. landing page handoff back to /) rely on it.
const devRootRedirect = resolveAuthRedirectUrl(devClerkEnv, `${SMOKE_APP_ORIGIN}/dashboard`, '/');
assert(
  devRootRedirect === 'http://localhost:8787/',
  `expected dev root redirect to stay local, got ${devRootRedirect}`,
);
const liveRedirect = resolveAuthRedirectUrl(
  liveClerkEnv,
  `${SMOKE_APP_ORIGIN}/dashboard?next=sites`,
);
const liveLocalSignInUrl = new URL(buildLocalSignInUrl(liveClerkEnv, liveRedirect));
assert(
  liveLocalSignInUrl.origin === SMOKE_APP_ORIGIN,
  `expected live local sign-in surface to stay on the app origin, got ${liveLocalSignInUrl.origin}`,
);
assert(
  liveRedirect === `${SMOKE_APP_ORIGIN}/dashboard?next=sites`,
  `expected live sign-in redirect_url to keep the request URL, got ${liveRedirect}`,
);
const liveRootRedirect = resolveAuthRedirectUrl(liveClerkEnv, `${SMOKE_APP_ORIGIN}/dashboard`, '/');
assert(
  liveRootRedirect === `${SMOKE_APP_ORIGIN}/`,
  `expected live root redirect to use the live origin, got ${liveRootRedirect}`,
);
try {
  resolveAuthRedirectUrl(devClerkEnv, `${SMOKE_APP_ORIGIN}/dashboard`, 'https://example.invalid/');
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

const canvasIndexSource = await readSource('./editor/route.tsx');
const signInRouteSource = await readSource('./auth/sign-in-route.tsx');
const canvasApiSource = await readSource('./routes/api/canvas.ts');
const publishApiSource = await readSource('./routes/api/publish.ts');
const importApiSource = await readSource('./routes/api/import.ts');
const addonsApiSource = await readSource('./routes/api/addons.ts');
const addonsRegistrySource = await readSource('./addons/registry.ts');
const siteSettingsSource = await readSource('./routes/dashboard/site-settings.tsx');
const pageSettingsSource = await readSource('./routes/dashboard/page-settings.tsx');
const yjsProjectionSource = await readSource('./canvas/yjs-projection.ts');
const coEditAutosaveSource = await readSource('./live/co-edit/autosave.ts');
const activeContractDocs = [
  ['FEATURES.md', await readSource('../FEATURES.md')],
  ['docs/demo/act-1-script.md', await readSource('../docs/demo/act-1-script.md')],
  ['docs/demo/feature-coverage.md', await readSource('../docs/demo/feature-coverage.md')],
  [
    'docs/demo/diagrams/live-draw-reference.md',
    await readSource('../docs/demo/diagrams/live-draw-reference.md'),
  ],
  [
    'docs/demo/diagrams/excalidraw/SPECS.md',
    await readSource('../docs/demo/diagrams/excalidraw/SPECS.md'),
  ],
] as const;
const legacyBrandToken = 'rev' + '01';
const legacySignatureHeader = ['X', 'Rev' + '01', 'Signature'].join('-');
const legacyVisitorPrefix = '/__' + legacyBrandToken;
const legacyFormHandlerGlobal = '__' + legacyBrandToken + 'FormHandlerWired';
assert(
  !/<button\s+id="canvas-publish"[^>]*\sdisabled\b/.test(canvasIndexSource),
  'expected Publish button to be enabled in the canvas editor shell',
);
// Canvas-client source-level grep was retired by ADR 0015 Phase 3 — the
// inline IIFE is gone; ./editor-client/* module smokes (inspector-actions,
// page-crud, create-editor, snapshot-replay, yjs-projection, etc.) carry
// the behavioural assertions that used to live as string-greps here.
for (const [docPath, docSource] of activeContractDocs) {
  assert(
    !docSource.includes(legacySignatureHeader) &&
      !docSource.includes(legacyVisitorPrefix) &&
      !docSource.includes(legacyFormHandlerGlobal),
    `expected ${docPath} to use the current Open Canvas public contract strings`,
  );
}
assert(
  signInRouteSource.includes('resolveLocalSignInRedirect') &&
    !signInRouteSource.includes('new URLSearchParams(window.location.search).get("redirect_url")'),
  'expected /auth to resolve redirect_url server-side instead of trusting browser query params',
);
assert(
  signInRouteSource.includes('[auth] Clerk widget unmount failed') &&
    !signInRouteSource.includes('catch(_){ }'),
  'expected Clerk widget unmount failures to log context and rethrow, not disappear',
);
assert(
  canvasIndexSource.includes('editorPageJsx requires clerkFrontendApiHost') &&
    !canvasIndexSource.includes('clerkPublishableKey && clerkHost && raw'),
  'expected editorPageJsx to throw when Clerk publishable key is present without a resolved frontend host',
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
  publishApiSource.includes('restorePreviousPublishState') &&
    publishApiSource.includes('publishedSnapshot: site.publishedSnapshot') &&
    publishApiSource.includes('published side effects failed; restored previous published state'),
  'expected publish to restore the prior snapshot/version if post-DB side effects fail',
);
assert(
  !publishApiSource.includes('executionCtx.waitUntil'),
  'expected publish to await contract side effects before returning ok, not defer them behind waitUntil',
);
assert(
  !/const\s+fullPagesSnapshot\s*=\s*\{\s*\.\.\.snapshot/.test(publishApiSource),
  'expected published page rendering to keep the original snapshot identity for responsive CSS memoization',
);
assert(
  yjsProjectionSource.includes('[canvas:yjs-projection] autosave persist failed') &&
    coEditAutosaveSource.includes('outer `attachAutosave` logs') &&
    coEditAutosaveSource.includes('projected-state context') &&
    !coEditAutosaveSource.includes('noop catch only'),
  'expected autosave failure docs/source to log context and avoid stale noop-catch claims',
);
const importValidationIndex = importApiSource.indexOf(
  'const validation = validateEditableSite(editableState)',
);
const importR2UploadIndex = importApiSource.indexOf('preparedAssets.r2Uploads.map');
assert(
  importValidationIndex !== -1 &&
    importR2UploadIndex !== -1 &&
    importValidationIndex < importR2UploadIndex,
  'expected import to build and validate editable state before writing imported assets to R2',
);
const legacyUploadBridgeSource = canvasApiSource.slice(
  canvasApiSource.indexOf("canvasApi.post('/sites/:siteId/assets'"),
  canvasApiSource.indexOf('interface GenerateAssetInput'),
);
assert(
  !/uploadOwnerAsset[\s\S]*siteId:\s*result\.site\.id[\s\S]*\);/.test(legacyUploadBridgeSource),
  'expected legacy JSON asset bridge not to pass siteId without elementId to uploadOwnerAsset',
);
assert(
  !siteSettingsSource.includes("fd.append('siteId', SITE_ID);") &&
    !pageSettingsSource.includes("fd.append('siteId', SITE_ID);"),
  'expected favicon and SEO picker uploads not to send partial slot-history metadata',
);
assert(
  siteSettingsSource.includes('let configPatchChain = Promise.resolve();') &&
    siteSettingsSource.includes('function queueConfigPatch') &&
    siteSettingsSource.includes('queueConfigPatch({ faviconAssetId: assetIdOrNull }') &&
    /queueConfigPatch\(\s*\{\s*\[key\]: apiValue\s*\}/.test(siteSettingsSource),
  'expected all site config PATCH writes on settings page to use the serialized queue',
);
assert(
  canvasApiSource.includes('assetIsImageForCustomer') &&
    canvasApiSource.includes('kind: ownerAsset.kind') &&
    canvasApiSource.includes("row?.kind === 'image'"),
  'expected favicon and OG image saves to require an owned image asset, not just any owned asset',
);
assert(
  canvasIndexSource.includes('const settingsHref =') &&
    canvasIndexSource.includes('appOrigin(') &&
    canvasIndexSource.includes('/dashboard/sites/'),
  'expected on-site editor Settings link to point at the env-driven app dashboard origin (ADR 0013)',
);
assert(
  !/const value = body\.config\[field\.key\];\s*if \(value === undefined\) continue;/.test(
    addonsApiSource,
  ),
  'expected enabled addon config validation to reject missing required pattern fields',
);
assert(
  !addonsRegistrySource.includes("if (!mid) return '';") &&
    !addonsRegistrySource.includes("if (!/^G-[A-Z0-9]+$/.test(mid)) return '';"),
  'expected Google Analytics emitter to fail loudly instead of silently omitting invalid config',
);
const googleAnalyticsAddon = getAddon('addon_google_analytics');
assert(googleAnalyticsAddon !== undefined, 'expected Google Analytics addon definition to exist');
const gaHeadScripts = googleAnalyticsAddon.emitHeadScripts({ measurementId: 'G-ABC123' });
assert(
  gaHeadScripts.includes("gtag('config','G-ABC123');"),
  'expected valid Google Analytics measurement ID to emit gtag config',
);
for (const invalidConfig of [{}, { measurementId: '' }, { measurementId: 'UA-123456-1' }]) {
  let threw = false;
  try {
    googleAnalyticsAddon.emitHeadScripts(invalidConfig);
  } catch {
    threw = true;
  }
  assert(threw, 'expected Google Analytics emitter to throw for missing or invalid measurementId');
}
assert(
  canvasIndexSource.includes('id="canvas-sidebar"'),
  'expected canvas editor shell to include the left add/style sidebar',
);
assert(
  canvasIndexSource.includes('data-sidebar-add-section="blank"'),
  'expected canvas sidebar to expose a blank-section add button',
);
// The sidebar grid is generated from SIDEBAR_DISPATCH per ADR 0011 Step 3
// rather than 14 hardcoded buttons; check that the dispatch contains the
// expected core component keys + the route renders them dynamically.
assert(
  canvasIndexSource.includes('data-sidebar-add-component={cmd.key}'),
  'expected canvas sidebar to render component buttons from SIDEBAR_DISPATCH (ADR 0011 Step 3)',
);
{
  const dispatchKeys = new Set<string>();
  for (const spec of Object.values(SIDEBAR_DISPATCH)) {
    for (const cmd of spec.commands) dispatchKeys.add(cmd.key);
  }
  for (const component of ['text', 'image', 'video', 'action', 'shape', 'container']) {
    assert(
      dispatchKeys.has(component),
      `expected SIDEBAR_DISPATCH to declare ${component} sidebar command`,
    );
  }
}
assert(
  canvasIndexSource.includes('data-sidebar-style-kit={kit}'),
  'expected style-kit controls to live in the sidebar',
);
// Text-colour picker moved out of the sidebar and into the floating RTE mark
// toolbar in be7d083 (and the colour-wheel UI landed in 93a14c0). The old
// `#canvas-sidebar-selection` region is gone by design — the mark-toolbar
// path is covered separately via opencanvas-mark-color assertions.
assert(
  !canvasIndexSource.includes('<span class="style-kits"'),
  'expected style-kit controls to move out of the editor header',
);
// Canvas-client source-level greps + the inline IIFE parse round-trip used
// to live here. ADR 0015 Phase 3 retired them — the inline IIFE is gone;
// the editor ships as a built bundle through scripts/build-editor-client.ts
// and structural invariants are now covered by the per-module smokes under
// src/editor-client/ (inspector-actions, page-crud, create-editor,
// snapshot-replay, yjs-projection, etc.).

// -- File-input discipline -----------------------------------------------
//
// A `<input type="file">` created via document.createElement must be in
// the DOM before .click() is called on it. Chromium silently no-ops the
// click on a detached file input as a user-gesture security measure, so
// the picker never opens and the upload button looks dead with no error.
// This is exactly the bug shape that broke the Bg image Upload (see
// commit 8ee3068). Every file input must either be appended to the DOM
// before .click(), or never .click()ed (used purely as a side channel).
function scanFileInputDiscipline(source: string, label: string): string[] {
  const violations: string[] = [];
  const lines = source.split('\n');
  const declRe =
    /^\s*(?:var|let|const)\s+(\w+)\s*=\s*document\.createElement\(\s*["']input["']\s*\)/;
  const decls: Array<{ name: string; line: number }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = declRe.exec(lines[i] ?? '');
    const name = m?.[1];
    if (name !== undefined) decls.push({ name, line: i });
  }
  for (const [d, decl] of decls.entries()) {
    const { name, line: declLine } = decl;
    // Scope the analysis to the window from this declaration up to the
    // next declaration with the same identifier (otherwise we'd conflate
    // unrelated reuses of common names like `fileInput`).
    let scopeEnd = lines.length;
    for (let f = d + 1; f < decls.length; f++) {
      const nextDecl = decls[f];
      if (nextDecl && nextDecl.name === name) {
        scopeEnd = nextDecl.line;
        break;
      }
    }
    const typeRe = new RegExp(`\\b${name}\\.type\\s*=\\s*["']file["']`);
    let isFileInput = false;
    for (let i = declLine; i < Math.min(scopeEnd, declLine + 15); i++) {
      if (typeRe.test(lines[i] ?? '')) {
        isFileInput = true;
        break;
      }
    }
    if (!isFileInput) continue;
    // Source-line ORDER doesn't matter at runtime: appendChild can appear
    // textually after .click() because the click is usually inside an event
    // handler closure that fires later. The bug shape is .click() existing
    // anywhere on the variable WITHOUT any appendChild on it anywhere in
    // the same lexical scope.
    const clickRe = new RegExp(`\\b${name}\\.click\\(\\s*\\)`);
    const appendRe = new RegExp(`\\.appendChild\\(\\s*${name}\\s*\\)`);
    let clickLine = -1;
    let hasAppend = false;
    for (let i = declLine; i < scopeEnd; i++) {
      const lineText = lines[i] ?? '';
      if (clickLine < 0 && clickRe.test(lineText)) clickLine = i;
      if (!hasAppend && appendRe.test(lineText)) hasAppend = true;
      if (clickLine >= 0 && hasAppend) break;
    }
    if (clickLine >= 0 && !hasAppend) {
      violations.push(
        `${label}:${declLine + 1}: file input "${name}" .click() at line ${clickLine + 1} but never appendChild(${name}) — Chromium will silently no-op the click and the picker won't open`,
      );
    }
  }
  return violations;
}

// Self-test: feed a synthetic bad pattern (the exact shape of the bg-image
// bug) through the scanner and assert it fires. This stops the lint itself
// from regressing into a no-op.
const fileInputLintSelfTest = scanFileInputDiscipline(
  [
    'function buildInspector() {',
    '  bgImgUpload.addEventListener("click", function() {',
    '    var inp = document.createElement("input");',
    '    inp.type = "file";',
    '    inp.click();',
    '  });',
    '}',
  ].join('\n'),
  'self-test',
);
assert(
  fileInputLintSelfTest.length === 1 && (fileInputLintSelfTest[0] ?? '').includes('"inp"'),
  `file-input-discipline lint self-test failed: expected 1 violation for "inp", got ${JSON.stringify(fileInputLintSelfTest)}`,
);

// ADR 0015 Phase 3 — file-input discipline walks the editor-client module
// tree now that the inline IIFE is retired. Every TS source (excluding
// .smoke.ts harnesses + the build-time-only styles-build.ts) gets scanned;
// any file-input violation surfaces with its module name in the message
// so the offender is grep-able.
const editorClientDirPath = join(import.meta.dirname, 'editor-client');
const editorClientFiles = await readdir(editorClientDirPath);
const fileInputErrors: string[] = [];
for (const file of editorClientFiles) {
  if (!file.endsWith('.ts')) continue;
  if (file.endsWith('.smoke.ts')) continue;
  if (file === 'styles-build.ts') continue;
  const src = await readSource(`./editor-client/${file}`);
  fileInputErrors.push(...scanFileInputDiscipline(src, `editor-client/${file}`));
}
assert(
  fileInputErrors.length === 0,
  `file-input discipline violations:\n  ` + fileInputErrors.join('\n  '),
);

const tsconfigSource = await readSource('../tsconfig.json');
const tsconfig = JSON.parse(tsconfigSource) as { exclude?: string[] };
// `src/*` excludes are only allowed when the excluded subtree is actively
// typechecked under its own tsconfig (per ADR-0015 Phase 2.5, src/editor-client
// runs `tsc -p src/editor-client` separately so it can use a DOM-aware lib).
// Excludes without a sibling tsconfig still mean "retired code hidden from
// typecheck" and would fail the assertion.
const srcExcludes = (tsconfig.exclude ?? []).filter((entry) => entry.startsWith('src/'));
for (const entry of srcExcludes) {
  let subTsconfigExists = true;
  try {
    await access(join(process.cwd(), entry, 'tsconfig.json'));
  } catch {
    subTsconfigExists = false;
  }
  assert(
    subTsconfigExists,
    `tsconfig excludes ${entry} but has no sibling tsconfig — retired code should be removed, not hidden from typecheck`,
  );
}
const eslintConfigSource = await readSource('../eslint.config.js');
assert(
  !eslintConfigSource.includes("'src/multiplayer/**'") &&
    !eslintConfigSource.includes("'src/editor/client.ts'") &&
    !eslintConfigSource.includes("'src/agent/ops.ts'") &&
    !eslintConfigSource.includes("'src/routes/api/pages.ts'"),
  'expected eslint config not to hide retired src code from lint',
);

// -- Task 5: public host router -------------------------------------------
// An unknown subdomain under the configured apex should be handled by the
// public router (not the app's landing/health/etc.) and return 404 because
// no site row matches.
const unknownSubdomain = await responseFromHost(`unknown-subdomain.${SMOKE_APP_DOMAIN}`, '/');
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

// The app host (configured apex) must still serve the landing page —
// the public router has to return null on this host, not intercept it.
const appHostLanding = await responseFromHost(SMOKE_APP_DOMAIN, '/');
assert(
  appHostLanding.status === 200,
  `expected ${SMOKE_APP_DOMAIN} / to still serve the landing page, got ${appHostLanding.status}`,
);
assert(
  appHostLanding.body.includes('site builder for the rest of us'),
  `expected ${SMOKE_APP_DOMAIN} / to render the Open Canvas landing copy`,
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
const SMOKE_HOST = `${SMOKE_SUB}.${SMOKE_APP_DOMAIN}`;

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
    styleKit: starterState.styleKit,
    editableState: starterState,
    publishedSnapshot: null,
    publishedVersion: 0,
  });

  // 1. Unpublished site → 404 with "not yet published".
  const unpubResp = await responseFromHost(SMOKE_HOST, '/');
  assert(unpubResp.status === 404, `expected unpublished site to 404, got ${unpubResp.status}`);
  assert(
    /not yet published|coming soon|not found|been published/i.test(unpubResp.body),
    `expected unpublished body to mention "not yet published", "coming soon", "been published", or "not found" (got ${JSON.stringify(unpubResp.body)})`,
  );

  // 2. Insert a Published Snapshot directly. The publish endpoint requires
  // Clerk auth, so the smoke writes the same shape the endpoint would.
  const publishedSnapshot = {
    version: 1,
    publishedAt: new Date().toISOString(),
    styleKit: starterState.styleKit,
    pages: starterState.pages,
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
    pubResp.body.includes('data-opencanvas-public-root'),
    'expected published body to contain data-opencanvas-public-root',
  );
  assert(
    pubResp.body.includes('data-opencanvas-page="page-home"'),
    'expected published body to contain data-opencanvas-page="page-home"',
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
  const appLive = await responseFromHost(SMOKE_APP_DOMAIN, '/__live');
  assert(
    appLive.status !== 426,
    `expected app host /__live not to be a 426 (public router should ignore the app host), got ${appLive.status}`,
  );

  // 6. /__live with upgrade header but missing wsToken → 401.
  const liveNoToken = await app.request(
    `http://opencanvas.test/__live?siteId=fake-site-id`,
    { headers: new Headers({ upgrade: 'websocket' }) },
    smokeEnv,
    smokeExecutionCtx,
  );
  assert(
    liveNoToken.status === 401,
    `expected /__live without wsToken to 401, got ${liveNoToken.status}`,
  );

  // 7. /__live with invalid wsToken → 401.
  const liveInvalidToken = await app.request(
    `http://opencanvas.test/__live?siteId=fake-site-id&wsToken=not-a-real-token`,
    { headers: new Headers({ upgrade: 'websocket' }) },
    smokeEnv,
    smokeExecutionCtx,
  );
  assert(
    liveInvalidToken.status === 401,
    `expected /__live with invalid wsToken to 401, got ${liveInvalidToken.status}`,
  );

  // 8. /__live with validly-signed token whose siteId doesn't match URL → 401.
  const wrongSiteToken = await signEditToken(
    { siteId: 'wrong-site-id', customerId: seededCustomerId, clerkUserId: SMOKE_CLERK_USER },
    SMOKE_UNLOCK_SIGNING_SECRET,
  );
  const liveWrongSite = await app.request(
    `http://opencanvas.test/__live?siteId=fake-site-id&wsToken=${encodeURIComponent(wrongSiteToken)}`,
    { headers: new Headers({ upgrade: 'websocket' }) },
    smokeEnv,
    smokeExecutionCtx,
  );
  assert(
    liveWrongSite.status === 401,
    `expected /__live with wrong-siteId token to 401, got ${liveWrongSite.status}`,
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
const seedOk = validateSeedFixture(starterState);
assert(
  seedOk.valid,
  seedOk.valid
    ? ''
    : `expected validateSeedFixture(starterState) to pass: ${seedOk.errors.join('; ')}`,
);

// Negative case: a fixture whose media references an unregistered assetId is
// rejected, with the rejection message mentioning the offending id.
const T6_BOGUS_ID = 't6-bogus-asset-id';
const bogusFixture: EditableSite = structuredClone(starterState);
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

const kindMismatchFixture: EditableSite = structuredClone(starterState);
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

const posterReferenceState: EditableSite = structuredClone(starterState);
const posterReferencePage = posterReferenceState.pages[0];
if (!posterReferencePage) throw new Error('starterTemplate must have at least one page');
const posterReferenceSection = posterReferencePage.sections.find((s) => s.id === 'section-hero');
if (!posterReferenceSection) throw new Error('starterTemplate must have a hero section');
const posterReferenceMedia = posterReferenceSection.elements.find((el) => el.id === 'hero-media');
if (!posterReferenceMedia || posterReferenceMedia.type !== 'media') {
  throw new Error('starterTemplate hero must contain media element hero-media');
}
// Reshape the element from image to video. The discriminated MediaElement DU
// rejects mutating mediaKind in place because `posterAssetId` doesn't exist
// on the image arm — rebuild the object as a video variant.
Object.assign(posterReferenceMedia, {
  mediaKind: 'video',
  assetId: 'video-asset-id',
  posterAssetId: 'poster-asset-id',
});
const referencedAssets = collectReferencedAssets(posterReferenceState);
assert(
  referencedAssets.some(
    (ref) =>
      ref.assetId === 'poster-asset-id' && ref.expectedKind === 'image' && ref.role === 'poster',
  ),
  'expected collectReferencedAssets to include poster ids as image references',
);
const referenceErrors = findAssetReferenceErrors(posterReferenceState, [
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
// referenced by `starterState`. Per ADR 0004 the asset root is
// the Owner — two sites under the same Owner share seed rows; we exercise
// only the single-Owner path here so the row count comparison stays
// straightforward.
const T6_CLERK_USER = 'smoke-t6-' + crypto.randomUUID().slice(0, 8);
const T6_SUB = 't6-' + crypto.randomUUID().slice(0, 8).toLowerCase();
const referencedSeedIds = [...collectReferencedAssetIds(starterState)];
assert(
  referencedSeedIds.length > 0,
  'expected starterTemplate to reference at least one seed asset id',
);
const preparedForCustomerA = prepareSeedAssetsForCustomer('customer-a', starterState, new Map());
const preparedForCustomerB = prepareSeedAssetsForCustomer('customer-b', starterState, new Map());
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
const preparedAStateIds = collectReferencedAssetIds(preparedForCustomerA.editableState);
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
const nestedSeedState: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'nested-seed-page',
      slug: 'nested-seed',
      title: 'Nested seed assets',
      width: 1440,
      sections: [
        {
          id: 'nested-seed-section',
          recipeId: 'custom',
          name: 'Nested seed',
          height: 600,
          elements: [
            {
              id: 'nested-seed-tabs',
              type: 'tabs',
              box: { x: 0, y: 0, w: 600, h: 360, z: 1 },
              activeTabId: 'media',
              tabs: [
                {
                  id: 'media',
                  label: [{ text: 'Media' }],
                  elements: [
                    {
                      id: 'nested-seed-tab-media',
                      type: 'media',
                      mediaKind: 'image',
                      assetId: 'seed-hero-poster-1',
                      alt: '',
                      fit: 'cover',
                      box: { x: 0, y: 0, w: 200, h: 120, z: 1 },
                    },
                  ],
                },
                { id: 'empty', label: [{ text: 'Empty' }], elements: [] },
              ],
            },
            {
              id: 'nested-seed-collection',
              type: 'collection',
              box: { x: 0, y: 380, w: 600, h: 160, z: 2 },
              collectionSlug: 'blog',
              display: 'card',
              sort: 'date-desc',
              // ADR 0063 dec 6 — per-entry instances live in `entries`.
              entries: [
                [
                  {
                    id: 'nested-seed-entry-logo',
                    type: 'nav',
                    box: { x: 0, y: 0, w: 320, h: 80, z: 1 },
                    logoAssetId: 'seed-portrait-placeholder',
                    links: [],
                    layout: 'left-right',
                    sticky: false,
                  },
                  {
                    id: 'nested-seed-entry-slide',
                    type: 'carousel',
                    box: { x: 0, y: 0, w: 320, h: 120, z: 1 },
                    slides: [{ id: 'nested-seed-slide', assetId: 'seed-project-thumb-neutral' }],
                    showArrows: true,
                    showDots: true,
                  },
                ],
              ],
            },
          ],
        },
      ],
    },
  ],
};
const preparedNestedSeed = prepareSeedAssetsForCustomer(
  'customer-nested-seed',
  nestedSeedState,
  new Map(),
);
assert(preparedNestedSeed.ok, 'expected nested seed asset preparation to succeed');
const preparedNestedSeedIds = collectReferencedAssetIds(preparedNestedSeed.editableState);
for (const originalId of [
  'seed-hero-poster-1',
  'seed-portrait-placeholder',
  'seed-project-thumb-neutral',
]) {
  assert(
    !preparedNestedSeedIds.has(originalId),
    `expected nested prepared state not to retain global seed asset id "${originalId}"`,
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
  const preparedT6 = prepareSeedAssetsForCustomer(t6CustomerId, starterState, new Map());
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

const baseT7State: EditableSite = structuredClone(starterState);
const baseT7Page = baseT7State.pages[0];
if (!baseT7Page) throw new Error('starterTemplate must have at least one page');
const baseT7Section = baseT7Page.sections.find(
  (section) =>
    section.elements.some((e) => e.type === 'text') &&
    section.elements.some((e) => e.type === 'media'),
);
if (!baseT7Section) {
  throw new Error('starterTemplate first page must have a section with text and media elements');
}
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
const t7RewriteValidation = validateEditableSite(t7Rewrite);
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
const t7ReplaceValidation = validateEditableSite(t7Replace);
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
const t7InsertValidation = validateEditableSite(t7Insert);
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

// Every mutating tool is enumerated in canvas-agent-smoke.ts; here we smoke
// that section creation stays semantic instead of exposing the fixed recipe
// picker directly to the model.
const t7ToolNames = CANVAS_AGENT_TOOLS.map((t) => t.name).sort();
assert(
  t7ToolNames.includes('designSection'),
  `expected CANVAS_AGENT_TOOLS to expose designSection (got [${t7ToolNames.join(', ')}])`,
);
assert(
  !t7ToolNames.includes('createSection') && !t7ToolNames.includes('insertSection'),
  `expected CANVAS_AGENT_TOOLS to hide recipe picker tools (got [${t7ToolNames.join(', ')}])`,
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
// public host router only intercepts *.<APP_DOMAIN>; the app host
// (opencanvas.test by default in review-smoke) falls through to the app routes.
const t7PreviewProbe = await app.request(
  'http://opencanvas.test/api/canvas-agent/sites/probe/preview',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"prompt":"x"}' },
  smokeEnv,
  smokeExecutionCtx,
);
assert(
  t7PreviewProbe.status === 302 || t7PreviewProbe.status === 401,
  `expected canvas-agent preview without auth to redirect or 401, got ${t7PreviewProbe.status}`,
);
const t7ApplyProbe = await app.request(
  'http://opencanvas.test/api/canvas-agent/sites/probe/apply',
  { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"ops":[]}' },
  smokeEnv,
  smokeExecutionCtx,
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
