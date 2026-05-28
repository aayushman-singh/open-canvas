// src/themes/visitor-mode/resolve.ts
//
// Light/dark visitor toggle. The resolver merges a Style Kit's optional
// `dark` partial over the light base when the visitor's chosen mode is
// `'dark'`. It is the SINGLE place that knows how to project a kit for a
// given mode; the CSS emitter, the editor panel preview, and the public
// renderer all funnel through it.
//
// Domain language (CONTEXT.md):
//   - A Style Kit Preset is the full token set the Owner authored. Every
//     scalar (`bg`, `text`, etc.) is present.
//   - A Style Kit Dark Variant is a `Partial<StyleKitPreset>` the Owner may
//     attach via `kit.dark`. Any field present overrides the corresponding
//     light value when the Visitor Mode is `'dark'`. Absent fields fall
//     through to the light base unchanged.
//   - Visitor Mode is the runtime selection — `'light' | 'dark'` — driven by
//     the visitor's cookie / `prefers-color-scheme` / explicit toggle.
//
// Merge precedence (LOUDLY DOCUMENTED — keep this in sync with the smoke):
//
//   1. Top-level scalar fields on `StyleKitPreset` (`bg`, `text`, `accent`,
//      `headingScale`, etc.) are REPLACED outright when the dark partial
//      contains them. Light value is dropped.
//
//   2. Nested variant records — `surfaceVariants`, `actionVariants`,
//      `motionPresets` — are SHALLOW-MERGED BY VARIANT KEY. The dark
//      partial may supply entries for a SUBSET of variants; the absent
//      entries fall through to the light kit's entries unchanged. Within a
//      supplied entry, the WHOLE token object replaces the light one (no
//      deeper token-level merge — keep it predictable). This matches the
//      Owner's mental model: "give me a dark override for the `raised`
//      surface; leave the rest alone."
//
//   3. The `dark` field itself never appears on the resolved output — it is
//      consumed by the resolver.
//
// Failure mode is explicit (all-or-nothing per global instructions): the
// resolver does not silently drop a malformed dark partial. The custom-kit
// validator (`themes/custom-resolve.ts`) already shape-checks the top-level
// keys of `dark`; this module trusts that gate and does not re-validate.
// A truly broken dark partial (wrong runtime shape that slipped past the
// validator) will throw with a clear path when the offending field is read
// by the CSS emitter — not here.

import type { StyleKitPreset } from '../../canvas/schema.js';

import { resolveBuiltInDark } from './built-in-darks.js';

/** Visitor's chosen rendering mode. */
export type VisitorMode = 'light' | 'dark';

/**
 * Project a Style Kit for a given Visitor Mode.
 *
 * - `mode === 'light'` → returns the kit unchanged (the `dark` partial is
 *   carried through; downstream emitters never look at it in light mode).
 * - `mode === 'dark'` and `kit.dark` undefined → returns the kit unchanged.
 *   Visitor sees the light kit even with `data-mode="dark"` on the document.
 *   This is the documented "no dark variant authored → light is the dark
 *   variant" behaviour. The CSS emitter still emits the `:root[data-mode="dark"]`
 *   selector because the early script may have stamped the attribute; the
 *   block's content equals the light block, so toggling is a no-op.
 * - `mode === 'dark'` with a dark partial → merges per the precedence rules
 *   documented at the top of this file.
 *
 * The function is pure and ID-stable: calling it twice with the same `kit`
 * reference returns structurally equal output. There is no caching here; the
 * caller (the CSS emitter or the editor preview) handles caching if needed.
 */
export function resolveStyleKitForMode(
  kit: StyleKitPreset,
  mode: VisitorMode,
): StyleKitPreset {
  if (mode === 'light') {
    return kit;
  }
  // mode === 'dark'
  const dark = kit.dark;
  if (dark === undefined) {
    return kit;
  }
  // Start from a shallow clone so we can override fields without mutating the
  // input. The nested records get explicit shallow-merge below; everything
  // else is straight scalar replacement.
  const out: StyleKitPreset = { ...kit };

  // Top-level scalar overrides. We iterate the known keys of `Partial<StyleKitPreset>`
  // explicitly rather than `Object.assign(out, dark)` so the nested records
  // (`surfaceVariants` etc.) are not blown away wholesale by a partial dark
  // record. The custom-kit validator already rejects unknown keys on `dark`,
  // so there is no "unknown field forwarded" risk.
  if (dark.bg !== undefined) out.bg = dark.bg;
  if (dark.panel !== undefined) out.panel = dark.panel;
  if (dark.text !== undefined) out.text = dark.text;
  if (dark.muted !== undefined) out.muted = dark.muted;
  if (dark.accent !== undefined) out.accent = dark.accent;
  if (dark.accentText !== undefined) out.accentText = dark.accentText;
  if (dark.fontFamilyDisplay !== undefined) out.fontFamilyDisplay = dark.fontFamilyDisplay;
  if (dark.fontFamilyBody !== undefined) out.fontFamilyBody = dark.fontFamilyBody;
  if (dark.fontFamilyMono !== undefined) out.fontFamilyMono = dark.fontFamilyMono;
  if (dark.headingScale !== undefined) out.headingScale = dark.headingScale;
  if (dark.bodyScale !== undefined) out.bodyScale = dark.bodyScale;
  if (dark.labelScale !== undefined) out.labelScale = dark.labelScale;
  if (dark.lineHeight !== undefined) out.lineHeight = dark.lineHeight;
  if (dark.radius !== undefined) out.radius = dark.radius;
  if (dark.borderWidth !== undefined) out.borderWidth = dark.borderWidth;
  if (dark.shadow !== undefined) out.shadow = dark.shadow;
  if (dark.shapeFill !== undefined) out.shapeFill = dark.shapeFill;
  if (dark.shapeStroke !== undefined) out.shapeStroke = dark.shapeStroke;
  if (dark.shapeStrokeWidth !== undefined) out.shapeStrokeWidth = dark.shapeStrokeWidth;
  if (dark.actionRadius !== undefined) out.actionRadius = dark.actionRadius;
  if (dark.actionPadding !== undefined) out.actionPadding = dark.actionPadding;
  if (dark.motionDurationMs !== undefined) out.motionDurationMs = dark.motionDurationMs;
  if (dark.motionEasing !== undefined) out.motionEasing = dark.motionEasing;

  // Nested variant records — shallow-merge by key. The dark partial may have
  // only some variants; the absent ones inherit the light kit's entry. Within
  // a supplied entry, the whole token object replaces the light one (per the
  // documented rule above).
  if (dark.surfaceVariants !== undefined) {
    out.surfaceVariants = {
      ...kit.surfaceVariants,
      ...dark.surfaceVariants,
    };
  }
  if (dark.actionVariants !== undefined) {
    out.actionVariants = {
      ...kit.actionVariants,
      ...dark.actionVariants,
    };
  }
  if (dark.motionPresets !== undefined) {
    out.motionPresets = {
      ...kit.motionPresets,
      ...dark.motionPresets,
    };
  }
  // The resolved kit drops `dark` — downstream emitters never look at it in
  // dark mode (the resolver already projected it). Leaving the field on the
  // output would be a foot-gun for any future emitter that pattern-matches on
  // its presence.
  delete out.dark;
  return out;
}

/**
 * Built-in dark variants are stored in
 * `src/themes/visitor-mode/built-in-darks.ts`, NOT on `STYLE_KIT_PRESETS` —
 * keeping them sidecar-only means the visitor-mode subsystem owns the dark
 * surface without touching `src/canvas/style-kits.ts`. This helper consults
 * the sibling built-in-darks table and stitches the dark partial onto a
 * built-in kit before resolving. For a kit that already carries `kit.dark`
 * (a custom kit, or a future built-in with an inline dark partial), this is
 * a no-op.
 *
 * Used by `emitDualModeCss` so consumers can call one entry point with a
 * built-in kit id OR a custom kit and get the right dark variant either way.
 */
export function withBuiltInDark(
  kit: StyleKitPreset,
  kitId: string,
): StyleKitPreset {
  if (kit.dark !== undefined) return kit;
  const builtInDark = resolveBuiltInDark(kitId);
  if (builtInDark === undefined) return kit;
  return { ...kit, dark: builtInDark };
}
