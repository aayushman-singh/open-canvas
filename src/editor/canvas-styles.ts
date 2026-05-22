// src/editor/canvas-styles.ts
//
// Stylesheet for the desktop Canvas Editor (T4). Inlined into the editor route
// via raw(canvasEditorStyles). Dark theme tuned for dense desktop editing.
//
// The visitor renderer (src/canvas/public-styles.ts) and this editor preview
// share a single source of truth for kit tokens, variants, and motion:
// `buildAllStyleKitsCss` in src/canvas/style-kits.ts. The hard-coded
// per-kit `--kit-*` table that used to live here was removed in T8 — the
// editor and the visitor cannot drift because they read the same map.

import { buildAllStyleKitsCss } from '../canvas/style-kits.js';

const kitCss = buildAllStyleKitsCss();

const chromeCss = String.raw`
:root {
  --rev01-bg: #0a0e1a;
  --rev01-bg-panel: oklch(0.2 0.04 245 / 0.82);
  --rev01-bg-panel-strong: oklch(0.22 0.04 245 / 0.95);
  --rev01-bg-titlebar: oklch(0.16 0.03 245 / 0.92);
  --rev01-fg: oklch(0.96 0.02 240);
  --rev01-fg-mute: oklch(0.72 0.04 240);
  --rev01-fg-faint: oklch(0.55 0.03 240);
  --rev01-accent: oklch(0.78 0.15 200);
  --rev01-accent-soft: oklch(0.78 0.15 200 / 0.22);
  --rev01-warn: oklch(0.85 0.18 70);
  --rev01-ok: oklch(0.82 0.18 145);
  --rev01-danger: oklch(0.7 0.21 25);
  --rev01-hairline: oklch(0.6 0.02 240 / 0.18);
  --rev01-hairline-strong: oklch(0.6 0.02 240 / 0.32);
  --rev01-radius: 8px;
  --rev01-font-sans: 'IBM Plex Sans', system-ui, -apple-system, sans-serif;
  --rev01-font-mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--rev01-bg);
  color: var(--rev01-fg);
  font-family: var(--rev01-font-sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

body {
  min-height: 100vh;
}

.rev01-editor {
  display: grid;
  grid-template-rows: 56px 1fr 28px;
  grid-template-columns: 1fr 320px;
  grid-template-areas:
    "topbar topbar"
    "canvas inspector"
    "status status";
  height: 100vh;
  width: 100%;
}
/* Kit token blocks for the editor preview wrapper come from
   buildAllStyleKitsCss() — see the bottom of this file. The
   [data-style-kit="X"] selector matches both <main class="rev01-editor"> and
   the inner <main class="rev01-site">, so the editor preview and the
   published render share the same tokens. */

.rev01-editor-topbar {
  grid-area: topbar;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-titlebar);
  font-family: var(--rev01-font-mono);
  font-size: 12px;
}

.rev01-editor-topbar .crumbs {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--rev01-fg-mute);
}
.rev01-editor-topbar .crumbs .sep {
  color: var(--rev01-fg-faint);
}
.rev01-editor-topbar .crumbs .here {
  color: var(--rev01-fg);
}

.rev01-editor-topbar .address {
  margin-left: 8px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-panel);
  color: var(--rev01-fg-mute);
}

.rev01-editor-topbar .spacer {
  flex: 1 1 auto;
}

.rev01-editor-topbar .style-kits {
  display: flex;
  gap: 4px;
}
.rev01-editor-topbar .style-kits button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg-mute);
  font: inherit;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.rev01-editor-topbar .style-kits button:hover {
  border-color: var(--rev01-hairline-strong);
  color: var(--rev01-fg);
}
.rev01-editor-topbar .style-kits button.active {
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
  background: var(--rev01-accent-soft);
}

.rev01-editor-topbar #canvas-save,
.rev01-editor-topbar #canvas-publish {
  appearance: none;
  border: 1px solid var(--rev01-hairline-strong);
  background: var(--rev01-bg-panel-strong);
  color: var(--rev01-fg);
  font: inherit;
  padding: 6px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.rev01-editor-topbar #canvas-save:hover {
  border-color: var(--rev01-accent);
}
.rev01-editor-topbar #canvas-publish[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Viewport wraps #canvas-root so we can apply CSS transform scale on the
   page wrapper while the viewport scrolls naturally. The viewport owns the
   dark background + outer padding so the zoomed page sits on the editor
   chrome instead of breaking out of it. */
.rev01-viewport {
  grid-area: canvas;
  position: relative;
  overflow: auto;
  background:
    radial-gradient(ellipse at 18% -10%, oklch(0.32 0.1 220 / 0.18), transparent 55%),
    linear-gradient(180deg, #0a0e1a 0%, #060912 100%);
  padding: 32px;
}

#canvas-root {
  /* When the script wraps #canvas-root in .rev01-viewport, the wrapper owns
     grid-area / scroll / background. #canvas-root itself just hosts the
     transformed page. Keep transform-origin top-left so zoom math is
     predictable. */
  transform-origin: top left;
  display: block;
}

/* Floating zoom toolbar pinned to the viewport's top-left. Stays anchored
   while the viewport scrolls so the controls are always reachable. */
.rev01-zoom-toolbar {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 10002;
  width: max-content;
  display: inline-flex;
  gap: 4px;
  margin: -16px 0 8px 0;
  padding: 6px;
  border-radius: 8px;
  background: var(--rev01-bg-titlebar);
  border: 1px solid var(--rev01-hairline-strong);
  box-shadow: 0 6px 18px oklch(0 0 0 / 0.35);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
}
.rev01-zoom-toolbar button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 28px;
}
.rev01-zoom-toolbar button:hover {
  border-color: var(--rev01-accent);
}
.rev01-zoom-toolbar .zoom-readout {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--rev01-fg-mute);
  min-width: 44px;
  justify-content: center;
}

.rev01-page {
  margin: 0 auto;
  background: var(--kit-bg);
  color: var(--kit-fg);
  box-shadow: 0 24px 60px oklch(0 0 0 / 0.5);
  border-radius: 6px;
  overflow: hidden;
}

.rev01-section {
  border-bottom: 1px dashed oklch(0.6 0.02 240 / 0.15);
}
.rev01-section:last-child {
  border-bottom: 0;
}

.rev01-section[data-selected="true"] {
  outline: 2px solid var(--rev01-accent);
  outline-offset: -2px;
}

.rev01-section .section-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  gap: 4px;
  z-index: 9999;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: 6px;
  padding: 4px;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
}
.rev01-section[data-selected="true"] .section-toolbar {
  display: flex;
  flex-wrap: wrap;
  max-width: 60%;
}
.rev01-section .section-toolbar button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
}
.rev01-section .section-toolbar button:hover {
  border-color: var(--rev01-accent);
}
.rev01-section .section-toolbar button.danger:hover {
  border-color: var(--rev01-danger);
  color: var(--rev01-danger);
}

.rev01-element {
  cursor: pointer;
  user-select: none;
}
.rev01-element[data-selected="true"] {
  outline: 2px solid var(--rev01-accent);
  outline-offset: 1px;
}
.rev01-element [contenteditable="true"] {
  cursor: text;
  user-select: text;
  outline: 1px dashed var(--rev01-accent);
  outline-offset: 2px;
}

.rev01-element .resize-handle {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  background: var(--rev01-accent);
  border: 1px solid var(--rev01-bg);
  border-radius: 2px;
  cursor: nwse-resize;
  display: none;
  z-index: 10000;
}
.rev01-element[data-selected="true"] .resize-handle {
  display: block;
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
  background: oklch(0.6 0.02 240 / 0.12);
  border: 1px dashed oklch(0.6 0.02 240 / 0.35);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
}

#canvas-inspector {
  grid-area: inspector;
  border-left: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-panel-strong);
  padding: 16px;
  overflow-y: auto;
  font-size: 13px;
}
#canvas-inspector[hidden] { display: none; }
#canvas-inspector h3 {
  margin: 0 0 12px;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rev01-fg-mute);
}
#canvas-inspector .field {
  display: grid;
  gap: 4px;
  margin-bottom: 10px;
}
#canvas-inspector .field label {
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
}
#canvas-inspector input,
#canvas-inspector select {
  appearance: none;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  border-radius: 4px;
  padding: 5px 8px;
  font: inherit;
}
#canvas-inspector input[type="checkbox"] {
  width: auto;
}
#canvas-inspector .row {
  display: flex;
  gap: 8px;
  align-items: center;
}
#canvas-inspector .meta {
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-faint);
  margin-bottom: 12px;
  word-break: break-all;
}

.rev01-editor-status {
  grid-area: status;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-top: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-titlebar);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
}
.rev01-editor-status .error {
  color: var(--rev01-warn);
}
.rev01-editor-status .ok {
  color: var(--rev01-ok);
}

/* Inline mark toolbar — only present in the DOM while a text element is in
   edit mode. Positioned absolutely inside #canvas-root by the client. */
.rev01-mark-toolbar {
  display: inline-flex;
  gap: 2px;
  z-index: 10001;
  padding: 4px;
  border-radius: 6px;
  background: var(--rev01-bg-titlebar);
  border: 1px solid var(--rev01-hairline-strong);
  box-shadow: 0 6px 18px oklch(0 0 0 / 0.35);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
}
.rev01-mark-toolbar button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  min-width: 22px;
}
.rev01-mark-toolbar button:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
}

/* Inspector reading-order group (above the z-order group). Two compact
   buttons plus a "Reading order: N of M" caption. The caption is the only
   place owners see the section.elements[] index, which is what visitors
   hear via assistive tech. */
.rev01-reorder-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.rev01-reorder-buttons button {
  appearance: none;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  flex: 1 1 auto;
}
.rev01-reorder-buttons button:hover {
  border-color: var(--rev01-accent);
}
.rev01-reorder-caption {
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
  margin-bottom: 4px;
}

/* Inspector z-order group: four buttons that mutate element.box.z. */
.rev01-zorder-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}
.rev01-zorder-buttons button {
  appearance: none;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  flex: 1 1 calc(50% - 4px);
}
.rev01-zorder-buttons button:hover {
  border-color: var(--rev01-accent);
}

/* Inline link mark — both editor preview and published renderer use this
   class so the visual treatment stays in sync. */
.rev01-inline-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--kit-accent, currentColor);
}
.rev01-inline-link:hover {
  color: var(--kit-accent, currentColor);
}

/* AI preview panel — transient overlay that appears after the canvas-agent
   preview endpoint returns. Anchored top-right; Accept/Dismiss buttons live
   at the bottom. The panel does not persist across edits — it is rebuilt
   fresh on every preview. */
.rev01-ai-panel {
  position: fixed;
  top: 80px;
  right: 16px;
  width: 360px;
  max-height: calc(100vh - 120px);
  overflow: auto;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: var(--rev01-radius);
  padding: 16px;
  z-index: 50;
  box-shadow: 0 12px 32px oklch(0 0 0 / 0.4);
}
.rev01-ai-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rev01-fg-mute);
}
.rev01-ai-panel p { margin: 6px 0; color: var(--rev01-fg); font-size: 13px; }
.rev01-ai-panel .rev01-ai-note {
  color: var(--rev01-fg-mute);
  font-style: italic;
  border-left: 2px solid var(--rev01-hairline);
  padding-left: 8px;
}
.rev01-ai-panel ol { padding-left: 18px; margin: 6px 0 14px; }
.rev01-ai-panel li { margin: 4px 0; font-size: 13px; color: var(--rev01-fg); }
.rev01-ai-actions { display: flex; gap: 8px; justify-content: flex-end; }
.rev01-ai-actions button {
  appearance: none;
  font: inherit;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
}
.rev01-ai-actions button:hover:not(:disabled) {
  border-color: var(--rev01-accent);
}
.rev01-ai-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.rev01-ai-actions button:first-child {
  background: var(--rev01-accent-soft);
  border-color: var(--rev01-accent);
}

/* AI trigger buttons — inspector + section toolbar both stamp these. */
[data-ai-button] {
  appearance: none;
  font: inherit;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--rev01-accent-soft);
  border: 1px solid var(--rev01-accent);
  color: var(--rev01-fg);
}
[data-ai-button]:hover:not(:disabled) {
  filter: brightness(1.1);
}
[data-ai-button]:disabled { opacity: 0.5; cursor: not-allowed; }

/* Inspector kit summary — a small read-only readout of the active kit's
   accent / display font / motion duration. Helps the Owner see at a glance
   which kit they're editing without having to scroll the topbar. */
.rev01-kit-summary {
  margin: 12px 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
  display: grid;
  gap: 4px;
}
.rev01-kit-summary .row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.rev01-kit-summary .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid var(--rev01-hairline);
}

/* Presence indicator pill in the editor topbar. Hidden by default; the
   client script unhides when count > 1. */
.rev01-editor-topbar [data-rev01-presence] {
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-panel);
  color: var(--rev01-fg-mute);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
}
.rev01-editor-topbar [data-rev01-presence][hidden] {
  display: none;
}
`;

// Concatenate chrome CSS + shared kit CSS. The kit CSS lives in
// src/canvas/style-kits.ts and is the single source of truth shared with the
// public renderer (src/canvas/public-styles.ts).
export const canvasEditorStyles = `${chromeCss}\n${kitCss}`;
