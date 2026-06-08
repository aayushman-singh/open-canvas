// src/editor-client/sections-picker.ts
//
// ADR 0058 Phase 2q.i — sections picker (cross-template catalog).
// canvas-client.ts:12229-12260 (state + escape helpers context) and
// 12501-12759 (catalog loader + grid + placement-mode + import) carry
// the inline twin; retires on Phase 3 cutover. The inline IIFE in
// canvas-client.ts is UNCHANGED — this module is the Phase 3 cutover
// destination, not a live call site yet.
//
// Six functions live here:
//
//   - ensureSectionsPanelLoaded(ctx) — fetch /library/sections once
//     (memoised via ctx.sectionsCatalog === null sentinel), then call
//     renderSectionsPanelImpl. Surfaces "Failed to load sections." into
//     the picker root on a non-OK response or network error.
//
//   - renderSectionsPanelImpl(ctx) — split-render: builds the controls
//     shell (search + filter) once via the inner renderSectionsPickerShell
//     helper, then re-renders only the grid via renderSectionsPickerGrid
//     on every subsequent call. Keeping the shell stable across
//     keystroke re-renders is what preserves search-input focus.
//
//   - enterPlacementModeImpl(ctx, target) — stash the pending target on
//     ctx.pendingImport, surface the "click a slot to insert" prompt,
//     and re-render the picker grid (so the active card flips to
//     "Cancel") and the canvas (so between-section drop slots appear).
//
//   - exitPlacementModeImpl(ctx) — clear ctx.pendingImport, surface
//     "Cancelled", and re-render the picker grid + canvas to drop the
//     slots.
//
//   - renderPlacementSlotsImpl(ctx) — draw the between-section drop
//     slots inside #canvas-root. Idempotent: removes any prior
//     .opencanvas-section-slot first so we never double-draw. Sets/
//     clears data-placement-active on <body> so the canvas can dim
//     itself behind the slots via CSS.
//
//   - importPendingSectionAt(ctx, insertAt) — flush the pending save,
//     POST /sites/<id>/sections/import with either the library or seed
//     coordinates, then swap state for the response's editableState,
//     migrate it, clear selection, and re-render. Loud failure: the
//     status line carries the server's error.detail; no silent fallback
//     to a placeholder state.
//
// On `pendingImport` type narrowing: the ctx field used to be typed
// `unknown` because Phase 2l (camera/render) only reads its truthiness
// before invoking ctx.renderPlacementSlots. With this module owning the
// reads and writes, the field narrows to PendingImport | null. The
// camera module's truthiness gate stays valid under the narrower type.

import { SECTION_CATEGORIES, type SectionCategory } from '../canvas/section-library/categories.js';
import type {
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { applyCustomKitCss } from './custom-kit-css.js';
import { migrateState } from './state-migration.js';
import { escapeAttr, escapeHtml } from './html-escape.js';

const CATEGORY_LABEL: Record<SectionCategory | 'all', string> = {
  all: 'All sections',
  header: 'Header',
  hero: 'Hero',
  features: 'Features',
  testimonials: 'Testimonials',
  cta: 'CTA',
  gallery: 'Gallery',
  footer: 'Footer',
  other: 'Other',
};

/**
 * Catalog entry returned by `GET /api/library/sections`. Mirrors the
 * server-side `LibraryCatalogEntry` shape (src/routes/api/library-
 * sections.ts) but kept as a local interface so the editor-client
 * bundle doesn't pull in route / DB / auth modules just to read three
 * fields off the response. Both shapes drift in lockstep; if the
 * server adds a field the picker needs, mirror it here.
 */
export interface SectionsCatalogEntry {
  source: 'seed' | 'library';
  id: string;
  name: string;
  recipeId: string;
  headingPreview: string;
  visibility: 'global' | 'private';
  /** ADR 0061 Decision 8 — picker filter axis. */
  category: SectionCategory;
  /** ADR 0061 Decision 11 — surfaced in card body + included in haystack. */
  description: string;
  /** Origin-named pool slug. Included in haystack. */
  baseSlug: string;
  /** ISO timestamp; drives `Recently added` sort. Seed rows use a 1970 sentinel. */
  createdAt: string;
  templateId?: string;
  templateName?: string;
  sectionId?: string;
  librarySectionId?: string;
  /** Schematic SVG of the section's element layout. */
  thumbnail: string;
}

/**
 * Shape of the "Use" button payload — the picker stashes this on
 * ctx.pendingImport when the Owner clicks a card, the canvas reads it
 * as a truthiness gate to draw between-section drop slots, and
 * importPendingSectionAt reads it as the import target.
 */
export interface PendingImport {
  id: string;
  source: string;
  name: string;
  templateId: string;
  sectionId: string;
  librarySectionId: string;
}

// ADR 0064 — the sections-picker functions form a tight cycle (loader
// calls renderer, renderer calls enter/exit, enter/exit re-render and
// queue placement slots, importPendingSectionAt re-renders) so they
// share a single narrow surface. Canonical clusters touched:
//   - StateContext: `state` mutation + `currentPage()` walk for slots.
//   - DomContext: `mainEl` for the data-style-kit attribute swap.
//   - SelectionContext: clearing `selectedSectionId` / `selectedElementId`
//     after the editableState swap so stale ids don't survive the import.
//   - RenderContext: `renderAll()` after the state swap.
//   - PersistContext: `authFetch` + `apiBase` + `siteId` for the
//     /library/sections GET and /sites/<id>/sections/import POST.
//   - StatusEmitterContext: the status-line surface area for placement
//     prompts and import success/failure toasts.
// The inline `Pick` covers picker-local UI state + the import flush hook
// + the pending-import latch, none of which fits a canonical alias.
export type SectionsPickerContext = StateContext &
  DomContext &
  SelectionContext &
  RenderContext &
  PersistContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    | 'sectionsCatalog'
    | 'activeCategoryFilter'
    | 'activeSearchQuery'
    | 'activeSortMode'
    | 'pendingImport'
    | 'flushPendingSave'
  >;

export async function ensureSectionsPanelLoaded(ctx: SectionsPickerContext): Promise<void> {
  const root = document.querySelector('[data-section-picker-root]');
  if (!root) return;
  if (ctx.sectionsCatalog === null) {
    try {
      const response = await ctx.authFetch(ctx.apiBase + '/library/sections');
      if (!response.ok) {
        root.innerHTML =
          '<p class="opencanvas-section-picker-empty">Failed to load sections.</p>';
        return;
      }
      const body = (await response.json()) as { sections?: SectionsCatalogEntry[] };
      ctx.sectionsCatalog = Array.isArray(body.sections) ? body.sections : [];
    } catch (_err) {
      root.innerHTML =
        '<p class="opencanvas-section-picker-empty">Failed to load sections.</p>';
      return;
    }
  }
  renderSectionsPanelImpl(ctx);
}

export function renderSectionsPanelImpl(ctx: SectionsPickerContext): void {
  const root = document.querySelector('[data-section-picker-root]');
  if (!root || ctx.sectionsCatalog === null) return;

  let gridContainer = root.querySelector('[data-section-picker-grid-container]');
  if (!gridContainer) {
    // First paint: build the persistent shell (controls + empty grid container).
    // Subsequent calls skip this branch so the search input keeps focus across
    // keystroke-triggered re-renders.
    renderSectionsPickerShell(ctx, root);
    gridContainer = root.querySelector('[data-section-picker-grid-container]');
  }

  if (gridContainer) renderSectionsPickerGrid(ctx, gridContainer);
}

function renderSectionsPickerShell(ctx: SectionsPickerContext, root: Element): void {
  // ADR 0061 Decision 11 — category filter replaces the source filter
  // ("All / Built-in / Library") because Owners care about *what the
  // section is*, not where it came from. Order mirrors SECTION_CATEGORIES
  // so reading order stays Header → Hero → Features → … → Footer → Other.
  const filterOptions = [
    `<option value="all">${CATEGORY_LABEL.all}</option>`,
    ...SECTION_CATEGORIES.map((category) => `<option value="${category}">${CATEGORY_LABEL[category]}</option>`),
  ].join('');

  // ADR 0061 Decision 11 — sort toggle: A-Z (default) vs Recently added.
  const sortOptions = [
    '<option value="a-z">A-Z</option>',
    '<option value="recent">Recently added</option>',
  ].join('');

  root.innerHTML =
    '<div class="opencanvas-section-picker-controls">' +
    '<input type="search" class="opencanvas-section-picker-search" placeholder="Search sections" ' +
    'value="' +
    escapeAttr(ctx.activeSearchQuery) +
    '" data-section-picker-search />' +
    '<select class="opencanvas-section-picker-filter" data-section-picker-filter aria-label="Filter by category">' +
    filterOptions +
    '</select>' +
    '<select class="opencanvas-section-picker-sort" data-section-picker-sort aria-label="Sort order">' +
    sortOptions +
    '</select>' +
    '</div>' +
    '<div data-section-picker-grid-container></div>';

  const filter = root.querySelector('[data-section-picker-filter]');
  if (filter instanceof HTMLSelectElement) {
    filter.value = ctx.activeCategoryFilter;
    filter.addEventListener('change', () => {
      ctx.activeCategoryFilter = filter.value;
      const grid = root.querySelector('[data-section-picker-grid-container]');
      if (grid) renderSectionsPickerGrid(ctx, grid);
    });
  }
  const sort = root.querySelector('[data-section-picker-sort]');
  if (sort instanceof HTMLSelectElement) {
    sort.value = ctx.activeSortMode;
    sort.addEventListener('change', () => {
      if (sort.value === 'a-z' || sort.value === 'recent') {
        ctx.activeSortMode = sort.value;
      }
      const grid = root.querySelector('[data-section-picker-grid-container]');
      if (grid) renderSectionsPickerGrid(ctx, grid);
    });
  }
  const search = root.querySelector('[data-section-picker-search]');
  if (search instanceof HTMLInputElement) {
    search.addEventListener('input', () => {
      ctx.activeSearchQuery = search.value;
      const grid = root.querySelector('[data-section-picker-grid-container]');
      if (grid) renderSectionsPickerGrid(ctx, grid);
    });
  }
}

/**
 * ADR 0061 Decision 11 — pure filter+sort over the catalog. Exposed for
 * the picker smoke so filter/search/sort behaviour can be tested without
 * a DOM. The grid renderer below just feeds the ctx fields into this and
 * renders the result; behaviour stays in lockstep.
 */
export function filterAndSortCatalog(
  catalog: ReadonlyArray<SectionsCatalogEntry>,
  options: { category: string; query: string; sort: 'a-z' | 'recent' },
): SectionsCatalogEntry[] {
  const filtered = catalog.filter((entry) => {
    if (options.category !== 'all' && entry.category !== options.category) {
      return false;
    }
    if (options.query.length > 0) {
      // Pre-Phase-E haystack excluded recipeId and slug, which made
      // "testimonial" miss `library-template-testimonial-quote`. The
      // widened haystack covers slug + name + recipeId + category +
      // headingPreview + originTemplateName + description.
      const haystack = [
        entry.name,
        entry.headingPreview,
        entry.recipeId,
        entry.category,
        entry.baseSlug,
        entry.description,
        entry.templateName ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(options.query.toLowerCase())) return false;
    }
    return true;
  });

  // A-Z is default; Recently added uses ISO createdAt DESC. Seed entries
  // carry a 1970 sentinel so they sort after any real Owner-saved row in
  // `recent` mode.
  if (options.sort === 'a-z') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }
  return filtered;
}

function renderSectionsPickerGrid(ctx: SectionsPickerContext, gridContainer: Element): void {
  if (ctx.sectionsCatalog === null) return;

  const filtered = filterAndSortCatalog(ctx.sectionsCatalog, {
    category: ctx.activeCategoryFilter,
    query: ctx.activeSearchQuery,
    sort: ctx.activeSortMode,
  });

  const cards = filtered
    .map((entry) => {
      const isPending = ctx.pendingImport !== null && ctx.pendingImport.id === entry.id;
      const sourceLabel =
        entry.source === 'seed'
          ? escapeHtml(entry.templateName || 'Built-in')
          : entry.visibility === 'private'
            ? 'Your library'
            : 'Library';
      // entry.thumbnail is a server-built SVG string (templates/section-thumbnail.ts).
      // It composes only static attribute values and numeric box coords, never
      // user content, so inlining it as innerHTML is safe; escapeHtml would
      // double-escape and render the angle brackets as text.
      const thumb =
        typeof entry.thumbnail === 'string' && entry.thumbnail.length > 0
          ? '<div class="opencanvas-section-card-thumb">' + entry.thumbnail + '</div>'
          : '';
      return (
        '<li class="opencanvas-section-card' +
        (isPending ? ' is-pending' : '') +
        '">' +
        thumb +
        '<div class="opencanvas-section-card-head">' +
        '<span class="opencanvas-section-card-name">' +
        escapeHtml(entry.name) +
        '</span>' +
        '<span class="opencanvas-section-card-recipe">' +
        escapeHtml(entry.recipeId) +
        '</span>' +
        '</div>' +
        '<p class="opencanvas-section-card-preview">' +
        escapeHtml(entry.headingPreview) +
        '</p>' +
        '<div class="opencanvas-section-card-foot">' +
        '<span class="opencanvas-section-card-template">' +
        sourceLabel +
        '</span>' +
        '<button type="button" class="opencanvas-section-card-use" data-section-card-use ' +
        'data-entry-id="' +
        escapeAttr(entry.id) +
        '" ' +
        'data-entry-source="' +
        escapeAttr(entry.source) +
        '" ' +
        'data-entry-name="' +
        escapeAttr(entry.name) +
        '"' +
        (entry.templateId ? ' data-template-id="' + escapeAttr(entry.templateId) + '"' : '') +
        (entry.librarySectionId
          ? ' data-library-section-id="' + escapeAttr(entry.librarySectionId) + '"'
          : '') +
        (entry.sectionId ? ' data-section-id="' + escapeAttr(entry.sectionId) + '"' : '') +
        '>' +
        (isPending ? 'Cancel' : 'Use') +
        '</button>' +
        '</div>' +
        '</li>'
      );
    })
    .join('');

  gridContainer.innerHTML =
    filtered.length === 0
      ? '<p class="opencanvas-section-picker-empty">No sections match.</p>'
      : '<ul class="opencanvas-section-picker-grid">' + cards + '</ul>';

  gridContainer.querySelectorAll('[data-section-card-use]').forEach((button) => {
    button.addEventListener('click', () => {
      const entryId = button.getAttribute('data-entry-id') || '';
      const entrySource = button.getAttribute('data-entry-source') || '';
      const entryName = button.getAttribute('data-entry-name') || '';
      const templateId = button.getAttribute('data-template-id') || '';
      const sectionId = button.getAttribute('data-section-id') || '';
      const librarySectionId = button.getAttribute('data-library-section-id') || '';
      if (ctx.pendingImport !== null && ctx.pendingImport.id === entryId) {
        exitPlacementModeImpl(ctx);
      } else {
        enterPlacementModeImpl(ctx, {
          id: entryId,
          source: entrySource,
          name: entryName,
          templateId: templateId,
          sectionId: sectionId,
          librarySectionId: librarySectionId,
        });
      }
    });
  });
}

export function enterPlacementModeImpl(ctx: SectionsPickerContext, target: PendingImport): void {
  ctx.pendingImport = target;
  // setStatus only recognises "error" / "ok" tones in this codebase;
  // "info" would silently fall through. Use "ok" for the pending banner.
  ctx.setStatus('Click a slot to insert "' + target.name + '" section', 'ok');
  renderSectionsPanelImpl(ctx);
  renderPlacementSlotsImpl(ctx);
}

export function exitPlacementModeImpl(ctx: SectionsPickerContext): void {
  ctx.pendingImport = null;
  ctx.setStatus('Cancelled', 'ok');
  renderSectionsPanelImpl(ctx);
  renderPlacementSlotsImpl(ctx);
}

export function renderPlacementSlotsImpl(ctx: SectionsPickerContext): void {
  const canvasRoot = document.getElementById('canvas-root');
  if (!canvasRoot) return;

  // Remove any previously-drawn slots so we never double-draw.
  canvasRoot.querySelectorAll('.opencanvas-section-slot').forEach((node) => node.remove());

  if (!ctx.pendingImport) {
    document.body.removeAttribute('data-placement-active');
    return;
  }
  document.body.setAttribute('data-placement-active', 'true');

  const page = ctx.currentPage();
  if (!page) return;
  const sections = Array.isArray(page.sections) ? page.sections : [];

  function makeSlot(insertAt: number): HTMLButtonElement {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'opencanvas-section-slot';
    slot.setAttribute('data-slot-index', String(insertAt));
    slot.setAttribute('aria-label', 'Insert section here (position ' + insertAt + ')');
    slot.textContent = '+ Insert here';
    slot.addEventListener('click', () => {
      void importPendingSectionAt(ctx, insertAt);
    });
    return slot;
  }

  if (sections.length === 0) {
    canvasRoot.appendChild(makeSlot(0));
    return;
  }

  const sectionNodes = Array.from(
    canvasRoot.querySelectorAll('[data-opencanvas-section]:not([data-section-role])'),
  );
  for (let i = 0; i < sectionNodes.length; i += 1) {
    const node = sectionNodes[i]!;
    if (node.parentNode) node.parentNode.insertBefore(makeSlot(i), node);
  }
  const lastNode = sectionNodes[sectionNodes.length - 1];
  if (lastNode && lastNode.parentNode) {
    const afterLast = lastNode.nextSibling;
    if (afterLast) {
      lastNode.parentNode.insertBefore(makeSlot(sections.length), afterLast);
    } else {
      lastNode.parentNode.appendChild(makeSlot(sections.length));
    }
  }
}

export async function importPendingSectionAt(
  ctx: SectionsPickerContext,
  insertAt: number,
): Promise<void> {
  if (!ctx.pendingImport) return;
  const target = ctx.pendingImport;
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) return;
    ctx.setStatus('Inserting section…', 'ok');
    const importBody =
      target.source === 'library'
        ? { source: 'library', librarySectionId: target.librarySectionId, insertAt: insertAt }
        : { templateId: target.templateId, sectionId: target.sectionId, insertAt: insertAt };
    const response = await ctx.authFetch(
      ctx.apiBase + '/sites/' + ctx.siteId + '/sections/import',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(importBody),
      },
    );
    if (!response.ok) {
      let detail: string = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        if (body && body.error) detail = body.error;
      } catch (_e2) {
        /* ignore */
      }
      ctx.setStatus('Insert failed: ' + detail, 'error');
      return;
    }
    const body = (await response.json()) as { editableState?: unknown };
    if (!body || typeof body !== 'object' || !body.editableState) {
      ctx.setStatus('Insert failed: malformed server response', 'error');
      return;
    }
    ctx.state = body.editableState as EditorContext['state'];
    if (ctx.state) ctx.state = migrateState(ctx.state);
    ctx.selectedSectionId = null;
    ctx.selectedElementId = null;
    ctx.pendingImport = null;
    if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
      ctx.mainEl.setAttribute('data-style-kit', ctx.state.styleKit);
    }
    applyCustomKitCss(ctx.state);
    ctx.renderAll();
    renderSectionsPanelImpl(ctx);
    ctx.setStatus('Inserted section from ' + target.name, 'ok');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Insert failed: ' + message, 'error');
  }
}
