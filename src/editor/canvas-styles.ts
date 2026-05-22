// src/editor/canvas-styles.ts
//
// Stylesheet for the desktop Canvas Editor (T4). Inlined into the editor route
// via raw(canvasEditorStyles). Dark theme, distinct from the legacy ProseMirror
// editor (src/editor/styles.ts). Style-kit colour tokens are exposed as CSS
// variables on <main class="rev01-editor" data-style-kit="…"> so that the
// editor preview matches the published renderer's look.

export const canvasEditorStyles = String.raw`
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
  --kit-bg: #0c0c0d;
  --kit-fg: #f6f6f6;
  --kit-accent: oklch(0.78 0.15 200);
}

.rev01-editor[data-style-kit="charcoal"] {
  --kit-bg: #0c0c0d;
  --kit-fg: #f6f6f6;
  --kit-accent: oklch(0.85 0.02 240);
}
.rev01-editor[data-style-kit="orange-editorial"] {
  --kit-bg: #fff7ef;
  --kit-fg: #221610;
  --kit-accent: oklch(0.72 0.18 50);
}
.rev01-editor[data-style-kit="blue-saas"] {
  --kit-bg: #0b1530;
  --kit-fg: #e8efff;
  --kit-accent: oklch(0.74 0.16 250);
}
.rev01-editor[data-style-kit="green-organic"] {
  --kit-bg: #0f1a14;
  --kit-fg: #e7f3ea;
  --kit-accent: oklch(0.76 0.15 150);
}

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

#canvas-root {
  grid-area: canvas;
  overflow: auto;
  background:
    radial-gradient(ellipse at 18% -10%, oklch(0.32 0.1 220 / 0.18), transparent 55%),
    linear-gradient(180deg, #0a0e1a 0%, #060912 100%);
  padding: 32px;
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
`;
