// src/agent/canvas-ops.ts
//
// Pure agent-op layer for the Canvas AI flow (T7). Defines the discriminated
// union of operations the canvas agent can request and a single
// `applyCanvasAgentOp` function that produces a new `EditableSite` for
// each op. The function is pure: it deep-clones the input state via
// `structuredClone`, mutates the clone, and returns it. The caller is
// responsible for revalidating the result with `validateEditableSite`.
//
// Operations cover:
//   - Text & media edits: rewriteText, replaceMedia, updateElement, deleteElement, addElement
//   - Section CRUD: insertSection, designSection, updateSection, deleteSection,
//     moveSection, duplicateSection
//   - Page CRUD: addPage, updatePage, deletePage
//   - Site-level: setStyleKit, setSiteConfig
//
// The agent NEVER hand-writes canvas section JSON. `insertSection` carries
// only a `recipeId` plus a `RecipeFactoryInput`; the apply function calls
// `createSectionFromRecipe` itself. This is the structural guarantee that
// constrains generated sections to known recipe shapes.
//
// Failure mode is loud throughout: missing pages, unknown element ids,
// type mismatches, and unknown recipe ids all throw with a context-rich
// message that the route turns into a 400 with the message body.

import { resolveDesignSection } from '../canvas/layout/engine.js';
import type { DesignSectionInput, DesignSectionResult } from '../canvas/layout/tree.js';
import { createSectionFromRecipe, type RecipeFactoryInput } from '../canvas/recipes.js';
import {
  findElementInForest,
  remapElementForestIdsInPlace,
  visitElementForest,
  type ElementTreeParentKind,
} from '../canvas/element-tree.js';
import type {
  BuiltInStyleKit,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  InlineRun,
  MediaKind,
  SectionRecipeId,
} from '../canvas/schema.js';
import { resolveStyleKitWithCustom } from '../canvas/style-kits.js';

const SECTION_HEIGHT_MAX = 1400;
const INTERNAL_DELETE_FIELDS_KEY = '__deleteFields';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setElementField(element: CanvasElement, key: string, value: unknown): void {
  const target = element as CanvasElement & Record<string, unknown>;
  target[key] = value;
}

function describeMissingArrayItems(existing: unknown[], incoming: unknown[]): string {
  const incomingByLabel = new Set<string>();
  const incomingById = new Set<string>();
  for (const item of incoming) {
    if (item !== null && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      if (typeof rec.label === 'string') incomingByLabel.add(rec.label);
      if (typeof rec.id === 'string') incomingById.add(rec.id);
    }
  }
  const missing: string[] = [];
  for (const item of existing) {
    if (item !== null && typeof item === 'object') {
      const rec = item as Record<string, unknown>;
      if (typeof rec.label === 'string' && !incomingByLabel.has(rec.label)) {
        missing.push(rec.label);
        continue;
      }
      if (typeof rec.id === 'string' && !incomingById.has(rec.id)) {
        missing.push(rec.id);
        continue;
      }
    }
  }
  if (missing.length === 0) return 'incoming array is shorter';
  return JSON.stringify(missing);
}

function guardArrayShrink(element: CanvasElement, key: string, incoming: unknown): void {
  if (!Array.isArray(incoming)) return;
  const target = element as CanvasElement & Record<string, unknown>;
  const existing = target[key];
  if (!Array.isArray(existing)) return;
  if (existing.length === 0) return;
  if (incoming.length === 0) return;
  if (incoming.length >= existing.length) return;
  throw new Error(
    `applyCanvasAgentOp(updateElement): refused to replace array field '${key}' on element ${element.id}: existing array has ${String(existing.length)} items, incoming has ${String(incoming.length)} items, missing items: ${describeMissingArrayItems(existing as unknown[], incoming)}. To intentionally remove items, send the full list including the ones to keep.`,
  );
}

function applyInternalDeleteFields(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  opName: string,
  options: {
    allowedFields?: readonly string[];
    protectedFields?: readonly string[];
  },
): void {
  const raw = patch[INTERNAL_DELETE_FIELDS_KEY];
  if (raw === undefined) return;
  if (!Array.isArray(raw)) {
    throw new Error(`${opName}: ${INTERNAL_DELETE_FIELDS_KEY} must be a string[]`);
  }
  const rawFields = raw as unknown[];
  const allowed = options.allowedFields ? new Set(options.allowedFields) : null;
  const protectedFields = new Set(options.protectedFields ?? []);
  for (let i = 0; i < rawFields.length; i++) {
    const field = rawFields[i];
    if (typeof field !== 'string' || field.length === 0) {
      throw new Error(`${opName}: ${INTERNAL_DELETE_FIELDS_KEY}[${String(i)}] must be a string`);
    }
    if (allowed !== null && !allowed.has(field)) {
      throw new Error(`${opName}: cannot delete unsupported field ${field}`);
    }
    if (protectedFields.has(field)) {
      throw new Error(`${opName}: cannot delete protected field ${field}`);
    }
    delete target[field];
  }
}

export type CanvasAgentOp =
  | { kind: 'rewriteText'; elementId: string; content: InlineRun[] }
  | {
      kind: 'replaceMedia';
      elementId: string;
      mediaKind: MediaKind;
      assetId: string;
      alt: string;
    }
  | {
      kind: 'insertSection';
      pageId?: string | null;
      afterSectionId: string | null;
      recipeId: SectionRecipeId;
      input: RecipeFactoryInput;
    }
  | {
      kind: 'designSection';
      pageId?: string | null;
      afterSectionId: string | null;
      input: DesignSectionInput;
    }
  | { kind: 'deleteElement'; elementId: string }
  | {
      kind: 'updateElement';
      elementId: string;
      elementType: string;
      patch: Record<string, unknown>;
    }
  | {
      kind: 'addElement';
      sectionId: string;
      elementType: string;
      box?: { x: number; y: number; w: number; h: number } | undefined;
      props: Record<string, unknown>;
    }
  | { kind: 'updateSection'; sectionId: string; patch: Record<string, unknown> }
  | { kind: 'deleteSection'; sectionId: string }
  | { kind: 'moveSection'; sectionId: string; afterSectionId: string | null }
  | { kind: 'duplicateSection'; sectionId: string }
  | { kind: 'addPage'; title: string; slug: string }
  | { kind: 'updatePage'; pageId: string; patch: Record<string, unknown> }
  | { kind: 'deletePage'; pageId: string }
  | { kind: 'setStyleKit'; styleKit: BuiltInStyleKit }
  | { kind: 'setSiteConfig'; patch: Record<string, unknown> }
  /**
   * Deterministic site-wide find-and-replace on string fields the user can
   * see: text element content (including rich-text markdown blobs), action
   * element labels, media element alt text, and page titles. Walks every
   * page + the site-pinned header/footer, recurses into tabs / collection
   * entries. Pure literal substring replace; no word-boundary, no regex.
   *
   * The LLM emits ONE renameToken op for a bulk "rename X to Y everywhere"
   * intent instead of N rewriteText / updateElement ops the model has to
   * enumerate and can truncate. The walk is deterministic so coverage is
   * 100% — what the user reads is "rename Apogee to Briar", what executes
   * is exactly that, with no per-element re-enumeration through the model.
   */
  | { kind: 'renameToken'; from: string; to: string; caseSensitive?: boolean }
  /**
   * Internal revert ops — emitted ONLY by the editor's chat-revert flow,
   * never offered to the LLM (intentionally absent from translateToolCall
   * and the agent tool list). Each restore op carries the FULL captured
   * snapshot of the entity that was destroyed by a paired delete op, plus
   * just enough position info to put it back in the same slot. The final
   * state is revalidated end-to-end by runOpsPipeline → validateEditableSite,
   * so a duplicate-id or shape regression introduced by a stale snapshot
   * fails loud at the /apply boundary rather than silently corrupting state.
   */
  | {
      kind: 'restoreElement';
      sectionId: string;
      /** Where inside the section's element tree to insert. */
      parentKind: 'section' | 'tab-panel' | 'collection-entry' | 'collection-custom-template';
      /** Required for tab-panel: tabsElementId + tabId. */
      tabsElementId?: string;
      tabId?: string;
      /** Required for collection-entry / collection-custom-template. */
      collectionElementId?: string;
      /** Required for collection-entry. */
      entryIndex?: number;
      /** Insertion index inside the resolved parent array. */
      index: number;
      element: CanvasElement;
    }
  | {
      kind: 'restoreSection';
      scope: 'page' | 'header' | 'footer';
      /** Required when scope === 'page'. */
      pageId?: string;
      /** Position inside page.sections. Ignored for header/footer. */
      index: number;
      section: CanvasSection;
    }
  | {
      kind: 'restorePage';
      index: number;
      page: CanvasPage;
      /**
       * deletePage rewrites every `action.href = { type:'page', pageId:X }` to
       * `{ type:'external', url:'#' }`. To make revert flawless we re-point
       * each of those rewrites back at the restored page. The client captures
       * this list from the pre-apply state.
       */
      actionHrefRestores?: Array<{
        sectionId: string;
        elementId: string;
      }>;
    }
  /**
   * Chat-only intermediate op for the `generateImage` tool. The orchestrator
   * calls Replicate, then emits this op with the bytes encoded inline as a
   * `dataUrl`. The editor paints the 70%-opacity ghost overlay from the data
   * URL, and on Accept POSTs the bytes to `/api/owner/assets` to materialise
   * an Owner Asset, transforming this op into a regular `replaceMedia` or
   * `addElement` op before hitting `/canvas-agent/sites/:id/apply`.
   *
   * This op kind is editor-only: `applyCanvasAgentOp` throws if it ever
   * reaches the server-side apply path, because the asset id is not yet
   * known at this stage. ADR 0004 D2: rejected proposals must not persist
   * an Owner Asset, so the bytes ride through the browser and only become a
   * row at the moment of Accept.
   */
  | {
      kind: 'placeGeneratedImage';
      target:
        | { mode: 'replace'; elementId: string }
        | {
            mode: 'add';
            sectionId: string;
            box?: { x: number; y: number; w: number; h: number };
          };
      prompt: string;
      alt: string;
      dataUrl: string;
      mediaType: string;
      aspectRatio: string;
    };

// ---------------------------------------------------------------------------
// Helpers — search across all pages, header, and footer
// ---------------------------------------------------------------------------

function findElementAcrossSite(
  state: EditableSite,
  elementId: string,
): {
  element: CanvasElement;
  section: CanvasSection;
  parentArray: CanvasElement[] | null;
  parentKind: ElementTreeParentKind;
} {
  // Check header
  if (state.header) {
    const found = findElementInForest(state.header.elements, elementId);
    if (found !== null) return { ...found, section: state.header };
  }
  // Check footer
  if (state.footer) {
    const found = findElementInForest(state.footer.elements, elementId);
    if (found !== null) return { ...found, section: state.footer };
  }
  // Check all pages
  for (const page of state.pages) {
    for (const section of page.sections) {
      const found = findElementInForest(section.elements, elementId);
      if (found !== null) return { ...found, section };
    }
  }
  throw new Error(`element not found: ${elementId}`);
}

function cloneElementId(previousId: string): string {
  const prefix = previousId.includes('-') ? previousId.split('-').slice(0, -1).join('-') : 'el';
  return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

type SectionLocation =
  | { kind: 'header' }
  | { kind: 'footer' }
  | { kind: 'page'; pageIndex: number; sectionIndex: number };

function findSectionAcrossSite(
  state: EditableSite,
  sectionId: string,
): { section: CanvasSection; location: SectionLocation } {
  if (state.header && state.header.id === sectionId) {
    return { section: state.header, location: { kind: 'header' } };
  }
  if (state.footer && state.footer.id === sectionId) {
    return { section: state.footer, location: { kind: 'footer' } };
  }
  for (let pi = 0; pi < state.pages.length; pi++) {
    const pg = state.pages[pi]!;
    for (let si = 0; si < pg.sections.length; si++) {
      const sec = pg.sections[si]!;
      if (sec.id === sectionId) {
        return {
          section: sec,
          location: { kind: 'page', pageIndex: pi, sectionIndex: si },
        };
      }
    }
  }
  throw new Error(`section not found: ${sectionId}`);
}

// ---------------------------------------------------------------------------
// applyCanvasAgentOp
// ---------------------------------------------------------------------------

/**
 * Apply a single agent op to a `EditableSite`. The input is left untouched
 * — the returned state is always a fresh `structuredClone`. The caller MUST
 * revalidate the returned state because the apply step does not.
 *
 * Throws (loud) when:
 *   - The state has no `pages[0]` (POC enforces a single page).
 *   - A `rewriteText` op references an element that does not exist or is not
 *     a text element. The same applies to `replaceMedia` against media.
 *   - `rewriteText` content is missing or not an array (defence against the
 *     "model sent a plain string" failure mode the schema description forbids).
 *   - An `insertSection` op's `afterSectionId` is not null and does not match
 *     any section in the page.
 *   - `createSectionFromRecipe` itself rejects the recipe id (unknown id).
 */
export function applyCanvasAgentOp(state: EditableSite, op: CanvasAgentOp): EditableSite {
  const next = structuredClone(state);
  const firstPage = next.pages[0];
  if (!firstPage) {
    throw new Error('applyCanvasAgentOp: state must have at least one page');
  }
  const page: CanvasPage = firstPage;

  // Resolve the target page for section-insertion ops. Precedence:
  //   1. Explicit op.pageId - the agent named the page (required after an
  //      addPage call so the new section lands on the new page rather than
  //      defaulting back to pages[0]).
  //   2. op.afterSectionId - the named section's page is the implied target.
  //   3. pages[0] - legacy default for the single-page case.
  // afterSectionId must reference a section on the resolved page.
  function resolveInsertionPage(
    opPageId: string | null | undefined,
    opAfterSectionId: string | null,
    kindLabel: string,
  ): { page: CanvasPage } {
    if (typeof opPageId === 'string' && opPageId.length > 0) {
      const target = next.pages.find((p) => p.id === opPageId);
      if (!target) {
        // Defensive resolver — Gemini intermittently invents synthetic ids like
        // `page_2` despite the system prompt forbidding it. When that happens, fall
        // back to interpreting the trailing integer as a 1-based index into
        // next.pages. Log loudly so we see how often the model relapses. If the
        // integer is out of range, fall through to the loud throw below.
        const syntheticMatch = /^page[_-](\d+)$/i.exec(opPageId);
        if (syntheticMatch !== undefined && syntheticMatch !== null) {
          const ordinal = Number(syntheticMatch[1]);
          if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= next.pages.length) {
            const resolved = next.pages[ordinal - 1];
            if (resolved !== undefined) {
              console.warn(
                '[canvas-ops] agent generated synthetic pageId "' +
                  opPageId +
                  '" — resolved to ordinal #' +
                  String(ordinal) +
                  ' (real id: "' +
                  resolved.id +
                  '"). Tighten the agent prompt if this keeps firing.',
              );
              if (
                typeof opAfterSectionId === 'string' &&
                opAfterSectionId.length > 0 &&
                !resolved.sections.some((s) => s.id === opAfterSectionId)
              ) {
                throw new Error(
                  `applyCanvasAgentOp(${kindLabel}): afterSectionId ${opAfterSectionId} does not exist on page ${resolved.id}`,
                );
              }
              return { page: resolved };
            }
          }
        }
        throw new Error(
          `applyCanvasAgentOp(${kindLabel}): pageId not found: ${opPageId}. Known pages: ${next.pages
            .map((p) => p.id)
            .join(', ')}`,
        );
      }
      if (
        typeof opAfterSectionId === 'string' &&
        opAfterSectionId.length > 0 &&
        !target.sections.some((s) => s.id === opAfterSectionId)
      ) {
        throw new Error(
          `applyCanvasAgentOp(${kindLabel}): afterSectionId ${opAfterSectionId} does not exist on page ${opPageId}`,
        );
      }
      return { page: target };
    }
    if (typeof opAfterSectionId === 'string' && opAfterSectionId.length > 0) {
      const target = next.pages.find((p) => p.sections.some((s) => s.id === opAfterSectionId));
      if (!target) {
        throw new Error(
          `applyCanvasAgentOp(${kindLabel}): afterSectionId not found on any page: ${opAfterSectionId}`,
        );
      }
      return { page: target };
    }
    return { page };
  }

  // -- placeGeneratedImage: editor-only chat preview op ---------------------
  //
  // The chat orchestrator emits this op with the raw Replicate bytes inline.
  // The editor materialises an Owner Asset on Accept and replays a real
  // replaceMedia / addElement op against this route. Seeing it here means a
  // caller bypassed that materialisation step — refuse loudly per repo policy.
  if (op.kind === 'placeGeneratedImage') {
    throw new Error(
      'applyCanvasAgentOp(placeGeneratedImage): editor-only op kind; the editor must POST the inline bytes to /api/owner/assets and replay this as replaceMedia / addElement before calling apply.',
    );
  }

  // -- rewriteText (uses findElementAcrossSite for header/footer support) ---
  if (op.kind === 'rewriteText') {
    if (!Array.isArray(op.content)) {
      throw new Error(
        `applyCanvasAgentOp(rewriteText): content must be an InlineRun[] (got ${typeof op.content})`,
      );
    }
    const { element } = findElementAcrossSite(next, op.elementId);
    if (element.type !== 'text') {
      throw new Error(
        `applyCanvasAgentOp(rewriteText): element ${op.elementId} is type ${element.type}, expected text`,
      );
    }
    element.content = op.content;
    return next;
  }

  // -- replaceMedia (uses findElementAcrossSite for header/footer support) --
  if (op.kind === 'replaceMedia') {
    const { element } = findElementAcrossSite(next, op.elementId);
    if (element.type !== 'media') {
      throw new Error(
        `applyCanvasAgentOp(replaceMedia): element ${op.elementId} is type ${element.type}, expected media`,
      );
    }
    element.mediaKind = op.mediaKind;
    element.assetId = op.assetId;
    element.alt = op.alt;
    return next;
  }

  if (op.kind === 'insertSection') {
    const { page: targetPage } = resolveInsertionPage(
      op.pageId ?? null,
      op.afterSectionId,
      'insertSection',
    );
    const section = createSectionFromRecipe(op.recipeId, op.input);
    if (op.afterSectionId === null) {
      targetPage.sections.push(section);
      return next;
    }
    const idx = targetPage.sections.findIndex((s) => s.id === op.afterSectionId);
    if (idx < 0) {
      throw new Error(
        `applyCanvasAgentOp(insertSection): afterSectionId not found on target page: ${op.afterSectionId}`,
      );
    }
    targetPage.sections.splice(idx + 1, 0, section);
    return next;
  }

  if (op.kind === 'designSection') {
    // designSection — layout engine resolves a semantic tree into positioned
    // elements. The LLM describes structure; the engine computes geometry.
    const { page: targetPage } = resolveInsertionPage(
      op.pageId ?? null,
      op.afterSectionId,
      'designSection',
    );
    const preset = resolveStyleKitWithCustom(next);
    const result = resolveDesignSection(op.input, targetPage.width, preset);
    if (result.imagePrompts.size > 0) {
      throw new Error(
        `applyCanvasAgentOp(designSection): image generation is not wired for media prompts (${[...result.imagePrompts.values()].join('; ')})`,
      );
    }
    if (op.afterSectionId === null) {
      targetPage.sections.push(result.section);
      return next;
    }
    const insertIdx = targetPage.sections.findIndex((s) => s.id === op.afterSectionId);
    if (insertIdx < 0) {
      throw new Error(
        `applyCanvasAgentOp(designSection): afterSectionId not found on target page: ${op.afterSectionId}`,
      );
    }
    targetPage.sections.splice(insertIdx + 1, 0, result.section);
    return next;
  }

  // -- deleteElement --------------------------------------------------------
  if (op.kind === 'deleteElement') {
    const { parentArray, parentKind } = findElementAcrossSite(next, op.elementId);
    if (parentArray === null) {
      throw new Error(
        `deleteElement: element ${op.elementId} is hosted by a Flow Item and cannot be deleted directly`,
      );
    }
    const idx = parentArray.findIndex((e) => e.id === op.elementId);
    if (idx < 0) {
      throw new Error(
        `deleteElement: element ${op.elementId} not found in resolved ${parentKind} parent array`,
      );
    }
    parentArray.splice(idx, 1);
    return next;
  }

  // -- updateElement --------------------------------------------------------
  if (op.kind === 'updateElement') {
    const { element } = findElementAcrossSite(next, op.elementId);
    if (element.type !== op.elementType) {
      throw new Error(
        `updateElement: element ${op.elementId} is type ${element.type}, expected ${op.elementType}`,
      );
    }
    const patch = op.patch;
    applyInternalDeleteFields(
      element as unknown as Record<string, unknown>,
      patch,
      'updateElement',
      {
        protectedFields: ['id', 'type', 'box'],
      },
    );
    // Apply shared BaseElement patches
    if (isRecord(patch.box)) {
      const b = patch.box;
      if (typeof b.x === 'number') element.box.x = b.x;
      if (typeof b.y === 'number') element.box.y = b.y;
      if (typeof b.w === 'number') element.box.w = b.w;
      if (typeof b.h === 'number') element.box.h = b.h;
      if (typeof b.z === 'number') element.box.z = b.z;
      if (typeof b.rotation === 'number') element.box.rotation = b.rotation;
    }
    if (isRecord(patch.motion)) {
      element.motion = patch.motion as NonNullable<CanvasElement['motion']>;
    }
    if (isRecord(patch.elementStyle)) {
      element.elementStyle = {
        ...element.elementStyle,
        ...patch.elementStyle,
      };
    }
    if (isRecord(patch.responsive)) {
      element.responsive = {
        ...element.responsive,
        ...patch.responsive,
      };
    }
    // Apply type-specific patches — spread remaining fields onto the element.
    // validateEditableSite will catch invalid fields.
    const sharedKeys = new Set([
      'box',
      'motion',
      'elementStyle',
      'responsive',
      INTERNAL_DELETE_FIELDS_KEY,
    ]);
    for (const [key, value] of Object.entries(patch)) {
      if (!sharedKeys.has(key) && value !== undefined) {
        guardArrayShrink(element, key, value);
        setElementField(element, key, value);
      }
    }
    return next;
  }

  // -- addElement -----------------------------------------------------------
  if (op.kind === 'addElement') {
    const { section } = findSectionAcrossSite(next, op.sectionId);
    // Compute box: use provided or auto-place below lowest existing element
    let box: { x: number; y: number; w: number; h: number; z: number };
    if (op.box) {
      const maxZ = section.elements.reduce((m, e) => Math.max(m, e.box.z || 0), 0);
      box = { ...op.box, z: maxZ + 1 };
    } else {
      let bottomY = 40;
      let maxZ = 0;
      for (const el of section.elements) {
        const elBottom = el.box.y + el.box.h;
        if (elBottom > bottomY) bottomY = elBottom;
        if ((el.box.z || 0) > maxZ) maxZ = el.box.z || 0;
      }
      box = { x: 40, y: bottomY + 20, w: 320, h: 80, z: maxZ + 1 };
      const requiredHeight = box.y + box.h + 40;
      if (requiredHeight > SECTION_HEIGHT_MAX) {
        throw new Error(
          `addElement: auto-placement would require section height ${String(requiredHeight)}, max is ${String(SECTION_HEIGHT_MAX)}`,
        );
      }
      if (requiredHeight > section.height) {
        section.height = requiredHeight;
      }
    }
    const id = `el-${op.elementType}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const element = { id, type: op.elementType, box, ...op.props } as CanvasElement;
    section.elements.push(element);
    return next;
  }

  // -- updateSection --------------------------------------------------------
  if (op.kind === 'updateSection') {
    const { section } = findSectionAcrossSite(next, op.sectionId);
    const patch = op.patch;
    applyInternalDeleteFields(
      section as unknown as Record<string, unknown>,
      patch,
      'updateSection',
      {
        allowedFields: ['backgroundEffect', 'entrance'],
      },
    );
    if (typeof patch.name === 'string') section.name = patch.name;
    if (typeof patch.height === 'number') {
      section.height = Math.max(240, Math.min(1200, patch.height));
    }
    if (typeof patch.backgroundEffect === 'string') {
      section.backgroundEffect = patch.backgroundEffect as NonNullable<
        CanvasSection['backgroundEffect']
      >;
    }
    if (typeof patch.entrance === 'string') {
      section.entrance = patch.entrance as NonNullable<CanvasSection['entrance']>;
    }
    return next;
  }

  // -- deleteSection --------------------------------------------------------
  if (op.kind === 'deleteSection') {
    const { location } = findSectionAcrossSite(next, op.sectionId);
    if (location.kind === 'header') {
      delete next.header;
      return next;
    }
    if (location.kind === 'footer') {
      delete next.footer;
      return next;
    }
    const sectionPage = next.pages[location.pageIndex]!;
    if (sectionPage.sections.length <= 1) {
      throw new Error('deleteSection: cannot delete the last section on a page');
    }
    sectionPage.sections.splice(location.sectionIndex, 1);
    return next;
  }

  // -- moveSection ----------------------------------------------------------
  if (op.kind === 'moveSection') {
    const { location } = findSectionAcrossSite(next, op.sectionId);
    if (location.kind !== 'page') {
      throw new Error('moveSection: cannot move header or footer sections');
    }
    const movePage = next.pages[location.pageIndex]!;
    const [moved] = movePage.sections.splice(location.sectionIndex, 1);
    if (!moved) throw new Error('moveSection: splice returned empty');
    if (op.afterSectionId === null) {
      movePage.sections.unshift(moved);
    } else {
      const targetIdx = movePage.sections.findIndex((s) => s.id === op.afterSectionId);
      if (targetIdx < 0) {
        throw new Error(`moveSection: afterSectionId not found: ${op.afterSectionId}`);
      }
      movePage.sections.splice(targetIdx + 1, 0, moved);
    }
    return next;
  }

  // -- duplicateSection -----------------------------------------------------
  if (op.kind === 'duplicateSection') {
    const { location } = findSectionAcrossSite(next, op.sectionId);
    if (location.kind !== 'page') {
      throw new Error('duplicateSection: cannot duplicate header or footer');
    }
    const dupPage = next.pages[location.pageIndex]!;
    const original = dupPage.sections[location.sectionIndex]!;
    const clone: CanvasSection = structuredClone(original);
    clone.id = `sec-${clone.recipeId}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    clone.name = original.name + ' copy';
    remapElementForestIdsInPlace(clone.elements, (previousId) => cloneElementId(previousId));
    delete (clone as { anchorId?: string }).anchorId;
    if (clone.role) delete clone.role;
    dupPage.sections.splice(location.sectionIndex + 1, 0, clone);
    return next;
  }

  // -- addPage --------------------------------------------------------------
  if (op.kind === 'addPage') {
    const pageId = `page-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const sectionId = `sec-feature-grid-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const newPage = {
      id: pageId,
      slug: op.slug,
      title: op.title,
      width: next.pages[0]?.width ?? 1440,
      sections: [
        {
          id: sectionId,
          recipeId: 'feature-grid' as SectionRecipeId,
          name: 'Blank section',
          height: 640,
          elements: [],
        },
      ],
    };
    next.pages.push(newPage);
    return next;
  }

  // -- updatePage -----------------------------------------------------------
  if (op.kind === 'updatePage') {
    const targetPage = next.pages.find((p) => p.id === op.pageId);
    if (!targetPage) throw new Error(`updatePage: page not found: ${op.pageId}`);
    const patch = op.patch;
    applyInternalDeleteFields(
      targetPage as unknown as Record<string, unknown>,
      patch,
      'updatePage',
      {
        allowedFields: [
          'description',
          'ogImageAssetId',
          'canonical',
          'noIndex',
          'locale',
          'publishedDate',
          'author',
          'tags',
          'category',
        ],
      },
    );
    if (typeof patch.title === 'string') targetPage.title = patch.title;
    if (typeof patch.slug === 'string') targetPage.slug = patch.slug;
    if (typeof patch.description === 'string') targetPage.description = patch.description;
    if (typeof patch.ogImageAssetId === 'string') {
      targetPage.ogImageAssetId = patch.ogImageAssetId;
    }
    if (typeof patch.canonical === 'string') targetPage.canonical = patch.canonical;
    if (typeof patch.noIndex === 'boolean') targetPage.noIndex = patch.noIndex;
    if (typeof patch.locale === 'string') targetPage.locale = patch.locale;
    if (typeof patch.publishedDate === 'string') {
      targetPage.publishedDate = patch.publishedDate;
    }
    if (typeof patch.author === 'string') targetPage.author = patch.author;
    if (Array.isArray(patch.tags)) targetPage.tags = patch.tags as string[];
    if (typeof patch.category === 'string') targetPage.category = patch.category;
    return next;
  }

  // -- deletePage -----------------------------------------------------------
  if (op.kind === 'deletePage') {
    if (next.pages.length <= 1) {
      throw new Error('deletePage: cannot delete the last page');
    }
    const idx = next.pages.findIndex((p) => p.id === op.pageId);
    if (idx < 0) throw new Error(`deletePage: page not found: ${op.pageId}`);
    next.pages.splice(idx, 1);
    // After removing the page, action elements that linked TO it via
    // { type: 'page', pageId } would be left dangling — validate.ts:194
    // rejects this as "must reference an existing page" and the entire
    // /apply call 400s. Pass-7 retest hit this on a footer "View
    // customers" CTA; Pass-8 retest re-hit it because the previous
    // walker only visited next.pages[*].sections[*].elements[*] and
    // missed EditableSite.footer + EditableSite.header (both are
    // top-level CanvasSections shared across pages — schema.ts:399,
    // 401). The corrected walker also visits those two. Rewriting to
    // a type:'external' href that points at "#" preserves the button
    // so the Owner can re-link or delete it; auto-routing to another
    // page would silently lose intent.
    const deletedPageId = op.pageId;
    const sectionsToScan: CanvasSection[] = [];
    for (const page of next.pages) {
      for (const section of page.sections) sectionsToScan.push(section);
    }
    if (next.header) sectionsToScan.push(next.header);
    if (next.footer) sectionsToScan.push(next.footer);
    for (const section of sectionsToScan) {
      visitElementForest(section.elements, (element) => {
        if (
          element.type === 'action' &&
          typeof element.href === 'object' &&
          element.href !== null &&
          element.href.type === 'page' &&
          element.href.pageId === deletedPageId
        ) {
          element.href = { type: 'external', url: '#' };
        }
      });
    }
    return next;
  }

  // -- setStyleKit ----------------------------------------------------------
  if (op.kind === 'setStyleKit') {
    next.styleKit = op.styleKit;
    return next;
  }

  // -- setSiteConfig --------------------------------------------------------
  if (op.kind === 'setSiteConfig') {
    const patch = op.patch;
    applyInternalDeleteFields(next as unknown as Record<string, unknown>, patch, 'setSiteConfig', {
      allowedFields: ['visitorTheme', 'defaultLocale', 'siteNoIndex'],
    });
    if (
      patch.visitorTheme === 'light' ||
      patch.visitorTheme === 'dark' ||
      patch.visitorTheme === 'toggleable'
    ) {
      next.visitorTheme = patch.visitorTheme;
    }
    if (typeof patch.defaultLocale === 'string') next.defaultLocale = patch.defaultLocale;
    if (typeof patch.siteNoIndex === 'boolean') next.siteNoIndex = patch.siteNoIndex;
    return next;
  }

  // -- restoreElement -------------------------------------------------------
  // Re-inserts a previously deleted CanvasElement at its original location.
  // Internal-only — emitted by the editor's chat-revert flow. Final state is
  // revalidated by runOpsPipeline so a stale snapshot (duplicate id, etc.)
  // fails loud at /apply rather than silently corrupting state.
  if (op.kind === 'restoreElement') {
    const sectionLookup = findSectionAcrossSite(next, op.sectionId);
    const section = sectionLookup.section;
    let parentArray: CanvasElement[] | null = null;
    if (op.parentKind === 'section') {
      parentArray = section.elements;
    } else if (op.parentKind === 'tab-panel') {
      if (typeof op.tabsElementId !== 'string' || typeof op.tabId !== 'string') {
        throw new Error('restoreElement(tab-panel): tabsElementId + tabId required');
      }
      const tabsElement = findElementInForest(section.elements, op.tabsElementId)?.element;
      if (!tabsElement || tabsElement.type !== 'tabs') {
        throw new Error(`restoreElement: tabs element not found: ${op.tabsElementId}`);
      }
      const tab = tabsElement.tabs.find((t) => t.id === op.tabId);
      if (!tab) {
        throw new Error(`restoreElement: tab not found: ${op.tabId} in ${op.tabsElementId}`);
      }
      parentArray = tab.elements;
    } else if (op.parentKind === 'collection-entry') {
      if (typeof op.collectionElementId !== 'string' || typeof op.entryIndex !== 'number') {
        throw new Error(
          'restoreElement(collection-entry): collectionElementId + entryIndex required',
        );
      }
      const collectionElement = findElementInForest(
        section.elements,
        op.collectionElementId,
      )?.element;
      if (!collectionElement || collectionElement.type !== 'collection') {
        throw new Error(`restoreElement: collection element not found: ${op.collectionElementId}`);
      }
      // ADR 0063 — legacy CollectionElement.entries is optional during the
      // transition; fall through to the loud "missing entry" path when the
      // field is absent rather than silently materialising an empty parent.
      const legacyEntries = collectionElement.entries;
      const entry = legacyEntries === undefined ? undefined : legacyEntries[op.entryIndex];
      if (!Array.isArray(entry)) {
        throw new Error(
          `restoreElement: collection entry ${String(op.entryIndex)} missing on ${op.collectionElementId}`,
        );
      }
      parentArray = entry;
    } else if (op.parentKind === 'collection-custom-template') {
      if (typeof op.collectionElementId !== 'string') {
        throw new Error('restoreElement(collection-custom-template): collectionElementId required');
      }
      const collectionElement = findElementInForest(
        section.elements,
        op.collectionElementId,
      )?.element;
      if (!collectionElement || collectionElement.type !== 'collection') {
        throw new Error(`restoreElement: collection element not found: ${op.collectionElementId}`);
      }
      const customTemplate = collectionElement.customTemplate;
      if (!Array.isArray(customTemplate)) {
        throw new Error(
          `restoreElement: collection customTemplate missing on ${op.collectionElementId}`,
        );
      }
      parentArray = customTemplate;
    } else {
      throw new Error(`restoreElement: unknown parentKind: ${String(op.parentKind)}`);
    }
    const insertAt = Math.max(0, Math.min(op.index, parentArray.length));
    parentArray.splice(insertAt, 0, structuredClone(op.element));
    return next;
  }

  // -- restoreSection -------------------------------------------------------
  if (op.kind === 'restoreSection') {
    if (op.scope === 'header') {
      next.header = structuredClone(op.section);
      return next;
    }
    if (op.scope === 'footer') {
      next.footer = structuredClone(op.section);
      return next;
    }
    if (op.scope === 'page') {
      if (typeof op.pageId !== 'string') {
        throw new Error('restoreSection(page): pageId required');
      }
      const targetPage = next.pages.find((p) => p.id === op.pageId);
      if (!targetPage) throw new Error(`restoreSection: page not found: ${op.pageId}`);
      const insertAt = Math.max(0, Math.min(op.index, targetPage.sections.length));
      targetPage.sections.splice(insertAt, 0, structuredClone(op.section));
      return next;
    }
    throw new Error(`restoreSection: unknown scope: ${String(op.scope)}`);
  }

  // -- restorePage ----------------------------------------------------------
  // Re-inserts the deleted page, then re-points every action.href that
  // deletePage rewrote to '#'. The href list is captured client-side from
  // the pre-apply snapshot; targets that have since been deleted or have a
  // different href shape are silently skipped (their post-revert href is
  // already whatever the Owner most recently chose for them).
  if (op.kind === 'restorePage') {
    const insertAt = Math.max(0, Math.min(op.index, next.pages.length));
    next.pages.splice(insertAt, 0, structuredClone(op.page));
    if (Array.isArray(op.actionHrefRestores)) {
      const restoredPageId = op.page.id;
      const sectionsToScan: CanvasSection[] = [];
      for (const pg of next.pages) {
        for (const sec of pg.sections) sectionsToScan.push(sec);
      }
      if (next.header) sectionsToScan.push(next.header);
      if (next.footer) sectionsToScan.push(next.footer);
      for (const restore of op.actionHrefRestores) {
        const section = sectionsToScan.find((s) => s.id === restore.sectionId);
        if (!section) continue;
        const element = findElementInForest(section.elements, restore.elementId)?.element;
        if (!element || element.type !== 'action') continue;
        // Only undo the deletePage-introduced '#' rewrite. If the Owner has
        // since pointed the action elsewhere (different href shape, or a
        // different external url), we leave their choice alone.
        if (
          typeof element.href === 'object' &&
          element.href !== null &&
          element.href.type === 'external' &&
          element.href.url === '#'
        ) {
          element.href = { type: 'page', pageId: restoredPageId };
        }
      }
    }
    return next;
  }

  if (op.kind === 'renameToken') {
    if (typeof op.from !== 'string' || op.from.length === 0) {
      throw new Error('applyCanvasAgentOp(renameToken): from must be a non-empty string');
    }
    if (typeof op.to !== 'string') {
      throw new Error('applyCanvasAgentOp(renameToken): to must be a string');
    }
    // Bind locals so the inner walker closes over narrowed-string fields
    // instead of re-reading them off `op` (which keeps its DU shape).
    const fromLiteral: string = op.from;
    const toLiteral: string = op.to;
    const caseSensitive = op.caseSensitive !== false;
    const fromKey = caseSensitive ? fromLiteral : fromLiteral.toLowerCase();
    function replaceIn(text: string): string {
      if (typeof text !== 'string' || text.length === 0) return text;
      if (caseSensitive) return text.split(fromLiteral).join(toLiteral);
      // Case-insensitive: walk indices manually so we preserve the
      // original casing of any chars we leave alone but always substitute
      // with `to` verbatim (matches user expectation of "rename to this
      // exact spelling").
      let out = '';
      let cursor = 0;
      const lower = text.toLowerCase();
      while (cursor < text.length) {
        const idx = lower.indexOf(fromKey, cursor);
        if (idx < 0) {
          out += text.slice(cursor);
          break;
        }
        out += text.slice(cursor, idx) + toLiteral;
        cursor = idx + fromKey.length;
      }
      return out;
    }
    function replaceStringField(target: Record<string, unknown>, key: string): void {
      const v = target[key];
      if (typeof v === 'string') target[key] = replaceIn(v);
    }
    function replaceStringArray(target: Record<string, unknown>, key: string): void {
      const arr = target[key];
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        if (typeof arr[i] === 'string') arr[i] = replaceIn(arr[i] as string);
      }
    }
    function walkInlineRuns(runs: unknown): void {
      if (!Array.isArray(runs)) return;
      for (let i = 0; i < runs.length; i++) {
        const run = runs[i] as { text?: unknown } | null;
        if (run && typeof run.text === 'string') {
          run.text = replaceIn(run.text);
        }
      }
    }
    function walkElements(arr: CanvasElement[] | undefined): void {
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const el = arr[i] as unknown as Record<string, unknown>;
        if (!el) continue;
        switch (el.type) {
          case 'text':
            walkInlineRuns(el.content);
            break;
          case 'action':
            walkInlineRuns(el.label);
            break;
          case 'media':
            replaceStringField(el, 'alt');
            break;
          case 'embed':
            // Embed: visitor-visible iframe title (aria-label on player).
            replaceStringField(el, 'title');
            break;
          case 'accordion':
            // accordion.items: { title: string, body: InlineRun[] }
            if (Array.isArray(el.items)) {
              for (const item of el.items as Array<Record<string, unknown>>) {
                if (!item) continue;
                replaceStringField(item, 'title');
                walkInlineRuns(item.body);
              }
            }
            break;
          case 'carousel':
            // carousel.slides: { caption?: string, ... }
            if (Array.isArray(el.slides)) {
              for (const slide of el.slides as Array<Record<string, unknown>>) {
                if (!slide) continue;
                replaceStringField(slide, 'caption');
              }
            }
            break;
          case 'nav':
            // nav: siteTitle, links[].label, primaryAction.label
            replaceStringField(el, 'siteTitle');
            if (Array.isArray(el.links)) {
              for (const link of el.links as Array<Record<string, unknown>>) {
                if (link) replaceStringField(link, 'label');
              }
            }
            {
              const primary = el.primaryAction as Record<string, unknown> | undefined;
              if (primary) replaceStringField(primary, 'label');
            }
            break;
          case 'form':
            // form: title (owner-facing), submitLabel, successMessage,
            // fields[].label / .placeholder / .options[].label
            replaceStringField(el, 'title');
            replaceStringField(el, 'submitLabel');
            replaceStringField(el, 'successMessage');
            if (Array.isArray(el.fields)) {
              for (const field of el.fields as Array<Record<string, unknown>>) {
                if (!field) continue;
                replaceStringField(field, 'label');
                replaceStringField(field, 'placeholder');
                if (Array.isArray(field.options)) {
                  for (const opt of field.options as Array<Record<string, unknown>>) {
                    if (opt) replaceStringField(opt, 'label');
                  }
                }
              }
            }
            break;
          case 'table':
            // table: columns[].header, rows[].cells[colId] string values.
            if (Array.isArray(el.columns)) {
              for (const col of el.columns as Array<Record<string, unknown>>) {
                if (col) replaceStringField(col, 'header');
              }
            }
            if (Array.isArray(el.rows)) {
              for (const row of el.rows as Array<Record<string, unknown>>) {
                if (!row) continue;
                const cells = row.cells as Record<string, unknown> | undefined;
                if (cells && typeof cells === 'object') {
                  for (const cellKey of Object.keys(cells)) {
                    if (typeof cells[cellKey] === 'string') {
                      cells[cellKey] = replaceIn(cells[cellKey]);
                    }
                  }
                }
              }
            }
            break;
          case 'chart':
            // chart: series[].label, categories[] string entries.
            if (Array.isArray(el.series)) {
              for (const s of el.series as Array<Record<string, unknown>>) {
                if (s) replaceStringField(s, 'label');
              }
            }
            replaceStringArray(el, 'categories');
            break;
          case 'tabs':
            // tabs.tab[].label is an InlineRun[]; the per-tab element
            // arrays are recursed below alongside the label sweep.
            if (Array.isArray(el.tabs)) {
              for (const tab of el.tabs as Array<{
                label?: unknown;
                elements?: CanvasElement[];
              }>) {
                if (!tab) continue;
                walkInlineRuns(tab.label);
                walkElements(tab.elements);
              }
            }
            break;
          case 'collection':
            // Inline collection entries (legacy) — CMS-materialised entries
            // live in DB and are walked by the publish-time materialiser, not
            // here. The walker covers the editable-state inline shape so
            // pre-CMS sites still rename cleanly.
            if (Array.isArray(el.entries)) {
              for (const entry of el.entries as CanvasElement[][]) {
                walkElements(entry);
              }
            }
            break;
          case 'flow-container':
            if (Array.isArray(el.items)) {
              for (const item of el.items as Array<Record<string, unknown>>) {
                if (!item || !item.element || typeof item.element !== 'object') continue;
                walkElements([item.element as CanvasElement]);
              }
            }
            break;
          // shape / container / (other variant-only or layout-only) have
          // no string-bearing fields — intentional no-op so the switch
          // stays exhaustive at the structural level.
        }
      }
    }
    function walkSection(section: CanvasSection | undefined): void {
      if (!section) return;
      const sectionRec = section as unknown as Record<string, unknown>;
      replaceStringField(sectionRec, 'name');
      walkElements(section.elements);
    }
    walkSection(next.header);
    walkSection(next.footer);
    for (const page of next.pages) {
      const pageRec = page as unknown as Record<string, unknown>;
      // Visitor- and SEO-facing strings on the page itself.
      replaceStringField(pageRec, 'title');
      replaceStringField(pageRec, 'slug');
      replaceStringField(pageRec, 'description');
      replaceStringField(pageRec, 'author');
      replaceStringField(pageRec, 'category');
      replaceStringArray(pageRec, 'tags');
      for (const section of page.sections) {
        walkSection(section);
      }
    }
    return next;
  }

  const exhaustive: never = op;
  throw new Error(`applyCanvasAgentOp: unknown op kind: ${JSON.stringify(exhaustive)}`);
}

/**
 * Resolve a designSection input against the current site state WITHOUT
 * applying it. The orchestrator uses this to get the resolved section +
 * image prompts, generate images, patch assetIds, then show a preview.
 * On accept the orchestrator inserts the already-resolved section.
 */
export function resolveDesignOp(
  state: EditableSite,
  input: DesignSectionInput,
): DesignSectionResult {
  const page = state.pages[0];
  if (!page) throw new Error('resolveDesignOp: state must have at least one page');
  const preset = resolveStyleKitWithCustom(state);
  return resolveDesignSection(input, page.width, preset);
}
