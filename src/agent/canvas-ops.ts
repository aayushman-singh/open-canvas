// src/agent/canvas-ops.ts
//
// Pure agent-op layer for the Canvas AI flow (T7). Defines the small union of
// operations the canvas agent can request and a single `applyCanvasAgentOp`
// function that produces a new `CanvasSiteState` for each op. The function is
// pure: it deep-clones the input state via `structuredClone`, mutates the
// clone, and returns it. The caller is responsible for revalidating the
// result with `validateCanvasSiteState`.
//
// The agent NEVER hand-writes canvas section JSON. `insertSection` carries
// only a `recipeId` plus a `RecipeFactoryInput`; the apply function calls
// `createSectionFromRecipe` itself. This is the structural guarantee that
// constrains generated sections to known recipe shapes.
//
// Failure mode is loud throughout: missing pages, unknown element ids,
// type mismatches, and unknown recipe ids all throw with a context-rich
// message that the route turns into a 400 with the message body.

import {
  createSectionFromRecipe,
  type RecipeFactoryInput,
} from '../canvas/recipes.js';
import type {
  CanvasSiteState,
  InlineRun,
  MediaKind,
  SectionRecipeId,
} from '../canvas/schema.js';

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
      afterSectionId: string | null;
      recipeId: SectionRecipeId;
      input: RecipeFactoryInput;
    };

/**
 * Apply a single agent op to a `CanvasSiteState`. The input is left untouched
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
export function applyCanvasAgentOp(
  state: CanvasSiteState,
  op: CanvasAgentOp,
): CanvasSiteState {
  const next = structuredClone(state);
  const page = next.pages[0];
  if (!page) {
    throw new Error('applyCanvasAgentOp: state must have at least one page');
  }

  if (op.kind === 'rewriteText') {
    if (!Array.isArray(op.content)) {
      throw new Error(
        `applyCanvasAgentOp(rewriteText): content must be an InlineRun[] (got ${typeof op.content})`,
      );
    }
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id !== op.elementId) continue;
        if (element.type !== 'text') {
          throw new Error(
            `applyCanvasAgentOp(rewriteText): element ${op.elementId} is type ${element.type}, expected text`,
          );
        }
        element.content = op.content;
        return next;
      }
    }
    throw new Error(`applyCanvasAgentOp(rewriteText): text element not found: ${op.elementId}`);
  }

  if (op.kind === 'replaceMedia') {
    for (const section of page.sections) {
      for (const element of section.elements) {
        if (element.id !== op.elementId) continue;
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
    }
    throw new Error(`applyCanvasAgentOp(replaceMedia): media element not found: ${op.elementId}`);
  }

  // insertSection — the factory authors the section so the LLM cannot smuggle
  // a hand-rolled shape past the validator.
  const section = createSectionFromRecipe(op.recipeId, op.input);
  if (op.afterSectionId === null) {
    page.sections.push(section);
    return next;
  }
  const idx = page.sections.findIndex((s) => s.id === op.afterSectionId);
  if (idx < 0) {
    throw new Error(
      `applyCanvasAgentOp(insertSection): afterSectionId not found: ${op.afterSectionId}`,
    );
  }
  page.sections.splice(idx + 1, 0, section);
  return next;
}
