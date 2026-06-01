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

[data-rev01-public-root] {
  display: block;
  min-height: 100vh;
}

.rev01-site {
  display: block;
  background: var(--rev01-kit-bg, var(--kit-bg, #0c0c0d));
  color: var(--rev01-kit-text, var(--kit-fg, #f6f6f6));
  font-family: var(--rev01-kit-font-body, 'IBM Plex Sans', system-ui, sans-serif);
  line-height: var(--rev01-kit-line-height, 1.5);
}

.rev01-page {
  margin: 0 auto;
  background: var(--rev01-kit-bg, var(--kit-bg, #0c0c0d));
  color: var(--rev01-kit-text, var(--kit-fg, #f6f6f6));
}

.rev01-section {
  position: relative;
}

.rev01-text { color: inherit; }

.rev01-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--rev01-kit-action-padding, 0 16px);
  border-radius: var(--rev01-kit-action-radius, 8px);
  background: var(--rev01-kit-accent, var(--kit-accent, currentColor));
  color: var(--rev01-kit-accent-text, var(--kit-bg, #fff));
  text-decoration: none;
  font-weight: 600;
}

.rev01-shape {
  width: 100%;
  height: 100%;
  background: var(--rev01-kit-shape-fill, var(--rev01-kit-accent, var(--kit-accent, currentColor)));
  opacity: 0.85;
}
.rev01-shape[data-variant="circle"] { border-radius: 50%; }
.rev01-shape[data-variant="pill"] { border-radius: 999px; }
.rev01-shape[data-variant="blob"] { border-radius: 36% 64% 60% 40% / 45% 35% 65% 55%; }
.rev01-shape[data-variant="line"] { height: 4px; align-self: center; }

.rev01-surface {
  width: 100%;
  height: 100%;
  background: var(--rev01-kit-panel, rgba(255, 255, 255, 0.06));
  border-radius: var(--rev01-kit-radius, 8px);
  box-shadow: var(--rev01-kit-shadow, none);
}

.rev01-media {
  width: 100%;
  height: 100%;
  display: block;
}

.rev01-inline-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
}
.rev01-inline-link:hover {
  color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
}

.rev01-nav-link {
  color: inherit;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  padding: 6px 12px;
}
.rev01-nav-link:hover {
  color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
}
.rev01-nav {
  gap: 4px;
}
.rev01-nav-slot {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rev01-nav-logo {
  height: 28px;
  width: auto;
}

/* Presence indicator — a tiny pill that lives in the top-right of the
   published page. Hidden by default; the visitor script removes the
   [hidden] attribute when more than one socket is connected. */
[data-rev01-presence] {
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
[data-rev01-presence][hidden] {
  display: none;
}

/* ---- Element style overrides ------------------------------------------------
   When a per-element style property is set on the wrapper (.rev01-element),
   the inner element's kit-driven value for that property must step aside so
   the wrapper's value shows through. Each data-es-* attribute resets only
   the property it controls — unrelated kit values stay intact.              */

.rev01-element[data-es-bg] > .rev01-surface,
.rev01-element[data-es-bg] > .rev01-action,
.rev01-element[data-es-bg] > .rev01-shape { background: transparent; }

.rev01-element[data-es-radius] > .rev01-surface,
.rev01-element[data-es-radius] > .rev01-action,
.rev01-element[data-es-radius] > .rev01-shape { border-radius: inherit; }

.rev01-element[data-es-border] > .rev01-surface,
.rev01-element[data-es-border] > .rev01-action,
.rev01-element[data-es-border] > .rev01-shape { border-color: transparent; border-width: 0; }

.rev01-element[data-es-shadow] > .rev01-surface,
.rev01-element[data-es-shadow] > .rev01-action,
.rev01-element[data-es-shadow] > .rev01-shape { box-shadow: none; }

/* ---- Forms ------------------------------------------------------------
   Visitor-facing form chrome. Browsers' default form widgets look broken
   next to a designed canvas, so we ship a small, opinionated reset:
   stacked labels, generous tap targets, kit-token-aware focus ring, and
   a primary CTA that picks up the active kit accent. The AJAX handler
   (emitted inline alongside the form) flips visibility on the success
   message and reveals .rev01-form-error on failure.                       */
.rev01-form {
  display: grid;
  gap: 14px;
  max-width: 100%;
}
.rev01-form-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  color: var(--rev01-fg);
}
.rev01-form-field-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.rev01-form-label {
  font-weight: 500;
  color: var(--rev01-fg);
  line-height: 1.4;
}
.rev01-form-input,
.rev01-form select {
  width: 100%;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.4;
  color: var(--rev01-fg);
  background: var(--rev01-bg);
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
  appearance: none;
}
.rev01-form-input:hover,
.rev01-form select:hover {
  border-color: var(--rev01-fg-mute);
}
.rev01-form-input:focus,
.rev01-form select:focus {
  outline: none;
  border-color: var(--rev01-accent);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--rev01-accent) 24%, transparent);
}
.rev01-form-input::placeholder { color: var(--rev01-fg-mute); }
.rev01-form textarea.rev01-form-input {
  resize: vertical;
  min-height: 96px;
  font-family: inherit;
}
.rev01-form-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--rev01-accent);
}
.rev01-form-submit {
  justify-self: start;
  padding: 10px 18px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: var(--rev01-bg);
  background: var(--rev01-accent);
  border: 0;
  border-radius: 6px;
  cursor: pointer;
  transition: filter 120ms ease, transform 120ms ease;
}
.rev01-form-submit:hover { filter: brightness(1.05); }
.rev01-form-submit:active { transform: translateY(1px); }
.rev01-form-submit:disabled,
.rev01-form-submit[data-busy="1"] {
  opacity: 0.6;
  cursor: progress;
  filter: none;
}
.rev01-form-success {
  margin: 0;
  padding: 12px 14px;
  font-size: 14px;
  color: var(--rev01-accent);
  background: color-mix(in oklab, var(--rev01-accent) 12%, transparent);
  border: 1px solid color-mix(in oklab, var(--rev01-accent) 32%, transparent);
  border-radius: 6px;
}
.rev01-form-error {
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
