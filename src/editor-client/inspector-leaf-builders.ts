// src/editor-client/inspector-leaf-builders.ts
//
// ADR 0058 Phase 2h.1.b — leaf-level DOM builders for the inspector.
// These are the smallest DOM-building helpers the inspector composes:
//
//   - buildColorRow(opts) — a single [checkbox | swatch | hex | reset]
//     row. Pure: no ctx, no closure-var deps. Driven entirely by opts
//     callbacks so the same row works for element fills, page bg,
//     section overrides, etc.
//
//   - buildKitSummary(ctx) — read-only summary of the active style kit.
//     Reads ctx.state.styleKit and computed CSS off ctx.mainEl so it
//     stays in sync with whatever style-kits.ts emits at runtime.
//
//   - createInspectorEntry(label, removeBtn?) — wrap a repeated-entry
//     card with an accent-red header ("SLIDE 1", "FIELD 2", "LINK 3",
//     etc.) and an optional remove button slotted right-aligned in the
//     header. Used by every list mount that emits a sequence of similar
//     entries (carousel slides, accordion items, form fields, nav
//     links) so users can see where one entry ends and the next begins.
//
// Extracted from canvas-client.ts:6513-6601 and 12096-12132. The inline
// IIFE twins remain the production source-of-truth until ADR 0015
// Phase 3 atomic cutover. Behavioural parity is pinned by the existing
// src/editor/inspector-smoke.ts on the production path; a sibling
// smoke (inspector-leaf-builders.smoke.ts) is intentionally NOT
// shipped — bare Bun has no DOM and the repo carries no
// happy-dom / jsdom dev dep.

import type { EditorContext } from './editor-context.js';

/**
 * Callback contract `buildColorRow` runs against. The row owns no
 * value of its own — every state read/write flows through these
 * callbacks so the same builder serves element-fill, page-bg, and
 * section-override rows without branching.
 */
export interface BuildColorRowOpts {
  /** Current colour value (CSS hex string), or null/undefined when
   *  the row should render in the "no override" state. */
  getValue(): string | null | undefined;
  /** Persist a new colour. Caller is responsible for the storage
   *  shape; the row only emits well-formed `#rrggbb` strings. */
  setValue(value: string): void;
  /** Drop the stored colour. Invoked when the user unchecks the
   *  enable box or clicks the optional reset link. */
  clearValue(): void;
  /** Re-render / persist hook. Fires after every value mutation so
   *  the caller can push to undo, repaint, schedule a save, etc. */
  onChange(): void;
  /** Tooltip text on the enable checkbox. */
  enabledTitle: string;
  /** Fallback `<input type="color">` value used while no colour is
   *  stored (the picker still needs a starting point). */
  swatchDefault?: string;
  /** Optional "Follow theme" reset button label. When omitted, no
   *  reset link is rendered. */
  resetLabel?: string;
}

/**
 * Build a [enable checkbox | color swatch | hex text input | reset]
 * row. The hex input is the typed-entry escape hatch the swatch
 * picker alone doesn't offer. All three controls stay synchronised:
 * the swatch syncs to the hex text on each pick, the hex text
 * accepts both `#rgb` and `#rrggbb` (expanded to `#rrggbb`
 * internally), and any valid edit flips the enabled checkbox on so
 * partial edits don't silently lose the value.
 *
 * `opts.onChange` fires after every value mutation so the caller
 * can re-render / persist / repaint as appropriate for whichever
 * field (element style, page background, etc.) the row writes to.
 */
export function buildColorRow(opts: BuildColorRowOpts): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'style-row';
  const initial = opts.getValue();
  const enabledLabel = document.createElement('label');
  enabledLabel.className = 'opencanvas-toggle';
  enabledLabel.title = opts.enabledTitle;
  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.className = 'opencanvas-toggle-input';
  enabled.checked = !!initial;
  enabled.title = opts.enabledTitle;
  const enabledTrack = document.createElement('span');
  enabledTrack.className = 'opencanvas-toggle-track';
  enabledTrack.setAttribute('aria-hidden', 'true');
  enabledLabel.appendChild(enabled);
  enabledLabel.appendChild(enabledTrack);
  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.value = initial || opts.swatchDefault || '#000000';
  swatch.className = 'color-swatch';
  const hex = document.createElement('input');
  hex.type = 'text';
  hex.className = 'color-hex';
  hex.value = initial || '';
  hex.placeholder = opts.swatchDefault || '#000000';
  hex.spellcheck = false;
  hex.maxLength = 7;
  function expandShort(v: string): string {
    if (v.length === 4) {
      return ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase();
    }
    return v.toLowerCase();
  }
  // Optional "Follow theme" reset link, visible only while an override is
  // active. Without this users couldn't tell the unlabelled checkbox at the
  // start of the row WAS the off-switch — they'd swap kits, watch the page
  // ignore the new theme bg, and assume kit-switching was broken. The link
  // toggles enabled off, clears the value, and fires onChange so the inline
  // override is removed and the kit token re-applies. Hidden when there is
  // no override (no value set) so it doesn't crowd the row by default.
  let reset: HTMLButtonElement | null = null;
  if (typeof opts.resetLabel === 'string' && opts.resetLabel.length > 0) {
    reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'color-reset';
    reset.textContent = opts.resetLabel;
    reset.title = opts.resetLabel;
    reset.style.display = enabled.checked ? '' : 'none';
    reset.addEventListener('mousedown', function (ev) {
      ev.preventDefault();
    });
    reset.addEventListener('click', function (ev) {
      ev.preventDefault();
      enabled.checked = false;
      opts.clearValue();
      hex.value = '';
      if (reset) reset.style.display = 'none';
      opts.onChange();
    });
  }
  function refreshResetVisibility(): void {
    if (!reset) return;
    reset.style.display = enabled.checked ? '' : 'none';
  }
  enabled.addEventListener('change', function () {
    if (enabled.checked) {
      opts.setValue(swatch.value);
      hex.value = swatch.value;
    } else {
      opts.clearValue();
      hex.value = '';
    }
    refreshResetVisibility();
    opts.onChange();
  });
  swatch.addEventListener('input', function () {
    if (!enabled.checked) enabled.checked = true;
    opts.setValue(swatch.value);
    hex.value = swatch.value;
    refreshResetVisibility();
    opts.onChange();
  });
  hex.addEventListener('input', function () {
    const v = hex.value.trim();
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
      const normalised = expandShort(v);
      swatch.value = normalised;
      if (!enabled.checked) enabled.checked = true;
      opts.setValue(normalised);
      refreshResetVisibility();
      opts.onChange();
    }
  });
  row.appendChild(enabledLabel);
  row.appendChild(swatch);
  row.appendChild(hex);
  if (reset) row.appendChild(reset);
  return row;
}

/**
 * Inspector summary of the active kit — reads computed CSS off the
 * editor wrapper (ctx.mainEl), so it stays in sync with whatever
 * style-kits.ts emits. There is no duplicate copy of
 * STYLE_KIT_PRESETS in the client bundle: the wrapper is the source
 * of truth at runtime.
 *
 * Renders `kit: (unknown)` when ctx.mainEl, ctx.state, or
 * ctx.state.styleKit is missing — the same defensive path the inline
 * IIFE takes during early renders before boot finishes.
 */
export function buildKitSummary(ctx: EditorContext): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'opencanvas-kit-summary';
  if (!ctx.mainEl || !ctx.state || !ctx.state.styleKit) {
    wrap.textContent = 'kit: (unknown)';
    return wrap;
  }
  const cs = window.getComputedStyle(ctx.mainEl);
  function token(name: string, fallback: string): string {
    const value = cs.getPropertyValue(name);
    return value && value.trim().length > 0 ? value.trim() : fallback || '';
  }
  const accent = token('--opencanvas-kit-accent', '(unset)');
  const display = token('--opencanvas-kit-font-display', '(unset)');
  const duration = token('--opencanvas-kit-motion-duration', '(unset)');
  const rows: [string, string, string | null][] = [
    ['kit', ctx.state.styleKit, null],
    ['accent', accent, accent],
    ['display', display.split(',')[0]!.replace(/['"]/g, '').trim(), null],
    ['motion', duration, null],
  ];
  for (let i = 0; i < rows.length; i++) {
    const rowDef = rows[i];
    if (!rowDef) continue;
    const row = document.createElement('div');
    row.className = 'row';
    if (rowDef[2]) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = rowDef[2];
      row.appendChild(sw);
    }
    const label = document.createElement('span');
    label.textContent = rowDef[0] + ': ' + rowDef[1];
    row.appendChild(label);
    wrap.appendChild(row);
  }
  return wrap;
}

/**
 * Build a wrapper for one entry in a repeated-entry inspector list
 * (carousel slide, accordion item, form field, nav link, …). The
 * wrapper renders an accent-red header — "SLIDE 1", "FIELD 2",
 * "LINK 3" etc. — with an optional remove button slotted into the
 * header's right edge. Without the header users see a flat sequence
 * of `Upload | Caption | Link | × | Upload | Caption | Link | ×`
 * with no clue where slide 1 ends and slide 2 begins.
 *
 * Failure contract: throws when `label` is empty. The caller is
 * expected to compute "Slide " + (i + 1) etc., and an empty header
 * would render the entry as a blank red bar — visually broken in a
 * way that's easy to mis-attribute to a CSS bug.
 */
export function createInspectorEntry(
  label: string,
  removeBtn?: HTMLButtonElement,
): HTMLDivElement {
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error('createInspectorEntry: label must be a non-empty string');
  }
  const entry = document.createElement('div');
  entry.className = 'opencanvas-inspector-entry';

  const header = document.createElement('div');
  header.className = 'opencanvas-inspector-entry-header';

  const labelSpan = document.createElement('span');
  labelSpan.className = 'opencanvas-inspector-entry-header-label';
  labelSpan.textContent = label;
  header.appendChild(labelSpan);

  if (removeBtn) header.appendChild(removeBtn);

  entry.appendChild(header);
  return entry;
}
