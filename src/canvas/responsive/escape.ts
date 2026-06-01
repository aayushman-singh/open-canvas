// src/canvas/responsive/escape.ts
//
// Defense-in-depth: the CSS module pastes element / section / page ids into
// attribute-selector strings of the shape `[data-opencanvas-element="<id>"]`.
// The IDs originate in the Owner's EditableSite — and the schema validator
// in `src/canvas/validate.ts` is the boundary that should be rejecting any
// id outside the slug shape — but the responsive module re-restricts the
// character set anyway. A stray `"` or `\` would break the selector and
// could allow a stray rule to leak out of the responsive block.
//
// We restrict the allowed character set to ASCII letters, digits, `-` and
// `_`. Anything else is dropped. If the validator and this filter ever
// disagree the renderer-side `data-opencanvas-element="<id>"` attribute and this
// selector's `<id>` will not match — the rule simply won't apply, which is
// the fail-loud outcome (visible as a broken layout, not a silent override).
// The validator is the canonical id-shape boundary; this filter exists so
// that boundary's failures can never produce a CSS-injection vector.

export function escapeCssIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
