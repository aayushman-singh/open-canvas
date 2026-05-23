// src/symbols/detach.ts
//
// "Detach Instance" — replace a `SymbolInstanceElement` with a plain
// `container` placeholder that owns its own copy of the master's merged
// section content as page sections… not quite. A Symbol Instance lives at
// the ELEMENT level, but masters describe a whole Section. Detaching has to
// reconcile that: per the plan, the contract is "convert Instance back to a
// plain Section copy (inlines master + overrides)."
//
// Concretely the detach operation:
//
//   1. Resolves the instance against its master via `resolveSymbolInstance`,
//      producing the effective `CanvasSection` (master + overrides applied).
//   2. Finds the host section + page where the instance currently lives.
//   3. Replaces the host section with the resolved section in place. The
//      detached section keeps its page position. The instance element wrapper
//      is gone — the section's elements become first-class members of the page.
//
// Why we replace the host SECTION, not the element: an instance is rendered
// AS a section (its inner master section's elements become the rendered
// content), so detaching collapses the instance wrapper into a real section
// node. The plan says "convert Instance back to a plain Section copy" — this
// is the only consistent interpretation.
//
// To keep ids unique across the site after detach (the validator rejects
// duplicate ids inside a single page), every element id inside the detached
// section is re-generated with a fresh `el-<uuid>` prefix and the section id
// itself is re-generated with `sec-<uuid>`. The override-keyed addressing
// breaks after detach because there is no longer a "master" — the detached
// copy is fully editable in place.
//
// Bulk variant — `detachAllInstancesOfSymbol` — drives the "Detach all
// instances to copies" UX path. It walks every page, replaces each instance's
// host section, then returns the number of instances detached so the caller
// can attempt `deleteSymbolMaster` next.

import type { CanvasSection, CanvasSiteState } from '../canvas/schema.js';
import type { SymbolInstanceElement } from '../canvas/elements/symbol-instance.js';
import { findInstancesOfSymbol } from './master.js';
import { resolveSymbolInstance } from './merge.js';

function newSectionId(): string {
  return `sec-${crypto.randomUUID()}`;
}

function newElementId(): string {
  return `el-${crypto.randomUUID()}`;
}

/**
 * Locate the host section + page for an instance by element id. Returns
 * `undefined` when the instance is not on any page (already detached or
 * orphan). Mutates nothing.
 */
interface InstanceLocation {
  pageIdx: number;
  sectionIdx: number;
  elementIdx: number;
  instance: SymbolInstanceElement;
  hostSection: CanvasSection;
}

function locateInstance(
  state: CanvasSiteState,
  instanceElementId: string,
): InstanceLocation | undefined {
  for (let p = 0; p < state.pages.length; p++) {
    const page = state.pages[p];
    if (!page) continue;
    for (let s = 0; s < page.sections.length; s++) {
      const section = page.sections[s];
      if (!section) continue;
      for (let e = 0; e < section.elements.length; e++) {
        const el = section.elements[e];
        if (!el) continue;
        if (el.type === 'symbol-instance' && el.id === instanceElementId) {
          return {
            pageIdx: p,
            sectionIdx: s,
            elementIdx: e,
            instance: el,
            hostSection: section,
          };
        }
      }
    }
  }
  return undefined;
}

/**
 * Detach a single instance: replace its host SECTION with a fresh CanvasSection
 * that is the resolved (master+overrides) content of the instance. All ids in
 * the new section (section id + inner element ids) are regenerated to avoid
 * collisions on the page after detach.
 *
 * Throws when the instance cannot be located or the symbolId is unknown.
 * Mutates `state` in place. Returns the new (detached) CanvasSection.
 */
export function detachInstance(
  state: CanvasSiteState,
  instanceElementId: string,
): CanvasSection {
  const loc = locateInstance(state, instanceElementId);
  if (!loc) {
    throw new Error(
      `[symbols/detach] detachInstance: no SymbolInstanceElement with id "${instanceElementId}" on this site`,
    );
  }
  const resolved = resolveSymbolInstance(loc.instance, state);
  // Regenerate ids — the resolved section currently carries the instance id
  // (per the merge rule) and the master's inner element ids. Both must become
  // fresh after detach so subsequent detaches of OTHER instances of the same
  // symbol don't collide with this one's element ids.
  resolved.id = newSectionId();
  for (let i = 0; i < resolved.elements.length; i++) {
    const el = resolved.elements[i];
    if (!el) continue;
    el.id = newElementId();
  }

  // Replace the host section in place. The host section is the WHOLE section
  // the instance was sitting in — detaching means the instance's resolved
  // content becomes the page's section at that index.
  const page = state.pages[loc.pageIdx];
  if (!page) {
    throw new Error(
      `[symbols/detach] detachInstance: page index ${String(loc.pageIdx)} disappeared mid-detach`,
    );
  }
  page.sections[loc.sectionIdx] = resolved;
  return resolved;
}

/**
 * Detach EVERY instance of the given symbol across the entire site. Returns
 * the list of newly-detached sections (one per instance). Mutates `state` in
 * place. Safe to call when no instances exist — returns an empty array.
 *
 * Typical UX: Owner asks to delete a master that still has instances; we
 * surface the count + names, they confirm "Detach all & delete", we call this
 * then `deleteSymbolMaster` in sequence.
 */
export function detachAllInstancesOfSymbol(
  state: CanvasSiteState,
  symbolId: string,
): CanvasSection[] {
  const locations = findInstancesOfSymbol(state, symbolId);
  const out: CanvasSection[] = [];
  for (const loc of locations) {
    out.push(detachInstance(state, loc.element.id));
  }
  return out;
}
