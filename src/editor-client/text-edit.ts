// src/editor-client/text-edit.ts
//
// ADR 0058 Phase 2q.g — begin-text-edit lifecycle.
// canvas-client.ts:10134-10311 carries the inline twin; retires on
// ADR 0015 Phase 3 atomic cutover. Until then, the inline IIFE is the
// production source-of-truth and this module is dead code (Phase 3
// destination).
//
// `beginTextEdit` is the entry point that flips a text element into
// contenteditable mode and wires the four event handlers that drive the
// edit lifecycle:
//
//   - mouseover / mouseout: bubble inline-link hover into the link popover
//     hover handlers (link-popover.ts) so the popover hovers respond to
//     pointer movement INSIDE the editable, not just over the canvas.
//   - mousedown: clicking an inline-link anchor inside the editable pins
//     the link popover and prevents the browser from placing the caret
//     inside the anchor (the Owner edits the link via the popover Edit
//     button instead).
//   - paste: normalises pasted HTML through `normalizePastedHtml` so the
//     editor's serializer sees the canonical mark tags listed in
//     MARK_TAGS. Plain-text pastes funnel through
//     `plainTextToFragmentHtml`.
//   - selectionchange (document-level): drives the caret-inside-link
//     popover pin. Registered for the duration of the edit; removed in
//     `finish()`.
//   - blur: commits the edit (serialise → save) unless focus moved to the
//     mark toolbar or link popover (those keep the edit alive).
//   - keydown: Escape cancels (restore snapshot, blur); Ctrl/Cmd+B/I/U
//     and Ctrl/Cmd+Shift+X / Ctrl/Cmd+K apply marks.
//
// The pre-edit snapshot is a deep clone of `element.content`. Escape and
// any serialization failure restore it; commit-without-text-content also
// restores it ("Text can't be empty" is a loud-failure path, not a silent
// drop).
//
// String escape note: the inline IIFE body lives inside an outer TS
// template literal, so it uses doubled `"\\n"` source. This extracted
// module is a normal TS source file; single backslash escapes are safe.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type { InlineRun, TextElement } from '../canvas/schema.js';
import type {
  DomContext,
  EditorContext,
  PersistContext,
  RenderContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import type {
  ApplyMarkImplContext,
  BuildMarkToolbarContext,
  RemoveMarkToolbarContext,
} from './mark-toolbar.js';
import {
  buildMarkToolbarImpl,
  removeMarkToolbar,
  applyMarkImpl,
} from './mark-toolbar.js';
import type { OnSelectionChangeForLinkPopoverContext } from './link-popover.js';
import {
  onLinkMouseEnter,
  onLinkMouseLeave,
  onSelectionChangeForLinkPopover,
  removeLinkPopoverImpl,
  showLinkPopoverImpl,
} from './link-popover.js';
import { findElementWrapperInArtboardOf } from './selection.js';

// ADR 0064 — `beginTextEditImpl` flips a text element into contenteditable
// and wires the edit lifecycle. It touches six canonical clusters
// (StateContext for findElement, DomContext for root, SelectionContext for
// editingElementId, RenderContext for rebuildElement, PersistContext for
// scheduleSave, StatusEmitterContext for setStatus), folds in the narrow
// types from mark-toolbar.ts and link-popover.ts so the eight forwarded
// call sites typecheck without `ctx as EditorContext` scaffolding, and
// finishes with a grab bag of inline-edit-only verbs + DOM refs that no
// canonical alias owns yet: the editingSnapshot latch, the
// activeEditFinish closure slot, the modalOpen gate, the paste-
// normalisation helpers (normalizePastedHtml / plainTextToFragmentHtml),
// the post-paste KaTeX rescan (renderMathInScope), the serializer +
// emptiness check (serializeContentToRuns / plainTextOf), and the
// wrapper resize helper (setBoxStyle).
export type BeginTextEditContext = StateContext &
  DomContext &
  SelectionContext &
  RenderContext &
  PersistContext &
  StatusEmitterContext &
  BuildMarkToolbarContext &
  RemoveMarkToolbarContext &
  ApplyMarkImplContext &
  OnSelectionChangeForLinkPopoverContext &
  Pick<
    EditorContext,
    | 'editingSnapshot'
    | 'activeEditFinish'
    | 'modalOpen'
    | 'normalizePastedHtml'
    | 'plainTextToFragmentHtml'
    | 'renderMathInScope'
    | 'serializeContentToRuns'
    | 'plainTextOf'
    | 'setBoxStyle'
  >;

// `clickedWrapper` is the SPECIFIC `.opencanvas-element` DOM node the
// canvas-root click handler resolved at the pointer — load-bearing for
// site-pinned sections (header/footer) where the same element id renders
// once per page artboard. Passing it through means the contenteditable
// flip, mark-toolbar anchor, and every getBoundingClientRect-driven
// affordance pin to the page the Owner actually clicked, not the first
// match in document order. Optional so non-click callers (autopilot
// flows, focus-via-keyboard) still work; those fall back to the helper's
// first-match path.
export function beginTextEditImpl(
  ctx: BeginTextEditContext,
  elementId: string,
  clickedWrapper?: HTMLElement | null,
): void {
const found = ctx.findElement(elementId);
  if (!found || found.element.type !== 'text') return;
  if (!ctx.root) return;
  // Local alias so the text-narrowing survives closure capture in
  // restoreFromSnapshot / finish below.
  const textElement: TextElement = found.element;
  // Prefer the wrapper the caller resolved at the click point (it's
  // already the right instance). When absent or stale, scope by artboard
  // through findElementWrapperInArtboardOf — same behaviour the click
  // path takes — so any context node the caller passes still pins us to
  // the right page.
  const wrapper =
    clickedWrapper && clickedWrapper.isConnected
      ? clickedWrapper
      : findElementWrapperInArtboardOf(ctx, elementId, clickedWrapper ?? null);
  if (!wrapper) return;
  const inner = wrapper.querySelector<HTMLElement>('.opencanvas-text');
  if (!inner) return;
  const textH = inner.scrollHeight;
  if (textH > textElement.box.h) {
    textElement.box.h = textH;
    ctx.setBoxStyle(wrapper, textElement.box);
    ctx.scheduleSave();
  }

  ctx.editingElementId = elementId;
  // Deep-clone the pre-edit content so Escape/Cancel can restore exactly.
  ctx.editingSnapshot = JSON.parse(JSON.stringify(textElement.content || [])) as InlineRun[];
  // Flag the wrapper as actively edited so the editor stylesheet drops the
  // `overflow:hidden` default for text wrappers. Without this, typing a long
  // line during inline edit would push the caret past the clipped right
  // edge and leave the Owner typing into an invisible region. finish()
  // removes the flag so the clip resumes the moment the edit ends.
  (wrapper).setAttribute('data-editing', 'true');
  inner.setAttribute('contenteditable', 'true');
  inner.focus();

  buildMarkToolbarImpl(ctx, wrapper);

  inner.addEventListener('mouseover', function (ev) {
    let node: Node | null = ev.target as Node | null;
    while (node && node !== inner) {
      if (node.nodeType === 1 && (node as Element).tagName === 'A') {
        onLinkMouseEnter(ctx, { target: node });
        return;
      }
      node = node.parentNode;
    }
  });
  inner.addEventListener('mouseout', function (ev) {
    let node: Node | null = ev.target as Node | null;
    while (node && node !== inner) {
      if (node.nodeType === 1 && (node as Element).tagName === 'A') {
        onLinkMouseLeave(ctx, { target: node });
        return;
      }
      node = node.parentNode;
    }
  });

  // Clicks on an inline link inside the editable do not place the caret
  // and do not navigate — they only pin the link popover. The Owner edits
  // the link via the popover (Edit / Unlink / Open); editing the link's
  // text still works by clicking before or after the link and arrow-keying
  // into it. preventDefault on mousedown so the browser never moves focus
  // or selection in response to the click.
  inner.addEventListener('mousedown', function (ev) {
    let node: Node | null = ev.target as Node | null;
    while (node && node !== inner) {
      if (
        node.nodeType === 1 &&
        (node as Element).tagName === 'A' &&
        (node as Element).classList &&
        (node as Element).classList.contains('opencanvas-inline-link')
      ) {
        ev.preventDefault();
        showLinkPopoverImpl(ctx, node as HTMLElement, { pinned: true });
        return;
      }
      node = node.parentNode;
    }
  });

  // Intercept paste so HTML pasted from Google Docs / Notion / other web
  // sources keeps its bold / italic / underline / link formatting. The
  // browser would otherwise drop the formatting on the next save: many
  // tools emit <span style="font-weight:700"> instead of <strong>, and
  // serializeContentToRuns only recognises the canonical mark tags
  // listed in MARK_TAGS. We normalise on paste so the DOM the serializer
  // walks always uses those canonical tags.
  inner.addEventListener('paste', function (ev) {
    ev.preventDefault();
    const cd = ev.clipboardData;
    if (!cd) return;
    const html = cd.getData('text/html');
    let fragmentHtml: string;
    if (html && html.length > 0) {
      fragmentHtml = ctx.normalizePastedHtml(html);
    } else {
      const plain = cd.getData('text/plain') || '';
      fragmentHtml = ctx.plainTextToFragmentHtml(plain);
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const template = document.createElement('template');
    template.innerHTML = fragmentHtml;
    const frag = template.content;
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    // Render any opencanvas-math spans that landed in this paste. The
    // pasted HTML carries TeX in data-math-tex; renderMathInScope swaps
    // each span's plain-tex fallback for KaTeX HTML. No-op when KaTeX
    // hasn't loaded yet — onKatexReady reruns this scope once it does.
    ctx.renderMathInScope(inner);
  });

  // selectionchange is a document-level event; register it for the
  // duration of text edit and remove it in finish(). The handler
  // short-circuits when editingElementId is cleared, but removing keeps
  // the global listener set small.
  const onSelectionChange = (): void => onSelectionChangeForLinkPopover(ctx);
  document.addEventListener('selectionchange', onSelectionChange);

  function restoreFromSnapshot(): void {
    if (!ctx.editingSnapshot) return;
    textElement.content = JSON.parse(JSON.stringify(ctx.editingSnapshot)) as InlineRun[];
    ctx.rebuildElement(elementId);
  }

  function finish(commit: boolean): void {
    inner!.removeAttribute('contenteditable');
    // Restore the overflow-clip on the wrapper now the edit is over. Pairs
    // with the setAttribute('data-editing', 'true') above.
    (wrapper as HTMLElement).removeAttribute('data-editing');
    inner!.removeEventListener('blur', onBlur);
    inner!.removeEventListener('keydown', onKey);
    document.removeEventListener('selectionchange', onSelectionChange);
    removeMarkToolbar(ctx);
    removeLinkPopoverImpl(ctx);
    const snapshot = ctx.editingSnapshot;
    ctx.editingElementId = null;
    ctx.editingSnapshot = null;
    ctx.activeEditFinish = null;
    if (!commit) {
      // Restore the visible DOM too — the user may have pressed marks.
      textElement.content = JSON.parse(JSON.stringify(snapshot)) as InlineRun[];
      ctx.rebuildElement(elementId);
      return;
    }
    let runs: InlineRun[];
    try {
      runs = ctx.serializeContentToRuns(inner!);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus('Link rejected: ' + message, 'error');
      // Loud failure — do not commit, restore pre-edit content.
      textElement.content = JSON.parse(JSON.stringify(snapshot)) as InlineRun[];
      ctx.rebuildElement(elementId);
      return;
    }
    if (runs.length === 0 || ctx.plainTextOf(runs).length === 0) {
      ctx.setStatus("Text can't be empty", 'error');
      textElement.content = JSON.parse(JSON.stringify(snapshot)) as InlineRun[];
      ctx.rebuildElement(elementId);
      return;
    }
    textElement.content = runs;
    ctx.rebuildElement(elementId);
    ctx.scheduleSave();
  }
  function onBlur(ev: FocusEvent): void {
    // Ignore blur events caused by clicks on the mark toolbar buttons —
    // those keep the editor in edit mode by design.
    const next = ev.relatedTarget as Node | null;
    if (next && ctx.markToolbar && ctx.markToolbar.contains(next)) return;
    if (next && ctx.linkPopover && ctx.linkPopover.contains(next)) return;
    if (ctx.modalOpen) return;
    finish(true);
  }
  function onKey(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      finish(false);
      inner!.blur();
      return;
    }
    const mod = ev.ctrlKey || ev.metaKey;
    if (!mod) return;
    const key = (ev.key || '').toLowerCase();
    if (key === 'b') {
      ev.preventDefault();
      applyMarkImpl(ctx, 'bold');
      return;
    }
    if (key === 'i') {
      ev.preventDefault();
      applyMarkImpl(ctx, 'italic');
      return;
    }
    if (key === 'u') {
      ev.preventDefault();
      applyMarkImpl(ctx, 'underline');
      return;
    }
    if (ev.shiftKey && key === 'x') {
      ev.preventDefault();
      applyMarkImpl(ctx, 'strike');
      return;
    }
    if (key === 'k') {
      ev.preventDefault();
      applyMarkImpl(ctx, 'link');
      return;
    }
  }
  inner.addEventListener('blur', onBlur);
  inner.addEventListener('keydown', onKey);

  ctx.activeEditFinish = function () {
    finish(true);
  };

  // restoreFromSnapshot is only used by the IIFE twin's external callers
  // (none in scope today); expose-via-closure here so the unused-symbol
  // lint doesn't trip. Tracks the IIFE-twin shape verbatim.
  void restoreFromSnapshot;
}
