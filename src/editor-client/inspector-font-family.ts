// src/editor-client/inspector-font-family.ts
//
// Text-element inspector mount for the font-family picker (Wave 5 #12 UI).
//
// The picker offers three classes of choice:
//
//   1. "(Style kit default)"     — clears element.pinnedStyle["font-family"]
//                                   so the element inherits whichever
//                                   font-family the active Style Kit's
//                                   `--opencanvas-kit-font-*` variables
//                                   resolve to. Removes the empty
//                                   pinnedStyle object when no other
//                                   keys remain.
//   2. Kit token references       — "Display kit font" / "Body kit font" /
//                                   "Mono kit font". Each option writes the
//                                   matching CSS variable (e.g.
//                                   `var(--opencanvas-kit-font-display)`) so
//                                   the chosen role tracks the active kit
//                                   even when the Owner later swaps kits.
//   3. Each uploaded custom font  — drawn from ctx.customFonts (loaded once
//                                   at boot via GET /api/sites/:id/fonts).
//                                   Selection writes
//                                   `"<name>", system-ui, sans-serif` so
//                                   the font chain has a graceful fallback
//                                   while the WOFF2 is still loading.
//
// Why `pinnedStyle["font-family"]` and not a structured `elementStyle.fontFamily`:
//   `schema.ts` BaseElement.pinnedStyle's docblock explicitly names
//   `font-family` as a typography-ornament key that stays in pinnedStyle
//   rather than being promoted to structured ElementStyle — typography
//   STRUCTURE (font size / weight / wrap / transform / line-height / letter-
//   spacing) lives on TextElement directly, but family is a free-form CSS
//   chain that the renderer flows through escapeCssValue + sanitiseCssKey
//   without further interpretation.
//
// The face-emit module pairs with this picker for visitor-page rendering —
// emitAllSiteFontFaceBlocks ships every uploaded font row as an `@font-face`
// declaration in the public CSS so a chosen font.name actually resolves to
// the WOFF2 bytes the Owner uploaded. The editor canvas pulls its faces in
// via the `<style id="opencanvas-editor-custom-fonts">` block installed by
// installEditorCustomFontFaces.

import type { TextElement } from '../canvas/elements/text.js';
import type { EditorContext, EditorCustomFont } from './editor-context.js';
import { field, selectInput } from './dom-builders.js';

/** Sentinel option values for the kit + clear choices. Picked as `__`-
 *  prefixed slugs so they can never collide with a real font name (which the
 *  schema validator already restricts to printable CSS-safe characters). */
const KIT_DEFAULT_VALUE = '__kit_default__';
const KIT_DISPLAY_VALUE = '__kit_display__';
const KIT_BODY_VALUE = '__kit_body__';
const KIT_MONO_VALUE = '__kit_mono__';

/** CSS values written into pinnedStyle["font-family"] when the matching kit-
 *  token option is picked. The renderer ships these through escapeCssValue;
 *  `var(...)` is on the structural-character allowlist. */
const KIT_FONT_CSS: Record<string, string> = {
  [KIT_DISPLAY_VALUE]: 'var(--opencanvas-kit-font-display)',
  [KIT_BODY_VALUE]: 'var(--opencanvas-kit-font-body)',
  [KIT_MONO_VALUE]: 'var(--opencanvas-kit-font-mono)',
};

/** Reverse lookup so we can pre-select the dropdown when the element already
 *  pins a kit-token font value. Matches the canonical `var(...)` form the
 *  picker writes; legacy free-form chains stay as the "Custom (literal)"
 *  fallback group. */
const KIT_FONT_VALUE_TO_OPTION: Record<string, string> = {
  'var(--opencanvas-kit-font-display)': KIT_DISPLAY_VALUE,
  'var(--opencanvas-kit-font-body)': KIT_BODY_VALUE,
  'var(--opencanvas-kit-font-mono)': KIT_MONO_VALUE,
};

/**
 * Build the option list shown in the dropdown. Stable order so the picker
 * doesn't shuffle as fonts are uploaded:
 *   - Style kit default (clears pinnedStyle["font-family"])
 *   - Kit role tokens (display / body / mono)
 *   - One entry per uploaded custom font, in the order the API returned them
 */
export function buildFontFamilyOptions(
  customFonts: ReadonlyArray<EditorCustomFont>,
): Array<{ label: string; value: string }> {
  const options: Array<{ label: string; value: string }> = [
    { label: '(Style kit default)', value: KIT_DEFAULT_VALUE },
    { label: 'Display kit font', value: KIT_DISPLAY_VALUE },
    { label: 'Body kit font', value: KIT_BODY_VALUE },
    { label: 'Mono kit font', value: KIT_MONO_VALUE },
  ];
  for (let i = 0; i < customFonts.length; i++) {
    const f = customFonts[i]!;
    options.push({ label: f.name, value: customFontValue(f.name) });
  }
  return options;
}

/**
 * Construct the CSS font-family chain written into pinnedStyle for a custom
 * uploaded font. The fallback tail (`system-ui, sans-serif`) keeps the
 * paragraph readable while the WOFF2 finishes streaming over the wire —
 * `@font-face { font-display: swap }` then promotes the real face once it
 * lands. JSON.stringify-quotes the family name so multi-word names (e.g.
 * "My Display Font") stay a single token in the chain.
 */
export function customFontValue(name: string): string {
  return `${JSON.stringify(name)}, system-ui, sans-serif`;
}

/**
 * Reverse-map a stored pinnedStyle["font-family"] value back to its dropdown
 * option key so the picker pre-selects what's already saved. Returns
 * `KIT_DEFAULT_VALUE` for missing / empty values, the matching kit-token key
 * for kit references, the custom-font option key when the value matches an
 * uploaded font's canonical chain, or `null` when the value is a free-form
 * literal the picker can't represent. The caller treats `null` as "leave the
 * select on (Style kit default) and show the literal value in the picker
 * status hint."
 */
export function pickerValueForFontFamily(
  current: string | undefined,
  customFonts: ReadonlyArray<EditorCustomFont>,
): string {
  if (typeof current !== 'string' || current.length === 0) {
    return KIT_DEFAULT_VALUE;
  }
  const trimmed = current.trim();
  const kitMatch = KIT_FONT_VALUE_TO_OPTION[trimmed];
  if (kitMatch) return kitMatch;
  for (let i = 0; i < customFonts.length; i++) {
    const f = customFonts[i]!;
    if (customFontValue(f.name) === trimmed) {
      return customFontValue(f.name);
    }
  }
  return KIT_DEFAULT_VALUE;
}

/**
 * Apply a picker selection to a TextElement's pinnedStyle["font-family"].
 *
 *   - KIT_DEFAULT_VALUE → delete the pin; remove the pinnedStyle object when
 *                         no other keys remain so JSON output stays minimal.
 *   - Kit role tokens   → write the matching `var(...)` reference.
 *   - Custom font value → write the canonical chain as-is.
 *
 * Returns the resolved CSS value (or empty string when cleared) so callers
 * can surface it in a status line.
 */
export function applyFontFamilySelection(
  element: TextElement,
  selectedValue: string,
): string {
  if (selectedValue === KIT_DEFAULT_VALUE) {
    if (element.pinnedStyle) {
      delete element.pinnedStyle['font-family'];
      if (Object.keys(element.pinnedStyle).length === 0) {
        delete element.pinnedStyle;
      }
    }
    return '';
  }
  const kitValue = KIT_FONT_CSS[selectedValue];
  const cssValue = kitValue ?? selectedValue;
  if (!element.pinnedStyle) element.pinnedStyle = {};
  element.pinnedStyle['font-family'] = cssValue;
  return cssValue;
}

/**
 * Inspector custom-mount handler for the text element's font-family picker.
 * Registered under the name `'text-font-family'` in runtime-helpers.ts; the
 * declarative spec entry on TextElement's inspectorSpec just names the mount,
 * keeping the spec itself static-data-only.
 */
export function mountTextFontFamily(
  ctx: EditorContext,
  element: TextElement,
  host: HTMLElement,
): void {
  const customFonts: ReadonlyArray<EditorCustomFont> = ctx.customFonts ?? [];
  const options = buildFontFamilyOptions(customFonts);
  const labels = options.map((opt) => opt.label);
  const current = element.pinnedStyle?.['font-family'];
  const currentValue = pickerValueForFontFamily(current, customFonts);
  const currentOption = options.find((opt) => opt.value === currentValue) ?? options[0]!;
  const select = selectInput(labels, currentOption.label);
  select.setAttribute('data-font-family-picker', '');
  select.addEventListener('change', () => {
    const chosen = options.find((opt) => opt.label === select.value);
    if (!chosen) return;
    applyFontFamilySelection(element, chosen.value);
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(field('Font family', select));
}
