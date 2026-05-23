// src/symbols/master.ts
//
// Pure CRUD on `CanvasSiteState.symbols[]`. No DB, no HTTP, no Yjs — every
// function mutates (or, where noted, returns a fresh copy of) the in-memory
// CanvasSiteState passed in. The router in `route.ts` wraps these with the
// HTTP envelope; the editor calls them through the same router. Wave 4 #16
// (multi-page nav) imports `createSymbolMaster` directly per the brief.
//
// Symbol model summary (override-style — see plan 14-symbols.md):
//   - Master content lives once in `state.symbols[*]`.
//   - Instances live on pages as `SymbolInstanceElement` with `symbolId` +
//     per-element `overrides`. Merge happens at render time.
//   - Nested symbols are forbidden: a master's section must not itself
//     contain a `symbol-instance` element. `createSymbolMaster` /
//     `updateSymbolMaster` validate this and throw loudly.
//
// All failures throw `Error` with a message that names the offending id —
// the "all-or-nothing" posture in the user's global preferences.

import type {
  CanvasElement,
  CanvasSection,
  CanvasSiteState,
  SymbolMaster,
} from '../canvas/schema.js';
import type { SymbolInstanceElement } from '../canvas/elements/symbol-instance.js';

/**
 * Throws if any element in the given section (or descendants — we don't have
 * deep container nesting in the POC, but the helper is exhaustive) is a
 * `symbol-instance`. Used by create/update to enforce the no-nested-symbols
 * scope-out rule. We can't author a Symbol that itself contains an Instance —
 * that's a structural recursion hazard we explicitly forbid in the plan.
 */
function assertNoNestedSymbolInstances(section: CanvasSection, contextId: string): void {
  for (const el of section.elements) {
    if (el.type === 'symbol-instance') {
      throw new Error(
        `[symbols/master] nested symbols are forbidden: section "${contextId}" contains symbol-instance element "${el.id}" pointing at symbolId="${el.symbolId}"`,
      );
    }
  }
}

/**
 * Returns every `SymbolInstanceElement` on the site that points at `symbolId`.
 * Used by `deleteSymbolMaster` (refuse-if-instances-exist) and by
 * `detachAllInstancesOfSymbol` (the "detach all then delete" escape hatch).
 *
 * The result keeps the `symbolId` field even though it is by definition equal
 * to the input — callers may store/log the full element shape.
 */
export interface SymbolInstanceLocation {
  pageId: string;
  sectionId: string;
  /** Index inside `section.elements` — stable for in-place mutation. */
  elementIndex: number;
  element: SymbolInstanceElement;
}

export function findInstancesOfSymbol(
  state: CanvasSiteState,
  symbolId: string,
): SymbolInstanceLocation[] {
  const out: SymbolInstanceLocation[] = [];
  for (const page of state.pages) {
    for (const section of page.sections) {
      for (let i = 0; i < section.elements.length; i++) {
        const el = section.elements[i];
        if (!el) continue;
        if (el.type === 'symbol-instance' && el.symbolId === symbolId) {
          out.push({
            pageId: page.id,
            sectionId: section.id,
            elementIndex: i,
            element: el,
          });
        }
      }
    }
  }
  return out;
}

/** Find a master by id. Returns `undefined` when none matches. */
export function findSymbolMaster(
  state: CanvasSiteState,
  symbolId: string,
): SymbolMaster | undefined {
  return state.symbols.find((s) => s.id === symbolId);
}

/**
 * Generate a stable id for a new SymbolMaster. The id space `sym-` distinguishes
 * masters from sections (`sec-`) and elements (`el-`) elsewhere in the editor.
 */
export function newSymbolId(): string {
  // crypto.randomUUID is in the workerd + Bun globals; the rest of the repo
  // also uses it (see src/canvas/section-import.ts).
  return `sym-${crypto.randomUUID()}`;
}

export interface CreateSymbolMasterInput {
  /** Owner-supplied display name. Required, non-empty. */
  name: string;
  /**
   * The master content — a complete CanvasSection. The new master borrows the
   * section's id space-wise; the caller is responsible for picking section + inner
   * element ids that do not collide with existing pages (the editor command
   * "Convert to Symbol" passes the lifted section through unchanged, which
   * works because the section already had unique ids on the page).
   */
  section: CanvasSection;
  /** Optional explicit id. Defaults to `newSymbolId()`. */
  id?: string;
}

/**
 * Append a new SymbolMaster to `state.symbols`. Mutates `state` in place and
 * returns the inserted master.
 *
 * Validations:
 *   - `name` must be a non-empty string.
 *   - Master id must be unique across `state.symbols`.
 *   - `section` must not contain any nested `symbol-instance` element.
 */
export function createSymbolMaster(
  state: CanvasSiteState,
  input: CreateSymbolMasterInput,
): SymbolMaster {
  const name = input.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('[symbols/master] createSymbolMaster: name must be a non-empty string');
  }
  if (!input.section || typeof input.section !== 'object') {
    throw new Error('[symbols/master] createSymbolMaster: section must be a CanvasSection object');
  }

  const id = input.id ?? newSymbolId();
  if (state.symbols.some((s) => s.id === id)) {
    throw new Error(`[symbols/master] createSymbolMaster: symbol id "${id}" already exists`);
  }
  assertNoNestedSymbolInstances(input.section, id);

  const master: SymbolMaster = { id, name, section: input.section };
  state.symbols.push(master);
  return master;
}

export interface UpdateSymbolMasterInput {
  /** When provided, replaces the master's display name. */
  name?: string;
  /** When provided, replaces the entire master section. */
  section?: CanvasSection;
}

/**
 * Patch an existing master. Mutates `state` in place. Returns the updated master.
 *
 * Validations:
 *   - Master with given id must exist.
 *   - `name`, if present, must be a non-empty string.
 *   - `section`, if present, must not contain a nested `symbol-instance`.
 */
export function updateSymbolMaster(
  state: CanvasSiteState,
  symbolId: string,
  patch: UpdateSymbolMasterInput,
): SymbolMaster {
  const master = findSymbolMaster(state, symbolId);
  if (!master) {
    throw new Error(`[symbols/master] updateSymbolMaster: unknown symbol id "${symbolId}"`);
  }
  if (patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.length === 0) {
      throw new Error(
        `[symbols/master] updateSymbolMaster: name must be a non-empty string when present`,
      );
    }
    master.name = patch.name;
  }
  if (patch.section !== undefined) {
    if (typeof patch.section !== 'object' || patch.section === null) {
      throw new Error(
        `[symbols/master] updateSymbolMaster: section must be a CanvasSection object when present`,
      );
    }
    assertNoNestedSymbolInstances(patch.section, symbolId);
    master.section = patch.section;
  }
  return master;
}

/**
 * Refuse-if-instances-exist deletion. Mutates `state` in place. Returns the
 * removed master.
 *
 * The plan demands a loud failure when active instances exist; the API caller
 * can then offer "Detach all instances to copies" before retrying. The
 * companion `detachAllInstancesOfSymbol` (in `detach.ts`) is what the "detach
 * all" UI path drives before the second delete attempt.
 *
 * Validations:
 *   - Master with given id must exist.
 *   - No `symbol-instance` element on any page must reference this id.
 */
export function deleteSymbolMaster(
  state: CanvasSiteState,
  symbolId: string,
): SymbolMaster {
  const idx = state.symbols.findIndex((s) => s.id === symbolId);
  if (idx < 0) {
    throw new Error(`[symbols/master] deleteSymbolMaster: unknown symbol id "${symbolId}"`);
  }
  const instances = findInstancesOfSymbol(state, symbolId);
  if (instances.length > 0) {
    const locations = instances
      .map((loc) => `${loc.pageId}/${loc.sectionId}#${loc.element.id}`)
      .join(', ');
    throw new Error(
      `[symbols/master] deleteSymbolMaster: refused — symbol "${symbolId}" still has ${String(
        instances.length,
      )} instance(s) at ${locations}. Detach or remove them first.`,
    );
  }
  const removed = state.symbols[idx];
  if (!removed) {
    // findIndex returned >= 0 above so this is unreachable, but TypeScript's
    // noUncheckedIndexedAccess insists on the narrowing.
    throw new Error(
      `[symbols/master] deleteSymbolMaster: index ${String(idx)} resolved to undefined for symbolId "${symbolId}"`,
    );
  }
  state.symbols.splice(idx, 1);
  return removed;
}

/**
 * Type guard for `SymbolInstanceElement` on the union. Kept here (not in the
 * element file) because every symbols module needs it and importing it from
 * one of the cousin modules would create a needless cycle.
 */
export function isSymbolInstanceElement(
  el: CanvasElement,
): el is SymbolInstanceElement {
  return el.type === 'symbol-instance';
}
