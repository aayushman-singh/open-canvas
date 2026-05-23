// src/canvas/elements/symbol-instance.ts
//
// `SymbolInstanceElement` interface + render fn (Wave 3 #14).
//
// A Symbol Instance is a render-time projection of a `SymbolMaster` (declared
// in `src/canvas/schema.ts`) plus a sparse override map keyed by inner element
// id. The render fn does the deep-resolve via `src/symbols/merge.ts`, then
// emits the merged section's elements through the standard wrappers.
//
// ---------------------------------------------------------------------------
// SITE-STATE INJECTION
//
// The Phase 0 `ElementRenderCtx` (in `./index.ts`) is FROZEN — it carries
// `assetBasePath`, `styleKit`, `siteId`, `pageSlug` but no symbols array.
// Resolving an instance against its master needs the site's `symbols[]`.
//
// We use the same pattern as `configureFormRender` (in `./form.ts`): a
// module-local configuration object that the main thread populates BEFORE
// rendering a snapshot, then `RENDER_DISPATCH['symbol-instance']` (in
// `./index.ts`, frozen) calls our render fn with the dispatcher's ctx and we
// read the symbols from module-local config.
//
// Main-thread integration (one of `src/index.ts` / `src/routes/api/publish.ts`
// / `src/routes/public.ts`):
//
//   import { configureSymbolInstanceRender } from './canvas/elements/symbol-instance.js';
//   // Per request — before renderCanvasSnapshot(snapshot, ...)
//   configureSymbolInstanceRender({ symbols: snapshot.symbols ?? [] });
//
// The configure call is synchronous and idempotent. Calling it with `null`
// clears the configuration; subsequent renders throw loudly until reconfigured.
// This is the all-or-nothing posture — there is no silent "render an empty
// section if symbols aren't wired up" fallback.
//
// ---------------------------------------------------------------------------
// HOW THE INNER ELEMENTS RENDER
//
// The dispatcher in `src/canvas/render.ts` wraps EVERY element with a
// `<div class="rev01-element" ...>` whose position/size comes from
// `element.box`. For a Symbol Instance, that wrapper is the page slot the
// Owner picked. We render the inner content inside an additional
// relatively-positioned wrapper; each inner element gets its own
// absolutely-positioned wrapper that mirrors the format from
// `src/canvas/render.ts` so motion / aria / variant attributes round-trip.

import { resolveSymbolInstance } from '../../symbols/merge.js';
import type { BaseElement, CanvasElement, SymbolMaster } from '../schema.js';
import {
  escapeAttr,
  escapeCssValue,
  sanitiseCssKey,
  styleFromEntries,
} from './render-utils.js';

/**
 * Map from inner element id (inside the SymbolMaster's section) to a partial
 * patch of that element. The patch is shallow-merged at render time — nested
 * compound objects (`box`, `motion`, `pinnedStyle`, `responsive`, `content`,
 * etc.) are replaced WHOLE when present in the patch, not recursively merged.
 * Adding or removing inner elements via override is not allowed — a
 * structural difference requires authoring a new symbol.
 *
 * See the MERGE PRECEDENCE block in `src/symbols/merge.ts` for the exact rule.
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

// ---------------------------------------------------------------------------
// Module-local configuration — see SITE-STATE INJECTION block above.
// ---------------------------------------------------------------------------

interface SymbolInstanceRenderConfig {
  /** Site symbols available to the resolver. `null` means "not configured". */
  symbols: ReadonlyArray<SymbolMaster> | null;
}

const config: SymbolInstanceRenderConfig = {
  symbols: null,
};

/**
 * Wire the render fn with the current site's symbols. Call BEFORE invoking
 * `renderCanvasSnapshot` on a snapshot that may contain symbol-instance
 * elements. Pass `null` to clear (testing / between requests).
 *
 * Failure posture: renders THROW if a symbol-instance element is encountered
 * while `symbols` is `null`. There is no silent skip.
 */
export function configureSymbolInstanceRender(next: {
  symbols: ReadonlyArray<SymbolMaster> | null;
}): void {
  config.symbols = next.symbols;
}

/** @internal Exposed only for the smoke. */
export function getSymbolInstanceRenderConfigForTest(): Readonly<SymbolInstanceRenderConfig> {
  return config;
}

// ---------------------------------------------------------------------------
// Local wrapper helpers — copy of the small wrapper builders from
// `src/canvas/render.ts` scoped down to what an inner element needs. We can't
// import them from render.ts (the dispatcher) without creating an import
// cycle, and they aren't in `render-utils.ts` because they live closer to the
// dispatcher. Both versions stay deliberately small + identical so a future
// refactor can hoist them into `render-utils.ts` with a single edit.
// ---------------------------------------------------------------------------

function buildInnerWrapperStyle(element: CanvasElement): string {
  const { box } = element;
  const entries: Array<[string, string]> = [
    ['position', 'absolute'],
    ['left', `${String(box.x)}px`],
    ['top', `${String(box.y)}px`],
    ['width', `${String(box.w)}px`],
    ['height', `${String(box.h)}px`],
    ['z-index', String(box.z)],
  ];
  if (typeof box.rotation === 'number' && box.rotation !== 0) {
    entries.push(['transform', `rotate(${String(box.rotation)}deg)`]);
  }
  if (element.pinnedStyle) {
    for (const [k, v] of Object.entries(element.pinnedStyle)) {
      const safeKey = sanitiseCssKey(k);
      if (safeKey === '') continue;
      const safeValue = escapeCssValue(v);
      if (safeValue === '') continue;
      entries.push([safeKey, safeValue]);
    }
  }
  return styleFromEntries(entries);
}

function ariaAttrsFor(element: CanvasElement): string {
  switch (element.type) {
    case 'shape':
    case 'container':
      return ' aria-hidden="true" role="presentation"';
    case 'media':
      return element.alt === '' ? ' aria-hidden="true"' : '';
    default:
      return '';
  }
}

function variantAttrFor(element: CanvasElement): string {
  switch (element.type) {
    case 'action':
    case 'shape':
    case 'container':
      return ` data-variant="${escapeAttr(element.variant)}"`;
    case 'text':
      return ` data-role="${escapeAttr(element.role)}"`;
    case 'chart':
      return ` data-variant="${escapeAttr(element.kind)}"`;
    case 'code':
      return ` data-variant="${escapeAttr(element.language)}"`;
    default:
      return '';
  }
}

function motionAttrsFor(element: CanvasElement): string {
  if (element.motion === undefined) return '';
  return ` data-motion-preset="${escapeAttr(element.motion.preset)}" data-motion-delay-ms="${escapeAttr(String(element.motion.delayMs ?? 0))}"`;
}

export function renderSymbolInstance(
  el: SymbolInstanceElement,
  ctx: SymbolInstanceRenderCtx,
): string {
  // Defence-in-depth: a missing configuration is a programmer error at the
  // dispatcher boundary, not a recoverable runtime condition. Throw loudly
  // with the offending instance + symbol id so the error log identifies the
  // exact site element that triggered the unconfigured render.
  if (config.symbols === null) {
    throw new Error(
      `[symbols/render] renderSymbolInstance: site symbols not configured for instance "${el.id}" (symbolId="${el.symbolId}") — main thread must call configureSymbolInstanceRender({ symbols }) before rendering`,
    );
  }
  // resolveSymbolInstance throws loudly with the offending symbolId when the
  // master is missing — see merge.ts MERGE PRECEDENCE docs.
  const resolved = resolveSymbolInstance(el, { symbols: config.symbols });

  // Lazy lookup of the dispatch table — see registryAccessor() below for the
  // cycle-breaking explanation.
  const dispatch = getRenderDispatch();

  // Inner-render ctx: the dispatcher hands us `(styleKit, assetBasePath)`
  // through the Phase 0 frozen surface, but the dispatch table itself wants
  // the full `ElementRenderCtx`. We fabricate the missing siteId/pageSlug as
  // empty strings — the renderers that need them (form) document the visitor-
  // facing failure modes when they're missing. The main thread is expected to
  // wire them up via the dispatcher; symbols deliberately stay agnostic.
  const innerCtx = {
    styleKit: ctx.styleKit,
    assetBasePath: ctx.assetBasePath,
    siteId: '',
    pageSlug: '',
  };

  const innerHtml = resolved.elements
    .map((inner) => {
      const fn = dispatch[inner.type] as (
        elArg: CanvasElement,
        innerCtxArg: typeof innerCtx,
      ) => string;
      const body = fn(inner, innerCtx);
      const wrapperStyle = buildInnerWrapperStyle(inner);
      const motionAttrs = motionAttrsFor(inner);
      const ariaAttrs = ariaAttrsFor(inner);
      const variant = variantAttrFor(inner);
      return `<div class="rev01-element" data-rev01-element="${escapeAttr(inner.id)}" data-element-type="${escapeAttr(inner.type)}"${variant}${motionAttrs}${ariaAttrs} style="${wrapperStyle}">${body}</div>`;
    })
    .join('');

  // The outer wrapper fills the element box (set by the dispatcher) and
  // provides positioning context for the inner elements. data-rev01-symbol-id
  // lets visitor-side tooling tell which master rendered into which spot —
  // useful for a11y audits and analytics. data-rev01-resolved-section carries
  // the resolved section id (= the instance element id, per merge rule 3).
  const wrapperStyle = styleFromEntries([
    ['position', 'relative'],
    ['width', '100%'],
    ['height', '100%'],
  ]);
  return `<div class="rev01-symbol-instance" data-rev01-symbol-id="${escapeAttr(el.symbolId)}" data-rev01-resolved-section="${escapeAttr(resolved.id)}" data-recipe="${escapeAttr(resolved.recipeId)}" style="${wrapperStyle}">${innerHtml}</div>`;
}

// ---------------------------------------------------------------------------
// Lazy dispatch lookup to keep the static import graph one-way.
//
// `./index.ts` imports `renderSymbolInstance` from THIS file at module-init.
// We need to call back into `RENDER_DISPATCH` at run time. A top-level value
// import would create a cycle that resolves to `undefined` at this file's
// init point (because index.ts is still constructing RENDER_DISPATCH when it
// imports us). Using the namespace import + a lazy getter lets the value be
// read at call time, by which point the registry is fully populated.
// ---------------------------------------------------------------------------

import * as elementsRegistry from './index.js';

type DispatchShape = Record<string, (el: CanvasElement, ctx: unknown) => string>;

let cachedDispatch: DispatchShape | null = null;
function getRenderDispatch(): DispatchShape {
  if (cachedDispatch) return cachedDispatch;
  cachedDispatch = elementsRegistry.RENDER_DISPATCH as unknown as DispatchShape;
  return cachedDispatch;
}
