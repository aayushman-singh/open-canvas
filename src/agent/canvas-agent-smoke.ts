// src/agent/canvas-agent-smoke.ts
//
// Pure smoke for the canvas-agent T7 pieces. Exercises:
//   - Every recipe factory in RECIPE_REGISTRY produces a CanvasSection that
//     passes validateCanvasSiteState when wrapped in a single-page state.
//   - createSectionFromRecipe throws on an unknown recipe id.
//   - applyCanvasAgentOp handles each of the three op kinds (rewriteText,
//     replaceMedia, insertSection) and rejects ill-formed inputs loudly.
//   - CANVAS_AGENT_TOOLS exposes well-formed JsonSchema bodies with the
//     correct enums (recipe ids, mark types).
//
// The smoke does NOT call the live LLM; everything here is pure and runs
// without GEMINI_API_KEY / DATABASE_URL. The route shell is exercised by
// review-smoke.ts.

import { applyCanvasAgentOp, type CanvasAgentOp } from './canvas-ops.js';
import { CANVAS_AGENT_TOOLS } from './canvas-tools.js';
import {
  RECIPE_REGISTRY,
  createSectionFromRecipe,
  type RecipeFactoryInput,
} from '../canvas/recipes.js';
import {
  INLINE_MARK_TYPES,
  SECTION_RECIPE_IDS,
  type CanvasSiteState,
  type SectionRecipeId,
} from '../canvas/schema.js';
import { validateCanvasSiteState } from '../canvas/validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Recipe factories cover every SECTION_RECIPE_IDS entry.
// ---------------------------------------------------------------------------

const registryKeys = Object.keys(RECIPE_REGISTRY).sort() as SectionRecipeId[];
const expectedKeys = [...SECTION_RECIPE_IDS].sort();
assert(
  registryKeys.length === expectedKeys.length &&
    registryKeys.every((k, i) => k === expectedKeys[i]),
  `RECIPE_REGISTRY keys mismatch — got [${registryKeys.join(', ')}], expected [${expectedKeys.join(', ')}]`,
);

// ---------------------------------------------------------------------------
// Each factory produces output that passes validateCanvasSiteState when
// slotted into a single-page state.
// ---------------------------------------------------------------------------

function singlePageStateAround(...recipeIds: SectionRecipeId[]): CanvasSiteState {
  const input: RecipeFactoryInput = {
    brief: 'Smoke brief — keep it short.',
    styleKit: 'charcoal',
    assetIds: {},
  };
  const sections = recipeIds.map((id) => createSectionFromRecipe(id, input));
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'home',
        title: 'Smoke',
        width: 1440,
        sections,
      },
    ],
  };
}

for (const recipeId of SECTION_RECIPE_IDS) {
  const state = singlePageStateAround(recipeId);
  const result = validateCanvasSiteState(state);
  assert(
    result.valid,
    result.valid
      ? ''
      : `recipe ${recipeId} produced an invalid section: ${result.errors.join('; ')}`,
  );
}

// Unknown recipe id → loud throw.
let threwOnUnknown = false;
try {
  createSectionFromRecipe('not-a-real-recipe' as SectionRecipeId, {
    brief: 'irrelevant',
    styleKit: 'charcoal',
  });
} catch (err) {
  threwOnUnknown =
    err instanceof Error && err.message.includes('not-a-real-recipe');
}
assert(threwOnUnknown, 'expected createSectionFromRecipe to throw loud on an unknown recipe id');

// ---------------------------------------------------------------------------
// applyCanvasAgentOp — each of the three op kinds against a known fixture.
// ---------------------------------------------------------------------------

const baseState: CanvasSiteState = singlePageStateAround('hero-split');
const basePage = baseState.pages[0];
if (!basePage) throw new Error('smoke base state lost its page');
const baseSection = basePage.sections[0];
if (!baseSection) throw new Error('smoke base section missing');
const textElement = baseSection.elements.find((e) => e.type === 'text');
if (!textElement) throw new Error('smoke base section must have a text element');
const mediaElement = baseSection.elements.find((e) => e.type === 'media');
if (!mediaElement) throw new Error('smoke base section must have a media element');

// 1. rewriteText: swap the heading content.
const rewriteOp: CanvasAgentOp = {
  kind: 'rewriteText',
  elementId: textElement.id,
  content: [
    { text: 'Brand new ' },
    { text: 'lived-in', marks: [{ type: 'bold' }] },
    { text: ' headline.' },
  ],
};
const afterRewrite = applyCanvasAgentOp(baseState, rewriteOp);
const rewriteValidation = validateCanvasSiteState(afterRewrite);
assert(
  rewriteValidation.valid,
  rewriteValidation.valid
    ? ''
    : `rewriteText apply produced invalid state: ${rewriteValidation.errors.join('; ')}`,
);
const rewrittenSection = afterRewrite.pages[0]?.sections[0];
const rewrittenElement = rewrittenSection?.elements.find((e) => e.id === textElement.id);
assert(
  rewrittenElement !== undefined &&
    rewrittenElement.type === 'text' &&
    rewrittenElement.content.length === 3 &&
    rewrittenElement.content[1]?.text === 'lived-in',
  'expected rewriteText to overwrite the text element content',
);
// Source state must not be mutated.
const sourceTextStill = baseSection.elements.find((e) => e.id === textElement.id);
assert(
  sourceTextStill !== undefined &&
    sourceTextStill.type === 'text' &&
    JSON.stringify(sourceTextStill.content) !== JSON.stringify(rewriteOp.content),
  'expected applyCanvasAgentOp to leave the source state untouched (rewriteText)',
);

// rewriteText with a string content → loud throw.
let rewriteStringThrew = false;
try {
  applyCanvasAgentOp(baseState, {
    kind: 'rewriteText',
    elementId: textElement.id,
    // Force the bad shape past TS via a structural cast.
    content: 'just a plain string' as unknown as CanvasAgentOp extends {
      kind: 'rewriteText';
      content: infer T;
    }
      ? T
      : never,
  });
} catch (err) {
  rewriteStringThrew = err instanceof Error && err.message.includes('InlineRun[]');
}
assert(
  rewriteStringThrew,
  'expected applyCanvasAgentOp to throw when rewriteText content is a plain string',
);

// rewriteText against an unknown element → loud throw.
let rewriteUnknownThrew = false;
try {
  applyCanvasAgentOp(baseState, {
    kind: 'rewriteText',
    elementId: 'definitely-not-here',
    content: [{ text: 'x' }],
  });
} catch (err) {
  rewriteUnknownThrew =
    err instanceof Error && err.message.includes('definitely-not-here');
}
assert(rewriteUnknownThrew, 'expected rewriteText against an unknown id to throw');

// 2. replaceMedia: swap an existing media element's id.
const replaceOp: CanvasAgentOp = {
  kind: 'replaceMedia',
  elementId: mediaElement.id,
  mediaKind: 'image',
  assetId: 'up-smoke-asset-1',
  alt: 'replaced alt',
};
const afterReplace = applyCanvasAgentOp(baseState, replaceOp);
const replaceValidation = validateCanvasSiteState(afterReplace);
assert(
  replaceValidation.valid,
  replaceValidation.valid
    ? ''
    : `replaceMedia apply produced invalid state: ${replaceValidation.errors.join('; ')}`,
);
const replacedSection = afterReplace.pages[0]?.sections[0];
const replacedElement = replacedSection?.elements.find((e) => e.id === mediaElement.id);
assert(
  replacedElement !== undefined &&
    replacedElement.type === 'media' &&
    replacedElement.assetId === 'up-smoke-asset-1' &&
    replacedElement.alt === 'replaced alt',
  'expected replaceMedia to overwrite assetId/alt',
);

// replaceMedia against a text element → loud throw.
let replaceWrongTypeThrew = false;
try {
  applyCanvasAgentOp(baseState, {
    kind: 'replaceMedia',
    elementId: textElement.id,
    mediaKind: 'image',
    assetId: 'up-x',
    alt: 'x',
  });
} catch (err) {
  replaceWrongTypeThrew = err instanceof Error && err.message.includes('expected media');
}
assert(
  replaceWrongTypeThrew,
  'expected replaceMedia against a text element to throw with expected-media message',
);

// 3. insertSection: append a feature-grid after the hero.
const insertOp: CanvasAgentOp = {
  kind: 'insertSection',
  afterSectionId: baseSection.id,
  recipeId: 'feature-grid',
  input: { brief: 'Three reasons.', styleKit: 'charcoal' },
};
const afterInsert = applyCanvasAgentOp(baseState, insertOp);
const insertValidation = validateCanvasSiteState(afterInsert);
assert(
  insertValidation.valid,
  insertValidation.valid
    ? ''
    : `insertSection apply produced invalid state: ${insertValidation.errors.join('; ')}`,
);
const insertedPage = afterInsert.pages[0];
assert(
  insertedPage !== undefined && insertedPage.sections.length === 2,
  'expected insertSection to add exactly one section',
);
assert(
  insertedPage?.sections[1]?.recipeId === 'feature-grid',
  'expected inserted section to be a feature-grid',
);

// insertSection with null afterSectionId → appended at end.
const insertAppendOp: CanvasAgentOp = {
  kind: 'insertSection',
  afterSectionId: null,
  recipeId: 'cta-band',
  input: { brief: 'Closer.', styleKit: 'charcoal' },
};
const afterAppend = applyCanvasAgentOp(baseState, insertAppendOp);
assert(
  afterAppend.pages[0]?.sections.length === 2 &&
    afterAppend.pages[0].sections[1]?.recipeId === 'cta-band',
  'expected null afterSectionId to append the new section',
);

// insertSection with unknown afterSectionId → throws.
let insertUnknownAfterThrew = false;
try {
  applyCanvasAgentOp(baseState, {
    kind: 'insertSection',
    afterSectionId: 'sec-not-here',
    recipeId: 'cta-band',
    input: { brief: 'Closer.', styleKit: 'charcoal' },
  });
} catch (err) {
  insertUnknownAfterThrew =
    err instanceof Error && err.message.includes('sec-not-here');
}
assert(
  insertUnknownAfterThrew,
  'expected insertSection with unknown afterSectionId to throw',
);

// ---------------------------------------------------------------------------
// CANVAS_AGENT_TOOLS — schema sanity (well-formed JSON-Schema bodies).
// ---------------------------------------------------------------------------

const toolNames = CANVAS_AGENT_TOOLS.map((t) => t.name).sort();
assert(
  JSON.stringify(toolNames) === JSON.stringify(['createSection', 'replaceMedia', 'rewriteText']),
  `expected CANVAS_AGENT_TOOLS to expose [createSection, replaceMedia, rewriteText] (got [${toolNames.join(', ')}])`,
);

const createSectionTool = CANVAS_AGENT_TOOLS.find((t) => t.name === 'createSection');
assert(createSectionTool !== undefined, 'createSection tool must exist');
const recipeIdEnum = createSectionTool?.parameters.properties?.recipeId?.enum;
assert(
  Array.isArray(recipeIdEnum) &&
    recipeIdEnum.length === SECTION_RECIPE_IDS.length &&
    [...SECTION_RECIPE_IDS].every((id) => recipeIdEnum.includes(id)),
  `expected createSection.recipeId.enum to list every SECTION_RECIPE_IDS entry`,
);

const rewriteTool = CANVAS_AGENT_TOOLS.find((t) => t.name === 'rewriteText');
const contentItems = rewriteTool?.parameters.properties?.content?.items;
assert(
  contentItems !== undefined &&
    contentItems.type === 'object' &&
    contentItems.properties !== undefined &&
    typeof contentItems.properties.text === 'object',
  'expected rewriteText.content.items to be an object schema with a text property',
);
const markEnum = contentItems?.properties?.marks?.items?.properties?.type?.enum;
assert(
  Array.isArray(markEnum) &&
    markEnum.length === INLINE_MARK_TYPES.length &&
    [...INLINE_MARK_TYPES].every((m) => markEnum.includes(m)),
  'expected rewriteText mark.type.enum to list every INLINE_MARK_TYPES entry',
);

const replaceTool = CANVAS_AGENT_TOOLS.find((t) => t.name === 'replaceMedia');
assert(
  replaceTool?.parameters.properties?.assetId?.type === 'string',
  'expected replaceMedia.assetId to be a string in its schema',
);
assert(
  replaceTool !== undefined && replaceTool.description.includes('does NOT generate media bytes'),
  'expected replaceMedia description to flag that the tool does not generate media',
);

console.log('[canvas-agent:smoke] OK');
