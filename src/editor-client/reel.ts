// src/editor-client/reel.ts
//
// ADR 0058 Phase 2q.h — asset reel + section thumbnails.
// canvas-client.ts:8060-8436 carries the inline twin (openReel, closeReel,
// wireframeTextNodes, buildSectionThumbnail, buildReelInsertButton,
// insertBlankSectionAt, moveSectionToIndex, buildReelRoleSlot, renderReel,
// mountReel). The inline IIFE remains the production source-of-truth until
// ADR 0015 Phase 3 atomic cutover; this module is the cutover destination
// and ships dead-code until then.
//
// Why these stay together: every function in this module either renders the
// reel, mounts the reel chrome, or mutates the section list in a way that
// triggers a reel re-render. Splitting `openReel`/`closeReel` from
// `renderReel` would force one of them to import the other across module
// boundaries while sharing the same `isReelOpen` latch; splitting
// `mountReel` would force every reel button (Tile / List / + / ×) to
// re-import `renderReel` + `insertBlankSectionAt` + `closeReel` from a
// sibling module instead of grabbing them from the same closure. The
// section-drag cluster (canvas-client.ts:8438-8681) lives in a sibling
// module — it depends on this one (`buildSectionThumbnail` ghost,
// `moveSectionToIndex` drop) but the dependency runs one-way.
//
// Ten functions live here:
//
//   - openReelImpl(ctx) — set ctx.isReelOpen=true, clear element selection
//     (the reel and a selected element are mutually exclusive UI modes),
//     re-render. Bound at boot to `ctx.openReel = () => openReelImpl(ctx)`.
//
//   - closeReelImpl(ctx) — set ctx.isReelOpen=false, re-render. Bound at
//     boot to `ctx.closeReel = () => closeReelImpl(ctx)`.
//
//   - wireframeTextNodes(clone) — replace every text-element's content
//     with a flat currentColor rectangle when the thumbnail scale drops
//     below 0.25. Pure DOM mutation; no ctx dependency. Used only by
//     buildSectionThumbnail; left private to this module.
//
//   - buildSectionThumbnail(ctx, section, pageWidth, thumbWidth) — clone
//     ctx.buildSectionNode output, strip interactive chrome (toolbars,
//     resize handles, AI buttons, contenteditable), scale to fit thumbWidth,
//     wrap in a style-kit container. Returned wrapper is the live ghost
//     used by both reel tiles and section-drag previews.
//
//   - buildReelInsertButton(ctx, insertAt) — between-tile "+" button that
//     spawns a blank section at the clamped insertAt position on click.
//
//   - insertBlankSectionAt(ctx, insertAt) — splice a new blank section
//     into currentPage().sections at the clamped insertAt position,
//     select it, re-render, schedule save, surface status. Used by the
//     reel "+" affordances and mountReel's add-section button.
//
//   - moveSectionToIndex(ctx, fromIdx, toIdx) — reorder a body section,
//     skipping no-ops (same position / off-array). ADR 0059: page sections
//     are never pinned, so no pin-bound guards. Called from section-drag.ts.
//
//   - buildReelRoleSlot(ctx, role) — header / footer slot button. Click
//     creates a new pinned section (defaulting to height 80 for header,
//     120 for footer), assigns it to state.header / state.footer,
//     captures undo, re-renders, surfaces status.
//
//   - renderReelImpl(ctx) — full reel re-render. Reads ctx.reelViewMode
//     ("tile" / "list") for the tile shape, draws the header tile or
//     slot, every body section (interleaved with insert buttons,
//     pinned-vs-body styling), the trailing insert button, and the
//     footer tile or slot. Wired to mousedown / click handlers per tile.
//     Bound at boot to `ctx.renderReel = () => renderReelImpl(ctx)`.
//
//   - mountReel(ctx) — append the #canvas-reel aside element to
//     document.body with header (Sections heading + Tile/List/+/× action
//     buttons) and an empty body div. Run once at boot.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the Phase
// 3 cutover destination, not a live call site yet.

import type { CanvasSection } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { newSectionId } from './ids.js';
import { beginReelDragImpl } from './section-drag.js';

export function openReelImpl(ctx: EditorContext): void {
  ctx.isReelOpen = true;
  ctx.selectElement(null);
  ctx.renderReel();
}

export function closeReelImpl(ctx: EditorContext): void {
  ctx.isReelOpen = false;
  ctx.renderReel();
}

function wireframeTextNodes(clone: HTMLElement): void {
  const textEls = clone.querySelectorAll('[data-element-type="text"]');
  for (let i = 0; i < textEls.length; i++) {
    const el = textEls[i] as HTMLElement;
    const w = el.style.width;
    const h = el.style.height;
    el.innerHTML = '';
    const rect = document.createElement('div');
    rect.style.width = w || '100%';
    rect.style.height = h || '100%';
    rect.style.background = 'currentColor';
    rect.style.opacity = '0.15';
    rect.style.borderRadius = '1px';
    el.appendChild(rect);
  }
}

export function buildSectionThumbnail(
  ctx: EditorContext,
  section: CanvasSection,
  pageWidth: number,
  thumbWidth: number,
): HTMLElement {
  const clone = ctx.buildSectionNode(section, pageWidth);
  const strip = clone.querySelectorAll(
    '.section-toolbar, .resize-handle, .element-menu-trigger, .element-menu, [data-section-grip], [data-ai-button]',
  );
  for (let i = 0; i < strip.length; i++) strip[i]!.remove();
  const editables = clone.querySelectorAll('[contenteditable]');
  for (let i = 0; i < editables.length; i++) editables[i]!.removeAttribute('contenteditable');
  clone.removeAttribute('data-selected');
  const selectedInside = clone.querySelectorAll('[data-selected]');
  for (let i = 0; i < selectedInside.length; i++) {
    selectedInside[i]!.removeAttribute('data-selected');
  }
  clone.style.pointerEvents = 'none';
  clone.style.userSelect = 'none';

  const scale = thumbWidth / pageWidth;
  if (scale < 0.25) wireframeTextNodes(clone);

  clone.style.transform = 'scale(' + scale + ')';
  clone.style.transformOrigin = 'top left';

  const kitWrap = document.createElement('div');
  if (ctx.mainEl && ctx.state && ctx.state.styleKit) {
    kitWrap.setAttribute('data-style-kit', ctx.state.styleKit);
  }
  kitWrap.appendChild(clone);

  const wrap = document.createElement('div');
  wrap.className = 'reel-thumbnail-wrap';
  wrap.style.width = thumbWidth + 'px';
  wrap.style.height = Math.round(section.height * scale) + 'px';
  wrap.appendChild(kitWrap);
  return wrap;
}

function buildReelInsertButton(ctx: EditorContext, insertAt: number): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reel-insert-btn';
  btn.setAttribute('data-reel-insert-at', String(insertAt));
  btn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    insertBlankSectionAt(ctx, insertAt);
  });
  return btn;
}

export function insertBlankSectionAt(ctx: EditorContext, insertAt: number): void {
  const page = ctx.currentPage();
  if (!page) return;
  const clampedAt = Math.max(0, Math.min(insertAt, page.sections.length));
  const section: CanvasSection = {
    id: newSectionId(),
    recipeId: 'feature-grid',
    name: 'Blank section',
    height: 640,
    elements: [],
  };
  page.sections.splice(clampedAt, 0, section);
  ctx.selectedSectionId = section.id;
  ctx.selectedElementId = null;
  ctx.renderAll();
  ctx.scheduleSave();
  ctx.setStatus('Section added', 'ok');
}

export function moveSectionToIndex(
  ctx: EditorContext,
  fromIdx: number,
  toIdx: number,
): void {
  const page = ctx.currentPage();
  if (!page) return;
  if (fromIdx < 0 || fromIdx >= page.sections.length) return;
  if (fromIdx === toIdx || fromIdx + 1 === toIdx) return;
  const section = page.sections[fromIdx]!;
  const adjustedTo = toIdx > fromIdx ? toIdx - 1 : toIdx;
  if (adjustedTo < 0 || adjustedTo > page.sections.length - 1) return;
  page.sections.splice(fromIdx, 1);
  page.sections.splice(adjustedTo, 0, section);
  ctx.renderAll();
  ctx.scheduleSave();
}

function buildReelRoleSlot(ctx: EditorContext, role: 'header' | 'footer'): HTMLButtonElement {
  const slot = document.createElement('button');
  slot.type = 'button';
  slot.className = 'reel-role-slot';
  slot.setAttribute('data-reel-role-slot', role);
  const label = role === 'header' ? 'Header' : 'Footer';
  slot.textContent = '+ Add ' + label;
  slot.addEventListener('click', () => {
    if (!ctx.state) return;
    // ADR 0059 — site-level slot position conveys role; no `role` field needed.
    const section: CanvasSection = {
      id: newSectionId(),
      recipeId: 'custom',
      name: label,
      height: role === 'header' ? 80 : 120,
      elements: [],
    };
    if (role === 'header') {
      ctx.state.header = section;
    } else {
      ctx.state.footer = section;
    }
    ctx.selectedSectionId = section.id;
    ctx.selectedElementId = null;
    ctx.captureForUndo();
    ctx.renderAll();
    ctx.scheduleSave();
    ctx.setStatus(label + ' added', 'ok');
  });
  return slot;
}

export function renderReelImpl(ctx: EditorContext): void {
  const reelEl = document.getElementById('canvas-reel');
  if (!reelEl) return;
  if (!ctx.isReelOpen) {
    reelEl.hidden = true;
    return;
  }
  reelEl.hidden = false;

  const page = ctx.currentPage();
  if (!page) return;
  if (!ctx.state) return;

  const body = reelEl.querySelector('.reel-body');
  if (!body) return;
  body.replaceChildren();

  const pageWidth = page.width;
  const isTile = ctx.reelViewMode === 'tile';
  const thumbW = isTile ? 288 : 64;

  // -- Site-level header tile or slot ------------------------------------
  if (ctx.state.header) {
    const headerSec = ctx.state.header;
    const hTile = document.createElement('div');
    hTile.className = isTile ? 'reel-tile' : 'reel-list-item';
    hTile.classList.add('reel-locked');
    hTile.setAttribute('data-reel-section', headerSec.id);

    const hThumb = buildSectionThumbnail(ctx, headerSec, pageWidth, thumbW);
    if (ctx.selectedSectionId === headerSec.id) {
      hThumb.setAttribute('data-reel-selected', 'true');
    }
    hTile.appendChild(hThumb);

    if (isTile) {
      const hLabel = document.createElement('div');
      hLabel.className = 'reel-tile-label';
      hLabel.textContent = 'Header — ' + (headerSec.name || headerSec.recipeId);
      hTile.appendChild(hLabel);
    } else {
      const hInfo = document.createElement('div');
      hInfo.className = 'reel-list-info';
      const hName = document.createElement('div');
      hName.className = 'reel-list-name';
      hName.textContent = 'Header — ' + (headerSec.name || 'Untitled');
      const hRecipe = document.createElement('div');
      hRecipe.className = 'reel-list-recipe';
      hRecipe.textContent = headerSec.recipeId;
      hInfo.appendChild(hName);
      hInfo.appendChild(hRecipe);
      hTile.appendChild(hInfo);
    }

    const headerId = headerSec.id;
    hTile.addEventListener('click', () => {
      ctx.selectSection(headerId);
    });

    body.appendChild(hTile);
  } else {
    body.appendChild(buildReelRoleSlot(ctx, 'header'));
  }

  // -- Body section tiles. ADR 0059 — page sections are never pinned;
  //    every tile gets an insert button before it and is draggable.
  for (let i = 0; i < page.sections.length; i++) {
    const section = page.sections[i]!;

    body.appendChild(buildReelInsertButton(ctx, i));

    const tile = document.createElement('div');
    tile.className = isTile ? 'reel-tile' : 'reel-list-item';
    tile.setAttribute('data-reel-section', section.id);
    tile.setAttribute('data-reel-index', String(i));

    const thumb = buildSectionThumbnail(ctx, section, pageWidth, thumbW);
    if (ctx.selectedSectionId === section.id) {
      thumb.setAttribute('data-reel-selected', 'true');
    }
    tile.appendChild(thumb);

    if (isTile) {
      const tLabel = document.createElement('div');
      tLabel.className = 'reel-tile-label';
      tLabel.textContent = section.name || section.recipeId;
      tile.appendChild(tLabel);
    } else {
      const tInfo = document.createElement('div');
      tInfo.className = 'reel-list-info';
      const tName = document.createElement('div');
      tName.className = 'reel-list-name';
      tName.textContent = section.name || 'Untitled';
      const tRecipe = document.createElement('div');
      tRecipe.className = 'reel-list-recipe';
      tRecipe.textContent = section.recipeId;
      tInfo.appendChild(tName);
      tInfo.appendChild(tRecipe);
      tile.appendChild(tInfo);
    }

    const sectionId = section.id;
    const idx = i;
    tile.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      beginReelDragImpl(ctx, sectionId, idx, ev);
    });

    body.appendChild(tile);
  }

  body.appendChild(buildReelInsertButton(ctx, page.sections.length));

  // -- Site-level footer tile or slot ------------------------------------
  if (ctx.state.footer) {
    const footerSec = ctx.state.footer;
    const fTile = document.createElement('div');
    fTile.className = isTile ? 'reel-tile' : 'reel-list-item';
    fTile.classList.add('reel-locked');
    fTile.setAttribute('data-reel-section', footerSec.id);

    const fThumb = buildSectionThumbnail(ctx, footerSec, pageWidth, thumbW);
    if (ctx.selectedSectionId === footerSec.id) {
      fThumb.setAttribute('data-reel-selected', 'true');
    }
    fTile.appendChild(fThumb);

    if (isTile) {
      const fLabel = document.createElement('div');
      fLabel.className = 'reel-tile-label';
      fLabel.textContent = 'Footer — ' + (footerSec.name || footerSec.recipeId);
      fTile.appendChild(fLabel);
    } else {
      const fInfo = document.createElement('div');
      fInfo.className = 'reel-list-info';
      const fName = document.createElement('div');
      fName.className = 'reel-list-name';
      fName.textContent = 'Footer — ' + (footerSec.name || 'Untitled');
      const fRecipe = document.createElement('div');
      fRecipe.className = 'reel-list-recipe';
      fRecipe.textContent = footerSec.recipeId;
      fInfo.appendChild(fName);
      fInfo.appendChild(fRecipe);
      fTile.appendChild(fInfo);
    }

    const footerId = footerSec.id;
    fTile.addEventListener('click', () => {
      ctx.selectSection(footerId);
    });

    body.appendChild(fTile);
  } else {
    body.appendChild(buildReelRoleSlot(ctx, 'footer'));
  }

  const tileBtn = reelEl.querySelector('[data-reel-view="tile"]');
  const listBtn = reelEl.querySelector('[data-reel-view="list"]');
  if (tileBtn) {
    tileBtn.setAttribute('aria-pressed', ctx.reelViewMode === 'tile' ? 'true' : 'false');
  }
  if (listBtn) {
    listBtn.setAttribute('aria-pressed', ctx.reelViewMode === 'list' ? 'true' : 'false');
  }
}

export function mountReel(ctx: EditorContext): void {
  const reelEl = document.createElement('aside');
  reelEl.id = 'canvas-reel';
  reelEl.hidden = true;

  const header = document.createElement('div');
  header.className = 'reel-header';
  const heading = document.createElement('h3');
  heading.textContent = 'Sections';
  header.appendChild(heading);

  const actions = document.createElement('div');
  actions.className = 'reel-header-actions';

  const tileBtn = document.createElement('button');
  tileBtn.type = 'button';
  tileBtn.textContent = 'Tile';
  tileBtn.setAttribute('data-reel-view', 'tile');
  tileBtn.setAttribute('aria-pressed', 'true');
  tileBtn.addEventListener('click', () => {
    ctx.reelViewMode = 'tile';
    ctx.renderReel();
  });
  actions.appendChild(tileBtn);

  const listBtn = document.createElement('button');
  listBtn.type = 'button';
  listBtn.textContent = 'List';
  listBtn.setAttribute('data-reel-view', 'list');
  listBtn.setAttribute('aria-pressed', 'false');
  listBtn.addEventListener('click', () => {
    ctx.reelViewMode = 'list';
    ctx.renderReel();
  });
  actions.appendChild(listBtn);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addBtn.setAttribute('aria-label', 'Add blank section');
  addBtn.addEventListener('click', () => {
    const page = ctx.currentPage();
    if (page) insertBlankSectionAt(ctx, page.sections.length);
  });
  actions.appendChild(addBtn);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'reel-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close film reel');
  closeBtn.addEventListener('click', () => {
    ctx.closeReel();
  });
  actions.appendChild(closeBtn);

  header.appendChild(actions);
  reelEl.appendChild(header);

  const body = document.createElement('div');
  body.className = 'reel-body';
  reelEl.appendChild(body);

  document.body.appendChild(reelEl);
}
