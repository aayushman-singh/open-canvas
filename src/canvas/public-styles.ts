// src/canvas/public-styles.ts
//
// Minimal CSS shipped on the visitor-facing Published Site. Holds:
//   - the style-kit colour token block (mirrors the editor's token mapping so
//     visitor and editor previews land on the same palette)
//   - a small container reset that lets the absolute-positioned canvas
//     elements (built by renderCanvasSnapshot) lay out correctly.
//
// The editor's full chrome stylesheet (canvasEditorStyles in
// src/editor/canvas-styles.ts) is intentionally NOT reused here: visitors get
// no editor topbar, inspector, or selection outlines. T8 may extract a deeper
// shared base if the editor preview drifts from the public renderer; for now
// the kit tokens are the only overlap.

export const canvasPublishedStyles = String.raw`
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
  --kit-bg: #0c0c0d;
  --kit-fg: #f6f6f6;
  --kit-accent: oklch(0.78 0.15 200);
  background: var(--kit-bg);
  color: var(--kit-fg);
}

.rev01-site[data-style-kit="charcoal"] {
  --kit-bg: #0c0c0d;
  --kit-fg: #f6f6f6;
  --kit-accent: oklch(0.85 0.02 240);
}
.rev01-site[data-style-kit="orange-editorial"] {
  --kit-bg: #fff7ef;
  --kit-fg: #221610;
  --kit-accent: oklch(0.72 0.18 50);
}
.rev01-site[data-style-kit="blue-saas"] {
  --kit-bg: #0b1530;
  --kit-fg: #e8efff;
  --kit-accent: oklch(0.74 0.16 250);
}
.rev01-site[data-style-kit="green-organic"] {
  --kit-bg: #0f1a14;
  --kit-fg: #e7f3ea;
  --kit-accent: oklch(0.76 0.15 150);
}

.rev01-page {
  margin: 0 auto;
  background: var(--kit-bg);
  color: var(--kit-fg);
}

.rev01-section {
  position: relative;
}

.rev01-element {
  /* Wrapper styles (position, dimensions, z-index) come from inline style
     emitted by the renderer; this class just keeps a stable selector. */
}

.rev01-text { color: inherit; }

.rev01-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0 16px;
  border-radius: 999px;
  background: var(--kit-accent);
  color: var(--kit-bg);
  text-decoration: none;
  font-weight: 600;
}
.rev01-action[data-variant="outline"] {
  background: transparent;
  border: 1px solid var(--kit-accent);
  color: var(--kit-fg);
}
.rev01-action[data-variant="ghost"] {
  background: transparent;
  color: var(--kit-fg);
}

.rev01-shape {
  width: 100%;
  height: 100%;
  background: var(--kit-accent);
  opacity: 0.6;
}
.rev01-shape[data-variant="circle"] { border-radius: 50%; }
.rev01-shape[data-variant="pill"] { border-radius: 999px; }
.rev01-shape[data-variant="blob"] { border-radius: 36% 64% 60% 40% / 45% 35% 65% 55%; }
.rev01-shape[data-variant="line"] { height: 4px; align-self: center; }

.rev01-surface {
  width: 100%;
  height: 100%;
  background: oklch(0.95 0 0 / 0.06);
  border: 1px solid oklch(0.6 0.02 240 / 0.25);
  border-radius: 8px;
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
  text-decoration-color: var(--kit-accent, currentColor);
}
.rev01-inline-link:hover {
  color: var(--kit-accent, currentColor);
}
`;
