// src/editor-client/sidebar.ts
//
// ADR 0058 Phase 2q.i — sidebar wiring (style kit + tabs + actions).
// canvas-client.ts:12110-12227 (kit summary + style-kit sync/apply +
// tabs wiring) and 12760-12799 (actions wiring) carry the inline twin;
// retires on Phase 3 cutover. The inline IIFE in canvas-client.ts is
// UNCHANGED — this module is the Phase 3 cutover destination, not a
// live call site yet.
//
// Five functions live here:
//
//   - buildKitSummary(ctx) — build the inspector summary card that reads
//     computed CSS off ctx.mainEl. There is intentionally no duplicate
//     copy of STYLE_KIT_PRESETS in the client bundle: the wrapper's
//     resolved CSS variables are the runtime source of truth, so the
//     summary stays in sync with whatever style-kits.ts emits.
//
//   - syncSidebarStyleKitButtonsImpl(ctx, buttons) — toggle the .active
//     class + aria-pressed flag on every sidebar style-kit chip so the
//     chip row matches ctx.state.styleKit. Exported with the `Impl`
//     suffix per the renderAllImpl / updateChatSelectionChipImpl
//     precedent: the ctx interface already declares the signature
//     (ctx.syncSidebarStyleKitButtons from Phase 2l); createEditor will
//     bind `ctx.syncSidebarStyleKitButtons = (buttons) =>
//     syncSidebarStyleKitButtonsImpl(ctx, buttons)` at boot.
//
//   - applySidebarStyleKit(ctx, kit, buttons) — apply the kit visually
//     first (set state.styleKit, mirror data-style-kit on ctx.mainEl,
//     toggle chip row, re-render the inspector), then persist in the
//     background. On rapid kit clicks the targetKit guard ensures only
//     the kit the user actually ended on reaches the backend; on POST
//     failure the local state rolls back to prevKit so the UI stops
//     lying about what's saved.
//
//   - attachSidebarTabs(ctx) — wire click handlers on the 3 static tabs
//     rendered in route.tsx (Add / Sections / Pages). The Versions tab
//     is mounted dynamically later by ensureVersionsTabMounted and
//     brings its own click handler. All four delegate to
//     ctx.activateSidebarTab so the active class is toggled on every
//     live tab.
//
//   - attachSidebarActions(ctx) — wire click handlers on the static
//     sidebar action buttons: data-sidebar-add-section (blank section),
//     data-sidebar-add-component (drop-in via SIDEBAR_COMMANDS),
//     data-sidebar-style-kit (apply kit), and the inspector's section-
//     action delegation (data-section-action / data-section-id).
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import type { StyleKit } from '../canvas/schema.js';
import { STYLE_KITS } from './shared-constants.js';
import { applyCustomKitCss } from './custom-kit-css.js';

const STYLE_KITS_LIST = STYLE_KITS as readonly string[];

export function buildKitSummary(ctx: EditorContext): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'opencanvas-kit-summary';
  if (!ctx.mainEl || !ctx.state || !ctx.state.styleKit) {
    wrap.textContent = 'kit: (unknown)';
    return wrap;
  }
  const cs = window.getComputedStyle(ctx.mainEl);
  function token(name: string, fallback: string): string {
    const value = cs.getPropertyValue(name);
    return value && value.trim().length > 0 ? value.trim() : fallback;
  }
  const accent = token('--opencanvas-kit-accent', '(unset)');
  const display = token('--opencanvas-kit-font-display', '(unset)');
  const duration = token('--opencanvas-kit-motion-duration', '(unset)');
  const rows: Array<[string, string, string | null]> = [
    ['kit', ctx.state.styleKit, null],
    ['accent', accent, accent],
    ['display', display.split(',')[0]!.replace(/['"]/g, '').trim(), null],
    ['motion', duration, null],
  ];
  for (let i = 0; i < rows.length; i++) {
    const row = document.createElement('div');
    row.className = 'row';
    const swatch = rows[i]![2];
    if (swatch) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = swatch;
      row.appendChild(sw);
    }
    const label = document.createElement('span');
    label.textContent = rows[i]![0] + ': ' + rows[i]![1];
    row.appendChild(label);
    wrap.appendChild(row);
  }
  return wrap;
}

export function syncSidebarStyleKitButtonsImpl(
  ctx: EditorContext,
  buttons: NodeListOf<Element>,
): void {
  buttons.forEach((b) => {
    const isActive =
      !!ctx.state && b.getAttribute('data-sidebar-style-kit') === ctx.state.styleKit;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

// Apply kit visually first, then persist in the background. The previous
// shape blocked the visual swap behind flushPendingSave + the /style-kit
// POST, so on a slow network the user clicked Charcoal and nothing
// happened for seconds. Now the attribute flip and inspector re-render
// are synchronous; the persistence races behind. On rapid kit clicks the
// targetKit guard ensures we only POST the kit the user actually ended
// on, and on POST failure we roll the local state back to prevKit so the
// UI stops lying about what's saved.
export async function applySidebarStyleKit(
  ctx: EditorContext,
  kit: string | null,
  buttons: NodeListOf<Element>,
): Promise<void> {
  if (!kit || STYLE_KITS_LIST.indexOf(kit) < 0) return;
  if (!ctx.state) return;
  if (ctx.state.styleKit === kit) return;
  const prevKit = ctx.state.styleKit;
  ctx.captureForUndo();
  ctx.state.styleKit = kit as StyleKit;
  if (ctx.mainEl) ctx.mainEl.setAttribute('data-style-kit', kit);
  applyCustomKitCss(ctx.state);
  ctx.syncSidebarStyleKitButtons(buttons);
  ctx.renderInspector();
  ctx.setStatus('Style kit: ' + kit, 'ok');
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) return;
    // A later click may have moved on to a different kit while the save
    // flush was in flight; only the kit currently held in local state
    // should reach the backend.
    if (ctx.state.styleKit !== kit) return;
    const response = await ctx.authFetch(ctx.siteBase + '/style-kit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ styleKit: kit }),
    });
    if (!response.ok) {
      let detail: string = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        if (body && body.error) detail = body.error;
      } catch (_) {
        /* ignore */
      }
      if (ctx.state.styleKit === kit) {
        ctx.state.styleKit = prevKit;
        if (ctx.mainEl) ctx.mainEl.setAttribute('data-style-kit', prevKit);
        applyCustomKitCss(ctx.state);
        ctx.syncSidebarStyleKitButtons(buttons);
        ctx.renderInspector();
      }
      ctx.setStatus('Style kit revert: ' + detail, 'error');
    }
  } catch (_err) {
    if (ctx.state.styleKit === kit) {
      ctx.state.styleKit = prevKit;
      if (ctx.mainEl) ctx.mainEl.setAttribute('data-style-kit', prevKit);
      applyCustomKitCss(ctx.state);
      ctx.syncSidebarStyleKitButtons(buttons);
      ctx.renderInspector();
    }
    ctx.setStatus('Style kit change failed', 'error');
  }
}

export function attachSidebarTabs(ctx: EditorContext): void {
  // Listeners attach to the 3 static tabs rendered in route.tsx (Add /
  // Sections / Pages). The Versions tab is mounted dynamically later by
  // ensureVersionsTabMounted and brings its own click handler. All four
  // delegate to the single activateSidebarTab() function so the active
  // class is toggled on every live tab — querying [data-sidebar-tab]
  // fresh on each click is what keeps the Versions tab's underline from
  // sticking when the user switches back to Add/Sections/Pages.
  const tabButtons = document.querySelectorAll('[data-sidebar-tab]');
  const panels = document.querySelectorAll('[data-sidebar-panel]');
  if (tabButtons.length === 0 || panels.length === 0) return;

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-sidebar-tab');
      if (tabName) ctx.activateSidebarTab(tabName);
    });
  });
}

export function attachSidebarActions(ctx: EditorContext): void {
  if (!ctx.sidebar) return;
  const sectionButtons = ctx.sidebar.querySelectorAll('[data-sidebar-add-section]');
  sectionButtons.forEach((button) => {
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      const kind = button.getAttribute('data-sidebar-add-section');
      if (kind === 'blank') ctx.addBlankSectionFromSidebar();
    });
  });

  const componentButtons = ctx.sidebar.querySelectorAll('[data-sidebar-add-component]');
  componentButtons.forEach((button) => {
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      const component = button.getAttribute('data-sidebar-add-component');
      if (component) ctx.addComponentFromSidebar(component);
    });
  });

  const styleButtons = ctx.sidebar.querySelectorAll('[data-sidebar-style-kit]');
  ctx.syncSidebarStyleKitButtons(styleButtons);
  styleButtons.forEach((button) => {
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      const kit = button.getAttribute('data-sidebar-style-kit');
      void applySidebarStyleKit(ctx, kit, styleButtons);
    });
  });

  if (ctx.inspector) {
    ctx.inspector.addEventListener('click', function (ev) {
      const target = ev.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest('[data-section-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-section-action');
      const sid = btn.getAttribute('data-section-id');
      if (action && sid) ctx.handleSectionAction(action, sid);
    });
  }
}
