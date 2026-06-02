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
import { getStyleKitPreset } from '../canvas/style-kits.js';

const SECTION_HEIGHT_MAX = 1400;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setElementField(element: CanvasElement, key: string, value: unknown): void {
  const target = element as CanvasElement & Record<string, unknown>;
  target[key] = value;
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
  | { kind: 'setSiteConfig'; patch: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Helpers — search across all pages, header, and footer
// ---------------------------------------------------------------------------

function findElementAcrossSite(
  state: EditableSite,
  elementId: string,
): { element: CanvasElement; section: CanvasSection } {
  // Check header
  if (state.header) {
    for (const el of state.header.elements) {
      if (el.id === elementId) return { element: el, section: state.header };
    }
  }
  // Check footer
  if (state.footer) {
    for (const el of state.footer.elements) {
      if (el.id === elementId) return { element: el, section: state.footer };
    }
  }
  // Check all pages
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (const el of section.elements) {
        if (el.id === elementId) return { element: el, section };
      }
    }
  }
  throw new Error(`element not found: ${elementId}`);
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
      const target = next.pages.find((p) =>
        p.sections.some((s) => s.id === opAfterSectionId),
      );
      if (!target) {
        throw new Error(
          `applyCanvasAgentOp(${kindLabel}): afterSectionId not found on any page: ${opAfterSectionId}`,
        );
      }
      return { page: target };
    }
    return { page };
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
    const preset = getStyleKitPreset(next.styleKit);
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
    const { section } = findElementAcrossSite(next, op.elementId);
    const idx = section.elements.findIndex((e) => e.id === op.elementId);
    if (idx < 0) {
      throw new Error(`deleteElement: element not found in section: ${op.elementId}`);
    }
    section.elements.splice(idx, 1);
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
    const sharedKeys = new Set(['box', 'motion', 'elementStyle', 'responsive']);
    for (const [key, value] of Object.entries(patch)) {
      if (!sharedKeys.has(key) && value !== undefined) {
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
    for (const el of clone.elements) {
      const prefix = el.id.includes('-') ? el.id.split('-').slice(0, -1).join('-') : 'el';
      el.id = `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    }
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
      for (const element of section.elements) {
        if (
          element.type === 'action' &&
          typeof element.href === 'object' &&
          element.href !== null &&
          element.href.type === 'page' &&
          element.href.pageId === deletedPageId
        ) {
          element.href = { type: 'external', url: '#' };
        }
      }
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
  const preset = getStyleKitPreset(state.styleKit);
  return resolveDesignSection(input, page.width, preset);
}
