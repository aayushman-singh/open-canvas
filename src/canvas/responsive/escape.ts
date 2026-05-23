// src/canvas/responsive/escape.ts
//
// Defense-in-depth: the CSS module pastes element / section / page ids into
// attribute-selector strings of the shape `[data-rev01-element="<id>"]`.
// The IDs originate in the Owner's Canvas Site State — already constrained
// by the schema validator to a slug-like shape — but the responsive module
// re-escapes anyway. A stray `"` or `\` would break the selector and could
// allow a stray rule to leak out of the responsive block.
//
// We restrict the allowed character set to ASCII letters, digits, `-` and
// `_`. Anything else is dropped. The schema's id validator already enforces
// this set, so dropping characters here is a belt-and-braces fallback that
// MUST never trigger in normal operation.

export function escapeCssIdent(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}
