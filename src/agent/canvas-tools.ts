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
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
} from '../canvas/schema.js';
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
      description: 'Raw text for this run. Empty string is allowed only when the run carries marks.',
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
];
