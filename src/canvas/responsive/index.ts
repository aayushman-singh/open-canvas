// src/canvas/responsive/index.ts
//
// Public entry for the responsive subsystem.
//
// One function, `renderResponsiveCss(snapshot)`, consumed by
// `src/canvas/render.ts`. It returns a complete `<style>...</style>` block
// (or the empty string when no responsive CSS is needed). The renderer
// injects the result verbatim ahead of the `pagesHtml` body — see the
// single-hook insertion in `renderCanvasSnapshot`.
//
// The empty-string return is the "nothing to do" signal: when no element has
// an override AND every page already fits a phone viewport, emitting a style
// block would be incidental noise. We return '' so existing fixtures render
// byte-for-byte identical to the pre-responsive output. This is not a
// degraded mode — it is the correct output for a snapshot that does not need
// responsive scaling.

import type { CanvasElement, CanvasSection, PublishedSnapshot } from '../schema.js';

import { PHONE_MAX_PX, TABLET_MAX_PX } from './breakpoints.js';
import {
  buildResponsiveCssBody,
  buildResponsiveVariantCssBody,
  wrapInStyleBlock,
} from './css.js';
import { resolveSnapshotLayout } from './translate.js';

export { resolveElementBox, scaleFactor } from './translate.js';
export type {
  ResolvedBox,
  ResolvedElementLayout,
  ResolvedPageLayout,
  ResolvedSectionLayout,
} from './translate.js';

/**
 * Build the responsive `<style>` block for a Published Snapshot.
 *
 * Returns the empty string when the snapshot has zero `responsive` overrides
 * AND every page is narrow enough to already fit a phone viewport — emitting
 * a block in that case would only add noise without changing rendered
 * behaviour.
 */
// Cache the rendered CSS by snapshot identity. The publish path calls this
// once per page (via `buildPublishBroadcastPayload`'s loop) with the same
// snapshot object — without memoization that produces O(pages × elements)
// duplicate work and on big sites blows past the 30 s Worker CPU budget.
// Identity-keyed: callers that mutate a snapshot in place must build a new
// object, which they already do (PublishedSnapshot is constructed once per
// publish at publish.ts:219 and never mutated after).
//
// Scope: this cache is per-request only. A `PublishedSnapshot` is a fresh JS
// object every time it is read from the DB, so a public request that loads
// the same site again gets a new identity and a cold cache. The cache only
// pays off inside one `renderCanvasSnapshot` call tree (e.g. publish-time
// payload assembly looping over every page of the same snapshot object). The
// WeakMap guarantees the entry is collected when the snapshot is, so this
// will never hold references across requests.
const responsiveCssCache = new WeakMap<PublishedSnapshot, string>();

export function renderResponsiveCss(snapshot: PublishedSnapshot): string {
  const cached = responsiveCssCache.get(snapshot);
  if (cached !== undefined) return cached;
  const layouts = resolveSnapshotLayout(snapshot);
  const hasOverride = snapshotHasResponsiveOverride(snapshot);
  const hasVariants = snapshotHasResponsiveLayoutVariants(snapshot);
  const variantCss = hasVariants ? buildResponsiveVariantCssBody() : '';
  const body = buildResponsiveCssBody(layouts, hasOverride, variantCss);
  const result = wrapInStyleBlock(body) + (hasVariants ? renderResponsiveVariantRuntimeScript() : '');
  responsiveCssCache.set(snapshot, result);
  return result;
}

function snapshotHasResponsiveOverride(snapshot: PublishedSnapshot): boolean {
  // Site-wide header/footer are merged into every page's layout by
  // `resolveSnapshotLayout`, so a header- or footer-only override must also
  // trip the "needs CSS body" gate — otherwise phone-width pages whose only
  // overrides live in the shared chrome would skip emission entirely.
  if (snapshot.header !== undefined && sectionHasResponsiveOverride(snapshot.header)) return true;
  if (snapshot.footer !== undefined && sectionHasResponsiveOverride(snapshot.footer)) return true;
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      if (sectionHasResponsiveOverride(section)) return true;
    }
  }
  return false;
}

function sectionHasResponsiveOverride(section: { elements: CanvasElement[] }): boolean {
  for (const element of section.elements) {
    if (elementHasResponsiveOverride(element)) return true;
  }
  return false;
}

function snapshotHasResponsiveLayoutVariants(snapshot: PublishedSnapshot): boolean {
  if (snapshot.header !== undefined && sectionHasResponsiveLayoutVariants(snapshot.header)) return true;
  if (snapshot.footer !== undefined && sectionHasResponsiveLayoutVariants(snapshot.footer)) return true;
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      if (sectionHasResponsiveLayoutVariants(section)) return true;
    }
  }
  return false;
}

function sectionHasResponsiveLayoutVariants(section: CanvasSection): boolean {
  return Array.isArray(section.responsiveVariants) && section.responsiveVariants.length > 0;
}

function elementHasResponsiveOverride(element: CanvasElement): boolean {
  const r = element.responsive;
  if (r === undefined) return false;
  return r.tablet !== undefined || r.phone !== undefined;
}

function renderResponsiveVariantRuntimeScript(): string {
  const script =
    "(function(){var selector='[data-opencanvas-responsive-active]';" +
    "if(typeof window.matchMedia!=='function'){console.error('[opencanvas-responsive-variants] matchMedia unavailable');throw new Error('responsive variant runtime requires matchMedia');}" +
    `var tablet=window.matchMedia('(max-width: ${String(TABLET_MAX_PX)}px)');` +
    `var phone=window.matchMedia('(max-width: ${String(PHONE_MAX_PX)}px)');` +
    "function current(){return phone.matches?'phone':tablet.matches?'tablet':'desktop'}" +
    "function setActive(node,active){if(active){node.hidden=false;node.removeAttribute('hidden');node.removeAttribute('aria-hidden');node.inert=false;node.removeAttribute('inert')}else{node.hidden=true;node.setAttribute('hidden','');node.setAttribute('aria-hidden','true');node.inert=true;node.setAttribute('inert','')}}" +
    "function apply(){var bp=current();var nodes=document.querySelectorAll(selector);for(var i=0;i<nodes.length;i++){var node=nodes[i];var active=(' '+(node.getAttribute('data-opencanvas-responsive-active')||'')+' ').indexOf(' '+bp+' ')>=0;setActive(node,active)}};" +
    "tablet.addEventListener('change',apply);phone.addEventListener('change',apply);" +
    "if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',apply,{once:true})}else{apply()}" +
    "})();";
  return `<script data-opencanvas-responsive-variant-runtime>${script}</script>`;
}
