// src/editor-client/section-toolbar.ts
//
// ADR 0058 Phase 2j — section toolbar + section-level orchestration.
// canvas-client.ts:11480-11820 carries the inline twins:
//   :11482-11493  nextZInArray / nextZ (z-stack helpers — pure, reused
//                  from ./z-order.ts in the extracted module)
//   :11495-11509  defaultBox (initial-box layout for new elements)
//   :11511-11527  addElementToSection (push + render + pan + save)
//   :11536-11564  targetSectionForSidebar (resolve the section under the
//                  cursor / explicit selection / first body / first)
//   :11568-11589  panToElement (camera helper used by addElementToSection
//                  so freshly-inserted elements land centred in the viewport)
//   :11591-11611  addBlankSectionFromSidebar
//   :11616-11619  componentActionForSidebar
//   :11621-11633  addComponentFromSidebar
//   :11635-11721  handleSectionAction (the central toolbar dispatcher:
//                  delete / duplicate / move-up / move-down / add-X /
//                  save-to-library, with header/footer pinning rules)
//   :11725-11770  saveToLibrary (POST /library/sections, three-modal flow)
//   :11774-11820  saveSiteAsTemplate (POST /custom-templates, three-modal flow)
//
// Twins retire on ADR 0015 Phase 3 atomic cutover; until then, the
// inline IIFE is the production source-of-truth and this module is
// dead code — Phase 3 binds these Impl exports onto ctx and the inline
// twins disappear in one atomic commit.
//
// Nine exports map 1:1 onto Phase 2j's ctx fields:
//
//   - defaultBoxImpl(ctx, section, w, h) — compute the (x,y,w,h,z) box
//     for a freshly-inserted element. Throws when no page is active —
//     a null page here means the caller fed us a section that no longer
//     belongs to state, so we fail loudly rather than invent geometry.
//     Bound: ctx.defaultBox = (section, w, h) => defaultBoxImpl(ctx, section, w, h).
//
//   - addElementToSectionImpl(ctx, section, element) — push the element
//     into section.elements, applying the page's defaultMotionPreset
//     when the element has none of its own, then renderAll / select /
//     pan / scheduleSave. The motion default is what lets the Owner
//     set "fade-in" once on the page and have every fresh element pick
//     it up without per-element wiring.
//
//   - targetSectionForSidebarImpl(ctx) — the four-tier resolution chain
//     for "where does a sidebar drop-in land": explicit selection →
//     viewport-centre hit-test → first body section → first section of
//     any kind. The hit-test reads document.elementFromPoint against the
//     viewport centre so adding a hero element while the user is scrolled
//     to the footer doesn't dump it three screens up.
//
//   - panToElementImpl(ctx, elementId) — centre the camera on the named
//     element by walking page → section → element world coords. No-op if
//     anything in the lookup chain is missing (page, section, element,
//     viewport) — addElementToSection calls this unconditionally after
//     insert, so swallowing the missing-element case keeps the insert
//     happy when the element lives outside the current page.
//
//   - addBlankSectionFromSidebarImpl(ctx) — insert a fresh "Blank section"
//     after the active section selection (or at the end of the page when
//     no section is selected), then select it. Index is clamp-tested
//     against header/footer pins so the new section can't slot in front
//     of the header or after the footer.
//
//   - componentActionForSidebar(component) — pure: map a sidebar
//     component key ("text", "media", …) to the matching "add-X" action
//     string handleSectionAction recognises, or null when the key isn't
//     in SIDEBAR_COMMANDS. The ADR 0011 Step 3 dispatch model means
//     adding a sidebar command also auto-registers an action key. Bound
//     directly: ctx.componentActionForSidebar = componentActionForSidebar.
//
//   - addComponentFromSidebarImpl(ctx, component) — dispatch a sidebar
//     drop-in: pick a target section, resolve the action key, route
//     through ctx.handleSectionAction. Status-bar errors surface "Add a
//     section first" / "Unknown component" so a regression in the
//     dispatch table is visible to the Owner immediately.
//
//   - handleSectionActionImpl(ctx, action, sectionId) — the central
//     section toolbar dispatcher. Branches on action: "add-<key>" routes
//     through ctx.insertElementForSidebarCommand; "duplicate-section",
//     "delete-section", "move-up", "move-down" mutate the page's section
//     array with header/footer pinning rules; "save-to-library" fires
//     and forgets via void ctx.saveToLibrary. Header/footer "delete"
//     paths are handled before the page lookup so site-level deletes
//     don't fall through to the page-section branch.
//
//   - saveToLibraryImpl(ctx, section) — three-modal flow (name, optional
//     description, visibility) then POST to /library/sections. Clears
//     ctx.sectionsCatalog on success so the next picker open re-fetches.
//     Errors are loud — every failure path writes a "Save failed: …"
//     status line; no silent swallows. The error narrowing matches
//     ai-integration.ts / chat-session.ts: catch (err: unknown) routed
//     through errorToString().
//
//   - saveSiteAsTemplateImpl(ctx) — three-modal flow (name, description,
//     visibility) then POST to /custom-templates. Same error narrowing
//     contract as saveToLibrary; refuses empty names with a status line
//     instead of POSTing.
//
// Pure helpers reused from siblings:
//   - nextZInArray / nextZ are already in ./z-order.ts (Phase 2d). The
//     inline twins at canvas-client.ts:11482-11493 are byte-identical
//     to z-order.ts's nextZInArray; the extracted module just imports.
//     (Phase 2d). Pure imports — no ctx forward decl needed.
//   - newElementId / newSectionId live in ./ids.ts (Phase 2c). Pure imports.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet. Per ADR 0058
// Decision 1, each export reads as `s/<closure-var>/ctx.<closure-var>/g`
// against the inline twin.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { applyCameraTransform } from './render.js';
import { newElementId, newSectionId } from './ids.js';
import { nextZInArray } from './z-order.js';

/**
 * Inline IIFE twin reads `err.message || String(err)` — untyped JS. The
 * extracted module catches err as `unknown` (no declared shape on the
 * promise reject branch) and routes it through this helper so member
 * access is narrowed first. Mirrors ai-integration.ts / chat-session.ts's
 * same-named helper so the inline twin's surface is preserved verbatim.
 */
function errorToString(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown';
}

/**
 * Pure helper: same as nextZInArray but reading section.elements. Kept
 * private because the only caller is defaultBoxImpl below; the inline
 * twin promotes it to a closure-level fn so component factories that
 * forgot to import nextZInArray have a shortcut. The extracted module
 * has no equivalent need — z-order.ts owns nextZInArray and defaultBox
 * is the only call site.
 */
function nextZ(section: CanvasSection): number {
  return nextZInArray(section.elements);
}

export function defaultBoxImpl(
  ctx: EditorContext,
  section: CanvasSection,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number; z: number } {
  const page = ctx.currentPage();
  // defaultBox is only reachable via addElement* paths that resolve a
  // section first (targetSectionForSidebar / addBlankSectionFromSidebar /
  // direct selection), and every section lives inside a page. A null page
  // here means the caller fed us a section that no longer belongs to any
  // page in state — fail loudly instead of silently inventing a width.
  if (!page) throw new Error('defaultBox: no current page; section/page state out of sync');
  const pageWidth = page.width;
  let width = w;
  let height = h;
  if (width > pageWidth) width = pageWidth - 40;
  if (height > section.height) height = section.height - 40;
  return { x: 40, y: 40, w: width, h: height, z: nextZ(section) };
}

export function addElementToSectionImpl(
  ctx: EditorContext,
  section: CanvasSection,
  element: CanvasElement,
): void {
  // Apply page default motion if the element has no motion set.
  if (!element.motion) {
    const pg = ctx.currentPage();
    if (pg && pg.defaultMotionPreset && pg.defaultMotionPreset !== 'none') {
      element.motion = { preset: pg.defaultMotionPreset, delayMs: 0 };
    }
  }
  section.elements.push(element);
  ctx.renderAll();
  ctx.selectElement(element.id);
  // Pan the camera so the freshly-inserted element is centred in the
  // viewport — without this, an element added far from the current scroll
  // (e.g. footer when user is at the hero) appears off-screen.
  ctx.panToElement(element.id);
  ctx.scheduleSave();
}

// Pick the section the user is currently looking at, so newly-added
// elements land where the cursor is — not in the page footer.
// Priority:
//   1. Explicitly-selected section.
//   2. The section under the viewport centre (what the user is editing).
//   3. The first body section (skip pinned header/footer roles).
//   4. The first section of any kind.
export function targetSectionForSidebarImpl(ctx: EditorContext): CanvasSection | null {
  const page = ctx.currentPage();
  if (!page || !Array.isArray(page.sections) || page.sections.length === 0) return null;
  if (ctx.selectedSectionId) {
    const selected = ctx.findSection(ctx.selectedSectionId);
    if (selected) return selected;
  }
  if (ctx.viewport) {
    const vRect = ctx.viewport.getBoundingClientRect();
    const cx = vRect.left + vRect.width / 2;
    const cy = vRect.top + vRect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit instanceof Element) {
      const secNode = hit.closest('.opencanvas-section');
      if (secNode) {
        const sid = secNode.getAttribute('data-opencanvas-section');
        if (sid) {
          const hitSection = ctx.findSection(sid);
          if (hitSection) return hitSection;
        }
      }
    }
  }
  for (let i = 0; i < page.sections.length; i++) {
    const candidate = page.sections[i];
    if (!candidate) continue;
    const role = candidate.role || 'body';
    if (role === 'body') return candidate;
  }
  return page.sections[0] ?? null;
}

// Centre the camera on an element's world position. No-op if anything in
// the lookup chain is missing (page/section/element/viewport).
export function panToElementImpl(ctx: EditorContext, elementId: string): void {
  if (!ctx.viewport) return;
  const found = ctx.findElement(elementId);
  if (!found) return;
  const page = ctx.currentPage();
  if (!page) return;
  const pos = ctx.getPagePosition(page.id);
  if (!pos) return;
  let sectionY = pos.y;
  if (ctx.state && ctx.state.header) sectionY += ctx.state.header.height || 0;
  for (let i = 0; i < page.sections.length; i++) {
    const sec = page.sections[i];
    if (!sec) continue;
    if (sec.id === found.section.id) break;
    sectionY += sec.height || 0;
  }
  const box = found.element.box;
  const worldX = pos.x + box.x + box.w / 2;
  const worldY = sectionY + box.y + box.h / 2;
  const rect = ctx.viewport.getBoundingClientRect();
  ctx.camera.x = rect.width / 2 - worldX * ctx.camera.zoom;
  ctx.camera.y = rect.height / 2 - worldY * ctx.camera.zoom;
  applyCameraTransform(ctx);
}

export function addBlankSectionFromSidebarImpl(ctx: EditorContext): void {
  const page = ctx.currentPage();
  if (!page) return;
  const section: CanvasSection = {
    id: newSectionId(),
    recipeId: 'feature-grid',
    name: 'Blank section',
    height: 640,
    elements: [],
  };
  const selectedIndex = ctx.selectedSectionId
    ? page.sections.findIndex((candidate) => candidate.id === ctx.selectedSectionId)
    : -1;
  const raw = selectedIndex >= 0 ? selectedIndex + 1 : page.sections.length;
  const insertAt = Math.max(0, Math.min(raw, page.sections.length));
  page.sections.splice(insertAt, 0, section);
  ctx.selectedSectionId = section.id;
  ctx.selectedElementId = null;
  ctx.renderAll();
  ctx.scheduleSave();
  ctx.setStatus('Section added', 'ok');
}

// Sidebar drop-in keys are sourced from SIDEBAR_DISPATCH; "add-X" is the
// canonical section-action string (matches buildSectionToolbar's data
// attribute + handleSectionAction's branch lookup).
export function componentActionForSidebar(
  ctx: EditorContext,
  component: string,
): string | null {
  if (!ctx.SIDEBAR_COMMANDS[component]) return null;
  return 'add-' + component;
}

export function addComponentFromSidebarImpl(ctx: EditorContext, component: string): void {
  const section = ctx.targetSectionForSidebar();
  if (!section) {
    ctx.setStatus('Add a section first', 'error');
    return;
  }
  const action = ctx.componentActionForSidebar(component);
  if (!action) {
    ctx.setStatus('Unknown component: ' + component, 'error');
    return;
  }
  ctx.handleSectionAction(action, section.id);
}

export function handleSectionActionImpl(
  ctx: EditorContext,
  action: string,
  sectionId: string,
): void {
  const state = ctx.state;
  if (!state) return;
  // Handle site-level header/footer delete before page lookup
  if (action === 'delete-section') {
    if (state.header && state.header.id === sectionId) {
      // EOP forbids `state.header = undefined` (bare `header?: CanvasSection`
      // in the schema), so use `delete` to clear. Semantically identical to
      // the inline twin's assignment given the schema's `?:` typing — every
      // downstream presence check is `if (state.header)`, not a strict
      // `!== undefined` discriminator.
      delete state.header;
      ctx.selectedSectionId = null;
      ctx.selectedElementId = null;
      ctx.captureForUndo();
      ctx.renderAll();
      ctx.scheduleSave();
      ctx.setStatus('Header removed', 'ok');
      return;
    }
    if (state.footer && state.footer.id === sectionId) {
      delete state.footer;
      ctx.selectedSectionId = null;
      ctx.selectedElementId = null;
      ctx.captureForUndo();
      ctx.renderAll();
      ctx.scheduleSave();
      ctx.setStatus('Footer removed', 'ok');
      return;
    }
  }
  // For add-* actions on site-level header/footer, resolve the section
  let siteSection: CanvasSection | null = null;
  if (state.header && state.header.id === sectionId) siteSection = state.header;
  if (state.footer && state.footer.id === sectionId) siteSection = state.footer;
  if (siteSection && action.indexOf('add-') === 0) {
    // Delegate add-element actions to the site-level section
  }
  const page = ctx.currentPage();
  if (!page) return;
  const idx = page.sections.findIndex(function (s) {
    return s.id === sectionId;
  });
  if (idx < 0 && !siteSection) return;
  const section = siteSection || page.sections[idx];
  if (!section) return;

  // "add-X" routes through SIDEBAR_DISPATCH + SIDEBAR_FACTORIES (ADR 0011
  // Step 3). The previous 14-arm switch is gone; each per-element module
  // owns its sidebar metadata and the canvas-client owns the matching
  // factory closure. The sidebar-dispatch:smoke verifies every spec
  // factoryName has a registered factory above.
  if (action.indexOf('add-') === 0 && ctx.SIDEBAR_COMMANDS[action.slice(4)]) {
    ctx.insertElementForSidebarCommand(section, action.slice(4));
  } else if (action === 'duplicate-section') {
    const copy = JSON.parse(JSON.stringify(section)) as CanvasSection;
    copy.id = newSectionId();
    copy.name = section.name + ' copy';
    delete copy.role;
    for (const el of copy.elements) {
      el.id = newElementId();
    }
    page.sections.splice(idx + 1, 0, copy);
    ctx.renderAll();
    ctx.selectSection(copy.id);
    ctx.scheduleSave();
  } else if (action === 'delete-section') {
    if (page.sections.length <= 1) {
      ctx.setStatus("Can't delete the last section", 'error');
      return;
    }
    page.sections.splice(idx, 1);
    ctx.selectedSectionId = null;
    ctx.selectedElementId = null;
    ctx.renderAll();
    ctx.scheduleSave();
  } else if (action === 'move-up') {
    if (idx === 0) return;
    const prev = page.sections[idx - 1];
    if (!prev) return;
    page.sections[idx - 1] = section;
    page.sections[idx] = prev;
    ctx.renderAll();
    ctx.scheduleSave();
  } else if (action === 'move-down') {
    if (idx >= page.sections.length - 1) return;
    const next = page.sections[idx + 1];
    if (!next) return;
    page.sections[idx + 1] = section;
    page.sections[idx] = next;
    ctx.renderAll();
    ctx.scheduleSave();
  } else if (action === 'save-to-library') {
    void ctx.saveToLibrary(section);
  }
}

// -- Save section to library ---------------------------------------------

export async function saveToLibraryImpl(
  ctx: EditorContext,
  section: CanvasSection,
): Promise<void> {
  let name = await ctx.openTextModal({
    title: 'Save to library',
    label: 'Section name',
    defaultValue: section.name || '',
  });
  if (name === null) return;
  if (name.trim().length === 0) name = section.name || 'Untitled';
  const description = await ctx.openTextModal({
    title: 'Save to library',
    label: 'Description (optional)',
    defaultValue: '',
  });
  if (description === null) return;
  const visibility = await ctx.openSelectModal({
    title: 'Save to library',
    label: 'Where can this section be reused?',
    options: [
      { value: 'private', label: 'Private — only my sites' },
      { value: 'global', label: 'Community — shared with everyone' },
    ],
    defaultValue: 'private',
  });
  if (visibility === null) return;
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) return;
    ctx.setStatus('Saving section to library...', 'ok');
    const response = await ctx.authFetch(ctx.apiBase + '/library/sections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: ctx.siteId,
        sectionId: section.id,
        name: name.trim(),
        description: description.trim(),
        visibility: visibility,
      }),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { error?: string } | null;
        if (body && body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      ctx.setStatus('Save failed: ' + detail, 'error');
      return;
    }
    ctx.sectionsCatalog = null;
    ctx.setStatus('Section saved to library', 'ok');
  } catch (err: unknown) {
    ctx.setStatus('Save failed: ' + errorToString(err), 'error');
  }
}

// -- Save site as template -----------------------------------------------

export async function saveSiteAsTemplateImpl(ctx: EditorContext): Promise<void> {
  const firstPageTitle =
    ctx.state && ctx.state.pages && ctx.state.pages[0] ? ctx.state.pages[0].title : '';
  const name = await ctx.openTextModal({
    title: 'Save as template',
    label: 'Template name',
    defaultValue: firstPageTitle,
  });
  if (name === null) return;
  if (name.trim().length === 0) {
    ctx.setStatus('Template name is required', 'error');
    return;
  }
  const tagline = await ctx.openTextModal({
    title: 'Save as template',
    label: 'Description',
    defaultValue: '',
  });
  if (tagline === null) return;
  const visibility = await ctx.openSelectModal({
    title: 'Save as template',
    label: 'Who can use this template?',
    options: [
      { value: 'private', label: 'Private — only me' },
      { value: 'global', label: 'Community — anyone on Open Canvas' },
    ],
    defaultValue: 'private',
  });
  if (visibility === null) return;
  try {
    const saved = await ctx.flushPendingSave();
    if (!saved) return;
    ctx.setStatus('Saving as template...', 'ok');
    const response = await ctx.authFetch(ctx.apiBase + '/custom-templates', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: ctx.siteId,
        name: name.trim(),
        tagline: tagline.trim(),
        visibility: visibility,
      }),
    });
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const body = (await response.json()) as { error?: string } | null;
        if (body && body.error) detail = body.error;
      } catch {
        /* ignore */
      }
      ctx.setStatus('Save as template failed: ' + detail, 'error');
      return;
    }
    ctx.setStatus('Saved as template', 'ok');
  } catch (err: unknown) {
    ctx.setStatus('Save as template failed: ' + errorToString(err), 'error');
  }
}
