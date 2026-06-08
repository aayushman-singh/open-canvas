// src/editor-client/page-crud.ts
//
// ADR 0058 Phase 2q.c — page CRUD + page-crumb popover.
// canvas-client.ts:1959-2092 carries the inline twin for the UUID +
// page-crumb popover (uuid / newElementId already retired into ids.ts;
// the surviving inline twins are setActivePage, refreshPageCrumb,
// closePageCrumbMenu, onPageCrumbOutside, onPageCrumbKey,
// openPageCrumbMenu, attachPageCrumb).
//
// canvas-client.ts:2098-2308 carries the inline twin for the page CRUD
// cluster (findPageByHref, goToHrefOnCanvas, updatePageSidebar,
// createPage, renamePage, findActionPageLinkReferences, deletePage).
//
// Both ranges retire on the Phase 3 cutover. Behavioural parity is
// pinned by the existing editor smokes against the production inline
// path; this module ships no sibling smoke (bare Bun has no `document`).
//
// Exports take ctx first. ctx-method bind targets are suffixed `Impl`
// so createEditor (Phase 3) can wire them onto the ctx interface without
// renaming.
//
//   - setActivePageImpl(ctx, pageId) — flip ctx.activePageId, clear
//     selection state, re-render inspector + reel, sync sidebar, toggle
//     the per-artboard data-active attribute, refresh the crumb label.
//
//   - refreshPageCrumbImpl(ctx) — update the [data-page-crumb-label] text
//     to currentPage().title / .slug, or "page" when neither is set.
//
//   - closePageCrumbMenu(ctx) — remove the live crumb popover, drop the
//     outside-click + Escape listeners (the handlers must be the same
//     references that addEventListener received — kept on ctx so the
//     add/remove pair matches across calls).
//
//   - openPageCrumbMenu(ctx) — toggle. When a popover is already live,
//     close it; otherwise build the menu of all pages + mount it below
//     the crumb button, wired to setActivePage on click. Outside-click
//     + Escape close the popover.
//
//   - attachPageCrumbImpl(ctx) — wire the crumb button's click handler
//     once at boot and seed the label text.
//
//   - findPageByHref(ctx, href) — resolve a string href (e.g. "/about",
//     "/about#hero", "about") to a CanvasPage in the current state.
//     Returns null when the href is not internal or no page matches.
//
//   - goToHrefOnCanvasImpl(ctx, href) — drive editor navigation from a
//     clicked link: internal pages switch the active artboard,
//     external/mailto/tel open in a new tab, anchors no-op. Returns true
//     when the href was handled, false when the URL allowlist rejected it.
//
//   - updatePageSidebarImpl(ctx) — re-render the left-sidebar page list.
//     Each row carries a Rename button, an SEO link, and (when more than
//     one page exists) a Delete button.
//
//   - createPageImpl(ctx) — prompt for title/slug/locale, push a new page
//     with a blank starter section, capture for undo, activate it, fit
//     the viewport to it, schedule a save.
//
//   - renamePageImpl(ctx, pageId) — prompt for a new title, derive a slug
//     (rejects "_404"/"404", reserved for the dedicated custom-404 flow),
//     dedupe against existing slugs by appending -2/-3/..., capture for
//     undo, re-render, scheduleSave.
//
//   - findActionPageLinkReferences(ctx, pageId) — list every action
//     element whose href is {type:'page', pageId} together with a
//     "<container> / <action label>" label. Drives deletePage's
//     inbound-link guard.
//
//   - deletePageImpl(ctx, pageId) — refuse when the page is the only
//     page or when any action element links to it; otherwise confirm,
//     splice it out, re-render, schedule a save. The inbound-link guard
//     is a hard NO-DELETE — there is no rewrite-references fallback;
//     the Owner must repoint the action(s) first. This intentionally
//     differs from the chat-driven `kind:"deletePage"` op in
//     canvas-client.ts:10518+, which rewrites references to '#'.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { EditorContext } from './editor-context.js';
import type { CanvasPage } from '../canvas/schema.js';
import { isCustom404Page } from '../canvas/page-routing.js';
import { runCollectionScaffoldFlowImpl } from './collection-scaffold.js';
import { DEFAULT_PAGE_WIDTH_PX } from './editor-constants.js';
import { isAllowedHref } from './href-utils.js';
import { newPageId, newSectionId } from './ids.js';

export function setActivePageImpl(ctx: EditorContext, pageId: string | null): void {
  // ADR 0065 D6 — switching to a different page exits Collection
  // template-edit mode. The editing pin references a Collection on the
  // page we are leaving; carrying it onto a different page would either
  // leave the chrome anchored to an off-page wrapper or fail to find it
  // entirely. Clear the field BEFORE setting activePageId so the next
  // renderAll() (driven by the selection clears below) sees a coherent
  // state and the chrome strips cleanly.
  if (ctx.editingCollectionTemplate !== null) {
    ctx.exitCollectionTemplateEdit();
  }
  ctx.activePageId = pageId;
  // Route clears through the selection helpers so the DOM data-selected
  // attribute is scrubbed from every artboard's copy of a site-pinned
  // section. Direct null-assignment leaves stale highlights on header/
  // footer wrappers in the prior page, which then survive into the next
  // selectSection/selectElement call (the "remove prev" branch is skipped
  // because the model already reads null). Order: element first so its
  // re-entrancy into selectSection is a no-op.
  ctx.selectElement(null);
  ctx.selectSection(null);
  ctx.renderInspector();
  ctx.renderReel();

  ctx.updatePageSidebar();
  if (ctx.root) {
    const artboards = ctx.root.querySelectorAll('.opencanvas-artboard');
    for (let i = 0; i < artboards.length; i++) {
      const artboard = artboards[i];
      if (!artboard) continue;
      const isActive = artboard.getAttribute('data-page-id') === pageId;
      artboard.setAttribute('data-active', isActive ? 'true' : 'false');
    }
  }
  refreshPageCrumbImpl(ctx);
  // No camera pan on page activation — clicking an element on an inactive
  // artboard would otherwise trigger a 64px-inset pan as a side effect of
  // setActivePage, which was jarring (element clicks shouldn't move the
  // camera; the user already clicked the target, it's already on-screen).
  // panToPage remains exported from render.ts so explicit "Go to page"
  // callers (link-popover, alt+click action with page-href, etc.) can opt
  // back into pan later if needed.
}

// -- Breadcrumb page chip + page switcher dropdown ----------------------
// The header crumb renders 'Open Canvas / dashboard / {siteName} / {page}'.
// The page chip is a button — clicking it opens a popover listing every
// page in the site; picking one calls setActivePage. The label text is
// refreshed inside setActivePage so it always reflects activePageId.

export function refreshPageCrumbImpl(ctx: EditorContext): void {
  void ctx;
  const label = document.querySelector('[data-page-crumb-label]');
  if (!label) return;
  const page = ctx.currentPage();
  if (page) {
    label.textContent = page.title || page.slug || 'page';
  } else {
    label.textContent = 'page';
  }
}

export function closePageCrumbMenu(ctx: EditorContext): void {
  if (!ctx.pageCrumbMenu) return;
  if (ctx.pageCrumbMenu.parentNode) {
    ctx.pageCrumbMenu.parentNode.removeChild(ctx.pageCrumbMenu);
  }
  ctx.pageCrumbMenu = null;
  const btn = document.getElementById('canvas-page-crumb');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (ctx.pageCrumbOutsideHandler) {
    document.removeEventListener('mousedown', ctx.pageCrumbOutsideHandler, true);
  }
  if (ctx.pageCrumbKeyHandler) {
    document.removeEventListener('keydown', ctx.pageCrumbKeyHandler, true);
  }
}

export function openPageCrumbMenu(ctx: EditorContext): void {
  if (ctx.pageCrumbMenu) {
    closePageCrumbMenu(ctx);
    return;
  }
  if (!ctx.state || !Array.isArray(ctx.state.pages) || ctx.state.pages.length === 0) return;
  const btn = document.getElementById('canvas-page-crumb');
  if (!btn) return;
  const menu = document.createElement('div');
  menu.className = 'opencanvas-crumb-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Pages');
  for (let i = 0; i < ctx.state.pages.length; i++) {
    const p = ctx.state.pages[i];
    if (!p) continue;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'opencanvas-crumb-menu-item';
    item.setAttribute('role', 'menuitem');
    if (p.id === ctx.activePageId) item.classList.add('active');
    const title = document.createElement('span');
    title.className = 'opencanvas-crumb-menu-title';
    title.textContent = p.title || p.slug || 'page';
    const slug = document.createElement('span');
    slug.className = 'opencanvas-crumb-menu-slug';
    slug.textContent = '/' + (p.slug || '');
    item.appendChild(title);
    item.appendChild(slug);
    const pageId = p.id;
    item.addEventListener('click', () => {
      closePageCrumbMenu(ctx);
      setActivePageImpl(ctx, pageId);
      // Breadcrumb page-switcher pick = explicit navigation. Pan so the
      // target page lands in view; setActivePage is camera-pure.
      ctx.panToPage(pageId);
    });
    menu.appendChild(item);
  }
  document.body.appendChild(menu);
  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = rect.bottom + 4 + 'px';
  menu.style.left = Math.max(8, rect.left) + 'px';
  menu.style.minWidth = Math.max(200, rect.width) + 'px';
  ctx.pageCrumbMenu = menu;
  btn.setAttribute('aria-expanded', 'true');

  // Outside-click + Escape close the popover. Handlers MUST be the same
  // references the matching removeEventListener calls receive, so we
  // store them on ctx — re-deriving them per open would leak listeners.
  if (!ctx.pageCrumbOutsideHandler) {
    ctx.pageCrumbOutsideHandler = (ev: Event): void => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (!target) return;
      if (ctx.pageCrumbMenu && ctx.pageCrumbMenu.contains(target)) return;
      if (target.closest('#canvas-page-crumb')) return;
      closePageCrumbMenu(ctx);
    };
  }
  if (!ctx.pageCrumbKeyHandler) {
    ctx.pageCrumbKeyHandler = (ev: Event): void => {
      if (ev instanceof KeyboardEvent && ev.key === 'Escape') {
        ev.preventDefault();
        closePageCrumbMenu(ctx);
      }
    };
  }
  document.addEventListener('mousedown', ctx.pageCrumbOutsideHandler, true);
  document.addEventListener('keydown', ctx.pageCrumbKeyHandler, true);
}

export function attachPageCrumbImpl(ctx: EditorContext): void {
  const btn = document.getElementById('canvas-page-crumb');
  if (!btn) return;
  btn.addEventListener('click', (ev: Event) => {
    ev.preventDefault();
    openPageCrumbMenu(ctx);
  });
  refreshPageCrumbImpl(ctx);
}

export function attachHomeCrumbImpl(ctx: EditorContext): void {
  const btn = document.getElementById('canvas-home-crumb');
  if (!btn) return;
  btn.addEventListener('click', (ev: Event) => {
    ev.preventDefault();
    if (!ctx.state || !Array.isArray(ctx.state.pages) || ctx.state.pages.length === 0) {
      ctx.setStatus('No pages in this site — cannot go to home page', 'error');
      return;
    }
    const home = ctx.state.pages.find((p) => p && !isCustom404Page(p));
    if (!home) {
      ctx.setStatus('No primary page found (every page is _404)', 'error');
      return;
    }
    setActivePageImpl(ctx, home.id);
    // Logo click "go home" = explicit navigation. Pan so home lands in
    // view; setActivePage is camera-pure.
    ctx.panToPage(home.id);
  });
}

// Resolve a string href (e.g. "/about", "/about#hero", "about") to a Canvas
// Page in the current site state. Returns null when the href is not internal
// or no page matches. Strips query + fragment so an Owner-stored "/about#x"
// still resolves to the about page.
export function findPageByHref(ctx: EditorContext, href: unknown): CanvasPage | null {
  if (typeof href !== 'string' || href.length === 0) return null;
  if (!ctx.state || !Array.isArray(ctx.state.pages)) return null;
  if (href.charAt(0) === '#') return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let path = href.split('#')[0]?.split('?')[0] ?? '';
  if (path.charAt(0) === '/') path = path.slice(1);
  while (path.length > 1 && path.charAt(path.length - 1) === '/') {
    path = path.slice(0, -1);
  }
  for (let i = 0; i < ctx.state.pages.length; i++) {
    const page = ctx.state.pages[i];
    if (page && page.slug === path) return page;
  }
  return null;
}

// Drive editor navigation from a clicked link: internal pages switch the
// active artboard, external/mailto/tel open in a new tab, anchors no-op
// (the editor renders the full page; in-page anchors have no meaning here).
// Returns true when something was handled, false when the href was rejected
// by the allowlist — caller can surface a status message.
export function goToHrefOnCanvasImpl(ctx: EditorContext, href: unknown): boolean {
  const page = findPageByHref(ctx, href);
  if (page) {
    setActivePageImpl(ctx, page.id);
    // goToHrefOnCanvas is the generic "navigate to this internal href"
    // entry point — chat-suggestion cards, AI nav ops, etc. Always
    // explicit user navigation, so pan to bring the target into view.
    ctx.panToPage(page.id);
    return true;
  }
  if (typeof href === 'string' && href.charAt(0) === '#') return true;
  if (typeof href === 'string' && isAllowedHref(href)) {
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
  }
  return false;
}

export function openPageSeoAfterSave(ctx: EditorContext, seoHref: string): void {
  const opened = window.open('about:blank', '_blank');
  if (!opened) {
    ctx.setStatus('Could not open SEO panel: popup blocked', 'error');
    return;
  }
  opened.opener = null;
  void (async () => {
    const saved = await ctx.flushPendingSave();
    if (!saved) {
      opened.close();
      return;
    }
    opened.location.href = seoHref;
  })();
}

export function updatePageSidebarImpl(ctx: EditorContext): void {
  const listEl = document.getElementById('canvas-page-list');
  if (!listEl || !ctx.state) return;
  listEl.replaceChildren();

  for (let i = 0; i < ctx.state.pages.length; i++) {
    const page = ctx.state.pages[i];
    if (!page) continue;
    const item = document.createElement('div');
    item.className = 'opencanvas-page-item';
    item.setAttribute('data-page-id', page.id);
    item.setAttribute('data-active', page.id === ctx.activePageId ? 'true' : 'false');

    const title = document.createElement('span');
    title.className = 'opencanvas-page-item-title';
    title.textContent = page.title;
    item.appendChild(title);

    const slug = document.createElement('span');
    slug.className = 'opencanvas-page-item-slug';
    slug.textContent = '/' + page.slug;
    item.appendChild(slug);

    const actions = document.createElement('span');
    actions.className = 'opencanvas-page-item-actions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.textContent = 'Rename';
    renameBtn.setAttribute('data-page-action', 'rename');
    renameBtn.setAttribute('data-page-id', page.id);
    actions.appendChild(renameBtn);

    const seoLink = document.createElement('a');
    seoLink.textContent = 'SEO';
    const seoHref = '/dashboard/sites/' + ctx.siteId + '/pages/' + page.id + '/seo';
    seoLink.href = seoHref;
    seoLink.target = '_blank';
    seoLink.rel = 'noopener noreferrer';
    seoLink.className = 'opencanvas-page-seo-link';
    // Newly-created pages live only in `ctx.state` until the debounced save
    // commits. Opening the dashboard panel in a fresh tab reads from Neon, so
    // an unflushed local page lookup returns null and the route 404s. Flush
    // first; on failure flushPendingSave already surfaces the status and we
    // skip the navigation instead of opening a guaranteed-broken tab.
    const handleSeoLinkActivation = (ev: MouseEvent) => {
      if (ev.type === 'click' && ev.button !== 0) return;
      if (ev.type === 'auxclick' && ev.button !== 1) return;
      ev.preventDefault();
      openPageSeoAfterSave(ctx, seoHref);
    };
    seoLink.addEventListener('click', handleSeoLinkActivation);
    seoLink.addEventListener('auxclick', handleSeoLinkActivation);
    actions.appendChild(seoLink);

    if (ctx.state.pages.length > 1) {
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.textContent = 'Del';
      deleteBtn.setAttribute('data-page-action', 'delete');
      deleteBtn.setAttribute('data-page-id', page.id);
      deleteBtn.setAttribute('data-danger', 'true');
      actions.appendChild(deleteBtn);
    }

    item.appendChild(actions);
    listEl.appendChild(item);
  }
}

export async function createPageImpl(ctx: EditorContext): Promise<void> {
  if (!ctx.state) return;
  const result = await ctx.openNewPageModal({
    existingSlugs: ctx.state.pages.map((p) => p.slug),
  });
  if (!result) return;
  // The modal hosts a kind selector (regular vs. collection) — picking
  // Collection chains into the scaffold wizard which opens its own slug
  // prompt and POSTs the multi-page index + template + seed-entries
  // scaffold. The regular path stays in-process: create a single page
  // with a blank starter section and switch the active page to it.
  if (result.kind === 'collection') {
    await runCollectionScaffoldFlowImpl(ctx);
    return;
  }
  if (result.kind !== 'regular') {
    // Fail loudly per CLAUDE.md no-fallbacks: an unknown discriminator
    // is a contract bug, not a value to default away.
    throw new Error(
      'createPageImpl: unexpected modal result kind ' + JSON.stringify(result.kind),
    );
  }
  // exactOptionalPropertyTypes: assemble the optional `locale` conditionally
  // so the object literal never carries `locale: undefined` (forbidden).
  const newPage: CanvasPage = {
    id: newPageId(),
    slug: result.slug,
    title: result.title,
    width: DEFAULT_PAGE_WIDTH_PX,
    sections: [
      {
        id: newSectionId(),
        recipeId: 'feature-grid',
        name: 'Blank section',
        height: 640,
        elements: [],
      },
    ],
  };
  if (result.locale !== null) newPage.locale = result.locale;
  ctx.state.pages.push(newPage);
  ctx.captureForUndo();
  setActivePageImpl(ctx, newPage.id);
  ctx.renderAll();
  ctx.fitToPage(newPage.id);
  ctx.scheduleSave();
  ctx.setStatus('Page created: ' + newPage.title, 'ok');
}

export async function renamePageImpl(ctx: EditorContext, pageId: string): Promise<void> {
  if (!ctx.state) return;
  let page: CanvasPage | null = null;
  for (let i = 0; i < ctx.state.pages.length; i++) {
    const candidate = ctx.state.pages[i];
    if (candidate && candidate.id === pageId) {
      page = candidate;
      break;
    }
  }
  if (!page) return;
  const promptedTitle = await ctx.openTextModal({
    title: 'Rename page',
    label: 'Page title',
    defaultValue: page.title,
  });
  if (!promptedTitle || promptedTitle.trim().length === 0) return;
  const newTitle = promptedTitle.trim();
  let newSlug = newTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (newSlug.length === 0) newSlug = 'page';
  // _404 is reserved for the optional custom 404 page (src/canvas/page-routing.ts).
  // 404 is what the normaliser produces when someone types '_404' as a title; block
  // both so the dedicated custom-404 flow stays the only way in.
  if (newSlug === '_404' || newSlug === '404') {
    ctx.setStatus("Slug '" + newSlug + "' is reserved for the custom 404 page", 'error');
    return;
  }
  page.title = newTitle;
  const slugBase = newSlug;
  let counter = 2;
  const finalPage = page;
  while (ctx.state.pages.some((p) => p.id !== pageId && p.slug === newSlug)) {
    newSlug = slugBase + '-' + counter;
    counter++;
  }
  finalPage.slug = newSlug;
  ctx.captureForUndo();
  ctx.renderAll();
  ctx.updatePageSidebar();
  ctx.scheduleSave();
  ctx.setStatus('Renamed to: ' + newTitle, 'ok');
}

export function findActionPageLinkReferences(ctx: EditorContext, pageId: string): string[] {
  const refs: string[] = [];
  function scanElements(elements: unknown[] | null | undefined, label: string): void {
    if (!Array.isArray(elements)) return;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i] as {
        type?: string;
        id?: string;
        href?: { type?: string; pageId?: string } | null;
        label?: Array<{ text?: string }>;
        tabs?: Array<{ elements?: unknown[] }>;
        entries?: unknown[][];
      };
      if (el.type === 'action' && el.href && el.href.type === 'page' && el.href.pageId === pageId) {
        let actionLabelText = '';
        const runs = Array.isArray(el.label) ? el.label : [];
        for (let ri = 0; ri < runs.length; ri++) {
          const run = runs[ri];
          actionLabelText += run?.text ?? '';
        }
        refs.push(label + ' / ' + (actionLabelText || el.id || ''));
      }
      if (el.type === 'tabs' && Array.isArray(el.tabs)) {
        for (let ti = 0; ti < el.tabs.length; ti++) {
          scanElements(el.tabs[ti]?.elements, label);
        }
      } else if (el.type === 'collection' && Array.isArray(el.entries)) {
        for (let ei = 0; ei < el.entries.length; ei++) {
          scanElements(el.entries[ei], label);
        }
      }
    }
  }
  function scanSection(section: { elements?: unknown[] } | null | undefined, label: string): void {
    scanElements(section?.elements, label);
  }
  if (!ctx.state) return refs;
  for (let pageIdx = 0; pageIdx < ctx.state.pages.length; pageIdx++) {
    const page = ctx.state.pages[pageIdx];
    if (!page) continue;
    for (let sectionIdx = 0; sectionIdx < page.sections.length; sectionIdx++) {
      const section = page.sections[sectionIdx];
      if (!section) continue;
      scanSection(section, page.title + ' / ' + section.name);
    }
  }
  scanSection(ctx.state.header, 'Header');
  scanSection(ctx.state.footer, 'Footer');
  return refs;
}

export async function deletePageImpl(ctx: EditorContext, pageId: string): Promise<void> {
  if (!ctx.state || ctx.state.pages.length <= 1) return;
  let idx = -1;
  for (let i = 0; i < ctx.state.pages.length; i++) {
    const candidate = ctx.state.pages[i];
    if (candidate && candidate.id === pageId) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return;
  const target = ctx.state.pages[idx];
  if (!target) return;
  const inboundPageLinks = findActionPageLinkReferences(ctx, pageId);
  if (inboundPageLinks.length > 0) {
    ctx.setStatus('Delete blocked: page is linked from ' + inboundPageLinks[0], 'error');
    return;
  }
  const confirmed = await ctx.openConfirmModal({
    title: 'Delete page',
    message: 'Delete page "' + target.title + '"? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  ctx.state.pages.splice(idx, 1);
  ctx.captureForUndo();
  if (ctx.activePageId === pageId) {
    const fallback = ctx.state.pages[0];
    ctx.activePageId = fallback ? fallback.id : null;
  }
  ctx.renderAll();
  ctx.updatePageSidebar();
  ctx.fitAllPages();
  ctx.scheduleSave();
  ctx.setStatus('Page deleted', 'ok');
}
