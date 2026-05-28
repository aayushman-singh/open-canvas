// src/i18n/smoke.ts
//
// Manual smoke for wishlist #25 — RTL + per-page locale routing.
// Run with `bun.cmd run i18n:smoke`.
//
// Asserts the six behaviours from the wave brief:
//   1. `/ar/about` → { locale:'ar', pageSlug:'about', page:<ar-about> }.
//   2. `/about` → { locale: defaultLocale, pageSlug:'about', page:<default-about> }.
//   3. `/de/about` on a snapshot with no `de` pages → page:null (caller 404s).
//   4. `isRtl('ar')` true, `isRtl('en')` false, `isRtl('ar-EG')` true.
//   5. `mirrorElementBox({x:100, y:50, w:200, h:80, z:1}, 1440)` → {x:1140, …}.
//   6. `applyRtlMirror` on a mixed-locale snapshot leaves LTR pages
//      untouched and mirrors only RTL page elements.
//
// Plus a handful of belt-and-braces assertions covering the documented
// edge cases (default-locale prefix stripping, region-qualified RTL,
// snapshot purity).

import type { CanvasPage, PublishedSnapshot, TextElement } from '../canvas/schema.js';
import { resolveLocale } from './locale-resolve.js';
import { isRtl } from './rtl-rules.js';
import { applyRtlMirror, mirrorElementBox } from './mirror.js';
import { prepareRender } from './render-hook.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[i18n:smoke] FAIL — ${message}\n`);
    process.exit(1);
  }
}

function eq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    process.stderr.write(
      `[i18n:smoke] FAIL — ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTextElement(id: string, x: number): TextElement {
  return {
    id,
    type: 'text',
    box: { x, y: 50, w: 200, h: 80, z: 1 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function makePage(id: string, slug: string, locale: string | undefined, xs: number[]): CanvasPage {
  const page: CanvasPage = {
    id,
    slug,
    title: id,
    width: 1440,
    sections: [
      {
        id: `${id}-sec`,
        recipeId: 'hero-split',
        name: 'sec',
        height: 400,
        elements: xs.map((x, i) => makeTextElement(`${id}-el-${String(i)}`, x)),
      },
    ],
  };
  if (locale !== undefined) page.locale = locale;
  return page;
}

function makeSnapshot(pages: CanvasPage[], extra: Record<string, unknown> = {}): PublishedSnapshot {
  const base: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-05-23T00:00:00.000Z',
    styleKit: 'charcoal',
    pages,
  };
  Object.assign(base, extra);
  return base;
}

// ---------------------------------------------------------------------------
// Assertion 1 — `/ar/about` resolves to the Arabic about page.
// ---------------------------------------------------------------------------

const arAbout = makePage('p-ar-about', 'about', 'ar', [100, 300]);
const enAbout = makePage('p-en-about', 'about', 'en', [100, 300]);
const enContact = makePage('p-en-contact', 'contact', 'en', [50]);
const snapshot1 = makeSnapshot([enAbout, arAbout, enContact], { defaultLocale: 'en' });

const r1 = resolveLocale('/ar/about', snapshot1);
eq(r1.locale, 'ar', '1: resolveLocale(/ar/about).locale');
eq(r1.pageSlug, 'about', '1: resolveLocale(/ar/about).pageSlug');
assert(r1.page !== null, '1: resolveLocale(/ar/about).page must not be null');
eq(r1.page?.id ?? null, 'p-ar-about', '1: resolveLocale(/ar/about).page.id');

// ---------------------------------------------------------------------------
// Assertion 2 — `/about` resolves to the default-locale about page.
// ---------------------------------------------------------------------------

const r2 = resolveLocale('/about', snapshot1);
eq(r2.locale, 'en', '2: resolveLocale(/about).locale (default)');
eq(r2.pageSlug, 'about', '2: resolveLocale(/about).pageSlug');
assert(r2.page !== null, '2: resolveLocale(/about).page must not be null');
eq(r2.page?.id ?? null, 'p-en-about', '2: resolveLocale(/about).page.id');

// Bonus: `/en/about` (explicit default prefix) finds the same page when no
// page has locale='en' explicit (we have one — verify it picks the en one).
const r2b = resolveLocale('/en/about', snapshot1);
eq(r2b.locale, 'en', '2b: /en/about explicit default → locale en');
eq(r2b.page?.id ?? null, 'p-en-about', '2b: /en/about finds the en about page');

// ---------------------------------------------------------------------------
// Assertion 3 — `/de/about` on a snapshot without `de` returns page:null.
// ---------------------------------------------------------------------------

const r3 = resolveLocale('/de/about', snapshot1);
eq(r3.locale, 'de', '3: /de/about preserves the explicit locale in result');
eq(r3.pageSlug, 'about', '3: /de/about preserves the slug');
eq(r3.page, null, '3: /de/about returns page:null (caller renders 404)');

// ---------------------------------------------------------------------------
// Assertion 4 — isRtl curated list + region qualifiers.
// ---------------------------------------------------------------------------

assert(isRtl('ar') === true, '4: isRtl("ar") must be true');
assert(isRtl('he') === true, '4: isRtl("he") must be true');
assert(isRtl('fa') === true, '4: isRtl("fa") must be true');
assert(isRtl('ur') === true, '4: isRtl("ur") must be true');
assert(isRtl('en') === false, '4: isRtl("en") must be false');
assert(isRtl('ar-EG') === true, '4: isRtl("ar-EG") must be true');
assert(isRtl('he-IL') === true, '4: isRtl("he-IL") must be true');
assert(isRtl('en-US') === false, '4: isRtl("en-US") must be false');
assert(isRtl('') === false, '4: isRtl("") must be false');
assert(isRtl(null) === false, '4: isRtl(null) must be false');
assert(isRtl(undefined) === false, '4: isRtl(undefined) must be false');
assert(isRtl('AR-eg') === true, '4: isRtl("AR-eg") tolerates case on the primary subtag');

// ---------------------------------------------------------------------------
// Assertion 5 — mirrorElementBox formula.
// ---------------------------------------------------------------------------

const mirroredBox = mirrorElementBox({ x: 100, y: 50, w: 200, h: 80, z: 1 }, 1440);
eq(mirroredBox.x, 1440 - 100 - 200, '5: mirrored x = canvasWidth - x - w');
eq(mirroredBox.y, 50, '5: y preserved');
eq(mirroredBox.w, 200, '5: w preserved');
eq(mirroredBox.h, 80, '5: h preserved');
eq(mirroredBox.z, 1, '5: z preserved');
// Sanity check the concrete expected value from the brief.
eq(mirroredBox.x, 1140, '5: 1440-100-200 = 1140');

// Rotation is preserved verbatim (no negation).
const mirroredRotated = mirrorElementBox(
  { x: 100, y: 50, w: 200, h: 80, z: 1, rotation: 30 },
  1440,
);
eq(mirroredRotated.rotation, 30, '5: rotation preserved unchanged');

// ---------------------------------------------------------------------------
// Assertion 6 — applyRtlMirror mirrors only RTL pages.
// ---------------------------------------------------------------------------

const arPage = makePage('p-ar', 'about', 'ar', [100, 500]);
const enPage = makePage('p-en', 'about', 'en', [100, 500]);
const noLocalePage = makePage('p-no-locale', 'home', undefined, [100, 500]);
const snapshot6 = makeSnapshot([arPage, enPage, noLocalePage], { defaultLocale: 'en' });

// Snapshot purity check: deep-snapshot pre-mirror.
const preMirrorJson = JSON.stringify(snapshot6);

const mirrored = applyRtlMirror(snapshot6);

// Input not mutated.
eq(
  JSON.stringify(snapshot6),
  preMirrorJson,
  '6: applyRtlMirror must not mutate its input snapshot',
);

// Same number of pages out.
eq(mirrored.pages.length, 3, '6: page count preserved');

// Find pages by id in output.
const arOut = mirrored.pages.find((p) => p.id === 'p-ar');
const enOut = mirrored.pages.find((p) => p.id === 'p-en');
const noLocaleOut = mirrored.pages.find((p) => p.id === 'p-no-locale');
assert(arOut !== undefined, '6: AR page survived');
assert(enOut !== undefined, '6: EN page survived');
assert(noLocaleOut !== undefined, '6: no-locale page survived');

// AR page x-coords mirrored.
const arSection = arOut?.sections[0];
const arEl0 = arSection?.elements[0];
const arEl1 = arSection?.elements[1];
eq(arEl0?.box.x ?? null, 1440 - 100 - 200, '6: AR element 0 x mirrored');
eq(arEl1?.box.x ?? null, 1440 - 500 - 200, '6: AR element 1 x mirrored');

// EN page x-coords UNTOUCHED.
const enSection = enOut?.sections[0];
const enEl0 = enSection?.elements[0];
const enEl1 = enSection?.elements[1];
eq(enEl0?.box.x ?? null, 100, '6: EN element 0 x unchanged');
eq(enEl1?.box.x ?? null, 500, '6: EN element 1 x unchanged');

// No-locale page treated as default locale → LTR → untouched.
const noLocaleSection = noLocaleOut?.sections[0];
eq(noLocaleSection?.elements[0]?.box.x ?? null, 100, '6: no-locale page unchanged (default LTR)');

// Snapshot-level extras (`defaultLocale`) survive the clone.
eq(
  mirrored.defaultLocale ?? null,
  'en',
  '6: defaultLocale extra preserved on cloned snapshot',
);

// Identity check: the EN page reference is reused (no needless clone).
assert(enOut === enPage, '6: LTR page passes through by reference (no allocation)');

// ---------------------------------------------------------------------------
// Bonus — prepareRender integration shape.
// ---------------------------------------------------------------------------

const prep = prepareRender('/ar/about', snapshot1);
eq(prep.locale, 'ar', 'prepareRender: locale ar');
eq(prep.dir, 'rtl', 'prepareRender: dir rtl for ar');
eq(prep.pageSlug, 'about', 'prepareRender: pageSlug forwarded');
assert(prep.page !== null, 'prepareRender: AR page found');
// renderSnapshot must be a different reference (mirror cloned the page).
assert(prep.renderSnapshot !== snapshot1, 'prepareRender: RTL path produces a new snapshot');
// And the AR page's elements must be mirrored in the render snapshot.
const prepArPage = prep.renderSnapshot.pages.find((p) => p.id === 'p-ar-about');
eq(prepArPage?.sections[0]?.elements[0]?.box.x ?? null, 1440 - 100 - 200, 'prepareRender: AR element mirrored');

// LTR path returns the original snapshot reference (no mirror).
const prepEn = prepareRender('/about', snapshot1);
eq(prepEn.dir, 'ltr', 'prepareRender: dir ltr for en');
assert(prepEn.renderSnapshot === snapshot1, 'prepareRender: LTR path reuses input snapshot reference');

// 404 path — page null but locale + dir still resolve from the URL.
const prep404 = prepareRender('/de/about', snapshot1);
eq(prep404.page, null, 'prepareRender: /de/about returns page null');
eq(prep404.locale, 'de', 'prepareRender: /de/about locale de');
eq(prep404.dir, 'ltr', 'prepareRender: unknown locale → ltr (de is not in curated RTL list)');

// ---------------------------------------------------------------------------
// Edge — empty path resolves to the default-locale root.
// ---------------------------------------------------------------------------

const rootSnap = makeSnapshot([makePage('p-root', '', 'en', [0])], { defaultLocale: 'en' });
const rRoot = resolveLocale('/', rootSnap);
eq(rRoot.locale, 'en', 'root: locale en');
eq(rRoot.pageSlug, '', 'root: pageSlug empty');
assert(rRoot.page !== null, 'root: page found');

// ---------------------------------------------------------------------------
// Edge — region-qualified RTL prefix resolves to a bare-tag page.
// ---------------------------------------------------------------------------

const arEgPage = makePage('p-ar-eg', 'about', 'ar-EG', [100]);
const snapshotRegion = makeSnapshot([arEgPage], { defaultLocale: 'en' });
const rRegion = resolveLocale('/ar/about', snapshotRegion);
eq(rRegion.page?.id ?? null, 'p-ar-eg', 'region: bare prefix matches region-qualified page');

// ---------------------------------------------------------------------------
process.stdout.write('[i18n:smoke] OK — 6 assertions + bonus checks passed\n');
process.exit(0);
