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

.opencanvas-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--opencanvas-kit-action-padding, 0 16px);
  border-radius: var(--opencanvas-kit-action-radius, 8px);
  background: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
  color: var(--opencanvas-kit-accent-text, var(--kit-bg, #fff));
  text-decoration: none;
  font-weight: 600;
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
  gap: 8px;
  width: 100%;
  height: 100%;
  overflow: auto;
}
.opencanvas-accordion-item {
  border: 1px solid var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18));
  border-radius: var(--opencanvas-kit-radius, 8px);
  background: var(--opencanvas-kit-panel, rgba(127, 127, 127, 0.06));
  overflow: hidden;
}
.opencanvas-accordion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 12px 16px;
  background: transparent;
  border: 0;
  color: inherit;
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
  padding: 0 16px 14px;
  font-size: 14px;
  line-height: 1.55;
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
  gap: 8px;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--opencanvas-kit-hairline, rgba(127, 127, 127, 0.18));
  overflow-x: auto;
}
.opencanvas-tab {
  appearance: none;
  border: 0;
  border-radius: var(--opencanvas-kit-radius, 8px);
  background: transparent;
  color: var(--opencanvas-kit-muted, #9ca3af);
  padding: 0 18px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.opencanvas-tab[data-tab-active] {
  background: var(--opencanvas-kit-accent, #7dd3fc);
  color: var(--opencanvas-kit-bg, #0c0c0d);
}
.opencanvas-tab-panel {
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
  padding: 14px 24px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0));
  color: #fff;
  font-size: 14px;
  line-height: 1.4;
}
.opencanvas-carousel-arrow {
  position: absolute;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: 0;
  border-radius: 50%;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  z-index: 2;
  transition: background 120ms ease;
}
.opencanvas-carousel-arrow:hover { background: rgba(0, 0, 0, 0.78); }

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
  width: 40px;
}
.opencanvas-carousel[data-opencanvas-arrow-style="square"] .opencanvas-carousel-arrow {
  border-radius: var(--opencanvas-kit-radius, 8px);
  width: 40px;
}
.opencanvas-carousel[data-opencanvas-arrow-style="pill"] .opencanvas-carousel-arrow {
  border-radius: 9999px;
  width: 56px;
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
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 0;
  padding: 0;
  background: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.opencanvas-carousel-dot[aria-selected="true"] {
  background: #fff;
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

export const canvasPublishedStyles = `${baseCss}\n${carouselActiveCss}\n${kitCss}`;
