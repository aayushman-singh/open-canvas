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

import type { InlineMark, InlineMarkType, InlineRun } from '../canvas/schema.js';
import { INLINE_COLOR_HEX_RE } from '../canvas/schema.js';
import type { TextAlign } from '../canvas/elements/text.js';
import type {
  EditorContext,
  PersistContext,
  SelectionContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import type { LinkPopoverStateContext } from './link-popover.js';
import { CANONICAL_MARK_ORDER } from './editor-constants.js';
import { INLINE_FONT_SIZE_PX_MIN, INLINE_FONT_SIZE_PX_MAX } from './shared-constants.js';

// ADR 0064 — the run-mutation kernel shared by `setColorOnRuns`,
// `setFontSizeOnRuns`, `setLinkOnRuns`, and `toggleMarkOnRuns`. All four
// need `marksEqual` for the adjacent-run coalescing pass at the end.
export type RunMutationContext = Pick<EditorContext, 'marksEqual'>;

// ADR 0064 — the live-DOM mark-apply surface shared by every apply* /
// toggle* function. They read the live Selection, serialise the editable
// via `serializeContentToRuns`, mutate runs (RunMutationContext), rebuild
// the editable with `buildRunNode`, and surface failures via setStatus.
export type ApplyMarkBaseContext = RunMutationContext &
  StatusEmitterContext &
  Pick<EditorContext, 'serializeContentToRuns' | 'buildRunNode'>;

// ADR 0064 — `refreshMarkToolbarFontSizeStateImpl` only reads the toolbar
// root to find the <select>. No selection state, no mark application —
// the narrowest signature in the module.
export type RefreshMarkToolbarFontSizeStateContext = Pick<EditorContext, 'markToolbar'>;

// ADR 0064 — `removeMarkToolbar` clears both DOM slots. Pure toolbar
// state surface; no selection or persistence touched.
export type RemoveMarkToolbarContext = Pick<EditorContext, 'markToolbar' | 'markToolbarAnchor'>;

// ADR 0064 — `positionMarkToolbar` only reads `markToolbar` to measure
// and place the floating bar. Mirrors link-popover.ts's PositionLinkPopover
// alias — single-field shape.
export type PositionMarkToolbarContext = Pick<EditorContext, 'markToolbar'>;

// ADR 0064 — `onMarkToolbarReflowImpl` re-pins the toolbar AND the link
// popover on scroll/resize. Folds in `markToolbarAnchor` for the toolbar
// pin and `LinkPopoverStateContext` for the popover pin (the local
// `positionLinkPopover` reads `linkPopover`; the reflow itself also reads
// `linkPopoverAnchor` to decide whether to call it).
export type OnMarkToolbarReflowContext = Pick<EditorContext, 'markToolbar' | 'markToolbarAnchor'> &
  LinkPopoverStateContext;

// ADR 0064 — local `positionLinkPopover` helper. Same single-field shape
// as link-popover.ts's `PositionLinkPopoverContext`; we don't import that
// alias to keep this file circular-dep-free (see the helper's comment).
export type PositionLinkPopoverContext = Pick<EditorContext, 'linkPopover'>;

// ADR 0064 — `applyLinkMark` opens the link modal then routes through
// `setLinkOnRuns`. Adds `openLinkModal` to the shared apply base.
export type ApplyLinkMarkContext = ApplyMarkBaseContext & Pick<EditorContext, 'openLinkModal'>;

// ADR 0064 — `applyFontSizeMark` runs `setFontSizeOnRuns` on the serialised
// runs of the current selection. Pure apply-base surface.
export type ApplyFontSizeMarkContext = ApplyMarkBaseContext;

// ADR 0064 — `toggleSimpleMarkInSelection` is the bool-mark toggle path
// for strike/code/highlight. Pure apply-base surface.
export type ToggleSimpleMarkContext = ApplyMarkBaseContext;

// ADR 0064 — `applyMarkImpl` dispatches to `applyExecCommand` (no ctx),
// `toggleSimpleMarkInSelection`, or `applyLinkMark`. `ApplyLinkMarkContext`
// is the superset (its apply-base intersection already covers toggle).
export type ApplyMarkImplContext = ApplyLinkMarkContext;

// ADR 0064 — `applyAlignToEditing` mutates `element.align` for the text
// being edited and mirrors the value into the live DOM. Reads selection
// (editingElementId), state (findElement), the toolbar anchor wrapper,
// persistence (scheduleSave), plus `markToolbar` via `refreshMarkToolbarAlignState`.
export type ApplyAlignToEditingContext = SelectionContext &
  StateContext &
  PersistContext &
  Pick<EditorContext, 'markToolbar' | 'markToolbarAnchor'>;

// ADR 0064 — `applyColorMark` is the per-selection color path. Apply-base
// surface plus `scheduleSave` for the post-apply persistence kick.
export type ApplyColorMarkContext = ApplyMarkBaseContext & PersistContext;

// ADR 0064 — `refreshMarkToolbarAlignState` refreshes the pressed-state
// on the three align buttons. Reads `markToolbar` plus selection +
// state (editingElementId + findElement).
export type RefreshMarkToolbarAlignStateContext = SelectionContext &
  StateContext &
  Pick<EditorContext, 'markToolbar'>;

// ADR 0064 — `buildMarkToolbarImpl` is the top-level builder. It folds in
// every apply / refresh / remove surface above (each button wires into
// one of the apply* paths), the toolbar's own DOM slots, plus the
// drag-init verb (`beginDrag`) the drag handle calls and the AI-rewrite
// verb (`aiRewriteText`) the AI button calls. SelectionContext arrives
// via the apply / refresh intersections for `editingElementId`.
export type BuildMarkToolbarContext = RemoveMarkToolbarContext &
  PositionMarkToolbarContext &
  ApplyMarkImplContext &
  ApplyFontSizeMarkContext &
  ApplyAlignToEditingContext &
  ApplyColorMarkContext &
  RefreshMarkToolbarAlignStateContext &
  RefreshMarkToolbarFontSizeStateContext &
  Pick<EditorContext, 'beginDrag' | 'aiRewriteText'>;

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
export function refreshMarkToolbarFontSizeStateImpl(
  ctx: RefreshMarkToolbarFontSizeStateContext,
): void {
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

export function removeMarkToolbar(ctx: RemoveMarkToolbarContext): void {
  if (ctx.markToolbar && ctx.markToolbar.parentNode) {
    ctx.markToolbar.parentNode.removeChild(ctx.markToolbar);
  }
  ctx.markToolbar = null;
  ctx.markToolbarAnchor = null;
}

export function positionMarkToolbar(
  ctx: PositionMarkToolbarContext,
  anchor: HTMLElement | null,
): void {
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
export function onMarkToolbarReflowImpl(ctx: OnMarkToolbarReflowContext): void {
  if (ctx.markToolbarAnchor) positionMarkToolbar(ctx, ctx.markToolbarAnchor);
  if (ctx.linkPopoverAnchor) positionLinkPopover(ctx, ctx.linkPopoverAnchor);
}

// Re-position the popover when scroll/resize fires. Local helper rather
// than importing link-popover.ts to avoid a circular dep — both
// modules ship in the same Phase 2q.g extraction and the renderer is
// trivial. The link-popover.ts public `positionLinkPopover` mirrors this
// implementation verbatim.
function positionLinkPopover(
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
async function applyLinkMark(ctx: ApplyLinkMarkContext): Promise<void> {
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
  ctx: RunMutationContext,
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

function applyFontSizeMark(ctx: ApplyFontSizeMarkContext, px: number | null): void {
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
  ctx: RunMutationContext,
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
function toggleSimpleMarkInSelection(
  ctx: ToggleSimpleMarkContext,
  markType: InlineMarkType,
): void {
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
  ctx: RunMutationContext,
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
    if (m.type === 'color') {
      return { type: 'color', color: m.color };
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

export function applyMarkImpl(ctx: ApplyMarkImplContext, type: InlineMarkType): void {
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
//
// Wrapper sourcing: we use ctx.markToolbarAnchor (the wrapper passed to
// buildMarkToolbarImpl when the edit began). For site-pinned sections
// the same element id renders once per artboard, so a fresh
// `querySelector('[data-opencanvas-element=...]')` would always pick the
// first DOM match — and the style mirror would land on page 1 even when
// the Owner is editing page 3. rebuildElement still touches every
// instance on save, so the model is canonical; this preview-mirror
// just keeps the caret-bearing page visually in sync.
function applyAlignToEditing(ctx: ApplyAlignToEditingContext, direction: TextAlign): void {
  if (!ctx.editingElementId) return;
  const found = ctx.findElement(ctx.editingElementId);
  if (!found || found.element.type !== 'text') return;
  found.element.align = direction;
  const wrapper = ctx.markToolbarAnchor;
  const inner = wrapper ? wrapper.querySelector('.opencanvas-text') : null;
  if (inner) (inner as HTMLElement).style.textAlign = direction;
  refreshMarkToolbarAlignState(ctx);
  ctx.scheduleSave();
}

// Apply (or clear) a `color` mark to the slice [start, end) of runs.
// `color=null` removes the mark; otherwise replaces any existing color in
// the slice with the new value. Mirrors `setFontSizeOnRuns` because both
// marks carry a single attr payload — bold/italic/highlight toggle on/off
// against a uniform predicate, but color values aren't toggleable, so the
// semantics are "replace" not "toggle".
//
// Exported so `text-richtext-color.smoke.ts` can pin the run-splitting,
// mark-replacement, and adjacent-run coalescing rules without spinning up
// a fake DOM.
export function setColorOnRuns(
  ctx: RunMutationContext,
  runs: InlineRun[],
  start: number,
  end: number,
  color: string | null,
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
    sr.marks = (sr.marks || []).filter((mm) => mm.type !== 'color');
    if (color !== null) sr.marks.push({ type: 'color', color });
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

// Apply (or clear) a `color` mark across the current selection. Mirrors
// `applyFontSizeMark`: maps the live DOM Selection range to character
// offsets inside the editable, calls `setColorOnRuns` on the serialized
// run array, rebuilds the editable's DOM from the result, and restores
// the same character range.
//
// `color=null` removes the color mark from the slice (matches the
// fontSize=null code path). Caret-only selections short-circuit with the
// same status message bold/italic use because there is no range to apply.
function applyColorMark(ctx: ApplyColorMarkContext, color: string | null): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    ctx.setStatus('Select some text first to change color', 'error');
    return;
  }
  const inner = closestEditableRoot(range.commonAncestorContainer);
  if (!inner) return;

  const { start, end } = selectionCharBounds(inner, range);
  if (start === end) return;

  let runs: InlineRun[];
  try {
    runs = ctx.serializeContentToRuns(inner);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.setStatus('Color failed: ' + message, 'error');
    return;
  }

  const nextRuns = setColorOnRuns(ctx, runs, start, end, color);

  while (inner.firstChild) inner.removeChild(inner.firstChild);
  for (let ri = 0; ri < nextRuns.length; ri++) {
    const run = nextRuns[ri];
    if (run) inner.appendChild(ctx.buildRunNode(run));
  }

  inner.focus();
  selectByCharBounds(inner, start, end);
  ctx.scheduleSave();
}

// Read the inline `color:` style at the current Selection anchor by
// walking ancestors up to the contenteditable root. Innermost wrap wins,
// matching the natural CSS cascade — same convention
// `refreshMarkToolbarFontSizeStateImpl` uses to read the active font size.
// Returns null when no inline color is in scope; the caller falls back to
// the default swatch colour.
function activeColorAtSelection(): string | null {
  const sel = document.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const node = sel.anchorNode;
  if (!node) return null;
  let cur: Node | null = node.nodeType === 1 ? node : node.parentNode;
  while (cur && cur.nodeType === 1) {
    const curEl = cur as HTMLElement;
    if (
      curEl.tagName === 'SPAN' &&
      curEl.style &&
      curEl.style.color &&
      curEl.style.color.length > 0
    ) {
      return curEl.style.color;
    }
    if (curEl.getAttribute && curEl.getAttribute('contenteditable') === 'true') break;
    cur = curEl.parentNode;
  }
  return null;
}

// Helper that mirrors the start/end computation used by applyLinkMark /
// applyFontSizeMark / toggleSimpleMarkInSelection. Promoted to a single
// function so applyColorMark doesn't duplicate the six-line preStart /
// preEnd dance a fourth time.
function selectionCharBounds(inner: HTMLElement, range: Range): { start: number; end: number } {
  const preStart = document.createRange();
  preStart.setStart(inner, 0);
  preStart.setEnd(range.startContainer, range.startOffset);
  const startOff = preStart.toString().length;
  const preEnd = document.createRange();
  preEnd.setStart(inner, 0);
  preEnd.setEnd(range.endContainer, range.endOffset);
  const endOff = preEnd.toString().length;
  return {
    start: Math.min(startOff, endOff),
    end: Math.max(startOff, endOff),
  };
}

function refreshMarkToolbarAlignState(ctx: RefreshMarkToolbarAlignStateContext): void {
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

export function buildMarkToolbarImpl(ctx: BuildMarkToolbarContext, anchor: HTMLElement): void {
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
  // We drag the wrapper that owns the active edit (ctx.markToolbarAnchor),
  // NOT the first DOM match by id — site-pinned sections render one
  // wrapper per artboard, so a fresh querySelector would always pick
  // page 1's instance, dragging that one while the Owner edits page 3.
  dragBtn.addEventListener('mousedown', function (ev) {
    ev.preventDefault();
    if (!ctx.editingElementId) return;
    const wrapper = ctx.markToolbarAnchor;
    if (!wrapper) return;
    ctx.beginDrag(ev, wrapper);
  });
  bar.appendChild(dragBtn);
  // The inline-code mark is intentionally absent from the toolbar — owners
  // never reach for it during normal copy editing and its glyph crowded
  // the bar. Existing runs with code marks still render via the public-
  // styles <code> rule, but new code wraps can only land through the
  // canvas agent or paste from a code-formatted source.
  // fontSize is handled by the size <select> below (not the per-mark loop)
  // because it carries a numeric payload rather than a boolean toggle.
  // color is handled by the colour-wheel swatch + native <input type="color">
  // further down, for the same reason — its payload is a hex string, not a
  // toggle.
  for (let i = 0; i < CANONICAL_MARK_ORDER.length; i++) {
    const type = CANONICAL_MARK_ORDER[i];
    if (!type || type === 'code' || type === 'fontSize' || type === 'color') continue;
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
  // Selection-scoped color via the InlineMark `color` arm. The native
  // <input type="color"> is hidden behind the swatch button — clicking the
  // swatch triggers the browser's color picker. The swatch fill mirrors
  // the colour that lives at the current selection's anchor (matches the
  // CSS cascade rule the serializer uses for innermost-wins) so the user
  // can see the active value without opening the picker.
  //
  // The previous element-level write to `elementStyle.color` recoloured the
  // whole TextElement instead of the selected range — that surfaced to
  // owners as "I selected one word and the whole paragraph changed colour"
  // and is the bug this block fixes.
  const sep2 = document.createElement('span');
  sep2.className = 'opencanvas-mark-sep';
  sep2.setAttribute('aria-hidden', 'true');
  bar.appendChild(sep2);

  const initColor = activeColorAtSelection() || '#222222';
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
    // Normalise to lowercase so the schema-validated value matches the
    // serializer-normalised value byte-for-byte (avoids spurious dirty
    // diffs after save/reload round-trips).
    const normalised = INLINE_COLOR_HEX_RE.test(v) ? v.toLowerCase() : v;
    applyColorMark(ctx, normalised);
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
    void ctx.aiRewriteText(ctx.editingElementId);
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
