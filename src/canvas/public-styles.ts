// src/canvas/public-styles.ts
//
// Minimal CSS shipped on the visitor-facing Published Site. Composed of:
//   - the shared style-kit CSS produced by `buildAllStyleKitsCss()` so visitor
//     and editor previews always agree on tokens, variants, and motion
//   - a small container reset that lets the absolute-positioned canvas
//     elements (built by renderCanvasSnapshot) lay out correctly.
//
// The kit token table USED to live here as hand-maintained selectors. The
// source of truth is now `src/canvas/style-kits.ts` — a single
// `STYLE_KIT_PRESETS` map consumed by both the editor preview and this
// visitor stylesheet. There is exactly one place that knows how to translate
// a preset into CSS.

import { buildAllStyleKitsCss } from './style-kits.js';

const kitCss = buildAllStyleKitsCss();

const baseCss = String.raw`
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  font-family: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  background: #0a0e1a;
  color: #f6f6f6;
}

[data-opencanvas-public-root] {
  display: block;
  min-height: 100vh;
}

.opencanvas-site {
  display: block;
  background: var(--opencanvas-kit-bg, var(--kit-bg, #0c0c0d));
  color: var(--opencanvas-kit-text, var(--kit-fg, #f6f6f6));
  font-family: var(--opencanvas-kit-font-body, 'IBM Plex Sans', system-ui, sans-serif);
  line-height: var(--opencanvas-kit-line-height, 1.5);
}

.opencanvas-page {
  margin: 0 auto;
  background: var(--opencanvas-kit-bg, var(--kit-bg, #0c0c0d));
  color: var(--opencanvas-kit-text, var(--kit-fg, #f6f6f6));
}

.opencanvas-section {
  position: relative;
}

.opencanvas-text { color: inherit; }

/* Text element wrappers clip overflow by default so a long line typed into
   a small text box stops at the wrapper's right edge instead of spilling
   past the declared width/height. The inspector's Overflow control still
   wins: when it emits inline overflow:visible on the wrapper, the inline
   declaration outranks this stylesheet rule. The :not([data-editing])
   carveout is for the editor preview — published visitor pages never set
   that attribute, so they always clip. */
.opencanvas-element[data-element-type="text"]:not([data-editing="true"]) {
  overflow: hidden;
}

.opencanvas-element[data-opencanvas-marquee="true"] {
  overflow: hidden;
}

[data-opencanvas-marquee-belt] {
  display: flex;
  align-items: stretch;
  width: max-content;
  min-width: 100%;
  height: 100%;
  will-change: transform;
}

[data-opencanvas-marquee-content] {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 100%;
  height: 100%;
}

.opencanvas-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--opencanvas-action-gap, 0.5em);
  width: 100%;
  height: 100%;
  padding: var(--opencanvas-kit-action-padding, 0 16px);
  border: 0 solid transparent;
  border-radius: var(--opencanvas-action-radius, var(--opencanvas-kit-action-radius, 8px));
  background: var(--opencanvas-action-bg, var(--opencanvas-kit-accent, var(--kit-accent, currentColor)));
  color: var(--opencanvas-action-color, var(--opencanvas-kit-accent-text, var(--kit-bg, #fff)));
  box-shadow: var(--opencanvas-action-shadow, none);
  font-family: var(--opencanvas-action-font-family, inherit);
  font-size: var(--opencanvas-action-font-size, inherit);
  font-weight: var(--opencanvas-action-font-weight, 600);
  letter-spacing: var(--opencanvas-action-letter-spacing, normal);
  text-decoration: none;
}
/* Shrink-protect the icon so a narrow action (e.g. width 56px) keeps the
 * 1em-sized SVG visible; the label span absorbs the squeeze instead.
 * Without flex 0 0 auto, the SVG measured 0 width live on a 56px-wide
 * action, collapsing the glyph entirely. */
.opencanvas-action > .opencanvas-icon {
  flex: 0 0 auto;
  width: 1em;
  height: 1em;
}
.opencanvas-action > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.opencanvas-shape {
  width: 100%;
  height: 100%;
  background: var(--opencanvas-kit-shape-fill, var(--opencanvas-kit-accent, var(--kit-accent, currentColor)));
  opacity: 0.85;
}
.opencanvas-shape[data-variant="circle"] { border-radius: 50%; }
.opencanvas-shape[data-variant="pill"] { border-radius: 999px; }
.opencanvas-shape[data-variant="blob"] { border-radius: 36% 64% 60% 40% / 45% 35% 65% 55%; }
.opencanvas-shape[data-variant="line"] { height: 4px; align-self: center; }

.opencanvas-surface {
  width: 100%;
  height: 100%;
  background: var(--opencanvas-kit-panel, rgba(255, 255, 255, 0.06));
  border-radius: var(--opencanvas-kit-radius, 8px);
  box-shadow: var(--opencanvas-kit-shadow, none);
}

.opencanvas-media {
  width: 100%;
  height: 100%;
  display: block;
}

.opencanvas-inline-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
}
.opencanvas-inline-link:hover {
  color: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
}

.opencanvas-text mark {
  background: rgba(252, 211, 77, 0.5);
  color: inherit;
  padding: 0 0.15em;
  border-radius: 2px;
}
.opencanvas-text code {
  font-family: var(--opencanvas-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  background: rgba(127, 127, 127, 0.18);
  padding: 0.05em 0.3em;
  border-radius: 3px;
  font-size: 0.92em;
}
.opencanvas-math {
  display: inline-block;
  vertical-align: baseline;
  color: inherit;
}
.opencanvas-math-error {
  color: #d83a52;
  background: rgba(216, 58, 82, 0.08);
  font-family: var(--opencanvas-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  padding: 0 0.25em;
  border-radius: 3px;
}

.opencanvas-nav-link {
  color: inherit;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  padding: 6px 12px;
}
.opencanvas-nav-link:hover {
  color: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
}
.opencanvas-nav {
  gap: 4px;
  position: relative;
}
.opencanvas-nav-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}
.opencanvas-nav-slot[data-slot="right"] {
  margin-left: auto;
}
.opencanvas-nav-slot[data-slot="center"] {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
/* Primary CTA defaults to margin-left:auto so it sits at the right edge in
   layouts without a right slot (left-center-right). When a right slot
   precedes it (layout=left-right), the adjacent-sibling rule kills the auto
   margin so right + primary stay grouped together at the far right. */
.opencanvas-nav-slot[data-slot="primary"] {
  margin-left: auto;
}
.opencanvas-nav-slot[data-slot="right"] + .opencanvas-nav-slot[data-slot="primary"] {
  margin-left: 8px;
}
.opencanvas-nav-logo {
  height: 28px;
  width: auto;
}
.opencanvas-nav-site-title {
  font-family: var(--opencanvas-kit-font-display, var(--opencanvas-kit-font-body, inherit));
  font-size: 18px;
  font-weight: 700;
  color: inherit;
  letter-spacing: -0.01em;
}
.opencanvas-nav-primary-action {
  display: inline-flex;
  align-items: center;
  padding: var(--opencanvas-kit-action-padding, 8px 16px);
  border-radius: var(--opencanvas-kit-action-radius, 8px);
  background: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
  color: var(--opencanvas-kit-accent-text, var(--kit-bg, #fff));
  text-decoration: none;
  font-size: 14px;
  font-weight: 600;
}
.opencanvas-nav-primary-action:hover {
  filter: brightness(1.08);
}
.opencanvas-nav[data-opencanvas-nav-theme-root] {
  transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease;
}
.opencanvas-nav[data-opencanvas-nav-theme-reduced-motion="instant"] {
  transition: none;
}
.opencanvas-nav[data-opencanvas-nav-theme-active="transparent"] {
  background: transparent;
  color: inherit;
  box-shadow: none;
}
.opencanvas-nav[data-opencanvas-nav-theme-active="light"] {
  background: rgba(255, 255, 255, 0.9);
  color: #101114;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.12);
}
.opencanvas-nav[data-opencanvas-nav-theme-active="dark"] {
  background: rgba(8, 10, 14, 0.9);
  color: #f6f6f6;
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
}
.opencanvas-nav[data-opencanvas-nav-theme-active="solid"] {
  background: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
  color: var(--opencanvas-kit-accent-text, var(--kit-bg, #0c0c0d));
  box-shadow: 0 12px 34px color-mix(in oklab, var(--opencanvas-kit-accent, currentColor) 22%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .opencanvas-nav[data-opencanvas-nav-theme-root] { transition: none; }
}
/* Presence indicator — a tiny pill that lives in the top-right of the
   published page. Hidden by default; the visitor script removes the
   [hidden] attribute when more than one socket is connected. */
[data-opencanvas-presence] {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 9999;
  padding: 4px 10px;
  border-radius: 999px;
  font-family: 'IBM Plex Mono', ui-monospace, monospace;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.18);
  backdrop-filter: blur(8px);
}
[data-opencanvas-presence][hidden] {
  display: none;
}

/* ---- Element style overrides ------------------------------------------------
   When a per-element style property is set on the wrapper (.opencanvas-element),
   the inner element's kit-driven value for that property must step aside so
   the wrapper's value shows through. Each data-es-* attribute resets only
   the property it controls — unrelated kit values stay intact.              */

.opencanvas-element[data-es-bg] > .opencanvas-surface,
.opencanvas-element[data-es-bg] > .opencanvas-action,
.opencanvas-element[data-es-bg] > .opencanvas-shape { background: transparent; }

.opencanvas-element[data-es-radius] > .opencanvas-surface,
.opencanvas-element[data-es-radius] > .opencanvas-action,
.opencanvas-element[data-es-radius] > .opencanvas-shape { border-radius: inherit; }

.opencanvas-element[data-es-border] > .opencanvas-surface,
.opencanvas-element[data-es-border] > .opencanvas-action,
.opencanvas-element[data-es-border] > .opencanvas-shape { border-color: transparent; border-width: 0; }

.opencanvas-element[data-es-shadow] > .opencanvas-surface,
.opencanvas-element[data-es-shadow] > .opencanvas-action,
.opencanvas-element[data-es-shadow] > .opencanvas-shape { box-shadow: none; }

/* ---- Collections ------------------------------------------------------
   Materialized entries render as mini relative frames inside the Collection
   host. Component Style writes host variables; CSS consumes them here so the
   materializer's generated child element payload stays canonical. */
.opencanvas-collection {
  width: 100%;
  height: 100%;
  overflow: auto;
}
.opencanvas-collection-entry {
  position: relative;
}
.opencanvas-collection[data-collection-display="card"] .opencanvas-collection-entry > .opencanvas-element[data-element-type="container"]:first-child > .opencanvas-surface {
  background: var(--opencanvas-collection-card-bg, inherit);
  border: var(--opencanvas-collection-card-border-width, 0) solid var(--opencanvas-collection-card-border-color, transparent);
  border-radius: var(--opencanvas-collection-card-radius, inherit);
  box-shadow: var(--opencanvas-collection-card-shadow, inherit);
  padding: var(--opencanvas-collection-card-padding, 0);
}
.opencanvas-collection[data-collection-display="card"] .opencanvas-collection-entry > .opencanvas-element[data-element-type="media"] .opencanvas-media {
  border-radius: var(--opencanvas-collection-card-image-radius, 0);
}
.opencanvas-collection[data-collection-display="image-only"] .opencanvas-collection-entry > .opencanvas-element[data-element-type="media"] .opencanvas-media {
  border-radius: var(--opencanvas-collection-image-only-radius, 0);
}
.opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] {
  align-items: stretch;
}
.opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry {
  cursor: pointer;
  isolation: isolate;
  overflow: hidden;
  border-radius: var(--opencanvas-kit-radius, 18px);
  transition: transform 220ms ease, opacity 220ms ease, filter 220ms ease;
}
.opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry::after {
  content: "";
  position: absolute;
  inset: auto 14px 14px 14px;
  height: 2px;
  background: var(--opencanvas-kit-accent, currentColor);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 220ms ease;
  z-index: 10;
}
.opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry[data-opencanvas-collection-entry-active="true"] {
  transform: translateY(-6px);
  filter: saturate(1.08);
}
.opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry[data-opencanvas-collection-entry-active="true"]::after {
  transform: scaleX(1);
}
.opencanvas-collection[data-opencanvas-collection-gallery-reduced="instant"] .opencanvas-collection-entry,
.opencanvas-collection[data-opencanvas-collection-gallery-reduced="instant"] .opencanvas-collection-entry::after {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry { transition: none; }
  .opencanvas-collection[data-opencanvas-collection-gallery="hover-reveal-detail"] .opencanvas-collection-entry::after { transition: none; }
}

/* ---- Forms ------------------------------------------------------------
   Visitor-facing form chrome. Browsers' default form widgets look broken
   next to a designed canvas, so we ship a small, opinionated reset:
   stacked labels, generous tap targets, kit-token-aware focus ring, and
   a primary CTA that picks up the active kit accent. The AJAX handler
   (emitted inline alongside the form) flips visibility on the success
   message and reveals .opencanvas-form-error on failure.                       */
.opencanvas-form {
  display: grid;
  gap: var(--opencanvas-form-gap, 14px);
  max-width: 100%;
  font-family: var(--opencanvas-form-font-family, inherit);
  font-size: var(--opencanvas-form-font-size, inherit);
}
.opencanvas-form-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--opencanvas-fg);
}
.opencanvas-form[data-variant="card"] .opencanvas-form-field,
.opencanvas-form[data-variant="spotlight"] .opencanvas-form-field {
  padding: var(--opencanvas-form-field-surface-pad-y, 14px) var(--opencanvas-form-field-surface-pad-x, 16px);
  border: var(--opencanvas-form-field-surface-border-width, 0) solid var(--opencanvas-form-field-surface-border-color, transparent);
  border-radius: var(--opencanvas-form-field-surface-radius, var(--opencanvas-kit-radius, 10px));
  background: var(--opencanvas-form-field-surface-bg, var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06)));
  box-shadow: var(--opencanvas-form-field-surface-shadow, 0 4px 16px rgba(0, 0, 0, 0.14));
}
.opencanvas-form-field-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.opencanvas-form-label {
  font-weight: var(--opencanvas-form-label-weight, 500);
  font-size: var(--opencanvas-form-label-size, inherit);
  color: var(--opencanvas-form-label-color, var(--opencanvas-fg));
  line-height: 1.4;
}
.opencanvas-form-input,
.opencanvas-form select {
  width: 100%;
  padding: var(--opencanvas-form-input-pad-y, 10px) var(--opencanvas-form-input-pad-x, 12px);
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  color: var(--opencanvas-form-input-color, var(--opencanvas-fg));
  background: var(--opencanvas-form-input-bg, var(--opencanvas-bg));
  border: var(--opencanvas-form-input-border-width, 1px) solid var(--opencanvas-form-input-border-color, var(--opencanvas-hairline));
  border-radius: var(--opencanvas-form-input-radius, 6px);
  transition: border-color 120ms ease, box-shadow 120ms ease;
  appearance: none;
}
.opencanvas-form-input:hover,
.opencanvas-form select:hover {
  border-color: var(--opencanvas-form-input-border-color, var(--opencanvas-fg-mute));
}
.opencanvas-form-input:focus,
.opencanvas-form select:focus {
  outline: none;
  border-color: var(--opencanvas-form-focus-ring, var(--opencanvas-accent));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--opencanvas-form-focus-ring, var(--opencanvas-accent)) 24%, transparent);
}
.opencanvas-form-input::placeholder { color: var(--opencanvas-form-placeholder-color, var(--opencanvas-fg-mute)); }
.opencanvas-form textarea.opencanvas-form-input {
  resize: vertical;
  min-height: 96px;
  font-family: inherit;
}
.opencanvas-form-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--opencanvas-accent);
}
.opencanvas-form-submit {
  justify-self: start;
  padding: var(--opencanvas-form-submit-pad-y, 10px) var(--opencanvas-form-submit-pad-x, 18px);
  font-family: inherit;
  font-size: var(--opencanvas-form-submit-size, 14px);
  font-weight: var(--opencanvas-form-submit-weight, 600);
  color: var(--opencanvas-form-submit-color, var(--opencanvas-bg));
  background: var(--opencanvas-form-submit-bg, var(--opencanvas-accent));
  border: var(--opencanvas-form-submit-border-width, 0) solid var(--opencanvas-form-submit-border-color, transparent);
  border-radius: var(--opencanvas-form-submit-radius, 6px);
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease, background 120ms ease;
}
.opencanvas-form[data-opencanvas-form-submit-full="1"] .opencanvas-form-submit {
  justify-self: stretch;
  width: 100%;
  text-align: center;
}
.opencanvas-form-submit:hover {
  background: var(--opencanvas-form-submit-hover-bg, var(--opencanvas-form-submit-bg, var(--opencanvas-accent)));
  filter: brightness(1.05);
}
.opencanvas-form-submit:active { transform: translateY(1px); }
.opencanvas-form-submit:disabled,
.opencanvas-form-submit[data-busy="1"] {
  opacity: 0.6;
  cursor: progress;
  filter: none;
}
.opencanvas-form-success {
  margin: 0;
  padding: 12px 14px;
  font-size: 14px;
  color: var(--opencanvas-accent);
  background: color-mix(in oklab, var(--opencanvas-accent) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--opencanvas-accent) 32%, transparent);
  border-radius: 6px;
}
.opencanvas-form-error {
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  color: #d44;
  background: color-mix(in oklab, #d44 12%, transparent);
  border: 1px solid color-mix(in oklab, #d44 36%, transparent);
  border-radius: 6px;
}

/* ---- Accordion --------------------------------------------------------
   Wrapper is a vertical stack of bordered items. Body visibility is
   driven by the [hidden] attribute that the interactive runtime
   (src/interactive/accordion.ts) mirrors on toggle. The header's open
   state is mirrored on aria-expanded — we use that to flip the +/− glyph
   so visitors get a click affordance even before they interact.            */
.opencanvas-accordion {
  display: flex;
  flex-direction: column;
  gap: var(--opencanvas-accordion-gap, 8px);
  width: 100%;
  height: 100%;
  overflow: auto;
}
.opencanvas-accordion-item {
  border: var(--opencanvas-accordion-item-border, var(--opencanvas-accordion-item-border-width, 1px) solid var(--opencanvas-accordion-item-border-color, var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18))));
  border-radius: var(--opencanvas-accordion-item-radius, var(--opencanvas-kit-radius, 8px));
  background: var(--opencanvas-accordion-item-bg, var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06)));
  box-shadow: var(--opencanvas-accordion-item-shadow, none);
  overflow: hidden;
}
.opencanvas-accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--opencanvas-accordion-header-pad-y, 12px) var(--opencanvas-accordion-header-pad-x, 16px);
  background: var(--opencanvas-accordion-header-bg, transparent);
  border: 0;
  color: var(--opencanvas-accordion-header-color, inherit);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}
.opencanvas-accordion-header::after {
  content: "+";
  margin-left: 12px;
  font-size: 1.25em;
  line-height: 1;
  opacity: 0.7;
}
.opencanvas-accordion-header[aria-expanded="true"]::after { content: "−"; }
.opencanvas-accordion-header:hover { background: rgba(127, 127, 127, 0.08); }
.opencanvas-accordion-body {
  padding: var(--opencanvas-accordion-body-pad-y, 0) var(--opencanvas-accordion-body-pad-x, 16px) var(--opencanvas-accordion-body-pad-y, 14px);
  color: var(--opencanvas-accordion-body-color, inherit);
  font-size: var(--opencanvas-accordion-body-font-size, 14px);
  line-height: var(--opencanvas-accordion-body-line-height, 1.55);
}
.opencanvas-accordion-body[hidden] { display: none; }

/* ---- Tabs ------------------------------------------------------------- */
.opencanvas-tabs {
  width: 100%;
  height: 100%;
  display: block;
}
.opencanvas-tab-bar {
  display: flex;
  align-items: stretch;
  gap: var(--opencanvas-tabs-bar-gap, 8px);
  padding: 0 0 10px;
  border: var(--opencanvas-tabs-bar-border-width, 0) solid var(--opencanvas-tabs-bar-border-color, transparent);
  border-bottom-width: var(--opencanvas-tabs-bar-border-width, 1px);
  border-bottom-color: var(--opencanvas-tabs-bar-border-color, var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18)));
  border-radius: var(--opencanvas-tabs-bar-radius, 0);
  background: var(--opencanvas-tabs-bar-bg, transparent);
  overflow-x: auto;
}
.opencanvas-tab {
  appearance: none;
  border: 0;
  border-radius: var(--opencanvas-tabs-tab-radius, var(--opencanvas-kit-radius, 8px));
  background: transparent;
  color: var(--opencanvas-tabs-tab-color, var(--opencanvas-kit-muted, #9ca3af));
  padding: var(--opencanvas-tabs-tab-pad-y, 0) var(--opencanvas-tabs-tab-pad-x, 18px);
  font: inherit;
  font-weight: var(--opencanvas-tabs-tab-font-weight, 600);
  cursor: pointer;
  white-space: nowrap;
}
.opencanvas-tab[data-tab-active] {
  background: var(--opencanvas-tabs-active-tab-bg, var(--opencanvas-kit-accent, #7dd3fc));
  color: var(--opencanvas-tabs-active-tab-color, var(--opencanvas-kit-bg, #0c0c0d));
  font-weight: var(--opencanvas-tabs-active-tab-font-weight, var(--opencanvas-tabs-tab-font-weight, 600));
  box-shadow: inset 0 -2px 0 0 var(--opencanvas-tabs-active-indicator-color, transparent);
}
.opencanvas-tab-panel {
  box-sizing: border-box;
  background: var(--opencanvas-tabs-panel-bg, transparent);
  border: var(--opencanvas-tabs-panel-border-width, 0) solid var(--opencanvas-tabs-panel-border-color, transparent);
  border-radius: var(--opencanvas-tabs-panel-radius, 0);
  overflow: visible;
}
[data-opencanvas-tab-panel-id]:not([data-tab-active]) {
  display: none;
}

/* ---- Carousel ---------------------------------------------------------
   Slides occupy the same absolute box; only the slide whose
   data-opencanvas-carousel-slide-index matches the wrapper's
   data-opencanvas-slide-index is visible. The runtime
   (src/interactive/carousel.ts) mutates the wrapper attribute on
   prev/next/dot clicks; CSS handles the crossfade. Active-slide
   selectors are enumerated up to MAX_CAROUSEL_SLIDES below.                 */
.opencanvas-carousel {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--opencanvas-kit-radius, 8px);
  background: var(--opencanvas-kit-panel, rgba(0, 0, 0, 0.25));
}
.opencanvas-carousel-track {
  position: absolute;
  inset: 0;
}
.opencanvas-carousel-slide {
  position: absolute;
  inset: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  opacity: 0;
  visibility: hidden;
  transition: opacity 240ms ease;
}
.opencanvas-carousel[data-opencanvas-carousel-mode="scroll-snap"] {
  overflow-x: auto;
  overflow-y: hidden;
  scroll-snap-type:x mandatory;
}
.opencanvas-carousel[data-opencanvas-carousel-mode="scroll-snap"] .opencanvas-carousel-track {
  position: relative;
  inset: auto;
  height: 100%;
  min-width: 100%;
  display: flex;
}
.opencanvas-carousel[data-opencanvas-carousel-mode="scroll-snap"] .opencanvas-carousel-slide {
  position: relative;
  inset: auto;
  flex: 0 0 100%;
  height: 100%;
  opacity: 1;
  visibility: visible;
  scroll-snap-align: start;
}
.opencanvas-carousel-link {
  display: block;
  width: 100%;
  height: 100%;
}
.opencanvas-carousel-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.opencanvas-carousel-caption {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  margin: 0;
  padding: var(--opencanvas-carousel-caption-pad-y, 14px) var(--opencanvas-carousel-caption-pad-x, 24px);
  background: var(--opencanvas-carousel-caption-bg, linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0)));
  color: var(--opencanvas-carousel-caption-color, #fff);
  font-size: var(--opencanvas-carousel-caption-font-size, 14px);
  font-weight: var(--opencanvas-carousel-caption-font-weight, inherit);
  line-height: var(--opencanvas-carousel-caption-line-height, 1.4);
}
.opencanvas-carousel-arrow {
  position: absolute;
  width: var(--opencanvas-carousel-arrow-size, 40px);
  height: var(--opencanvas-carousel-arrow-size, 40px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--opencanvas-carousel-arrow-bg, rgba(0, 0, 0, 0.55));
  color: var(--opencanvas-carousel-arrow-color, #fff);
  border: 0;
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  transition: background 120ms ease;
}
.opencanvas-carousel-arrow:hover { background: var(--opencanvas-carousel-arrow-bg, rgba(0, 0, 0, 0.78)); }

/* ---- Arrow position presets --------------------------------------------
   Each preset positions both arrows independently; the default
   split-vertical-center keeps the historical layout (prev edge / next
   edge, vertically centred). Vertical-direction carousels swap the axis
   so the same preset reads naturally with up/down chevrons.            */
.opencanvas-carousel[data-opencanvas-direction="horizontal"][data-opencanvas-arrow-position="split-vertical-center"] .opencanvas-carousel-arrow-prev {
  top: 50%;
  left: 12px;
  transform: translateY(-50%);
}
.opencanvas-carousel[data-opencanvas-direction="horizontal"][data-opencanvas-arrow-position="split-vertical-center"] .opencanvas-carousel-arrow-next {
  top: 50%;
  right: 12px;
  transform: translateY(-50%);
}
.opencanvas-carousel[data-opencanvas-direction="vertical"][data-opencanvas-arrow-position="split-vertical-center"] .opencanvas-carousel-arrow-prev {
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
}
.opencanvas-carousel[data-opencanvas-direction="vertical"][data-opencanvas-arrow-position="split-vertical-center"] .opencanvas-carousel-arrow-next {
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
}
.opencanvas-carousel[data-opencanvas-arrow-position="bunched-bottom-right"] .opencanvas-carousel-arrow-prev {
  bottom: 12px;
  right: 64px;
}
.opencanvas-carousel[data-opencanvas-arrow-position="bunched-bottom-right"] .opencanvas-carousel-arrow-next {
  bottom: 12px;
  right: 12px;
}
.opencanvas-carousel[data-opencanvas-arrow-position="split-below"] .opencanvas-carousel-arrow-prev {
  bottom: 8px;
  left: 12px;
}
.opencanvas-carousel[data-opencanvas-arrow-position="split-below"] .opencanvas-carousel-arrow-next {
  bottom: 8px;
  right: 12px;
}

/* ---- Arrow shape presets -----------------------------------------------
   round is the historical default (border-radius: 50%); square reads
   as a flat tile; pill widens to a stadium shape that pairs well with
   the bunched-bottom-right placement.                                   */
.opencanvas-carousel[data-opencanvas-arrow-style="round"] .opencanvas-carousel-arrow {
  border-radius: 50%;
  width: var(--opencanvas-carousel-arrow-size, 40px);
}
.opencanvas-carousel[data-opencanvas-arrow-style="square"] .opencanvas-carousel-arrow {
  border-radius: var(--opencanvas-kit-radius, 8px);
  width: var(--opencanvas-carousel-arrow-size, 40px);
}
.opencanvas-carousel[data-opencanvas-arrow-style="pill"] .opencanvas-carousel-arrow {
  border-radius: 9999px;
  width: calc(var(--opencanvas-carousel-arrow-size, 40px) * 1.4);
}
/* Bunched placement needs a tighter pill spacing when arrows are pills,
   so the two buttons don't visually overlap. */
.opencanvas-carousel[data-opencanvas-arrow-style="pill"][data-opencanvas-arrow-position="bunched-bottom-right"] .opencanvas-carousel-arrow-prev {
  right: 76px;
}

.opencanvas-carousel-dots {
  position: absolute;
  bottom: 12px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 8px;
  z-index: 2;
}
/* Vertical carousel — pagination dots run down the right edge instead of
   across the bottom so they don't fight with bottom-pinned arrows. */
.opencanvas-carousel[data-opencanvas-direction="vertical"] .opencanvas-carousel-dots {
  flex-direction: column;
  bottom: auto;
  top: 0;
  right: 12px;
  left: auto;
  height: 100%;
  padding: 12px 0;
  justify-content: center;
}
/* Split-below carousels pull the dots tight to the bottom row of arrows;
   the prev/next arrows already pin themselves at bottom-12, so the dot
   row needs to sit at the same baseline rather than the default bottom-12
   stacked behind them. */
.opencanvas-carousel[data-opencanvas-arrow-position="split-below"] .opencanvas-carousel-dots {
  bottom: 18px;
}
.opencanvas-carousel-dot {
  width: var(--opencanvas-carousel-dot-size, 10px);
  height: var(--opencanvas-carousel-dot-size, 10px);
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: var(--opencanvas-carousel-dot-bg, rgba(255, 255, 255, 0.45));
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.opencanvas-carousel-dot[aria-selected="true"] {
  background: var(--opencanvas-carousel-dot-active-bg, #fff);
  transform: scale(1.2);
}

/* ---- Embed -------------------------------------------------------------
   The wrapper sets the box; the iframe stretches to 100%/100% (percentage
   heights collapse without an explicit parent height). The invalid-URL
   placeholder is an empty div by design (the render fn has no caption),
   so we paint a dashed border + label glyph so visitors see a real
   "broken embed" affordance instead of an invisible hole.                   */
.opencanvas-embed {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--opencanvas-kit-radius, 8px);
  background: var(--opencanvas-kit-panel, rgba(0, 0, 0, 0.2));
}
.opencanvas-embed > iframe {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.opencanvas-embed[data-opencanvas-embed-drill-in="true"] {
  cursor: zoom-in;
}
.opencanvas-embed-drill-in-trigger {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 2;
  padding: 9px 12px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.62);
  color: #fff;
  font: inherit;
  font-size: 12px;
  cursor: zoom-in;
}
.opencanvas-embed-drill-in-overlay {
  position: fixed;
  inset: 0;
  z-index: 100002;
  display: grid;
  grid-template-rows: auto 1fr;
  background: rgba(0, 0, 0, 0.88);
  color: #fff;
}
.opencanvas-embed-drill-in-overlay[hidden] { display: none; }
.opencanvas-embed-drill-in-chrome {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
}
.opencanvas-embed-drill-in-close {
  padding: 9px 13px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.opencanvas-embed-drill-in-frame {
  width: min(1480px, calc(100vw - 40px));
  height: calc(100vh - 96px);
  justify-self: center;
  border: 0;
  border-radius: 18px 18px 0 0;
  background: #000;
}
.opencanvas-embed-drill-in-overlay[data-opencanvas-embed-drill-in-reduced="instant"] {
  transition: none;
}
.opencanvas-embed-invalid {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.4));
  border-radius: var(--opencanvas-kit-radius, 8px);
  background: var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06));
  color: var(--opencanvas-kit-text, currentColor);
  opacity: 0.7;
  font-size: 13px;
}
.opencanvas-embed-invalid::after {
  content: "Invalid embed URL";
}
`;

// Active-slide selectors. CSS cannot compare two attribute values across
// elements, so we enumerate index pairs: when the wrapper carries
// data-opencanvas-slide-index="N", the descendant slide whose own
// data-opencanvas-carousel-slide-index="N" becomes visible. 50 covers any
// realistic carousel; bump if a future use case exceeds it.
const MAX_CAROUSEL_SLIDES = 50;
const carouselActiveCss = (() => {
  const selectors: string[] = [];
  for (let i = 0; i < MAX_CAROUSEL_SLIDES; i++) {
    selectors.push(
      `.opencanvas-carousel[data-opencanvas-slide-index="${String(i)}"] [data-opencanvas-carousel-slide-index="${String(i)}"]`,
    );
  }
  return `${selectors.join(',\n')} {\n  opacity: 1;\n  visibility: visible;\n}\n`;
})();

// ADR 0066 — variant-preset layer. One selector block per interactive
// component. The pattern (dec 2): inner-part properties are re-declared here
// reading a component-scoped `--opencanvas-<comp>-*` custom property with the
// CURRENT value as the `var()` fallback — so with no variant set (or the first
// arm) the look is byte-for-byte the existing one. Each `[data-variant="x"]`
// arm only *sets* those custom properties (plus a few arm-scoped structural
// rules where a look needs more than a token swap — never a DOM branch). An
// Owner override via `pinnedStyle` on the root sets the same property inline and
// wins over the stylesheet arm: kit-token < variant < granular.
const variantCss = String.raw`
/* ===== ADR 0066 variant-preset layer ================================== */

/* ---- Accordion: parameterise overridable inner-part values ----------- */
.opencanvas-accordion { gap: var(--opencanvas-accordion-gap, 8px); }
.opencanvas-accordion-item {
  background: var(--opencanvas-accordion-item-bg, var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06)));
  border: var(--opencanvas-accordion-item-border, var(--opencanvas-accordion-item-border-width, 1px) solid var(--opencanvas-accordion-item-border-color, var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18))));
  border-radius: var(--opencanvas-accordion-item-radius, var(--opencanvas-kit-radius, 8px));
  box-shadow: var(--opencanvas-accordion-item-shadow, none);
}
.opencanvas-accordion-header {
  padding: var(--opencanvas-accordion-header-pad-y, 12px) var(--opencanvas-accordion-header-pad-x, 16px);
  background: var(--opencanvas-accordion-header-bg, transparent);
  color: var(--opencanvas-accordion-header-color, inherit);
}
.opencanvas-accordion-body {
  padding: var(--opencanvas-accordion-body-pad-y, 0) var(--opencanvas-accordion-body-pad-x, 16px) var(--opencanvas-accordion-body-pad-y, 14px);
  color: var(--opencanvas-accordion-body-color, inherit);
  font-size: var(--opencanvas-accordion-body-font-size, 14px);
  line-height: var(--opencanvas-accordion-body-line-height, 1.55);
}
/* list = current look (all fallbacks). VAR-SETTING arms live on the OUTER
   .opencanvas-element wrapper — the same element pinnedStyle lands on — so an
   inline pinnedStyle override of a --opencanvas-accordion-* property beats the
   stylesheet arm (kit < variant < granular). Setting the vars on a child arm
   would lose to pinnedStyle's wrapper value only by proximity, so the wrapper is
   the correct host. Structural arm rules (no granular contract) stay on inner. */
.opencanvas-element[data-element-type="accordion"][data-variant="bordered"] {
  --opencanvas-accordion-gap: 0;
  --opencanvas-accordion-item-bg: transparent;
  --opencanvas-accordion-item-radius: 0;
  --opencanvas-accordion-item-border-width: 0;
}
.opencanvas-accordion[data-variant="bordered"] .opencanvas-accordion-item {
  border-bottom: 1px solid var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18));
}
.opencanvas-element[data-element-type="accordion"][data-variant="cards"] {
  --opencanvas-accordion-gap: 12px;
  --opencanvas-accordion-item-radius: 12px;
  --opencanvas-accordion-item-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
}
.opencanvas-element[data-element-type="accordion"][data-variant="filled"] {
  --opencanvas-accordion-header-bg: var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.1));
}
.opencanvas-accordion[data-variant="filled"] .opencanvas-accordion-header[aria-expanded="true"] {
  background: var(--opencanvas-kit-accent, #7dd3fc);
  color: var(--opencanvas-kit-bg, #0c0c0d);
}

/* ---- Tabs: classic = current look (filled active-tab pill, untouched). Arms
   set component vars on the wrapper where a modeled override must be able to
   beat them; structural layout nudges stay on the inner root. */
.opencanvas-tab-bar {
  gap: var(--opencanvas-tabs-bar-gap, 8px);
  background: var(--opencanvas-tabs-bar-bg, transparent);
  border: var(--opencanvas-tabs-bar-border-width, 0) solid var(--opencanvas-tabs-bar-border-color, transparent);
  border-bottom-width: var(--opencanvas-tabs-bar-border-width, 1px);
  border-bottom-color: var(--opencanvas-tabs-bar-border-color, var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18)));
  border-radius: var(--opencanvas-tabs-bar-radius, 0);
}
.opencanvas-tab {
  border-radius: var(--opencanvas-tabs-tab-radius, var(--opencanvas-kit-radius, 8px));
  color: var(--opencanvas-tabs-tab-color, var(--opencanvas-kit-muted, #9ca3af));
  padding: var(--opencanvas-tabs-tab-pad-y, 0) var(--opencanvas-tabs-tab-pad-x, 18px);
  font-weight: var(--opencanvas-tabs-tab-font-weight, 600);
}
.opencanvas-tab[data-tab-active] {
  background: var(--opencanvas-tabs-active-tab-bg, var(--opencanvas-kit-accent, #7dd3fc));
  color: var(--opencanvas-tabs-active-tab-color, var(--opencanvas-kit-bg, #0c0c0d));
  font-weight: var(--opencanvas-tabs-active-tab-font-weight, var(--opencanvas-tabs-tab-font-weight, 600));
  box-shadow: inset 0 -2px 0 0 var(--opencanvas-tabs-active-indicator-color, transparent);
}
.opencanvas-tab-panel {
  background: var(--opencanvas-tabs-panel-bg, transparent);
  border: var(--opencanvas-tabs-panel-border-width, 0) solid var(--opencanvas-tabs-panel-border-color, transparent);
  border-radius: var(--opencanvas-tabs-panel-radius, 0);
}
.opencanvas-element[data-element-type="tabs"][data-variant="underline"] {
  --opencanvas-tabs-active-tab-bg: transparent;
  --opencanvas-tabs-active-tab-color: var(--opencanvas-kit-accent, #7dd3fc);
  --opencanvas-tabs-tab-radius: 0;
  --opencanvas-tabs-active-indicator-color: var(--opencanvas-kit-accent, #7dd3fc);
}
.opencanvas-tabs[data-variant="underline"] .opencanvas-tab[data-tab-active] {
  border-radius: 0;
}
.opencanvas-element[data-element-type="tabs"][data-variant="pill"] {
  --opencanvas-tabs-tab-radius: 9999px;
}
.opencanvas-tabs[data-variant="pill"] .opencanvas-tab { border-radius: var(--opencanvas-tabs-tab-radius, 9999px); }
.opencanvas-element[data-element-type="tabs"][data-variant="segmented"] {
  --opencanvas-tabs-bar-gap: 0;
  --opencanvas-tabs-bar-bg: var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06));
  --opencanvas-tabs-bar-border-width: 1px;
  --opencanvas-tabs-bar-border-color: var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18));
  --opencanvas-tabs-bar-radius: 9999px;
  --opencanvas-tabs-tab-radius: 9999px;
}
.opencanvas-tabs[data-variant="segmented"] .opencanvas-tab-bar {
  padding: 4px;
  width: max-content;
}
.opencanvas-tabs[data-variant="segmented"] .opencanvas-tab { border-radius: var(--opencanvas-tabs-tab-radius, 9999px); }

/* ---- Carousel: classic = current look. The other arms repaint slides. */
.opencanvas-carousel[data-variant="ken-burns"] .opencanvas-carousel-image {
  animation: opencanvas-ken-burns 14s ease-in-out infinite alternate;
}
.opencanvas-element[data-element-type="carousel"][data-variant="editorial"] {
  --opencanvas-carousel-caption-pad-y: 28px;
  --opencanvas-carousel-caption-pad-x: 32px;
  --opencanvas-carousel-caption-font-size: 18px;
  --opencanvas-carousel-caption-font-weight: 600;
  --opencanvas-carousel-caption-bg: linear-gradient(to top, rgba(0, 0, 0, 0.82), rgba(0, 0, 0, 0));
}
/* coverflow: the carousel runtime publishes --opencanvas-slide-offset (signed
   distance to the active slide) per slide; CSS positions/scales/dims from it.
   PAGINATE MODE ONLY — scroll-snap already lays slides out as a relative flex
   rail, and stacking coverflow on top of it is incompatible, so the arm is
   scoped out of scroll-snap. --opencanvas-coverflow-depth is |offset| CLAMPED to
   [0,3] so scale stays in [0.52,1] and opacity in [0.1,1] — never negative for
   far slides. Runtime publishes state, CSS paints — no DOM branch (ADR dec 3). */
.opencanvas-carousel[data-variant="coverflow"]:not([data-opencanvas-carousel-mode="scroll-snap"]) {
  overflow: visible;
}
.opencanvas-carousel[data-variant="coverflow"]:not([data-opencanvas-carousel-mode="scroll-snap"]) .opencanvas-carousel-slide {
  --opencanvas-coverflow-depth: min(3, max(var(--opencanvas-slide-offset, 0), var(--opencanvas-slide-offset, 0) * -1));
  opacity: calc(1 - 0.3 * var(--opencanvas-coverflow-depth));
  visibility: visible;
  transform: translateX(calc(var(--opencanvas-slide-offset, 0) * 56%))
    scale(calc(1 - 0.16 * var(--opencanvas-coverflow-depth)));
  transition: transform 320ms ease, opacity 320ms ease;
  z-index: calc(10 - var(--opencanvas-coverflow-depth));
}
@keyframes opencanvas-ken-burns {
  from { transform: scale(1); }
  to { transform: scale(1.12); }
}

/* ---- Form: classic = current. Each arm SETS --opencanvas-form-* custom
   properties on the OUTER wrapper, so typed formStyle emitted inline on that
   wrapper can override modeled values without proximity games. Direct
   descendant declarations are used only for unmodeled structural treatments
   (the underline bottom-rule, brutalist offset shadow, and spotlight layout). */
.opencanvas-element[data-element-type="form"][data-variant="underline"] {
  --opencanvas-form-input-border-width: 0;
  --opencanvas-form-input-radius: 0;
  --opencanvas-form-input-pad-x: 0;
}
.opencanvas-form[data-variant="underline"] .opencanvas-form-input,
.opencanvas-form[data-variant="underline"] .opencanvas-form select {
  border-bottom: 1px solid var(--opencanvas-form-input-border-color, var(--opencanvas-hairline));
  background: transparent;
}
.opencanvas-element[data-element-type="form"][data-variant="card"] {
  --opencanvas-form-field-surface-pad-y: 14px;
  --opencanvas-form-field-surface-pad-x: 16px;
  --opencanvas-form-field-surface-radius: var(--opencanvas-kit-radius, 10px);
  --opencanvas-form-field-surface-bg: var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06));
  --opencanvas-form-field-surface-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
}
.opencanvas-element[data-element-type="form"][data-variant="brutalist"] {
  --opencanvas-form-input-border-width: 2px;
  --opencanvas-form-input-border-color: currentColor;
  --opencanvas-form-input-radius: 0;
  --opencanvas-form-submit-radius: 0;
}
.opencanvas-form[data-variant="brutalist"] .opencanvas-form-input,
.opencanvas-form[data-variant="brutalist"] .opencanvas-form select {
  box-shadow: 4px 4px 0 0 currentColor;
}
.opencanvas-form[data-variant="brutalist"] .opencanvas-form-label {
  font-family: var(--opencanvas-kit-font-mono, ui-monospace, monospace);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.opencanvas-form[data-variant="brutalist"] .opencanvas-form-submit { border-radius: 0; box-shadow: 4px 4px 0 0 currentColor; }
/* spotlight: the card look + a pointer-follow radial glow. The glow centre is
   --opencanvas-ptr-x/y (published by the pointer-fx runtime); when the runtime
   has not run the 50%/50% fallbacks render a deliberate, authored centred glow
   (ADR dec 6 — the static base is a shippable look, not a silent fallback). */
.opencanvas-form[data-variant="spotlight"] {
  padding: 20px;
  border-radius: var(--opencanvas-kit-radius, 12px);
  background:
    radial-gradient(
      var(--opencanvas-form-spotlight-glow-size, 240px) circle at var(--opencanvas-ptr-x, 50%) var(--opencanvas-ptr-y, 50%),
      color-mix(in oklab, var(--opencanvas-form-spotlight-glow-color, var(--opencanvas-kit-accent, #7dd3fc)) calc(var(--opencanvas-form-spotlight-glow-opacity, 0.22) * 100%), transparent),
      transparent 70%
    ),
    var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06));
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
}

/* ---- pointer-fx: generic CSS hooks any element with the attribute uses.
   spotlight publishes --opencanvas-ptr-x/y (consumed per-variant above);
   tilt publishes --opencanvas-tilt-x/y, applied generically here;
   magnetic publishes --opencanvas-magnetic-x/y, applied generically here. */
.opencanvas-element[data-opencanvas-pointer-fx="spotlight"]::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  background:
    radial-gradient(
      220px circle at var(--opencanvas-ptr-x, 50%) var(--opencanvas-ptr-y, 50%),
      color-mix(in oklab, var(--opencanvas-kit-accent, currentColor) 24%, transparent),
      transparent 70%
    );
  opacity: 0.7;
}

[data-opencanvas-pointer-fx="tilt"] {
  transform: perspective(700px)
    rotateX(var(--opencanvas-tilt-y, 0deg))
    rotateY(var(--opencanvas-tilt-x, 0deg));
  transition: transform 120ms ease;
  transform-style: preserve-3d;
}

[data-opencanvas-pointer-fx="magnetic"] {
  transform: translate3d(
    var(--opencanvas-magnetic-x, 0px),
    var(--opencanvas-magnetic-y, 0px),
    0
  );
  transition: transform 160ms ease-out;
  will-change: transform;
}

[data-opencanvas-route-container] {
  view-transition-name: opencanvas-site;
}
[data-opencanvas-route-state="outgoing"] {
  pointer-events: none;
}
[data-opencanvas-route-mode="fade"][data-opencanvas-route-state="outgoing"] {
  opacity: 0;
}
[data-opencanvas-route-mode="slide"][data-opencanvas-route-state="outgoing"] {
  transform: translateX(-24px);
  opacity: 0;
}
[data-opencanvas-route-mode="wipe"][data-opencanvas-route-state="outgoing"] {
  clip-path: inset(0 100% 0 0);
}

[data-opencanvas-overlays-root] {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 100000;
}
.opencanvas-overlay[hidden] {
  display: none;
}
.opencanvas-overlay[data-opencanvas-overlay-open] {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  pointer-events: auto;
}
.opencanvas-overlay-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.56);
}
.opencanvas-overlay[data-opencanvas-overlay-backdrop-style="blur"] .opencanvas-overlay-backdrop {
  background: rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(18px);
}
.opencanvas-overlay[data-opencanvas-overlay-backdrop-style="solid"] .opencanvas-overlay-backdrop {
  background: var(--opencanvas-kit-bg, #0c0c0d);
}
.opencanvas-overlay-surface {
  position: relative;
  z-index: 1;
  max-width: min(92vw, 960px);
  max-height: 90vh;
  overflow: auto;
  background: var(--opencanvas-kit-bg, #0c0c0d);
  color: var(--opencanvas-kit-text, #f6f6f6);
}
.opencanvas-overlay[data-opencanvas-overlay-chrome="glass-panel"] .opencanvas-overlay-surface {
  border: 1px solid color-mix(in oklab, currentColor 18%, transparent);
  border-radius: 28px;
  background: color-mix(in oklab, var(--opencanvas-kit-bg, #0c0c0d) 76%, transparent);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(24px);
}
.opencanvas-overlay[data-opencanvas-overlay-chrome="editorial-frame"] .opencanvas-overlay-surface {
  border: 1px solid color-mix(in oklab, var(--opencanvas-kit-accent, #f97316) 44%, transparent);
  border-radius: 0;
  box-shadow: inset 0 0 0 10px color-mix(in oklab, var(--opencanvas-kit-bg, #0c0c0d) 84%, transparent);
}
.opencanvas-overlay[data-opencanvas-overlay-presentation="fullscreen-menu"][data-opencanvas-overlay-open] {
  place-items: stretch;
}
.opencanvas-overlay[data-opencanvas-overlay-presentation="fullscreen-menu"] .opencanvas-overlay-backdrop {
  background: var(--opencanvas-kit-bg, #0c0c0d);
}
.opencanvas-overlay[data-opencanvas-overlay-presentation="fullscreen-menu"] .opencanvas-overlay-surface {
  width: 100vw;
  height: 100vh;
  max-width: none;
  max-height: none;
  overflow: auto;
  background:
    radial-gradient(circle at 12% 18%, color-mix(in oklab, var(--opencanvas-kit-accent, #f97316) 22%, transparent), transparent 34%),
    var(--opencanvas-kit-bg, #0c0c0d);
}
.opencanvas-overlay--fullscreen-menu .opencanvas-overlay-close {
  top: 24px;
  right: 24px;
  padding: 10px 14px;
  border: 1px solid color-mix(in oklab, currentColor 28%, transparent);
  border-radius: 999px;
  background: color-mix(in oklab, var(--opencanvas-kit-bg, #0c0c0d) 72%, transparent);
  color: inherit;
}
.opencanvas-overlay-close {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2;
}
.opencanvas-overlay[data-opencanvas-overlay-close-placement="top-left"] .opencanvas-overlay-close,
.opencanvas-overlay-close--top-left {
  left: 12px;
  right: auto;
}
.opencanvas-overlay[data-opencanvas-overlay-close-placement="inside"] .opencanvas-overlay-close,
.opencanvas-overlay-close--inside {
  top: 20px;
  right: 20px;
}

.opencanvas-load-experience {
  position: fixed;
  inset: 0;
  z-index: 100001;
  display: grid;
  place-items: center;
  gap: 18px;
  background: var(--opencanvas-kit-bg, #0c0c0d);
  color: var(--opencanvas-kit-text, #f6f6f6);
}
.opencanvas-load-experience[data-opencanvas-load-hidden="true"] {
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease;
}
.opencanvas-load-progress {
  width: min(260px, 60vw);
  height: 3px;
  background: rgba(127, 127, 127, 0.25);
  overflow: hidden;
}
.opencanvas-load-progress > span {
  display: block;
  width: 100%;
  height: 100%;
  transform: translateX(-100%);
  background: var(--opencanvas-kit-accent, currentColor);
  animation: opencanvas-load-progress 1200ms ease-in-out infinite;
}
@keyframes opencanvas-load-progress {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
.opencanvas-load-error[hidden] {
  display: none;
}

[data-opencanvas-motion-running="true"] {
  transition:
    opacity var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    transform var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    filter var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms),
    clip-path var(--opencanvas-motion-lite-duration, 180ms) var(--opencanvas-motion-lite-easing, ease) var(--opencanvas-motion-lite-delay, 0ms);
}
[data-opencanvas-motion-effect="fade"][data-opencanvas-motion-running="true"] {
  opacity: 0;
}
[data-opencanvas-motion-effect="slide"][data-opencanvas-motion-running="true"] {
  transform: translateY(16px);
}
[data-opencanvas-motion-effect="scale"][data-opencanvas-motion-running="true"] {
  transform: scale(0.96);
}
[data-opencanvas-motion-effect="wipe"][data-opencanvas-motion-running="true"] {
  clip-path: inset(0 100% 0 0);
}
[data-opencanvas-motion-effect="blur"][data-opencanvas-motion-running="true"] {
  filter: blur(8px);
}
`;

export const canvasPublishedStyles = `${baseCss}\n${carouselActiveCss}\n${variantCss}\n${kitCss}`;
