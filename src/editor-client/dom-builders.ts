// src/editor-client/dom-builders.ts
//
// ADR 0015 Phase 2g — small DOM builder primitives used by the
// inspector and section toolbar. Pure: each takes plain inputs and
// returns a fresh DOM element. canvas-client.ts:4037 + :4047 carry
// the inline copies.
//
// More builders will land here as inspector / section-toolbar paths
// extract; the module is intentionally a single small file so the
// build cost stays trivial.

/** Wrap an `inner` element with a labelled `<div class="field">` row.
 *  Used everywhere in the inspector. */
export function field(label: string, inner: HTMLElement): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const lab = document.createElement('label');
  lab.textContent = label;
  wrap.appendChild(lab);
  wrap.appendChild(inner);
  return wrap;
}

/** Build a `<select>` with one `<option>` per entry in `options`,
 *  preselecting the entry equal to `selected` when one matches. */
export function selectInput(
  options: readonly string[],
  selected: string | undefined,
): HTMLSelectElement {
  const sel = document.createElement('select');
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option;
    opt.textContent = option;
    if (option === selected) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}
