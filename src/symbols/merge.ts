// src/symbols/merge.ts
//
// Pure resolver: given a `SymbolInstanceElement` and the surrounding
// `CanvasSiteState`, produce the fully-merged `CanvasSection` that the
// renderer should emit for that instance. The renderer (in
// `src/canvas/elements/symbol-instance.ts`) calls this then loops over the
// resulting section's elements through the standard `RENDER_DISPATCH`.
//
// ---------------------------------------------------------------------------
// MERGE PRECEDENCE — frozen contract (Wave 4 #16 nav and the publisher both
// depend on this rule):
//
//   1. Start from the master section identified by `instance.symbolId`. The
//      master is deep-cloned via structuredClone so the resolver never mutates
//      shared state.
//   2. The clone inherits the master section's id, recipeId, name, height,
//      backgroundEffect, entrance, and elements ARRAY exactly.
//   3. The clone's `id` is RE-ASSIGNED to the *instance* element id. This is
//      so the rendered <section> wrapper carries the page-specific data attr
//      (`data-rev01-section="<instance.id>"`) and the publisher's id-uniqueness
//      invariant per page holds (a single master rendered into N pages would
//      otherwise emit N sections with the same id).
//   4. For each inner element in the cloned section, look up
//      `instance.overrides[el.id]` (key = the *master's* inner element id —
//      the editor writes overrides keyed by the master id, not a per-instance
//      id). If a patch is present:
//      4a. SHALLOW MERGE the patch over the cloned element using
//          `Object.assign(clone, patch)`. The override is one level deep —
//          nested compound objects like `box`, `motion`, `pinnedStyle`,
//          `responsive`, `content`, etc. are REPLACED WHOLE when present in
//          the patch, NOT recursively merged. This is the documented rule;
//          deviating from it makes the override semantics ambiguous (does a
//          partial `box` override merge x but not y, or replace whole?).
//      4b. The patch may NOT change `type` or `id`. We strip those keys
//          defensively before assigning — the Owner cannot turn a text inner
//          element into a media inner element via override, and renaming the
//          id would break override-key matching across instances. Validation
//          should reject these patches earlier; this is defence-in-depth.
//   5. Adding or removing inner elements via overrides is NOT supported. The
//      cloned `elements` array length equals the master's. If the Owner needs
//      structural divergence, they author a new symbol (per the plan).
//
// Nested symbols are forbidden by `master.ts`'s create/update validators, so
// the resolver does not recurse on inner `symbol-instance` elements — it
// will throw if one is encountered (defence in depth).
//
// Missing master id: throws loudly with the offending symbolId in the message.
// This is the "all-or-nothing" posture — there is no silent fallback to an
// empty section.

import type {
  CanvasSection,
  CanvasSiteState,
  SymbolMaster,
} from '../canvas/schema.js';
import type { SymbolInstanceElement } from '../canvas/elements/symbol-instance.js';
import { findSymbolMaster } from './master.js';

/**
 * Resolve a SymbolInstanceElement against the site's masters, returning the
 * effective CanvasSection that should be rendered in its place.
 *
 * @throws Error when `instance.symbolId` references no master on `state`.
 * @throws Error when the master section (or merged result) contains a nested
 *   `symbol-instance` element — nested symbols are forbidden by scope.
 */
export function resolveSymbolInstance(
  instance: SymbolInstanceElement,
  state: { symbols: ReadonlyArray<SymbolMaster> },
): CanvasSection {
  const master = findSymbolMaster(state as CanvasSiteState, instance.symbolId);
  if (!master) {
    const known = state.symbols.map((s) => s.id).join(', ') || '<none>';
    throw new Error(
      `[symbols/merge] resolveSymbolInstance: instance "${instance.id}" points at unknown symbolId "${instance.symbolId}" — known masters: [${known}]`,
    );
  }

  // structuredClone is available in both workerd and Bun and handles the full
  // CanvasSection tree (numbers, strings, plain objects, arrays) deterministically.
  const merged: CanvasSection = structuredClone(master.section);
  // Re-stamp the section id with the instance's element id so the renderer's
  // wrapper carries the page-unique value (rule (3) above).
  merged.id = instance.id;

  for (let i = 0; i < merged.elements.length; i++) {
    const el = merged.elements[i];
    if (!el) continue;
    if (el.type === 'symbol-instance') {
      // Defence in depth — `master.ts` validators forbid nested symbols.
      throw new Error(
        `[symbols/merge] resolveSymbolInstance: master section "${master.id}" contains a nested symbol-instance element "${el.id}" — nested symbols are forbidden`,
      );
    }
    const patch = instance.overrides[el.id];
    if (!patch) continue;
    // Defence in depth: never let the override change `type` or `id`. If the
    // override happens to carry them (perhaps from a sloppy editor write),
    // strip before merging. The result is the master's type/id wins always.
    //
    // Object.assign with a fresh object so we don't mutate the caller's patch.
    const safePatch: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
    delete safePatch.type;
    delete safePatch.id;
    Object.assign(el, safePatch);
    // We mutated `el` in place; the array slot keeps the original reference,
    // so no reassignment is needed.
  }

  return merged;
}
