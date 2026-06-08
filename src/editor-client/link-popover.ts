// src/editor-client/link-popover.ts
//
// ADR 0058 Phase 2q.g — link popover cluster.
// canvas-client.ts:8856-9218 carries the inline twin; retires on ADR 0015
// Phase 3 atomic cutover. Until then, the inline IIFE is the production
// source-of-truth and this module is dead code (Phase 3 destination).
//
// The popover is a singleton DOM node anchored to the currently-hovered or
// caret-pinned link inside the canvas. Three trigger surfaces:
//
//   - Inline link marks inside a text element being edited (hover + caret
//     pin via selectionchange).
//   - Nav links on the canvas (hover only — they aren't inside a text edit).
//   - Action element anchors (hover only; selectElement auto-pins for the
//     selected action — that auto-pin call lives in selection.ts).
//
// Three popover "kinds" share one DOM template. The kind classifier
// `linkPopoverKindOf` returns 'inline' / 'nav' / 'action' from the anchor's
// classList; the button set + the visitor preview chip adapt per kind.
//
// State surface lifted out of the IIFE closure onto ctx:
//   - ctx.linkPopover            HTMLElement | null
//   - ctx.linkPopoverAnchor      HTMLElement | null
//   - ctx.linkPopoverPinned      boolean (already on ctx since Phase 2o.a)
//   - ctx.linkPopoverShowTimer   timer handle | null
//   - ctx.linkPopoverHideTimer   timer handle | null
//
// String escape note: the inline IIFE body lives inside an outer TS
// template literal, so it uses `String.fromCharCode(10)` and doubled
// backslashes to avoid escape-cooking surprises. This extracted module is
// a normal TS source file (NOT a template literal), so literal `'\n'`
// strings and single backslash escapes are safe and used directly.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { CanvasPage } from '../canvas/schema.js';
import type {
  EditorContext,
  SelectionContext,
  StatusEmitterContext,
} from './editor-context.js';
import { isAllowedHref } from './href-utils.js';

type LinkPopoverKind = 'inline' | 'nav' | 'action';

// Show/hide debounces. 150ms show delay matches the IIFE twin so a
// glancing cursor doesn't tear up a popover; 200ms hide grace lets the
// Owner cross the gap from the link to the popover without re-triggering.
const SHOW_DELAY_MS = 150;
const HIDE_GRACE_MS = 200;

// ADR 0064 — popover-state grab bag. The five `linkPopover*` fields live
// in this module's surface; no canonical alias owns them yet. Almost
// every function below touches at least one, so they share one named
// view rather than re-listing the bag at each call site.
export type LinkPopoverStateContext = Pick<
  EditorContext,
  | 'linkPopover'
  | 'linkPopoverAnchor'
  | 'linkPopoverPinned'
  | 'linkPopoverShowTimer'
  | 'linkPopoverHideTimer'
>;

// ADR 0064 — `removeLinkPopoverImpl` is the popover teardown verb. It
// clears both timers and detaches the floating bar; touches the full
// popover-state surface, nothing else.
export type RemoveLinkPopoverContext = LinkPopoverStateContext;

// ADR 0064 — `positionLinkPopover` only reads `linkPopover` to measure /
// place the floating bar. The narrowest signature in the module.
export type PositionLinkPopoverContext = Pick<EditorContext, 'linkPopover'>;

// ADR 0064 — `showLinkPopoverImpl` builds the popover DOM and wires the
// per-kind buttons. It extends the popover-state surface with the page-
// navigation verbs the "Go" button drives (findPageByHref / setActivePage /
// panToPage), the link-modal verb the Edit button drives (openLinkModal),
// the selection verbs the nav / action Inspector buttons drive
// (SelectionContext for selectElement + forceOpenInspector), and the
// status emitter for the rejected-href toast.
export type ShowLinkPopoverContext = RemoveLinkPopoverContext &
  SelectionContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    'findPageByHref' | 'setActivePage' | 'panToPage' | 'openLinkModal' | 'forceOpenInspector'
  >;

// ADR 0064 — `onLinkMouseEnter` debounces a show on hover over an inline
// link inside a contenteditable. Folds in `ShowLinkPopoverContext` for
// the deferred `showLinkPopoverImpl(ctx, ...)` call; `editingElementId`
// rides in via the `SelectionContext` already inside that intersection.
export type OnLinkMouseEnterContext = ShowLinkPopoverContext;

// ADR 0064 — `onLinkMouseLeave` debounces a hide. It folds in
// `RemoveLinkPopoverContext` so the deferred `removeLinkPopoverImpl(ctx)`
// call typechecks without a cast. No selection / editing state read.
export type OnLinkMouseLeaveContext = RemoveLinkPopoverContext;

// ADR 0064 — `closestInlineLinkInEditMode` is a DOM-walk helper gated on
// `editingElementId`. Pure `SelectionContext` — no popover state touched.
export type ClosestInlineLinkInEditModeContext = SelectionContext;

// ADR 0064 — `canHoverPopover` decides whether a hover may trigger the
// popover for a given anchor. The decision flips on `editingElementId`
// only, so `SelectionContext` is the entire surface.
export type CanHoverPopoverContext = SelectionContext;

// ADR 0064 — `onCanvasLinkHover` is the canvas-wide hover entry. It
// forwards to both `canHoverPopover` (gated on editingElementId) and
// `showLinkPopoverImpl` after the debounce, plus reads popover state to
// short-circuit the already-pinned case.
export type OnCanvasLinkHoverContext = ShowLinkPopoverContext & CanHoverPopoverContext;

// ADR 0064 — `onCanvasLinkHoverLeave` debounces a hide off the canvas
// root. Same surface as `onLinkMouseLeave`.
export type OnCanvasLinkHoverLeaveContext = RemoveLinkPopoverContext;

// ADR 0064 — `onSelectionChangeForLinkPopover` pins the popover to the
// link containing the caret during text edit. Folds in
// `ShowLinkPopoverContext` for the pin-show call,
// `ClosestInlineLinkInEditModeContext` for the DOM-walk helper, plus the
// mark-toolbar font-size resync verb (no canonical alias yet).
export type OnSelectionChangeForLinkPopoverContext = ShowLinkPopoverContext &
  ClosestInlineLinkInEditModeContext &
  Pick<EditorContext, 'refreshMarkToolbarFontSizeState'>;

export function removeLinkPopoverImpl(ctx: RemoveLinkPopoverContext): void {
  if (ctx.linkPopoverShowTimer) {
    clearTimeout(ctx.linkPopoverShowTimer);
    ctx.linkPopoverShowTimer = null;
  }
  if (ctx.linkPopoverHideTimer) {
    clearTimeout(ctx.linkPopoverHideTimer);
    ctx.linkPopoverHideTimer = null;
  }
  if (ctx.linkPopover && ctx.linkPopover.parentNode) {
    ctx.linkPopover.parentNode.removeChild(ctx.linkPopover);
  }
  ctx.linkPopover = null;
  ctx.linkPopoverAnchor = null;
  ctx.linkPopoverPinned = false;
}

export function positionLinkPopover(
  ctx: PositionLinkPopoverContext,
  anchorEl: HTMLElement | null,
): void {
  if (!ctx.linkPopover || !anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const popoverHeight = ctx.linkPopover.offsetHeight || 32;
  const spaceBelow = window.innerHeight - rect.bottom;
  let top: number;
  let placement: 'above' | 'below';
  if (spaceBelow >= popoverHeight + 8) {
    top = rect.bottom + 6;
    placement = 'below';
  } else {
    top = rect.top - popoverHeight - 6;
    placement = 'above';
  }
  ctx.linkPopover.style.top = Math.max(0, top) + 'px';
  ctx.linkPopover.style.left = Math.max(0, rect.left) + 'px';
  ctx.linkPopover.setAttribute('data-opencanvas-link-popover-placement', placement);
}

// Classify a link anchor in the canvas. The popover's button set + preview
// class adapt to this kind so each link primitive gets the right toolbar
// without three separate popover implementations.
export function linkPopoverKindOf(anchorEl: HTMLElement | null): LinkPopoverKind {
  if (!anchorEl || !anchorEl.classList) return 'inline';
  if (anchorEl.classList.contains('opencanvas-action')) return 'action';
  if (anchorEl.classList.contains('opencanvas-nav-link')) return 'nav';
  return 'inline';
}

// Walk up from a clicked sub-anchor (nav link, inline mark) to the canvas
// element wrapper that owns it. Used by the nav-link "Edit nav" button to
// surface the inspector for the parent NavElement.
export function parentElementIdOf(node: Node | null): string | null {
  let n: Node | null = node;
  while (n && n !== document.body) {
    if (
      n.nodeType === 1 &&
      (n as Element).getAttribute &&
      (n as Element).getAttribute('data-opencanvas-element')
    ) {
      return (n as Element).getAttribute('data-opencanvas-element');
    }
    n = n.parentNode;
  }
  return null;
}

export function showLinkPopoverImpl(
  ctx: ShowLinkPopoverContext,
  anchorEl: HTMLElement,
  opts?: { pinned: boolean },
): void {
  removeLinkPopoverImpl(ctx);
  const pinned = !!(opts && opts.pinned);
  const href = anchorEl.getAttribute('href') || '';
  const kind = linkPopoverKindOf(anchorEl);
  const bar = document.createElement('div');
  bar.className = 'opencanvas-link-popover';
  bar.setAttribute('data-opencanvas-link-popover-kind', kind);
  if (pinned) bar.setAttribute('data-opencanvas-link-popover-pinned', 'true');

  // Top row: URL + buttons. Bottom row: visitor-view preview chip when the
  // kind has a meaningful styling mismatch (inline marks, nav links). Two
  // rows live in one column so the popover stays a single floating
  // surface anchored to the link.
  const topRow = document.createElement('div');
  topRow.className = 'opencanvas-link-popover-row';
  bar.appendChild(topRow);

  const urlSpan = document.createElement('span');
  urlSpan.className = 'opencanvas-link-popover-url';
  urlSpan.textContent = href.length > 40 ? href.slice(0, 37) + '...' : href;
  urlSpan.title = href;
  topRow.appendChild(urlSpan);

  // Smart "Go" button — internal hrefs swap the active page so the Owner
  // can keep editing the destination; anchors and external hrefs fall
  // through to the existing open-in-new-tab path. Label adapts so the
  // Owner knows what will happen before they click.
  const goBtn = document.createElement('button');
  goBtn.type = 'button';
  const matchedPage: CanvasPage | null = ctx.findPageByHref(href);
  if (matchedPage) {
    goBtn.textContent = 'Go to ' + (matchedPage.title || matchedPage.slug || 'page');
    goBtn.title = 'Switch the canvas to ' + (matchedPage.title || matchedPage.slug);
  } else if (href.charAt(0) === '#') {
    goBtn.textContent = 'Jump';
    goBtn.title = 'In-page anchor — no destination in the editor';
    goBtn.disabled = true;
  } else {
    goBtn.textContent = 'Open';
    goBtn.title = 'Open in new tab';
  }
  goBtn.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
  });
  goBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (goBtn.disabled) return;
    if (matchedPage) {
      removeLinkPopoverImpl(ctx);
      ctx.setActivePage(matchedPage.id);
      // Explicit "Go to page" navigation — pan the camera so the target
      // lands in the viewport. setActivePage is camera-pure; explicit nav
      // opts in. Without this the Owner clicks Go and stares at a blank
      // canvas when the target sits hundreds of pixels off-screen.
      ctx.panToPage(matchedPage.id);
      return;
    }
    if (!isAllowedHref(href)) {
      ctx.setStatus(
        'Link rejected: ' + href + ' is not http/https/mailto/tel/anchor/relative',
        'error',
      );
      removeLinkPopoverImpl(ctx);
      return;
    }
    window.open(href, '_blank', 'noopener,noreferrer');
    removeLinkPopoverImpl(ctx);
  });
  topRow.appendChild(goBtn);

  if (kind === 'inline') {
    // Inline link marks: full edit (modal) + unlink. These manipulate the
    // contenteditable DOM directly because the text element is in edit mode.
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    editBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      const currentHref = anchorEl.getAttribute('href') || '';
      const currentTarget = anchorEl.getAttribute('target') || '';
      const linkText = anchorEl.textContent || '';
      removeLinkPopoverImpl(ctx);
      ctx
        .openLinkModal({
          linkText: linkText,
          href: currentHref,
          blank: currentTarget === '_blank',
          focusAfterClose: closestEditableRoot(anchorEl),
        })
        .then(function (result) {
          if (result === null) return;
          anchorEl.setAttribute('href', result.href);
          if (result.target === '_blank') {
            anchorEl.setAttribute('target', '_blank');
            anchorEl.setAttribute('rel', 'noopener noreferrer');
          } else {
            anchorEl.removeAttribute('target');
            anchorEl.removeAttribute('rel');
          }
        })
        .catch(function (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.setStatus('Link edit failed: ' + message, 'error');
        });
    });
    topRow.appendChild(editBtn);

    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.textContent = 'Unlink';
    unlinkBtn.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    unlinkBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      const parent = anchorEl.parentNode;
      if (!parent) return;
      while (anchorEl.firstChild) {
        parent.insertBefore(anchorEl.firstChild, anchorEl);
      }
      parent.removeChild(anchorEl);
      removeLinkPopoverImpl(ctx);
    });
    topRow.appendChild(unlinkBtn);
  } else if (kind === 'nav') {
    // Nav links are structured (label/href/kind), not free text — editing
    // happens through the parent NavElement's inspector. The button
    // selects the owning element so the inspector opens for it.
    const navEditBtn = document.createElement('button');
    navEditBtn.type = 'button';
    navEditBtn.textContent = 'Edit nav';
    navEditBtn.title = 'Open the nav element inspector';
    navEditBtn.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    navEditBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      const ownerId = parentElementIdOf(anchorEl);
      removeLinkPopoverImpl(ctx);
      if (ownerId) {
        ctx.selectElement(ownerId);
        ctx.forceOpenInspector();
      }
    });
    topRow.appendChild(navEditBtn);
  } else if (kind === 'action') {
    // Action elements expose every field (label/href/variant) in the
    // inspector. The Inspector button just guarantees the inspector is
    // pointed at this element (helpful when the popover was triggered by
    // hover rather than selection).
    const inspBtn = document.createElement('button');
    inspBtn.type = 'button';
    inspBtn.textContent = 'Inspector';
    inspBtn.title = 'Select this action so the inspector opens its fields';
    inspBtn.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    inspBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      const ownerId = parentElementIdOf(anchorEl);
      removeLinkPopoverImpl(ctx);
      if (ownerId) {
        ctx.selectElement(ownerId);
        ctx.forceOpenInspector();
      }
    });
    topRow.appendChild(inspBtn);
  }

  // Preview row — renders the link text inside a sandbox that disables the
  // editor-only contenteditable underline-cursor override so the Owner sees
  // exactly what a visitor sees on the published page. Action elements
  // skip the preview because they already render full-fidelity on the
  // canvas (no contenteditable override sits on them).
  if (kind === 'inline' || kind === 'nav') {
    const previewRow = document.createElement('div');
    previewRow.className = 'opencanvas-link-popover-preview';
    const previewLabel = document.createElement('span');
    previewLabel.className = 'opencanvas-link-popover-preview-label';
    previewLabel.textContent = 'Visitors see';
    previewRow.appendChild(previewLabel);
    const previewLink = document.createElement('a');
    // Use the matching published class so the kit accent / hover colour
    // flow through unchanged. Adding the popover-specific class disables
    // pointer events so accidental clicks don't navigate.
    const previewClass = kind === 'nav' ? 'opencanvas-nav-link' : 'opencanvas-inline-link';
    previewLink.className = previewClass + ' opencanvas-link-popover-preview-link';
    previewLink.setAttribute('href', href || '#');
    previewLink.setAttribute('tabindex', '-1');
    previewLink.textContent = (anchorEl.textContent || '').trim() || 'link text';
    previewLink.addEventListener('click', function (ev) {
      ev.preventDefault();
    });
    previewRow.appendChild(previewLink);
    bar.appendChild(previewRow);
  }

  bar.addEventListener('mouseenter', function () {
    if (ctx.linkPopoverHideTimer) {
      clearTimeout(ctx.linkPopoverHideTimer);
      ctx.linkPopoverHideTimer = null;
    }
  });
  bar.addEventListener('mouseleave', function () {
    // Pinned popovers stay until something else dismisses them (caret
    // leaves the link, element is deselected, text edit ends). Hover-
    // triggered popovers get a grace window so a glancing cursor exit
    // doesn't tear the chip down before the Owner can come back to it.
    if (ctx.linkPopoverPinned) return;
    if (ctx.linkPopoverHideTimer) {
      clearTimeout(ctx.linkPopoverHideTimer);
    }
    ctx.linkPopoverHideTimer = setTimeout(function () {
      ctx.linkPopoverHideTimer = null;
      removeLinkPopoverImpl(ctx);
    }, HIDE_GRACE_MS);
  });

  ctx.linkPopover = bar;
  ctx.linkPopoverAnchor = anchorEl;
  ctx.linkPopoverPinned = pinned;
  document.body.appendChild(bar);
  positionLinkPopover(ctx, anchorEl);
}

export function onLinkMouseEnter(
  ctx: OnLinkMouseEnterContext,
  ev: { target: EventTarget | null },
): void {
  if (!ctx.editingElementId) return;
  const target = ev.target as HTMLElement | null;
  if (!target || target.tagName !== 'A') return;
  // Don't disturb a pinned popover already showing for the same link.
  if (ctx.linkPopoverPinned && ctx.linkPopoverAnchor === target) return;
  if (ctx.linkPopoverShowTimer) {
    clearTimeout(ctx.linkPopoverShowTimer);
    ctx.linkPopoverShowTimer = null;
  }
  if (ctx.linkPopoverHideTimer) {
    clearTimeout(ctx.linkPopoverHideTimer);
    ctx.linkPopoverHideTimer = null;
  }
  ctx.linkPopoverShowTimer = setTimeout(function () {
    ctx.linkPopoverShowTimer = null;
    showLinkPopoverImpl(ctx, target);
  }, SHOW_DELAY_MS);
}

export function onLinkMouseLeave(
  ctx: OnLinkMouseLeaveContext,
  ev: { target: EventTarget | null },
): void {
  const target = ev.target as HTMLElement | null;
  if (!target || target.tagName !== 'A') return;
  if (ctx.linkPopoverShowTimer) {
    clearTimeout(ctx.linkPopoverShowTimer);
    ctx.linkPopoverShowTimer = null;
  }
  if (ctx.linkPopoverPinned) return;
  ctx.linkPopoverHideTimer = setTimeout(function () {
    ctx.linkPopoverHideTimer = null;
    removeLinkPopoverImpl(ctx);
  }, HIDE_GRACE_MS);
}

// Walk up from a DOM node to the nearest inline link mark anchor inside the
// text element currently in edit mode. Returns null when the node is not
// inside a link or not inside an edited text element.
export function closestInlineLinkInEditMode(
  ctx: ClosestInlineLinkInEditModeContext,
  node: Node | null,
): HTMLAnchorElement | null {
  if (!ctx.editingElementId || !node) return null;
  let n: Node | null = node;
  if (n.nodeType !== 1) n = n.parentNode;
  while (n && n !== document.body) {
    if (
      n.nodeType === 1 &&
      (n as Element).tagName === 'A' &&
      (n as Element).classList &&
      (n as Element).classList.contains('opencanvas-inline-link')
    ) {
      return n as HTMLAnchorElement;
    }
    n = n.parentNode;
  }
  return null;
}

// Whether the popover may trigger for this anchor given the current editor
// state. Inline marks fire only inside a text element being edited; nav
// links and action elements fire only when no text edit is in progress
// (otherwise they'd race the mark toolbar for the same screen real estate).
export function canHoverPopover(
  ctx: CanHoverPopoverContext,
  anchorEl: Element | null,
): boolean {
  if (!anchorEl || anchorEl.tagName !== 'A') return false;
  const kind = linkPopoverKindOf(anchorEl as HTMLElement);
  if (kind === 'inline') return !!ctx.editingElementId;
  return !ctx.editingElementId;
}

// Canvas-wide link hover handlers. Attached on root in attachPointerHandlers
// so nav links and action elements get the same popover treatment as inline
// marks, without each renderer wiring its own listeners.
export function onCanvasLinkHover(ctx: OnCanvasLinkHoverContext, ev: Event): void {
  let target = ev.target;
  if (!(target instanceof Element)) return;
  if (target.tagName !== 'A') {
    const closest = target.closest && target.closest('a');
    if (!closest) return;
    target = closest;
  }
  if (!canHoverPopover(ctx, target as Element)) return;
  if (ctx.linkPopoverPinned && ctx.linkPopoverAnchor === target) return;
  if (ctx.linkPopoverShowTimer) {
    clearTimeout(ctx.linkPopoverShowTimer);
    ctx.linkPopoverShowTimer = null;
  }
  if (ctx.linkPopoverHideTimer) {
    clearTimeout(ctx.linkPopoverHideTimer);
    ctx.linkPopoverHideTimer = null;
  }
  const captured = target as HTMLElement;
  ctx.linkPopoverShowTimer = setTimeout(function () {
    ctx.linkPopoverShowTimer = null;
    showLinkPopoverImpl(ctx, captured);
  }, SHOW_DELAY_MS);
}

export function onCanvasLinkHoverLeave(ctx: OnCanvasLinkHoverLeaveContext, ev: Event): void {
  let target = ev.target;
  if (!(target instanceof Element)) return;
  if (target.tagName !== 'A') {
    const closest = target.closest && target.closest('a');
    if (!closest) return;
    target = closest;
  }
  if (ctx.linkPopoverShowTimer) {
    clearTimeout(ctx.linkPopoverShowTimer);
    ctx.linkPopoverShowTimer = null;
  }
  if (ctx.linkPopoverPinned) return;
  ctx.linkPopoverHideTimer = setTimeout(function () {
    ctx.linkPopoverHideTimer = null;
    removeLinkPopoverImpl(ctx);
  }, HIDE_GRACE_MS);
}

// selectionchange driver — pin the popover to whichever link contains the
// caret while text is in edit mode. When the caret leaves the link, the
// pinned popover dismisses (hover may re-show it without pinning).
export function onSelectionChangeForLinkPopover(
  ctx: OnSelectionChangeForLinkPopoverContext,
): void {
  if (!ctx.editingElementId) return;
  ctx.refreshMarkToolbarFontSizeState();
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) {
    if (ctx.linkPopoverPinned) removeLinkPopoverImpl(ctx);
    return;
  }
  const anchorNode = sel.anchorNode;
  const linkEl = closestInlineLinkInEditMode(ctx, anchorNode);
  if (!linkEl) {
    if (ctx.linkPopoverPinned) removeLinkPopoverImpl(ctx);
    return;
  }
  // Already pinned to this link → nothing to do.
  if (ctx.linkPopoverPinned && ctx.linkPopoverAnchor === linkEl) return;
  showLinkPopoverImpl(ctx, linkEl, { pinned: true });
}

// Private — used by the inline-link Edit button to refocus the editable
// after the link modal closes. Mirrors the IIFE twin's helper.
function closestEditableRoot(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element) return null;
  return element.closest<HTMLElement>('[contenteditable="true"]');
}
