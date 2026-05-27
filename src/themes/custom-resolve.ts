// src/themes/custom-resolve.ts
//
// Wave 2 #10 — Custom theme editor. The renderer treats `styleKit === 'custom'`
// as a signal to resolve the preset from `CanvasSiteState.customStyleKit`
// instead of the built-in lookup table. Everything else flows unchanged.
//
// This module owns ONE public function — `resolveStyleKitWithCustom` — which
// the render boundary (and the `'custom'` slot in `src/canvas/style-kits.ts`)
// calls. It also owns a runtime validator (`validateStyleKitPreset`) so an
// out-of-shape `customStyleKit` throws loudly at render time. There is no
// silent fallback to a built-in: per the global "all-or-nothing" failure
// policy, a broken custom kit must surface the broken token, not hide it.
//
// The validator is intentionally structural rather than exhaustive. It checks:
//   - every required scalar field is the right primitive (string / number),
//   - every `Record<X, ...>` slot covers every value of X (action variants,
//     surface variants, motion presets),
//   - per-slot tokens are the expected primitive shape (no nested objects
//     where strings are expected),
//   - the optional `dark` partial does not break the parent — keys must be a
//     subset of `StyleKitPreset` (forward-compat for Wave 3 #20; we do NOT
//     validate the dark partial deeply because the dark feature owns that
//     contract).
// A failure throws an `Error` whose message names the offending field path.

import {
  ACTION_VARIANTS,
  MOTION_PRESETS,
  SURFACE_VARIANTS,
  type ActionVariant,
  type CanvasSiteState,
  type MotionPreset,
  type StyleKitPreset,
  type SurfaceVariant,
} from '../canvas/schema.js';
import { getStyleKitPreset } from '../canvas/style-kits.js';

// --------------------------------------------------------------------------
// Resolver — the one entry point.
// --------------------------------------------------------------------------

/**
 * Resolve a Style Kit preset for a given site state.
 *
 * - When `state.styleKit !== 'custom'` → delegates to `getStyleKitPreset`,
 *   which throws on unknown built-in names.
 * - When `state.styleKit === 'custom'` → reads `state.customStyleKit`.
 *   Missing or malformed → throws.
 *
 * Mirrors the same fail-loud contract as `getStyleKitPreset`. There is no
 * default and no silent fallback. The caller picked `'custom'`; the caller
 * must have a `customStyleKit`.
 */
export function resolveStyleKitWithCustom(
  state: Pick<CanvasSiteState, 'styleKit' | 'customStyleKit'>,
): StyleKitPreset {
  if (state.styleKit !== 'custom') {
    return getStyleKitPreset(state.styleKit);
  }
  const custom = state.customStyleKit;
  if (custom === undefined) {
    throw new Error(
      'resolveStyleKitWithCustom: styleKit is "custom" but customStyleKit is missing — ' +
        'site state is inconsistent. Pick a built-in kit or author a custom kit.',
    );
  }
  validateStyleKitPreset(custom, 'customStyleKit');
  return custom;
}

// --------------------------------------------------------------------------
// Runtime validator. Catches drift between the TS type and what was actually
// persisted (Yjs / DB rows / Owner-side JSON edits all touch this shape).
// --------------------------------------------------------------------------

/**
 * Shape-check a value at runtime against `StyleKitPreset`. On any mismatch
 * throws an Error whose message names the offending path. Returns nothing on
 * success — used as an assertion.
 *
 * The path prefix is the caller-supplied label that should identify where the
 * preset came from in the source state (e.g. `'customStyleKit'`).
 */
export function validateStyleKitPreset(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object, got ${describeForError(value)} — StyleKitPreset must be a plain object`,
    );
  }
  const v = value as Record<string, unknown>;
  // Colour tokens — all required strings.
  requireString(v, 'bg', pathPrefix);
  requireString(v, 'panel', pathPrefix);
  requireString(v, 'text', pathPrefix);
  requireString(v, 'muted', pathPrefix);
  requireString(v, 'accent', pathPrefix);
  requireString(v, 'accentText', pathPrefix);
  // Typography — required strings + numbers.
  requireString(v, 'fontFamilyDisplay', pathPrefix);
  requireString(v, 'fontFamilyBody', pathPrefix);
  requireString(v, 'fontFamilyMono', pathPrefix);
  requireFiniteNumber(v, 'headingScale', pathPrefix);
  requireFiniteNumber(v, 'bodyScale', pathPrefix);
  requireFiniteNumber(v, 'labelScale', pathPrefix);
  requireFiniteNumber(v, 'lineHeight', pathPrefix);
  // Surface scalars.
  requireString(v, 'radius', pathPrefix);
  requireString(v, 'borderWidth', pathPrefix);
  requireString(v, 'shadow', pathPrefix);
  // Shape scalars.
  requireString(v, 'shapeFill', pathPrefix);
  requireString(v, 'shapeStroke', pathPrefix);
  requireString(v, 'shapeStrokeWidth', pathPrefix);
  // Action scalars.
  requireString(v, 'actionRadius', pathPrefix);
  requireString(v, 'actionPadding', pathPrefix);
  // Motion scalars.
  requireFiniteNumber(v, 'motionDurationMs', pathPrefix);
  requireString(v, 'motionEasing', pathPrefix);

  // Variant maps — must cover every value of their respective enum. A missing
  // key is fatal; `{}` is the explicit "use kit defaults for this variant"
  // signal and is accepted.
  requireSurfaceVariants(v.surfaceVariants, `${pathPrefix}.surfaceVariants`);
  requireActionVariants(v.actionVariants, `${pathPrefix}.actionVariants`);
  requireMotionPresets(v.motionPresets, `${pathPrefix}.motionPresets`);

  // Forward-compat with Wave 3 #20 (light/dark). If `dark` is present it must
  // be a plain object whose keys are a subset of StyleKitPreset's known keys
  // — we do NOT recursively validate the dark partial here because its
  // contract is owned by the dark-mode feature. We DO catch the obvious shape
  // errors (non-object, array) so a malformed `dark` field surfaces here
  // instead of inside the #20 resolver.
  if (v.dark !== undefined) {
    if (typeof v.dark !== 'object' || v.dark === null || Array.isArray(v.dark)) {
      throw new Error(
        `${pathPrefix}.dark: expected an object (Partial<StyleKitPreset>) or omitted, got ${describeForError(v.dark)}`,
      );
    }
    for (const k of Object.keys(v.dark)) {
      if (!STYLE_KIT_PRESET_KEYS.has(k)) {
        throw new Error(
          `${pathPrefix}.dark.${k}: unknown key — dark partial must use StyleKitPreset field names`,
        );
      }
    }
  }
}

// --------------------------------------------------------------------------
// Helpers.
// --------------------------------------------------------------------------

/** The full set of known top-level keys on `StyleKitPreset`. */
const STYLE_KIT_PRESET_KEYS: ReadonlySet<string> = new Set([
  'bg',
  'panel',
  'text',
  'muted',
  'accent',
  'accentText',
  'fontFamilyDisplay',
  'fontFamilyBody',
  'fontFamilyMono',
  'headingScale',
  'bodyScale',
  'labelScale',
  'lineHeight',
  'radius',
  'borderWidth',
  'shadow',
  'surfaceVariants',
  'shapeFill',
  'shapeStroke',
  'shapeStrokeWidth',
  'actionRadius',
  'actionPadding',
  'actionVariants',
  'motionDurationMs',
  'motionEasing',
  'motionPresets',
  'dark',
]);

function describeForError(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `array(len=${String(value.length)})`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `${typeof value}`;
}

function requireString(record: Record<string, unknown>, key: string, pathPrefix: string): void {
  const v = record[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `${pathPrefix}.${key}: expected a non-empty string, got ${describeForError(v)}`,
    );
  }
}

function requireFiniteNumber(
  record: Record<string, unknown>,
  key: string,
  pathPrefix: string,
): void {
  const v = record[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(
      `${pathPrefix}.${key}: expected a finite number, got ${describeForError(v)}`,
    );
  }
}

function requireSurfaceVariants(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object covering every SurfaceVariant, got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  for (const variant of SURFACE_VARIANTS) {
    if (!Object.prototype.hasOwnProperty.call(v, variant)) {
      throw new Error(
        `${pathPrefix}.${variant}: missing — every SurfaceVariant must have a token slot (use {} for kit-default)`,
      );
    }
    requireSurfaceVariantTokens(v[variant], `${pathPrefix}.${variant}`);
  }
  // Unknown keys are surfaced — they would silently be ignored at render
  // time, which would mask a typo on the Owner side.
  for (const key of Object.keys(v)) {
    if (!(SURFACE_VARIANTS as readonly string[]).includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown SurfaceVariant — expected one of ${SURFACE_VARIANTS.join(', ')}`,
      );
    }
  }
}

function requireSurfaceVariantTokens(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object (SurfaceVariantTokens), got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  const allowed = ['background', 'border', 'shadow', 'radius'];
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown SurfaceVariantTokens field — expected one of ${allowed.join(', ')}`,
      );
    }
    const slot = v[key];
    if (slot !== undefined && typeof slot !== 'string') {
      throw new Error(
        `${pathPrefix}.${key}: expected a string when present, got ${describeForError(slot)}`,
      );
    }
  }
}

function requireActionVariants(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object covering every ActionVariant, got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  for (const variant of ACTION_VARIANTS) {
    if (!Object.prototype.hasOwnProperty.call(v, variant)) {
      throw new Error(
        `${pathPrefix}.${variant}: missing — every ActionVariant must have a token slot (use {} for kit-default)`,
      );
    }
    requireActionVariantTokens(v[variant], `${pathPrefix}.${variant}`);
  }
  for (const key of Object.keys(v)) {
    if (!(ACTION_VARIANTS as readonly string[]).includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown ActionVariant — expected one of ${ACTION_VARIANTS.join(', ')}`,
      );
    }
  }
}

function requireActionVariantTokens(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object (ActionVariantTokens), got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  const stringFields = [
    'background', 'color', 'border', 'borderRadius', 'textDecoration',
    'backdropFilter', 'boxShadow', 'padding', 'letterSpacing',
  ];
  for (const field of stringFields) {
    const slot = v[field];
    if (slot !== undefined && typeof slot !== 'string') {
      throw new Error(
        `${pathPrefix}.${field}: expected a string when present, got ${describeForError(slot)}`,
      );
    }
  }
  if (v.weight !== undefined && (typeof v.weight !== 'number' || !Number.isFinite(v.weight))) {
    throw new Error(
      `${pathPrefix}.weight: expected a finite number when present, got ${describeForError(v.weight)}`,
    );
  }
  const allowed = [...stringFields, 'weight'];
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown ActionVariantTokens field — expected one of ${allowed.join(', ')}`,
      );
    }
  }
}

function requireMotionPresets(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object covering every MotionPreset, got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  for (const preset of MOTION_PRESETS) {
    if (!Object.prototype.hasOwnProperty.call(v, preset)) {
      throw new Error(
        `${pathPrefix}.${preset}: missing — every MotionPreset must have a token slot (use {} for kit-default)`,
      );
    }
    requireMotionPresetTokens(v[preset], `${pathPrefix}.${preset}`);
  }
  for (const key of Object.keys(v)) {
    if (!(MOTION_PRESETS as readonly string[]).includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown MotionPreset — expected one of ${MOTION_PRESETS.join(', ')}`,
      );
    }
  }
}

function requireMotionPresetTokens(value: unknown, pathPrefix: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(
      `${pathPrefix}: expected an object (MotionPresetTokens), got ${describeForError(value)}`,
    );
  }
  const v = value as Record<string, unknown>;
  if (v.delayMs !== undefined && (typeof v.delayMs !== 'number' || !Number.isFinite(v.delayMs))) {
    throw new Error(
      `${pathPrefix}.delayMs: expected a finite number when present, got ${describeForError(v.delayMs)}`,
    );
  }
  if (v.transform !== undefined && typeof v.transform !== 'string') {
    throw new Error(
      `${pathPrefix}.transform: expected a string when present, got ${describeForError(v.transform)}`,
    );
  }
  if (v.opacity !== undefined && (typeof v.opacity !== 'number' || !Number.isFinite(v.opacity))) {
    throw new Error(
      `${pathPrefix}.opacity: expected a finite number when present, got ${describeForError(v.opacity)}`,
    );
  }
  const allowed = ['delayMs', 'transform', 'opacity'];
  for (const key of Object.keys(v)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${pathPrefix}.${key}: unknown MotionPresetTokens field — expected one of ${allowed.join(', ')}`,
      );
    }
  }
}

// Re-export the variant tuples so consumers can iterate without importing
// from schema directly. (Trivial passthrough; here so the validator and the
// editor panel share one import path.)
export {
  ACTION_VARIANTS,
  MOTION_PRESETS,
  SURFACE_VARIANTS,
  type ActionVariant,
  type MotionPreset,
  type SurfaceVariant,
};
