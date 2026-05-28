// src/canvas/recipes.ts
//
// Section recipe registry — the constrained-shape factory layer that the
// canvas AI agent uses to create new Canvas Sections. The LLM is allowed to
// pick a `recipeId` and a brief; the matching factory in this module is the
// thing that actually authors the `CanvasSection` object. The LLM never
// hand-writes section JSON.
//
// Every entry in `SECTION_RECIPE_IDS` has exactly one factory here. Each
// factory:
//   - Produces a complete `CanvasSection` whose ids follow the deterministic
//     shape `sec-{recipeId}-{shortRand}` / `el-{role}-{shortRand}`. The
//     `shortRand` suffix is the only nondeterministic part — derived from
//     `crypto.randomUUID()` so each new section gets a fresh id. Everything
//     else (positions, sizes, content, motion) is purely a function of the
//     input.
//   - Honours the rich-text content model: every `TextElement.content` is
//     an `InlineRun[]` with no plain-string text fields.
//   - Slots real asset ids from `input.assetIds` when present. When the
//     recipe needs media and no asset id was supplied, it falls back to the
//     seed registry ids (`seed-hero-poster-1` / `seed-feature-canvas-1`).
//   - Produces output that passes `validateEditableSite` when wrapped in
//     a single-page state. The canvas-agent smoke enforces this.
//
// `createSectionFromRecipe(recipeId, input)` is the entry point used by
// `applyCanvasAgentOp`; it throws loudly when the recipe id is unknown so a
// caller (the agent route) can short-circuit with a 400 instead of silently
// emitting a malformed section.

import {
  AGENT_RECIPE_IDS,
  SECTION_RECIPE_IDS,
  type CanvasSection,
  type InlineRun,
  type SectionRecipeId,
  type StyleKit,
} from './schema.js';

export interface RecipeFactoryInput {
  /**
   * Owner-supplied brief describing what the section should say. The factory
   * uses this verbatim as the heading / body text — there is no LLM call
   * inside the factory; the brief is just a string interpolated into the
   * section content. This keeps factories pure and deterministic.
   */
  brief: string;
  styleKit: StyleKit;
  /**
   * Existing uploaded asset ids the recipe should reference. The agent route
   * verifies these belong to the site BEFORE asking a factory to use them,
   * so the factory itself does not re-check.
   *
   * - `hero` — single media id used by hero recipes (`hero-split`, `video-hero`).
   * - `cards` — gallery / grid recipes consume the first N from this array.
   * - `gallery` — alias for `cards` when the brief mentions a gallery shape.
   *
   * When omitted, recipes that need media fall back to bundled seed registry
   * ids (`seed-hero-poster-1`, `seed-feature-canvas-1`). The agent route still
   * verifies those ids exist as `ownerAsset` rows before returning a preview,
   * so an unmaterialised site fails loudly instead of silently publishing a
   * dangling reference.
   */
  assetIds?: { hero?: string; cards?: string[]; gallery?: string[] };
}

export type RecipeFactory = (input: RecipeFactoryInput) => CanvasSection;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Stable seed asset ids used as fallbacks. These match
// `src/canvas/seed-assets.ts` exactly — if we rename a seed there, the
// fallback here must be updated in lockstep.
const SEED_HERO_POSTER_ID = 'seed-hero-poster-1';
const SEED_FEATURE_CANVAS_ID = 'seed-feature-canvas-1';

function shortRand(): string {
  return crypto.randomUUID().slice(0, 8);
}

function makeSectionId(recipeId: SectionRecipeId): string {
  return `sec-${recipeId}-${shortRand()}`;
}

function makeElementId(role: string): string {
  return `el-${role}-${shortRand()}`;
}

/**
 * Build a single-run `InlineRun[]` from a plain string. The brief is a plain
 * string by design — recipes never embed marks, only text. If the Owner
 * wants bold inside a brief, they go through `rewriteText` after the
 * section lands on the canvas.
 *
 * Empty briefs would fail the validator's "concatenated plain text must not
 * be empty" rule, so each recipe substitutes a recipe-specific placeholder
 * via {@link briefOr}.
 */
function runOf(text: string): InlineRun[] {
  return [{ text }];
}

function briefOr(brief: string, fallback: string): string {
  const trimmed = brief.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function pickHero(input: RecipeFactoryInput): string {
  return input.assetIds?.hero ?? SEED_HERO_POSTER_ID;
}

function pickCard(input: RecipeFactoryInput, index: number): string {
  const cards = input.assetIds?.cards;
  if (cards && cards.length > 0) {
    const at = cards[index % cards.length];
    if (typeof at === 'string' && at.length > 0) return at;
  }
  return SEED_FEATURE_CANVAS_ID;
}

function pickGalleryItem(input: RecipeFactoryInput, index: number): string {
  const gallery = input.assetIds?.gallery;
  if (gallery && gallery.length > 0) {
    const at = gallery[index % gallery.length];
    if (typeof at === 'string' && at.length > 0) return at;
  }
  return pickCard(input, index);
}

// ---------------------------------------------------------------------------
// Factories — one per SectionRecipeId. Layouts are conservative: each fits
// inside the canonical 1440-wide page with section heights in [240, 1400].
// ---------------------------------------------------------------------------

function buildHeroSplit(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'A hero that says something honest.');
  return {
    id: makeSectionId('hero-split'),
    recipeId: 'hero-split',
    name: 'Hero',
    height: 720,
    backgroundEffect: 'grain',
    entrance: 'fade-up',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 80, y: 140, w: 600, h: 180, z: 3 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 60,
        fontWeight: 700,
        align: 'left',
        motion: { preset: 'fade-up', delayMs: 50 },
      },
      {
        id: makeElementId('body'),
        type: 'text',
        box: { x: 80, y: 340, w: 540, h: 120, z: 3 },
        content: runOf('Lead with what the visitor gets, not what you built.'),
        role: 'body',
        fontSize: 20,
        fontWeight: 400,
        align: 'left',
      },
      {
        id: makeElementId('action'),
        type: 'action',
        box: { x: 80, y: 500, w: 200, h: 56, z: 3 },
        label: 'Start editing',
        href: { type: 'external', url: '#' },
        variant: 'solid',
      },
      {
        id: makeElementId('media'),
        type: 'media',
        box: { x: 760, y: 100, w: 600, h: 540, z: 2 },
        mediaKind: 'image',
        assetId: pickHero(input),
        alt: 'Hero illustration',
        fit: 'cover',
      },
    ],
  };
}

function buildFeatureGrid(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'Three reasons it works.');
  return {
    id: makeSectionId('feature-grid'),
    recipeId: 'feature-grid',
    name: 'Features',
    height: 720,
    backgroundEffect: 'paper',
    entrance: 'stagger-children',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 80, y: 80, w: 800, h: 90, z: 2 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 44,
        fontWeight: 600,
        align: 'left',
      },
      {
        id: makeElementId('card-1-media'),
        type: 'media',
        box: { x: 80, y: 220, w: 380, h: 280, z: 2 },
        mediaKind: 'image',
        assetId: pickCard(input, 0),
        alt: 'Feature one',
        fit: 'cover',
      },
      {
        id: makeElementId('card-1-label'),
        type: 'text',
        box: { x: 80, y: 520, w: 380, h: 60, z: 2 },
        content: runOf('Position freely'),
        role: 'label',
        fontSize: 16,
        fontWeight: 500,
        align: 'left',
      },
      {
        id: makeElementId('card-2-media'),
        type: 'media',
        box: { x: 530, y: 220, w: 380, h: 280, z: 2 },
        mediaKind: 'image',
        assetId: pickCard(input, 1),
        alt: 'Feature two',
        fit: 'cover',
      },
      {
        id: makeElementId('card-2-label'),
        type: 'text',
        box: { x: 530, y: 520, w: 380, h: 60, z: 2 },
        content: runOf('Pick a style kit'),
        role: 'label',
        fontSize: 16,
        fontWeight: 500,
        align: 'left',
      },
      {
        id: makeElementId('card-3-media'),
        type: 'media',
        box: { x: 980, y: 220, w: 380, h: 280, z: 2 },
        mediaKind: 'image',
        assetId: pickCard(input, 2),
        alt: 'Feature three',
        fit: 'cover',
      },
      {
        id: makeElementId('card-3-label'),
        type: 'text',
        box: { x: 980, y: 520, w: 380, h: 60, z: 2 },
        content: runOf('Publish in one click'),
        role: 'label',
        fontSize: 16,
        fontWeight: 500,
        align: 'left',
      },
    ],
  };
}

function buildGalleryStrip(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'A look around.');
  return {
    id: makeSectionId('gallery-strip'),
    recipeId: 'gallery-strip',
    name: 'Gallery',
    height: 560,
    backgroundEffect: 'soft-light',
    entrance: 'stagger-children',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 80, y: 60, w: 800, h: 70, z: 2 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 36,
        fontWeight: 600,
        align: 'left',
      },
      {
        id: makeElementId('item-1'),
        type: 'media',
        box: { x: 80, y: 180, w: 300, h: 320, z: 2 },
        mediaKind: 'image',
        assetId: pickGalleryItem(input, 0),
        alt: 'Gallery item 1',
        fit: 'cover',
      },
      {
        id: makeElementId('item-2'),
        type: 'media',
        box: { x: 420, y: 180, w: 300, h: 320, z: 2 },
        mediaKind: 'image',
        assetId: pickGalleryItem(input, 1),
        alt: 'Gallery item 2',
        fit: 'cover',
      },
      {
        id: makeElementId('item-3'),
        type: 'media',
        box: { x: 760, y: 180, w: 300, h: 320, z: 2 },
        mediaKind: 'image',
        assetId: pickGalleryItem(input, 2),
        alt: 'Gallery item 3',
        fit: 'cover',
      },
      {
        id: makeElementId('item-4'),
        type: 'media',
        box: { x: 1100, y: 180, w: 260, h: 320, z: 2 },
        mediaKind: 'image',
        assetId: pickGalleryItem(input, 3),
        alt: 'Gallery item 4',
        fit: 'cover',
      },
    ],
  };
}

function buildCtaBand(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'Ready when you are.');
  return {
    id: makeSectionId('cta-band'),
    recipeId: 'cta-band',
    name: 'Call to action',
    height: 480,
    backgroundEffect: 'soft-light',
    entrance: 'scale-in',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 220, y: 120, w: 1000, h: 140, z: 2 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 52,
        fontWeight: 700,
        align: 'center',
      },
      {
        id: makeElementId('primary'),
        type: 'action',
        box: { x: 540, y: 300, w: 220, h: 64, z: 3 },
        label: 'Get started',
        href: { type: 'external', url: '#' },
        variant: 'pill',
      },
      {
        id: makeElementId('secondary'),
        type: 'action',
        box: { x: 780, y: 300, w: 220, h: 64, z: 3 },
        label: 'Talk to us',
        href: { type: 'external', url: 'mailto:hello@example.com' },
        variant: 'underline',
      },
    ],
  };
}

function buildLogoStrip(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'Trusted by teams that ship.');
  return {
    id: makeSectionId('logo-strip'),
    recipeId: 'logo-strip',
    name: 'Logo strip',
    height: 320,
    backgroundEffect: 'none',
    entrance: 'fade-up',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 220, y: 60, w: 1000, h: 60, z: 2 },
        content: runOf(headline),
        role: 'label',
        fontSize: 16,
        fontWeight: 500,
        align: 'center',
      },
      {
        id: makeElementId('logo-1'),
        type: 'shape',
        box: { x: 200, y: 160, w: 160, h: 80, z: 2 },
        variant: 'pill',
      },
      {
        id: makeElementId('logo-2'),
        type: 'shape',
        box: { x: 400, y: 160, w: 160, h: 80, z: 2 },
        variant: 'pill',
      },
      {
        id: makeElementId('logo-3'),
        type: 'shape',
        box: { x: 600, y: 160, w: 160, h: 80, z: 2 },
        variant: 'pill',
      },
      {
        id: makeElementId('logo-4'),
        type: 'shape',
        box: { x: 800, y: 160, w: 160, h: 80, z: 2 },
        variant: 'pill',
      },
      {
        id: makeElementId('logo-5'),
        type: 'shape',
        box: { x: 1000, y: 160, w: 160, h: 80, z: 2 },
        variant: 'pill',
      },
    ],
  };
}

function buildTestimonialRow(input: RecipeFactoryInput): CanvasSection {
  const quote = briefOr(input.brief, 'It saved us a week of futzing.');
  return {
    id: makeSectionId('testimonial-row'),
    recipeId: 'testimonial-row',
    name: 'Testimonials',
    height: 520,
    backgroundEffect: 'paper',
    entrance: 'fade-up',
    elements: [
      {
        id: makeElementId('quote-1'),
        type: 'text',
        box: { x: 80, y: 120, w: 380, h: 200, z: 2 },
        content: runOf(quote),
        role: 'body',
        fontSize: 22,
        fontWeight: 500,
        align: 'left',
      },
      {
        id: makeElementId('attribution-1'),
        type: 'text',
        box: { x: 80, y: 340, w: 380, h: 40, z: 2 },
        content: runOf('— A happy customer'),
        role: 'label',
        fontSize: 14,
        fontWeight: 400,
        align: 'left',
      },
      {
        id: makeElementId('quote-2'),
        type: 'text',
        box: { x: 530, y: 120, w: 380, h: 200, z: 2 },
        content: runOf('Shipped on the same afternoon I signed up.'),
        role: 'body',
        fontSize: 22,
        fontWeight: 500,
        align: 'left',
      },
      {
        id: makeElementId('attribution-2'),
        type: 'text',
        box: { x: 530, y: 340, w: 380, h: 40, z: 2 },
        content: runOf('— Another satisfied user'),
        role: 'label',
        fontSize: 14,
        fontWeight: 400,
        align: 'left',
      },
      {
        id: makeElementId('quote-3'),
        type: 'text',
        box: { x: 980, y: 120, w: 380, h: 200, z: 2 },
        content: runOf('The canvas-first model just clicked.'),
        role: 'body',
        fontSize: 22,
        fontWeight: 500,
        align: 'left',
      },
      {
        id: makeElementId('attribution-3'),
        type: 'text',
        box: { x: 980, y: 340, w: 380, h: 40, z: 2 },
        content: runOf('— Yet another fan'),
        role: 'label',
        fontSize: 14,
        fontWeight: 400,
        align: 'left',
      },
    ],
  };
}

function buildVideoHero(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'Watch it in motion.');
  const heroId = pickHero(input);
  return {
    id: makeSectionId('video-hero'),
    recipeId: 'video-hero',
    name: 'Video hero',
    height: 760,
    backgroundEffect: 'grain',
    entrance: 'fade-up',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 80, y: 120, w: 600, h: 160, z: 3 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 56,
        fontWeight: 700,
        align: 'left',
      },
      {
        id: makeElementId('body'),
        type: 'text',
        box: { x: 80, y: 300, w: 540, h: 100, z: 3 },
        content: runOf('Show it, do not tell it.'),
        role: 'body',
        fontSize: 18,
        fontWeight: 400,
        align: 'left',
      },
      {
        id: makeElementId('video'),
        type: 'media',
        box: { x: 760, y: 80, w: 600, h: 600, z: 2 },
        // The hero asset id is conventionally an image (poster); when the
        // Owner uploads a real video the agent picks the video id. We mark
        // this as `image` because the registry's seed-hero-poster-1 is a
        // PNG; switching to video requires a real uploaded asset.
        mediaKind: 'image',
        assetId: heroId,
        alt: 'Hero video poster',
        fit: 'cover',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Custom passthrough — designer-saved sections that don't match a recipe.
// The agent never uses this; it exists to satisfy the Record<SectionRecipeId>
// exhaustiveness check.
// ---------------------------------------------------------------------------

function buildCustom(input: RecipeFactoryInput): CanvasSection {
  const headline = briefOr(input.brief, 'Custom section');
  return {
    id: makeSectionId('custom'),
    recipeId: 'custom',
    name: 'Custom',
    height: 600,
    backgroundEffect: 'none',
    entrance: 'fade-up',
    elements: [
      {
        id: makeElementId('heading'),
        type: 'text',
        box: { x: 80, y: 120, w: 800, h: 100, z: 2 },
        content: runOf(headline),
        role: 'heading',
        fontSize: 44,
        fontWeight: 600,
        align: 'left',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Registry + entry point
// ---------------------------------------------------------------------------

export const RECIPE_REGISTRY: Record<SectionRecipeId, RecipeFactory> = {
  'hero-split': buildHeroSplit,
  'feature-grid': buildFeatureGrid,
  'gallery-strip': buildGalleryStrip,
  'cta-band': buildCtaBand,
  'logo-strip': buildLogoStrip,
  'testimonial-row': buildTestimonialRow,
  'video-hero': buildVideoHero,
  custom: buildCustom,
};

// Compile-time check: every SectionRecipeId has exactly one factory.
const _RECIPE_REGISTRY_KEYS_MATCH: ReadonlyArray<SectionRecipeId> = SECTION_RECIPE_IDS;
void _RECIPE_REGISTRY_KEYS_MATCH;

// Compile-time check: AGENT_RECIPE_IDS is a subset of SECTION_RECIPE_IDS.
const _AGENT_IDS_SUBSET: ReadonlyArray<SectionRecipeId> = AGENT_RECIPE_IDS;
void _AGENT_IDS_SUBSET;

export function createSectionFromRecipe(
  recipeId: SectionRecipeId,
  input: RecipeFactoryInput,
): CanvasSection {
  const factory = RECIPE_REGISTRY[recipeId];
  if (!factory) {
    // SECTION_RECIPE_IDS narrows the type, but a stray cast at the boundary
    // could still feed us an unknown id. Fail loud — no silent fallback.
    throw new Error(
      `createSectionFromRecipe: unknown recipeId ${JSON.stringify(recipeId)} (must be one of [${SECTION_RECIPE_IDS.join(', ')}])`,
    );
  }
  return factory(input);
}
