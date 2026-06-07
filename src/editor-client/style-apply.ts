// src/editor-client/style-apply.ts
//
// ADR 0058 Phase 2q.d — wrapper-style application for editor elements.
// Extracted from canvas-client.ts:2609-2684. The inline IIFE twin remains
// the production source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// Three functions:
//   - setBoxStyleImpl: write a PositionedBox onto a wrapper as absolute
//     positioning + transform. setBoxStyle was previously forward-declared
//     on ctx (Phase 2l) for autoGrowTextElements; Phase 2q.d collapses the
//     forward decl into the real implementation here.
//   - applyElementStyleImpl: mirror element.elementStyle fields onto the
//     wrapper as inline styles. Mirrors the public renderer's stamping
//     (src/canvas/render.ts) so the editor preview and the published HTML
//     agree visually.
//   - applyPinnedStyleImpl: write owner-pinned CSS overrides onto the
//     wrapper after the strict allowlist check. The server's validate.ts
//     pinnedStyleValueIssue rejects on overlapping rules at PUT time; this
//     filter is the editor's local pre-flight so a forbidden value never
//     renders even before save. If you change either rule, mirror it in
//     validate.ts or the editor will accept what the server rejects.
//
// Failure mode preserved: silent-skip on invalid pinnedStyle keys/values
// (the allowlist filter is the only safe rejection path — throwing here
// would surface the validate.ts contract to the Owner mid-edit). All
// other paths short-circuit on the absence of elementStyle / pinnedStyle.

import type { CanvasElement, PositionedBox } from '../canvas/schema.js';

import type { EditorContext } from './editor-context.js';

// ADR 0064 — style-apply carve. Only applyElementStyleImpl reads
// `siteBase` (to resolve background asset URLs); the two `_ctx`
// stampers share the type to keep the wrapper-style triplet uniform.
export type StyleApplyContext = Pick<EditorContext, 'siteBase'>;

export function setBoxStyleImpl(_ctx: StyleApplyContext, wrapper: HTMLElement, box: PositionedBox): void {
  wrapper.style.position = 'absolute';
  wrapper.style.left = box.x + 'px';
  wrapper.style.top = box.y + 'px';
  wrapper.style.width = box.w + 'px';
  wrapper.style.height = box.h + 'px';
  wrapper.style.zIndex = String(box.z);
  if (typeof box.rotation === 'number' && box.rotation !== 0) {
    wrapper.style.transform = 'rotate(' + box.rotation + 'deg)';
  } else {
    wrapper.style.transform = '';
  }
}

// Apply Owner-pinned CSS overrides. Allowlist-driven: the key must look
// like a CSS property name, and the value must contain none of the
// structural delimiters (;, :, {, }) that would let an attacker break out
// of the declaration. The server's validate.ts pinnedStyleValueIssue
// rejects on overlapping rules at PUT time; this filter is the editor's
// local pre-flight so a forbidden value never renders even before save.
// If you change either rule, mirror it in validate.ts or the editor will
// accept what the server rejects (and vice versa).
export function applyPinnedStyleImpl(_ctx: StyleApplyContext, wrapper: HTMLElement, element: CanvasElement): void {
  if (!element.pinnedStyle) return;
  for (const key of Object.keys(element.pinnedStyle)) {
    if (!/^[a-zA-Z-]+$/.test(key)) continue;
    const value = element.pinnedStyle[key];
    if (typeof value !== 'string') continue;
    if (value.indexOf(';') >= 0 || value.indexOf(':') >= 0) continue;
    if (value.indexOf('{') >= 0 || value.indexOf('}') >= 0) continue;
    wrapper.style.setProperty(key, value);
  }
}

export function applyElementStyleImpl(ctx: StyleApplyContext, wrapper: HTMLElement, element: CanvasElement): void {
  const es = element.elementStyle;
  if (!es) return;
  if (es.backgroundColor) {
    wrapper.style.backgroundColor = es.backgroundColor;
    wrapper.setAttribute('data-es-bg', '');
  }
  if (es.backgroundImageAssetId) {
    wrapper.style.backgroundImage =
      'url("' + ctx.siteBase + '/assets/' + encodeURIComponent(es.backgroundImageAssetId) + '")';
    wrapper.style.backgroundSize = es.backgroundSize === 'contain' ? 'contain' : 'cover';
    wrapper.style.backgroundPosition = 'center';
    wrapper.setAttribute('data-es-bg', '');
  }
  if (typeof es.borderRadius === 'number') {
    wrapper.style.borderRadius = es.borderRadius + 'px';
    wrapper.setAttribute('data-es-radius', '');
  }
  if (es.borderColor || typeof es.borderWidth === 'number') {
    const w = typeof es.borderWidth === 'number' ? es.borderWidth : 1;
    if (es.borderColor) {
      wrapper.style.border = w + 'px solid ' + es.borderColor;
    } else {
      wrapper.style.borderWidth = w + 'px';
      wrapper.style.borderStyle = 'solid';
    }
    wrapper.setAttribute('data-es-border', '');
  }
  if (es.boxShadow) {
    wrapper.style.boxShadow = es.boxShadow;
    wrapper.setAttribute('data-es-shadow', '');
  }
  if (typeof es.opacity === 'number') {
    // Inline opacity covers elements without an entrance animation; the
    // custom property is what the kit fade-up/fade-in/etc. keyframes resolve
    // at their resting stop, so animated elements settle at the authored
    // opacity instead of being pinned to 1 by animation-fill-mode both.
    wrapper.style.opacity = String(es.opacity);
    wrapper.style.setProperty('--opencanvas-element-opacity', String(es.opacity));
  }
  if (es.color) wrapper.style.color = es.color;
  if (es.overflow) wrapper.style.overflow = es.overflow;
}
