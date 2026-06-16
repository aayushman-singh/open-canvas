// src/agent/canvas-agent-smoke.ts
//
// Pure smoke for the canvas-agent T7 pieces. Exercises:
//   - Every recipe factory in RECIPE_REGISTRY produces a CanvasSection that
//     passes validateEditableSite when wrapped in a single-page state.
//   - createSectionFromRecipe throws on an unknown recipe id.
//   - applyCanvasAgentOp handles each of the three op kinds (rewriteText,
//     replaceMedia, insertSection) and rejects ill-formed inputs loudly.
//   - CANVAS_AGENT_TOOLS exposes well-formed JsonSchema bodies with the
//     correct enums (recipe ids, mark types).
//
// The smoke does NOT call the live LLM; everything here is pure and runs
// without GEMINI_API_KEY / DATABASE_URL. The route shell is exercised by
// review-smoke.ts.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyCanvasAgentOp, resolveDesignOp, type CanvasAgentOp } from './canvas-ops.js';
import { CANVAS_AGENT_TOOLS } from './canvas-tools.js';
import {
  RECIPE_REGISTRY,
  createSectionFromRecipe,
  type RecipeFactoryInput,
} from '../canvas/recipes.js';
import {
  INLINE_MARK_TYPES,
  SECTION_RECIPE_IDS,
  type CanvasElement,
  type EditableSite,
  type SectionRecipeId,
} from '../canvas/schema.js';
import { STYLE_KIT_PRESETS } from '../canvas/style-kits.js';
import { validateEditableSite } from '../canvas/validate.js';
import type { DesignSectionInput } from '../canvas/layout/tree.js';
import { parseDesignSectionToolArgs } from './design-section-parser.js';
import { parseApplyOp, translateToolCall } from './tool-parsers.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const canvasAgentRouteSource = readFileSync(
  join(process.cwd(), 'src', 'routes', 'api', 'canvas-agent.ts'),
  'utf8',
);
assert(
  canvasAgentRouteSource.includes(
    "setSiteConfig — set visitorTheme ('light' | 'dark' | 'toggleable')",
  ),
  'preview/apply route prompt must tell the model to use visitorTheme',
);
assert(
  !canvasAgentRouteSource.includes('setSiteConfig — toggle darkModeEnabled'),
  'preview/apply route prompt must not mention legacy darkModeEnabled',
);
assert(
  canvasAgentRouteSource.includes('CHAT_DEFAULT_MODEL') &&
    !canvasAgentRouteSource.includes('gemini-2.5-flash'),
  'canvas-agent route must use the chat orchestrator primary model constant instead of pinning a separate all-flows Flash override',
);

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
// Each factory produces output that passes validateEditableSite when
// slotted into a single-page state.
// ---------------------------------------------------------------------------

function singlePageStateAround(...recipeIds: SectionRecipeId[]): EditableSite {
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
  const result = validateEditableSite(state);
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
  threwOnUnknown = err instanceof Error && err.message.includes('not-a-real-recipe');
}
assert(threwOnUnknown, 'expected createSectionFromRecipe to throw loud on an unknown recipe id');

// ---------------------------------------------------------------------------
// applyCanvasAgentOp — each of the three op kinds against a known fixture.
// ---------------------------------------------------------------------------

const baseState: EditableSite = singlePageStateAround('hero-split');
const basePage = baseState.pages[0];
if (!basePage) throw new Error('smoke base state lost its page');
const baseSection = basePage.sections[0];
if (!baseSection) throw new Error('smoke base section missing');
const textElement = baseSection.elements.find((e) => e.type === 'text');
if (!textElement) throw new Error('smoke base section must have a text element');
const mediaElement = baseSection.elements.find((e) => e.type === 'media');
if (!mediaElement) throw new Error('smoke base section must have a media element');

function flowContainerWithHosted(element: CanvasElement): CanvasElement {
  return {
    id: 'el-flow-host',
    type: 'flow-container',
    box: { x: 40, y: 40, w: 640, h: 240, z: 1 },
    layout: {
      mode: 'grid',
      columns: 1,
      gap: { row: 12, column: 12 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
    },
    items: [{ id: 'flow-item', element }],
  };
}

function singleFlowSectionState(element: CanvasElement): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-flow-agent',
        slug: 'flow-agent',
        title: 'Flow Agent',
        width: 1200,
        sections: [
          {
            id: 'section-flow-agent',
            recipeId: 'custom',
            name: 'Flow Agent',
            height: 560,
            elements: [flowContainerWithHosted(element)],
          },
        ],
      },
    ],
  };
}

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
const rewriteValidation = validateEditableSite(afterRewrite);
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
  rewriteUnknownThrew = err instanceof Error && err.message.includes('definitely-not-here');
}
assert(rewriteUnknownThrew, 'expected rewriteText against an unknown id to throw');

// rewriteText can target Flow-hosted text children by element id.
{
  const hostedText: CanvasElement = {
    id: 'el-flow-hosted-text',
    type: 'text',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    role: 'body',
    align: 'left',
    fontSize: 16,
    fontWeight: 400,
    content: [{ text: 'Hosted before' }],
  };
  const afterHostedRewrite = applyCanvasAgentOp(singleFlowSectionState(hostedText), {
    kind: 'rewriteText',
    elementId: hostedText.id,
    content: [{ text: 'Hosted after' }],
  });
  const validation = validateEditableSite(afterHostedRewrite);
  assert(
    validation.valid,
    validation.valid
      ? ''
      : `Flow-hosted rewriteText produced invalid state: ${validation.errors.join('; ')}`,
  );
  const flow = afterHostedRewrite.pages[0]?.sections[0]?.elements[0];
  assert(
    flow?.type === 'flow-container' &&
      flow.items[0]?.element.type === 'text' &&
      flow.items[0].element.content[0]?.text === 'Hosted after',
    'rewriteText must update Flow-hosted text children',
  );
}

// 2. replaceMedia: swap an existing media element's id.
const replaceOp: CanvasAgentOp = {
  kind: 'replaceMedia',
  elementId: mediaElement.id,
  mediaKind: 'image',
  assetId: 'up-smoke-asset-1',
  alt: 'replaced alt',
};
const afterReplace = applyCanvasAgentOp(baseState, replaceOp);
const replaceValidation = validateEditableSite(afterReplace);
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

// duplicateSection must remap nested Flow-hosted element ids.
{
  const source = singleFlowSectionState({
    id: 'el-flow-duplicate-text',
    type: 'text',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    role: 'body',
    align: 'left',
    fontSize: 16,
    fontWeight: 400,
    content: [{ text: 'Clone me' }],
  });
  const duplicated = applyCanvasAgentOp(source, {
    kind: 'duplicateSection',
    sectionId: 'section-flow-agent',
  });
  const validation = validateEditableSite(duplicated);
  assert(
    validation.valid,
    validation.valid
      ? ''
      : `duplicateSection must remap Flow-hosted ids: ${validation.errors.join('; ')}`,
  );
  const originalFlow = duplicated.pages[0]?.sections[0]?.elements[0];
  const cloneFlow = duplicated.pages[0]?.sections[1]?.elements[0];
  assert(
    originalFlow?.type === 'flow-container' &&
      cloneFlow?.type === 'flow-container' &&
      originalFlow.items[0]?.element.id !== cloneFlow.items[0]?.element.id,
    'duplicateSection clone must not preserve Flow-hosted element ids',
  );
}

// deletePage rewrites action links hosted inside Flow Items before validation.
{
  const source = singleFlowSectionState({
    id: 'el-flow-page-action',
    type: 'action',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    label: [{ text: 'Go target' }],
    href: { type: 'page', pageId: 'page-target' },
    variant: 'solid',
  });
  source.pages.push({
    id: 'page-target',
    slug: 'target',
    title: 'Target',
    width: 1200,
    sections: [
      { id: 'section-target', recipeId: 'custom', name: 'Target', height: 480, elements: [] },
    ],
  });
  const afterDelete = applyCanvasAgentOp(source, { kind: 'deletePage', pageId: 'page-target' });
  const validation = validateEditableSite(afterDelete);
  assert(
    validation.valid,
    validation.valid
      ? ''
      : `deletePage must rewrite Flow-hosted page links: ${validation.errors.join('; ')}`,
  );
  const flow = afterDelete.pages[0]?.sections[0]?.elements[0];
  const hostedAction = flow?.type === 'flow-container' ? flow.items[0]?.element : undefined;
  const hostedHref = hostedAction?.type === 'action' ? hostedAction.href : undefined;
  assert(
    hostedHref?.type === 'external' && hostedHref.url === '#',
    'deletePage must rewrite Flow-hosted action hrefs to #',
  );
}

// 3. insertSection: append a feature-grid after the hero.
const insertOp: CanvasAgentOp = {
  kind: 'insertSection',
  afterSectionId: baseSection.id,
  recipeId: 'feature-grid',
  input: { brief: 'Three reasons.', styleKit: 'charcoal' },
};
const afterInsert = applyCanvasAgentOp(baseState, insertOp);
const insertValidation = validateEditableSite(afterInsert);
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
  insertUnknownAfterThrew = err instanceof Error && err.message.includes('sec-not-here');
}
assert(insertUnknownAfterThrew, 'expected insertSection with unknown afterSectionId to throw');

// insertSection with pageId -> targets that page, not pages[0].
const insertPagedState: EditableSite = {
  ...baseState,
  pages: [
    baseState.pages[0]!,
    {
      id: 'page-pricing',
      title: 'Pricing',
      slug: 'pricing',
      description: '',
      width: baseState.pages[0]!.width,
      sections: [],
    },
  ],
};
const afterPagedInsert = applyCanvasAgentOp(insertPagedState, {
  kind: 'insertSection',
  pageId: 'page-pricing',
  afterSectionId: null,
  recipeId: 'cta-band',
  input: { brief: 'Pricing closer.', styleKit: 'charcoal' },
});
assert(
  afterPagedInsert.pages[0]?.sections.length === 1,
  'expected insertSection with pageId to leave the first page untouched',
);
assert(
  afterPagedInsert.pages[1]?.sections.length === 1 &&
    afterPagedInsert.pages[1].sections[0]?.recipeId === 'cta-band',
  'expected insertSection with pageId to append the new section on the named page',
);

// ---------------------------------------------------------------------------
// CANVAS_AGENT_TOOLS — schema sanity (well-formed JSON-Schema bodies).
// ---------------------------------------------------------------------------

const expectedCanvasToolNames = [
  'addElement',
  'addPage',
  'deleteElement',
  'deletePage',
  'deleteSection',
  'designSection',
  'duplicateSection',
  'moveSection',
  'renameToken',
  'replaceMedia',
  'rewriteText',
  'setSiteConfig',
  'setStyleKit',
  'updateElement',
  'updatePage',
  'updateSection',
].sort();
const toolNames = CANVAS_AGENT_TOOLS.map((t) => t.name).sort();
assert(
  JSON.stringify(toolNames) === JSON.stringify(expectedCanvasToolNames),
  `expected CANVAS_AGENT_TOOLS to expose every mutating tool (got [${toolNames.join(', ')}])`,
);

const createSectionTool = CANVAS_AGENT_TOOLS.find((t) => t.name === 'createSection');
assert(
  createSectionTool === undefined,
  'createSection must not be exposed to the model; designSection is the section creation tool',
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

// designSection tool schema
const designTool = CANVAS_AGENT_TOOLS.find((t) => t.name === 'designSection');
assert(designTool !== undefined, 'designSection tool must exist');
assert(
  designTool?.parameters.properties?.layout !== undefined,
  'designSection must have a layout parameter',
);
assert(
  designTool?.parameters.properties?.sectionName !== undefined,
  'designSection must have a sectionName parameter',
);

// designSection parser rejects invalid model output loudly instead of
// substituting defaults that hide broken tool calls.
const validDesignArgs = {
  sectionName: 'Strict parser',
  layout: {
    type: 'stack',
    direction: 'column',
    children: [
      {
        element: {
          type: 'text',
          text: {
            content: 'Hello',
            role: 'heading',
            color: 'text',
            font: 'display',
            size: 32,
          },
        },
      },
    ],
  },
};
const parsedValidDesign = parseDesignSectionToolArgs(validDesignArgs);
assert(
  parsedValidDesign.ok && parsedValidDesign.input.sectionName === 'Strict parser',
  'expected parseDesignSectionToolArgs to accept a complete designSection payload',
);

const toolArgsByName: Record<string, Record<string, unknown>> = {
  rewriteText: {
    elementId: 'el-text',
    content: [{ text: 'Updated copy' }],
  },
  replaceMedia: {
    elementId: 'el-media',
    mediaKind: 'image',
    assetId: 'asset-1',
    alt: 'Updated alt',
  },
  designSection: {
    sectionName: 'Strict parser',
    afterSectionId: '',
    layout: {
      type: 'stack',
      direction: 'column',
      children: [
        validDesignArgs.layout.children[0],
        {
          element: {
            type: 'action',
            action: { label: 'Start', variant: 'solid', href: '/start' },
          },
        },
      ],
    },
  },
  deleteElement: {
    elementId: 'el-delete',
  },
  updateElement: {
    elementId: 'el-update',
    elementType: 'text',
    box: { x: 10, y: 20, w: 300, h: 80 },
    content: [{ text: 'Nested patch must survive apply parsing' }],
    role: 'heading',
    fontSize: 32,
  },
  addElement: {
    sectionId: 'sec-target',
    elementType: 'action',
    box: { x: 40, y: 80, w: 180, h: 48 },
    label: 'Start',
    href: { type: 'external', url: '/start' },
    variant: 'solid',
  },
  updateSection: {
    sectionId: 'sec-target',
    name: 'Renamed section',
    height: 640,
    backgroundEffect: 'grain',
    entrance: 'fade-up',
  },
  deleteSection: {
    sectionId: 'sec-delete',
  },
  moveSection: {
    sectionId: 'sec-move',
    afterSectionId: '',
  },
  duplicateSection: {
    sectionId: 'sec-copy',
  },
  addPage: {
    title: 'About',
    slug: 'about',
  },
  updatePage: {
    pageId: 'page-home',
    title: 'Home updated',
    slug: 'home',
    description: 'Updated description',
    noIndex: true,
    tags: ['launch', 'news'],
  },
  deletePage: {
    pageId: 'page-old',
  },
  setStyleKit: {
    styleKit: 'blue-saas',
  },
  setSiteConfig: {
    visitorTheme: 'toggleable',
    defaultLocale: 'en',
    siteNoIndex: true,
  },
  renameToken: {
    from: 'Apogee',
    to: 'Briar',
  },
};

for (const name of expectedCanvasToolNames) {
  const args = toolArgsByName[name];
  assert(args !== undefined, `test fixture missing args for tool ${name}`);

  const parsed = translateToolCall({
    id: `${name}-smoke`,
    name,
    arguments: args,
  });
  if (!parsed.ok) {
    throw new Error(`expected translateToolCall(${name}) to parse: ${parsed.error}`);
  }

  const reparsed = parseApplyOp(parsed.op, 'charcoal');
  if (!reparsed.ok) {
    throw new Error(`expected parseApplyOp(${name}) to parse normalized op: ${reparsed.error}`);
  }
  assert(
    JSON.stringify(reparsed.op) === JSON.stringify(parsed.op),
    `expected parseApplyOp(${name}) to preserve the normalized preview op`,
  );
}

// ---------------------------------------------------------------------------
// renameToken applier — site-wide find-and-replace coverage.
//
// Pins that the walker reaches every visible surface: text content (flat
// + rich-text), action labels, media alt, page titles, header/footer
// elements, AND nested tab-panel / collection-entry elements.
// ---------------------------------------------------------------------------

const renameFixture: EditableSite = {
  styleKit: 'charcoal',
  header: {
    id: 'sec-hdr',
    name: 'Header',
    height: 80,
    recipeId: 'custom',
    elements: [
      {
        id: 'el-hdr-logo',
        type: 'text',
        box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
        role: 'heading',
        align: 'left',
        fontSize: 24,
        fontWeight: 700,
        content: [{ text: 'Apogee' }],
      },
    ],
  },
  pages: [
    {
      id: 'page-home',
      slug: 'index',
      title: 'Apogee — the modern web platform',
      width: 1440,
      sections: [
        {
          id: 'sec-hero',
          name: 'Hero',
          height: 600,
          recipeId: 'custom',
          elements: [
            {
              id: 'el-headline',
              type: 'text',
              box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
              role: 'heading',
              align: 'left',
              fontSize: 40,
              fontWeight: 700,
              content: [
                { text: 'Build with Apogee, ship faster' },
                { text: 'Apogee', marks: [{ type: 'bold' }] },
              ],
            },
            {
              id: 'el-action',
              type: 'action',
              box: { x: 0, y: 80, w: 200, h: 48, z: 2 },
              variant: 'solid',
              label: [{ text: 'Start with Apogee' }],
              href: { type: 'external', url: 'https://example.com' },
            },
            {
              id: 'el-media',
              type: 'media',
              box: { x: 700, y: 0, w: 480, h: 320, z: 1 },
              mediaKind: 'image',
              assetId: 'asset-1',
              alt: 'Apogee dashboard screenshot',
              fit: 'cover',
            },
          ],
        },
      ],
    },
  ],
};

const renamed = applyCanvasAgentOp(renameFixture, {
  kind: 'renameToken',
  from: 'Apogee',
  to: 'Briar',
});

assert(
  renamed.header?.elements[0]?.type === 'text' &&
    (renamed.header.elements[0].content as Array<{ text: string }>)[0]?.text === 'Briar',
  'renameToken must rewrite header text element content',
);
assert(
  renamed.pages[0]?.title === 'Briar — the modern web platform',
  'renameToken must rewrite page title',
);
const renamedHero = renamed.pages[0]?.sections[0]?.elements;
const renamedHeadlineRuns = (renamedHero?.[0] as { content: Array<{ text: string }> }).content;
assert(
  renamedHeadlineRuns[0]?.text === 'Build with Briar, ship faster' &&
    renamedHeadlineRuns[1]?.text === 'Briar',
  'renameToken must rewrite every inline run in a multi-run text element',
);
const renamedAction = renamedHero?.[1] as { label: Array<{ text: string }> };
assert(
  renamedAction.label[0]?.text === 'Start with Briar',
  'renameToken must rewrite action label inline runs',
);
const renamedMedia = renamedHero?.[2] as { alt: string };
assert(
  renamedMedia.alt === 'Briar dashboard screenshot',
  'renameToken must rewrite media alt text',
);

const ciFixture: EditableSite = {
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-1',
      slug: 'index',
      title: 'Page',
      width: 1440,
      sections: [
        {
          id: 's',
          name: 'S',
          height: 100,
          recipeId: 'custom',
          elements: [
            {
              id: 't',
              type: 'text',
              box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
              role: 'heading',
              align: 'left',
              fontSize: 24,
              fontWeight: 600,
              content: [{ text: 'apogee APOGEE Apogee aPogeE' }],
            },
          ],
        },
      ],
    },
  ],
};
const ciRenamed = applyCanvasAgentOp(ciFixture, {
  kind: 'renameToken',
  from: 'Apogee',
  to: 'Briar',
  caseSensitive: false,
});
const ciContent = (
  ciRenamed.pages[0]?.sections[0]?.elements[0] as { content: Array<{ text: string }> }
).content;
assert(
  ciContent[0]?.text === 'Briar Briar Briar Briar',
  'renameToken caseSensitive:false must replace all casings with the literal `to`',
);

// ---------------------------------------------------------------------------
// renameToken exhaustive coverage — every element type with a string-bearing
// field is exercised; the post-rename JSON must contain zero "Apogee"
// residues. The fixture deliberately avoids the token in any id / recipeId /
// asset id (only visitor- or owner-visible fields carry the brand), so a
// plain JSON.stringify check is a tight regression guard against silent
// walker drift when new element types ship.
// ---------------------------------------------------------------------------

const exhaustiveFixture = {
  styleKit: 'charcoal',
  header: {
    id: 'sec-hdr-x',
    name: 'Apogee header',
    height: 80,
    recipeId: 'custom',
    elements: [
      {
        id: 'el-nav',
        type: 'nav',
        box: { x: 0, y: 0, w: 1440, h: 80, z: 1 },
        layout: 'logo-left-links-right',
        siteTitle: 'Apogee',
        links: [
          { label: 'Apogee solutions', href: '#sol', kind: 'external' },
          { label: 'Pricing', href: '#price', kind: 'external' },
        ],
        primaryAction: { label: 'Try Apogee', href: '#cta', kind: 'external' },
      },
    ],
  },
  footer: {
    id: 'sec-ftr-x',
    name: 'Apogee footer',
    height: 200,
    recipeId: 'custom',
    elements: [
      {
        id: 'el-foot-text',
        type: 'text',
        box: { x: 0, y: 0, w: 600, h: 40, z: 1 },
        role: 'body',
        align: 'left',
        fontSize: 14,
        fontWeight: 400,
        content: [{ text: 'Apogee Inc.' }],
      },
    ],
  },
  pages: [
    {
      id: 'page-coverage',
      slug: 'apogee-coverage',
      title: 'Apogee — exhaustive walker fixture',
      description: 'Marketing site for Apogee, the modern platform.',
      author: 'Apogee Editorial',
      category: 'Apogee Marketing',
      tags: ['Apogee', 'launch'],
      width: 1440,
      sections: [
        {
          id: 'sec-x',
          name: 'Apogee hero',
          height: 800,
          recipeId: 'custom',
          elements: [
            {
              id: 'el-text',
              type: 'text',
              box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
              role: 'heading',
              align: 'left',
              fontSize: 40,
              fontWeight: 700,
              content: [{ text: 'Apogee headline' }],
            },
            {
              id: 'el-action',
              type: 'action',
              box: { x: 0, y: 80, w: 200, h: 48, z: 2 },
              variant: 'solid',
              label: [{ text: 'Buy Apogee' }],
              href: { type: 'external', url: 'https://example.com' },
            },
            {
              id: 'el-media',
              type: 'media',
              box: { x: 0, y: 140, w: 480, h: 320, z: 1 },
              mediaKind: 'image',
              assetId: 'asset-1',
              alt: 'Apogee dashboard',
              fit: 'cover',
            },
            {
              id: 'el-embed',
              type: 'embed',
              box: { x: 0, y: 470, w: 480, h: 270, z: 1 },
              url: 'https://www.youtube.com/embed/abc',
              title: 'Apogee walkthrough',
            },
            {
              id: 'el-accordion',
              type: 'accordion',
              box: { x: 0, y: 750, w: 600, h: 200, z: 1 },
              allowMultipleOpen: false,
              items: [{ id: 'i1', title: 'What is Apogee?', body: [{ text: 'Apogee answer.' }] }],
            },
            {
              id: 'el-carousel',
              type: 'carousel',
              box: { x: 600, y: 0, w: 800, h: 400, z: 1 },
              mode: 'paginate',
              direction: 'horizontal',
              activeSlide: 0,
              slides: [
                { id: 's1', assetId: 'asset-2', caption: 'Apogee feature one' },
                { id: 's2', assetId: 'asset-3', caption: 'Apogee feature two' },
              ],
            },
            {
              id: 'el-form',
              type: 'form',
              box: { x: 0, y: 950, w: 600, h: 400, z: 1 },
              title: 'Apogee contact',
              submitLabel: 'Send to Apogee',
              successMessage: 'Thanks — Apogee team will reply.',
              fields: [
                {
                  id: 'f1',
                  kind: 'text',
                  name: 'name',
                  label: 'Apogee account name',
                  placeholder: 'Your Apogee handle',
                  required: true,
                },
                {
                  id: 'f2',
                  kind: 'select',
                  name: 'plan',
                  label: 'Plan',
                  required: false,
                  options: [
                    { value: 'free', label: 'Apogee Free' },
                    { value: 'pro', label: 'Apogee Pro' },
                  ],
                },
              ],
            },
            {
              id: 'el-table',
              type: 'table',
              box: { x: 600, y: 400, w: 800, h: 300, z: 1 },
              columns: [
                { id: 'c1', header: 'Apogee feature' },
                { id: 'c2', header: 'Available' },
              ],
              rows: [
                { id: 'r1', cells: { c1: 'Apogee AI', c2: 'Yes' } },
                { id: 'r2', cells: { c1: 'CMS', c2: 'Apogee-managed' } },
              ],
            },
            {
              id: 'el-chart',
              type: 'chart',
              box: { x: 600, y: 700, w: 800, h: 300, z: 1 },
              kind: 'bar',
              showLegend: true,
              series: [{ label: 'Apogee revenue', values: [1, 2, 3] }],
              categories: ['Apogee Q1', 'Apogee Q2', 'Apogee Q3'],
            },
            {
              id: 'el-tabs',
              type: 'tabs',
              box: { x: 0, y: 1350, w: 1440, h: 400, z: 1 },
              activeTabId: 't1',
              tabs: [
                {
                  id: 't1',
                  label: [{ text: 'About Apogee' }],
                  elements: [
                    {
                      id: 'el-tab-text',
                      type: 'text',
                      box: { x: 0, y: 0, w: 600, h: 60, z: 1 },
                      role: 'body',
                      align: 'left',
                      fontSize: 16,
                      fontWeight: 400,
                      content: [{ text: 'Apogee inside a tab.' }],
                    },
                  ],
                },
                {
                  id: 't2',
                  label: [{ text: 'Apogee FAQ' }],
                  elements: [],
                },
              ],
            },
            {
              id: 'el-collection-inline',
              type: 'collection',
              box: { x: 0, y: 1750, w: 1440, h: 400, z: 1 },
              templateBlueprint: 'card-3up',
              entries: [
                [
                  {
                    id: 'el-coll-text',
                    type: 'text',
                    box: { x: 0, y: 0, w: 400, h: 40, z: 1 },
                    role: 'body',
                    align: 'left',
                    fontSize: 14,
                    fontWeight: 400,
                    content: [{ text: 'Apogee inline collection text.' }],
                  },
                ],
              ],
            },
            {
              id: 'el-flow',
              type: 'flow-container',
              box: { x: 0, y: 2200, w: 900, h: 260, z: 1 },
              layout: {
                mode: 'grid',
                columns: 2,
                gap: { row: 16, column: 16 },
                padding: { top: 0, right: 0, bottom: 0, left: 0 },
                align: 'stretch',
                justify: 'start',
              },
              items: [
                {
                  id: 'flow-copy',
                  element: {
                    id: 'el-flow-text',
                    type: 'text',
                    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
                    role: 'body',
                    align: 'left',
                    fontSize: 14,
                    fontWeight: 400,
                    content: [{ text: 'Apogee inside Flow.' }],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as EditableSite;

const exhaustiveRenamed = applyCanvasAgentOp(exhaustiveFixture, {
  kind: 'renameToken',
  from: 'Apogee',
  to: 'Briar',
});

const exhaustiveJson = JSON.stringify(exhaustiveRenamed);
if (exhaustiveJson.includes('Apogee')) {
  // Surface every residue's path so a new element type with an uncovered
  // string field names the field rather than failing with a single "still
  // present" message. Walk the residues with a JSON path tracker.
  const residues: string[] = [];
  function track(value: unknown, path: string): void {
    if (typeof value === 'string') {
      if (value.includes('Apogee')) residues.push(`${path} = ${JSON.stringify(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) track(value[i], `${path}[${String(i)}]`);
      return;
    }
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value))
        track((value as Record<string, unknown>)[k], `${path}.${k}`);
    }
  }
  track(exhaustiveRenamed, '$');
  throw new Error(`renameToken exhaustive coverage failed — residues:\n  ${residues.join('\n  ')}`);
}

// Spot-check a handful of fields the JSON-stringify guard already covered;
// these stay as named asserts so a future regression points at the exact
// field that broke, not just the JSON sweep.
assert(
  (exhaustiveRenamed.header as { elements: Array<{ siteTitle?: string }> }).elements[0]
    ?.siteTitle === 'Briar',
  'renameToken must rewrite nav.siteTitle',
);
assert(
  exhaustiveRenamed.pages[0]?.description === 'Marketing site for Briar, the modern platform.',
  'renameToken must rewrite page.description',
);
const exhaustivePage = exhaustiveRenamed.pages[0] as unknown as { tags?: string[] };
assert(
  Array.isArray(exhaustivePage.tags) && exhaustivePage.tags[0] === 'Briar',
  'renameToken must rewrite page.tags entries',
);
assert(
  exhaustiveRenamed.pages[0]?.sections[0]?.name === 'Briar hero',
  'renameToken must rewrite section.name',
);

const malformedInsertPageId = parseApplyOp(
  {
    kind: 'insertSection',
    pageId: 42,
    afterSectionId: null,
    recipeId: 'cta-band',
    input: { brief: 'Pricing closer.', assetIds: {} },
  },
  'charcoal',
);
assert(
  !malformedInsertPageId.ok &&
    malformedInsertPageId.error.includes('createSection.pageId must be a non-empty string'),
  'expected parseApplyOp(insertSection) to reject malformed pageId loudly',
);
const malformedInsertAfterSectionId = parseApplyOp(
  {
    kind: 'insertSection',
    pageId: null,
    afterSectionId: 42,
    recipeId: 'cta-band',
    input: { brief: 'Pricing closer.', assetIds: {} },
  },
  'charcoal',
);
assert(
  !malformedInsertAfterSectionId.ok &&
    malformedInsertAfterSectionId.error.includes(
      'createSection.afterSectionId must be a non-empty string or null',
    ),
  'expected parseApplyOp(insertSection) to reject malformed afterSectionId loudly',
);

const styledState = structuredClone(baseState);
const styledText = styledState.pages[0]?.sections[0]?.elements.find(
  (element) => element.type === 'text',
);
if (styledText === undefined) {
  throw new Error('canvas-agent smoke fixture must include a text element');
}
styledText.elementStyle = { opacity: 0.5 };
const deleteElementStyleParsed = parseApplyOp(
  {
    kind: 'updateElement',
    elementId: styledText.id,
    elementType: 'text',
    patch: { __deleteFields: ['elementStyle'] },
  },
  'charcoal',
);
assert(
  deleteElementStyleParsed.ok,
  deleteElementStyleParsed.ok
    ? ''
    : `expected internal updateElement __deleteFields to parse: ${deleteElementStyleParsed.error}`,
);
if (deleteElementStyleParsed.ok) {
  const afterDeleteElementStyle = applyCanvasAgentOp(styledState, deleteElementStyleParsed.op);
  const afterStyledText = afterDeleteElementStyle.pages[0]?.sections[0]?.elements.find(
    (element) => element.id === styledText.id,
  );
  assert(
    afterStyledText !== undefined &&
      !Object.prototype.hasOwnProperty.call(afterStyledText, 'elementStyle'),
    'internal updateElement __deleteFields must delete optional element fields for chat revert',
  );
}

const restoreCustomTemplateParsed = parseApplyOp(
  {
    kind: 'restoreElement',
    sectionId: baseSection.id,
    parentKind: 'collection-custom-template',
    collectionElementId: 'collection-for-restore',
    index: 0,
    element: {
      id: 'restored-template-text',
      type: 'text',
      box: { x: 0, y: 0, w: 120, h: 40, z: 1 },
      content: [{ text: 'Restored' }],
      role: 'body',
      fontSize: 16,
      fontWeight: 400,
      align: 'left',
    },
  },
  'charcoal',
);
assert(
  restoreCustomTemplateParsed.ok,
  restoreCustomTemplateParsed.ok
    ? ''
    : `expected restoreElement(collection-custom-template) to parse for chat revert: ${restoreCustomTemplateParsed.error}`,
);

const addActionToolCall = translateToolCall({
  id: 'add-action-end-to-end',
  name: 'addElement',
  arguments: {
    sectionId: baseSection.id,
    elementType: 'action',
    label: 'Start',
    href: { type: 'external', url: '/start' },
    variant: 'solid',
  },
});
assert(
  addActionToolCall.ok,
  addActionToolCall.ok ? '' : `expected addElement action to parse: ${addActionToolCall.error}`,
);
const acceptedAddAction = addActionToolCall.ok
  ? parseApplyOp(addActionToolCall.op, 'charcoal')
  : null;
assert(
  acceptedAddAction?.ok === true,
  acceptedAddAction && !acceptedAddAction.ok
    ? `expected addElement action preview op to parse on apply: ${acceptedAddAction.error}`
    : 'expected addElement action preview op to parse on apply',
);
if (acceptedAddAction?.ok) {
  const withAction = applyCanvasAgentOp(baseState, acceptedAddAction.op);
  const addedValidation = validateEditableSite(withAction);
  assert(
    addedValidation.valid,
    addedValidation.valid
      ? ''
      : `addElement action preview op produced invalid state: ${addedValidation.errors.join('; ')}`,
  );
  const addedAction = withAction.pages[0]?.sections[0]?.elements.at(-1);
  assert(
    addedAction !== undefined &&
      addedAction.type === 'action' &&
      typeof addedAction.href === 'object' &&
      addedAction.href.type === 'external' &&
      addedAction.href.url === '/start',
    'expected addElement action to preserve an ActionHref object',
  );
}

const addFlowToolCall = translateToolCall({
  id: 'add-flow-rejected',
  name: 'addElement',
  arguments: {
    sectionId: baseSection.id,
    elementType: 'flow-container',
    layout: {
      mode: 'grid',
      columns: 2,
      gap: { row: 16, column: 16 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
    },
    items: [],
  },
});
assert(
  !addFlowToolCall.ok && addFlowToolCall.error.includes('flow-container'),
  addFlowToolCall.ok
    ? 'addElement must reject flow-container until hosted items have an agent creation contract'
    : `addElement flow-container rejection must name the unsupported type: ${addFlowToolCall.error}`,
);

const missingTextProps = parseDesignSectionToolArgs({
  sectionName: 'Bad text',
  layout: {
    type: 'stack',
    children: [{ element: { type: 'text' } }],
  },
});
assert(
  !missingTextProps.ok && missingTextProps.error.includes('element.text must be an object'),
  'expected designSection parser to reject text elements without text props',
);

const invalidToken = parseDesignSectionToolArgs({
  sectionName: 'Bad token',
  layout: {
    type: 'stack',
    children: [
      {
        element: {
          type: 'text',
          text: {
            content: 'Hello',
            role: 'heading',
            color: 'purple',
            font: 'display',
            size: 32,
          },
        },
      },
    ],
  },
});
assert(
  !invalidToken.ok && invalidToken.error.includes('element.text.color'),
  'expected designSection parser to reject unknown color tokens',
);

const unsafeActionHref = parseDesignSectionToolArgs({
  sectionName: 'Bad href',
  layout: {
    type: 'stack',
    children: [
      {
        element: {
          type: 'action',
          action: { label: 'Click', variant: 'solid', href: 'javascript:alert(1)' },
        },
      },
    ],
  },
});
assert(
  !unsafeActionHref.ok && unsafeActionHref.error.includes('not allowed'),
  'expected designSection parser to reject unsafe action hrefs',
);

const splitWithExtraChild = parseDesignSectionToolArgs({
  sectionName: 'Bad split',
  layout: {
    type: 'split',
    children: [
      validDesignArgs.layout.children[0],
      validDesignArgs.layout.children[0],
      validDesignArgs.layout.children[0],
    ],
  },
});
assert(
  !splitWithExtraChild.ok && splitWithExtraChild.error.includes('exactly 2 children'),
  'expected designSection parser to reject split nodes with more than two children',
);

// ---------------------------------------------------------------------------
// applyCanvasAgentOp — designSection op
// ---------------------------------------------------------------------------

// 4. designSection: layout engine produces a valid section.
const designInput: DesignSectionInput = {
  sectionName: 'Smoke Pricing',
  height: 720,
  backgroundEffect: 'grain',
  entrance: 'fade-up',
  layout: {
    type: 'stack',
    direction: 'column',
    align: 'center',
    gap: 'loose',
    children: [
      {
        element: {
          type: 'text',
          text: {
            content: 'Simple pricing',
            role: 'heading',
            color: 'text',
            font: 'display',
            size: 48,
          },
        },
      },
      {
        type: 'grid',
        columns: 3,
        gap: 'normal',
        children: [
          {
            type: 'stack',
            direction: 'column',
            gap: 'tight',
            children: [
              {
                element: {
                  type: 'container',
                  container: { variant: 'outlined', padding: 24 },
                },
                size: 'fill',
              },
              {
                element: {
                  type: 'text',
                  text: {
                    content: 'Starter',
                    role: 'heading',
                    color: 'text',
                    font: 'display',
                    size: 24,
                  },
                },
              },
              {
                element: {
                  type: 'action',
                  action: {
                    label: [{ text: 'Get Started' }],
                    variant: 'outline',
                    href: { type: 'external', url: '#' },
                  },
                },
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 'tight',
            children: [
              {
                element: {
                  type: 'container',
                  container: { variant: 'raised', padding: 24 },
                },
                size: 'fill',
              },
              {
                element: {
                  type: 'text',
                  text: {
                    content: 'Pro',
                    role: 'heading',
                    color: 'accent',
                    font: 'display',
                    size: 24,
                  },
                },
              },
              {
                element: {
                  type: 'action',
                  action: {
                    label: [{ text: 'Go Pro' }],
                    variant: 'solid',
                    href: { type: 'external', url: '#' },
                  },
                },
              },
            ],
          },
          {
            type: 'stack',
            direction: 'column',
            gap: 'tight',
            children: [
              {
                element: {
                  type: 'container',
                  container: { variant: 'outlined', padding: 24 },
                },
                size: 'fill',
              },
              {
                element: {
                  type: 'text',
                  text: {
                    content: 'Enterprise',
                    role: 'heading',
                    color: 'text',
                    font: 'display',
                    size: 24,
                  },
                },
              },
              {
                element: {
                  type: 'action',
                  action: {
                    label: [{ text: 'Contact us' }],
                    variant: 'ghost',
                    href: { type: 'external', url: '#' },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  },
};

const designOp: CanvasAgentOp = {
  kind: 'designSection',
  afterSectionId: baseSection.id,
  input: designInput,
};
const afterDesign = applyCanvasAgentOp(baseState, designOp);
const designValidation = validateEditableSite(afterDesign);
assert(
  designValidation.valid,
  designValidation.valid
    ? ''
    : `designSection apply produced invalid state: ${designValidation.errors.join('; ')}`,
);
const designedPage = afterDesign.pages[0];
assert(
  designedPage !== undefined && designedPage.sections.length === 2,
  'expected designSection to add exactly one section',
);
const designedSection = designedPage?.sections[1];
assert(
  designedSection?.recipeId === 'custom',
  `expected designed section recipeId to be 'custom' (got ${String(designedSection?.recipeId)})`,
);
assert(
  designedSection?.name === 'Smoke Pricing',
  `expected designed section name to be 'Smoke Pricing'`,
);
assert(
  designedSection !== undefined && designedSection.elements.length > 0,
  'expected designed section to have elements',
);

// designSection with null afterSectionId → appended at end.
const designAppendOp: CanvasAgentOp = {
  kind: 'designSection',
  afterSectionId: null,
  input: {
    sectionName: 'CTA',
    layout: {
      type: 'stack',
      direction: 'column',
      align: 'center',
      children: [
        {
          element: {
            type: 'text',
            text: {
              content: 'Ready?',
              role: 'heading',
              color: 'text',
              font: 'display',
              size: 48,
            },
          },
        },
      ],
    },
  },
};
const afterDesignAppend = applyCanvasAgentOp(baseState, designAppendOp);
assert(
  afterDesignAppend.pages[0]?.sections.length === 2 &&
    afterDesignAppend.pages[0].sections[1]?.name === 'CTA',
  'expected null afterSectionId to append the designed section',
);

// designSection with unknown afterSectionId → throws.
let designUnknownAfterThrew = false;
try {
  applyCanvasAgentOp(baseState, {
    kind: 'designSection',
    afterSectionId: 'sec-not-here',
    input: designInput,
  });
} catch (err) {
  designUnknownAfterThrew = err instanceof Error && err.message.includes('sec-not-here');
}
assert(designUnknownAfterThrew, 'expected designSection with unknown afterSectionId to throw');

// designSection with pageId → targets that page, not pages[0]. Without this
// routing, an agent that calls addPage('Manifesto') and then designSection(...)
// would have the section land on the original page even though the new one
// just got created.
const twoPageState: EditableSite = {
  ...baseState,
  pages: [
    baseState.pages[0]!,
    {
      id: 'page-manifesto',
      slug: 'manifesto',
      title: 'Manifesto',
      width: baseState.pages[0]!.width,
      sections: [
        {
          id: 'sec-manifesto-blank',
          recipeId: 'custom',
          name: 'Blank',
          height: 600,
          elements: [],
        },
      ],
    },
  ],
};
const designOnNewPage = applyCanvasAgentOp(twoPageState, {
  kind: 'designSection',
  pageId: 'page-manifesto',
  afterSectionId: null,
  input: { sectionName: 'Manifesto Hero', layout: designInput.layout },
});
assert(
  designOnNewPage.pages[0]?.sections.length === twoPageState.pages[0]!.sections.length,
  'expected designSection with pageId to leave the first page untouched',
);
assert(
  designOnNewPage.pages[1]?.sections.length === 2 &&
    designOnNewPage.pages[1].sections[1]?.name === 'Manifesto Hero',
  'expected designSection with pageId to append the new section on the named page',
);

// designSection with an unknown pageId → throws.
let designUnknownPageThrew = false;
try {
  applyCanvasAgentOp(twoPageState, {
    kind: 'designSection',
    pageId: 'page-not-here',
    afterSectionId: null,
    input: designInput,
  });
} catch (err) {
  designUnknownPageThrew = err instanceof Error && err.message.includes('page-not-here');
}
assert(designUnknownPageThrew, 'expected designSection with unknown pageId to throw');

// resolveDesignOp — returns section + imagePrompts without modifying state.
const designWithImages: DesignSectionInput = {
  sectionName: 'Image test',
  layout: {
    type: 'split',
    ratio: '1:1',
    children: [
      {
        element: {
          type: 'text',
          text: {
            content: 'Hello',
            role: 'heading',
            color: 'text',
            font: 'display',
            size: 48,
          },
        },
      },
      {
        element: {
          type: 'media',
          media: { imagePrompt: 'A workspace photo', fit: 'cover' },
        },
        size: 'fill',
      },
    ],
  },
};
const resolveResult = resolveDesignOp(baseState, designWithImages);
assert(
  resolveResult.imagePrompts.size === 1,
  `expected 1 image prompt, got ${String(resolveResult.imagePrompts.size)}`,
);
assert(
  resolveResult.section.elements.length === 2,
  `expected 2 elements in resolved section, got ${String(resolveResult.section.elements.length)}`,
);

// Regression: site with styleKit:'custom' resolves through
// resolveStyleKitWithCustom(state) — not getStyleKitPreset(state.styleKit),
// which throws on 'custom' by design. Before this guard, applyCanvasAgentOp
// and resolveDesignOp 500'd every chat /apply on a custom-themed site with
// "getStyleKitPreset: unknown style kit \"custom\"".
{
  const customState: EditableSite = {
    ...baseState,
    styleKit: 'custom',
    customStyleKit: STYLE_KIT_PRESETS.charcoal,
  };
  const designOnCustom = applyCanvasAgentOp(customState, {
    kind: 'designSection',
    afterSectionId: baseSection.id,
    input: designInput,
  });
  assert(
    designOnCustom.pages[0]?.sections.length === 2,
    'designSection on styleKit:custom must apply without throwing',
  );
  const resolveOnCustom = resolveDesignOp(customState, designInput);
  assert(
    resolveOnCustom.section.elements.length > 0,
    'resolveDesignOp on styleKit:custom must resolve without throwing',
  );
}

console.log('[canvas-agent:smoke] OK');
