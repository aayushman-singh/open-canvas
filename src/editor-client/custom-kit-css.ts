// src/editor-client/custom-kit-css.ts
//
// Inject a runtime `<style>` block into the editor's `<head>` that defines the
// `[data-style-kit="custom"] { ... }` CSS variables (including the legacy
// `--kit-accent`/`--kit-bg`/`--kit-fg` aliases the canvas CSS still reads).
//
// Why this exists: the editor's prebuilt stylesheet (editor-client/styles.css,
// generated from buildAllStyleKitsCss()) only emits per-kit CSS blocks for the
// BUILT-IN kits — `'custom'` is intentionally not in that map because the
// preset lives on EditableSite.customStyleKit (per-site, runtime-resolved).
//
// The published renderer mirrors this: `src/routes/public.ts` appends the
// custom-kit CSS to its inline `<style>` when `styleKit === 'custom'`, by
// calling `buildStyleKitCss('custom', resolvedKit)`. Without that injection,
// `var(--kit-accent)` on the artboard's tabs / shapes / actions resolves to
// nothing and accents disappear visually.
//
// The editor previously had no equivalent injection, so opening a site whose
// `styleKit === 'custom'` produced a transparent active tab background, a
// shape-fill that fell back to the `currentColor` default, and an action with
// no accent border. The fix is to call `applyCustomKitCss(state)` at the same
// touchpoints that mirror `data-style-kit` onto `<main class="opencanvas-editor">`.
//
// Idempotent: re-applies on every call. Removes the injected `<style>` when
// `state.styleKit !== 'custom'` so a kit switch from custom → built-in does
// not leave a stale custom kit block in the cascade.

import type { EditableSite } from '../canvas/schema.js';
import { buildStyleKitCss } from '../canvas/style-kits.js';

/** Stable id for the injected style element so we can dedupe + replace it. */
export const CUSTOM_KIT_STYLE_ID = 'opencanvas-editor-custom-kit-css';

/**
 * Inject (or refresh) the `<style>` block carrying the custom Style Kit's
 * `[data-style-kit="custom"] { ... }` declarations into `document.head`.
 *
 * Behaviour:
 *  - `state.styleKit === 'custom'` AND `state.customStyleKit` defined
 *    → builds the CSS via `buildStyleKitCss('custom', state.customStyleKit)`
 *      and writes it into a `<style id="opencanvas-editor-custom-kit-css">`
 *      tag, creating the tag if absent or updating its `textContent` if it
 *      already exists.
 *  - `state.styleKit === 'custom'` without `state.customStyleKit`
 *    → throws. The validator rejects that state; reaching this helper means
 *      the editor is holding invalid site data and must not paint a degraded
 *      preview.
 *  - built-in kit or null state
 *    → removes the tag if present. The built-in kit blocks already live in
 *      the prebuilt stylesheet so nothing else is required.
 *
 * No-op when `state` is null or when there is no `document` (e.g. SSR /
 * smoke harness without a DOM).
 */
export function applyCustomKitCss(state: EditableSite | null): void {
  if (typeof document === 'undefined') return;
  const head = document.head;
  if (!head) return;
  const existing = document.getElementById(CUSTOM_KIT_STYLE_ID);
  if (state === null || state.styleKit !== 'custom') {
    if (existing) existing.remove();
    return;
  }
  if (state.customStyleKit === undefined) {
    throw new Error(
      'applyCustomKitCss: customStyleKit is required when styleKit === "custom"',
    );
  }
  const css = buildStyleKitCss('custom', state.customStyleKit);
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== css) existing.textContent = css;
    return;
  }
  const styleEl = document.createElement('style');
  styleEl.id = CUSTOM_KIT_STYLE_ID;
  styleEl.textContent = css;
  head.appendChild(styleEl);
}
