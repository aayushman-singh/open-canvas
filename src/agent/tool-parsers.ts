// src/agent/tool-parsers.ts
//
// Shared parse module for canvas agent tool calls and apply-ops. Extracts
// duplicated parse logic from `routes/api/canvas-agent.ts` and
// `agent/chat/orchestrator.ts` into a single source of truth. Also adds
// parse functions for the expanded set of 12 new agent tools (element CRUD,
// section management, page management, style kit, site config).
//
// Every parse function returns a `ParseResult` — either `{ ok: true, op }`
// or `{ ok: false, error }`. No silent fallbacks: bad input produces a loud,
// descriptive error string.

import type { LlmAssistantToolCall } from './llm.js';
import type { CanvasAgentOp } from './canvas-ops.js';
import { parseDesignSectionToolArgs } from './design-section-parser.js';
import type { DesignSectionInput } from '../canvas/layout/tree.js';
import type { RecipeFactoryInput } from '../canvas/recipes.js';
import {
  AGENT_RECIPE_IDS,
  BACKGROUND_EFFECTS,
  BUILT_IN_STYLE_KITS,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  type ActionHref,
  type AgentRecipeId,
  type BackgroundEffect,
  type BuiltInStyleKit,
  type ElementType,
  type InlineMark,
  type InlineRun,
  type MediaKind,
  type MotionPreset,
  type StyleKit,
} from '../canvas/schema.js';
import { isAllowedHref } from '../canvas/validate.js';

// ---------------------------------------------------------------------------
// ParseResult
// ---------------------------------------------------------------------------

export type ParseResult = { ok: true; op: CanvasAgentOp } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Type-guard helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNullableSectionId(
  value: unknown,
  fieldName: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (!isNonEmptyString(value)) {
    return { ok: false, error: `${fieldName} must be a non-empty string or null` };
  }
  return { ok: true, value };
}

function parseActionHref(value: unknown, fieldName: string): ActionHref {
  if (typeof value === 'string') {
    if (value.length === 0) throw new Error(`${fieldName} must be a non-empty string`);
    if (!isAllowedHref(value))
      throw new Error(`${fieldName} ${JSON.stringify(value)} is not allowed`);
    return { type: 'external', url: value };
  }
  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be a string or an ActionHref object`);
  }
  if (value.type === 'external') {
    if (typeof value.url !== 'string' || value.url.length === 0) {
      throw new Error(`${fieldName}.url must be a non-empty string`);
    }
    if (!isAllowedHref(value.url)) {
      throw new Error(`${fieldName}.url ${JSON.stringify(value.url)} is not allowed`);
    }
    return { type: 'external', url: value.url };
  }
  if (value.type === 'page') {
    if (typeof value.pageId !== 'string' || value.pageId.length === 0) {
      throw new Error(`${fieldName}.pageId must be a non-empty string`);
    }
    const href: ActionHref = { type: 'page', pageId: value.pageId };
    if (value.anchor !== undefined) {
      if (typeof value.anchor !== 'string') {
        throw new Error(`${fieldName}.anchor must be a string when present`);
      }
      href.anchor = value.anchor;
    }
    return href;
  }
  throw new Error(`${fieldName}.type must be "external" or "page"`);
}

// ---------------------------------------------------------------------------
// Inline run parsing
// ---------------------------------------------------------------------------

function parseInlineMark(value: unknown, runIdx: number, markIdx: number): InlineMark | string {
  if (!isRecord(value)) {
    return `mark[${runIdx}][${markIdx}] must be an object`;
  }
  if (!isOneOf(value.type, INLINE_MARK_TYPES)) {
    return `mark[${runIdx}][${markIdx}].type must be one of [${INLINE_MARK_TYPES.join(', ')}] (got ${JSON.stringify(value.type)})`;
  }
  if (value.type === 'link') {
    if (typeof value.href !== 'string' || value.href.length === 0) {
      return `mark[${runIdx}][${markIdx}] is a link mark but href is missing or empty`;
    }
    if (!isAllowedHref(value.href)) {
      return `mark[${runIdx}][${markIdx}] link href ${JSON.stringify(value.href)} is not allowed`;
    }
    return { type: 'link', href: value.href };
  }
  // Other mark types have no extra fields.
  return { type: value.type };
}

export function parseInlineRuns(
  value: unknown,
): { ok: true; runs: InlineRun[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'content must be an array of InlineRun objects (not a string)' };
  }
  if (value.length === 0) {
    return { ok: false, error: 'content must be a non-empty array' };
  }
  const runs: InlineRun[] = [];
  const items: unknown[] = value;
  for (let i = 0; i < items.length; i++) {
    const raw: unknown = items[i];
    if (!isRecord(raw)) {
      return { ok: false, error: `content[${String(i)}] must be an object` };
    }
    const text = raw.text;
    if (typeof text !== 'string') {
      return { ok: false, error: `content[${String(i)}].text must be a string` };
    }
    const run: InlineRun = { text };
    const rawMarks = raw.marks;
    if (rawMarks !== undefined) {
      if (!Array.isArray(rawMarks)) {
        return { ok: false, error: `content[${String(i)}].marks must be an array when present` };
      }
      const marks: InlineMark[] = [];
      const markItems: unknown[] = rawMarks;
      for (let m = 0; m < markItems.length; m++) {
        const parsed = parseInlineMark(markItems[m], i, m);
        if (typeof parsed === 'string') return { ok: false, error: parsed };
        marks.push(parsed);
      }
      run.marks = marks;
    }
    runs.push(run);
  }
  return { ok: true, runs };
}

// ---------------------------------------------------------------------------
// Existing tool parsers (extracted from canvas-agent.ts / orchestrator.ts)
// ---------------------------------------------------------------------------

export function parseRewriteText(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'rewriteText arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'rewriteText.elementId must be a non-empty string' };
  }
  const parsed = parseInlineRuns(args.content);
  if (!parsed.ok) return { ok: false, error: `rewriteText.${parsed.error}` };
  return {
    ok: true,
    op: { kind: 'rewriteText', elementId: args.elementId, content: parsed.runs },
  };
}

export function parseReplaceMedia(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'replaceMedia arguments must be an object' };
  if (typeof args.elementId !== 'string' || args.elementId.length === 0) {
    return { ok: false, error: 'replaceMedia.elementId must be a non-empty string' };
  }
  if (!isOneOf<MediaKind>(args.mediaKind, MEDIA_KINDS)) {
    return {
      ok: false,
      error: `replaceMedia.mediaKind must be one of [${MEDIA_KINDS.join(', ')}] (got ${JSON.stringify(args.mediaKind)})`,
    };
  }
  if (typeof args.assetId !== 'string' || args.assetId.length === 0) {
    return { ok: false, error: 'replaceMedia.assetId must be a non-empty string' };
  }
  if (typeof args.alt !== 'string') {
    return { ok: false, error: 'replaceMedia.alt must be a string' };
  }
  return {
    ok: true,
    op: {
      kind: 'replaceMedia',
      elementId: args.elementId,
      mediaKind: args.mediaKind,
      assetId: args.assetId,
      alt: args.alt,
    },
  };
}

export function parseDesignSection(args: unknown): ParseResult {
  const parsed = parseDesignSectionToolArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    op: { kind: 'designSection', afterSectionId: parsed.afterSectionId, input: parsed.input },
  };
}

export function parseCreateSection(args: unknown, styleKit: StyleKit): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'createSection arguments must be an object' };
  if (!isOneOf<AgentRecipeId>(args.recipeId, AGENT_RECIPE_IDS)) {
    return {
      ok: false,
      error: `createSection.recipeId must be one of [${AGENT_RECIPE_IDS.join(', ')}] (got ${JSON.stringify(args.recipeId)})`,
    };
  }
  if (typeof args.brief !== 'string' || args.brief.length === 0) {
    return { ok: false, error: 'createSection.brief must be a non-empty string' };
  }
  // afterSectionId: null OR string. We accept '' as "append at end" to keep
  // the JSON-Schema simple (no null variant in our subset).
  let afterSectionId: string | null = null;
  if (typeof args.afterSectionId === 'string' && args.afterSectionId.length > 0) {
    afterSectionId = args.afterSectionId;
  }
  const assetIds: RecipeFactoryInput['assetIds'] = {};
  if (isRecord(args.assetIds)) {
    if (typeof args.assetIds.hero === 'string' && args.assetIds.hero.length > 0) {
      assetIds.hero = args.assetIds.hero;
    }
    if (Array.isArray(args.assetIds.cards)) {
      const cards: string[] = [];
      for (const id of args.assetIds.cards) {
        if (typeof id === 'string' && id.length > 0) cards.push(id);
      }
      if (cards.length > 0) assetIds.cards = cards;
    }
    if (Array.isArray(args.assetIds.gallery)) {
      const gallery: string[] = [];
      for (const id of args.assetIds.gallery) {
        if (typeof id === 'string' && id.length > 0) gallery.push(id);
      }
      if (gallery.length > 0) assetIds.gallery = gallery;
    }
  }
  return {
    ok: true,
    op: {
      kind: 'insertSection',
      afterSectionId,
      recipeId: args.recipeId,
      input: { brief: args.brief, styleKit, assetIds },
    },
  };
}

// ---------------------------------------------------------------------------
// New tool parsers — element ops
// ---------------------------------------------------------------------------

export function parseDeleteElement(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'deleteElement arguments must be an object' };
  if (!isNonEmptyString(args.elementId)) {
    return { ok: false, error: 'deleteElement.elementId must be a non-empty string' };
  }
  return { ok: true, op: { kind: 'deleteElement', elementId: args.elementId } };
}

/**
 * Parse a box sub-object for updateElement / addElement. Returns the parsed
 * box fields or undefined if the input is absent. Returns an error string
 * when the value is present but malformed.
 */
function parseBox(
  value: unknown,
): { ok: true; box: Record<string, number> } | { ok: false; error: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { ok: false, error: 'box must be an object' };
  const box: Record<string, number> = {};
  for (const key of ['x', 'y', 'w', 'h', 'z', 'rotation'] as const) {
    const v = value[key];
    if (v !== undefined) {
      if (!isFiniteNumber(v)) return { ok: false, error: `box.${key} must be a number` };
      box[key] = v;
    }
  }
  return { ok: true, box };
}

function parseAddElementBox(
  value: unknown,
):
  | { ok: true; box?: { x: number; y: number; w: number; h: number } }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true };
  const parsed = parseBox(value);
  if (parsed === undefined) return { ok: true };
  if (!parsed.ok) return parsed;
  const { box } = parsed;
  const { x, y, w, h } = box;
  if (!isFiniteNumber(x)) return { ok: false, error: 'box.x must be a number' };
  if (!isFiniteNumber(y)) return { ok: false, error: 'box.y must be a number' };
  if (!isFiniteNumber(w)) return { ok: false, error: 'box.w must be a number' };
  if (!isFiniteNumber(h)) return { ok: false, error: 'box.h must be a number' };
  return { ok: true, box: { x, y, w, h } };
}

/**
 * Parse a motion sub-object. Returns parsed motion or undefined.
 */
function parseMotion(
  value: unknown,
):
  | { ok: true; motion: { preset: string; delayMs?: number } }
  | { ok: false; error: string }
  | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { ok: false, error: 'motion must be an object' };
  if (!isNonEmptyString(value.preset)) {
    return { ok: false, error: 'motion.preset must be a non-empty string' };
  }
  const motion: { preset: string; delayMs?: number } = { preset: value.preset };
  if (value.delayMs !== undefined) {
    if (!isFiniteNumber(value.delayMs)) {
      return { ok: false, error: 'motion.delayMs must be a number' };
    }
    motion.delayMs = value.delayMs;
  }
  return { ok: true, motion };
}

/**
 * Collect patch fields from `args` for updateElement / addElement. Only
 * collects fields that are present; does basic type checks (strings are
 * strings, numbers are numbers, booleans are booleans, arrays are arrays,
 * objects are objects). The apply handler does deeper type-checking against
 * the actual element schema.
 */
function collectElementPatch(args: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  // -- Box / motion / style / responsive (shared across all element types) --
  const boxResult = parseBox(args.box);
  if (boxResult !== undefined) {
    if (!boxResult.ok) throw new Error(boxResult.error);
    patch.box = boxResult.box;
  }

  const motionResult = parseMotion(args.motion);
  if (motionResult !== undefined) {
    if (!motionResult.ok) throw new Error(motionResult.error);
    patch.motion = motionResult.motion;
  }

  if (args.elementStyle !== undefined) {
    if (!isRecord(args.elementStyle)) throw new Error('elementStyle must be an object');
    patch.elementStyle = args.elementStyle;
  }

  if (args.responsive !== undefined) {
    if (!isRecord(args.responsive)) throw new Error('responsive must be an object');
    patch.responsive = args.responsive;
  }

  // -- Text fields --
  if (args.fontSize !== undefined) {
    if (!isFiniteNumber(args.fontSize)) throw new Error('fontSize must be a number');
    patch.fontSize = args.fontSize;
  }
  if (args.fontWeight !== undefined) {
    if (!isFiniteNumber(args.fontWeight)) throw new Error('fontWeight must be a number');
    patch.fontWeight = args.fontWeight;
  }
  if (args.align !== undefined) {
    if (typeof args.align !== 'string') throw new Error('align must be a string');
    patch.align = args.align;
  }
  if (args.role !== undefined) {
    if (typeof args.role !== 'string') throw new Error('role must be a string');
    patch.role = args.role;
  }
  if (args.content !== undefined) {
    const parsed = parseInlineRuns(args.content);
    if (!parsed.ok) throw new Error(parsed.error);
    patch.content = parsed.runs;
  }

  // -- Media fields --
  if (args.fit !== undefined) {
    if (typeof args.fit !== 'string') throw new Error('fit must be a string');
    patch.fit = args.fit;
  }
  if (args.alt !== undefined) {
    if (typeof args.alt !== 'string') throw new Error('alt must be a string');
    patch.alt = args.alt;
  }
  if (args.mediaKind !== undefined) {
    if (typeof args.mediaKind !== 'string') throw new Error('mediaKind must be a string');
    patch.mediaKind = args.mediaKind;
  }
  if (args.assetId !== undefined) {
    if (typeof args.assetId !== 'string') throw new Error('assetId must be a string');
    patch.assetId = args.assetId;
  }

  // -- Action fields --
  if (args.variant !== undefined) {
    if (typeof args.variant !== 'string') throw new Error('variant must be a string');
    patch.variant = args.variant;
  }
  if (args.label !== undefined) {
    if (typeof args.label !== 'string') throw new Error('label must be a string');
    patch.label = args.label;
  }
  if (args.href !== undefined) {
    patch.href = parseActionHref(args.href, 'href');
  }

  // -- Shape / Container fields (variant already handled above) --

  // -- Chart fields --
  if (args.kind !== undefined) {
    if (typeof args.kind !== 'string') throw new Error('kind must be a string');
    patch.kind = args.kind;
  }
  if (args.showLegend !== undefined) {
    if (typeof args.showLegend !== 'boolean') throw new Error('showLegend must be a boolean');
    patch.showLegend = args.showLegend;
  }
  if (args.series !== undefined) {
    if (!Array.isArray(args.series)) throw new Error('series must be an array');
    patch.series = args.series;
  }
  if (args.categories !== undefined) {
    if (!Array.isArray(args.categories)) throw new Error('categories must be an array');
    patch.categories = args.categories;
  }

  // -- Code fields --
  if (args.language !== undefined) {
    if (typeof args.language !== 'string') throw new Error('language must be a string');
    patch.language = args.language;
  }
  if (args.source !== undefined) {
    if (typeof args.source !== 'string') throw new Error('source must be a string');
    patch.source = args.source;
  }
  if (args.showLineNumbers !== undefined) {
    if (typeof args.showLineNumbers !== 'boolean')
      throw new Error('showLineNumbers must be a boolean');
    patch.showLineNumbers = args.showLineNumbers;
  }

  // -- Form fields --
  if (args.submitLabel !== undefined) {
    if (typeof args.submitLabel !== 'string') throw new Error('submitLabel must be a string');
    patch.submitLabel = args.submitLabel;
  }
  if (args.successMessage !== undefined) {
    if (typeof args.successMessage !== 'string') throw new Error('successMessage must be a string');
    patch.successMessage = args.successMessage;
  }
  if (args.fields !== undefined) {
    if (!Array.isArray(args.fields)) throw new Error('fields must be an array');
    patch.fields = args.fields;
  }

  // -- Embed fields --
  if (args.url !== undefined) {
    if (typeof args.url !== 'string') throw new Error('url must be a string');
    patch.url = args.url;
  }
  if (args.title !== undefined) {
    if (typeof args.title !== 'string') throw new Error('title must be a string');
    patch.title = args.title;
  }
  if (args.aspectRatio !== undefined) {
    if (!isFiniteNumber(args.aspectRatio)) throw new Error('aspectRatio must be a number');
    patch.aspectRatio = args.aspectRatio;
  }

  // -- Accordion fields --
  if (args.allowMultipleOpen !== undefined) {
    if (typeof args.allowMultipleOpen !== 'boolean')
      throw new Error('allowMultipleOpen must be a boolean');
    patch.allowMultipleOpen = args.allowMultipleOpen;
  }
  if (args.items !== undefined) {
    if (!Array.isArray(args.items)) throw new Error('items must be an array');
    patch.items = args.items;
  }

  // -- Carousel fields --
  if (args.showArrows !== undefined) {
    if (typeof args.showArrows !== 'boolean') throw new Error('showArrows must be a boolean');
    patch.showArrows = args.showArrows;
  }
  if (args.showDots !== undefined) {
    if (typeof args.showDots !== 'boolean') throw new Error('showDots must be a boolean');
    patch.showDots = args.showDots;
  }
  if (args.slides !== undefined) {
    if (!Array.isArray(args.slides)) throw new Error('slides must be an array');
    patch.slides = args.slides;
  }

  // -- Table fields --
  if (args.zebra !== undefined) {
    if (typeof args.zebra !== 'boolean') throw new Error('zebra must be a boolean');
    patch.zebra = args.zebra;
  }
  if (args.collapseOnPhone !== undefined) {
    if (typeof args.collapseOnPhone !== 'boolean')
      throw new Error('collapseOnPhone must be a boolean');
    patch.collapseOnPhone = args.collapseOnPhone;
  }
  if (args.columns !== undefined) {
    if (!Array.isArray(args.columns)) throw new Error('columns must be an array');
    patch.columns = args.columns;
  }
  if (args.rows !== undefined) {
    if (!Array.isArray(args.rows)) throw new Error('rows must be an array');
    patch.rows = args.rows;
  }

  // -- Nav fields --
  if (args.sticky !== undefined) {
    if (typeof args.sticky !== 'boolean') throw new Error('sticky must be a boolean');
    patch.sticky = args.sticky;
  }
  if (args.layout !== undefined) {
    if (typeof args.layout !== 'string') throw new Error('layout must be a string');
    patch.layout = args.layout;
  }
  if (args.links !== undefined) {
    if (!Array.isArray(args.links)) throw new Error('links must be an array');
    patch.links = args.links;
  }
  if (args.logoAssetId !== undefined) {
    if (typeof args.logoAssetId !== 'string') throw new Error('logoAssetId must be a string');
    patch.logoAssetId = args.logoAssetId;
  }

  return patch;
}

export function parseUpdateElement(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'updateElement arguments must be an object' };
  if (!isNonEmptyString(args.elementId)) {
    return { ok: false, error: 'updateElement.elementId must be a non-empty string' };
  }
  if (!isOneOf<ElementType>(args.elementType, ELEMENT_TYPES)) {
    return {
      ok: false,
      error: `updateElement.elementType must be one of [${ELEMENT_TYPES.join(', ')}] (got ${JSON.stringify(args.elementType)})`,
    };
  }
  let patch: Record<string, unknown>;
  try {
    patch = collectElementPatch(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `updateElement.${message}` };
  }
  return {
    ok: true,
    op: {
      kind: 'updateElement',
      elementId: args.elementId,
      elementType: args.elementType,
      patch,
    },
  };
}

export function parseAddElement(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'addElement arguments must be an object' };
  if (!isNonEmptyString(args.sectionId)) {
    return { ok: false, error: 'addElement.sectionId must be a non-empty string' };
  }
  if (!isOneOf<ElementType>(args.elementType, ELEMENT_TYPES)) {
    return {
      ok: false,
      error: `addElement.elementType must be one of [${ELEMENT_TYPES.join(', ')}] (got ${JSON.stringify(args.elementType)})`,
    };
  }
  const boxResult = parseAddElementBox(args.box);
  if (!boxResult.ok) return { ok: false, error: `addElement.${boxResult.error}` };
  let props: Record<string, unknown>;
  try {
    // Collect type-specific creation fields (same as updateElement patch fields,
    // minus box which is handled separately above).
    const argsWithoutBox = { ...args };
    delete argsWithoutBox.sectionId;
    delete argsWithoutBox.elementType;
    delete argsWithoutBox.box;
    props = collectElementPatch(argsWithoutBox);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `addElement.${message}` };
  }
  return {
    ok: true,
    op: {
      kind: 'addElement',
      sectionId: args.sectionId,
      elementType: args.elementType,
      ...(boxResult.box !== undefined ? { box: boxResult.box } : {}),
      props,
    },
  };
}

// ---------------------------------------------------------------------------
// New tool parsers — section ops
// ---------------------------------------------------------------------------

export function parseUpdateSection(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'updateSection arguments must be an object' };
  if (!isNonEmptyString(args.sectionId)) {
    return { ok: false, error: 'updateSection.sectionId must be a non-empty string' };
  }
  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) {
    if (typeof args.name !== 'string') {
      return { ok: false, error: 'updateSection.name must be a string' };
    }
    patch.name = args.name;
  }
  if (args.height !== undefined) {
    if (!isFiniteNumber(args.height) || args.height < 240 || args.height > 1200) {
      return { ok: false, error: 'updateSection.height must be a number between 240 and 1200' };
    }
    patch.height = args.height;
  }
  if (args.backgroundEffect !== undefined) {
    if (!isOneOf<BackgroundEffect>(args.backgroundEffect, BACKGROUND_EFFECTS)) {
      return {
        ok: false,
        error: `updateSection.backgroundEffect must be one of [${BACKGROUND_EFFECTS.join(', ')}] (got ${JSON.stringify(args.backgroundEffect)})`,
      };
    }
    patch.backgroundEffect = args.backgroundEffect;
  }
  if (args.entrance !== undefined) {
    if (!isOneOf<MotionPreset>(args.entrance, MOTION_PRESETS)) {
      return {
        ok: false,
        error: `updateSection.entrance must be one of [${MOTION_PRESETS.join(', ')}] (got ${JSON.stringify(args.entrance)})`,
      };
    }
    patch.entrance = args.entrance;
  }
  return {
    ok: true,
    op: { kind: 'updateSection', sectionId: args.sectionId, patch },
  };
}

export function parseDeleteSection(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'deleteSection arguments must be an object' };
  if (!isNonEmptyString(args.sectionId)) {
    return { ok: false, error: 'deleteSection.sectionId must be a non-empty string' };
  }
  return { ok: true, op: { kind: 'deleteSection', sectionId: args.sectionId } };
}

export function parseMoveSection(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'moveSection arguments must be an object' };
  if (!isNonEmptyString(args.sectionId)) {
    return { ok: false, error: 'moveSection.sectionId must be a non-empty string' };
  }
  // afterSectionId: string (non-empty = after that section, empty string = move to top → null)
  if (typeof args.afterSectionId !== 'string') {
    return {
      ok: false,
      error: 'moveSection.afterSectionId must be a string (empty string to move to top)',
    };
  }
  const afterSectionId = args.afterSectionId.length > 0 ? args.afterSectionId : null;
  return {
    ok: true,
    op: { kind: 'moveSection', sectionId: args.sectionId, afterSectionId },
  };
}

export function parseDuplicateSection(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'duplicateSection arguments must be an object' };
  if (!isNonEmptyString(args.sectionId)) {
    return { ok: false, error: 'duplicateSection.sectionId must be a non-empty string' };
  }
  return { ok: true, op: { kind: 'duplicateSection', sectionId: args.sectionId } };
}

// ---------------------------------------------------------------------------
// New tool parsers — page ops
// ---------------------------------------------------------------------------

export function parseAddPage(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'addPage arguments must be an object' };
  if (!isNonEmptyString(args.title)) {
    return { ok: false, error: 'addPage.title must be a non-empty string' };
  }
  if (!isNonEmptyString(args.slug)) {
    return { ok: false, error: 'addPage.slug must be a non-empty string' };
  }
  return {
    ok: true,
    op: { kind: 'addPage', title: args.title, slug: args.slug },
  };
}

export function parseUpdatePage(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'updatePage arguments must be an object' };
  if (!isNonEmptyString(args.pageId)) {
    return { ok: false, error: 'updatePage.pageId must be a non-empty string' };
  }
  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) {
    if (typeof args.title !== 'string')
      return { ok: false, error: 'updatePage.title must be a string' };
    patch.title = args.title;
  }
  if (args.slug !== undefined) {
    if (typeof args.slug !== 'string')
      return { ok: false, error: 'updatePage.slug must be a string' };
    patch.slug = args.slug;
  }
  if (args.description !== undefined) {
    if (typeof args.description !== 'string')
      return { ok: false, error: 'updatePage.description must be a string' };
    patch.description = args.description;
  }
  if (args.ogImageAssetId !== undefined) {
    if (typeof args.ogImageAssetId !== 'string')
      return { ok: false, error: 'updatePage.ogImageAssetId must be a string' };
    patch.ogImageAssetId = args.ogImageAssetId;
  }
  if (args.canonical !== undefined) {
    if (typeof args.canonical !== 'string')
      return { ok: false, error: 'updatePage.canonical must be a string' };
    patch.canonical = args.canonical;
  }
  if (args.noIndex !== undefined) {
    if (typeof args.noIndex !== 'boolean')
      return { ok: false, error: 'updatePage.noIndex must be a boolean' };
    patch.noIndex = args.noIndex;
  }
  if (args.locale !== undefined) {
    if (typeof args.locale !== 'string')
      return { ok: false, error: 'updatePage.locale must be a string' };
    patch.locale = args.locale;
  }
  if (args.publishedDate !== undefined) {
    if (typeof args.publishedDate !== 'string')
      return { ok: false, error: 'updatePage.publishedDate must be a string' };
    patch.publishedDate = args.publishedDate;
  }
  if (args.author !== undefined) {
    if (typeof args.author !== 'string')
      return { ok: false, error: 'updatePage.author must be a string' };
    patch.author = args.author;
  }
  if (args.tags !== undefined) {
    if (!Array.isArray(args.tags)) return { ok: false, error: 'updatePage.tags must be an array' };
    for (let i = 0; i < args.tags.length; i++) {
      if (typeof args.tags[i] !== 'string') {
        return { ok: false, error: `updatePage.tags[${String(i)}] must be a string` };
      }
    }
    patch.tags = args.tags;
  }
  if (args.category !== undefined) {
    if (typeof args.category !== 'string')
      return { ok: false, error: 'updatePage.category must be a string' };
    patch.category = args.category;
  }
  return {
    ok: true,
    op: { kind: 'updatePage', pageId: args.pageId, patch },
  };
}

export function parseDeletePage(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'deletePage arguments must be an object' };
  if (!isNonEmptyString(args.pageId)) {
    return { ok: false, error: 'deletePage.pageId must be a non-empty string' };
  }
  return { ok: true, op: { kind: 'deletePage', pageId: args.pageId } };
}

// ---------------------------------------------------------------------------
// New tool parsers — site-level ops
// ---------------------------------------------------------------------------

export function parseSetStyleKit(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'setStyleKit arguments must be an object' };
  if (!isOneOf<BuiltInStyleKit>(args.styleKit, BUILT_IN_STYLE_KITS)) {
    return {
      ok: false,
      error: `setStyleKit.styleKit must be one of [${BUILT_IN_STYLE_KITS.join(', ')}] (got ${JSON.stringify(args.styleKit)})`,
    };
  }
  return { ok: true, op: { kind: 'setStyleKit', styleKit: args.styleKit } };
}

export function parseSetSiteConfig(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'setSiteConfig arguments must be an object' };
  const patch: Record<string, unknown> = {};
  if (args.darkModeEnabled !== undefined) {
    if (typeof args.darkModeEnabled !== 'boolean') {
      return { ok: false, error: 'setSiteConfig.darkModeEnabled must be a boolean' };
    }
    patch.darkModeEnabled = args.darkModeEnabled;
  }
  if (args.defaultLocale !== undefined) {
    if (typeof args.defaultLocale !== 'string') {
      return { ok: false, error: 'setSiteConfig.defaultLocale must be a string' };
    }
    patch.defaultLocale = args.defaultLocale;
  }
  if (args.siteNoIndex !== undefined) {
    if (typeof args.siteNoIndex !== 'boolean') {
      return { ok: false, error: 'setSiteConfig.siteNoIndex must be a boolean' };
    }
    patch.siteNoIndex = args.siteNoIndex;
  }
  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error:
        'setSiteConfig must include at least one field (darkModeEnabled, defaultLocale, siteNoIndex)',
    };
  }
  return { ok: true, op: { kind: 'setSiteConfig', patch } };
}

function parseCanonicalDesignSectionOp(value: Record<string, unknown>): ParseResult {
  const after = parseNullableSectionId(value.afterSectionId, 'designSection.afterSectionId');
  if (!after.ok) return { ok: false, error: after.error };
  if (!isRecord(value.input)) {
    return { ok: false, error: 'designSection.input must be an object' };
  }
  if (!isNonEmptyString(value.input.sectionName)) {
    return { ok: false, error: 'designSection.input.sectionName must be a non-empty string' };
  }
  if (!isRecord(value.input.layout)) {
    return { ok: false, error: 'designSection.input.layout must be an object' };
  }
  if (value.input.height !== undefined) {
    if (
      !isFiniteNumber(value.input.height) ||
      value.input.height < 240 ||
      value.input.height > 1200
    ) {
      return {
        ok: false,
        error: 'designSection.input.height must be a number between 240 and 1200',
      };
    }
  }
  if (value.input.backgroundEffect !== undefined) {
    if (!isOneOf<BackgroundEffect>(value.input.backgroundEffect, BACKGROUND_EFFECTS)) {
      return {
        ok: false,
        error: `designSection.input.backgroundEffect must be one of [${BACKGROUND_EFFECTS.join(', ')}]`,
      };
    }
  }
  if (value.input.entrance !== undefined) {
    if (!isOneOf<MotionPreset>(value.input.entrance, MOTION_PRESETS)) {
      return {
        ok: false,
        error: `designSection.input.entrance must be one of [${MOTION_PRESETS.join(', ')}]`,
      };
    }
  }
  return {
    ok: true,
    op: {
      kind: 'designSection',
      afterSectionId: after.value,
      input: value.input as unknown as DesignSectionInput,
    },
  };
}

function parseCanonicalUpdateElementOp(value: Record<string, unknown>): ParseResult {
  if (!isNonEmptyString(value.elementId)) {
    return { ok: false, error: 'updateElement.elementId must be a non-empty string' };
  }
  if (!isOneOf<ElementType>(value.elementType, ELEMENT_TYPES)) {
    return {
      ok: false,
      error: `updateElement.elementType must be one of [${ELEMENT_TYPES.join(', ')}] (got ${JSON.stringify(value.elementType)})`,
    };
  }
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'updateElement.patch must be an object' };
  }
  let patch: Record<string, unknown>;
  try {
    patch = collectElementPatch(value.patch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `updateElement.${message}` };
  }
  return {
    ok: true,
    op: {
      kind: 'updateElement',
      elementId: value.elementId,
      elementType: value.elementType,
      patch,
    },
  };
}

function parseCanonicalAddElementOp(value: Record<string, unknown>): ParseResult {
  if (!isNonEmptyString(value.sectionId)) {
    return { ok: false, error: 'addElement.sectionId must be a non-empty string' };
  }
  if (!isOneOf<ElementType>(value.elementType, ELEMENT_TYPES)) {
    return {
      ok: false,
      error: `addElement.elementType must be one of [${ELEMENT_TYPES.join(', ')}] (got ${JSON.stringify(value.elementType)})`,
    };
  }
  const boxResult = parseAddElementBox(value.box);
  if (!boxResult.ok) return { ok: false, error: `addElement.${boxResult.error}` };
  if (!isRecord(value.props)) {
    return { ok: false, error: 'addElement.props must be an object' };
  }
  let props: Record<string, unknown>;
  try {
    props = collectElementPatch(value.props);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `addElement.${message}` };
  }
  return {
    ok: true,
    op: {
      kind: 'addElement',
      sectionId: value.sectionId,
      elementType: value.elementType,
      ...(boxResult.box !== undefined ? { box: boxResult.box } : {}),
      props,
    },
  };
}

function parseCanonicalMoveSectionOp(value: Record<string, unknown>): ParseResult {
  if (!isNonEmptyString(value.sectionId)) {
    return { ok: false, error: 'moveSection.sectionId must be a non-empty string' };
  }
  const after = parseNullableSectionId(value.afterSectionId, 'moveSection.afterSectionId');
  if (!after.ok) return { ok: false, error: after.error };
  return {
    ok: true,
    op: { kind: 'moveSection', sectionId: value.sectionId, afterSectionId: after.value },
  };
}

function parseCanonicalUpdateSectionOp(value: Record<string, unknown>): ParseResult {
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'updateSection.patch must be an object' };
  }
  return parseUpdateSection({ sectionId: value.sectionId, ...value.patch });
}

function parseCanonicalUpdatePageOp(value: Record<string, unknown>): ParseResult {
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'updatePage.patch must be an object' };
  }
  return parseUpdatePage({ pageId: value.pageId, ...value.patch });
}

function parseCanonicalSetSiteConfigOp(value: Record<string, unknown>): ParseResult {
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'setSiteConfig.patch must be an object' };
  }
  return parseSetSiteConfig(value.patch);
}

// ---------------------------------------------------------------------------
// translateToolCall — LLM tool call name → parse function dispatch
// ---------------------------------------------------------------------------

export function translateToolCall(call: LlmAssistantToolCall): ParseResult {
  switch (call.name) {
    case 'rewriteText':
      return parseRewriteText(call.arguments);
    case 'replaceMedia':
      return parseReplaceMedia(call.arguments);
    case 'designSection':
      return parseDesignSection(call.arguments);
    case 'deleteElement':
      return parseDeleteElement(call.arguments);
    case 'updateElement':
      return parseUpdateElement(call.arguments);
    case 'addElement':
      return parseAddElement(call.arguments);
    case 'updateSection':
      return parseUpdateSection(call.arguments);
    case 'deleteSection':
      return parseDeleteSection(call.arguments);
    case 'moveSection':
      return parseMoveSection(call.arguments);
    case 'duplicateSection':
      return parseDuplicateSection(call.arguments);
    case 'addPage':
      return parseAddPage(call.arguments);
    case 'updatePage':
      return parseUpdatePage(call.arguments);
    case 'deletePage':
      return parseDeletePage(call.arguments);
    case 'setStyleKit':
      return parseSetStyleKit(call.arguments);
    case 'setSiteConfig':
      return parseSetSiteConfig(call.arguments);
    default:
      return { ok: false, error: `unknown tool name: ${call.name}` };
  }
}

// ---------------------------------------------------------------------------
// parseApplyOp — wire-format op → parse function dispatch for the apply route
// ---------------------------------------------------------------------------

export function parseApplyOp(value: unknown, styleKit: StyleKit): ParseResult {
  if (!isRecord(value)) return { ok: false, error: 'op must be an object' };

  // Existing ops
  if (value.kind === 'rewriteText') return parseRewriteText(value);
  if (value.kind === 'replaceMedia') return parseReplaceMedia(value);
  if (value.kind === 'insertSection') {
    // The apply payload mirrors the LLM tool shape exactly: recipeId, brief,
    // afterSectionId, assetIds. We re-derive a RecipeFactoryInput so we never
    // trust the styleKit field from the wire — the styleKit comes from the
    // freshly-loaded site row, not from the request body.
    const flattened = {
      recipeId: value.recipeId,
      brief: isRecord(value.input) ? value.input.brief : undefined,
      afterSectionId: value.afterSectionId,
      assetIds: isRecord(value.input) ? value.input.assetIds : undefined,
    };
    return parseCreateSection(flattened, styleKit);
  }
  if (value.kind === 'designSection') {
    return parseCanonicalDesignSectionOp(value);
  }

  // New element ops
  if (value.kind === 'deleteElement') return parseDeleteElement(value);
  if (value.kind === 'updateElement') {
    return isRecord(value.patch) ? parseCanonicalUpdateElementOp(value) : parseUpdateElement(value);
  }
  if (value.kind === 'addElement') {
    return isRecord(value.props) ? parseCanonicalAddElementOp(value) : parseAddElement(value);
  }

  // New section ops
  if (value.kind === 'updateSection') {
    return isRecord(value.patch) ? parseCanonicalUpdateSectionOp(value) : parseUpdateSection(value);
  }
  if (value.kind === 'deleteSection') return parseDeleteSection(value);
  if (value.kind === 'moveSection') return parseCanonicalMoveSectionOp(value);
  if (value.kind === 'duplicateSection') return parseDuplicateSection(value);

  // New page ops
  if (value.kind === 'addPage') return parseAddPage(value);
  if (value.kind === 'updatePage') {
    return isRecord(value.patch) ? parseCanonicalUpdatePageOp(value) : parseUpdatePage(value);
  }
  if (value.kind === 'deletePage') return parseDeletePage(value);

  // New site-level ops
  if (value.kind === 'setStyleKit') return parseSetStyleKit(value);
  if (value.kind === 'setSiteConfig') {
    return isRecord(value.patch) ? parseCanonicalSetSiteConfigOp(value) : parseSetSiteConfig(value);
  }

  return { ok: false, error: `unknown op kind: ${JSON.stringify(value.kind)}` };
}
