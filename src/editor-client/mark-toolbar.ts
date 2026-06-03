// src/editor-client/mark-toolbar.ts
//
// ADR 0058 Phase 2q.g — inline mark toolbar + mark application.
// canvas-client.ts:9224-10132 carries the inline twin; retires on
// ADR 0015 Phase 3 atomic cutover.
//
// Two surfaces live here, glued together by the toolbar being the only
// caller-side trigger for the mark-application functions:
//
//   1. The floating "inline formatting" toolbar shown above a text element
//      being edited (bold/italic/underline/strike/highlight/link + font-size
//      select + alignment buttons + color swatch + AI rewrite). The toolbar
//      is a singleton DOM node appended to document.body using
//      position: fixed so it stays viewport-anchored as the canvas scrolls.
//
//   2. The mark-application path (applyMark + helpers). Toggles for
//      attribute-free marks go through `toggleSimpleMarkInSelection` which
//      serialises the editable, mutates the serialized runs, and rebuilds
//      the DOM from the result — the hand-rolled DOM-surgery path produced
//      nested marks the unwrap path couldn't fully undo. Bold/italic/
//      underline still go through `document.execCommand` because the
//      browser-native path handles their toggle correctly. Link marks
//      route through `applyLinkMark` which opens the link modal and
//      replaces the link on every run in the slice.
//
// String escape note: the inline IIFE body lives inside an outer TS
// template literal, so it uses doubled `"\\n"` source to ship a literal
// `"\n"` runtime string. This extracted module is a normal TS source
// file (NOT a template literal), so single backslash escapes (e.g. the
// `'\n'` in `setFontSizeOnRuns`'s splice path) are safe and used
// directly.
//
// Mark toolbar reflow listeners (window scroll/resize) are registered
// in `createEditor` against `ctx.onMarkToolbarReflow` (typeof-gated for
// camera-fires-before-toolbar boot order); the listener wiring stays
// inline in canvas-client.ts during Phase 2.
//
// Inline IIFE in canvas-client.ts is UNCHANGED — this module is the
// Phase 3 cutover destination, not a live call site yet.

import type {
  CanvasElement,
  ElementStyle,
  InlineMark,
  InlineMarkType,
  InlineRun,
} from '../canvas/schema.js';
import type { TextAlign } from '../canvas/elements/text.js';
import type { EditorContext } from './editor-context.js';
import { CANONICAL_MARK_ORDER } from './editor-constants.js';
import {
  INLINE_FONT_SIZE_PX_MIN,
  INLINE_FONT_SIZE_PX_MAX,
} from './shared-constants.js';
import { cssEscape } from './css-escape.js';

// Standard preset list for the font-size select; mirrors the inline IIFE
// twin verbatim. Owners rarely need a custom value — when they do, paste
// from a styled source still lands a fresh px through normalizePastedHtml.
const FONT_SIZE_PRESETS: readonly number[] = [
  12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96,
];

// Vertical offset above the anchor's top edge. The toolbar uses
// position: fixed so the y is in viewport coords; we keep the same 44px
// gap the IIFE twin uses so the affordance stays close enough for the
// Owner's cursor without overlapping the text element.
const TOOLBAR_ANCHOR_OFFSET_PX = 44;

// Refresh the toolbar font-size <select> to reflect the current selection.
// Walks ancestors from the selection anchor; the innermost span carrying
// an inline font-size wins (matches the buildRunNode and serializer rules).
// No font-size in scope → select shows the "Size" placeholder.
export function refreshMarkToolbarFontSizeStateImpl(ctx: EditorContext): void {
  if (!ctx.markToolbar) return;
  const sel = document.getSelection();
  const picker = ctx.markToolbar.querySelector<HTMLSelectElement>('[data-mark-fontsize]');
  if (!picker) return;
  if (!sel || sel.rangeCount === 0) {
    picker.value = '';
    return;
  }
  const node = sel.anchorNode;
  if (!node) {
    picker.value = '';
    return;
  }
  let cur: Node | null = node.nodeType === 1 ? node : node.parentNode;
  let px: number | null = null;
  while (cur && cur.nodeType === 1) {
    const curEl = cur as HTMLElement;
    if (curEl.tagName === 'SPAN' && curEl.style && curEl.style.fontSize) {
      const parsed = parseFloat(curEl.style.fontSize);
      if (Number.isFinite(parsed)) {
        px = parsed;
        break;
      }
    }
    // Stop walking when we leave the editable subtree so an ancestor
    // font-size on the canvas chrome can't leak into the picker reading.
    if (curEl.getAttribute && curEl.getAttribute('contenteditable') === 'true') break;
    cur = curEl.parentNode;
  }
  picker.value = px === null ? '' : String(px);
}

export function removeMarkToolbar(ctx: EditorContext): void {
  if (ctx.markToolbar && ctx.markToolbar.parentNode) {
    ctx.markToolbar.parentNode.removeChild(ctx.markToolbar);
  }
  ctx.markToolbar = null;
  ctx.markToolbarAnchor = null;
}

export function positionMarkToolbar(ctx: EditorContext, anchor: HTMLElement | null): void {
  if (!ctx.markToolbar || !anchor) return;
  // The toolbar is appended to document.body and uses position: fixed,
  // so top/left are in viewport coordinates. getBoundingClientRect()
  // already returns viewport-relative coords, so we just anchor 44px
  // above the element's current top edge.
  const rect = anchor.getBoundingClientRect();
  const top = rect.top - TOOLBAR_ANCHOR_OFFSET_PX;
  const left = rect.left;
  ctx.markToolbar.style.top = Math.max(0, top) + 'px';
  ctx.markToolbar.style.left = Math.max(0, left) + 'px';
}

// Listeners check markToolbarAnchor each call — they're cheap no-ops when
// no text is in edit mode.
export function onMarkToolbarReflowImpl(ctx: EditorContext): void {
  if (ctx.markToolbarAnchor) positionMarkToolbar(ctx, ctx.markToolbarAnchor);
  if (ctx.linkPopoverAnchor) positionLinkPopover(ctx, ctx.linkPopoverAnchor);
}

// Re-position the popover when scroll/resize fires. Local helper rather
// than importing link-popover.ts to avoid a circular dep — both
// modules ship in the same Phase 2q.g extraction and the renderer is
// trivial. The link-popover.ts public `positionLinkPopover` mirrors this
// implementation verbatim.
function positionLinkPopover(ctx: EditorContext, anchorEl: HTMLElement | null): void {
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

function applyExecCommand(command: string): void {
  // execCommand is deprecated but it is by far the simplest way to apply
  // bold/italic/underline/strike to the current Selection inside a
  // contenteditable. Once browsers drop it we will rewrite this with the
  // Range APIs. For the POC we lean on it.
  document.execCommand(command, false, '');
}

function closestEditableRoot(node: Node | null): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  if (!element) return null;
  return element.closest<HTMLElement>('[contenteditable="true"]');
}

// Apply a link mark across the current selection via the same serialize →
// mutate runs → rebuild path used for highlight/strike/code. The old DOM-
// level Range.surroundContents path produced nested <a> when the selection
// overlapped an existing link (same nesting failure mode that made the
// highlight toggle unreliable). Setting the link mark at the run level
// replaces any existing link on each run in the slice — overwriting one
// href with another in a single click instead of nesting.
async function applyLinkMark(ctx: EditorContext): Promise<void> {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    ctx.setStatus('Select some text first to add a link', 'error');
    return;
  }
  const inner = closestEditableRoot(range.commonAncestorContainer);
  if (!inner) return;

  const preStart = document.createRange();
  preStart.setStart(inner, 0);
  preStart.setEnd(range.startContainer, range.startOffset);
  const startOff = preStart.toString().length;
  const preEnd = document.createRange();
  preEnd.setStart(inner, 0);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const endOff = preEnd.toString().length;
  const start = Math.min(startOff, endOff);
  const end = Math.max(startOff, endOff);
  if (start === end) return;

  // Pre-fill the modal from any existing link the selection overlaps so
  // re-clicking Link on an already-linked span lands an Edit affordance
  // rather than forcing the Owner to type the URL again.
  let existingHref = 'https://';
  let existingBlank = true;
  let ancNode: Node | null =
    range.startContainer.nodeType === 1
      ? range.startContainer
      : range.startContainer.parentNode;
  while (ancNode && ancNode !== inner) {
    const el = ancNode as Element;
    if (
      ancNode.nodeType === 1 &&
      el.tagName === 'A' &&
      el.classList &&
      el.classList.contains('opencanvas-inline-link')
    ) {
      existingHref = el.getAttribute('href') || existingHref;
      existingBlank = el.getAttribute('target') === '_blank';
      break;
    }
    ancNode = ancNode.parentNode;
  }

  const selectedText = range.toString();
  const result = await ctx.openLinkModal({
    linkText: selectedText,
    href: existingHref,
    blank: existingBlank,
    focusAfterClose: inner,
  });
  if (result === null) return;

  let runs: InlineRun[];
  try {
    runs = ctx.serializeContentToRuns(inner);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Link failed: ' + message, 'error');
    return;
  }

  const linkMark: Extract<InlineMark, { type: 'link' }> = {
    type: 'link',
    href: result.href,
  };
  if (result.target === '_blank') linkMark.target = '_blank';
  const nextRuns = setLinkOnRuns(ctx, runs, start, end, linkMark);

  while (inner.firstChild) inner.removeChild(inner.firstChild);
  for (let i = 0; i < nextRuns.length; i++) {
    const run = nextRuns[i];
    if (run) inner.appendChild(ctx.buildRunNode(run));
  }

  inner.focus();
  selectByCharBounds(inner, start, end);
}

// Apply (or clear) a fontSize mark to the slice [start, end) of runs.
// px=null removes the mark; otherwise replaces any existing fontSize in the
// slice with the new px. Mirrors setLinkOnRuns but for the px-attr variant.
function setFontSizeOnRuns(
  ctx: EditorContext,
  runs: InlineRun[],
  start: number,
  end: number,
  px: number | null,
): InlineRun[] {
  const split: InlineRun[] = [];
  let cum = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    const text = typeof run.text === 'string' ? run.text : '';
    const s = cum;
    const e = cum + text.length;
    const bps: number[] = [0];
    if (start > s && start < e) bps.push(start - s);
    if (end > s && end < e) bps.push(end - s);
    bps.push(text.length);
    for (let j = 0; j < bps.length - 1; j++) {
      const a = bps[j]!;
      const b = bps[j + 1]!;
      if (b > a) {
        split.push({ text: text.substring(a, b), marks: cloneMarksArr(run.marks) });
      }
    }
    cum = e;
  }

  cum = 0;
  for (let k = 0; k < split.length; k++) {
    const sr = split[k]!;
    const rs = cum;
    const re = cum + sr.text.length;
    cum = re;
    if (re <= start || rs >= end) continue;
    sr.marks = (sr.marks || []).filter((mm) => mm.type !== 'fontSize');
    if (px !== null) sr.marks.push({ type: 'fontSize', px: px });
  }

  const merged: InlineRun[] = [];
  for (let p = 0; p < split.length; p++) {
    const cur = split[p]!;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && ctx.marksEqual(prev.marks || [], cur.marks || [])) {
      prev.text += cur.text;
    } else {
      const next: InlineRun = { text: cur.text };
      if (cur.marks !== undefined) next.marks = cur.marks;
      merged.push(next);
    }
  }
  return merged;
}

function applyFontSizeMark(ctx: EditorContext, px: number | null): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    ctx.setStatus('Select some text first to change size', 'error');
    return;
  }
  const inner = closestEditableRoot(range.commonAncestorContainer);
  if (!inner) return;

  const preStart = document.createRange();
  preStart.setStart(inner, 0);
  preStart.setEnd(range.startContainer, range.startOffset);
  const startOff = preStart.toString().length;
  const preEnd = document.createRange();
  preEnd.setStart(inner, 0);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const endOff = preEnd.toString().length;
  const start = Math.min(startOff, endOff);
  const end = Math.max(startOff, endOff);
  if (start === end) return;

  let runs: InlineRun[];
  try {
    runs = ctx.serializeContentToRuns(inner);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Font size failed: ' + message, 'error');
    return;
  }

  const nextRuns = setFontSizeOnRuns(ctx, runs, start, end, px);

  while (inner.firstChild) inner.removeChild(inner.firstChild);
  for (let ri = 0; ri < nextRuns.length; ri++) {
    const run = nextRuns[ri];
    if (run) inner.appendChild(ctx.buildRunNode(run));
  }

  inner.focus();
  selectByCharBounds(inner, start, end);
}

// Apply a single link mark to the slice [start, end) of runs, replacing
// any existing link mark in that slice. Mirrors toggleMarkOnRuns but with
// "replace" semantics specific to link attrs (href / target) — toggling a
// simple boolean mark doesn't apply because two different hrefs aren't
// interchangeable like two highlights are.
function setLinkOnRuns(
  ctx: EditorContext,
  runs: InlineRun[],
  start: number,
  end: number,
  linkMark: Extract<InlineMark, { type: 'link' }>,
): InlineRun[] {
  const split: InlineRun[] = [];
  let cum = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    const text = typeof run.text === 'string' ? run.text : '';
    const s = cum;
    const e = cum + text.length;
    const bps: number[] = [0];
    if (start > s && start < e) bps.push(start - s);
    if (end > s && end < e) bps.push(end - s);
    bps.push(text.length);
    for (let j = 0; j < bps.length - 1; j++) {
      const a = bps[j]!;
      const b = bps[j + 1]!;
      if (b > a) {
        split.push({ text: text.substring(a, b), marks: cloneMarksArr(run.marks) });
      }
    }
    cum = e;
  }

  cum = 0;
  for (let k = 0; k < split.length; k++) {
    const sr = split[k]!;
    const rs = cum;
    const re = cum + sr.text.length;
    cum = re;
    if (re <= start || rs >= end) continue;
    sr.marks = (sr.marks || []).filter((mm) => mm.type !== 'link');
    const fresh: Extract<InlineMark, { type: 'link' }> = {
      type: 'link',
      href: linkMark.href,
    };
    if (linkMark.target === '_blank') fresh.target = '_blank';
    sr.marks.push(fresh);
  }

  const merged: InlineRun[] = [];
  for (let p = 0; p < split.length; p++) {
    const cur = split[p]!;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && ctx.marksEqual(prev.marks || [], cur.marks || [])) {
      prev.text += cur.text;
    } else {
      const next: InlineRun = { text: cur.text };
      if (cur.marks !== undefined) next.marks = cur.marks;
      merged.push(next);
    }
  }
  return merged;
}

// Toggle a simple (no-attrs) mark across the current selection by mutating
// the serialized InlineRun[], not the DOM tree directly. Hand-rolled DOM
// surgery (Range.surroundContents + extractContents fallback) produced
// nested marks when the selection partially overlapped an existing mark
// and only unwrapped the outermost layer on toggle-off — both observed by
// owners as "double highlight" and "unhighlight leaves part highlighted."
//
// The new path:
//   1. Serialize the live contenteditable to InlineRun[] (the serializer
//      already dedupes nested same-type marks).
//   2. Convert the selection's start/end to character offsets relative to
//      the editable's text content using Range.toString().
//   3. Split runs at those offsets so the selection slice is a contiguous
//      subarray.
//   4. Decide toggle direction: if every run in the slice already carries
//      the mark, remove it; otherwise add it to every run in the slice.
//      This is the Google Docs / Notion convention — partial selections
//      always converge to "uniform" in one click.
//   5. Re-merge adjacent identical-mark runs and rebuild the editable's
//      inner DOM via the same buildRunNode path used at full render.
//   6. Restore the selection at the same character offsets.
//
// Only used for marks without per-mark attributes (highlight, strike,
// code). Bold/italic/underline still use execCommand because the browser-
// native path handles their toggle correctly. Link marks go through their
// own applyLinkMark flow because they need the URL modal.
function toggleSimpleMarkInSelection(ctx: EditorContext, markType: InlineMarkType): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return;
  const inner = closestEditableRoot(range.commonAncestorContainer);
  if (!inner) return;

  const preStart = document.createRange();
  preStart.setStart(inner, 0);
  preStart.setEnd(range.startContainer, range.startOffset);
  const startOff = preStart.toString().length;
  const preEnd = document.createRange();
  preEnd.setStart(inner, 0);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const endOff = preEnd.toString().length;
  const start = Math.min(startOff, endOff);
  const end = Math.max(startOff, endOff);
  if (start === end) return;

  let runs: InlineRun[];
  try {
    runs = ctx.serializeContentToRuns(inner);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Mark toggle failed: ' + message, 'error');
    return;
  }

  const nextRuns = toggleMarkOnRuns(ctx, runs, start, end, markType);

  while (inner.firstChild) inner.removeChild(inner.firstChild);
  for (let i = 0; i < nextRuns.length; i++) {
    const run = nextRuns[i];
    if (run) inner.appendChild(ctx.buildRunNode(run));
  }

  inner.focus();
  selectByCharBounds(inner, start, end);
}

// Apply a mark-set transformation on a serialized InlineRun[]. See
// toggleSimpleMarkInSelection for the rationale; this is the pure step.
function toggleMarkOnRuns(
  ctx: EditorContext,
  runs: InlineRun[],
  start: number,
  end: number,
  markType: InlineMarkType,
): InlineRun[] {
  const split: InlineRun[] = [];
  let cum = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (!run) continue;
    const text = typeof run.text === 'string' ? run.text : '';
    const s = cum;
    const e = cum + text.length;
    const bps: number[] = [0];
    if (start > s && start < e) bps.push(start - s);
    if (end > s && end < e) bps.push(end - s);
    bps.push(text.length);
    for (let j = 0; j < bps.length - 1; j++) {
      const a = bps[j]!;
      const b = bps[j + 1]!;
      if (b > a) {
        split.push({ text: text.substring(a, b), marks: cloneMarksArr(run.marks) });
      }
    }
    cum = e;
  }

  cum = 0;
  let fullyCovered = true;
  let anyInRange = false;
  for (let k = 0; k < split.length; k++) {
    const sr = split[k]!;
    const rs = cum;
    const re = cum + sr.text.length;
    cum = re;
    if (re <= start || rs >= end) continue;
    anyInRange = true;
    if (!hasMarkInArr(sr.marks || [], markType)) fullyCovered = false;
  }
  if (!anyInRange) return runs;

  cum = 0;
  for (let m = 0; m < split.length; m++) {
    const rr = split[m]!;
    const rs2 = cum;
    const re2 = cum + rr.text.length;
    cum = re2;
    if (re2 <= start || rs2 >= end) continue;
    if (fullyCovered) {
      rr.marks = (rr.marks || []).filter((mm) => mm.type !== markType);
    } else if (!hasMarkInArr(rr.marks || [], markType)) {
      (rr.marks ||= []).push({ type: markType } as InlineMark);
    }
  }

  const merged: InlineRun[] = [];
  for (let p = 0; p < split.length; p++) {
    const cur = split[p]!;
    const prev = merged.length > 0 ? merged[merged.length - 1] : null;
    if (prev && ctx.marksEqual(prev.marks || [], cur.marks || [])) {
      prev.text += cur.text;
    } else {
      const next: InlineRun = { text: cur.text };
      if (cur.marks !== undefined) next.marks = cur.marks;
      merged.push(next);
    }
  }
  return merged;
}

function cloneMarksArr(marks: InlineMark[] | undefined): InlineMark[] {
  if (!Array.isArray(marks)) return [];
  return marks.map((m) => {
    if (m.type === 'link') {
      const c: Extract<InlineMark, { type: 'link' }> = { type: 'link', href: m.href };
      if (m.target) c.target = m.target;
      return c;
    }
    if (m.type === 'fontSize') {
      return { type: 'fontSize', px: m.px };
    }
    // Boolean-only marks (bold/italic/underline/strike/code/highlight).
    return { type: m.type };
  });
}

function hasMarkInArr(marks: InlineMark[], markType: InlineMarkType): boolean {
  if (!Array.isArray(marks)) return false;
  for (let i = 0; i < marks.length; i++) {
    const mark = marks[i];
    if (mark && mark.type === markType) return true;
  }
  return false;
}

export function selectByCharBounds(rootNode: Node, start: number, end: number): void {
  let startNode: Node | null = null;
  let startInOff = 0;
  let endNode: Node | null = null;
  let endInOff = 0;
  let cum = 0;
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null);
  let n: Node | null = walker.nextNode();
  while (n) {
    const len = n.nodeValue ? n.nodeValue.length : 0;
    if (!startNode && cum + len >= start) {
      startNode = n;
      startInOff = start - cum;
    }
    if (!endNode && cum + len >= end) {
      endNode = n;
      endInOff = end - cum;
    }
    if (startNode && endNode) break;
    cum += len;
    n = walker.nextNode();
  }
  if (!startNode || !endNode) return;
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  const r = document.createRange();
  r.setStart(startNode, startInOff);
  r.setEnd(endNode, endInOff);
  sel.addRange(r);
}

export function applyMarkImpl(ctx: EditorContext, type: InlineMarkType): void {
  if (type === 'bold') return applyExecCommand('bold');
  if (type === 'italic') return applyExecCommand('italic');
  if (type === 'underline') return applyExecCommand('underline');
  if (type === 'strike') return toggleSimpleMarkInSelection(ctx, 'strike');
  if (type === 'code') return toggleSimpleMarkInSelection(ctx, 'code');
  if (type === 'highlight') return toggleSimpleMarkInSelection(ctx, 'highlight');
  if (type === 'link') {
    applyLinkMark(ctx).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus('Link failed: ' + message, 'error');
    });
    return;
  }
}

// Apply an element-level field change while a text element is in edit mode.
// We mutate the data model AND mirror the new value into the live .opencanvas-text
// inline style so the change is visible immediately without a rebuild — a
// rebuild would tear down the contenteditable and drop the caret.
function applyAlignToEditing(ctx: EditorContext, direction: TextAlign): void {
  if (!ctx.editingElementId) return;
  const found = ctx.findElement(ctx.editingElementId);
  if (!found || found.element.type !== 'text') return;
  found.element.align = direction;
  if (!ctx.root) return;
  const wrapper = ctx.root.querySelector(
    '[data-opencanvas-element="' + cssEscape(ctx.editingElementId) + '"]',
  );
  const inner = wrapper ? wrapper.querySelector('.opencanvas-text') : null;
  if (inner) (inner as HTMLElement).style.textAlign = direction;
  refreshMarkToolbarAlignState(ctx);
  ctx.scheduleSave();
}

// Element-level text color, applied via elementStyle.color — same field
// the inspector "Style" block writes (see render.ts applyElementStyle).
// Color inherits, so we set it on the wrapper to mirror the renderer.
function applyTextColorToEditing(ctx: EditorContext, color: string): void {
  if (!ctx.editingElementId) return;
  const found = ctx.findElement(ctx.editingElementId);
  if (!found || found.element.type !== 'text') return;
  const element: CanvasElement = found.element;
  const es: ElementStyle = element.elementStyle || {};
  if (color) {
    es.color = color;
  } else {
    delete es.color;
  }
  let anyKey = false;
  for (const k in es) {
    if ((es as Record<string, unknown>)[k] !== undefined) {
      anyKey = true;
      break;
    }
  }
  if (anyKey) {
    element.elementStyle = es;
  } else {
    delete element.elementStyle;
  }
  if (!ctx.root) return;
  const wrapper = ctx.root.querySelector(
    '[data-opencanvas-element="' + cssEscape(ctx.editingElementId) + '"]',
  );
  if (wrapper) (wrapper as HTMLElement).style.color = color || '';
  ctx.scheduleSave();
}

function refreshMarkToolbarAlignState(ctx: EditorContext): void {
  if (!ctx.markToolbar || !ctx.editingElementId) return;
  const found = ctx.findElement(ctx.editingElementId);
  if (!found || found.element.type !== 'text') return;
  const current = found.element.align;
  const btns = ctx.markToolbar.querySelectorAll('[data-mark-align]');
  for (let i = 0; i < btns.length; i++) {
    const b = btns[i] as HTMLElement;
    if (b.getAttribute('data-mark-align') === current) {
      b.setAttribute('aria-pressed', 'true');
      b.classList.add('active');
    } else {
      b.setAttribute('aria-pressed', 'false');
      b.classList.remove('active');
    }
  }
}

// Label set for the boolean-only mark buttons. fontSize is handled by the
// <select> below (numeric payload, not a boolean toggle).
const MARK_BUTTON_LABELS: Readonly<Partial<Record<InlineMarkType, string>>> = {
  bold: 'B',
  italic: 'I',
  underline: 'U',
  strike: 'S',
  highlight: 'HL',
  link: 'Link',
};

export function buildMarkToolbarImpl(ctx: EditorContext, anchor: HTMLElement): void {
  removeMarkToolbar(ctx);
  const bar = document.createElement('div');
  bar.className = 'opencanvas-mark-toolbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Inline formatting');
  const dragBtn = document.createElement('button');
  dragBtn.type = 'button';
  dragBtn.className = 'opencanvas-mark-drag';
  dragBtn.setAttribute('data-mark-drag', 'true');
  dragBtn.setAttribute('aria-label', 'Drag to move');
  dragBtn.title = 'Drag to move';
  dragBtn.innerHTML =
    '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
    '<circle cx="5.5" cy="4" r="1.2" fill="currentColor"/>' +
    '<circle cx="10.5" cy="4" r="1.2" fill="currentColor"/>' +
    '<circle cx="5.5" cy="8" r="1.2" fill="currentColor"/>' +
    '<circle cx="10.5" cy="8" r="1.2" fill="currentColor"/>' +
    '<circle cx="5.5" cy="12" r="1.2" fill="currentColor"/>' +
    '<circle cx="10.5" cy="12" r="1.2" fill="currentColor"/>' +
    '</svg>';
  // mousedown.preventDefault() keeps the contenteditable selection alive
  // while we initiate the drag on the parent text element wrapper.
  dragBtn.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    if (!ctx.editingElementId || !ctx.root) return;
    const wrapper = ctx.root.querySelector(
      '[data-opencanvas-element="' + cssEscape(ctx.editingElementId) + '"]',
    );
    if (!wrapper) return;
    ctx.beginDrag(ev, wrapper as HTMLElement);
  });
  bar.appendChild(dragBtn);
  // The inline-code mark is intentionally absent from the toolbar — owners
  // never reach for it during normal copy editing and its glyph crowded
  // the bar. Existing runs with code marks still render via the public-
  // styles <code> rule, but new code wraps can only land through the
  // canvas agent or paste from a code-formatted source.
  // fontSize is handled by the size <select> below (not the per-mark loop)
  // because it carries a numeric payload rather than a boolean toggle.
  for (let i = 0; i < CANONICAL_MARK_ORDER.length; i++) {
    const type = CANONICAL_MARK_ORDER[i];
    if (!type || type === 'code' || type === 'fontSize') continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = MARK_BUTTON_LABELS[type] || '';
    btn.setAttribute('data-mark', type);
    // Keep focus inside the contenteditable so the Selection survives the click.
    btn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
    });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      applyMarkImpl(ctx, type);
    });
    bar.appendChild(btn);
  }

  // -- Font size picker ------------------------------------------------
  // <select> driving the fontSize InlineMark across the current selection.
  // Empty value === "no fontSize mark" (the run inherits the TextElement's
  // own fontSize). Preset list covers the typical heading-down-to-caption
  // span so owners rarely need a custom value.
  const sizeSelect = document.createElement('select');
  sizeSelect.className = 'opencanvas-mark-size';
  sizeSelect.setAttribute('data-mark-fontsize', 'true');
  sizeSelect.setAttribute('aria-label', 'Font size (px)');
  sizeSelect.title = 'Font size (px)';
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Size';
  sizeSelect.appendChild(defaultOpt);
  for (let sp = 0; sp < FONT_SIZE_PRESETS.length; sp++) {
    const preset = FONT_SIZE_PRESETS[sp]!;
    const opt = document.createElement('option');
    opt.value = String(preset);
    opt.textContent = String(preset);
    sizeSelect.appendChild(opt);
  }
  sizeSelect.addEventListener('mousedown', function (ev) {
    ev.stopPropagation();
  });
  sizeSelect.addEventListener('change', function (ev) {
    ev.preventDefault();
    const raw = sizeSelect.value;
    const px = raw === '' ? null : parseFloat(raw);
    if (
      px !== null &&
      (!Number.isFinite(px) || px < INLINE_FONT_SIZE_PX_MIN || px > INLINE_FONT_SIZE_PX_MAX)
    ) {
      return;
    }
    applyFontSizeMark(ctx, px);
  });
  bar.appendChild(sizeSelect);

  // -- Alignment block --------------------------------------------------
  // Element-level alignment buttons mirror the inspector's align select
  // (left/center/right). Pressed state is refreshed after each apply via
  // refreshMarkToolbarAlignState — and once below after the toolbar is
  // attached, so the initial state matches element.align.
  const sep1 = document.createElement('span');
  sep1.className = 'opencanvas-mark-sep';
  sep1.setAttribute('aria-hidden', 'true');
  bar.appendChild(sep1);

  const alignDirs: TextAlign[] = ['left', 'center', 'right'];
  const alignTitles: Record<TextAlign, string> = {
    left: 'Align left',
    center: 'Align center',
    right: 'Align right',
  };
  const alignSvg: Record<TextAlign, string> = {
    left:
      '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
      '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="2" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
      '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="2" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
    center:
      '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
      '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="4" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
      '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="4" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
    right:
      '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
      '<rect x="2" y="3" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="6" y="6.2" width="8" height="1.6" fill="currentColor"/>' +
      '<rect x="2" y="9.4" width="12" height="1.6" fill="currentColor"/>' +
      '<rect x="6" y="12.6" width="8" height="1.6" fill="currentColor"/></svg>',
  };
  for (let ai = 0; ai < alignDirs.length; ai++) {
    const dir = alignDirs[ai]!;
    const ab = document.createElement('button');
    ab.type = 'button';
    ab.className = 'opencanvas-mark-align';
    ab.setAttribute('data-mark-align', dir);
    ab.setAttribute('aria-label', alignTitles[dir]);
    ab.title = alignTitles[dir];
    ab.innerHTML = alignSvg[dir];
    ab.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    ab.addEventListener('click', function (ev) {
      ev.preventDefault();
      applyAlignToEditing(ctx, dir);
    });
    bar.appendChild(ab);
  }

  // -- Text color block -------------------------------------------------
  // Element-level color via elementStyle.color. The native <input type="color">
  // is hidden behind the swatch button — clicking the swatch triggers the
  // browser's color picker. The swatch fill mirrors the current color so
  // the user can see the active value without opening the picker.
  const sep2 = document.createElement('span');
  sep2.className = 'opencanvas-mark-sep';
  sep2.setAttribute('aria-hidden', 'true');
  bar.appendChild(sep2);

  let initColor = '#222222';
  const foundInit = ctx.editingElementId ? ctx.findElement(ctx.editingElementId) : null;
  if (
    foundInit &&
    foundInit.element &&
    foundInit.element.elementStyle &&
    foundInit.element.elementStyle.color
  ) {
    initColor = foundInit.element.elementStyle.color;
  }
  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'opencanvas-mark-color';
  colorBtn.setAttribute('aria-label', 'Text color');
  colorBtn.title = 'Text color';
  // Color-wheel SVG: six pie segments + a centered circle whose fill mirrors
  // the active color. The wheel reads as "change color" at a glance; the
  // center dot tells you what's currently picked. Replaces the previous "A"
  // + underline-swatch that authors found ambiguous.
  colorBtn.innerHTML =
    '<svg class="opencanvas-mark-color-wheel" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
    '<path d="M8 8 L8 2 A6 6 0 0 1 13.196 5 Z" fill="#ef4444"/>' +
    '<path d="M8 8 L13.196 5 A6 6 0 0 1 13.196 11 Z" fill="#f59e0b"/>' +
    '<path d="M8 8 L13.196 11 A6 6 0 0 1 8 14 Z" fill="#10b981"/>' +
    '<path d="M8 8 L8 14 A6 6 0 0 1 2.804 11 Z" fill="#06b6d4"/>' +
    '<path d="M8 8 L2.804 11 A6 6 0 0 1 2.804 5 Z" fill="#3b82f6"/>' +
    '<path d="M8 8 L2.804 5 A6 6 0 0 1 8 2 Z" fill="#8b5cf6"/>' +
    '<circle class="opencanvas-mark-color-dot" cx="8" cy="8" r="3" stroke="#ffffff" stroke-width="1.2"/>' +
    '</svg>';
  const colorDot = colorBtn.querySelector('.opencanvas-mark-color-dot');
  if (colorDot) colorDot.setAttribute('fill', initColor);
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = initColor;
  colorInput.className = 'opencanvas-mark-color-input';
  colorInput.setAttribute('aria-hidden', 'true');
  colorInput.tabIndex = -1;
  colorBtn.appendChild(colorInput);
  colorBtn.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
  });
  colorBtn.addEventListener('click', function (ev) {
    // The hidden input is inside the button — pressing the button bubbles a
    // click here. Only forward to the native picker when the event target was
    // the button itself, not the input.
    if (ev.target === colorInput) return;
    ev.preventDefault();
    colorInput.click();
  });
  colorInput.addEventListener('input', function () {
    const v = colorInput.value;
    if (colorDot) colorDot.setAttribute('fill', v);
    applyTextColorToEditing(ctx, v);
  });
  bar.appendChild(colorBtn);

  // -- AI rewrite button ------------------------------------------------
  // Same handler the inspector's "AI rewrite" button uses (aiRewriteText).
  // Surfaced in the toolbar so the author can rewrite without leaving the
  // selection — Notion/Gamma-style inline AI affordance.
  const aiBtn = document.createElement('button');
  aiBtn.type = 'button';
  aiBtn.className = 'opencanvas-mark-ai';
  aiBtn.setAttribute('aria-label', 'Rewrite with AI');
  aiBtn.title = 'Rewrite with AI';
  aiBtn.textContent = 'AI';
  aiBtn.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
  });
  aiBtn.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (!ctx.editingElementId) return;
    ctx.aiRewriteText(ctx.editingElementId);
  });
  bar.appendChild(aiBtn);

  ctx.markToolbar = bar;
  ctx.markToolbarAnchor = anchor;
  // Append to document.body (NOT viewport or #canvas-root) so the
  // toolbar lives in viewport coordinate space and stays pinned via
  // position: fixed while the body scrolls.
  document.body.appendChild(bar);
  positionMarkToolbar(ctx, anchor);
  refreshMarkToolbarAlignState(ctx);
  refreshMarkToolbarFontSizeStateImpl(ctx);
}
