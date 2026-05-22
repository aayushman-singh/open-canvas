// src/canvas/elements/symbol-instance.ts
//
// Phase 0 stub. `SymbolInstanceElement` interface + render stub. Wave 3 owner:
// see docs/superpowers/plans/2026-05-23-14-symbols.md.
//
// A Symbol Instance is a render-time projection of a SymbolMaster (declared in
// `src/canvas/schema.ts`) plus a sparse override map keyed by inner element
// id. The render fn (filled by Wave 3) deep-merges the master section with
// `overrides` and then defers to the section/element renderers.

import type { BaseElement, CanvasElement } from '../schema.js';

/**
 * Map from inner element id (inside the SymbolMaster's section) to a partial
 * patch of that element. The patch is shallow-merged at render time. Adding
 * or removing inner elements via override is not allowed — a structural
 * difference requires authoring a new symbol. Validators enforce this.
 */
export type SymbolInstanceOverrides = Record<string, Partial<CanvasElement>>;

export interface SymbolInstanceElement extends BaseElement {
  type: 'symbol-instance';
  symbolId: string;
  overrides: SymbolInstanceOverrides;
}

export interface SymbolInstanceRenderCtx {
  styleKit: string;
  assetBasePath: string;
}

export function renderSymbolInstance(
  el: SymbolInstanceElement,
  ctx: SymbolInstanceRenderCtx,
): string {
  void el;
  void ctx;
  throw new Error(
    'TODO: implement in Wave 3 — see docs/superpowers/plans/2026-05-23-14-symbols.md',
  );
}
