// src/editor-client/fontload-remeasure.ts
//
// Webfont-load remeasure for editor text wrappers.
//
// PROBLEM. Every element wrapper carries an inline `height: Npx` (see
// `src/canvas/render.ts:buildElementWrapperStyle`) and text wrappers carry
// `overflow: hidden` so content that exceeds the box is clipped (see
// `src/canvas/text-overflow-hidden.smoke.ts`). The editor's first paint
// happens BEFORE custom webfonts (`@font-face` with `font-display: swap`,
// see `src/fonts/face-emit.ts`) finish loading. The fallback face has
// different vertical metrics than the authored face — a heading that fits
// in `box.h = 120` under the loaded font may overflow to 152px under the
// fallback, or vice-versa once the swap lands. The cut-off bottom line is
// the user-visible symptom; selecting the text element calls
// `beginTextEdit` which re-measures via `scrollHeight` and writes the
// corrected height back, masking the bug after one click.
//
// FIX. After `ctx.renderAll()` lands the initial DOM, wait for
// `document.fonts.ready` to resolve, then walk every
// `[data-element-type="text"]` wrapper and grow any whose content now
// overflows the authored `box.h`. This mirrors what
// `autoGrowTextElements` in render.ts does on every renderAll — the
// difference is we run it AFTER fonts load, not just on initial paint.
// `autoGrowTextElements` itself grows monotonically (only writes when
// `scrollHeight > box.h`) which makes a second post-fontload pass
// idempotent. We track whether anything actually changed so we only
// call `ctx.scheduleSave()` when the corrected `box.h` needs to
// persist.
//
// IDEMPOTENCY. A boolean flag on ctx (`fontLoadRemeasureWired`) guards
// the wiring so repeated calls during boot (or future re-mounts) don't
// stack listeners. The grow pass itself is monotonic so the listener
// firing twice is also safe — but we still gate to keep the call graph
// simple.
//
// FAILURE MODE. `document.fonts` is part of CSS Font Loading L3 and
// ships in every browser we support (Chrome 35+, Firefox 41+, Safari 10+,
// every Chromium-Edge). If it is somehow missing at runtime we
// `console.error` loudly and bail — no silent fallback, no fake
// pseudo-promise. The user-visible symptom (clipped text on cold load)
// is preferable to a silent failure that breaks future renders.

import type { EditorContext } from './editor-context.js';

/**
 * One-shot grow pass over every text wrapper currently in the DOM.
 *
 * Reads each wrapper's inner `.opencanvas-text` `scrollHeight` and writes
 * the value back to `element.box.h` (and the wrapper's inline style)
 * when it exceeds the current `box.h`. Returns `true` if any element
 * actually grew. Used by the fontload remeasure handler below to decide
 * whether to schedule a save.
 *
 * Mirrors `autoGrowTextElements` in render.ts byte-for-byte except for
 * the return value — we re-implement here so the handler can track the
 * "did anything grow" signal without changing the existing function's
 * signature (which is consumed by `renderAllImpl` and several smokes).
 */
function growTextWrappersOnce(ctx: EditorContext): boolean {
  if (!ctx.root) return false;
  const wrappers = ctx.root.querySelectorAll('[data-element-type="text"]');
  let grew = false;
  for (let i = 0; i < wrappers.length; i++) {
    const w = wrappers[i] as HTMLElement;
    if (w.classList?.contains('opencanvas-flow-content')) continue;
    const inner = w.querySelector('.opencanvas-text');
    if (!inner) continue;
    const eid = w.getAttribute('data-opencanvas-element');
    if (!eid) continue;
    const found = ctx.findElement(eid);
    if (!found) continue;
    const textH = (inner as HTMLElement).scrollHeight;
    if (textH > found.element.box.h) {
      found.element.box.h = textH;
      ctx.setBoxStyle(w, found.element.box);
      grew = true;
    }
  }
  return grew;
}

/**
 * Wire a one-shot listener on `document.fonts.ready`. When the promise
 * resolves, re-walk every text wrapper, grow any whose content now
 * overflows the authored `box.h`, and schedule a save if anything
 * changed. Safe to call multiple times — guards via a flag on ctx so a
 * future re-mount path can't double-wire.
 *
 * The handler intentionally does NOT call `ctx.renderAll()` — that would
 * tear down + rebuild every wrapper, lose any in-progress drag/select
 * state, and trigger the camera-transform cascade unnecessarily. Growing
 * the heights in place is the minimal mutation that fixes the clip.
 *
 * Call this once at editor boot, after `ctx.renderAll()` has run so the
 * text wrappers exist in the DOM.
 */
export function wireFontLoadRemeasureImpl(ctx: EditorContext): void {
  if (ctx.fontLoadRemeasureWired === true) return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof fonts.ready !== 'object') {
    // Loud failure — no fallback. The bug user-visibly remains (clipped
    // text on cold load) but the editor doesn't crash, and the console
    // error tells a maintainer what happened. Per the no-fallbacks rule,
    // we do not synthesise a fake `fonts.ready` Promise or substitute
    // setTimeout — those would silently misbehave.
    console.error(
      'wireFontLoadRemeasure: document.fonts is unavailable — webfont swap will not re-measure text wrappers',
    );
    return;
  }
  ctx.fontLoadRemeasureWired = true;
  // `document.fonts.ready` is a stable Promise that resolves once the
  // initial set of fonts has finished loading. If fonts are already
  // loaded by the time we wire (which is rare at editor boot but
  // possible on hot reload), the .then() fires synchronously on the next
  // microtask — still correct, just trivially fast.
  void fonts.ready.then(() => {
    const grew = growTextWrappersOnce(ctx);
    if (grew) {
      ctx.scheduleSave();
    }
  });
}
