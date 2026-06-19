// src/editor-client/element-menu.ts
//
// ADR 0058 Phase 2q.d — element context menu (3-dot, top-left on hover)
// + per-element wrapper builder + rebuildElement re-render. Extracted from
// canvas-client.ts:3650-3844. The inline IIFE twin remains the production
// source-of-truth until ADR 0015 Phase 3 atomic cutover.
//
// Functions:
//   - closeElementMenuImpl: pop the menu DOM, clear the menu trigger's
//     open marker, reset the openMenuElementId state on ctx.
//   - buildElementMenuImpl: assemble the menu rows (bring-to-front /
//     send-to-back / duplicate / delete) with their click handlers wired
//     directly to the inspector-actions verbs. Note: the inline IIFE
//     inlines duplicate/delete instead of calling duplicateElement /
//     deleteElement; this module preserves the inlined paths because the
//     duplicate path here additionally clamps clones to the artboard, a
//     behaviour the verbs themselves do not encode.
//   - toggleElementMenuImpl: open-or-close idempotent toggle.
//   - buildElementNodeImpl: assemble the per-element wrapper — data-attrs,
//     position/style application, body, resize handles (selected element
//     only), menu trigger.
//   - rebuildElementImpl: re-render just the named element's DOM in
//     place after a mutation. Forward-declared on ctx since Phase 2h.2.b;
//     this commit collapses the forward decl into the real implementation.
//   - mountResizeHandles / unmountResizeHandles: append or remove the
//     8-direction resize-handle quad from a wrapper. Only the currently-
//     selected element's wrapper carries handles in the DOM — gating
//     emission (not just CSS visibility) avoids a descendant-cascade bug
//     where selecting a container revealed every nested child's handles
//     because the previous CSS `.opencanvas-element[data-selected] .resize-handle`
//     rule used a descendant combinator. With handles only emitted on
//     the selected wrapper, the DOM carries 0 handles when nothing is
//     selected and exactly 8 when a single element is selected, regardless
//     of element-tree depth.
//
// Failure mode preserved: querySelector lookups silently no-op when the
// wrapper isn't live (rebuildElement falls back to a full renderAll when
// the element has no live wrapper — e.g. it lives on a non-current page).
// The duplicate path throws loudly when no current page is set, matching
// the inline IIFE.

import type { CanvasElement, CanvasSection } from '../canvas/schema.js';

import { hydrateInteractives } from './hydrate-interactives.js';

import { cssEscape } from './css-escape.js';
import type {
  DomContext,
  EditorContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { newElementId } from './ids.js';
import {
  applyZOrderAction,
  type InspectorActionContext,
  parentArrayFor,
} from './inspector-actions.js';
import { nextZInArray } from './z-order.js';

// ADR 0064 — `findMenuOwnerWrapper` + `closeElementMenuImpl` only walk the
// root DOM and flip the `openMenuElementId` latch on ctx, so they ride
// DomContext for the root ref plus a single-field Pick for the latch.
export type CloseElementMenuContext = DomContext & Pick<EditorContext, 'openMenuElementId'>;

// ADR 0064 — `buildElementMenuImpl` wires the menu rows to the inspector-
// action verbs (`applyZOrderAction` → InspectorActionContext, `parentArrayFor`
// → StateContext) and a local grab bag for duplicate/delete (currentPage
// from StateContext, the `closeElementMenu` verb). The clone path also
// touches selection + render + persist, all already covered by
// InspectorActionContext.
export type BuildElementMenuContext = InspectorActionContext &
  Pick<EditorContext, 'closeElementMenu'>;

// ADR 0064 — `toggleElementMenuImpl` flips the open-menu latch, walks the
// section tree (StateContext.findElement), drives the selection (SelectionContext
// .selectElement) and delegates to the menu builder via ctx so the IIFE twin
// keeps its single source of truth for the menu DOM.
export type ToggleElementMenuContext = StateContext &
  SelectionContext &
  Pick<EditorContext, 'openMenuElementId' | 'closeElementMenu' | 'buildElementMenu'>;

// ADR 0064 — `buildElementNodeImpl` is pure DOM scaffolding: box/style
// appliers, body builder, plus a SelectionContext read so the wrapper can
// stamp `data-selected` and mount resize handles on the active element.
export type BuildElementNodeContext = SelectionContext &
  Pick<
    EditorContext,
    'setBoxStyle' | 'applyElementStyle' | 'applyPinnedStyle' | 'buildElementBody'
  >;

export type BuildHostedElementNodeContext = Pick<
  EditorContext,
  'applyElementStyle' | 'applyPinnedStyle' | 'buildElementBody' | 'selectedElementId'
>;

// ADR 0064 — `rebuildElementImpl` re-renders a single element in place. It
// walks the section tree (StateContext), reads the live DOM (DomContext.root),
// drives a fall-back full renderAll (RenderContext), reports the inline-text
// commit toast (StatusEmitterContext), and checks the inline-edit latch
// (SelectionContext.editingElementId). The build + measurement verbs live in
// the local Pick.
export type RebuildElementContext = StateContext &
  DomContext &
  RenderContext &
  SelectionContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    'activeEditFinish' | 'buildElementNode' | 'buildHostedElementNode' | 'setBoxStyle'
  >;

/**
 * Eight-direction resize-handle layout (N/S/E/W + four corners). Order is
 * stable so the smoke can assert on the resulting class names without
 * coupling to insertion order. Kept module-private and re-used by the
 * mount helper below — duplicating the literal across buildElementNodeImpl
 * and the mount helper would drift the smoke's count assertion the next
 * time someone added a ninth direction.
 */
const RESIZE_HANDLE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

/**
 * Append the 8-direction resize-handle quad to a wrapper as direct
 * children. Idempotent: bails when the wrapper already has any
 * `[data-resize-handle]` child so a stray double-call from selectElement
 * + buildElementNode (when the selected element is being rebuilt) doesn't
 * stack 16 handles. Handles are positioned absolutely by CSS using the
 * wrapper as the offset parent — that's why they must be direct children,
 * not nested inside the body.
 */
export function mountResizeHandles(wrapper: HTMLElement): void {
  if (wrapper.querySelector(':scope > [data-resize-handle]')) return;
  for (let di = 0; di < RESIZE_HANDLE_DIRS.length; di++) {
    const dir = RESIZE_HANDLE_DIRS[di]!;
    const rh = document.createElement('div');
    rh.className = 'resize-handle resize-handle-' + dir;
    rh.setAttribute('data-resize-handle', 'true');
    rh.setAttribute('data-resize-dir', dir);
    wrapper.appendChild(rh);
  }
}

/**
 * Remove every direct-child `[data-resize-handle]` from a wrapper. Used
 * by selectElement when the selection moves away from this wrapper so the
 * DOM doesn't accumulate stale handles. Direct children only — never
 * recurse into the body, because a nested selected element's wrapper may
 * legitimately carry its own handles (during deep-selection edge cases
 * the inner wrapper's handles must survive the outer wrapper's cleanup).
 */
export function unmountResizeHandles(wrapper: HTMLElement): void {
  const handles = wrapper.querySelectorAll(':scope > [data-resize-handle]');
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    if (h && h.parentNode === wrapper) wrapper.removeChild(h);
  }
}

// Find the wrapper that currently owns the open 3-dot menu. Site-pinned
// header/footer sections render one wrapper per artboard but share a
// single element id, so a plain
// `querySelector('[data-opencanvas-element="X"] .element-menu')` would
// pick the FIRST matching wrapper — which is page 1's instance — even
// when the menu was opened on page 3. We instead `querySelectorAll`
// every wrapper carrying the id and pick the one that actually has a
// `.element-menu` child (the menu is appended into the wrapper that
// opened it). Returns null when no wrapper holds the menu, which is a
// legitimate state (e.g. the menu's owner wrapper was rebuilt before
// close ran).
function findMenuOwnerWrapper(ctx: CloseElementMenuContext, elementId: string): HTMLElement | null {
  if (!ctx.root) return null;
  const wrappers = ctx.root.querySelectorAll(
    '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
  );
  for (let i = 0; i < wrappers.length; i++) {
    const wrapper = wrappers[i];
    if (!(wrapper instanceof HTMLElement)) continue;
    if (wrapper.querySelector(':scope > .element-menu')) return wrapper;
  }
  return null;
}

export function closeElementMenuImpl(ctx: CloseElementMenuContext): void {
  if (!ctx.openMenuElementId) return;
  if (!ctx.root) {
    ctx.openMenuElementId = null;
    return;
  }
  // Find the SPECIFIC wrapper that owns the live menu (rather than the
  // first wrapper carrying the id — site-pinned sections render one
  // wrapper per artboard and the menu could be on any of them).
  const owner = findMenuOwnerWrapper(ctx, ctx.openMenuElementId);
  if (owner) {
    const menu = owner.querySelector(':scope > .element-menu');
    if (menu) menu.remove();
    const trigger = owner.querySelector(':scope > .element-menu-trigger');
    if (trigger) trigger.removeAttribute('data-menu-open');
  }
  ctx.openMenuElementId = null;
}

export function buildElementMenuImpl(
  ctx: BuildElementMenuContext,
  element: CanvasElement,
  section: CanvasSection,
  _wrapper: HTMLElement,
): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'element-menu';
  menu.setAttribute('data-element-menu', 'true');

  // Full z-order axis lives in the menu: front/back span the whole stack,
  // forward/backward nudge by one slot. Owners used to reach for the
  // inspector's z-order group to step through neighbours; folding those
  // verbs in here keeps the menu the single source of truth for stack
  // manipulation.
  type ZItem = { label: string; action: 'front' | 'back' | 'forward' | 'backward' };
  const zItems: Array<ZItem> = [
    { label: 'Bring to front', action: 'front' },
    { label: 'Forward', action: 'forward' },
    { label: 'Backward', action: 'backward' },
    { label: 'Send to back', action: 'back' },
  ];
  for (let i = 0; i < zItems.length; i++) {
    (function (item: ZItem) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'menu-item';
      btn.textContent = item.label;
      btn.addEventListener('click', function () {
        applyZOrderAction(ctx, section, element, item.action);
        ctx.closeElementMenu();
      });
      menu.appendChild(btn);
    })(zItems[i] as ZItem);
  }

  const div2 = document.createElement('div');
  div2.className = 'menu-divider';
  menu.appendChild(div2);

  if (element.type !== 'flow-container') {
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'menu-item';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', function () {
      const arr = parentArrayFor(ctx, section, element);
      const idx = arr.indexOf(element);
      if (idx < 0) {
        throw new Error('duplicate element: parent array does not contain ' + element.id);
      }
      const copy = JSON.parse(JSON.stringify(element)) as CanvasElement;
      copy.id = newElementId();
      if (copy.box && typeof copy.box === 'object') {
        if (typeof copy.box.x === 'number') copy.box.x = copy.box.x + 20;
        if (typeof copy.box.y === 'number') copy.box.y = copy.box.y + 20;
        if (parentArrayFor(ctx, section, element) === section.elements) {
          // Section-level duplicates can be clamped against the artboard.
          // Nested containers use panel-local coordinates, so there is no
          // section-sized bound to apply here.
          const page = ctx.currentPage();
          if (!page) {
            throw new Error(
              'duplicate element: no current page; cannot clamp duplicate within artboard',
            );
          }
          copy.box.x = Math.min(copy.box.x, page.width - copy.box.w);
          copy.box.y = Math.min(copy.box.y, section.height - copy.box.h);
        }
        copy.box.z = nextZInArray(arr);
      }
      arr.splice(idx + 1, 0, copy);
      ctx.closeElementMenu();
      ctx.renderAll();
      ctx.selectElement(copy.id);
      ctx.scheduleSave();
    });
    menu.appendChild(dupBtn);
  }

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'menu-item danger';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', function () {
    const arr = parentArrayFor(ctx, section, element);
    const idx = arr.indexOf(element);
    if (idx >= 0) arr.splice(idx, 1);
    ctx.closeElementMenu();
    ctx.selectedElementId = null;
    ctx.renderAll();
    ctx.renderInspector();
    ctx.scheduleSave();
  });
  menu.appendChild(delBtn);

  return menu;
}

export function toggleElementMenuImpl(
  ctx: ToggleElementMenuContext,
  elementId: string,
  wrapper: HTMLElement,
): void {
  if (ctx.openMenuElementId === elementId) {
    ctx.closeElementMenu();
    return;
  }
  ctx.closeElementMenu();
  const found = ctx.findElement(elementId);
  if (!found) return;
  ctx.selectElement(elementId);
  const menu = ctx.buildElementMenu(found.element, found.section, wrapper);
  wrapper.appendChild(menu);
  const trigger = wrapper.querySelector('.element-menu-trigger');
  if (trigger) trigger.setAttribute('data-menu-open', 'true');
  ctx.openMenuElementId = elementId;
}

export function buildElementNodeImpl(
  ctx: BuildElementNodeContext,
  element: CanvasElement,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'opencanvas-element';
  applyCommonElementWrapperAttrs(wrapper, element);
  ctx.setBoxStyle(wrapper, element.box);
  ctx.applyElementStyle(wrapper, element);
  ctx.applyPinnedStyle(wrapper, element);
  wrapper.appendChild(ctx.buildElementBody(element));
  // Resize handles render ONLY on the currently-selected element's wrapper.
  // Previously every wrapper carried 8 handles and CSS gated visibility, but
  // the visibility selector used a descendant combinator — selecting a
  // container surfaced every nested child's handles too (264 elements ×
  // 8 handles = 2112 visible handles in the worst case). Emitting only on
  // selection keeps DOM count at 8 max, and selection.ts mounts/unmounts
  // handles on selection-change so we don't have to rebuild the wrapper.
  if (ctx.selectedElementId === element.id) {
    mountResizeHandles(wrapper);
  }
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'element-menu-trigger';
  trigger.setAttribute('data-element-menu-trigger', element.id);
  trigger.textContent = '⋮';
  wrapper.appendChild(trigger);
  if (ctx.selectedElementId === element.id) {
    wrapper.setAttribute('data-selected', 'true');
  }
  return wrapper;
}

export function buildHostedElementNodeImpl(
  ctx: BuildHostedElementNodeContext,
  element: CanvasElement,
): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'opencanvas-element opencanvas-flow-content';
  applyCommonElementWrapperAttrs(wrapper, element);
  wrapper.style.position = 'relative';
  wrapper.style.width = '100%';
  wrapper.style.height = '100%';
  wrapper.style.boxSizing = 'border-box';
  ctx.applyElementStyle(wrapper, element);
  ctx.applyPinnedStyle(wrapper, element);
  wrapper.appendChild(ctx.buildElementBody(element));
  if (ctx.selectedElementId === element.id) {
    wrapper.setAttribute('data-selected', 'true');
  }
  return wrapper;
}

function applyCommonElementWrapperAttrs(wrapper: HTMLElement, element: CanvasElement): void {
  wrapper.setAttribute('data-opencanvas-element', element.id);
  wrapper.setAttribute('data-element-type', element.type);
  // Mirror the public renderer: stamp data-variant for action/shape/
  // container and data-role for text so kit CSS selectors of the form
  // [data-style-kit="X"] [data-element-type="action"][data-variant="Y"]
  // match in the editor preview exactly like they do in the published HTML.
  if (element.type === 'action' || element.type === 'shape' || element.type === 'container') {
    if (typeof element.variant === 'string') {
      wrapper.setAttribute('data-variant', element.variant);
    }
  } else if (element.type === 'text') {
    if (typeof element.role === 'string') {
      wrapper.setAttribute('data-role', element.role);
    }
  }
  if (element.motion) {
    wrapper.setAttribute('data-motion-preset', element.motion.preset);
    wrapper.setAttribute('data-motion-delay-ms', String(element.motion.delayMs || 0));
    // Drive animation-delay via the same CSS variable the kit rules read on
    // the published page; without this the data-motion-delay-ms attr was a
    // dead label and every element on the page animated at t=0.
    if (element.motion.delayMs && element.motion.delayMs > 0) {
      wrapper.style.setProperty('--opencanvas-motion-delay', String(element.motion.delayMs) + 'ms');
    }
  }
  if (element.marquee?.enabled === true) {
    wrapper.setAttribute('data-opencanvas-marquee', 'true');
    wrapper.setAttribute('data-opencanvas-marquee-direction', element.marquee.direction);
    wrapper.setAttribute('data-opencanvas-marquee-speed', String(element.marquee.speedPxPerSecond));
    wrapper.setAttribute(
      'data-opencanvas-marquee-pause',
      String(element.marquee.pauseOnHover === true),
    );
    wrapper.setAttribute(
      'data-opencanvas-marquee-edge-fade',
      String(element.marquee.edgeFade === true),
    );
    wrapper.setAttribute(
      'data-opencanvas-marquee-hover-reverse',
      String(element.marquee.hoverReverse === true),
    );
    wrapper.setAttribute('data-opencanvas-marquee-rows', String(element.marquee.rows ?? 1));
    wrapper.setAttribute('data-opencanvas-marquee-row-gap', String(element.marquee.rowGapPx ?? 0));
    wrapper.setAttribute(
      'data-opencanvas-marquee-row-offset',
      String(element.marquee.rowOffsetPercent ?? 50),
    );
    wrapper.setAttribute('data-opencanvas-marquee-reduced-motion', element.marquee.reducedMotion);
  }
  if (element.pointerFx?.enabled === true) {
    wrapper.setAttribute('data-opencanvas-pointer-fx', element.pointerFx.primitive);
    wrapper.setAttribute(
      'data-opencanvas-pointer-fx-reduced-motion',
      element.pointerFx.reducedMotion,
    );
  }
}

export function rebuildElementImpl(ctx: RebuildElementContext, elementId: string): void {
  if (ctx.editingElementId === elementId && ctx.activeEditFinish) {
    const commit = ctx.activeEditFinish;
    ctx.setStatus('Text edits committed — click the element to keep editing', 'info');
    commit();
    return;
  }
  const found = ctx.findElement(elementId);
  if (!found) return;
  if (!ctx.root) {
    ctx.renderAll();
    return;
  }
  const existingNodes = ctx.root.querySelectorAll(
    '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
  );
  if (existingNodes.length === 0) {
    ctx.renderAll();
    return;
  }
  const hosted = found.parentKind === 'flow-item';
  for (let i = 0; i < existingNodes.length; i++) {
    const existing = existingNodes[i];
    if (!existing || !existing.parentNode) continue;
    const replacement = hosted
      ? ctx.buildHostedElementNode(found.element)
      : ctx.buildElementNode(found.element);
    // Entrance animations are for first paint, not inspector tweaks. Without
    // this, every variant/opacity/etc. change re-fires the kit data-motion-preset
    // animation (fade-up etc.) so the wrapper flickers from opacity 0 to
    // opacity 1 on each edit, and animation-fill-mode both on the fade-up
    // keyframe pins the wrapper at the resting opacity 1 state, so an inline
    // opacity 0.3 from elementStyle.opacity never takes effect.
    replacement.removeAttribute('data-motion-preset');
    replacement.removeAttribute('data-motion-delay-ms');
    replacement.style.removeProperty('--opencanvas-motion-delay');
    existing.parentNode.replaceChild(replacement, existing);
    if (found.element.type === 'text') {
      const inner = replacement.querySelector('.opencanvas-text');
      if (inner) {
        const textH = inner.scrollHeight;
        if (textH > found.element.box.h) {
          found.element.box.h = textH;
          if (!hosted) ctx.setBoxStyle(replacement, found.element.box);
        }
      }
    }
  }
  // Re-hydrate the visitor interactive runtime against the replaced
  // wrapper(s). A carousel rebuilt via the inspector (slide added /
  // removed / reordered) emits a fresh `.opencanvas-carousel` subtree
  // with no `data-opencanvas-hydrated="true"` flag; without this call
  // its arrows + dots would render but never advance. `skipPopups: true`
  // matches the editor's renderAll() contract — popup chrome is visitor-
  // only. Re-query for the fresh replacement nodes since the references
  // captured in `existingNodes` above point at the now-detached originals.
  const freshNodes = ctx.root.querySelectorAll(
    '[data-opencanvas-element="' + cssEscape(elementId) + '"]',
  );
  for (let i = 0; i < freshNodes.length; i++) {
    const node = freshNodes[i];
    if (node instanceof HTMLElement) {
      hydrateInteractives(node, { skipPopups: true });
    }
  }
}
