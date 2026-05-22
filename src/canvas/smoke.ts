// src/canvas/smoke.ts
//
// Manual smoke: validate the canonical home fixture as an Editable Site and
// as a Published Snapshot, render it, and assert the rendered HTML contains
// the expected stable markers. Run with `bun.cmd run canvas:smoke`.

import fixture from './fixtures/home.json';
import { renderCanvasSnapshot } from './render.js';
import type {
  BuiltInStyleKit,
  CanvasPage,
  CanvasSiteState,
  PublishedSnapshot,
  StyleKit,
  TextElement,
} from './schema.js';
import { BUILT_IN_STYLE_KITS } from './schema.js';
import { STYLE_KIT_PRESETS, buildAllStyleKitsCss, getStyleKitPreset } from './style-kits.js';
import {
  validateCanvasSiteState,
  validatePublishedSnapshot,
  validateSeedFixture,
} from './validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const editable = fixture as CanvasSiteState;
const editableResult = validateCanvasSiteState(editable);
assert(editableResult.valid, editableResult.valid ? '' : editableResult.errors.join('; '));

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-22T00:00:00.000Z',
  styleKit: editable.styleKit,
  pages: editable.pages,
};
const publishedResult = validatePublishedSnapshot(snapshot);
assert(publishedResult.valid, publishedResult.valid ? '' : publishedResult.errors.join('; '));

const html = renderCanvasSnapshot(snapshot, '/assets');
assert(html.includes('data-rev01-page="page-home"'), 'expected rendered home page marker');
assert(html.includes('data-rev01-section="section-hero"'), 'expected rendered hero section marker');
assert(html.includes('data-rev01-element="hero-heading"'), 'expected rendered heading marker');
assert(html.includes('data-rev01-media-kind="image"'), 'expected rendered image media marker');

// Rich text: the hero heading must contain a <strong> tag (the "lived-in" run
// in the fixture carries a `bold` mark). Anchor the search to the heading's
// element wrapper so we don't accept a stray <strong> elsewhere.
const headingMarker = 'data-rev01-element="hero-heading"';
const headingIdx = html.indexOf(headingMarker);
assert(headingIdx >= 0, 'expected hero-heading marker present in rendered HTML');
const headingEnd = html.indexOf('</h1>', headingIdx);
assert(headingEnd > headingIdx, 'expected hero-heading h1 to close after its marker');
const headingBlock = html.slice(headingIdx, headingEnd);
assert(
  headingBlock.includes('<strong>'),
  'expected <strong> inside the hero-heading block (bold mark must render)',
);

// Rich text: somewhere in the page a link mark must render as
// <a class="rev01-inline-link" href="https://...">. The fixture wires this
// onto the hero-body element pointing at rev01.aayushman.dev.
assert(
  /<a class="rev01-inline-link" href="https:\/\/[^"]+"/.test(html),
  'expected at least one rev01-inline-link with an https href in rendered HTML',
);

// Validator: a hand-built text element whose link mark uses a javascript:
// scheme must be rejected. The smoke wraps it in a minimum CanvasSiteState.
const javascriptLinkText: TextElement = {
  id: 'hero-heading-evil',
  type: 'text',
  box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
  content: [{ text: 'go', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }],
  role: 'body',
  fontSize: 16,
  fontWeight: 400,
  align: 'left',
};
const javascriptLinkState: CanvasSiteState = {
  styleKit: 'charcoal',
  symbols: [],
  pages: [
    {
      id: 'page-evil',
      slug: 'evil',
      title: 'Evil',
      width: 1440,
      sections: [
        {
          id: 'section-evil',
          recipeId: 'hero-split',
          name: 'Evil',
          height: 400,
          elements: [javascriptLinkText],
        },
      ],
    },
  ],
};
const javascriptLinkResult = validateCanvasSiteState(javascriptLinkState);
assert(
  !javascriptLinkResult.valid,
  'expected validator to reject a link mark with href "javascript:alert(1)"',
);
assert(
  !javascriptLinkResult.valid &&
    javascriptLinkResult.errors.some((m) => m.includes('javascript:alert(1)')),
  'expected javascript: link rejection to mention the offending href',
);

// -- Task 5.6: single-page invariant + accessibility -----------------------
// The hero section contains a shape (`hero-orb`) and a surface (`hero-card`),
// both decorative-by-default. The rendered HTML for the hero section must
// include at least one element wrapper with `aria-hidden="true"`. Anchor the
// search to the hero section so we do not accept an aria-hidden somewhere
// further down the page.
const heroSectionMarker = 'data-rev01-section="section-hero"';
const heroSectionIdx = html.indexOf(heroSectionMarker);
assert(heroSectionIdx >= 0, 'expected section-hero marker present in rendered HTML');
const heroSectionEnd = html.indexOf('</section>', heroSectionIdx);
assert(heroSectionEnd > heroSectionIdx, 'expected section-hero to close after its marker');
const heroSectionBlock = html.slice(heroSectionIdx, heroSectionEnd);
assert(
  heroSectionBlock.includes('aria-hidden="true"'),
  'expected at least one aria-hidden="true" inside section-hero (shape or surface)',
);

// The hero heading text element must NOT carry aria-hidden — text speaks for
// itself. Find the hero-heading wrapper opening tag and check it.
const headingWrapperIdx = html.indexOf('data-rev01-element="hero-heading"');
assert(headingWrapperIdx >= 0, 'expected hero-heading element wrapper in rendered HTML');
const headingWrapperOpenEnd = html.indexOf('>', headingWrapperIdx);
assert(
  headingWrapperOpenEnd > headingWrapperIdx,
  'expected hero-heading wrapper opening tag to close with >',
);
const headingWrapperOpenTag = html.slice(headingWrapperIdx, headingWrapperOpenEnd);
assert(
  !headingWrapperOpenTag.includes('aria-hidden'),
  'expected hero-heading wrapper NOT to carry aria-hidden (text is semantic content)',
);

// Validator: a two-page state must be rejected with the single-page message.
// Build it from the fixture so the second page is otherwise valid — the only
// reason for rejection is the length rule.
const fixtureClone = structuredClone(editable);
const secondPage: CanvasPage = structuredClone(fixtureClone.pages[0] as CanvasPage);
const twoPageState: CanvasSiteState = {
  ...fixtureClone,
  pages: [fixtureClone.pages[0] as CanvasPage, secondPage],
};
const twoPageResult = validateCanvasSiteState(twoPageState);
assert(
  !twoPageResult.valid,
  'expected validator to reject a two-page state (single-page POC invariant)',
);
assert(
  !twoPageResult.valid && twoPageResult.errors.some((m) => m.includes('exactly one canvas page')),
  'expected two-page rejection to mention "exactly one canvas page"',
);

// Validator: the existing empty-pages case must still reject (the new length
// rule does not displace the non-empty-array check).
const noPagesResult = validateCanvasSiteState({ styleKit: 'charcoal', pages: [] });
assert(
  !noPagesResult.valid,
  'expected validator to still reject pages: [] (non-empty array required)',
);

// -- Task 6: seed-asset registry gating -----------------------------------
// The bundled fixture's media `assetId` and `posterAssetId` values must all
// resolve in SEED_ASSET_REGISTRY. Production validators stay registry-free;
// only validateSeedFixture consults the registry.
const seedResult = validateSeedFixture(editable);
assert(
  seedResult.valid,
  seedResult.valid
    ? ''
    : `expected validateSeedFixture(starterTemplate.state) to pass: ${seedResult.errors.join('; ')}`,
);

// And a hand-built fixture whose media references an unregistered assetId
// must be rejected, with the rejection message mentioning the offending id.
const bogusAssetId = 'not-a-real-seed-id-xyz';
const fixtureWithBogusAsset: CanvasSiteState = structuredClone(editable);
const firstPage = fixtureWithBogusAsset.pages[0];
if (!firstPage) throw new Error('fixture must have at least one page');
const heroSection = firstPage.sections.find((s) => s.id === 'section-hero');
if (!heroSection) throw new Error('fixture must have a hero section');
const heroMedia = heroSection.elements.find((el) => el.id === 'hero-media');
if (!heroMedia || heroMedia.type !== 'media') {
  throw new Error('fixture hero section must contain a media element with id hero-media');
}
heroMedia.assetId = bogusAssetId;
const bogusSeedResult = validateSeedFixture(fixtureWithBogusAsset);
assert(
  !bogusSeedResult.valid,
  'expected validateSeedFixture to reject a fixture with an unregistered assetId',
);
assert(
  !bogusSeedResult.valid && bogusSeedResult.errors.some((m) => m.includes(bogusAssetId)),
  `expected validateSeedFixture rejection to mention the offending id ${bogusAssetId}`,
);

// -- Task 8: deterministic style kits + variants + motion ----------------
//
// The shared kit CSS produced by `buildAllStyleKitsCss()` is consumed by both
// the editor preview (src/editor/canvas-styles.ts) and the public renderer
// (src/canvas/public-styles.ts). These assertions verify the FOUR kits emit
// distinctly different blocks — different accent colour, different action
// solid background, different surface raised radius/shadow, different motion
// duration/easing — so switching kits visibly changes the page.

const allKitsCss = buildAllStyleKitsCss();

// Every kit emits its own `[data-style-kit="<kit>"] {` block with the kit
// accent token set. We extract per-kit blocks by simple anchor + slice.
function extractKitTokenBlock(css: string, kit: BuiltInStyleKit): string {
  const anchor = `[data-style-kit="${kit}"] {`;
  const start = css.indexOf(anchor);
  if (start < 0) {
    throw new Error(`[canvas:smoke] kit token block not found for ${kit}`);
  }
  const end = css.indexOf('}', start);
  if (end < 0) {
    throw new Error(`[canvas:smoke] kit token block did not close for ${kit}`);
  }
  return css.slice(start, end + 1);
}

const accentByKit = new Map<BuiltInStyleKit, string>();
const motionByKit = new Map<BuiltInStyleKit, string>();
for (const kit of BUILT_IN_STYLE_KITS) {
  const block = extractKitTokenBlock(allKitsCss, kit);
  // Token block must declare the kit-namespaced accent.
  assert(
    block.includes('--rev01-kit-accent:'),
    `expected kit ${kit} token block to include --rev01-kit-accent declaration`,
  );
  const preset = getStyleKitPreset(kit);
  assert(
    block.includes(preset.accent),
    `expected kit ${kit} token block to reference its preset accent ${preset.accent}`,
  );
  accentByKit.set(kit, preset.accent);
  // Motion duration must match the preset's motionDurationMs.
  assert(
    block.includes(`--rev01-kit-motion-duration: ${String(preset.motionDurationMs)}ms`),
    `expected kit ${kit} token block to include motion duration ${String(preset.motionDurationMs)}ms`,
  );
  motionByKit.set(kit, `${String(preset.motionDurationMs)}ms`);
}

// The four kits must produce four DISTINCT accent values.
const distinctAccents = new Set(accentByKit.values());
assert(
  distinctAccents.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct kit accents, got ${String(distinctAccents.size)} (${[...accentByKit.entries()].map(([k, v]) => `${k}=${v}`).join(', ')})`,
);

// Four DISTINCT motion durations (or at least 3+ distinct ones — but the plan
// asks each kit to feel different so we enforce all four are unique).
const distinctMotion = new Set(motionByKit.values());
assert(
  distinctMotion.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct motion durations, got ${String(distinctMotion.size)}`,
);

// Each kit must emit its actionVariants.solid block — distinct background per
// kit. The block selector is
//   [data-style-kit="<kit>"] [data-element-type="action"][data-variant="solid"] .rev01-action
const solidBackgrounds = new Map<BuiltInStyleKit, string>();
for (const kit of BUILT_IN_STYLE_KITS) {
  const anchor = `[data-style-kit="${kit}"] [data-element-type="action"][data-variant="solid"] .rev01-action {`;
  const start = allKitsCss.indexOf(anchor);
  assert(start >= 0, `expected solid action block for kit ${kit}`);
  const end = allKitsCss.indexOf('}', start);
  assert(end > start, `expected solid action block for kit ${kit} to close`);
  const block = allKitsCss.slice(start, end + 1);
  // Pull the background declaration value.
  const match = block.match(/background:\s*([^;]+);/);
  assert(match !== null, `expected solid action block for kit ${kit} to declare a background`);
  const matched = (match as RegExpMatchArray)[1];
  assert(
    typeof matched === 'string',
    `expected background capture group for kit ${kit} to be a string`,
  );
  // Pull preset value out for comparison.
  const preset = getStyleKitPreset(kit);
  const expected = preset.actionVariants.solid.background;
  assert(
    expected !== undefined,
    `expected kit ${kit}'s solid action variant to declare background`,
  );
  assert(
    (matched as string).includes(expected as string),
    `expected solid action block for kit ${kit} to reference ${String(expected)}`,
  );
  solidBackgrounds.set(kit, (matched as string).trim());
}
const distinctSolidBackgrounds = new Set(solidBackgrounds.values());
assert(
  distinctSolidBackgrounds.size === BUILT_IN_STYLE_KITS.length,
  `expected ${String(BUILT_IN_STYLE_KITS.length)} distinct solid action backgrounds across kits`,
);

// Each kit must emit a surfaceVariants.raised block.
for (const kit of BUILT_IN_STYLE_KITS) {
  const anchor = `[data-style-kit="${kit}"] [data-element-type="container"][data-variant="raised"] .rev01-surface {`;
  const start = allKitsCss.indexOf(anchor);
  assert(start >= 0, `expected raised surface block for kit ${kit}`);
}

// getStyleKitPreset throws on unknown kit name.
let getThrew = false;
try {
  getStyleKitPreset('not-a-kit');
} catch (err) {
  getThrew = true;
  assert(
    err instanceof Error && err.message.includes('not-a-kit'),
    `expected getStyleKitPreset error to mention the offending kit name (got ${err instanceof Error ? err.message : String(err)})`,
  );
}
assert(getThrew, 'expected getStyleKitPreset("not-a-kit") to throw');

// Every kit defines every action variant, every surface variant, every
// motion preset — the Record<X, ...> types are belt-and-braces here so we
// add a runtime check for clarity.
for (const kit of BUILT_IN_STYLE_KITS) {
  const preset = STYLE_KIT_PRESETS[kit];
  const actionKeys = Object.keys(preset.actionVariants).sort().join(',');
  assert(
    actionKeys === 'brutalist,ghost,glass,outline,pill,solid,underline',
    `expected kit ${kit} to cover every action variant (got ${actionKeys})`,
  );
  const surfaceKeys = Object.keys(preset.surfaceVariants).sort().join(',');
  assert(
    surfaceKeys === 'editorial-frame,flat,glass,outlined,raised,soft-panel,sticker',
    `expected kit ${kit} to cover every surface variant (got ${surfaceKeys})`,
  );
  const motionKeys = Object.keys(preset.motionPresets).sort().join(',');
  assert(
    motionKeys ===
      'blur-in,fade-up,none,parallax-soft,scale-in,slide-left,slow-drift,stagger-children',
    `expected kit ${kit} to cover every motion preset (got ${motionKeys})`,
  );
}

// Renderer must stamp data-variant on action / shape / container wrappers and
// data-role on text wrappers, so the kit CSS variant selectors match.
const rendered = renderCanvasSnapshot(snapshot, '/assets');
assert(
  rendered.includes('data-element-type="action"'),
  'expected rendered HTML to contain at least one [data-element-type="action"] wrapper',
);
// The fixture has hero-cta as a solid action — verify it lands a data-variant.
assert(
  /data-element-type="action"[^>]*data-variant="[a-z-]+"/.test(rendered) ||
    /data-variant="[a-z-]+"[^>]*data-element-type="action"/.test(rendered),
  'expected at least one action wrapper to carry both data-element-type and data-variant',
);

// Renderer must throw on an unknown kit. Build a snapshot with a hand-poked
// kit name that the validator (which already rejects unknown kits at the API
// boundary) would normally have stopped — defence in depth.
let rendererThrew = false;
try {
  renderCanvasSnapshot({ ...snapshot, styleKit: 'not-a-kit' as unknown as StyleKit }, '/assets');
} catch (err) {
  rendererThrew = true;
  assert(
    err instanceof Error && err.message.includes('not-a-kit'),
    'expected renderer error to mention the offending kit name',
  );
}
assert(rendererThrew, 'expected renderer to throw on unknown style kit (no silent fallback)');

console.log('[canvas:smoke] OK');
