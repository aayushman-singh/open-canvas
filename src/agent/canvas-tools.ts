// src/agent/canvas-tools.ts
//
// LLM tool definitions for the canvas AI flow (T7). The agent gets exactly
// three tools:
//
//   - `rewriteText` — replace the inline runs of a text element.
//   - `replaceMedia` — swap a media element's asset id (LLM picks an
//     EXISTING uploaded asset; the tool does not generate bytes).
//   - `createSection` — append a new section using a recipe factory; the
//     LLM picks a `recipeId` and a brief, never authors section JSON.
//
// Each schema is tight: marks are enumerated, link hrefs carry the same
// allowlist hint the validator enforces, recipe ids are enumerated. The
// descriptions explicitly call out the contracts the model must honour so
// the LLM cannot drift into producing a plain string for `content` or
// inventing a new `recipeId`.

import {
  AGENT_RECIPE_IDS,
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  SHAPE_VARIANTS,
  SURFACE_VARIANTS,
} from '../canvas/schema.js';
import {
  COLOR_TOKENS,
  FONT_TOKENS,
  GAP_TOKENS,
  GRID_COLUMNS,
  LAYOUT_ALIGNS,
  SPLIT_RATIOS,
  STACK_DIRECTIONS,
  ELEMENT_SIZES,
} from '../canvas/layout/tree.js';
import type { JsonSchema, LlmTool } from './llm.js';

// ---------------------------------------------------------------------------
// rewriteText
// ---------------------------------------------------------------------------

// One inline mark. The `type` field discriminates the union; `href` is only
// required when type === 'link'. JsonSchema as represented in `LlmTool` does
// not support `oneOf`, so we expose a single object schema and rely on the
// description to spell out the contract. The apply function + validator
// reject invalid combinations loudly.
const inlineMarkSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline mark applied to a run of text. Valid shapes:\n' +
    '  { "type": "bold" } | { "type": "italic" } | { "type": "underline" } |\n' +
    '  { "type": "strike" } | { "type": "code" } | { "type": "highlight" } |\n' +
    '  { "type": "link", "href": "https://example.com" }\n' +
    'For link marks, `href` MUST be http:, https:, mailto:, tel:, /relative, or #anchor — javascript: and data: are rejected.',
  properties: {
    type: {
      type: 'string',
      enum: [...INLINE_MARK_TYPES],
      description: 'Mark kind. Required.',
    },
    href: {
      type: 'string',
      description:
        'Required ONLY when type=="link". http:/https:/mailto:/tel: schemes, plus /relative and #anchor, are allowed.',
    },
  },
  required: ['type'],
};

const inlineRunSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline run of text. `text` is the raw run text (no HTML). `marks` carries 0..N InlineMark objects.',
  properties: {
    text: {
      type: 'string',
      description:
        'Raw text for this run. Empty string is allowed only when the run carries marks.',
    },
    marks: {
      type: 'array',
      items: inlineMarkSchema,
      description:
        'Optional. 0..N marks applied to this run. A run cannot carry two marks of the same `type`.',
    },
  },
  required: ['text'],
};

const rewriteTextSchema: JsonSchema = {
  type: 'object',
  properties: {
    elementId: {
      type: 'string',
      description: 'The id of the existing text element to rewrite. Must be present on the page.',
    },
    content: {
      type: 'array',
      items: inlineRunSchema,
      description:
        'The replacement content. MUST be an array of InlineRun objects — NEVER a plain string. ' +
        'Example: [{ "text": "Ship a site that feels " }, { "text": "lived-in", "marks": [{ "type": "bold" }] }, { "text": "." }]. ' +
        'The concatenated plain text must not be empty.',
    },
  },
  required: ['elementId', 'content'],
};

// ---------------------------------------------------------------------------
// replaceMedia
// ---------------------------------------------------------------------------

const replaceMediaSchema: JsonSchema = {
  type: 'object',
  properties: {
    elementId: {
      type: 'string',
      description: 'The id of the existing media element whose asset should be replaced.',
    },
    mediaKind: {
      type: 'string',
      enum: [...MEDIA_KINDS],
      description: 'The kind of media — must match the kind of the uploaded asset.',
    },
    assetId: {
      type: 'string',
      description:
        'The id of an EXISTING uploaded asset on this site. The model does NOT generate media bytes; ' +
        'the Owner uploads assets via the canvas API, and the model picks one of those ids.',
    },
    alt: {
      type: 'string',
      description:
        'Accessible alt text for the new asset. Empty string is acceptable for purely decorative media.',
    },
  },
  required: ['elementId', 'mediaKind', 'assetId', 'alt'],
};

// ---------------------------------------------------------------------------
// createSection
// ---------------------------------------------------------------------------

const assetIdsSchema: JsonSchema = {
  type: 'object',
  description:
    'Existing uploaded asset ids that the recipe should slot into its media elements. ' +
    'All ids MUST exist as uploaded assets on this site — invented ids are rejected.',
  properties: {
    hero: {
      type: 'string',
      description: 'Asset id for the recipe`s single hero media slot (hero-split, video-hero).',
    },
    cards: {
      type: 'array',
      items: { type: 'string' },
      description: 'Asset ids for card / grid recipes (feature-grid).',
    },
    gallery: {
      type: 'array',
      items: { type: 'string' },
      description: 'Asset ids for gallery recipes (gallery-strip).',
    },
  },
};

const createSectionSchema: JsonSchema = {
  type: 'object',
  properties: {
    recipeId: {
      type: 'string',
      enum: [...AGENT_RECIPE_IDS],
      description:
        'The section recipe to instantiate. recipeId MUST be one of [' +
        AGENT_RECIPE_IDS.join(', ') +
        ']; do not invent new ids.',
    },
    afterSectionId: {
      type: 'string',
      description:
        'The id of the section after which the new section should be inserted. ' +
        'Send an empty string to append at the end of the page.',
    },
    brief: {
      type: 'string',
      description:
        'A short owner-supplied brief describing what the section should say. The recipe factory uses ' +
        'the brief as the heading / body text verbatim — keep it concise.',
    },
    assetIds: assetIdsSchema,
  },
  required: ['recipeId', 'brief'],
};

// ---------------------------------------------------------------------------
// designSection
// ---------------------------------------------------------------------------

const textPropsSchema: JsonSchema = {
  type: 'object',
  description: 'Text element properties. All fields required.',
  properties: {
    content: { type: 'string', description: 'The text content. Must not be empty.' },
    role: { type: 'string', enum: ['heading', 'body', 'label'], description: 'Text role.' },
    color: {
      type: 'string',
      enum: [...COLOR_TOKENS],
      description: 'Semantic color token resolved from the active Style Kit.',
    },
    font: {
      type: 'string',
      enum: [...FONT_TOKENS],
      description: 'Semantic font token resolved from the active Style Kit.',
    },
    size: {
      type: 'number',
      minimum: 12,
      maximum: 96,
      description: 'Font size in px. Clamped to [12, 96].',
    },
  },
  required: ['content', 'role', 'color', 'font', 'size'],
};

const mediaPropsSchema: JsonSchema = {
  type: 'object',
  description: 'Media element with an image prompt for AI generation.',
  properties: {
    imagePrompt: {
      type: 'string',
      description: 'Text description of the image to generate. Be specific about style, subject, mood.',
    },
    fit: { type: 'string', enum: ['cover', 'contain'], description: 'How the image fills its box.' },
  },
  required: ['imagePrompt', 'fit'],
};

const actionPropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Button label text.' },
    variant: {
      type: 'string',
      enum: [...ACTION_VARIANTS],
      description: 'Visual style of the button.',
    },
    href: {
      type: 'string',
      description: 'Link destination. Use "#" for placeholder links.',
    },
  },
  required: ['label', 'variant', 'href'],
};

const shapePropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    variant: { type: 'string', enum: [...SHAPE_VARIANTS], description: 'Shape variant.' },
  },
  required: ['variant'],
};

const containerPropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    variant: { type: 'string', enum: [...SURFACE_VARIANTS], description: 'Surface variant.' },
    padding: { type: 'number', minimum: 0, maximum: 80, description: 'Inner padding in px.' },
  },
  required: ['variant', 'padding'],
};

const elementNodeSchema: JsonSchema = {
  type: 'object',
  description:
    'A leaf element in the layout tree. Exactly one of text/media/action/shape/container must match the element type.',
  properties: {
    element: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['text', 'media', 'action', 'shape', 'container'],
          description: 'Element type. Must match exactly one of the property objects below.',
        },
        text: textPropsSchema,
        media: mediaPropsSchema,
        action: actionPropsSchema,
        shape: shapePropsSchema,
        container: containerPropsSchema,
      },
      required: ['type'],
    },
    size: {
      type: 'string',
      enum: [...ELEMENT_SIZES],
      description:
        '"hug" = use intrinsic size (default for most elements). "fill" = expand to fill remaining space. ' +
        'Container elements with "fill" become background panels spanning the parent layout node.',
    },
  },
  required: ['element'],
};

// LayoutNode is recursive (children can be LayoutNode | ElementNode).
// JSON Schema `$ref` is not in the LlmTool subset, so we inline a single
// level of nesting and rely on the description to explain deeper nesting.
const layoutNodeSchema: JsonSchema = {
  type: 'object',
  description:
    'A layout node that positions its children. Types:\n' +
    '  stack — sequential layout (row or column) with gap and alignment.\n' +
    '  grid — equal-width columns (2, 3, or 4).\n' +
    '  split — two children divided at a ratio (1:1, 1:2, 2:1).\n' +
    'Children can be element nodes OR nested layout nodes (for complex layouts like a grid of stacks).',
  properties: {
    type: {
      type: 'string',
      enum: ['stack', 'grid', 'split'],
      description: 'Layout type.',
    },
    direction: {
      type: 'string',
      enum: [...STACK_DIRECTIONS],
      description: 'Stack direction. Only used when type="stack". Default: "column".',
    },
    gap: {
      type: 'string',
      enum: [...GAP_TOKENS],
      description: 'Spacing between children. tight=12px, normal=24px, loose=48px. Default: "normal".',
    },
    align: {
      type: 'string',
      enum: [...LAYOUT_ALIGNS],
      description:
        'Cross-axis alignment. Affects text alignment within children. Default: "start".',
    },
    columns: {
      type: 'number',
      enum: [...GRID_COLUMNS],
      description: 'Number of columns. Only used when type="grid". Default: 3.',
    },
    ratio: {
      type: 'string',
      enum: [...SPLIT_RATIOS],
      description: 'Width ratio between two children. Only used when type="split". Default: "1:1".',
    },
    children: {
      type: 'array',
      description:
        'Child nodes — each is either an element node (has "element" key) or a nested layout node (has "type" key with stack/grid/split).',
    },
  },
  required: ['type', 'children'],
};

const designSectionSchema: JsonSchema = {
  type: 'object',
  properties: {
    sectionName: {
      type: 'string',
      description: 'Human-readable section name (e.g. "Hero", "Pricing", "Testimonials").',
    },
    height: {
      type: 'number',
      minimum: 240,
      maximum: 1200,
      description: 'Section height in px. Default: 720. Clamped to [240, 1200].',
    },
    backgroundEffect: {
      type: 'string',
      enum: [...BACKGROUND_EFFECTS],
      description: 'Optional background visual effect.',
    },
    entrance: {
      type: 'string',
      enum: [...MOTION_PRESETS],
      description: 'Optional entrance animation preset.',
    },
    afterSectionId: {
      type: 'string',
      description:
        'The id of the section after which to insert this new section. ' +
        'Empty string or omitted = append at the end of the page.',
    },
    layout: layoutNodeSchema,
  },
  required: ['sectionName', 'layout'],
};

// ---------------------------------------------------------------------------
// Exported tool set
// ---------------------------------------------------------------------------

export const CANVAS_AGENT_TOOLS: LlmTool[] = [
  {
    name: 'rewriteText',
    description:
      'Replace the inline runs of an existing text element. The replacement MUST be an InlineRun[] ' +
      '(array of { text, marks? } objects) — never a plain string. The concatenated plain text must not be empty.',
    parameters: rewriteTextSchema,
  },
  {
    name: 'replaceMedia',
    description:
      'Replace a media element`s asset with an EXISTING uploaded asset id. ' +
      'The model picks an asset that has already been uploaded to the site; this tool does NOT generate media bytes.',
    parameters: replaceMediaSchema,
  },
  {
    name: 'createSection',
    description:
      'Append a new section to the page using a built-in recipe factory. The model picks a recipeId ' +
      'from [' +
      AGENT_RECIPE_IDS.join(', ') +
      '] and supplies a short brief; the recipe factory authors the section shape. ' +
      'The model never hand-writes section JSON.',
    parameters: createSectionSchema,
  },
  {
    name: 'designSection',
    description:
      'Design a new section from scratch using a semantic layout tree. Describe the structure ' +
      'as nested stack/grid/split nodes with element leaves. The layout engine computes positions; ' +
      'media elements with imagePrompt get AI-generated images. Output is previewed before applying. ' +
      'Use this for any section shape that does not match a built-in recipe.',
    parameters: designSectionSchema,
  },
];
