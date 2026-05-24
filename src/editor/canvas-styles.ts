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
  --rev01-bg-panel-strong: oklch(0.22 0.04 245);
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

/* Body-scroll editor shell: the editor chrome (topbar / left dock / right
   dock / status bar / zoom toolbar / AI panel / modal) is fixed-positioned
   so the canvas area sits in normal document flow. The browser's native
   body scrollbar is the ONLY scrollbar — no inner cells scroll. This means
   the canvas page is horizontally centered between the docks and vertical
   overflow (when zoomed in) scrolls at the browser viewport edge. */
.rev01-editor {
  display: block;
  min-height: 100vh;
  width: 100%;
}

body.rev01-modal-open {
  overflow: hidden;
}
/* Kit token blocks for the editor preview wrapper come from
   buildAllStyleKitsCss() — see the bottom of this file. The
   [data-style-kit="X"] selector matches both <main class="rev01-editor"> and
   the inner <main class="rev01-site">, so the editor preview and the
   published render share the same tokens. */

.rev01-editor-topbar {
  position: sticky;
  top: 0;
  z-index: 200;
  height: 56px;
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

.rev01-editor-sidebar {
  position: fixed;
  top: 56px;
  left: 0;
  bottom: 28px;
  width: 248px;
  z-index: 150;
  min-width: 0;
  border-right: 1px solid var(--rev01-hairline);
  background: linear-gradient(180deg, var(--rev01-bg-titlebar), var(--rev01-bg-panel-strong));
  overflow-y: auto;
}

.rev01-sidebar-tabs {
  display: flex;
  gap: 6px;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--rev01-hairline);
}

.rev01-sidebar-tabs button {
  appearance: none;
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: 6px;
  background: var(--rev01-bg-panel);
  color: var(--rev01-fg);
  cursor: pointer;
  font: 600 12px/1 var(--rev01-font-mono);
  padding: 7px 10px;
}

.rev01-sidebar-tabs button.active {
  border-color: var(--rev01-accent);
  background: var(--rev01-accent-soft);
}

.rev01-sidebar-panel {
  display: grid;
  gap: 18px;
  padding: 14px 12px 20px;
}

.rev01-sidebar-panel[hidden] {
  display: none;
}

.rev01-section-picker {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.rev01-section-picker-empty {
  color: var(--rev01-fg-mute);
  font-size: 13px;
}

.rev01-section-picker-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.rev01-section-picker-search {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: var(--rev01-bg);
  color: var(--rev01-fg);
  font: inherit;
}
.rev01-section-picker-filter {
  padding: 6px 10px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: var(--rev01-bg);
  color: var(--rev01-fg);
  font: inherit;
}
.rev01-section-picker-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rev01-section-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 8px;
  background: var(--rev01-bg-panel);
}
.rev01-section-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.rev01-section-card-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--rev01-fg);
}
.rev01-section-card-recipe {
  font-size: 11px;
  color: var(--rev01-fg-mute);
  font-family: var(--rev01-font-mono);
}
.rev01-section-card-preview {
  margin: 0;
  font-size: 12px;
  color: var(--rev01-fg-mute);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.rev01-section-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.rev01-section-card-template {
  font-size: 11px;
  color: var(--rev01-fg-mute);
}
.rev01-section-card-use {
  padding: 4px 10px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--rev01-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.rev01-section-card-use:hover {
  background: var(--rev01-bg-panel-strong);
}
.rev01-section-card-use:focus-visible {
  outline: 2px solid var(--rev01-accent);
  outline-offset: 2px;
}
.rev01-section-card.is-pending .rev01-section-card-use {
  background: var(--rev01-accent);
  color: var(--rev01-bg);
  border-color: transparent;
}

/* Placement-mode drop slots — drawn between sections while pendingImport is
   set. Slots are invisible until hover/focus by default; while
   data-placement-active is set on <body> they stay fully visible so the
   Owner can clearly see every available insert position. */
.rev01-section-slot {
  display: block;
  width: 100%;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 1px dashed var(--rev01-accent);
  background: transparent;
  color: var(--rev01-accent);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.rev01-section-slot:hover,
.rev01-section-slot:focus-visible {
  opacity: 1;
  background-color: var(--rev01-bg-panel-strong);
}
body[data-placement-active="true"] .rev01-section-slot {
  opacity: 1;
}

.rev01-sidebar-group {
  display: grid;
  gap: 8px;
}

.rev01-sidebar-group[hidden] {
  display: none;
}

.rev01-sidebar-group h2 {
  margin: 0;
  color: var(--rev01-fg-mute);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.rev01-sidebar-command-grid,
.rev01-sidebar-kit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.rev01-sidebar-command,
.rev01-sidebar-kit-grid button {
  appearance: none;
  min-width: 0;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: oklch(0.18 0.035 245 / 0.78);
  color: var(--rev01-fg);
  cursor: pointer;
  font: 12px/1.25 var(--rev01-font-mono);
  min-height: 34px;
  padding: 8px 9px;
  text-align: left;
}

.rev01-sidebar-command:hover,
.rev01-sidebar-kit-grid button:hover {
  border-color: var(--rev01-accent);
  background: var(--rev01-bg-panel);
}

.rev01-sidebar-kit-grid button.active {
  border-color: var(--rev01-accent);
  background: var(--rev01-accent-soft);
  color: var(--rev01-fg);
}

/* Viewport wraps #canvas-root. We apply CSS transform scale on #canvas-root
   to implement zoom; the viewport itself no longer scrolls — the browser's
   native body scroll handles vertical overflow. The viewport owns the dark
   background and centers the canvas horizontally between the fixed docks
   via flex. Top/bottom padding clears the sticky topbar and fixed status
   bar; left/right margins clear the fixed sidebar + inspector docks. */
.rev01-viewport {
  position: relative;
  background:
    radial-gradient(ellipse at 18% -10%, oklch(0.32 0.1 220 / 0.18), transparent 55%),
    linear-gradient(180deg, #0a0e1a 0%, #060912 100%);
  margin-left: 248px;
  margin-right: 320px;
  padding: 32px;
  padding-bottom: 60px;
  min-height: calc(100vh - 56px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

#canvas-root {
  /* When the script wraps #canvas-root in .rev01-viewport, the wrapper owns
     grid-area / scroll / background. #canvas-root itself just hosts the
     transformed page. Keep transform-origin top-left so zoom math is
     predictable. */
  transform-origin: top left;
  display: block;
}

/* Floating zoom toolbar pinned to the top-left of the canvas area, just
   inside the sidebar dock and below the topbar. Fixed so it stays visible
   while the body scrolls; sits above the canvas via z-index. */
.rev01-zoom-toolbar {
  position: fixed;
  top: 64px;
  left: 268px;
  z-index: 160;
  width: max-content;
  display: inline-flex;
  gap: 4px;
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
.rev01-zoom-toolbar .zoom-toolbar-sep {
  width: 1px;
  align-self: stretch;
  background: var(--rev01-hairline);
  margin: 2px 2px;
}
.rev01-zoom-toolbar button[data-mode-action][aria-pressed="true"] {
  background: var(--rev01-accent);
  color: #fff;
  border-color: var(--rev01-accent);
}
.rev01-viewport[data-interaction-mode="pan"] {
  cursor: grab;
}
.rev01-viewport[data-interaction-mode="pan"][data-panning="true"] {
  cursor: grabbing;
}
.rev01-viewport[data-interaction-mode="pan"] .rev01-element,
.rev01-viewport[data-interaction-mode="pan"] .rev01-section {
  pointer-events: none;
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
.rev01-element[data-element-type="text"] {
  cursor: text;
  user-select: text;
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
  width: 10px;
  height: 10px;
  background: var(--rev01-accent);
  border: 1px solid var(--rev01-bg);
  border-radius: 2px;
  display: none;
  z-index: 10000;
}
.rev01-element[data-selected="true"] .resize-handle { display: block; }
.resize-handle-n  { top: -5px; left: calc(50% - 5px); cursor: ns-resize; }
.resize-handle-s  { bottom: -5px; left: calc(50% - 5px); cursor: ns-resize; }
.resize-handle-e  { right: -5px; top: calc(50% - 5px); cursor: ew-resize; }
.resize-handle-w  { left: -5px; top: calc(50% - 5px); cursor: ew-resize; }
.resize-handle-ne { top: -5px; right: -5px; cursor: nesw-resize; }
.resize-handle-nw { top: -5px; left: -5px; cursor: nwse-resize; }
.resize-handle-se { bottom: -5px; right: -5px; cursor: nwse-resize; }
.resize-handle-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }

/* -- Element context menu (3-dot trigger, top-left on hover) ------------- */
.rev01-element .element-menu-trigger {
  position: absolute;
  top: 4px;
  left: 4px;
  width: 22px;
  height: 22px;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: 4px;
  color: var(--rev01-fg);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  z-index: 10001;
  padding: 0;
  letter-spacing: 1px;
}
.rev01-element:hover .element-menu-trigger,
.rev01-element .element-menu-trigger[data-menu-open="true"] {
  display: flex;
}
.rev01-element .element-menu-trigger:hover {
  background: var(--rev01-accent-soft);
  border-color: var(--rev01-accent);
}

.element-menu {
  position: absolute;
  top: 28px;
  left: 4px;
  min-width: 180px;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: var(--rev01-radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 4px 0;
  z-index: 10002;
  font-family: var(--rev01-font-sans);
  font-size: 12px;
}
.element-menu .menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: none;
  color: var(--rev01-fg);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
}
.element-menu .menu-item:hover {
  background: var(--rev01-accent-soft);
}
.element-menu .menu-item.danger {
  color: var(--rev01-danger);
}
.element-menu .menu-item.danger:hover {
  background: oklch(0.7 0.21 25 / 0.15);
}
.element-menu .menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--rev01-hairline);
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
  position: fixed;
  top: 56px;
  right: 0;
  bottom: 28px;
  width: 320px;
  z-index: 150;
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

#canvas-reel {
  position: fixed;
  top: 56px;
  right: 0;
  bottom: 28px;
  width: 320px;
  z-index: 150;
  border-left: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg-panel-strong);
  display: flex;
  flex-direction: column;
  font-size: 13px;
}
#canvas-reel[hidden] { display: none; }
.reel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--rev01-hairline);
  flex-shrink: 0;
}
.reel-header h3 {
  margin: 0;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rev01-fg-mute);
}
.reel-header-actions {
  display: flex;
  gap: 4px;
  align-items: center;
}
.reel-header-actions button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg-mute);
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  line-height: 1;
}
.reel-header-actions button:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
}
.reel-header-actions button[aria-pressed="true"] {
  background: var(--rev01-accent-soft);
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
}
.reel-header-actions .reel-close {
  border: none;
  font-size: 16px;
  padding: 2px 4px;
}
.reel-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
.reel-thumbnail-wrap {
  overflow: hidden;
  position: relative;
  border-radius: 4px;
  border: 1px solid var(--rev01-hairline);
  background: var(--rev01-bg);
  cursor: grab;
  transition: border-color 120ms ease;
}
.reel-thumbnail-wrap:hover {
  border-color: var(--rev01-accent);
}
.reel-thumbnail-wrap[data-reel-selected="true"] {
  border-color: var(--rev01-accent);
  box-shadow: 0 0 0 1px var(--rev01-accent);
}
.reel-tile {
  margin-bottom: 8px;
}
.reel-tile-label {
  margin-top: 4px;
  font-family: var(--rev01-font-mono);
  font-size: 10px;
  color: var(--rev01-fg-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reel-list-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--rev01-hairline);
}
.reel-list-info {
  flex: 1;
  min-width: 0;
}
.reel-list-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--rev01-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reel-list-recipe {
  font-family: var(--rev01-font-mono);
  font-size: 10px;
  color: var(--rev01-fg-faint);
}
.reel-insert-btn {
  display: block;
  width: 100%;
  height: 4px;
  margin: 2px 0;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  position: relative;
  transition: height 120ms ease;
  border-radius: 2px;
}
.reel-insert-btn:hover {
  height: 24px;
  background: var(--rev01-accent-soft);
}
.reel-insert-btn:hover::after {
  content: "+";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--rev01-accent);
  font-size: 14px;
  font-weight: 700;
}
.section-grip-handle {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 24px;
  height: 40px;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-right: none;
  border-radius: 4px 0 0 4px;
  color: var(--rev01-fg-mute);
  font-size: 14px;
  cursor: grab;
  z-index: 100;
  user-select: none;
}
.rev01-section:hover .section-grip-handle {
  display: flex;
}
.section-grip-handle:hover {
  color: var(--rev01-fg);
  background: var(--rev01-accent-soft);
  border-color: var(--rev01-accent);
}
.reel-drop-indicator {
  position: fixed;
  height: 2px;
  background: var(--rev01-accent);
  z-index: 9001;
  pointer-events: none;
  border-radius: 1px;
  box-shadow: 0 0 4px var(--rev01-accent);
}

.rev01-editor-status {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 28px;
  z-index: 150;
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
   edit mode. Appended to document.body and pinned via position: fixed by
   the client so it stays anchored above the text element regardless of
   body scroll. */
.rev01-mark-toolbar {
  position: fixed;
  display: inline-flex;
  gap: 2px;
  z-index: 180;
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
  right: 336px;
  width: 360px;
  max-height: calc(100vh - 120px);
  overflow: auto;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: var(--rev01-radius);
  padding: 16px;
  z-index: 170;
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

/* Modal overlay — replaces window.prompt() for the link/AI dialogs. Single
   modal stack only; the JS throws if two are opened at once. Visual
   language mirrors the AI preview panel so the editor reads as one
   surface. */
.rev01-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rev01-modal {
  min-width: 360px;
  max-width: 480px;
  background: var(--rev01-bg-panel-strong);
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: var(--rev01-radius);
  padding: 18px 18px 16px;
  box-shadow: 0 16px 40px oklch(0 0 0 / 0.5);
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--rev01-fg);
  font: inherit;
}
.rev01-modal h3 {
  margin: 0;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--rev01-fg-mute);
}
.rev01-modal label {
  font-size: 12px;
  color: var(--rev01-fg-mute);
}
.rev01-modal input[type="text"],
.rev01-modal textarea,
.rev01-modal select {
  appearance: none;
  font: inherit;
  background: var(--rev01-bg-panel);
  color: var(--rev01-fg);
  border: 1px solid var(--rev01-hairline);
  border-radius: 4px;
  padding: 8px 10px;
  outline: none;
  width: 100%;
}
.rev01-modal textarea {
  resize: vertical;
  min-height: 80px;
  font-family: var(--rev01-font-sans);
}
.rev01-modal input[type="text"]:focus,
.rev01-modal textarea:focus,
.rev01-modal select:focus {
  border-color: var(--rev01-accent);
}
.rev01-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
.rev01-modal-actions button {
  appearance: none;
  font: inherit;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
}
.rev01-modal-actions button:hover { border-color: var(--rev01-accent); }
.rev01-modal-actions button:last-child {
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
