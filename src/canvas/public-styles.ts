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
}
.opencanvas-nav-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}
.opencanvas-nav-logo {
  height: 28px;
  width: auto;
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
`;

export const canvasPublishedStyles = `${baseCss}\n${kitCss}`;
