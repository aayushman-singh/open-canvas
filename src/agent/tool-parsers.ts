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
  MOTION_PRESETS,
  type AgentRecipeId,
  type BackgroundEffect,
  type BuiltInStyleKit,
  type CanvasElement,
  type CanvasPage,
  type CanvasSection,
  type ElementType,
  type MotionPreset,
  type StyleKit,
} from '../canvas/schema.js';
import { AGENT_TOOL_DISPATCH } from '../canvas/elements/index.js';

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

// ---------------------------------------------------------------------------
// Standalone tool parsers — sourced from AGENT_TOOL_DISPATCH
// ---------------------------------------------------------------------------
//
// rewriteText (text) and replaceMedia (media) used to declare per-tool
// schemas + parsers inline. ADR 0011 Step 2 moved both into their owning
// element modules (text.ts, media.ts) under `standaloneTool`. The dispatch
// is now the canonical source; `translateToolCall` and `parseApplyOp` look
// up the standalone parser keyed by element type.

function getStandaloneTool<K extends keyof typeof AGENT_TOOL_DISPATCH>(
  key: K,
): NonNullable<(typeof AGENT_TOOL_DISPATCH)[K]['standaloneTool']> {
  const tool = AGENT_TOOL_DISPATCH[key].standaloneTool;
  if (tool === undefined) {
    throw new Error(`tool-parsers: ${key} spec must declare a standaloneTool`);
  }
  return tool;
}

const standaloneTextTool = getStandaloneTool('text');
const standaloneMediaTool = getStandaloneTool('media');

export function parseRewriteText(args: unknown): ParseResult {
  return standaloneTextTool.parse(args);
}

export function parseRenameToken(args: unknown): ParseResult {
  if (!isRecord(args)) return { ok: false, error: 'renameToken arguments must be an object' };
  if (!isNonEmptyString(args.from)) {
    return { ok: false, error: 'renameToken.from must be a non-empty string' };
  }
  if (typeof args.to !== 'string') {
    return { ok: false, error: 'renameToken.to must be a string' };
  }
  if (args.caseSensitive !== undefined && typeof args.caseSensitive !== 'boolean') {
    return { ok: false, error: 'renameToken.caseSensitive must be a boolean when present' };
  }
  const op: CanvasAgentOp = {
    kind: 'renameToken',
    from: args.from,
    to: args.to,
  };
  if (args.caseSensitive !== undefined) op.caseSensitive = args.caseSensitive;
  return { ok: true, op };
}

export function parseReplaceMedia(args: unknown): ParseResult {
  return standaloneMediaTool.parse(args);
}

export function parseDesignSection(args: unknown): ParseResult {
  const parsed = parseDesignSectionToolArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    op: {
      kind: 'designSection',
      pageId: parsed.pageId,
      afterSectionId: parsed.afterSectionId,
      input: parsed.input,
    },
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
  let pageId: string | null = null;
  if (args.pageId !== undefined && args.pageId !== null && args.pageId !== '') {
    if (typeof args.pageId !== 'string' || args.pageId.length === 0) {
      return { ok: false, error: 'createSection.pageId must be a non-empty string when provided' };
    }
    pageId = args.pageId;
  }
  const after = parseNullableSectionId(args.afterSectionId, 'createSection.afterSectionId');
  if (!after.ok) {
    return { ok: false, error: after.error };
  }
  const afterSectionId = after.value;
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
      pageId,
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

const INTERNAL_DELETE_FIELDS_KEY = '__deleteFields';

function parseInternalDeleteFields(
  patch: Record<string, unknown>,
  opName: string,
): { ok: true; fields?: string[] } | { ok: false; error: string } {
  const raw = patch[INTERNAL_DELETE_FIELDS_KEY];
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw)) {
    return { ok: false, error: `${opName}.${INTERNAL_DELETE_FIELDS_KEY} must be a string[]` };
  }
  const rawFields = raw as unknown[];
  const fields: string[] = [];
  for (let i = 0; i < rawFields.length; i++) {
    const field = rawFields[i];
    if (!isNonEmptyString(field)) {
      return {
        ok: false,
        error: `${opName}.${INTERNAL_DELETE_FIELDS_KEY}[${String(i)}] must be a non-empty string`,
      };
    }
    fields.push(field);
  }
  return fields.length > 0 ? { ok: true, fields } : { ok: true };
}

function copyInternalDeleteFields(
  targetPatch: Record<string, unknown>,
  sourcePatch: Record<string, unknown>,
  opName: string,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseInternalDeleteFields(sourcePatch, opName);
  if (!parsed.ok) return parsed;
  if (parsed.fields !== undefined) targetPatch[INTERNAL_DELETE_FIELDS_KEY] = parsed.fields;
  return { ok: true };
}

function withoutInternalDeleteFields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key !== INTERNAL_DELETE_FIELDS_KEY) out[key] = value;
  }
  return out;
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
 * Collect patch fields from `args` for updateElement / addElement. Shared
 * BaseElement fields (box, motion, elementStyle, responsive) are parsed
 * here; per-element-type fields route through `AGENT_TOOL_DISPATCH` and the
 * owning element module owns its parser (ADR 0011 Step 2).
 *
 * `elementType` is the caller's validated `elementType` field. Each element
 * spec inspects only the fields it advertises in `patchProperties`, so
 * cross-type field bleed (e.g. `variant` on text) is silently dropped at
 * parse time; the downstream `validate.ts` write gate is the authoritative
 * shape check per ADR 0012.
 */
function collectElementPatch(
  args: Record<string, unknown>,
  elementType: ElementType,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

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

  const elementPatch = AGENT_TOOL_DISPATCH[elementType].parsePatch(args);
  Object.assign(patch, elementPatch);

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
    patch = collectElementPatch(args, args.elementType);
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
    props = collectElementPatch(argsWithoutBox, args.elementType);
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
  if (args.visitorTheme !== undefined) {
    if (
      args.visitorTheme !== 'light' &&
      args.visitorTheme !== 'dark' &&
      args.visitorTheme !== 'toggleable'
    ) {
      return {
        ok: false,
        error: "setSiteConfig.visitorTheme must be 'light', 'dark', or 'toggleable'",
      };
    }
    patch.visitorTheme = args.visitorTheme;
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
        'setSiteConfig must include at least one field (visitorTheme, defaultLocale, siteNoIndex)',
    };
  }
  return { ok: true, op: { kind: 'setSiteConfig', patch } };
}

function parseCanonicalDesignSectionOp(value: Record<string, unknown>): ParseResult {
  let pageId: string | null = null;
  if (value.pageId !== undefined && value.pageId !== null && value.pageId !== '') {
    if (typeof value.pageId !== 'string' || value.pageId.length === 0) {
      return { ok: false, error: 'designSection.pageId must be a non-empty string when provided' };
    }
    pageId = value.pageId;
  }
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
      pageId,
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
    patch = collectElementPatch(value.patch, value.elementType);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `updateElement.${message}` };
  }
  const deletes = copyInternalDeleteFields(patch, value.patch, 'updateElement');
  if (!deletes.ok) return deletes;
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
    props = collectElementPatch(value.props, value.elementType);
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
  const parsed = parseUpdateSection({
    sectionId: value.sectionId,
    ...withoutInternalDeleteFields(value.patch),
  });
  if (!parsed.ok) return parsed;
  if (parsed.op.kind !== 'updateSection') {
    return { ok: false, error: `updateSection parsed as unexpected op ${parsed.op.kind}` };
  }
  const deletes = copyInternalDeleteFields(parsed.op.patch, value.patch, 'updateSection');
  if (!deletes.ok) return deletes;
  return parsed;
}

function parseCanonicalUpdatePageOp(value: Record<string, unknown>): ParseResult {
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'updatePage.patch must be an object' };
  }
  const parsed = parseUpdatePage({
    pageId: value.pageId,
    ...withoutInternalDeleteFields(value.patch),
  });
  if (!parsed.ok) return parsed;
  if (parsed.op.kind !== 'updatePage') {
    return { ok: false, error: `updatePage parsed as unexpected op ${parsed.op.kind}` };
  }
  const deletes = copyInternalDeleteFields(parsed.op.patch, value.patch, 'updatePage');
  if (!deletes.ok) return deletes;
  return parsed;
}

function parseCanonicalSetSiteConfigOp(value: Record<string, unknown>): ParseResult {
  if (!isRecord(value.patch)) {
    return { ok: false, error: 'setSiteConfig.patch must be an object' };
  }
  const regularPatch = withoutInternalDeleteFields(value.patch);
  const parsed =
    Object.keys(regularPatch).length > 0
      ? parseSetSiteConfig(regularPatch)
      : ({ ok: true, op: { kind: 'setSiteConfig', patch: {} } } satisfies ParseResult);
  if (!parsed.ok) return parsed;
  if (parsed.op.kind !== 'setSiteConfig') {
    return { ok: false, error: `setSiteConfig parsed as unexpected op ${parsed.op.kind}` };
  }
  const deletes = copyInternalDeleteFields(parsed.op.patch, value.patch, 'setSiteConfig');
  if (!deletes.ok) return deletes;
  return parsed;
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
    case 'renameToken':
      return parseRenameToken(call.arguments);
    default:
      return { ok: false, error: `unknown tool name: ${call.name}` };
  }
}

// ---------------------------------------------------------------------------
// Internal revert-op parsers — never exposed via translateToolCall. The
// editor's chat-revert flow is the only emitter; the snapshot payloads
// originate from the same Owner's pre-apply state, so we structurally
// gate the wrapper here and rely on runOpsPipeline → validateEditableSite
// to catch deeper shape regressions in the inserted entity.
// ---------------------------------------------------------------------------

function parseRestoreElement(value: Record<string, unknown>): ParseResult {
  if (!isNonEmptyString(value.sectionId)) {
    return { ok: false, error: 'restoreElement.sectionId must be a non-empty string' };
  }
  const parentKind = value.parentKind;
  if (
    parentKind !== 'section' &&
    parentKind !== 'tab-panel' &&
    parentKind !== 'collection-entry' &&
    parentKind !== 'collection-custom-template'
  ) {
    return {
      ok: false,
      error:
        "restoreElement.parentKind must be 'section' | 'tab-panel' | 'collection-entry' | 'collection-custom-template'",
    };
  }
  if (!isFiniteNumber(value.index) || value.index < 0) {
    return { ok: false, error: 'restoreElement.index must be a non-negative number' };
  }
  if (
    !isRecord(value.element) ||
    !isNonEmptyString(value.element.id) ||
    !isNonEmptyString(value.element.type)
  ) {
    return { ok: false, error: 'restoreElement.element must be a CanvasElement with id + type' };
  }
  const op: CanvasAgentOp = {
    kind: 'restoreElement',
    sectionId: value.sectionId,
    parentKind,
    index: value.index,
    element: value.element as unknown as CanvasElement,
  };
  if (parentKind === 'tab-panel') {
    if (!isNonEmptyString(value.tabsElementId) || !isNonEmptyString(value.tabId)) {
      return { ok: false, error: 'restoreElement(tab-panel): tabsElementId + tabId required' };
    }
    op.tabsElementId = value.tabsElementId;
    op.tabId = value.tabId;
  } else if (parentKind === 'collection-entry') {
    if (!isNonEmptyString(value.collectionElementId) || !isFiniteNumber(value.entryIndex)) {
      return {
        ok: false,
        error: 'restoreElement(collection-entry): collectionElementId + entryIndex required',
      };
    }
    op.collectionElementId = value.collectionElementId;
    op.entryIndex = value.entryIndex;
  } else if (parentKind === 'collection-custom-template') {
    if (!isNonEmptyString(value.collectionElementId)) {
      return {
        ok: false,
        error: 'restoreElement(collection-custom-template): collectionElementId required',
      };
    }
    op.collectionElementId = value.collectionElementId;
  }
  return { ok: true, op };
}

function parseRestoreSection(value: Record<string, unknown>): ParseResult {
  const scope = value.scope;
  if (scope !== 'page' && scope !== 'header' && scope !== 'footer') {
    return { ok: false, error: "restoreSection.scope must be 'page' | 'header' | 'footer'" };
  }
  if (!isFiniteNumber(value.index) || value.index < 0) {
    return { ok: false, error: 'restoreSection.index must be a non-negative number' };
  }
  if (!isRecord(value.section) || !isNonEmptyString(value.section.id)) {
    return { ok: false, error: 'restoreSection.section must be a CanvasSection with id' };
  }
  const op: CanvasAgentOp = {
    kind: 'restoreSection',
    scope,
    index: value.index,
    section: value.section as unknown as CanvasSection,
  };
  if (scope === 'page') {
    if (!isNonEmptyString(value.pageId)) {
      return { ok: false, error: 'restoreSection(page): pageId required' };
    }
    op.pageId = value.pageId;
  }
  return { ok: true, op };
}

function parseRestorePage(value: Record<string, unknown>): ParseResult {
  if (!isFiniteNumber(value.index) || value.index < 0) {
    return { ok: false, error: 'restorePage.index must be a non-negative number' };
  }
  if (
    !isRecord(value.page) ||
    !isNonEmptyString(value.page.id) ||
    !isNonEmptyString(value.page.slug)
  ) {
    return { ok: false, error: 'restorePage.page must be a CanvasPage with id + slug' };
  }
  const op: CanvasAgentOp = {
    kind: 'restorePage',
    index: value.index,
    page: value.page as unknown as CanvasPage,
  };
  if (value.actionHrefRestores !== undefined) {
    if (!Array.isArray(value.actionHrefRestores)) {
      return { ok: false, error: 'restorePage.actionHrefRestores must be an array' };
    }
    const actionHrefRestores = value.actionHrefRestores as unknown[];
    const restores: Array<{ sectionId: string; elementId: string }> = [];
    for (let i = 0; i < actionHrefRestores.length; i++) {
      const entry = actionHrefRestores[i];
      if (
        !isRecord(entry) ||
        !isNonEmptyString(entry.sectionId) ||
        !isNonEmptyString(entry.elementId)
      ) {
        return {
          ok: false,
          error: `restorePage.actionHrefRestores[${String(i)}] must have sectionId + elementId`,
        };
      }
      restores.push({ sectionId: entry.sectionId, elementId: entry.elementId });
    }
    op.actionHrefRestores = restores;
  }
  return { ok: true, op };
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
    // pageId, afterSectionId, assetIds. We re-derive a RecipeFactoryInput so
    // we never trust the styleKit field from the wire — the styleKit comes
    // from the freshly-loaded site row, not from the request body.
    const flattened = {
      recipeId: value.recipeId,
      brief: isRecord(value.input) ? value.input.brief : undefined,
      pageId: value.pageId,
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
  if (value.kind === 'renameToken') return parseRenameToken(value);

  // Internal revert ops — emitted only by the editor's chat-revert flow.
  // Intentionally absent from translateToolCall: the LLM never sees them
  // and can't request them.
  if (value.kind === 'restoreElement') return parseRestoreElement(value);
  if (value.kind === 'restoreSection') return parseRestoreSection(value);
  if (value.kind === 'restorePage') return parseRestorePage(value);

  return { ok: false, error: `unknown op kind: ${JSON.stringify(value.kind)}` };
}
