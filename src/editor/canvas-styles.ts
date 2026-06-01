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
// IMPORTANT: the artboard (`.opencanvas-page`) renders the user's published
// site, NOT chrome — it stays driven by kit tokens (`--kit-bg`, `--kit-fg`)
// regardless of chrome theme. The chrome lives in the topbar, sidebar,
// inspector, viewport background, zoom toolbar, status bar, AI / chat
// panels, selection handles, and modal — all theme-token driven.

import { buildAllStyleKitsCss } from '../canvas/style-kits.js';
import { componentsCss, themeCss } from '../ui/theme.js';

const kitCss = buildAllStyleKitsCss();

// The :root{--opencanvas-...} block that used to head chromeCss has been
// deleted — `themeCss` (prepended below) defines every --opencanvas-* alias
// the chrome reads. See
// design_handoff_opencanvas_rebrand/design-references/MIGRATION.md §1.
const chromeCss = String.raw`
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--opencanvas-bg);
  color: var(--opencanvas-fg);
  font-family: var(--opencanvas-font-sans);
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
.opencanvas-editor {
  display: block;
  min-height: 100vh;
  width: 100%;
}

body.opencanvas-modal-open {
  overflow: hidden;
}
/* Kit token blocks for the editor preview wrapper come from
   buildAllStyleKitsCss() — see the bottom of this file. The
   [data-style-kit="X"] selector matches both <main class="opencanvas-editor"> and
   the inner <main class="opencanvas-site">, so the editor preview and the
   published render share the same tokens. */

/* Topbar (.ebar in editor.html) — sits at z-index:200 above the docks;
   surface + hairline + sticky so it stays visible while the body scrolls.
   Switched from mono → sans for the chrome (the address chip below keeps
   mono since the URL is data, not chrome). */
.opencanvas-editor-header {
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

.opencanvas-editor-header .crumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  white-space: nowrap;
  color: var(--ink-2);
}
.opencanvas-editor-header .crumbs .sep {
  color: var(--ink-3);
}
.opencanvas-editor-header .crumbs .here {
  color: var(--ink);
  font-weight: 650;
}
/* Page chip — switches the active page via a popover. Same weight as .here
   so the breadcrumb reads as one continuous trail. */
.opencanvas-editor-header .crumb-page-switcher {
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
.opencanvas-editor-header .crumb-page-switcher:hover {
  background: var(--surface);
}
.opencanvas-editor-header .crumb-page-switcher .crumb-caret {
  color: var(--ink-3);
  font-size: 10px;
}
/* Page-switcher popover — rendered to document.body so it escapes the
   header's overflow clip. Position is set inline via the client. */
.opencanvas-crumb-menu {
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
.opencanvas-crumb-menu-item {
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
.opencanvas-crumb-menu-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.opencanvas-crumb-menu-item.active {
  background: var(--surface-2);
  color: var(--ink);
  font-weight: 600;
}
.opencanvas-crumb-menu-title {
  flex: 1;
  white-space: nowrap;
  text-overflow: ellipsis;
  overflow: hidden;
}
.opencanvas-crumb-menu-slug {
  color: var(--ink-3);
  font-family: var(--mono);
  font-size: 11px;
}

/* Address chip — pill, mono so the URL reads as data. */
.opencanvas-editor-header .address {
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

.opencanvas-editor-header .spacer {
  flex: 1 1 auto;
}

/* Header action buttons — outline pill so the topbar reads as one row. */
.opencanvas-editor-header #canvas-save,
.opencanvas-editor-header #canvas-save-template,
.opencanvas-editor-header #canvas-settings-link {
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
.opencanvas-editor-header #canvas-save:hover,
.opencanvas-editor-header #canvas-save-template:hover,
.opencanvas-editor-header #canvas-settings-link:hover {
  border-color: var(--ink);
}
/* Gear icon sits flush with the Settings label so the pill reads as one
   token. align-items:center keeps the 14px SVG vertically centred against
   the 13px label. */
.opencanvas-editor-header #canvas-settings-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.canvas-settings-gear { flex: 0 0 auto; }

/* Publish: brand-red pill, the highest-affordance action in the topbar. */
.opencanvas-editor-header #canvas-publish {
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
.opencanvas-editor-header #canvas-publish:hover {
  background: var(--red-strong);
  transform: translateY(-1px);
}
.opencanvas-editor-header #canvas-publish[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
}
.opencanvas-editor-header #canvas-publish[disabled]:hover {
  background: var(--red);
  transform: none;
}

/* Version badge — small persistent indicator of the live version, clickable
   to open the social-preview pill. Greyer than Publish so it reads as a
   passive status surface rather than a primary action. */
.opencanvas-editor-header #canvas-version {
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
.opencanvas-editor-header #canvas-version:hover {
  border-color: var(--ink-3);
  color: var(--ink);
}
.opencanvas-editor-header #canvas-version[data-version="0"] {
  color: var(--ink-3);
}

/* Social-preview pill — anchored below the version badge, mirrors what
   src/seo/meta-emit.ts will emit for og:title / og:description / og:image. */
.opencanvas-version-pill {
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
.opencanvas-version-pill-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.opencanvas-version-pill-title {
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
}
.opencanvas-version-pill-chip {
  font-size: 11px;
  font-family: var(--mono);
  padding: 3px 8px;
  border-radius: 999px;
  font-weight: 650;
}
.opencanvas-version-pill-chip.live {
  background: rgba(74, 222, 128, 0.14);
  color: #1f7a3f;
}
.opencanvas-version-pill-chip.draft {
  background: var(--surface-2);
  color: var(--ink-3);
}
.opencanvas-version-pill-image {
  width: 100%;
  height: 156px;
  object-fit: cover;
  border-radius: var(--r);
  border: 1px solid var(--line);
  margin-bottom: 10px;
  display: block;
  background: var(--surface-2);
}
.opencanvas-version-pill-card {
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 10px 12px;
  background: var(--surface-2);
}
.opencanvas-version-pill-card-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--ink);
  line-height: 1.3;
}
.opencanvas-version-pill-card-desc {
  font-size: 12px;
  color: var(--ink-2);
  line-height: 1.4;
  margin-top: 4px;
}
.opencanvas-version-pill-card-url {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--ink-3);
  margin-top: 6px;
}
.opencanvas-version-pill-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
.opencanvas-version-pill-view {
  font-size: 12px;
  font-weight: 650;
  color: var(--red-ink);
  text-decoration: none;
}
.opencanvas-version-pill-view:hover {
  text-decoration: underline;
}

/* AI Chat toggle — soft red surface + red ink, hints AI affordance. */
.opencanvas-editor-header #canvas-chat-toggle {
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
.opencanvas-editor-header #canvas-chat-toggle:hover {
  background: var(--red-soft);
}
.opencanvas-editor-header #canvas-chat-toggle.active {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
}

/* Chat slide-out panel — mirrors editor.html .ai-panel: surface + hairline
   left border + shadow-lg so it visually peels off the right dock. The
   chat bubbles follow the same .ai-msg pattern (user = ink chip, assistant
   = surface-2 chip). */
.opencanvas-chat-panel {
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
.opencanvas-chat-panel[hidden] { display: none; }
.opencanvas-chat-header {
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
.opencanvas-chat-header button {
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
.opencanvas-chat-header button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.opencanvas-chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.opencanvas-chat-welcome {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 14px 16px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-2);
  font-family: var(--sans);
  font-size: 13px;
  color: var(--ink);
}
.opencanvas-chat-welcome[hidden] { display: none; }
.opencanvas-chat-welcome-greeting {
  margin: 0;
  font-weight: 650;
}
.opencanvas-chat-welcome-list {
  margin: 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--ink-2);
}
.opencanvas-chat-welcome-hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ink-2);
}
.opencanvas-chat-welcome-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}
.opencanvas-chat-chip {
  appearance: none;
  border: 1px solid var(--red-line);
  background: var(--surface);
  color: var(--red-ink);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  padding: 6px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
  line-height: 1.2;
  transition: background-color 0.14s, color 0.14s;
}
.opencanvas-chat-chip:hover {
  background: var(--red);
  color: #fff;
  border-color: var(--red);
}
.opencanvas-chat-chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.opencanvas-chat-selection {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  background: var(--red-soft);
  font-family: var(--sans);
  font-size: 12px;
  color: var(--red-ink);
}
.opencanvas-chat-selection[hidden] { display: none; }
.opencanvas-chat-selection-label {
  font-weight: 650;
  opacity: 0.85;
}
.opencanvas-chat-selection-text {
  flex: 1;
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.opencanvas-chat-selection-clear {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--red-ink);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: var(--r-xs);
}
.opencanvas-chat-selection-clear:hover {
  background: rgba(0, 0, 0, 0.08);
}
.opencanvas-chat-msg {
  max-width: 88%;
  padding: 11px 13px;
  border-radius: 14px;
  font-family: var(--sans);
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
.opencanvas-chat-msg.user {
  align-self: flex-end;
  background: var(--ink);
  color: var(--paper);
  border-bottom-right-radius: 4px;
}
.opencanvas-chat-msg.assistant {
  align-self: flex-start;
  background: var(--surface-2);
  color: var(--ink);
  border-bottom-left-radius: 4px;
}
.opencanvas-chat-msg.error {
  align-self: center;
  background: var(--red-soft);
  color: var(--red-ink);
  font-size: 12px;
  border-radius: var(--r-sm);
}
.opencanvas-chat-input {
  display: flex;
  gap: 8px;
  padding: 14px;
  border-top: 1px solid var(--line);
  align-items: center;
}
.opencanvas-chat-input input {
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
.opencanvas-chat-input input::placeholder { color: var(--ink-3); }
.opencanvas-chat-input input:focus {
  outline: none;
  border-color: var(--red);
  box-shadow: var(--ring);
}
.opencanvas-chat-input button {
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
.opencanvas-chat-input button:hover { background: var(--red-strong); transform: translateY(-1px); }
.opencanvas-chat-input button[disabled] {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
  background: var(--red);
}

/* Left sidebar (.lpanel in editor.html) — surface + right hairline.
   Width unchanged (320 is the existing rev01 dock width; editor.html uses
   284 but the editor's grids/buttons are sized for 320 — keeping the rev01
   dimension preserves canvas-client.ts positioning). */
.opencanvas-editor-sidebar {
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
.opencanvas-editor-sidebar.collapsed {
  width: 0;
  overflow: visible;
  border-right: none;
}
/* Keep the sidebar contents themselves clipped while collapsed — only
   the .sidebar-toggle (position: fixed, escapes the sidebar's overflow)
   should remain visible so the user can re-open the sidebar. */
.opencanvas-editor-sidebar.collapsed > :not(.sidebar-toggle) {
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
.opencanvas-editor-sidebar.collapsed .sidebar-toggle { left: 0; }
.opencanvas-viewport.sidebar-collapsed { margin-left: 0; }
/* When the inspector is collapsed or hidden, the viewport reclaims the
   320px right gutter — otherwise the body's --opencanvas-bg shows through
   that strip and reads as a persistent white panel residue against the
   canvas. Driven by :has() (not a viewport class) because inspector
   hidden/collapsed state flips from many call sites in canvas-client.ts
   — letting CSS observe the inspector directly avoids drift. */
.opencanvas-editor:has(#canvas-inspector[hidden]) .opencanvas-viewport,
.opencanvas-editor:has(#canvas-inspector.collapsed) .opencanvas-viewport {
  margin-right: 0;
}

/* Sidebar tabs (.tabs in editor.html) — flat row, underline-on-active
   in brand red. Sans not mono so the tab labels feel like nav, not data. */
.opencanvas-sidebar-tabs {
  display: flex;
  gap: 2px;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--line);
}

.opencanvas-sidebar-tabs button {
  appearance: none;
  flex: 1 1 0;
  min-width: 0;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color 0.14s;
}
.opencanvas-sidebar-tabs button:hover { color: var(--ink-2); }

.opencanvas-sidebar-tabs button.active {
  color: var(--ink);
  background: transparent;
}
.opencanvas-sidebar-tabs button.active::after {
  content: "";
  position: absolute;
  left: 14px;
  right: 14px;
  bottom: -1px;
  height: 3px;
  background: var(--red);
  border-radius: var(--r-pill);
}

.opencanvas-sidebar-panel {
  display: grid;
  gap: 18px;
  padding: 14px 12px 20px;
}

.opencanvas-sidebar-panel[hidden] {
  display: none;
}

/* Dashed "add" action — used for "+ New Page" etc. Outline pill so it
   reads as a low-affordance helper next to the firmer command tiles. */
.opencanvas-sidebar-action {
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
.opencanvas-sidebar-action:hover {
  border-color: var(--red);
  color: var(--red-ink);
  background: var(--red-tint);
}

.opencanvas-page-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
}
.opencanvas-page-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--opencanvas-fg);
  border: 1px solid transparent;
  min-width: 0;
}
.opencanvas-page-item:hover {
  background: var(--opencanvas-bg-raised, var(--opencanvas-bg-panel));
}
.opencanvas-page-item[data-active="true"] {
  background: var(--opencanvas-bg-raised, var(--opencanvas-bg-panel));
  border-color: var(--opencanvas-accent);
}
.opencanvas-page-item-title {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.opencanvas-page-item-slug {
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  color: var(--opencanvas-fg-mute);
}
/* Actions are absolute-positioned on top of the row so they never compete
   with the title / slug for inline space — that meant Del was getting
   clipped on narrow sidebar widths. Hidden by default; the row's hover
   reveals them and paints a backdrop so the underlying title doesn't
   read through. */
.opencanvas-page-item-actions {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  background: var(--opencanvas-bg-raised, var(--opencanvas-bg-panel));
  border-radius: 6px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.opencanvas-page-item:hover .opencanvas-page-item-actions {
  opacity: 1;
  pointer-events: auto;
}
.opencanvas-page-item-actions button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg-mute);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  line-height: 1;
}
.opencanvas-page-item-actions button:hover {
  border-color: var(--opencanvas-accent);
  color: var(--opencanvas-fg);
}
.opencanvas-page-item-actions button[data-danger]:hover {
  border-color: var(--opencanvas-danger);
  color: var(--opencanvas-danger);
}
.opencanvas-page-seo-link {
  font-size: 11px;
  padding: 2px 6px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 4px;
  color: var(--opencanvas-fg-mute);
  text-decoration: none;
  line-height: 1;
}
.opencanvas-page-seo-link:hover {
  border-color: var(--opencanvas-accent);
  color: var(--opencanvas-accent);
}

.opencanvas-section-picker {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px 8px;
}

.opencanvas-section-picker-empty {
  color: var(--opencanvas-fg-mute);
  font-size: 13px;
}

.opencanvas-section-picker-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}
.opencanvas-section-picker-search {
  flex: 1;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: var(--opencanvas-bg);
  color: var(--opencanvas-fg);
  font: inherit;
}
.opencanvas-section-picker-filter {
  padding: 6px 10px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: var(--opencanvas-bg);
  color: var(--opencanvas-fg);
  font: inherit;
}
.opencanvas-section-picker-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.opencanvas-section-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: var(--opencanvas-bg-panel);
  cursor: grab;
}
.opencanvas-section-card-thumb {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 4px;
  overflow: hidden;
  background: #1f2937;
  border: 1px solid var(--opencanvas-hairline);
}
.opencanvas-section-card-thumb svg {
  display: block;
  width: 100%;
  height: 100%;
}
.opencanvas-section-card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.opencanvas-section-card-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--opencanvas-fg);
}
.opencanvas-section-card-recipe {
  font-size: 11px;
  color: var(--opencanvas-fg-mute);
  font-family: var(--opencanvas-font-mono);
}
.opencanvas-section-card-preview {
  margin: 0;
  font-size: 12px;
  color: var(--opencanvas-fg-mute);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.opencanvas-section-card-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.opencanvas-section-card-template {
  font-size: 11px;
  color: var(--opencanvas-fg-mute);
}
.opencanvas-section-card-use {
  padding: 4px 10px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--opencanvas-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.opencanvas-section-card-use:hover {
  background: var(--opencanvas-bg-panel-strong);
}
.opencanvas-section-card-use:focus-visible {
  outline: 2px solid var(--opencanvas-accent);
  outline-offset: 2px;
}
.opencanvas-section-card.is-pending .opencanvas-section-card-use {
  background: var(--opencanvas-accent);
  color: var(--opencanvas-bg);
  border-color: transparent;
}

/* Placement-mode drop slots — drawn between sections while pendingImport is
   set. Slots are invisible until hover/focus by default; while
   data-placement-active is set on <body> they stay fully visible so the
   Owner can clearly see every available insert position. */
.opencanvas-section-slot {
  display: block;
  width: 100%;
  height: 24px;
  margin: 0;
  padding: 0;
  border: 1px dashed var(--opencanvas-accent);
  background: transparent;
  color: var(--opencanvas-accent);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease, background-color 120ms ease;
}
.opencanvas-section-slot:hover,
.opencanvas-section-slot:focus-visible {
  opacity: 1;
  background-color: var(--opencanvas-bg-panel-strong);
}
body[data-placement-active="true"] .opencanvas-section-slot {
  opacity: 1;
}

.opencanvas-sidebar-group {
  display: grid;
  gap: 8px;
}

.opencanvas-sidebar-group[hidden] {
  display: none;
}

/* Sidebar group label (.lgroup in editor.html). */
.opencanvas-sidebar-group h2 {
  margin: 0;
  color: var(--ink-3);
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.opencanvas-sidebar-command-grid,
.opencanvas-sidebar-kit-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

/* Element tiles (.el in editor.html) — square cards with hover-warm
   to red-tint + lift, conveying drag affordance. */
.opencanvas-sidebar-command,
.opencanvas-sidebar-kit-grid button {
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

.opencanvas-sidebar-command:hover,
.opencanvas-sidebar-kit-grid button:hover {
  border-color: var(--red-line);
  background: var(--red-tint);
  color: var(--red-ink);
  transform: translateY(-2px);
}

.opencanvas-sidebar-kit-grid button.active {
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
   artboard itself (.opencanvas-page) renders the user's site in kit colors and
   is unaffected by this chrome wallpaper. */
.opencanvas-viewport {
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
.opencanvas-zoom-toolbar {
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
.opencanvas-zoom-toolbar button {
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
.opencanvas-zoom-toolbar button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.opencanvas-zoom-toolbar .zoom-readout {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--ink-2);
  font-size: 12.5px;
  font-weight: 600;
  min-width: 44px;
  justify-content: center;
}
.opencanvas-zoom-toolbar .zoom-toolbar-sep {
  width: 1px;
  align-self: stretch;
  background: var(--line);
  margin: 4px 2px;
}
.opencanvas-zoom-toolbar button[data-mode-action][aria-pressed="true"] {
  background: var(--red);
  color: #fff;
}
.opencanvas-zoom-toolbar button[data-mode-action][aria-pressed="true"]:hover {
  background: var(--red-strong);
  color: #fff;
}
.opencanvas-viewport[data-interaction-mode="pan"] {
  cursor: grab;
}
.opencanvas-viewport[data-interaction-mode="pan"][data-panning="true"] {
  cursor: grabbing;
}
.opencanvas-viewport[data-interaction-mode="pan"] .opencanvas-element,
.opencanvas-viewport[data-interaction-mode="pan"] .opencanvas-section {
  pointer-events: none;
}

/* Artboard page (.artboard in editor.html). Kept on kit tokens so the
   editor preview matches the published render. Shadow swapped for the
   warm-neutral Open Canvas shadow-lg so the paper feels lifted off the
   warm chrome wallpaper instead of stamped onto a dark canvas. */
.opencanvas-page {
  margin: 0 auto;
  background: var(--kit-bg);
  color: var(--kit-fg);
  box-shadow: var(--shadow-lg);
  border-radius: var(--r);
  overflow: hidden;
}

.opencanvas-artboard {
  position: absolute;
  top: 0;
  left: 0;
}
.opencanvas-artboard[data-active="false"] {
  opacity: 0.7;
  /* pointer-events stay enabled so a click ANYWHERE on an inactive
     artboard activates it via attachRootEvents → setActivePage. The
     click handler intercepts inactive-artboard clicks before any
     element/section resolution, so this never accidentally selects
     a widget on a backgrounded page. Previously this rule set
     pointer-events to none and the only way to activate an inactive
     page was to click its small label — the body of the page swallowed
     clicks straight to the canvas background. */
}
.opencanvas-artboard[data-active="true"] {
  opacity: 1;
}
/* Blank-canvas-click clears the dim on every artboard so no page reads
   as the "selected" one. The active page keeps rendering — only the
   visual highlight goes away. Cleared as soon as an artboard or label
   is clicked again. */
#canvas-root.canvas-pages-deselected .opencanvas-artboard[data-active="false"] {
  opacity: 1;
}
.opencanvas-artboard-label {
  position: absolute;
  top: -32px;
  left: 0;
  font-family: var(--opencanvas-font-mono);
  font-size: 12px;
  color: var(--opencanvas-fg-mute);
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
}
.opencanvas-artboard-label:hover {
  color: var(--opencanvas-fg);
  background: var(--opencanvas-bg-panel);
}
.opencanvas-artboard[data-active="true"] .opencanvas-artboard-label {
  color: var(--opencanvas-accent);
}
.opencanvas-artboard-outline {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 2px;
}
.opencanvas-artboard[data-active="true"] .opencanvas-artboard-outline {
  border-color: var(--opencanvas-accent);
  border-width: 2px;
}

.opencanvas-section {
  border-bottom: 1px dashed var(--opencanvas-hairline);
}
.opencanvas-section:last-child {
  border-bottom: 0;
}

.opencanvas-section[data-selected="true"] {
  outline: 2px solid var(--opencanvas-accent);
  outline-offset: -2px;
}

.opencanvas-section .section-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: none;
  gap: 4px;
  z-index: 9999;
  background: var(--opencanvas-bg-panel-strong);
  border: 1px solid var(--opencanvas-hairline-strong);
  border-radius: 6px;
  padding: 4px;
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
}
.opencanvas-section[data-selected="true"] .section-toolbar {
  display: flex;
  flex-wrap: wrap;
}
.opencanvas-section .section-toolbar button {
  appearance: none;
  background: transparent;
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
  font: inherit;
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
}
.opencanvas-section .section-toolbar button:hover {
  border-color: var(--opencanvas-accent);
}
.opencanvas-section[data-section-role="header"] .section-toolbar {
  top: auto;
  bottom: -36px;
}
.opencanvas-section[data-section-role="footer"] .section-toolbar {
  top: -36px;
}

.opencanvas-section-inspector-grid {
  display: grid;
  gap: 6px;
  margin-top: 12px;
}
.opencanvas-section-inspector-grid button {
  appearance: none;
  width: 100%;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: var(--opencanvas-bg-panel);
  color: var(--opencanvas-fg);
  cursor: pointer;
  font: 12px/1.25 var(--opencanvas-font-mono);
  min-height: 36px;
  padding: 8px 12px;
  text-align: left;
}
.opencanvas-section-inspector-grid button:hover {
  border-color: var(--opencanvas-accent);
  background: var(--opencanvas-accent-soft);
}
.opencanvas-section-inspector-grid button.danger {
  color: var(--opencanvas-fg-mute);
}
.opencanvas-section-inspector-grid button.danger:hover {
  border-color: var(--opencanvas-danger);
  color: var(--opencanvas-danger);
  background: transparent;
}

.opencanvas-element {
  cursor: pointer;
  user-select: none;
}
.opencanvas-element[data-element-type="text"] {
  cursor: text;
  user-select: text;
}
/* Selection (.selbox in editor.html) — 2px red outline + slight inset so
   it reads as a frame around the element, not a stroke. */
.opencanvas-element[data-selected="true"] {
  outline: 2px solid var(--red);
  outline-offset: 2px;
  border-radius: var(--r-xs);
}
.opencanvas-element [contenteditable="true"] {
  cursor: text;
  user-select: text;
  outline: 1px dashed var(--red);
  outline-offset: 2px;
}

/* Click-shield overlay. Interactive widget content (chart canvas/SVG, table
   rows, form inputs, code highlighter, carousel scroller) consumes pointer
   events before they bubble to the editor's root click handler, so the
   parent .opencanvas-section was being selected instead of the element the Owner
   was actually trying to pick. A transparent ::after pseudo-element on the
   wrapper catches the click at the wrapper level — pseudo-elements report
   their host as the event target, so the existing root handler's
   target.closest('.opencanvas-element') still resolves to the right wrapper.
   The shield disables itself once the element is selected, so a second
   click reaches the widget (Figma / Webflow's "click-to-select,
   click-again-to-interact" pattern). */
.opencanvas-element[data-element-type="chart"]:not([data-selected="true"])::after,
.opencanvas-element[data-element-type="table"]:not([data-selected="true"])::after,
.opencanvas-element[data-element-type="code"]:not([data-selected="true"])::after,
.opencanvas-element[data-element-type="form"]:not([data-selected="true"])::after,
.opencanvas-element[data-element-type="carousel"]:not([data-selected="true"])::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 100;
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
}
/* Pass-7 retest showed only chart was actually selectable via the shield —
   the other four widgets render content that creates its own stacking
   context (form's input, table's td, code's syntax highlighter spans,
   carousel's transform-positioned slides). Those descendants stack above
   the ::after pseudo even at z-index 100, so the shield never received the
   click. Setting pointer-events: none on the entire descendant tree while
   unselected forces every click to bubble back to the wrapper element (and
   thus to the shield) regardless of internal stacking. Re-enabled by the
   data-selected="true" swap below so a second click hits the widget. */
.opencanvas-element[data-element-type="chart"]:not([data-selected="true"]) *,
.opencanvas-element[data-element-type="table"]:not([data-selected="true"]) *,
.opencanvas-element[data-element-type="code"]:not([data-selected="true"]) *,
.opencanvas-element[data-element-type="form"]:not([data-selected="true"]) *,
.opencanvas-element[data-element-type="carousel"]:not([data-selected="true"]) * {
  pointer-events: none;
}
.opencanvas-element[data-element-type="chart"][data-selected="true"] *,
.opencanvas-element[data-element-type="table"][data-selected="true"] *,
.opencanvas-element[data-element-type="code"][data-selected="true"] *,
.opencanvas-element[data-element-type="form"][data-selected="true"] *,
.opencanvas-element[data-element-type="carousel"][data-selected="true"] * {
  pointer-events: auto;
}

/* Resize handles — small white squares with red border, mirrors .selbox .h. */
.opencanvas-element .resize-handle {
  position: absolute;
  width: 9px;
  height: 9px;
  background: var(--surface);
  border: 2px solid var(--red);
  border-radius: 2px;
  display: none;
  z-index: 10000;
}
.opencanvas-element[data-selected="true"] .resize-handle { display: block; }
.resize-handle-n  { top: -5px; left: calc(50% - 5px); cursor: ns-resize; }
.resize-handle-s  { bottom: -5px; left: calc(50% - 5px); cursor: ns-resize; }
.resize-handle-e  { right: -5px; top: calc(50% - 5px); cursor: ew-resize; }
.resize-handle-w  { left: -5px; top: calc(50% - 5px); cursor: ew-resize; }
.resize-handle-ne { top: -5px; right: -5px; cursor: nesw-resize; }
.resize-handle-nw { top: -5px; left: -5px; cursor: nwse-resize; }
.resize-handle-se { bottom: -5px; right: -5px; cursor: nwse-resize; }
.resize-handle-sw { bottom: -5px; left: -5px; cursor: nesw-resize; }

/* -- Element context menu (3-dot trigger, above top-left, selected only) -- */
.opencanvas-element .element-menu-trigger {
  position: absolute;
  top: -28px;
  left: 0;
  width: 22px;
  height: 22px;
  display: none;
  align-items: center;
  justify-content: center;
  background: var(--opencanvas-bg-panel-strong);
  border: 1px solid var(--opencanvas-hairline-strong);
  border-radius: 4px;
  color: var(--opencanvas-fg);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  z-index: 10001;
  padding: 0;
  letter-spacing: 1px;
}
.opencanvas-element[data-selected="true"] .element-menu-trigger,
.opencanvas-element .element-menu-trigger[data-menu-open="true"] {
  display: flex;
}
.opencanvas-element .element-menu-trigger:hover {
  background: var(--opencanvas-accent-soft);
  border-color: var(--opencanvas-accent);
}

.element-menu {
  position: absolute;
  top: 24px;
  left: 0;
  min-width: 180px;
  background: var(--opencanvas-bg-panel-strong);
  border: 1px solid var(--opencanvas-hairline-strong);
  border-radius: var(--opencanvas-radius);
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  padding: 4px 0;
  z-index: 10002;
  font-family: var(--opencanvas-font-sans);
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
  color: var(--opencanvas-fg);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  text-align: left;
}
.element-menu .menu-item:hover {
  background: var(--opencanvas-accent-soft);
}
.element-menu .menu-item.danger {
  color: var(--opencanvas-danger);
}
.element-menu .menu-item.danger:hover {
  background: var(--red-soft);
}
.element-menu .menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--opencanvas-hairline);
}

.opencanvas-text { color: inherit; }
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
.opencanvas-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: var(--opencanvas-kit-action-padding, 0 16px);
  border-radius: var(--opencanvas-kit-action-radius, 8px);
  background: var(--kit-accent);
  color: var(--kit-bg);
  text-decoration: none;
  font-weight: 600;
}
.opencanvas-shape {
  width: 100%;
  height: 100%;
  background: var(--kit-accent);
  opacity: 0.6;
}
.opencanvas-shape[data-variant="circle"] { border-radius: 50%; }
.opencanvas-shape[data-variant="pill"] { border-radius: 999px; }
.opencanvas-shape[data-variant="blob"] { border-radius: 36% 64% 60% 40% / 45% 35% 65% 55%; }
.opencanvas-shape[data-variant="line"] { height: 4px; align-self: center; }
.opencanvas-surface {
  width: 100%;
  height: 100%;
  background: var(--opencanvas-kit-panel, rgba(255, 255, 255, 0.06));
  border: 1px solid var(--opencanvas-hairline-strong);
  border-radius: 8px;
}

/* Element style override resets — editor preview mirrors public-styles.ts */
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

.opencanvas-media {
  width: 100%;
  height: 100%;
  background: var(--opencanvas-kit-panel, rgba(255, 255, 255, 0.06));
  border: 1px dashed var(--opencanvas-hairline-strong);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  color: var(--opencanvas-fg-mute);
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
/* Boolean settings rendered as a toggle pill instead of a stacked
   label+checkbox. The native input stays in the DOM (semantics + focus
   ring) but is visually replaced by a 32x18 track + 14x14 thumb that
   slides on change. Whole row is the click target.
   The inspector default :where(#canvas-inspector) button rule would
   otherwise inherit through, but this is a <label>, not a <button>. */
#canvas-inspector .field--toggle {
  margin-bottom: 11px;
}
#canvas-inspector .opencanvas-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
}
#canvas-inspector .opencanvas-toggle-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  border: 0;
}
#canvas-inspector .opencanvas-toggle-track {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  background: var(--line-2);
  border-radius: 999px;
  transition: background-color 0.15s ease;
  flex-shrink: 0;
}
#canvas-inspector .opencanvas-toggle-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  background: var(--surface);
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: transform 0.15s ease;
}
#canvas-inspector .opencanvas-toggle-input:checked + .opencanvas-toggle-track {
  background: var(--red);
}
#canvas-inspector .opencanvas-toggle-input:checked + .opencanvas-toggle-track::after {
  transform: translateX(14px);
}
#canvas-inspector .opencanvas-toggle-input:focus-visible + .opencanvas-toggle-track {
  box-shadow: var(--ring);
}
#canvas-inspector .opencanvas-toggle-text {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
/* Default styling for any <button> that lives inside the inspector dock
   without its own class. The mount* functions (carousel slides, form
   fields, table rows, accordion items, links list, …) create their
   action buttons with createElement("button") and never set a class —
   browser-default chrome looked broken against the rest of the panel.
   :where() strips the ID's specificity so every existing class-based
   button selector inside the inspector (.opencanvas-section-inspector-grid
   button, .picker-current-actions button, .inspector-close, …) still
   wins via normal cascade. */
:where(#canvas-inspector) button {
  appearance: none;
  background: var(--surface);
  border: 1.5px solid var(--line-2);
  color: var(--ink);
  border-radius: var(--r-sm);
  padding: 6px 12px;
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background-color 0.15s;
}
:where(#canvas-inspector) button:hover {
  border-color: var(--ink);
  background: var(--surface-2);
}
:where(#canvas-inspector) button:focus-visible {
  outline: none;
  border-color: var(--red);
  box-shadow: var(--ring);
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
/* Page-title rename input lives in the page inspector where the
   read-only .meta line used to sit. It picks up the same mono +
   muted treatment so the inspector silhouette stays consistent;
   focus brightens the text to the body ink so the operator sees
   the field is "live". */
#canvas-inspector input.meta-editable {
  width: 100%;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--r-sm);
  padding: 4px 6px;
  margin: -4px 0 12px -6px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--ink-3);
}
#canvas-inspector input.meta-editable:hover {
  border-color: var(--line);
}
#canvas-inspector input.meta-editable:focus {
  border-color: var(--accent);
  color: var(--ink);
  outline: none;
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
#canvas-inspector .form-style-section {
  margin: 6px 0;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--surface-2);
}
#canvas-inspector .form-style-section > summary {
  padding: 8px 10px;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  user-select: none;
}
#canvas-inspector .form-style-section > summary::-webkit-details-marker {
  display: none;
}
#canvas-inspector .form-style-section > summary::before {
  content: "\\25B8";
  display: inline-block;
  width: 12px;
  font-size: 10px;
  transition: transform 120ms ease;
}
#canvas-inspector .form-style-section[open] > summary::before {
  transform: rotate(90deg);
}
#canvas-inspector .form-style-section > .field {
  padding: 4px 10px 8px;
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
  border-left: 1px solid var(--opencanvas-hairline);
  background: var(--opencanvas-bg-panel-strong);
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
  border-bottom: 1px solid var(--opencanvas-hairline);
  flex-shrink: 0;
}
.reel-header h3 {
  margin: 0;
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--opencanvas-fg-mute);
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
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg-mute);
  padding: 3px 7px;
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  line-height: 1;
}
.reel-header-actions button:hover {
  border-color: var(--opencanvas-accent);
  color: var(--opencanvas-fg);
}
.reel-header-actions button[aria-pressed="true"] {
  background: var(--opencanvas-accent-soft);
  border-color: var(--opencanvas-accent);
  color: var(--opencanvas-fg);
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
  border: 1px solid var(--opencanvas-hairline);
  background: var(--opencanvas-bg);
  cursor: grab;
  transition: border-color 120ms ease;
}
.reel-thumbnail-wrap:hover {
  border-color: var(--opencanvas-accent);
}
.reel-thumbnail-wrap[data-reel-selected="true"] {
  border-color: var(--opencanvas-accent);
  box-shadow: 0 0 0 1px var(--opencanvas-accent);
}
.reel-tile {
  margin-bottom: 8px;
}
.reel-tile-label {
  margin-top: 4px;
  font-family: var(--opencanvas-font-mono);
  font-size: 10px;
  color: var(--opencanvas-fg-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reel-list-item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 0;
  border-bottom: 1px solid var(--opencanvas-hairline);
}
.reel-list-info {
  flex: 1;
  min-width: 0;
}
.reel-list-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--opencanvas-fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reel-list-recipe {
  font-family: var(--opencanvas-font-mono);
  font-size: 10px;
  color: var(--opencanvas-fg-faint);
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
  background: var(--opencanvas-accent-soft);
}
.reel-insert-btn:hover::after {
  content: "+";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--opencanvas-accent);
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
  background: var(--opencanvas-accent);
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
  border: 1px dashed var(--opencanvas-hairline-strong);
  border-radius: 6px;
  background: transparent;
  color: var(--opencanvas-fg-faint);
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease;
}
.reel-role-slot:hover {
  border-color: var(--opencanvas-accent);
  color: var(--opencanvas-accent);
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
  background: var(--opencanvas-bg-panel-strong);
  border: 1px solid var(--opencanvas-hairline-strong);
  border-right: none;
  border-radius: 4px 0 0 4px;
  color: var(--opencanvas-fg-mute);
  font-size: 14px;
  cursor: grab;
  z-index: 100;
  user-select: none;
}
.opencanvas-section:hover .section-grip-handle {
  display: flex;
}
.opencanvas-section[data-section-role="header"] .section-grip-handle,
.opencanvas-section[data-section-role="footer"] .section-grip-handle {
  display: none;
}
.section-grip-handle:hover {
  color: var(--opencanvas-fg);
  background: var(--opencanvas-accent-soft);
  border-color: var(--opencanvas-accent);
}
.reel-drop-indicator {
  position: fixed;
  height: 2px;
  background: var(--opencanvas-accent);
  z-index: 9001;
  pointer-events: none;
  border-radius: 1px;
  box-shadow: 0 0 4px var(--opencanvas-accent);
}

/* Status bar (.status in editor.html) — surface + top hairline at the
   bottom of the chrome, sans-faint typography so it reads as ambient state. */
.opencanvas-editor-status {
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
.opencanvas-editor-status .error {
  color: var(--warn);
}
.opencanvas-editor-status .ok {
  color: var(--ok);
}

/* Inline links inside contenteditable — accent underline + text cursor so
   the Owner sees linked text at a glance without losing the ability to
   click-to-place-caret. Mirrors public-styles.ts .opencanvas-inline-link. */
[contenteditable="true"] a.opencanvas-inline-link {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
  text-underline-offset: 2px;
  cursor: text;
}
[contenteditable="true"] a.opencanvas-inline-link:hover {
  color: var(--opencanvas-kit-accent, var(--kit-accent, currentColor));
}

/* Inline mark toolbar — only present in the DOM while a text element is in
   edit mode. Appended to document.body and pinned via position: fixed by
   the client so it stays anchored above the text element regardless of
   body scroll. */
/* Inline mark toolbar — floats above contenteditable text. Surface chip
   with brand-red hover, mirrors the zoom toolbar's pill aesthetic. */
.opencanvas-mark-toolbar {
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
.opencanvas-mark-toolbar button {
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
.opencanvas-mark-toolbar button:hover {
  background: var(--surface-2);
  color: var(--ink);
}
.opencanvas-mark-toolbar .opencanvas-mark-drag {
  cursor: move;
  padding: 5px 7px;
  margin-right: 2px;
  border-right: 1px solid var(--line);
  border-radius: var(--r-xs) 0 0 var(--r-xs);
  color: var(--ink-3);
}
.opencanvas-mark-toolbar .opencanvas-mark-drag svg {
  display: block;
  pointer-events: none;
}
/* Vertical divider between mark groups (marks | align | color/AI). */
.opencanvas-mark-toolbar .opencanvas-mark-sep {
  display: inline-block;
  width: 1px;
  align-self: stretch;
  margin: 2px 4px;
  background: var(--line);
}
/* Alignment buttons — pressed state mirrors the active alignment. */
.opencanvas-mark-toolbar .opencanvas-mark-align svg {
  display: block;
  pointer-events: none;
}
.opencanvas-mark-toolbar .opencanvas-mark-align.active,
.opencanvas-mark-toolbar button[aria-pressed="true"].opencanvas-mark-align {
  background: var(--surface-2);
  color: var(--ink);
}
/* Text color swatch — glyph "A" with a tiny color bar beneath, native
   <input type="color"> hidden behind the button so the swatch click opens
   the OS color picker. */
.opencanvas-mark-toolbar .opencanvas-mark-color {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  padding: 3px 8px 4px;
  line-height: 1;
}
.opencanvas-mark-toolbar .opencanvas-mark-color-glyph {
  font-weight: 700;
  font-size: 12px;
  line-height: 14px;
}
.opencanvas-mark-toolbar .opencanvas-mark-color-swatch {
  display: block;
  width: 14px;
  height: 3px;
  margin-top: 2px;
  border-radius: 1px;
  background: currentColor;
}
.opencanvas-mark-toolbar .opencanvas-mark-color-input {
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
.opencanvas-mark-toolbar .opencanvas-mark-ai {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--accent);
}
.opencanvas-mark-toolbar .opencanvas-mark-ai:hover {
  color: var(--ink);
  background: var(--accent-soft, var(--surface-2));
}

/* Link popover — singleton floating bar shown when the mouse enters or the
   caret enters an <a> inside the text element currently in edit mode. Two
   trigger modes are visually indicated by data-opencanvas-link-popover-pinned.
   Positioned below (or above) the link via position: fixed. Z-index above
   the mark toolbar (180). */
/* Link popover — floating chip above an inline link inside a text element
   in edit mode. Same warm-surface chip language as the mark toolbar. */
.opencanvas-link-popover {
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
/* Transparent "bridge" extending the popover's hit area toward the
   anchor link, so the cursor never travels through a dead zone that
   would fire the link's mouseleave hide timer. Only the bridge on the
   appropriate side activates per data-opencanvas-link-popover-placement
   set by positionLinkPopover. */
.opencanvas-link-popover[data-opencanvas-link-popover-placement="below"]::before {
  content: '';
  position: absolute;
  top: -8px;
  left: 0;
  right: 0;
  height: 8px;
}
.opencanvas-link-popover[data-opencanvas-link-popover-placement="above"]::after {
  content: '';
  position: absolute;
  bottom: -8px;
  left: 0;
  right: 0;
  height: 8px;
}
.opencanvas-link-popover[data-opencanvas-link-popover-pinned="true"] {
  border-color: var(--red);
}
.opencanvas-link-popover .opencanvas-link-popover-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.opencanvas-link-popover .opencanvas-link-popover-url {
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
.opencanvas-link-popover button {
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
.opencanvas-link-popover button:hover {
  border-color: var(--ink);
}
.opencanvas-link-popover button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Visitor-view preview row inside the link popover. The label is small +
   muted; the chip renders the actual published link styling so the Owner
   sees the same underline/colour visitors will see. The preview link sits
   outside any contenteditable subtree so the .opencanvas-inline-link rule
   applies cleanly without the contenteditable-only cursor override. */
.opencanvas-link-popover .opencanvas-link-popover-preview {
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
.opencanvas-link-popover .opencanvas-link-popover-preview-label {
  font-family: var(--sans);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  user-select: none;
  flex: 0 0 auto;
}
.opencanvas-link-popover .opencanvas-link-popover-preview-link {
  cursor: default;
  pointer-events: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

/* Link modal inline validation error */
.opencanvas-link-modal-error {
  color: var(--opencanvas-error, #e55);
  font-size: 11px;
  min-height: 16px;
  margin: -4px 0 0;
}
/* Link modal text preview */
.opencanvas-link-modal-preview {
  font-size: 12px;
  color: var(--opencanvas-fg-mute);
  padding: 6px 10px;
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* Link modal checkbox row */
.opencanvas-link-modal-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--opencanvas-fg);
  cursor: pointer;
}
.opencanvas-link-modal-checkbox input[type="checkbox"] {
  accent-color: var(--opencanvas-accent);
  cursor: pointer;
}

/* Inspector reading-order group (above the z-order group). Two compact
   buttons plus a "Reading order: N of M" caption. The caption is the only
   place owners see the section.elements[] index, which is what visitors
   hear via assistive tech. */
.opencanvas-reorder-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.opencanvas-reorder-buttons button {
  appearance: none;
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
  font: inherit;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  flex: 1 1 auto;
}
.opencanvas-reorder-buttons button:hover {
  border-color: var(--opencanvas-accent);
}
.opencanvas-reorder-caption {
  font-family: var(--opencanvas-font-mono);
  font-size: 11px;
  color: var(--opencanvas-fg-mute);
  margin-bottom: 4px;
}

/* Inspector z-order group: four buttons that mutate element.box.z. */
.opencanvas-zorder-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 12px;
}
.opencanvas-zorder-buttons button {
  appearance: none;
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
  font: inherit;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  flex: 1 1 calc(50% - 4px);
}
.opencanvas-zorder-buttons button:hover {
  border-color: var(--opencanvas-accent);
}

/* Inline link mark — both editor preview and published renderer use this
   class so the visual treatment stays in sync. */
.opencanvas-inline-link {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
  text-decoration-color: var(--kit-accent, currentColor);
}
.opencanvas-inline-link:hover {
  color: var(--kit-accent, currentColor);
}

/* AI preview panel — transient overlay that appears after the canvas-agent
   preview endpoint returns. Mirrors editor.html .ai-op (the "operation"
   card inside .ai-panel): soft red surface with red-line border so the
   suggestion reads as a brand-coloured pending action. */
.opencanvas-ai-panel {
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
.opencanvas-ai-panel h3 {
  margin: 0 0 8px;
  font-family: var(--sans);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--red-ink);
}
.opencanvas-ai-panel p { margin: 6px 0; color: var(--ink); font-size: 13px; }
.opencanvas-ai-panel .opencanvas-ai-note {
  color: var(--ink-2);
  font-style: italic;
  border-left: 2px solid var(--red-line);
  padding-left: 8px;
}
.opencanvas-ai-panel ol { padding-left: 18px; margin: 6px 0 14px; }
.opencanvas-ai-panel li { margin: 4px 0; font-size: 13px; color: var(--ink); }
.opencanvas-ai-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.opencanvas-ai-actions button {
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
.opencanvas-ai-actions button:hover:not(:disabled) {
  border-color: var(--ink);
  color: var(--ink);
}
.opencanvas-ai-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.opencanvas-ai-actions button:first-child {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}
.opencanvas-ai-actions button:first-child:hover:not(:disabled) {
  background: var(--red-strong);
  border-color: var(--red-strong);
  color: #fff;
}

/* Animation replay — owner-only control surfaced over an element while
   selected so they can re-trigger entrance/scroll animations without
   reloading the preview. */
.opencanvas-replay-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
  transition: border-color 0.12s, opacity 0.12s;
}
.opencanvas-replay-btn:hover:not(:disabled) { border-color: var(--opencanvas-accent); }
.opencanvas-replay-btn:disabled { opacity: 0.35; cursor: default; }
.opencanvas-replay-btn .play-icon {
  display: inline-block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
}
.opencanvas-page-inspector-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 14px;
}
.opencanvas-page-inspector-group h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--opencanvas-fg-mute);
}
.opencanvas-page-inspector-divider {
  height: 1px;
  background: var(--opencanvas-hairline);
  margin: 4px 14px;
}
.opencanvas-page-inspector-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--opencanvas-hairline);
  border-radius: 6px;
  background: transparent;
  color: var(--opencanvas-fg);
  font-size: 12px;
  text-decoration: none;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.opencanvas-page-inspector-link:hover {
  border-color: var(--opencanvas-accent);
  background: var(--opencanvas-bg-hover);
}

/* Modal overlay — replaces window.prompt() for the link/AI dialogs. Single
   modal stack only; the JS throws if two are opened at once. Mirrors the
   Open Canvas component primitives: surface card + rounded corners +
   shadow-lg, brand-red pill on the primary action. */
.opencanvas-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(26, 25, 23, 0.55);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.opencanvas-modal {
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
.opencanvas-modal h3 {
  margin: 0;
  font-family: var(--display);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  text-transform: none;
  color: var(--ink);
}
.opencanvas-modal label {
  font-family: var(--sans);
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: var(--ink-2);
}
.opencanvas-modal input[type="text"],
.opencanvas-modal textarea,
.opencanvas-modal select {
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
.opencanvas-modal textarea {
  resize: vertical;
  min-height: 80px;
}
.opencanvas-modal input[type="text"]:focus,
.opencanvas-modal textarea:focus,
.opencanvas-modal select:focus {
  border-color: var(--red);
  box-shadow: var(--ring);
}
.opencanvas-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 6px;
}
.opencanvas-modal-actions button {
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
.opencanvas-modal-actions button:hover {
  border-color: var(--ink);
  color: var(--ink);
}
.opencanvas-modal-actions button:last-child {
  background: var(--red);
  border-color: var(--red);
  color: #fff;
  box-shadow: var(--shadow-red);
}
.opencanvas-modal-actions button:last-child:hover {
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
.opencanvas-kit-summary {
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
.opencanvas-kit-summary .row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.opencanvas-kit-summary .swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid var(--line-2);
}

/* Presence indicator pill in the editor header. Hidden by default; the
   client script unhides when count > 1. Pill on surface-2 mirrors the
   address chip. */
.opencanvas-editor-header [data-opencanvas-presence] {
  padding: 5px 12px;
  border-radius: var(--r-pill);
  border: 1px solid var(--line);
  background: var(--surface-2);
  color: var(--ink-2);
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 600;
}
.opencanvas-editor-header [data-opencanvas-presence][hidden] {
  display: none;
}

/* Remote-cursor overlay layer. Position:fixed at the viewport so each
   caret can be placed straight from a getBoundingClientRect result with
   no scroll-offset math. pointer-events:none keeps the caret/label
   ornamental — local interaction always passes through to the canvas
   beneath. */
.opencanvas-presence-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 200;
}
.opencanvas-remote-caret {
  position: fixed;
  width: 2px;
  margin-left: -1px;
  background: #ff6600;
  border-radius: 1px;
  animation: opencanvas-remote-caret-blink 1.05s steps(2, end) infinite;
}
.opencanvas-remote-caret-label {
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
@keyframes opencanvas-remote-caret-blink {
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
  font-family: var(--opencanvas-font-mono);
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--opencanvas-fg-faint);
  margin-bottom: 2px;
}

.media-picker .picker-thumb {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border: 1px solid var(--opencanvas-hairline-strong);
  border-radius: 4px;
  cursor: pointer;
  flex-shrink: 0;
  background: var(--opencanvas-bg-panel);
  display: block;
}

.media-picker .picker-thumb.selected {
  border: 2px solid var(--opencanvas-accent);
}

.media-picker .picker-thumb.empty {
  border: 1px dashed var(--opencanvas-hairline-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--opencanvas-font-mono);
  font-size: 18px;
  color: var(--opencanvas-fg-faint);
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
  background: var(--opencanvas-danger, #c0392b);
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
  font-family: var(--opencanvas-font-mono);
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
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
  font: inherit;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
}

.media-picker .picker-current-actions button:hover {
  border-color: var(--opencanvas-accent);
}

.media-picker .picker-current-actions input[type="text"] {
  width: 100%;
  appearance: none;
  background: var(--opencanvas-bg-panel);
  border: 1px solid var(--opencanvas-hairline);
  color: var(--opencanvas-fg);
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
.opencanvas-editor-sidebar,
#canvas-inspector,
.opencanvas-sidebar-panel,
.opencanvas-chat-panel,
#canvas-chat-messages,
.opencanvas-version-pill,
.opencanvas-modal {
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.opencanvas-editor-sidebar::-webkit-scrollbar,
#canvas-inspector::-webkit-scrollbar,
.opencanvas-sidebar-panel::-webkit-scrollbar,
.opencanvas-chat-panel::-webkit-scrollbar,
#canvas-chat-messages::-webkit-scrollbar,
.opencanvas-version-pill::-webkit-scrollbar,
.opencanvas-modal::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
.opencanvas-editor-sidebar::-webkit-scrollbar-track,
#canvas-inspector::-webkit-scrollbar-track,
.opencanvas-sidebar-panel::-webkit-scrollbar-track,
.opencanvas-chat-panel::-webkit-scrollbar-track,
#canvas-chat-messages::-webkit-scrollbar-track,
.opencanvas-version-pill::-webkit-scrollbar-track,
.opencanvas-modal::-webkit-scrollbar-track {
  background: transparent;
}
.opencanvas-editor-sidebar::-webkit-scrollbar-thumb,
#canvas-inspector::-webkit-scrollbar-thumb,
.opencanvas-sidebar-panel::-webkit-scrollbar-thumb,
.opencanvas-chat-panel::-webkit-scrollbar-thumb,
#canvas-chat-messages::-webkit-scrollbar-thumb,
.opencanvas-version-pill::-webkit-scrollbar-thumb,
.opencanvas-modal::-webkit-scrollbar-thumb {
  background: var(--line-2);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.opencanvas-editor-sidebar::-webkit-scrollbar-thumb:hover,
#canvas-inspector::-webkit-scrollbar-thumb:hover,
.opencanvas-sidebar-panel::-webkit-scrollbar-thumb:hover,
.opencanvas-chat-panel::-webkit-scrollbar-thumb:hover,
#canvas-chat-messages::-webkit-scrollbar-thumb:hover,
.opencanvas-version-pill::-webkit-scrollbar-thumb:hover,
.opencanvas-modal::-webkit-scrollbar-thumb:hover {
  background: var(--red);
  background-clip: padding-box;
}
.opencanvas-editor-sidebar::-webkit-scrollbar-corner,
#canvas-inspector::-webkit-scrollbar-corner,
.opencanvas-sidebar-panel::-webkit-scrollbar-corner,
.opencanvas-chat-panel::-webkit-scrollbar-corner,
#canvas-chat-messages::-webkit-scrollbar-corner,
.opencanvas-version-pill::-webkit-scrollbar-corner,
.opencanvas-modal::-webkit-scrollbar-corner {
  background: transparent;
}
`;

// Concatenate Open Canvas tokens + chrome CSS + shared kit CSS. theme.css
// (themeCss) goes FIRST so its --opencanvas-* alias block re-points the
// chrome's variable names onto the Open Canvas palette before any chrome
// rule reads them. The kit CSS lives in src/canvas/style-kits.ts and is
// the single source of truth shared with the public renderer
// (src/canvas/public-styles.ts) — it is UNTOUCHED by the rebrand to
// preserve byte-identical visitor output.
export const canvasEditorStyles = `${themeCss}\n${componentsCss}\n${chromeCss}\n${kitCss}`;
