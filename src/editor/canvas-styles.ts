// src/editor/canvas-styles.ts
//
// Stylesheet for the desktop Canvas Editor. Inlined into the editor route
// via raw(canvasEditorStyles). The chrome wears the Open Canvas skin
// (warm-neutral surfaces, brand-red accent, hairlines) and follows the
// theme attribute on <html> for light/dark.
//
// The visitor renderer (src/canvas/public-styles.ts) and this editor preview
// share a single source of truth for kit tokens, variants, and motion:
// `buildAllStyleKitsCss` in src/canvas/style-kits.ts. The hard-coded
// per-kit `--kit-*` table that used to live here was removed earlier — the
// editor and the visitor cannot drift because they read the same map.
//
// IMPORTANT: the artboard (`.rev01-page`) renders the user's published
// site, NOT chrome — it stays driven by kit tokens (`--kit-bg`, `--kit-fg`)
// regardless of chrome theme. The chrome lives in the topbar, sidebar,
// inspector, viewport background, zoom toolbar, status bar, AI / chat
// panels, selection handles, and modal — all theme-token driven.

import { buildAllStyleKitsCss } from '../canvas/style-kits.js';
import { componentsCss, themeCss } from '../ui/theme.js';

const kitCss = buildAllStyleKitsCss();

// The :root{--rev01-...} block that used to head chromeCss has been
// deleted — `themeCss` (prepended below) defines every --rev01-* alias
// the chrome reads. See
// design_handoff_opencanvas_rebrand/design-references/MIGRATION.md §1.
const chromeCss = String.raw`
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

/* Body-scroll editor shell: the editor chrome (header / left dock / right
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

/* Topbar (.ebar in editor.html) — sits at z-index:200 above the docks;
   surface + hairline + sticky so it stays visible while the body scrolls.
   Switched from mono → sans for the chrome (the address chip below keeps
   mono since the URL is data, not chrome). */
.rev01-editor-header {
  position: sticky;
  top: 0;
  z-index: 200;
  height: 58px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  font-family: var(--sans);
  font-size: 14px;
  color: var(--ink);
}

.rev01-editor-header .crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  white-space: nowrap;
  color: var(--ink-2);
}
.rev01-editor-header .crumbs .sep {
  color: var(--ink-3);
}
.rev01-editor-header .crumbs .here {
  color: var(--ink);
  font-weight: 650;
}
/* Page chip — switches the active page via a popover. Same weight as .here
   so the breadcrumb reads as one continuous trail. */
.rev01-editor-header .crumb-page-switcher {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  color: var(--ink);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  max-width: 220px;
  text-overflow: ellipsis;
  overflow: hidden;
}
.rev01-editor-header .crumb-page-switcher:hover {
  background: var(--surface);
}
.rev01-editor-header .crumb-page-switcher .crumb-caret {
  color: var(--ink-3);
  font-size: 10px;
}
/* Page-switcher popover — rendered to document.body so it escapes the
   header's overflow clip. Position is set inline via the client. */
.rev01-crumb-menu {
  z-index: 200;
  padding: 4px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  font-family: var(--sans);
  font-size: 13px;
  max-height: 60vh;
  overflow-y: auto;
}
.rev01-crumb-menu-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 7px 10px;
  border: 0;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--ink-2);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rev01-crumb-menu-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.rev01-crumb-menu-item.active {
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 600;
}
.rev01-crumb-menu-title {
  flex: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.rev01-crumb-menu-slug {
  color: var(--ink-3);
  font-family: var(--mono);
  font-size: 11px;
}

/* Address chip — pill, mono so the URL reads as data. */
.rev01-editor-header .address {
  margin-left: 4px;
  padding: 5px 12px;
  border-radius: var(--r-pill);
  background: var(--surface-2);
  border: 1px solid var(--line);
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.rev01-editor-header .spacer {
  flex: 1 1 auto;
}

/* Header action buttons — outline pill so the topbar reads as one row. */
.rev01-editor-header #canvas-save,
.rev01-editor-header #canvas-save-template,
.rev01-editor-header #canvas-settings-link {
  appearance: none;
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
  text-decoration: none;
  line-height: 1;
  transition: border-color 0.15s, background-color 0.15s;
}
.rev01-editor-header #canvas-save:hover,
.rev01-editor-header #canvas-save-template:hover,
.rev01-editor-header #canvas-settings-link:hover {
  border-color: var(--ink);
}
/* Gear icon sits flush with the Settings label so the pill reads as one
   token. align-items:center keeps the 14px SVG vertically centred against
   the 13px label. */
.rev01-editor-header #canvas-settings-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.canvas-settings-gear { flex: 0 0 auto; }

/* Publish: brand-red pill, the highest-affordance action in the topbar. */
.rev01-editor-header #canvas-publish {
  appearance: none;
  border: 1.5px solid transparent;
  background: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
  line-height: 1;
  transition: background-color 0.18s, transform 0.12s;
}
.rev01-editor-header #canvas-publish:hover {
  background: var(--red-strong);
  transform: translateY(-1px);
}
.rev01-editor-header #canvas-publish[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
.rev01-editor-header #canvas-publish[disabled]:hover {
  background: var(--red);
  transform: none;
}

/* Version badge — small persistent indicator of the live version, clickable
   to open the social-preview pill. Greyer than Publish so it reads as a
   passive status surface rather than a primary action. */
.rev01-editor-header #canvas-version {
  appearance: none;
  border: 1.5px solid var(--line-2);
  background: var(--surface-2);
  color: var(--ink-2);
  font: inherit;
  font-family: var(--mono);
  font-weight: 650;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
  line-height: 1;
  transition: border-color 0.15s, background-color 0.15s, color 0.15s;
}
.rev01-editor-header #canvas-version:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.rev01-editor-header #canvas-version[data-version="0"] {
  color: var(--ink-3);
}

/* Social-preview pill — anchored below the version badge, mirrors what
   src/seo/meta-emit.ts will emit for og:title / og:description / og:image. */
.rev01-version-pill {
  width: 320px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  padding: 14px;
  z-index: 250;
  font-family: var(--sans);
  color: var(--ink);
}
.rev01-version-pill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.rev01-version-pill-title {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
}
.rev01-version-pill-chip {
  font-size: 11px;
  font-family: var(--mono);
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 650;
}
.rev01-version-pill-chip.live {
  background: rgba(74, 222, 128, 0.14);
  color: #1f7a3f;
}
.rev01-version-pill-chip.draft {
  background: var(--surface-2);
  color: var(--ink-3);
}
.rev01-version-pill-image {
  width: 100%;
  height: 156px;
  object-fit: cover;
  border-radius: var(--r);
  border: 1px solid var(--line);
  margin-bottom: 10px;
  display: block;
  background: var(--surface-2);
}
.rev01-version-pill-card {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 10px 12px;
  background: var(--surface-2);
}
.rev01-version-pill-card-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--ink);
  line-height: 1.3;
}
.rev01-version-pill-card-desc {
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.4;
  margin-top: 4px;
}
.rev01-version-pill-card-url {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--ink-3);
  margin-top: 6px;
}
.rev01-version-pill-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.rev01-version-pill-view {
  font-size: 12px;
  font-weight: 650;
  color: var(--red-ink);
  text-decoration: none;
}
.rev01-version-pill-view:hover {
  text-decoration: underline;
}

/* AI Chat toggle — soft red surface + red ink, hints AI affordance. */
.rev01-editor-header #canvas-chat-toggle {
  appearance: none;
  border: 1.5px solid var(--red-line);
  background: var(--surface);
  color: var(--red-ink);
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13px;
  padding: 8px 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
  line-height: 1;
  transition: background-color 0.15s;
}
.rev01-editor-header #canvas-chat-toggle:hover {
  background: var(--red-soft);
}
.rev01-editor-header #canvas-chat-toggle.active {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
}

/* Chat slide-out panel — mirrors editor.html .ai-panel: surface + hairline
   left border + shadow-lg so it visually peels off the right dock. The
   chat bubbles follow the same .ai-msg pattern (user = ink chip, assistant
   = surface-2 chip). */
.rev01-chat-panel {
  position: fixed;
  top: 58px;
  right: 0;
  bottom: 36px;
  width: 360px;
  z-index: 200;
  background: var(--surface);
  border-left: 1px solid var(--line);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
}
.rev01-chat-panel[hidden] { display: none; }
.rev01-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  font-family: var(--sans);
  font-weight: 650;
  font-size: 15px;
  color: var(--ink);
}
.rev01-chat-header button {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--ink-2);
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: var(--r-xs);
  transition: background-color 0.14s, color 0.14s;
}
.rev01-chat-header button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.rev01-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.rev01-chat-msg {
  max-width: 88%;
  padding: 11px 13px;
  border-radius: 14px;
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.rev01-chat-msg.user {
  align-self: flex-end;
  background: var(--ink);
  color: var(--paper);
  border-bottom-right-radius: 4px;
}
.rev01-chat-msg.assistant {
  align-self: flex-start;
  background: var(--surface-2);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}
.rev01-chat-msg.error {
  align-self: center;
  background: var(--red-soft);
  color: var(--red-ink);
  font-size: 12px;
  border-radius: var(--r-sm);
}
.rev01-chat-input {
  display: flex;
  gap: 8px;
  padding: 14px;
  border-top: 1px solid var(--line);
  align-items: center;
}
.rev01-chat-input input {
  flex: 1;
  appearance: none;
  border: 1.5px solid var(--line-2);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-family: var(--sans);
  font-size: 13.5px;
  padding: 10px 14px;
  border-radius: var(--r-pill);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rev01-chat-input input::placeholder { color: var(--ink-3); }
.rev01-chat-input input:focus {
  outline: none;
  border-color: var(--red);
  box-shadow: var(--ring);
}
.rev01-chat-input button {
  appearance: none;
  border: none;
  background: var(--red);
  color: #fff;
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13px;
  padding: 9px 16px;
  border-radius: var(--r-pill);
  cursor: pointer;
  box-shadow: var(--shadow-red);
  transition: background-color 0.18s, transform 0.12s;
}
.rev01-chat-input button:hover { background: var(--red-strong); transform: translateY(-1px); }
.rev01-chat-input button[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  background: var(--red);
}

/* Left sidebar (.lpanel in editor.html) — surface + right hairline.
   Width unchanged (320 is the existing rev01 dock width; editor.html uses
   284 but the editor's grids/buttons are sized for 320 — keeping the rev01
   dimension preserves canvas-client.ts positioning). */
.rev01-editor-sidebar {
  position: fixed;
  top: 58px;
  left: 0;
  bottom: 36px;
  width: 360px;
  z-index: 150;
  min-width: 0;
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow-y: auto;
  overflow-x: hidden;
  transition: width 0.15s ease, transform 0.15s ease;
}
.rev01-editor-sidebar.collapsed {
  width: 0;
  overflow: visible;
  border-right: none;
}
/* Keep the sidebar contents themselves clipped while collapsed — only
   the .sidebar-toggle (position: fixed, escapes the sidebar's overflow)
   should remain visible so the user can re-open the sidebar. */
.rev01-editor-sidebar.collapsed > :not(.sidebar-toggle) {
  display: none;
}
/* The .sidebar-toggle is position:fixed rather than absolute-inside the
   sidebar because the sidebar uses overflow-x:hidden to clip its own
   contents during scroll — that overflow rule would also clip a toggle
   positioned at right:-20px, so the toggle would only be visible while
   the sidebar was already collapsed (overflow:visible). Mirroring the
   right-side .inspector-toggle pattern, the toggle now lives at the
   viewport edge of the sidebar's right boundary and shifts to left:0
   when the sidebar collapses. */
.sidebar-toggle {
  position: fixed;
  top: 66px;
  left: 360px;
  width: 20px;
  height: 32px;
  z-index: 152;
  background: var(--surface-2);
  border: 1px solid var(--line-2);
  border-left: none;
  border-radius: 0 var(--r-xs) var(--r-xs) 0;
  color: var(--ink);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: left 0.15s ease, color 0.14s, background-color 0.14s;
}
.sidebar-toggle:hover { color: var(--ink); background: var(--surface-3); }
.rev01-editor-sidebar.collapsed .sidebar-toggle { left: 0; }
.rev01-viewport.sidebar-collapsed { margin-left: 0; }
/* When the inspector is collapsed or hidden, the viewport reclaims the
   320px right gutter — otherwise the body's --rev01-bg shows through
   that strip and reads as a persistent white panel residue against the
   canvas. Driven by :has() (not a viewport class) because inspector
   hidden/collapsed state flips from many call sites in canvas-client.ts
   — letting CSS observe the inspector directly avoids drift. */
.rev01-editor:has(#canvas-inspector[hidden]) .rev01-viewport,
.rev01-editor:has(#canvas-inspector.collapsed) .rev01-viewport {
  margin-right: 0;
}

/* Sidebar tabs (.tabs in editor.html) — flat row, underline-on-active
   in brand red. Sans not mono so the tab labels feel like nav, not data. */
.rev01-sidebar-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}

.rev01-sidebar-tabs button {
  appearance: none;
  flex: 1;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13.5px;
  line-height: 1;
  padding: 11px 0;
  position: relative;
  transition: color 0.14s;
}
.rev01-sidebar-tabs button:hover { color: var(--ink-2); }

.rev01-sidebar-tabs button.active {
  color: var(--ink);
  background: transparent;
}
.rev01-sidebar-tabs button.active::after {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 3px;
  background: var(--red);
  border-radius: var(--r-pill);
}

.rev01-sidebar-panel {
  display: grid;
  gap: 18px;
  padding: 14px 12px 20px;
}

.rev01-sidebar-panel[hidden] {
  display: none;
}

/* Dashed "add" action — used for "+ New Page" etc. Outline pill so it
   reads as a low-affordance helper next to the firmer command tiles. */
.rev01-sidebar-action {
  appearance: none;
  display: block;
  width: calc(100% - 16px);
  margin: 8px 8px;
  padding: 9px 14px;
  border: 1.5px dashed var(--line-2);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--ink-2);
  font-family: var(--sans);
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  text-align: center;
  transition: border-color 0.14s, color 0.14s, background-color 0.14s;
}
.rev01-sidebar-action:hover {
  border-color: var(--red);
  color: var(--red-ink);
  background: var(--red-tint);
}

.rev01-page-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}
.rev01-page-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--rev01-fg);
  border: 1px solid transparent;
  min-width: 0;
  overflow: hidden;
}
.rev01-page-item:hover {
  background: var(--rev01-bg-raised, var(--rev01-bg-panel));
}
.rev01-page-item[data-active="true"] {
  background: var(--rev01-bg-raised, var(--rev01-bg-panel));
  border-color: var(--rev01-accent);
}
.rev01-page-item-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.rev01-page-item-slug {
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
}
.rev01-page-item-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  flex-shrink: 0;
}
.rev01-page-item:hover .rev01-page-item-actions {
  opacity: 1;
}
.rev01-page-item-actions button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg-mute);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
}
.rev01-page-item-actions button:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-fg);
}
.rev01-page-item-actions button[data-danger]:hover {
  border-color: var(--rev01-danger);
  color: var(--rev01-danger);
}
.rev01-page-seo-link {
  font-size: 11px;
  padding: 2px 8px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 4px;
  color: var(--rev01-fg-mute);
  text-decoration: none;
}
.rev01-page-seo-link:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-accent);
}

.rev01-section-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 8px;
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
  gap: 4px;
  padding: 8px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: var(--rev01-bg-panel);
  cursor: grab;
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

/* Sidebar group label (.lgroup in editor.html). */
.rev01-sidebar-group h2 {
  margin: 0;
  color: var(--ink-3);
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rev01-sidebar-command-grid,
.rev01-sidebar-kit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

/* Element tiles (.el in editor.html) — square cards with hover-warm
   to red-tint + lift, conveying drag affordance. */
.rev01-sidebar-command,
.rev01-sidebar-kit-grid button {
  appearance: none;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: 13px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  font-family: var(--sans);
  font-weight: 600;
  font-size: 12px;
  line-height: 1.25;
  min-height: 64px;
  padding: 10px 12px;
  text-align: center;
  transition: border-color 0.14s, background-color 0.14s, color 0.14s, transform 0.1s;
}

.rev01-sidebar-command:hover,
.rev01-sidebar-kit-grid button:hover {
  border-color: var(--red-line);
  background: var(--red-tint);
  color: var(--red-ink);
  transform: translateY(-2px);
}

.rev01-sidebar-kit-grid button.active {
  border-color: var(--red);
  background: var(--red-tint);
  color: var(--red-ink);
  transform: none;
}

/* Viewport wraps #canvas-root. The camera object drives all positioning:
   translate(cam.x, cam.y) scale(cam.zoom) on #canvas-root. The viewport
   has overflow:hidden — no body scroll, the camera handles everything.
   Left/right margins clear the fixed sidebar + inspector docks. */
/* Viewport (the wrapper around #canvas-root, where the artboard floats).
   Mirrors editor.html .cstage: warm surface-2 with a subtle dot grid so
   the artboard pops as a paper surface against the chrome wallpaper. The
   artboard itself (.rev01-page) renders the user's site in kit colors and
   is unaffected by this chrome wallpaper. */
.rev01-viewport {
  position: relative;
  overflow: hidden;
  background-color: var(--surface-2);
  background-image:
    radial-gradient(circle at 1px 1px, var(--line-2) 1px, transparent 0);
  background-size: 24px 24px;
  background-position: 0 0;
  margin-left: 340px;
  margin-right: 320px;
  height: calc(100vh - 58px);
  display: block;
}

#canvas-root {
  transform-origin: 0 0;
  display: block;
  position: absolute;
  top: 0;
  left: 0;
}

/* Zoom toolbar (.zoom in editor.html) — pinned bottom-left of the canvas
   area as a pill above the warm wallpaper. Buttons are borderless circles
   inside the pill, mode-action buttons fill with red when pressed. */
.rev01-zoom-toolbar {
  position: fixed;
  left: 356px;
  bottom: 52px;
  z-index: 160;
  width: max-content;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  font-family: var(--sans);
  font-size: 13px;
}
.rev01-zoom-toolbar button {
  appearance: none;
  background: transparent;
  border: none;
  color: var(--ink-2);
  font: inherit;
  font-weight: 600;
  padding: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.14s, color 0.14s;
}
.rev01-zoom-toolbar button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.rev01-zoom-toolbar .zoom-readout {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  min-width: 44px;
  justify-content: center;
}
.rev01-zoom-toolbar .zoom-toolbar-sep {
  width: 1px;
  align-self: stretch;
  background: var(--line);
  margin: 4px 2px;
}
.rev01-zoom-toolbar button[data-mode-action][aria-pressed="true"] {
  background: var(--red);
  color: #fff;
}
.rev01-zoom-toolbar button[data-mode-action][aria-pressed="true"]:hover {
  background: var(--red-strong);
  color: #fff;
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

/* Artboard page (.artboard in editor.html). Kept on kit tokens so the
   editor preview matches the published render. Shadow swapped for the
   warm-neutral Open Canvas shadow-lg so the paper feels lifted off the
   warm chrome wallpaper instead of stamped onto a dark canvas. */
.rev01-page {
  margin: 0 auto;
  background: var(--kit-bg);
  color: var(--kit-fg);
  box-shadow: var(--shadow-lg);
  border-radius: var(--r);
  overflow: hidden;
}

.rev01-artboard {
  position: absolute;
  top: 0;
  left: 0;
}
.rev01-artboard[data-active="false"] {
  opacity: 0.7;
  pointer-events: none;
}
.rev01-artboard[data-active="true"] {
  opacity: 1;
}
/* Blank-canvas-click clears the dim on every artboard so no page reads
   as the "selected" one. The active page keeps rendering — only the
   visual highlight goes away. Cleared as soon as an artboard or label
   is clicked again. */
#canvas-root.canvas-pages-deselected .rev01-artboard[data-active="false"] {
  opacity: 1;
  pointer-events: auto;
}
.rev01-artboard-label {
  position: absolute;
  top: -32px;
  left: 0;
  font-family: var(--rev01-font-mono);
  font-size: 12px;
  color: var(--rev01-fg-mute);
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.rev01-artboard-label:hover {
  color: var(--rev01-fg);
  background: var(--rev01-bg-panel);
}
.rev01-artboard[data-active="true"] .rev01-artboard-label {
  color: var(--rev01-accent);
}
.rev01-artboard-outline {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border: 1px solid var(--rev01-hairline);
  border-radius: 2px;
}
.rev01-artboard[data-active="true"] .rev01-artboard-outline {
  border-color: var(--rev01-accent);
  border-width: 2px;
}

.rev01-section {
  border-bottom: 1px dashed var(--rev01-hairline);
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
.rev01-section[data-section-role="header"] .section-toolbar {
  top: auto;
  bottom: -36px;
}
.rev01-section[data-section-role="footer"] .section-toolbar {
  top: -36px;
}

.rev01-section-inspector-grid {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}
.rev01-section-inspector-grid button {
  appearance: none;
  width: 100%;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: var(--rev01-bg-panel);
  color: var(--rev01-fg);
  cursor: pointer;
  font: 12px/1.25 var(--rev01-font-mono);
  min-height: 36px;
  padding: 8px 12px;
  text-align: left;
}
.rev01-section-inspector-grid button:hover {
  border-color: var(--rev01-accent);
  background: var(--rev01-accent-soft);
}
.rev01-section-inspector-grid button.danger {
  color: var(--rev01-fg-mute);
}
.rev01-section-inspector-grid button.danger:hover {
  border-color: var(--rev01-danger);
  color: var(--rev01-danger);
  background: transparent;
}

.rev01-element {
  cursor: pointer;
  user-select: none;
}
.rev01-element[data-element-type="text"] {
  cursor: text;
  user-select: text;
}
/* Selection (.selbox in editor.html) — 2px red outline + slight inset so
   it reads as a frame around the element, not a stroke. */
.rev01-element[data-selected="true"] {
  outline: 2px solid var(--red);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}
.rev01-element [contenteditable="true"] {
  cursor: text;
  user-select: text;
  outline: 1px dashed var(--red);
  outline-offset: 2px;
}

/* Click-shield overlay. Interactive widget content (chart canvas/SVG, table
   rows, form inputs, code highlighter, carousel scroller) consumes pointer
   events before they bubble to the editor's root click handler, so the
   parent .rev01-section was being selected instead of the element the Owner
   was actually trying to pick. A transparent ::after pseudo-element on the
   wrapper catches the click at the wrapper level — pseudo-elements report
   their host as the event target, so the existing root handler's
   target.closest('.rev01-element') still resolves to the right wrapper.
   The shield disables itself once the element is selected, so a second
   click reaches the widget (Figma / Webflow's "click-to-select,
   click-again-to-interact" pattern). */
.rev01-element[data-element-type="chart"]:not([data-selected="true"])::after,
.rev01-element[data-element-type="table"]:not([data-selected="true"])::after,
.rev01-element[data-element-type="code"]:not([data-selected="true"])::after,
.rev01-element[data-element-type="form"]:not([data-selected="true"])::after,
.rev01-element[data-element-type="carousel"]:not([data-selected="true"])::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
}

/* Resize handles — small white squares with red border, mirrors .selbox .h. */
.rev01-element .resize-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  background: var(--surface);
  border: 2px solid var(--red);
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

/* -- Element context menu (3-dot trigger, above top-left, selected only) -- */
.rev01-element .element-menu-trigger {
  position: absolute;
  top: -28px;
  left: 0;
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
.rev01-element[data-selected="true"] .element-menu-trigger,
.rev01-element .element-menu-trigger[data-menu-open="true"] {
  display: flex;
}
.rev01-element .element-menu-trigger:hover {
  background: var(--rev01-accent-soft);
  border-color: var(--rev01-accent);
}

.element-menu {
  position: absolute;
  top: 24px;
  left: 0;
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
  background: var(--red-soft);
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
  padding: var(--rev01-kit-action-padding, 0 16px);
  border-radius: var(--rev01-kit-action-radius, 8px);
  background: var(--kit-accent);
  color: var(--kit-bg);
  text-decoration: none;
  font-weight: 600;
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
  background: var(--rev01-kit-panel, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: 8px;
}

/* Element style override resets — editor preview mirrors public-styles.ts */
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

.rev01-media {
  width: 100%;
  height: 100%;
  background: var(--rev01-kit-panel, rgba(255, 255, 255, 0.06));
  border: 1px dashed var(--rev01-hairline-strong);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  color: var(--rev01-fg-mute);
}

/* Inspector dock (.ipanel in editor.html) — surface + left hairline,
   sans body. Field labels keep mono ONLY for the .meta debug strip; the
   form labels themselves switch to sans-bold per Open Canvas. */
#canvas-inspector {
  position: fixed;
  top: 58px;
  right: 0;
  bottom: 36px;
  width: 320px;
  z-index: 150;
  border-left: 1px solid var(--line);
  background: var(--surface);
  padding: 4px 16px 20px;
  overflow-y: auto;
  overflow-x: visible;
  font-family: var(--sans);
  font-size: 13px;
  color: var(--ink);
  transition: width 0.15s ease;
}
#canvas-inspector[hidden] { display: none; }
#canvas-inspector.collapsed {
  width: 0;
  overflow: hidden;
  border-left: none;
  padding-left: 0;
  padding-right: 0;
}
/* The inspector-toggle lives as a sibling of #canvas-inspector (outside
   the clipped box) so it stays reachable when the inspector is
   collapsed to 0 width OR is hidden entirely. */
/* Inspector toggle — fixed-positioned sibling of #canvas-inspector so it
   stays reachable when the inspector is collapsed (width:0) or hidden.
   Sits visually attached to the inspector's left edge in both states;
   the sibling combinator below moves it flush to the viewport edge once
   the inspector collapses. */
.inspector-toggle {
  position: fixed;
  top: 66px;
  right: 320px;
  width: 20px;
  height: 32px;
  z-index: 152;
  background: var(--surface-2);
  border: 1px solid var(--line-2);
  border-right: none;
  border-radius: var(--r-xs) 0 0 var(--r-xs);
  color: var(--ink);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: right 0.15s ease, color 0.14s, background-color 0.14s;
}
.inspector-toggle:hover { color: var(--ink); background: var(--surface-3); }
#canvas-inspector.collapsed ~ .inspector-toggle,
#canvas-inspector[hidden] ~ .inspector-toggle {
  right: 0;
}
#canvas-inspector h3 {
  margin: 16px 0 11px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: none;
  color: var(--ink-2);
}
#canvas-inspector h3:first-child {
  margin-top: 4px;
  padding-top: 0;
  border-top: none;
}
#canvas-inspector .field {
  display: grid;
  gap: 6px;
  margin-bottom: 11px;
}
#canvas-inspector .field label {
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-2);
}
#canvas-inspector input,
#canvas-inspector select {
  appearance: none;
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  color: var(--ink);
  border-radius: var(--r-sm);
  padding: 9px 12px;
  font: inherit;
  font-family: var(--sans);
  font-size: 13.5px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
#canvas-inspector input::placeholder { color: var(--ink-3); }
#canvas-inspector input:focus,
#canvas-inspector select:focus {
  outline: none;
  border-color: var(--red);
  box-shadow: var(--ring);
}
#canvas-inspector input[type="checkbox"] {
  width: auto;
  padding: 0;
  accent-color: var(--red);
}
#canvas-inspector .row {
  display: flex;
  gap: 8px;
  align-items: center;
}
#canvas-inspector .meta {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
  margin-bottom: 12px;
  word-break: break-all;
}
#canvas-inspector .inspector-list-card {
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  padding: 10px;
  margin-bottom: 8px;
  background: var(--surface-2);
}
#canvas-inspector .inspector-section-heading {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
#canvas-inspector .style-row {
  display: flex;
  gap: 6px;
  align-items: center;
}
#canvas-inspector .style-row input[type="number"] {
  width: 70px;
  padding: 7px 10px;
}
/* Range slider (.slider in editor.html) — track is surface-3, thumb is
   the brand red disk. Both the WebKit + Moz selectors are stamped so the
   appearance matches across engines. */
#canvas-inspector .style-row input[type="range"],
#canvas-inspector input[type="range"] {
  flex: 1;
  min-width: 0;
  -webkit-appearance: none;
  appearance: none;
  height: 5px;
  border-radius: var(--r-pill);
  background: var(--surface-3);
  border: none;
  outline: none;
  padding: 0;
}
#canvas-inspector input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--red);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  border: none;
}
#canvas-inspector input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--red);
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  border: none;
}
#canvas-inspector .color-swatch {
  width: 32px;
  height: 28px;
  padding: 2px;
  border-radius: var(--r-xs);
  cursor: pointer;
  flex-shrink: 0;
  border: 1px solid var(--line-2);
  background: var(--surface);
}
/* Manual hex entry alongside each color swatch. Mono so the user can
   read #AABBCC values at a glance; width sized for a #rrggbb literal
   plus a hair so the caret has room. */
#canvas-inspector .color-hex {
  flex: 0 0 auto;
  width: 84px;
  padding: 6px 8px;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--line-2);
  border-radius: var(--r-xs);
  text-transform: lowercase;
}
#canvas-inspector .color-hex:focus {
  outline: none;
  border-color: var(--ink-3);
}
#canvas-inspector .unit-label {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
  flex-shrink: 0;
}
#canvas-inspector .style-btn {
  appearance: none;
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  color: var(--ink);
  border-radius: var(--r-pill);
  padding: 6px 14px;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 12.5px;
  cursor: pointer;
  transition: border-color 0.15s;
}
#canvas-inspector .style-btn:hover {
  border-color: var(--ink);
}
#canvas-inspector .style-btn-clear {
  appearance: none;
  background: transparent;
  border: 1px solid var(--line);
  color: var(--ink-2);
  border-radius: var(--r-xs);
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
  transition: border-color 0.14s, color 0.14s;
}
#canvas-inspector .style-btn-clear:hover {
  border-color: var(--ink);
  color: var(--ink);
}
#canvas-inspector .style-btn-clear:disabled {
  opacity: 0.3;
  cursor: default;
}
#canvas-inspector .bg-img-thumb {
  width: 40px;
  height: 28px;
  border-radius: var(--r-xs);
  border: 1px solid var(--line);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--ink-3);
  flex-shrink: 0;
  background: var(--surface-2);
}
#canvas-inspector .bg-img-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
/* Inspector close button + header layout (c9d761f).
   The base #canvas-inspector and h3 rules above this block already
   come from the Open Canvas rebrand — only the inspector-header
   row + inspector-close button are added here. */
#canvas-inspector .inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 0 0 12px;
}
#canvas-inspector .inspector-close {
  appearance: none;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 1;
  padding: 2px 4px;
  border-radius: 4px;
}
#canvas-inspector .inspector-close:hover {
  background: var(--surface-2);
  color: var(--ink);
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
.reel-locked {
  opacity: 0.8;
  cursor: default;
}
.reel-locked::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  background: var(--rev01-accent);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M11 7V5a3 3 0 0 0-6 0v2H4v6h8V7h-1Zm-4-2a1 1 0 0 1 2 0v2H7V5Z'/%3E%3C/svg%3E") center/contain no-repeat;
  z-index: 1;
}
.reel-role-slot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 8px;
  margin: 4px 0;
  border: 1px dashed var(--rev01-hairline-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--rev01-fg-faint);
  font-family: var(--rev01-font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.reel-role-slot:hover {
  border-color: var(--rev01-accent);
  color: var(--rev01-accent);
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
.rev01-section[data-section-role="header"] .section-grip-handle,
.rev01-section[data-section-role="footer"] .section-grip-handle {
  display: none;
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

/* Status bar (.status in editor.html) — surface + top hairline at the
   bottom of the chrome, sans-faint typography so it reads as ambient state. */
.rev01-editor-status {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 36px;
  z-index: 150;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  border-top: 1px solid var(--line);
  background: var(--surface);
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink-3);
}
.rev01-editor-status .error {
  color: var(--warn);
}
.rev01-editor-status .ok {
  color: var(--ok);
}

/* Inline links inside contenteditable — accent underline + text cursor so
   the Owner sees linked text at a glance without losing the ability to
   click-to-place-caret. Mirrors public-styles.ts .rev01-inline-link. */
[contenteditable="true"] a.rev01-inline-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
  text-underline-offset: 2px;
  cursor: text;
}
[contenteditable="true"] a.rev01-inline-link:hover {
  color: var(--rev01-kit-accent, var(--kit-accent, currentColor));
}

/* Inline mark toolbar — only present in the DOM while a text element is in
   edit mode. Appended to document.body and pinned via position: fixed by
   the client so it stays anchored above the text element regardless of
   body scroll. */
/* Inline mark toolbar — floats above contenteditable text. Surface chip
   with brand-red hover, mirrors the zoom toolbar's pill aesthetic. */
.rev01-mark-toolbar {
  position: fixed;
  display: inline-flex;
  gap: 2px;
  z-index: 180;
  padding: 4px;
  border-radius: var(--r-xs);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  font-family: var(--sans);
  font-size: 12px;
}
.rev01-mark-toolbar button {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  color: var(--ink-2);
  font: inherit;
  padding: 5px 9px;
  border-radius: var(--r-xs);
  cursor: pointer;
  min-width: 24px;
  transition: background-color 0.14s, color 0.14s;
}
.rev01-mark-toolbar button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.rev01-mark-toolbar .rev01-mark-drag {
  cursor: move;
  padding: 5px 7px;
  margin-right: 2px;
  border-right: 1px solid var(--line);
  border-radius: var(--r-xs) 0 0 var(--r-xs);
  color: var(--ink-3);
}
.rev01-mark-toolbar .rev01-mark-drag svg {
  display: block;
  pointer-events: none;
}
/* Vertical divider between mark groups (marks | align | color/AI). */
.rev01-mark-toolbar .rev01-mark-sep {
  display: inline-block;
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--line);
}
/* Alignment buttons — pressed state mirrors the active alignment. */
.rev01-mark-toolbar .rev01-mark-align svg {
  display: block;
  pointer-events: none;
}
.rev01-mark-toolbar .rev01-mark-align.active,
.rev01-mark-toolbar button[aria-pressed="true"].rev01-mark-align {
  background: var(--surface-2);
  color: var(--ink);
}
/* Text color swatch — glyph "A" with a tiny color bar beneath, native
   <input type="color"> hidden behind the button so the swatch click opens
   the OS color picker. */
.rev01-mark-toolbar .rev01-mark-color {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 8px 4px;
  line-height: 1;
}
.rev01-mark-toolbar .rev01-mark-color-glyph {
  font-weight: 700;
  font-size: 12px;
  line-height: 14px;
}
.rev01-mark-toolbar .rev01-mark-color-swatch {
  display: block;
  width: 14px;
  height: 3px;
  margin-top: 2px;
  border-radius: 1px;
  background: currentColor;
}
.rev01-mark-toolbar .rev01-mark-color-input {
  position: absolute;
  inset: 0;
  opacity: 0;
  pointer-events: none;
  width: 100%;
  height: 100%;
  border: 0;
  padding: 0;
}
/* AI rewrite button — accent emphasis, mirrors inspector aiBtn styling. */
.rev01-mark-toolbar .rev01-mark-ai {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--accent);
}
.rev01-mark-toolbar .rev01-mark-ai:hover {
  color: var(--ink);
  background: var(--accent-soft, var(--surface-2));
}

/* Link popover — singleton floating bar shown when the mouse enters or the
   caret enters an <a> inside the text element currently in edit mode. Two
   trigger modes are visually indicated by data-rev01-link-popover-pinned.
   Positioned below (or above) the link via position: fixed. Z-index above
   the mark toolbar (180). */
/* Link popover — floating chip above an inline link inside a text element
   in edit mode. Same warm-surface chip language as the mark toolbar. */
.rev01-link-popover {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 190;
  padding: 8px 12px;
  border-radius: var(--r-sm);
  background: var(--surface);
  border: 1px solid var(--line);
  box-shadow: var(--shadow);
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink);
  max-width: 420px;
  pointer-events: auto;
}
.rev01-link-popover[data-rev01-link-popover-pinned="true"] {
  border-color: var(--red);
}
.rev01-link-popover .rev01-link-popover-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.rev01-link-popover .rev01-link-popover-url {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink-2);
  max-width: 240px;
  user-select: none;
  font-family: var(--mono);
  font-size: 11.5px;
}
.rev01-link-popover button {
  appearance: none;
  background: transparent;
  border: 1.5px solid var(--line-2);
  color: var(--ink);
  font: inherit;
  font-family: var(--sans);
  font-weight: 600;
  padding: 5px 12px;
  border-radius: var(--r-pill);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.14s;
}
.rev01-link-popover button:hover {
  border-color: var(--ink);
}
.rev01-link-popover button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Visitor-view preview row inside the link popover. The label is small +
   muted; the chip renders the actual published link styling so the Owner
   sees the same underline/colour visitors will see. The preview link sits
   outside any contenteditable subtree so the .rev01-inline-link rule
   applies cleanly without the contenteditable-only cursor override. */
.rev01-link-popover .rev01-link-popover-preview {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: var(--r-xs);
  background: var(--surface-2);
  border: 1px dashed var(--line);
  font-family: var(--sans);
  font-size: 12px;
  color: var(--ink);
  max-width: 100%;
}
.rev01-link-popover .rev01-link-popover-preview-label {
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  user-select: none;
  flex: 0 0 auto;
}
.rev01-link-popover .rev01-link-popover-preview-link {
  cursor: default;
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

/* Link modal inline validation error */
.rev01-link-modal-error {
  color: var(--rev01-error, #e55);
  font-size: 11px;
  min-height: 16px;
  margin: -4px 0 0;
}
/* Link modal text preview */
.rev01-link-modal-preview {
  font-size: 12px;
  color: var(--rev01-fg-mute);
  padding: 6px 10px;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Link modal checkbox row */
.rev01-link-modal-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--rev01-fg);
  cursor: pointer;
}
.rev01-link-modal-checkbox input[type="checkbox"] {
  accent-color: var(--rev01-accent);
  cursor: pointer;
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
   preview endpoint returns. Mirrors editor.html .ai-op (the "operation"
   card inside .ai-panel): soft red surface with red-line border so the
   suggestion reads as a brand-coloured pending action. */
.rev01-ai-panel {
  position: fixed;
  top: 80px;
  right: 336px;
  width: 360px;
  max-height: calc(100vh - 120px);
  overflow: auto;
  background: var(--red-tint);
  border: 1px solid var(--red-line);
  border-radius: var(--r);
  padding: 16px;
  z-index: 170;
  box-shadow: var(--shadow-lg);
  font-family: var(--sans);
}
.rev01-ai-panel h3 {
  margin: 0 0 8px;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--red-ink);
}
.rev01-ai-panel p { margin: 6px 0; color: var(--ink); font-size: 13px; }
.rev01-ai-panel .rev01-ai-note {
  color: var(--ink-2);
  font-style: italic;
  border-left: 2px solid var(--red-line);
  padding-left: 8px;
}
.rev01-ai-panel ol { padding-left: 18px; margin: 6px 0 14px; }
.rev01-ai-panel li { margin: 4px 0; font-size: 13px; color: var(--ink); }
.rev01-ai-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.rev01-ai-actions button {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 12.5px;
  padding: 8px 16px;
  border-radius: var(--r-pill);
  cursor: pointer;
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  color: var(--ink-2);
  transition: border-color 0.15s, background-color 0.15s;
}
.rev01-ai-actions button:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}
.rev01-ai-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.rev01-ai-actions button:first-child {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}
.rev01-ai-actions button:first-child:hover:not(:disabled) {
  background: var(--red-strong);
  border-color: var(--red-strong);
  color: #fff;
}

/* Animation replay — owner-only control surfaced over an element while
   selected so they can re-trigger entrance/scroll animations without
   reloading the preview. */
.rev01-replay-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  transition: border-color 0.12s, opacity 0.12s;
}
.rev01-replay-btn:hover:not(:disabled) { border-color: var(--rev01-accent); }
.rev01-replay-btn:disabled { opacity: 0.35; cursor: default; }
.rev01-replay-btn .play-icon {
  display: inline-block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
}
.rev01-page-inspector-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 14px;
}
.rev01-page-inspector-group h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--rev01-fg-mute);
}
.rev01-page-inspector-divider {
  height: 1px;
  background: var(--rev01-hairline);
  margin: 4px 14px;
}
.rev01-page-inspector-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--rev01-hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--rev01-fg);
  font-size: 12px;
  text-decoration: none;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.rev01-page-inspector-link:hover {
  border-color: var(--rev01-accent);
  background: var(--rev01-bg-hover);
}

/* Modal overlay — replaces window.prompt() for the link/AI dialogs. Single
   modal stack only; the JS throws if two are opened at once. Mirrors the
   Open Canvas component primitives: surface card + rounded corners +
   shadow-lg, brand-red pill on the primary action. */
.rev01-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(26, 25, 23, 0.55);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.rev01-modal {
  min-width: 360px;
  max-width: 480px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 22px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--ink);
  font-family: var(--sans);
  font: inherit;
}
.rev01-modal h3 {
  margin: 0;
  font-family: var(--display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-transform: none;
  color: var(--ink);
}
.rev01-modal label {
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-2);
}
.rev01-modal input[type="text"],
.rev01-modal textarea,
.rev01-modal select {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-size: 14px;
  background: var(--surface);
  color: var(--ink);
  border: 1.5px solid var(--line-2);
  border-radius: var(--r-sm);
  padding: 10px 12px;
  outline: none;
  width: 100%;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.rev01-modal textarea {
  resize: vertical;
  min-height: 80px;
}
.rev01-modal input[type="text"]:focus,
.rev01-modal textarea:focus,
.rev01-modal select:focus {
  border-color: var(--red);
  box-shadow: var(--ring);
}
.rev01-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
}
.rev01-modal-actions button {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 13.5px;
  padding: 9px 18px;
  border-radius: var(--r-pill);
  cursor: pointer;
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  color: var(--ink-2);
  transition: border-color 0.15s, background-color 0.15s, transform 0.12s, color 0.15s;
}
.rev01-modal-actions button:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.rev01-modal-actions button:last-child {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}
.rev01-modal-actions button:last-child:hover {
  background: var(--red-strong);
  border-color: var(--red-strong);
  color: #fff;
  transform: translateY(-1px);
}

/* AI trigger buttons — inspector + section toolbar both stamp these.
   Soft red surface with red-line border, mirrors .btn-ai in editor.html. */
[data-ai-button] {
  appearance: none;
  font: inherit;
  font-family: var(--sans);
  font-weight: 650;
  font-size: 12.5px;
  padding: 6px 14px;
  border-radius: var(--r-pill);
  cursor: pointer;
  background: var(--surface);
  border: 1.5px solid var(--red-line);
  color: var(--red-ink);
  transition: background-color 0.15s;
}
[data-ai-button]:hover:not(:disabled) {
  background: var(--red-soft);
}
[data-ai-button]:disabled { opacity: 0.5; cursor: not-allowed; }

/* Inspector kit summary — a small read-only readout of the active kit's
   accent / display font / motion duration. Helps the Owner see at a glance
   which kit they're editing without having to scroll the header. */
.rev01-kit-summary {
  margin: 12px 0;
  padding: 10px 12px;
  border-radius: var(--r-sm);
  background: var(--surface-2);
  border: 1px solid var(--line);
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-2);
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
  border: 1px solid var(--line-2);
}

/* Presence indicator pill in the editor header. Hidden by default; the
   client script unhides when count > 1. Pill on surface-2 mirrors the
   address chip. */
.rev01-editor-header [data-rev01-presence] {
  padding: 5px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
}
.rev01-editor-header [data-rev01-presence][hidden] {
  display: none;
}

/* Remote-cursor overlay layer. Position:fixed at the viewport so each
   caret can be placed straight from a getBoundingClientRect result with
   no scroll-offset math. pointer-events:none keeps the caret/label
   ornamental — local interaction always passes through to the canvas
   beneath. */
.rev01-presence-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
}
.rev01-remote-caret {
  position: fixed;
  width: 2px;
  margin-left: -1px;
  background: #ff6600;
  border-radius: 1px;
  animation: rev01-remote-caret-blink 1.05s steps(2, end) infinite;
}
.rev01-remote-caret-label {
  position: fixed;
  transform: translateY(-100%);
  padding: 2px 6px;
  background: #ff6600;
  color: #fff;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 600;
  line-height: 1.1;
  border-radius: var(--r-xs) var(--r-xs) var(--r-xs) 0;
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
@keyframes rev01-remote-caret-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0.35; }
}

/* -------------------------------------------------------------------------
   Media picker — inspector widget for media elements. Three rows:
   current-row (thumb + upload + AI + alt), history-row (MRU thumbs),
   gallery-grid (all owner assets of matching kind).
   ------------------------------------------------------------------------- */

.media-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 10px;
}

.media-picker .picker-row-label {
  font-family: var(--rev01-font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--rev01-fg-faint);
  margin-bottom: 2px;
}

.media-picker .picker-thumb {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border: 1px solid var(--rev01-hairline-strong);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  background: var(--rev01-bg-panel);
  display: block;
}

.media-picker .picker-thumb.selected {
  border: 2px solid var(--rev01-accent);
}

.media-picker .picker-thumb.empty {
  border: 1px dashed var(--rev01-hairline-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--rev01-font-mono);
  font-size: 18px;
  color: var(--rev01-fg-faint);
  cursor: default;
}

.media-picker .picker-history-row {
  display: flex;
  flex-direction: row;
  gap: 6px;
  flex-wrap: nowrap;
}

.media-picker .picker-gallery-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.media-picker .picker-gallery-cell {
  position: relative;
}

.media-picker .picker-delete {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 16px;
  height: 16px;
  background: var(--rev01-danger, #c0392b);
  color: #fff;
  border: none;
  border-radius: 2px;
  font-size: 10px;
  line-height: 1;
  display: none;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  font-family: var(--rev01-font-mono);
}

.media-picker .picker-gallery-cell:hover .picker-delete {
  display: flex;
}

.media-picker .picker-current-row {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 8px;
}

.media-picker .picker-current-actions {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
}

.media-picker .picker-current-actions button {
  appearance: none;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.media-picker .picker-current-actions button:hover {
  border-color: var(--rev01-accent);
}

.media-picker .picker-current-actions input[type="text"] {
  width: 100%;
  appearance: none;
  background: var(--rev01-bg-panel);
  border: 1px solid var(--rev01-hairline);
  color: var(--rev01-fg);
  border-radius: 4px;
  padding: 4px 8px;
  font: inherit;
  font-size: 12px;
  box-sizing: border-box;
}

.media-picker .picker-current-actions input[type="file"] {
  display: none;
}

/* Brand-matching scrollbars across the editor surfaces. Webkit-only
   pseudo-elements (Chromium + Safari + Edge); Firefox picks up the
   thinner rendering via scrollbar-width + scrollbar-color, set on the
   same scroll containers. The thumb tracks the brand red on hover so
   the scroll affordance lines up with the rest of the chrome's
   accent colour without being loud in the idle state. */
.rev01-editor-sidebar,
#canvas-inspector,
.rev01-sidebar-panel,
.rev01-chat-panel,
#canvas-chat-messages,
.rev01-version-pill,
.rev01-modal {
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.rev01-editor-sidebar::-webkit-scrollbar,
#canvas-inspector::-webkit-scrollbar,
.rev01-sidebar-panel::-webkit-scrollbar,
.rev01-chat-panel::-webkit-scrollbar,
#canvas-chat-messages::-webkit-scrollbar,
.rev01-version-pill::-webkit-scrollbar,
.rev01-modal::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.rev01-editor-sidebar::-webkit-scrollbar-track,
#canvas-inspector::-webkit-scrollbar-track,
.rev01-sidebar-panel::-webkit-scrollbar-track,
.rev01-chat-panel::-webkit-scrollbar-track,
#canvas-chat-messages::-webkit-scrollbar-track,
.rev01-version-pill::-webkit-scrollbar-track,
.rev01-modal::-webkit-scrollbar-track {
  background: transparent;
}
.rev01-editor-sidebar::-webkit-scrollbar-thumb,
#canvas-inspector::-webkit-scrollbar-thumb,
.rev01-sidebar-panel::-webkit-scrollbar-thumb,
.rev01-chat-panel::-webkit-scrollbar-thumb,
#canvas-chat-messages::-webkit-scrollbar-thumb,
.rev01-version-pill::-webkit-scrollbar-thumb,
.rev01-modal::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.rev01-editor-sidebar::-webkit-scrollbar-thumb:hover,
#canvas-inspector::-webkit-scrollbar-thumb:hover,
.rev01-sidebar-panel::-webkit-scrollbar-thumb:hover,
.rev01-chat-panel::-webkit-scrollbar-thumb:hover,
#canvas-chat-messages::-webkit-scrollbar-thumb:hover,
.rev01-version-pill::-webkit-scrollbar-thumb:hover,
.rev01-modal::-webkit-scrollbar-thumb:hover {
  background: var(--red);
  background-clip: padding-box;
}
.rev01-editor-sidebar::-webkit-scrollbar-corner,
#canvas-inspector::-webkit-scrollbar-corner,
.rev01-sidebar-panel::-webkit-scrollbar-corner,
.rev01-chat-panel::-webkit-scrollbar-corner,
#canvas-chat-messages::-webkit-scrollbar-corner,
.rev01-version-pill::-webkit-scrollbar-corner,
.rev01-modal::-webkit-scrollbar-corner {
  background: transparent;
}
`;

// Concatenate Open Canvas tokens + chrome CSS + shared kit CSS. theme.css
// (themeCss) goes FIRST so its --rev01-* alias block re-points the
// chrome's variable names onto the Open Canvas palette before any chrome
// rule reads them. The kit CSS lives in src/canvas/style-kits.ts and is
// the single source of truth shared with the public renderer
// (src/canvas/public-styles.ts) — it is UNTOUCHED by the rebrand to
// preserve byte-identical visitor output.
export const canvasEditorStyles = `${themeCss}\n${componentsCss}\n${chromeCss}\n${kitCss}`;
