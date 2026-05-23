// src/symbols/instance.ts
//
// Pure factories for `SymbolInstanceElement` plus the override-mutator helpers
// the editor calls when an Owner edits a field on an instance.
//
// The merge step itself lives in `merge.ts` — this file only produces /
// mutates instances; it does not look up masters or render anything.

import type {
  CanvasElement,
  CanvasSiteState,
  PositionedBox,
} from '../canvas/schema.js';
import type {
  SymbolInstanceElement,
  SymbolInstanceOverrides,
} from '../canvas/elements/symbol-instance.js';
import { findSymbolMaster } from './master.js';

export interface CreateSymbolInstanceInput {
  /** Master id this instance points at. The master must exist on `state`. */
  symbolId: string;
  /** Positioned box for the instance wrapper on the host section. */
  box: PositionedBox;
  /** Optional explicit element id. Defaults to a fresh `el-sym-<uuid>`. */
  id?: string;
  /** Optional seed overrides. Defaults to empty `{}`. */
  overrides?: SymbolInstanceOverrides;
}

export function newSymbolInstanceElementId(): string {
  return `el-sym-${crypto.randomUUID()}`;
}

/**
 * Build a `SymbolInstanceElement`. Verifies the master exists on the given
 * state — passing a `symbolId` that resolves to no master is an
 * immediate-throw because the render fn would do the same and we'd rather the
 * Owner see the error at the editor command site than at publish time.
 */
export function createSymbolInstance(
  state: CanvasSiteState,
  input: CreateSymbolInstanceInput,
): SymbolInstanceElement {
  const master = findSymbolMaster(state, input.symbolId);
  if (!master) {
    throw new Error(
      `[symbols/instance] createSymbolInstance: unknown symbol id "${input.symbolId}" — no SymbolMaster registered on this site`,
    );
  }
  const id = input.id ?? newSymbolInstanceElementId();
  const overrides = input.overrides ?? {};
  return {
    id,
    type: 'symbol-instance',
    box: input.box,
    symbolId: input.symbolId,
    overrides,
  };
}

/**
 * Apply (or replace) an override for one inner element id. Mutates the instance.
 *
 * Precedence is "last write wins for the inner element key" — calling this
 * twice with the same `innerElementId` replaces the prior patch entirely. The
 * editor surfaces a Reset button (see `clearOverride` below) to revert.
 *
 * Validations:
 *   - `innerElementId` must be a non-empty string.
 *   - `patch` must be an object (allows `{}` which is a no-op override and is
 *     pruned on the next normalisation pass).
 */
export function setOverride(
  instance: SymbolInstanceElement,
  innerElementId: string,
  patch: Partial<CanvasElement>,
): void {
  if (typeof innerElementId !== 'string' || innerElementId.length === 0) {
    throw new Error(
      `[symbols/instance] setOverride: innerElementId must be a non-empty string (got ${JSON.stringify(innerElementId)})`,
    );
  }
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error(
      `[symbols/instance] setOverride: patch must be a non-array object for innerElementId "${innerElementId}"`,
    );
  }
  instance.overrides[innerElementId] = patch;
}

/**
 * Remove an override for one inner element id. Mutates the instance. Returns
 * `true` when the key existed, `false` when it did not (no-op safe).
 *
 * "Reset to master" in the editor calls this with the inner id; the merger
 * then yields the unmodified master field for that element on the next render.
 */
export function clearOverride(
  instance: SymbolInstanceElement,
  innerElementId: string,
): boolean {
  if (!(innerElementId in instance.overrides)) return false;
  delete instance.overrides[innerElementId];
  return true;
}

/** Convenience getter — returns the patch for an inner id, or `undefined`. */
export function getOverride(
  instance: SymbolInstanceElement,
  innerElementId: string,
): Partial<CanvasElement> | undefined {
  return instance.overrides[innerElementId];
}
