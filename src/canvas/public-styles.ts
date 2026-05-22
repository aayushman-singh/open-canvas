// src/canvas/public-styles.ts
//
// Minimal CSS shipped on the visitor-facing Published Site. Composed of:
//   - the shared style-kit CSS produced by `buildAllStyleKitsCss()` so visitor
//     and editor previews always agree on tokens, variants, and motion
//   - a small container reset that lets the absolute-positioned canvas
//     elements (built by renderCanvasSnapshot) lay out correctly.
//
// The kit token table USED to live here as hand-maintained selectors. As of
// T8 the source of truth is `src/canvas/style-kits.ts` — a single
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
  border-radius: var(--rev01-kit-action-radius, 999px);
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
`;

export const canvasPublishedStyles = `${baseCss}\n${kitCss}`;
