// src/canvas/validate.ts
//
// Pure validators for the canvas document model. Both validators collect ALL
// errors encountered rather than failing fast — the smoke and the editor want
// the full picture so the Owner can fix every issue at once.

import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import { CUSTOM_404_PAGE_SLUG } from './page-routing.js';
import { ACCORDION_VARIANTS } from './elements/accordion.js';
import { COLLECTION_DISPLAYS, COLLECTION_SORTS } from './elements/collection.js';
import type { CollectionDisplay, CollectionSort } from './elements/collection.js';
import { escapeCssValue } from './elements/render-utils.js';
import { isAllowedHref } from './action-href.js';
import {
  FORM_FONT_FAMILIES,
  FORM_FONT_WEIGHTS,
  FORM_VARIANTS,
  type FormFontFamily,
  type FormFontWeight,
} from './elements/form.js';
import { ICON_NAMES, isIconName } from './icons.js';
import { TABS_DEFAULT_BAR_HEIGHT, TABS_VARIANTS } from './elements/tabs.js';
import { CAROUSEL_MODES, CAROUSEL_VARIANTS } from './elements/carousel.js';
import { NAV_LAYOUTS, NAV_LINK_KINDS, type NavLayout, type NavLinkKind } from './elements/nav.js';
import {
  validateMotionSequence,
  validateScrollScene,
  type InteractionTarget,
  type MotionSequence,
  type ScrollScene,
} from './interactions.js';
import {
  validateLoadExperience,
  validateRouteTransition,
  type LoadExperience,
  type RouteTransition,
} from './load-transitions.js';
import { validateOverlay, type Overlay, type OverlayFocusTarget } from './overlays.js';
import { validateRichMotionAsset, type RichMotionAsset } from './rich-motion-assets.js';

// Re-export the canonical href allowlist so existing consumers (agent
// parsers, etc.) that import from './canvas/validate.js' keep working. The
// implementation lives in ./action-href.js — see the comment block there.
export { isAllowedHref };
import {
  ACCENT_BORDER_TYPES,
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  BACKGROUND_SIZES,
  COLLECTION_PAGE_KINDS,
  ELEMENT_TYPES,
  INLINE_COLOR_HEX_RE,
  INLINE_FONT_SIZE_PX_MAX,
  INLINE_FONT_SIZE_PX_MIN,
  INLINE_MARK_TYPES,
  INLINE_MATH_TEX_MAX_LEN,
  MEDIA_KINDS,
  MOTION_PRESETS,
  OVERFLOW_VALUES,
  SCROLL_TRIGGER_MODES,
  SECTION_RECIPE_IDS,
  SECTION_ROLES,
  SHAPE_VARIANTS,
  STYLE_KITS,
  SURFACE_VARIANTS,
  type AccentBorderType,
  type ActionVariant,
  type BackgroundEffect,
  type BackgroundSize,
  type CanvasSection,
  type EditableSite,
  type ElementType,
  type InlineMarkType,
  type MediaKind,
  type MotionPreset,
  type OverflowValue,
  type ScrollTriggerMode,
  type SectionRecipeId,
  type SectionRole,
  type ShapeVariant,
  type StyleKit,
  type SurfaceVariant,
} from './schema.js';

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

const PAGE_WIDTH_MIN = 960;
const PAGE_WIDTH_MAX = 1920;
const SECTION_HEIGHT_MIN = 240;
const PINNED_SECTION_HEIGHT_MIN = 48;
const SECTION_HEIGHT_MAX = 1400;

const POPUP_TRIGGER_TYPES = ['exit-intent', 'delay', 'scroll'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// One predicate for "is this a date string that Date can parse?". Both
// `Date.parse + Number.isFinite` and `new Date + Number.isNaN(getTime())` do
// the same thing; the file previously carried both. Date.parse returns NaN
// for unparseable input, and NaN is not finite — single check.
function isParseableDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

// Type-narrow `value` to one of `allowed`. On failure, append a uniform
// "must be one of [a, b, c] (got X)" error and return false so callers can
// guard subsequent field reads. Single source of truth for the union-narrow
// error format across every element/section/page/site discriminant.
function assertOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[],
): value is T {
  if (isOneOf<T>(value, allowed)) return true;
  errors.push(`${path} must be one of [${allowed.join(', ')}] (got ${describe(value)})`);
  return false;
}

// Shared type-narrowing assertion helpers (ADR 0012 dec 4). Each appends a
// uniform `${path} must be <kind>[ when present] (got <actual>)` error on
// failure and returns false so callers can guard subsequent reads. Single
// source of truth for the error format across the validator.

function assertFiniteNumber(value: unknown, path: string, errors: string[]): value is number {
  if (isFiniteNumber(value)) return true;
  errors.push(`${path} must be a finite number (got ${describe(value)})`);
  return false;
}

function assertOptionalFiniteNumber(
  value: unknown,
  path: string,
  errors: string[],
): value is number | undefined {
  if (value === undefined || isFiniteNumber(value)) return true;
  errors.push(`${path} must be a finite number when present (got ${describe(value)})`);
  return false;
}

function assertNonEmptyString(value: unknown, path: string, errors: string[]): value is string {
  if (isNonEmptyString(value)) return true;
  errors.push(`${path} must be a non-empty string (got ${describe(value)})`);
  return false;
}

function assertOptionalNonEmptyString(
  value: unknown,
  path: string,
  errors: string[],
): value is string | undefined {
  if (value === undefined || isNonEmptyString(value)) return true;
  errors.push(`${path} must be a non-empty string when present (got ${describe(value)})`);
  return false;
}

// Note: an `assertBoolean` (required) helper would be the natural pair with
// `assertOptionalBoolean` below, but no current required-boolean fields
// exist in the schema (every boolean is optional with an implied default).
// Add it when the first required boolean lands.

function assertOptionalBoolean(
  value: unknown,
  path: string,
  errors: string[],
): value is boolean | undefined {
  if (value === undefined || typeof value === 'boolean') return true;
  errors.push(`${path} must be a boolean when present (got ${describe(value)})`);
  return false;
}

/** Render an unknown value as a short, safe string for error messages. */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (Array.isArray(value)) return `array(len=${String(value.length)})`;
  return `object(${typeof value})`;
}

function pathJoin(parent: string, child: string | number): string {
  if (typeof child === 'number') return `${parent}[${String(child)}]`;
  return parent === '' ? child : `${parent}.${child}`;
}

/**
 * Validate an ActionHref discriminated union (`{ type: 'external'; url }` or
 * `{ type: 'page'; pageId; anchor? }`). Collects all errors into `errors`.
 */
function validateActionHref(
  href: unknown,
  basePath: string,
  errors: string[],
  validPageIds: Set<string> | null,
): void {
  if (typeof href !== 'object' || href === null) {
    errors.push(basePath + ' must be an object with type "external" or "page"');
    return;
  }
  const h = href as Record<string, unknown>;
  if (h.type === 'external') {
    if (!assertNonEmptyString(h.url, `${basePath}.url`, errors)) {
      // path noted
    } else if (!isAllowedHref(h.url)) {
      errors.push(
        basePath +
          '.url "' +
          h.url +
          '" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)',
      );
    }
  } else if (h.type === 'page') {
    if (!assertNonEmptyString(h.pageId, `${basePath}.pageId`, errors)) {
      // path noted
    } else if (validPageIds !== null && !validPageIds.has(h.pageId)) {
      errors.push(basePath + '.pageId "' + h.pageId + '" must reference an existing page');
    }
    if (h.anchor !== undefined && typeof h.anchor !== 'string') {
      errors.push(basePath + '.anchor must be a string when present');
    }
  } else {
    errors.push(basePath + '.type must be "external" or "page" (got ' + describe(h.type) + ')');
  }
}

/**
 * Validate one NavLink ({ label, href, kind }). Shared between `links[]` and
 * the optional `primaryAction` because both reuse NavLink. Per-kind href rules:
 *   - anchor   → must start with '#' (mirrors mountNavLinks's client check)
 *   - external → must pass isAllowedHref (http/https/mailto/tel/relative/#)
 *   - internal → any non-empty string (renderer normalises to '/<slug>')
 */
function validateNavLink(link: unknown, basePath: string, errors: string[]): void {
  if (!isRecord(link)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(link.label)) {
    errors.push(`${basePath}.label must be a non-empty string (got ${describe(link.label)})`);
  }
  const hrefOk = isNonEmptyString(link.href);
  if (!hrefOk) {
    errors.push(`${basePath}.href must be a non-empty string (got ${describe(link.href)})`);
  }
  if (!assertOneOf<NavLinkKind>(link.kind, NAV_LINK_KINDS, `${basePath}.kind`, errors)) return;
  if (!hrefOk) return;
  const href = link.href as string;
  if (link.kind === 'anchor' && href.charAt(0) !== '#') {
    errors.push(`${basePath}.href must start with "#" when kind === "anchor" (got "${href}")`);
  } else if (link.kind === 'external' && !isAllowedHref(href)) {
    errors.push(
      `${basePath}.href "${href}" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)`,
    );
  }
}

function validateBox(
  box: unknown,
  pageWidth: number,
  sectionHeight: number,
  basePath: string,
  errors: string[],
): void {
  if (!isRecord(box)) {
    errors.push(`${basePath} missing box`);
    return;
  }
  const { x, y, w, h, z, rotation } = box;
  assertFiniteNumber(x, `${basePath}.box.x`, errors);
  assertFiniteNumber(y, `${basePath}.box.y`, errors);
  assertFiniteNumber(w, `${basePath}.box.w`, errors);
  assertFiniteNumber(h, `${basePath}.box.h`, errors);
  assertFiniteNumber(z, `${basePath}.box.z`, errors);
  assertOptionalFiniteNumber(rotation, `${basePath}.box.rotation`, errors);
  if (isFiniteNumber(x) && x < 0) errors.push(`${basePath}.box.x must be >= 0 (got ${String(x)})`);
  if (isFiniteNumber(y) && y < 0) errors.push(`${basePath}.box.y must be >= 0 (got ${String(y)})`);
  if (isFiniteNumber(w) && w < 0) errors.push(`${basePath}.box.w must be >= 0 (got ${String(w)})`);
  if (isFiniteNumber(h) && h < 0) errors.push(`${basePath}.box.h must be >= 0 (got ${String(h)})`);

  if (isFiniteNumber(x) && isFiniteNumber(w) && x + w > pageWidth) {
    errors.push(
      `${basePath}.box extends beyond page width: x+w=${String(x + w)} > page.width=${String(pageWidth)}`,
    );
  }
  if (isFiniteNumber(y) && isFiniteNumber(h) && y + h > sectionHeight) {
    errors.push(
      `${basePath}.box extends beyond section height: y+h=${String(y + h)} > section.height=${String(sectionHeight)}`,
    );
  }
}

function validateMotion(motion: unknown, basePath: string, errors: string[]): void {
  if (motion === undefined) return;
  if (!isRecord(motion)) {
    errors.push(`${basePath}.motion must be an object when present`);
    return;
  }
  assertOneOf<MotionPreset>(motion.preset, MOTION_PRESETS, `${basePath}.motion.preset`, errors);
  assertOptionalFiniteNumber(motion.delayMs, `${basePath}.motion.delayMs`, errors);
}

// Keys must be plain CSS property names (ASCII letters + hyphen). Anything
// else risks smuggling characters that break out of the style="" attribute.
const CSS_KEY_RE = /^[a-zA-Z-]+$/;

// Values may not contain characters that introduce a new CSS declaration
// (`;`), open/close a block (`{`/`}`), or terminate the surrounding HTML tag
// via a leaked `</style>` sequence. Control characters are rejected outright
// — a NUL or newline can split the value in unexpected ways.
function pinnedStyleValueIssue(val: string): string | null {
  for (let i = 0; i < val.length; i++) {
    const code = val.charCodeAt(i);
    if (code < 0x20) return 'control character';
    const ch = val[i];
    if (ch === ';' || ch === '{' || ch === '}') return `forbidden character "${ch}"`;
  }
  if (/<\//i.test(val)) return 'forbidden sequence "</"';
  return null;
}

function validatePinnedStyle(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${basePath}.pinnedStyle must be an object when present`);
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    if (!CSS_KEY_RE.test(key)) {
      errors.push(
        `${basePath}.pinnedStyle key "${key}" must match /^[a-zA-Z-]+$/ (CSS property names only)`,
      );
    }
    if (typeof val !== 'string') {
      errors.push(`${basePath}.pinnedStyle["${key}"] must be a string`);
      continue;
    }
    const issue = pinnedStyleValueIssue(val);
    if (issue !== null) {
      errors.push(
        `${basePath}.pinnedStyle["${key}"] value ${JSON.stringify(val)} contains ${issue}`,
      );
    }
  }
}

const ASSET_ID_RE = /^[A-Za-z0-9._-]+$/;

function isAssetIdLike(value: unknown): value is string {
  return typeof value === 'string' && ASSET_ID_RE.test(value);
}

// Single source of truth for the canonical site-id regex (ADR 0012 dec 3).
// Five call sites used to declare or inline this shape — `src/editor/canvas-client.ts`,
// `src/editor/route.tsx`, `src/routes/api/on-site-edit.ts`, `src/live/socket-route.ts`,
// `src/live/site-room.ts`. Changing the shape (e.g. allowing underscores) now
// requires editing exactly one file. canvas-client.ts's outer wrapper imports
// this directly; the IIFE template-literal body cannot import TS modules and
// keeps the regex literal until the ADR-0014/0015 build-pipeline path lands.
export const SITE_ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Predicate for the canonical site-id shape. Use at every site-id boundary
 * (route handlers, WebSocket upgrades, DO entry points). Per ADR 0012 dec 3,
 * the regex source lives next to the predicate; both live in this file.
 */
export function isSiteId(value: unknown): value is string {
  return typeof value === 'string' && SITE_ID_RE.test(value);
}

// Deep-validate the StyleKitPreset shape supplied as `customStyleKit` when
// `styleKit === 'custom'`. Required fields go into CSS or are read by
// per-element renderers (code.ts reads panel/fontFamilyMono/radius;
// chart.ts reads accent); the renderer trusts the shape, so the validator
// is the only gate. Nested variant maps (surfaceVariants, actionVariants,
// motionPresets) are required-to-be-records only — the inner shape is left
// to the resolver, since incomplete maps merge over built-in defaults.
function validateCustomStyleKit(value: unknown, basePath: string, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  const colourFields = [
    'bg',
    'panel',
    'text',
    'muted',
    'accent',
    'accentText',
    'shapeFill',
    'shapeStroke',
  ] as const;
  for (const field of colourFields) {
    validateInjectionSafeString(value[field], field, basePath, errors);
  }
  const cssStringFields = [
    'radius',
    'borderWidth',
    'shadow',
    'shapeStrokeWidth',
    'actionRadius',
    'actionPadding',
    'motionEasing',
  ] as const;
  for (const field of cssStringFields) {
    validateInjectionSafeString(value[field], field, basePath, errors);
  }
  const fontFields = ['fontFamilyDisplay', 'fontFamilyBody', 'fontFamilyMono'] as const;
  for (const field of fontFields) {
    validateInjectionSafeString(value[field], field, basePath, errors);
  }
  const numberFields = [
    'headingScale',
    'bodyScale',
    'labelScale',
    'lineHeight',
    'motionDurationMs',
  ] as const;
  for (const field of numberFields) {
    if (!isFiniteNumber(value[field])) {
      errors.push(`${basePath}.${field} must be a finite number (got ${describe(value[field])})`);
    }
  }
  const variantMaps = ['surfaceVariants', 'actionVariants', 'motionPresets'] as const;
  for (const field of variantMaps) {
    if (!isRecord(value[field])) {
      errors.push(`${basePath}.${field} must be an object (got ${describe(value[field])})`);
    }
  }
  if (value.dark !== undefined && !isRecord(value.dark)) {
    errors.push(`${basePath}.dark must be an object when present (got ${describe(value.dark)})`);
  }
  // Optional tint tokens (gap #17) — semantic accent map. Keys must be
  // identifier-shaped so they can't collide with raw CSS colour values when
  // the resolver disambiguates token references from literals.
  if (value.tintTokens !== undefined) {
    if (!isRecord(value.tintTokens)) {
      errors.push(
        `${basePath}.tintTokens must be an object when present (got ${describe(value.tintTokens)})`,
      );
    } else {
      for (const [tokenName, colour] of Object.entries(value.tintTokens)) {
        if (!/^[a-z][a-z0-9-]*$/.test(tokenName)) {
          errors.push(
            `${basePath}.tintTokens key ${JSON.stringify(tokenName)} must match /^[a-z][a-z0-9-]*$/`,
          );
        }
        validateInjectionSafeString(colour, `tintTokens.${tokenName}`, basePath, errors);
      }
    }
  }
}

// Validate one user-controlled string field by the pinned-style safety rules
// (no `;`, `{`, `}`, control chars, no `</`). Used by elementStyle colour
// fields, page background, and customStyleKit colour/CSS-string fields — any
// payload that lands in a `style="..."` attribute or a CSS declaration.
//
// Required fields call this directly; optional fields guard with
// `!== undefined` at the call site so a missing optional doesn't error.
function validateInjectionSafeString(
  value: unknown,
  field: string,
  basePath: string,
  errors: string[],
): void {
  if (typeof value !== 'string') {
    errors.push(`${basePath}.${field} must be a string (got ${describe(value)})`);
    return;
  }
  const issue = pinnedStyleValueIssue(value);
  if (issue !== null) {
    errors.push(`${basePath}.${field} value ${JSON.stringify(value)} contains ${issue}`);
  }
}

function validateElementStyle(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${basePath}.elementStyle must be an object when present`);
    return;
  }
  const p = `${basePath}.elementStyle`;
  if (value.backgroundColor !== undefined) {
    validateInjectionSafeString(value.backgroundColor, 'backgroundColor', p, errors);
  }
  if (value.backgroundImageAssetId !== undefined && !isAssetIdLike(value.backgroundImageAssetId)) {
    errors.push(`${p}.backgroundImageAssetId must be an asset id, not a path or URL`);
  }
  if (value.backgroundSize !== undefined) {
    assertOneOf<BackgroundSize>(
      value.backgroundSize,
      BACKGROUND_SIZES,
      `${p}.backgroundSize`,
      errors,
    );
  }
  if (value.borderRadius !== undefined) {
    if (!isFiniteNumber(value.borderRadius) || value.borderRadius < 0) {
      errors.push(`${p}.borderRadius must be a non-negative number`);
    }
  }
  if (value.borderColor !== undefined) {
    validateInjectionSafeString(value.borderColor, 'borderColor', p, errors);
  }
  if (value.borderWidth !== undefined) {
    if (!isFiniteNumber(value.borderWidth) || value.borderWidth < 0) {
      errors.push(`${p}.borderWidth must be a non-negative number`);
    }
  }
  if (value.opacity !== undefined) {
    if (!isFiniteNumber(value.opacity) || value.opacity < 0 || value.opacity > 1) {
      errors.push(`${p}.opacity must be a number in [0, 1]`);
    }
  }
  if (value.boxShadow !== undefined) {
    validateInjectionSafeString(value.boxShadow, 'boxShadow', p, errors);
  }
  if (value.color !== undefined) {
    validateInjectionSafeString(value.color, 'color', p, errors);
  }
  if (value.overflow !== undefined) {
    assertOneOf<OverflowValue>(value.overflow, OVERFLOW_VALUES, `${p}.overflow`, errors);
  }
}

// Per-form visual customisation. Every field optional; numeric fields must be
// finite + non-negative; string fields go through the same pinned-style safety
// rules elementStyle uses so a malicious value cannot break out of the CSS
// declaration the renderer emits.
function validateFormStyle(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${basePath}.formStyle must be an object when present`);
    return;
  }
  const p = `${basePath}.formStyle`;

  const nonNegativeNumber = (field: string, v: unknown): void => {
    if (v === undefined) return;
    if (!isFiniteNumber(v) || v < 0) {
      errors.push(`${p}.${field} must be a non-negative finite number`);
    }
  };
  const safeString = (field: string, v: unknown): void => {
    if (v === undefined) return;
    validateInjectionSafeString(v, field, p, errors);
  };

  if (value.fontFamily !== undefined) {
    assertOneOf<FormFontFamily>(value.fontFamily, FORM_FONT_FAMILIES, `${p}.fontFamily`, errors);
  }
  safeString('fontFamilyCustom', value.fontFamilyCustom);
  if (value.fontFamily === 'custom' && !isNonEmptyString(value.fontFamilyCustom)) {
    errors.push(`${p}.fontFamilyCustom must be a non-empty string when fontFamily === "custom"`);
  }
  nonNegativeNumber('fontSize', value.fontSize);
  nonNegativeNumber('fieldGap', value.fieldGap);

  safeString('labelColor', value.labelColor);
  nonNegativeNumber('labelFontSize', value.labelFontSize);
  if (value.labelFontWeight !== undefined) {
    assertOneOf<FormFontWeight>(
      value.labelFontWeight,
      FORM_FONT_WEIGHTS,
      `${p}.labelFontWeight`,
      errors,
    );
  }

  safeString('inputBackgroundColor', value.inputBackgroundColor);
  safeString('inputColor', value.inputColor);
  safeString('inputBorderColor', value.inputBorderColor);
  nonNegativeNumber('inputBorderWidth', value.inputBorderWidth);
  nonNegativeNumber('inputBorderRadius', value.inputBorderRadius);
  nonNegativeNumber('inputPaddingX', value.inputPaddingX);
  nonNegativeNumber('inputPaddingY', value.inputPaddingY);
  safeString('inputPlaceholderColor', value.inputPlaceholderColor);
  safeString('inputFocusRingColor', value.inputFocusRingColor);

  safeString('submitBackgroundColor', value.submitBackgroundColor);
  safeString('submitColor', value.submitColor);
  safeString('submitHoverBackgroundColor', value.submitHoverBackgroundColor);
  safeString('submitBorderColor', value.submitBorderColor);
  nonNegativeNumber('submitBorderWidth', value.submitBorderWidth);
  nonNegativeNumber('submitBorderRadius', value.submitBorderRadius);
  nonNegativeNumber('submitPaddingX', value.submitPaddingX);
  nonNegativeNumber('submitPaddingY', value.submitPaddingY);
  nonNegativeNumber('submitFontSize', value.submitFontSize);
  if (value.submitFontWeight !== undefined) {
    assertOneOf<FormFontWeight>(
      value.submitFontWeight,
      FORM_FONT_WEIGHTS,
      `${p}.submitFontWeight`,
      errors,
    );
  }
  if (value.submitFullWidth !== undefined && typeof value.submitFullWidth !== 'boolean') {
    errors.push(`${p}.submitFullWidth must be a boolean when present`);
  }
}

function validatePageMotionLayout(
  page: Record<string, unknown>,
  basePath: string,
  errors: string[],
): void {
  if (page.entranceAnimation !== undefined) {
    assertOneOf<MotionPreset>(
      page.entranceAnimation,
      MOTION_PRESETS,
      `${basePath}.entranceAnimation`,
      errors,
    );
  }
  if (page.scrollTriggerMode !== undefined) {
    assertOneOf<ScrollTriggerMode>(
      page.scrollTriggerMode,
      SCROLL_TRIGGER_MODES,
      `${basePath}.scrollTriggerMode`,
      errors,
    );
  }
  if (page.pageBackground !== undefined) {
    if (typeof page.pageBackground !== 'string' || page.pageBackground.length === 0) {
      errors.push(`${basePath}.pageBackground must be a non-empty string when present`);
    } else {
      const issue = pinnedStyleValueIssue(page.pageBackground);
      if (issue !== null) {
        errors.push(
          `${basePath}.pageBackground value ${JSON.stringify(page.pageBackground)} contains ${issue}`,
        );
      } else if (escapeCssValue(page.pageBackground) === '') {
        errors.push(
          `${basePath}.pageBackground value ${JSON.stringify(page.pageBackground)} contains forbidden CSS syntax`,
        );
      }
    }
  }
  if (page.defaultMotionPreset !== undefined) {
    assertOneOf<MotionPreset>(
      page.defaultMotionPreset,
      MOTION_PRESETS,
      `${basePath}.defaultMotionPreset`,
      errors,
    );
  }
  if (page.sectionGap !== undefined) {
    if (!isFiniteNumber(page.sectionGap) || page.sectionGap < 0 || page.sectionGap > 120) {
      errors.push(`${basePath}.sectionGap must be a finite number in [0, 120]`);
    }
  }
  if (page.maxWidth !== undefined) {
    if (!isFiniteNumber(page.maxWidth) || page.maxWidth < 600 || page.maxWidth > 2400) {
      errors.push(`${basePath}.maxWidth must be a finite number in [600, 2400]`);
    }
  }
}

// Assert a value has not been seen before in the caller's `seen` set and
// register it as seen if not. The set is mutated as a side effect so the
// caller can keep walking the tree without re-passing it; the "assert"
// framing names the failure mode (duplicate) since that is the only
// observable outcome to a reader of the call site. `scope` is the trailing
// fragment of the error string (e.g. "within page", "across pages",
// "within the same run") so the Owner's error reads naturally.
function assertUnique<T extends string>(
  value: T | undefined | null,
  seen: Set<T>,
  path: string,
  scope: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || value.length === 0) return;
  if (seen.has(value)) {
    errors.push(`${path} "${value}" is duplicated ${scope}`);
  } else {
    seen.add(value);
  }
}

// Element-specific shim that pulls .id off the value first; kept as a thin
// wrapper because every element-loop currently calls into it and the
// inline shape `assertUnique(element?.id, ...)` would force every caller to
// re-derive the path-with-".id" suffix.
function assertUniqueElementId(
  element: unknown,
  elementPath: string,
  pageIds: Set<string>,
  errors: string[],
): void {
  if (!isRecord(element)) return;
  const id = typeof element.id === 'string' ? element.id : undefined;
  assertUnique(id, pageIds, `${elementPath}.id`, 'within page', errors);
}

/**
 * Validate the rich text payload of a TextElement: a non-empty array of
 * inline runs whose marks are well-formed and whose concatenated text is not
 * empty. Errors are appended to `errors` — never short-circuit, the Owner
 * wants every issue listed at once.
 *
 * `basePath` is the dotted path to the text element itself (e.g.
 * `pages[0].sections[1].elements[3]`). All error strings hang off
 * `${basePath}.content[…]` so the Owner gets a uniform path-shape error and
 * the previous "text element <id>." prose prefix goes away (ADR 0012 dec 4).
 */
function validateTextContent(
  content: unknown,
  basePath: string,
  errors: string[],
  options: { allowEmptyConcat?: boolean } = {},
): void {
  const contentPath = `${basePath}.content`;
  if (!Array.isArray(content) || content.length === 0) {
    errors.push(`${contentPath} must be a non-empty array`);
    return;
  }
  let concatenated = '';
  content.forEach((run, runIdx) => {
    const runPath = `${contentPath}[${String(runIdx)}]`;
    if (!isRecord(run)) {
      errors.push(`${runPath} must be an object`);
      return;
    }
    if (typeof run.text !== 'string') {
      errors.push(`${runPath}.text must be a string (got ${describe(run.text)})`);
    } else {
      concatenated += run.text;
    }
    if (run.math !== undefined) {
      if (!isRecord(run.math)) {
        errors.push(`${runPath}.math must be an object when present`);
      } else if (typeof run.math.tex !== 'string' || run.math.tex.length === 0) {
        errors.push(
          `${runPath}.math.tex must be a non-empty string (got ${describe(run.math.tex)})`,
        );
      } else if (run.math.tex.length > INLINE_MATH_TEX_MAX_LEN) {
        errors.push(
          `${runPath}.math.tex exceeds the ${String(INLINE_MATH_TEX_MAX_LEN)}-char cap (got ${String(run.math.tex.length)})`,
        );
      }
    }
    if (run.marks === undefined) return;
    if (!Array.isArray(run.marks)) {
      errors.push(`${runPath}.marks must be an array when present`);
      return;
    }
    const seenTypes = new Set<string>();
    run.marks.forEach((mark, markIdx) => {
      const markPath = `${runPath}.marks[${String(markIdx)}]`;
      if (!isRecord(mark)) {
        errors.push(`${markPath} must be an object`);
        return;
      }
      if (!assertOneOf<InlineMarkType>(mark.type, INLINE_MARK_TYPES, `${markPath}.type`, errors)) {
        return;
      }
      assertUnique(mark.type, seenTypes, `${markPath}.type`, 'within the same run', errors);
      if (mark.type === 'link') {
        if (typeof mark.href !== 'string' || mark.href.length === 0) {
          errors.push(
            `${markPath}.href must be a non-empty string for link marks (got ${describe(mark.href)})`,
          );
          return;
        }
        if (!isAllowedHref(mark.href)) {
          errors.push(
            `${markPath}.href "${mark.href}" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)`,
          );
        }
        if (mark.target !== undefined && mark.target !== '_blank') {
          errors.push(
            `${markPath}.target must be "_blank" when present (got ${describe(mark.target)})`,
          );
        }
      }
      if (mark.type === 'fontSize') {
        if (typeof mark.px !== 'number' || !Number.isFinite(mark.px)) {
          errors.push(
            `${markPath}.px must be a finite number for fontSize marks (got ${describe(mark.px)})`,
          );
          return;
        }
        if (mark.px < INLINE_FONT_SIZE_PX_MIN || mark.px > INLINE_FONT_SIZE_PX_MAX) {
          errors.push(
            `${markPath}.px ${String(mark.px)} out of range [${String(INLINE_FONT_SIZE_PX_MIN)}, ${String(INLINE_FONT_SIZE_PX_MAX)}]`,
          );
        }
      }
      if (mark.type === 'color') {
        // Missing / empty / non-string colour: orphaned color mark — common
        // when an inbound op or paste hands us a {type:'color'} with no value.
        // Coerce in place to a sane default so the save lands instead of
        // failing the whole document. Actual hex-malformed values (named
        // colours, rgb(), etc.) still hard-fail — the hex-only contract is
        // a render-safety boundary we don't silently rewrite around.
        if (typeof mark.color !== 'string' || mark.color.length === 0) {
          mark.color = '#000000';
        } else if (!INLINE_COLOR_HEX_RE.test(mark.color)) {
          errors.push(
            `${markPath}.color ${describe(mark.color)} must be a hex colour (#RGB, #RRGGBB, or #RRGGBBAA)`,
          );
        }
      }
    });
  });
  if (concatenated.length === 0 && options.allowEmptyConcat !== true) {
    errors.push(`${basePath} has empty concatenated plain text`);
  }
}

// ADR 0063 dec 1 + dec 6 — the new CollectionElement has no authorable
// children. Per-entry instances are materializer output, not part of the
// canvas document, so the validator has nothing to recurse into. The old
// `validateCollectionChildren` / `validateCollectionEntries` helpers (which
// walked `entryTemplate` / `cardTemplate` / `entries`) were removed alongside
// those fields; the anchor-uniqueness walker in `validatePageAnchorIdUniqueness`
// now stops at the Collection wrapper.

/**
 * Strict format for `anchorId` per ADR 0050 dec 2: ASCII lowercase, digits,
 * hyphens; must start with a letter. Stricter than HTML's id contract but
 * keeps anchor URLs reader-friendly + escape-free at every consumer.
 */
const ANCHOR_ID_RE = /^[a-z][a-z0-9-]*$/;

function validateAnchorId(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !ANCHOR_ID_RE.test(value)) {
    errors.push(
      `${basePath}.anchorId must match /^[a-z][a-z0-9-]*$/ (lowercase ASCII letters, digits, hyphens; must start with a letter) (got ${describe(value)})`,
    );
  }
}

function validateElement(
  element: unknown,
  pageWidth: number,
  sectionHeight: number,
  basePath: string,
  errors: string[],
  validPageIds: Set<string> | null,
  pageIds: Set<string>,
): void {
  if (!isRecord(element)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(element.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  }
  // Accumulate the type-discriminant error but keep validating box, motion,
  // and style — those checks are independent of the type-specific switch
  // below. Only skip the switch when the discriminant is unknown.
  const knownType = assertOneOf<ElementType>(
    element.type,
    ELEMENT_TYPES,
    `${basePath}.type`,
    errors,
  );

  validateBox(element.box, pageWidth, sectionHeight, basePath, errors);
  validateMotion(element.motion, basePath, errors);
  validatePinnedStyle(element.pinnedStyle, basePath, errors);
  validateElementStyle(element.elementStyle, basePath, errors);
  validateAnchorId(element.anchorId, basePath, errors);
  // ADR 0054 dec 1 - optional sticky positioning.
  if (element.stickyOffset !== undefined) {
    if (!isFiniteNumber(element.stickyOffset) || element.stickyOffset < 0) {
      errors.push(
        `${basePath}.stickyOffset must be a finite number >= 0 when present (got ${describe(element.stickyOffset)})`,
      );
    }
  }
  if (element.richMotionAssetId !== undefined) {
    assertNonEmptyString(element.richMotionAssetId, `${basePath}.richMotionAssetId`, errors);
  }

  if (!knownType) return;

  switch (element.type) {
    case 'text': {
      validateTextContent(element.content, basePath, errors);
      assertOneOf(element.role, ['heading', 'body', 'label'] as const, `${basePath}.role`, errors);
      if (!isFiniteNumber(element.fontSize) || element.fontSize <= 0) {
        errors.push(`${basePath}.fontSize must be a positive number`);
      }
      // fontWeight is a NUMBER union (400|500|600|700) not a string union, so
      // it doesn't go through assertOneOf — that helper compares string values
      // with includes().
      if (
        element.fontWeight !== 400 &&
        element.fontWeight !== 500 &&
        element.fontWeight !== 600 &&
        element.fontWeight !== 700
      ) {
        errors.push(
          `${basePath}.fontWeight must be one of [400, 500, 600, 700] (got ${describe(element.fontWeight)})`,
        );
      }
      assertOneOf(element.align, ['left', 'center', 'right'] as const, `${basePath}.align`, errors);
      // Optional typography fields — bundle A. Each is delete-on-empty for the
      // editor; absence means "use the renderer default", a present value is
      // emitted verbatim. Bounds match TEXT_LINE_HEIGHT_MIN/MAX in elements/text.ts.
      if (element.letterSpacing !== undefined) {
        if (typeof element.letterSpacing !== 'string' || element.letterSpacing.length === 0) {
          errors.push(
            `${basePath}.letterSpacing must be a non-empty string when present (got ${describe(element.letterSpacing)})`,
          );
        } else if (escapeCssValue(element.letterSpacing) !== element.letterSpacing) {
          errors.push(
            `${basePath}.letterSpacing contains characters disallowed by CSS value escaping`,
          );
        }
      }
      if (element.textWrap !== undefined) {
        assertOneOf(
          element.textWrap,
          ['pretty', 'balance'] as const,
          `${basePath}.textWrap`,
          errors,
        );
      }
      if (element.lineHeight !== undefined) {
        if (!isFiniteNumber(element.lineHeight)) {
          errors.push(
            `${basePath}.lineHeight must be a finite number when present (got ${describe(element.lineHeight)})`,
          );
        } else if (element.lineHeight < 0.5 || element.lineHeight > 3.0) {
          errors.push(
            `${basePath}.lineHeight must be between 0.5 and 3.0 (got ${String(element.lineHeight)})`,
          );
        }
      }
      if (element.textTransform !== undefined) {
        assertOneOf(
          element.textTransform,
          ['uppercase', 'lowercase', 'capitalize'] as const,
          `${basePath}.textTransform`,
          errors,
        );
      }
      // ADR 0050 dec 1 — fluid font sizing. All three knobs must be finite
      // and positive; min < max ensures clamp() produces a non-empty range;
      // vw bounded so an ultra-wide viewport doesn't blow heading text past
      // the layout (TEXT_FLUID_VW_MIN/MAX live in elements/text.ts).
      if (element.fluidSize !== undefined) {
        const fsPath = `${basePath}.fluidSize`;
        if (!isRecord(element.fluidSize)) {
          errors.push(
            `${fsPath} must be an object when present (got ${describe(element.fluidSize)})`,
          );
        } else {
          const rawMin = element.fluidSize.min;
          const rawMax = element.fluidSize.max;
          const rawVw = element.fluidSize.vw;
          if (!isFiniteNumber(rawMin) || !isFiniteNumber(rawMax) || !isFiniteNumber(rawVw)) {
            errors.push(`${fsPath} must carry finite numeric min, max, vw`);
          } else {
            if (rawMin <= 0) errors.push(`${fsPath}.min must be > 0 (got ${String(rawMin)})`);
            if (rawMax <= rawMin) {
              errors.push(
                `${fsPath}.max must be > min (got min=${String(rawMin)}, max=${String(rawMax)})`,
              );
            }
            if (rawVw < 1 || rawVw > 30) {
              errors.push(`${fsPath}.vw must be in [1, 30] (got ${String(rawVw)})`);
            }
          }
        }
      }
      assertOptionalBoolean(element.isRichText, `${basePath}.isRichText`, errors);
      break;
    }
    case 'media': {
      const knownMediaKind = assertOneOf<MediaKind>(
        element.mediaKind,
        MEDIA_KINDS,
        `${basePath}.mediaKind`,
        errors,
      );
      if (typeof element.assetId !== 'string') {
        errors.push(
          `${basePath}.assetId must be a string (empty string allowed for unfilled slots)`,
        );
      }
      if (typeof element.alt !== 'string') {
        errors.push(`${basePath}.alt must be a string`);
      }
      assertOneOf<BackgroundSize>(element.fit, BACKGROUND_SIZES, `${basePath}.fit`, errors);
      if (!knownMediaKind) {
        break;
      }
      if (element.mediaKind === 'image') {
        if (element.posterAssetId !== undefined) {
          errors.push(`${basePath}.posterAssetId is only allowed when mediaKind is "video"`);
        }
        if (element.playback !== undefined) {
          errors.push(`${basePath}.playback is only allowed when mediaKind is "video"`);
        }
        break;
      }

      if (element.posterAssetId !== undefined && typeof element.posterAssetId !== 'string') {
        errors.push(
          `${basePath}.posterAssetId must be a string when present (empty string allowed for unfilled slots)`,
        );
      }
      if (element.playback !== undefined) {
        if (!isRecord(element.playback)) {
          errors.push(`${basePath}.playback must be an object when present`);
          break;
        }
        for (const field of ['autoplay', 'muted', 'loop', 'controls'] as const) {
          assertOptionalBoolean(element.playback[field], `${basePath}.playback.${field}`, errors);
        }
        const { autoplay, muted } = element.playback;
        if (autoplay === true && muted !== true) {
          errors.push(
            `${basePath}.playback: video with autoplay=true must also set muted=true (visitor autoplay policy)`,
          );
        }
      }
      break;
    }
    case 'carousel': {
      if (element.mode !== undefined) {
        assertOneOf(element.mode, CAROUSEL_MODES, `${basePath}.mode`, errors);
      }
      // ADR 0066 — optional variant-preset enum.
      if (element.variant !== undefined) {
        assertOneOf(element.variant, CAROUSEL_VARIANTS, `${basePath}.variant`, errors);
      }
      break;
    }
    case 'action': {
      // ADR 0051 dec 1 — label is InlineRun[], same shape as TextElement.content.
      // Editor can produce empty labels (Owner deletes every char in the
      // toolbar). Two posture branches:
      //   - icon-only is legitimate (renderer skips the <span> when concat
      //     text is empty AND iconKind is set — see action-icon-shrink.smoke)
      //     so we pass allowEmptyConcat:true and let the empty runs through.
      //   - no icon either: coerce to a default label rather than reject the
      //     whole document. Owners get a visible "Button" they can re-edit
      //     instead of an opaque "save failed" toast.
      const iconOnlyOk = isIconName(element.iconKind);
      if (Array.isArray(element.label)) {
        const concat = element.label
          .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
          .join('');
        if (concat.length === 0 && !iconOnlyOk) {
          element.label = [{ text: 'Button' }];
        }
      }
      validateTextContent(element.label, basePath + '.label', errors, {
        allowEmptyConcat: iconOnlyOk,
      });
      // ADR 0051 dec 2 — optional icon glyph.
      if (element.iconKind !== undefined) {
        if (!isIconName(element.iconKind)) {
          errors.push(
            `${basePath}.iconKind must be one of [${ICON_NAMES.join(', ')}] when present (got ${describe(element.iconKind)})`,
          );
        }
      }
      // ADR 0051 dec 3 — discriminated union over href vs behavior. Exactly
      // one must be set on a well-formed action; neither (no destination) and
      // both (ambiguous click target) are equally invalid.
      const hasHref = element.href !== undefined;
      const hasBehavior = element.behavior !== undefined;
      if (!hasHref && !hasBehavior) {
        errors.push(`${basePath} must set exactly one of href or behavior (got neither)`);
      } else if (hasHref && hasBehavior) {
        errors.push(`${basePath} must set exactly one of href or behavior (got both)`);
      } else if (hasHref) {
        validateActionHref(element.href, basePath + '.href', errors, validPageIds);
      } else {
        const bPath = `${basePath}.behavior`;
        if (!isRecord(element.behavior)) {
          errors.push(`${bPath} must be an object`);
        } else if (element.behavior.type !== 'copy') {
          errors.push(`${bPath}.type must be "copy" (got ${describe(element.behavior.type)})`);
        } else if (
          typeof element.behavior.value !== 'string' ||
          element.behavior.value.length === 0
        ) {
          errors.push(`${bPath}.value must be a non-empty string`);
        }
      }
      assertOneOf<ActionVariant>(element.variant, ACTION_VARIANTS, `${basePath}.variant`, errors);
      break;
    }
    case 'shape': {
      assertOneOf<ShapeVariant>(element.variant, SHAPE_VARIANTS, `${basePath}.variant`, errors);
      // ADR 0051 dec 2 — variant 'icon' requires a valid iconKind. Other
      // variants ignore iconKind; the renderer never reads it for non-icon
      // shapes, so absence is fine.
      if (element.variant === 'icon') {
        // Editor lets Owners pick variant='icon' without choosing an iconKind
        // (or before they pick one). Coerce to a sane default so the save
        // lands; the Owner sees a placeholder glyph they can swap rather
        // than an opaque "save failed" toast.
        if (!isIconName(element.iconKind)) {
          element.iconKind = 'arrow-up-right';
        }
      } else if (element.iconKind !== undefined && !isIconName(element.iconKind)) {
        errors.push(
          `${basePath}.iconKind must be one of [${ICON_NAMES.join(', ')}] when present (got ${describe(element.iconKind)})`,
        );
      }
      break;
    }
    case 'form': {
      validateFormStyle(element.formStyle, basePath, errors);
      // ADR 0066 — optional variant-preset enum.
      if (element.variant !== undefined) {
        assertOneOf(element.variant, FORM_VARIANTS, `${basePath}.variant`, errors);
      }
      break;
    }
    case 'container': {
      assertOneOf<SurfaceVariant>(element.variant, SURFACE_VARIANTS, `${basePath}.variant`, errors);
      // ADR 0051 dec 5 — optional linkHref makes the container wrapper an <a>.
      if (element.linkHref !== undefined) {
        validateActionHref(element.linkHref, basePath + '.linkHref', errors, validPageIds);
        if (!isNonEmptyString(element.linkLabel)) {
          errors.push(`${basePath}.linkLabel must be a non-empty string when linkHref is set`);
        }
      } else if (element.linkLabel !== undefined && !isNonEmptyString(element.linkLabel)) {
        errors.push(`${basePath}.linkLabel must be a non-empty string when present`);
      }
      // Gap #17 — optional tint. Either an identifier (resolved against
      // StyleKitPreset.tintTokens) or a raw CSS colour; both share the
      // pinned-style safety rules.
      if (element.tint !== undefined) {
        validateInjectionSafeString(element.tint, 'tint', basePath, errors);
      }
      break;
    }
    case 'collection': {
      // ADR 0063 dec 1 — element-level binding. `collectionSlug` may be
      // undefined (the inspector shows a "Pick a source" prompt) but when
      // present it must be a non-empty string.
      if (element.collectionSlug !== undefined) {
        if (!isNonEmptyString(element.collectionSlug)) {
          errors.push(
            `${basePath}.collectionSlug must be a non-empty string when present (got ${describe(element.collectionSlug)})`,
          );
        }
      }
      // ADR 0063 dec 7 — folder filter. Optional; same shape constraints
      // as the API write boundary so a malformed value cannot ride into
      // the canvas state from an out-of-band writer either.
      if (element.folder !== undefined) {
        if (typeof element.folder !== 'string' || element.folder.length === 0) {
          errors.push(
            `${basePath}.folder must be a non-empty string when present (got ${describe(element.folder)})`,
          );
        } else if (element.folder.length > 64) {
          errors.push(
            `${basePath}.folder exceeds the 64-char cap (got ${String(element.folder.length)})`,
          );
        } else if (element.folder.includes('/') || element.folder.includes('\\')) {
          errors.push(
            `${basePath}.folder must not contain "/" or "\\" (got ${describe(element.folder)})`,
          );
        }
      }
      // `sort` and `display` are optional during the multi-commit migration
      // (Phase 1 lands the shape; Phase 2B tightens to required-on-insert).
      if (element.sort !== undefined) {
        assertOneOf<CollectionSort>(element.sort, COLLECTION_SORTS, `${basePath}.sort`, errors);
      }
      if (element.display !== undefined) {
        assertOneOf<CollectionDisplay>(
          element.display,
          COLLECTION_DISPLAYS,
          `${basePath}.display`,
          errors,
        );
      }
      // `manualOrder` is required-shape iff `sort === 'manual'`, optional
      // (but if present must be string[]) otherwise. Stale ids are stripped
      // by the inspector on next render (ADR 0063 dec 8) — the validator
      // only enforces shape, not entry-existence.
      if (element.manualOrder !== undefined) {
        if (!Array.isArray(element.manualOrder)) {
          errors.push(
            `${basePath}.manualOrder must be an array when present (got ${describe(element.manualOrder)})`,
          );
        } else {
          element.manualOrder.forEach((entryId, idx) => {
            if (!isNonEmptyString(entryId)) {
              errors.push(
                `${basePath}.manualOrder[${String(idx)}] must be a non-empty string (got ${describe(entryId)})`,
              );
            }
          });
        }
      }
      // ADR 0065 D2 — `customTemplate` carries an authorable element
      // subtree the Owner edits in-place when `display === 'custom'`.
      // Recurse the same way TabsElement walks tab.elements: per-child
      // id-uniqueness against the page's local id pool, full element
      // validation against the Collection element's box dimensions.
      if (element.customTemplate !== undefined) {
        if (!Array.isArray(element.customTemplate)) {
          errors.push(
            `${basePath}.customTemplate must be an array when present (got ${describe(element.customTemplate)})`,
          );
        } else {
          const childWidth =
            isRecord(element.box) && isFiniteNumber(element.box.w) && element.box.w > 0
              ? element.box.w
              : pageWidth;
          const childHeight =
            isRecord(element.box) && isFiniteNumber(element.box.h) && element.box.h > 0
              ? element.box.h
              : sectionHeight;
          element.customTemplate.forEach((child, childIdx) => {
            const childPath = `${basePath}.customTemplate[${String(childIdx)}]`;
            assertUniqueElementId(child, childPath, pageIds, errors);
            validateElement(
              child,
              childWidth,
              childHeight,
              childPath,
              errors,
              validPageIds,
              pageIds,
            );
          });
        }
      }
      break;
    }
    case 'nav': {
      assertOneOf<NavLayout>(element.layout, NAV_LAYOUTS, `${basePath}.layout`, errors);
      if (typeof element.sticky !== 'boolean') {
        errors.push(`${basePath}.sticky must be a boolean (got ${describe(element.sticky)})`);
      }
      if (element.logoAssetId !== undefined && !isAssetIdLike(element.logoAssetId)) {
        errors.push(
          `${basePath}.logoAssetId must be an asset id matching /^[A-Za-z0-9._-]+$/ when present (got ${describe(element.logoAssetId)})`,
        );
      }
      if (element.siteTitle !== undefined && !isNonEmptyString(element.siteTitle)) {
        errors.push(
          `${basePath}.siteTitle must be a non-empty string when present (got ${describe(element.siteTitle)})`,
        );
      }
      if (!Array.isArray(element.links)) {
        errors.push(`${basePath}.links must be an array`);
      } else {
        element.links.forEach((link, idx) => {
          validateNavLink(link, `${basePath}.links[${String(idx)}]`, errors);
        });
      }
      if (element.primaryAction !== undefined) {
        validateNavLink(element.primaryAction, `${basePath}.primaryAction`, errors);
      }
      break;
    }
    case 'tabs': {
      // ADR 0052 — `tabs.length >= 2`, each tab.id matches anchor-id charset
      // and is unique within the TabsElement, `activeTabId` references one of
      // them, each tab.label is a non-empty InlineRun[], each tab.elements
      // recurses through validateElement with panel-local dimensions.
      // ADR 0066 — optional variant-preset enum.
      if (element.variant !== undefined) {
        assertOneOf(element.variant, TABS_VARIANTS, `${basePath}.variant`, errors);
      }
      if (!Array.isArray(element.tabs) || element.tabs.length < 2) {
        errors.push(`${basePath}.tabs must be an array with length >= 2`);
        break;
      }
      const barHeight =
        isFiniteNumber(element.tabBarHeight) && element.tabBarHeight > 0
          ? element.tabBarHeight
          : TABS_DEFAULT_BAR_HEIGHT;
      if (element.tabBarHeight !== undefined) {
        if (!isFiniteNumber(element.tabBarHeight) || element.tabBarHeight <= 0) {
          errors.push(
            `${basePath}.tabBarHeight must be a positive finite number when present (got ${describe(element.tabBarHeight)})`,
          );
        }
      }
      const childWidth =
        isRecord(element.box) && isFiniteNumber(element.box.w) && element.box.w > 0
          ? element.box.w
          : pageWidth;
      const rawHeight =
        isRecord(element.box) && isFiniteNumber(element.box.h) && element.box.h > 0
          ? element.box.h
          : sectionHeight;
      const childHeight = Math.max(0, rawHeight - barHeight);
      const tabIds = new Set<string>();
      element.tabs.forEach((tab, tabIdx) => {
        const tabPath = `${basePath}.tabs[${String(tabIdx)}]`;
        if (!isRecord(tab)) {
          errors.push(`${tabPath} must be an object`);
          return;
        }
        if (typeof tab.id !== 'string' || !ANCHOR_ID_RE.test(tab.id)) {
          errors.push(`${tabPath}.id must match /^[a-z][a-z0-9-]*$/ (got ${describe(tab.id)})`);
        } else if (tabIds.has(tab.id)) {
          errors.push(
            `${tabPath}.id "${tab.id}" is already used by another tab in this TabsElement`,
          );
        } else {
          tabIds.add(tab.id);
        }
        validateTextContent(tab.label, `${tabPath}.label`, errors);
        if (!Array.isArray(tab.elements)) {
          errors.push(`${tabPath}.elements must be an array`);
        } else {
          tab.elements.forEach((child, childIdx) => {
            const childPath = `${tabPath}.elements[${String(childIdx)}]`;
            assertUniqueElementId(child, childPath, pageIds, errors);
            validateElement(
              child,
              childWidth,
              childHeight,
              childPath,
              errors,
              validPageIds,
              pageIds,
            );
          });
        }
      });
      if (typeof element.activeTabId !== 'string' || element.activeTabId.length === 0) {
        errors.push(`${basePath}.activeTabId must be a non-empty string`);
      } else if (!tabIds.has(element.activeTabId)) {
        errors.push(
          `${basePath}.activeTabId "${element.activeTabId}" must reference one of tabs[].id (known: [${Array.from(tabIds).join(', ')}])`,
        );
      }
      break;
    }
    case 'accordion': {
      // ADR 0066 — optional variant-preset enum. (Accordion items keep their
      // existing pass-through; this case exists solely to gate the variant.)
      if (element.variant !== undefined) {
        assertOneOf(element.variant, ACCORDION_VARIANTS, `${basePath}.variant`, errors);
      }
      break;
    }
    default: {
      // Unknown discriminant — already reported above.
      break;
    }
  }
}

function validateSection(
  section: unknown,
  pageWidth: number,
  basePath: string,
  errors: string[],
  localIds: Set<string>,
  validPageIds: Set<string> | null,
  isPinnedSiteSection: boolean = false,
): void {
  if (!isRecord(section)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(section.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  } else {
    assertUnique(section.id, localIds, `${basePath}.id`, 'within page', errors);
  }
  assertOneOf<SectionRecipeId>(
    section.recipeId,
    SECTION_RECIPE_IDS,
    `${basePath}.recipeId`,
    errors,
  );
  if (!isNonEmptyString(section.name)) {
    errors.push(`${basePath}.name must be a non-empty string`);
  }
  if (section.role !== undefined) {
    assertOneOf<SectionRole>(section.role, SECTION_ROLES, `${basePath}.role`, errors);
  }
  // ADR 0059 — `isPinnedSiteSection` is signalled by the caller (true when
  // validating `state.header` / `state.footer`), no longer derived from a
  // `role` field on the section itself.
  const minHeight = isPinnedSiteSection ? PINNED_SECTION_HEIGHT_MIN : SECTION_HEIGHT_MIN;
  const heightValid =
    isFiniteNumber(section.height) &&
    section.height >= minHeight &&
    section.height <= SECTION_HEIGHT_MAX;
  if (!heightValid) {
    errors.push(
      `${basePath}.height must be a finite number in [${String(minHeight)}, ${String(SECTION_HEIGHT_MAX)}] (got ${describe(section.height)})`,
    );
  }
  if (section.backgroundEffect !== undefined) {
    assertOneOf<BackgroundEffect>(
      section.backgroundEffect,
      BACKGROUND_EFFECTS,
      `${basePath}.backgroundEffect`,
      errors,
    );
  }
  validateAccentBorder(section.accentBorder, pathJoin(basePath, 'accentBorder'), errors);
  if (section.entrance !== undefined) {
    assertOneOf<MotionPreset>(section.entrance, MOTION_PRESETS, `${basePath}.entrance`, errors);
  }
  validateSectionTrigger(section.trigger, pathJoin(basePath, 'trigger'), errors);
  validateBackgroundVideo(
    section.backgroundVideoAssetId,
    pathJoin(basePath, 'backgroundVideoAssetId'),
    errors,
  );
  validateAnchorId(section.anchorId, basePath, errors);
  // ADR 0061 Decision 7 — instanceScope is set at instantiation time and
  // must satisfy `/^[a-z][a-z0-9]*$/`. Optional — Library rows never carry
  // it; only sections materialised from a TemplateSeed composition do.
  if (section.instanceScope !== undefined) {
    if (
      typeof section.instanceScope !== 'string' ||
      !/^[a-z][a-z0-9]*$/.test(section.instanceScope)
    ) {
      errors.push(
        `${basePath}.instanceScope must match /^[a-z][a-z0-9]*$/ (got ${describe(section.instanceScope)})`,
      );
    }
  }
  if (!Array.isArray(section.elements)) {
    errors.push(`${basePath}.elements must be an array`);
    return;
  }
  // Use the validated height when available; fall back to a permissive max so
  // we keep validating element bodies even if the height is bogus.
  const effectiveHeight = heightValid ? (section.height as number) : SECTION_HEIGHT_MAX;
  section.elements.forEach((element, idx) => {
    const path = pathJoin(basePath, 'elements');
    const elementPath = pathJoin(path, idx);
    assertUniqueElementId(element, elementPath, localIds, errors);
    validateElement(
      element,
      pageWidth,
      effectiveHeight,
      elementPath,
      errors,
      validPageIds,
      localIds,
    );
  });
}

// ADR 0062 — discriminated-union accent border. Mirrors the validateSectionTrigger
// shape: arm the type first, then validate the arm-specific fields. The color is
// validated through the same `validateInjectionSafeString` path used by
// `elementStyle.borderColor` and `elementStyle.backgroundColor` so any color
// string the user can already type into a color picker passes here.
function validateAccentBorder(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${basePath} must be an object when present`);
    return;
  }
  if (!assertOneOf<AccentBorderType>(value.type, ACCENT_BORDER_TYPES, `${basePath}.type`, errors)) {
    return;
  }
  validateInjectionSafeString(value.color, 'color', basePath, errors);
  if (value.type === 'solid') {
    if (!isFiniteNumber(value.width) || value.width <= 0) {
      errors.push(`${basePath}.width must be a positive finite number for solid accent borders`);
    }
    if ('thickness' in value || 'radius' in value || 'spread' in value) {
      errors.push(`${basePath} must not carry thickness/radius/spread on a solid accent border`);
    }
  } else if (value.type === 'top' || value.type === 'left') {
    if (!isFiniteNumber(value.thickness) || value.thickness <= 0) {
      errors.push(
        `${basePath}.thickness must be a positive finite number for ${value.type} accent borders`,
      );
    }
    if ('width' in value || 'radius' in value || 'spread' in value) {
      errors.push(
        `${basePath} must not carry width/radius/spread on a ${value.type} accent border`,
      );
    }
  } else if (value.type === 'glow') {
    if (!isFiniteNumber(value.radius) || value.radius <= 0) {
      errors.push(`${basePath}.radius must be a positive finite number for glow accent borders`);
    }
    if (value.spread !== undefined && (!isFiniteNumber(value.spread) || value.spread < 0)) {
      errors.push(`${basePath}.spread must be a non-negative finite number when present`);
    }
    if ('width' in value || 'thickness' in value) {
      errors.push(`${basePath} must not carry width/thickness on a glow accent border`);
    }
  }
}

function validateSectionTrigger(trigger: unknown, basePath: string, errors: string[]): void {
  if (trigger === undefined) return;
  if (!isRecord(trigger)) {
    errors.push(`${basePath} must be an object when present`);
    return;
  }
  if (!assertOneOf(trigger.type, POPUP_TRIGGER_TYPES, `${basePath}.type`, errors)) {
    return;
  }
  if (trigger.type === 'exit-intent') {
    if (trigger.value !== undefined) {
      errors.push(`${basePath}.value must be absent for exit-intent triggers`);
    }
    return;
  }
  if (!isFiniteNumber(trigger.value)) {
    errors.push(`${basePath}.value must be a finite number for ${trigger.type} triggers`);
    return;
  }
  if (trigger.type === 'delay' && trigger.value < 0) {
    errors.push(`${basePath}.value must be >= 0 for delay triggers`);
  }
  if (trigger.type === 'scroll' && (trigger.value < 0 || trigger.value > 100)) {
    errors.push(`${basePath}.value must be in [0, 100] for scroll triggers`);
  }
}

function validateBackgroundVideo(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isNonEmptyString(value)) {
    errors.push(`${basePath} must be a non-empty asset id when present`);
    return;
  }
  if (!isAssetIdLike(value)) {
    errors.push(`${basePath} must be an asset id, not a path or URL`);
  }
}

function validatePage(
  page: unknown,
  basePath: string,
  errors: string[],
  validPageIds: Set<string> | null,
): void {
  if (!isRecord(page)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(page.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  }
  if (!isNonEmptyString(page.slug)) {
    errors.push(`${basePath}.slug must be a non-empty string`);
  }
  assertNonEmptyString(page.title, `${basePath}.title`, errors);
  if (page.publishedDate !== undefined) {
    if (assertOptionalNonEmptyString(page.publishedDate, `${basePath}.publishedDate`, errors)) {
      if (page.publishedDate !== undefined && !isParseableDate(page.publishedDate)) {
        errors.push(`${basePath}.publishedDate must be parseable as a date`);
      }
    }
  }
  assertOptionalNonEmptyString(page.author, `${basePath}.author`, errors);
  if (page.tags !== undefined) {
    if (!Array.isArray(page.tags)) {
      errors.push(`${basePath}.tags must be an array when present`);
    } else {
      page.tags.forEach((tag, tagIdx) => {
        assertNonEmptyString(tag, `${basePath}.tags[${String(tagIdx)}]`, errors);
      });
    }
  }
  assertOptionalNonEmptyString(page.category, `${basePath}.category`, errors);
  assertOptionalNonEmptyString(page.description, `${basePath}.description`, errors);
  // ADR 0060 + ADR 0063 dec 2 + F5 — pageKind + collectionSlug.
  //
  // F5 hard-rejects `pageKind === 'collection-index'`: the page-level
  // binding model is retired per ADR 0063 dec 2 and the source of
  // truth lives on the CollectionElement itself. The on-load
  // migration (site-load-migration.ts) sweeps legacy in-DB rows
  // before the validator runs against them; F3's audit (2026-06-05)
  // confirmed only one prod page carried the dead shape and is
  // handled by that sweep. Anyone trying to author a fresh page with
  // `'collection-index'` (via JSONB hand-edit, an out-of-band writer,
  // or a stale client) hits this error explicitly — no silent
  // re-coercion.
  if (page.pageKind !== undefined) {
    const rawKind = (page as { pageKind?: string }).pageKind;
    if (rawKind === 'collection-index') {
      errors.push(
        `${basePath}.pageKind 'collection-index' is retired; this Collection's binding lives on the CollectionElement itself per ADR 0063.`,
      );
    } else {
      assertOneOf(page.pageKind, COLLECTION_PAGE_KINDS, `${basePath}.pageKind`, errors);
      if (page.collectionSlug === undefined) {
        errors.push(
          `${basePath}.collectionSlug is required when pageKind is set (ADR 0060: a CMS-marked page must name its collection)`,
        );
      }
    }
  }
  if (page.collectionSlug !== undefined) {
    assertOptionalNonEmptyString(page.collectionSlug, `${basePath}.collectionSlug`, errors);
    if (page.pageKind === undefined) {
      errors.push(
        `${basePath}.pageKind is required when collectionSlug is set (ADR 0060: collectionSlug is template metadata, not page metadata)`,
      );
    }
  }
  if (page.ogImageAssetId !== undefined && !isAssetIdLike(page.ogImageAssetId)) {
    errors.push(
      `${basePath}.ogImageAssetId must be an asset id matching /^[A-Za-z0-9._-]+$/ when present (got ${describe(page.ogImageAssetId)})`,
    );
  }
  if (page.canonical !== undefined) {
    if (
      assertOptionalNonEmptyString(page.canonical, `${basePath}.canonical`, errors) &&
      page.canonical !== undefined
    ) {
      const issue = pinnedStyleValueIssue(page.canonical);
      if (issue !== null) {
        errors.push(
          `${basePath}.canonical value ${JSON.stringify(page.canonical)} contains ${issue}`,
        );
      }
    }
  }
  assertOptionalBoolean(page.noIndex, `${basePath}.noIndex`, errors);
  if (page.locale !== undefined && !isNonEmptyString(page.locale)) {
    errors.push(
      `${basePath}.locale must be a non-empty BCP-47 string when present (got ${describe(page.locale)})`,
    );
  }
  const widthValid =
    isFiniteNumber(page.width) && page.width >= PAGE_WIDTH_MIN && page.width <= PAGE_WIDTH_MAX;
  if (!widthValid) {
    errors.push(
      `${basePath}.width must be a finite number in [${String(PAGE_WIDTH_MIN)}, ${String(PAGE_WIDTH_MAX)}] (got ${describe(page.width)})`,
    );
  }
  validatePageMotionLayout(page, basePath, errors);
  if (!Array.isArray(page.sections) || page.sections.length === 0) {
    errors.push(`${basePath}.sections must be a non-empty array`);
    return;
  }
  // ADR 0059 — page-level suppression of the site-level header/footer.
  assertOptionalBoolean(page.suppressHeader, `${basePath}.suppressHeader`, errors);
  assertOptionalBoolean(page.suppressFooter, `${basePath}.suppressFooter`, errors);
  const ids = new Set<string>();
  if (isNonEmptyString(page.id)) ids.add(page.id);
  const effectiveWidth = widthValid ? (page.width as number) : PAGE_WIDTH_MAX;
  page.sections.forEach((section, idx) => {
    const path = pathJoin(pathJoin(basePath, 'sections'), idx);
    validateSection(section, effectiveWidth, path, errors, ids, validPageIds);
  });
  // ADR 0050 dec 2 — anchor ids must be unique across the rendered page
  // (state.header + page.sections + state.footer). The check is run by the
  // site-level validator since header/footer live there, not on the page.
}

function validatePageAnchorIdUniqueness(
  page: Record<string, unknown>,
  basePath: string,
  header: unknown,
  footer: unknown,
  errors: string[],
): void {
  if (!Array.isArray(page.sections)) return;
  const seen = new Map<string, string>(); // anchorId -> first-path
  const visit = (anchor: unknown, path: string): void => {
    if (typeof anchor !== 'string' || !ANCHOR_ID_RE.test(anchor)) return;
    const first = seen.get(anchor);
    if (first === undefined) {
      seen.set(anchor, path);
      return;
    }
    errors.push(
      `${path}.anchorId "${anchor}" is already used at ${first} on the rendered page; anchor ids must be unique within a rendered page (ADR 0050 dec 2)`,
    );
  };
  const visitElementTree = (el: unknown, elementPath: string): void => {
    if (!isRecord(el)) return;
    visit(el.anchorId, elementPath);
    if (el.type === 'tabs' && Array.isArray(el.tabs)) {
      el.tabs.forEach((tab, tabIdx) => {
        if (!isRecord(tab) || !Array.isArray(tab.elements)) return;
        tab.elements.forEach((child, childIdx) => {
          visitElementTree(
            child,
            pathJoin(
              pathJoin(pathJoin(pathJoin(elementPath, 'tabs'), tabIdx), 'elements'),
              childIdx,
            ),
          );
        });
      });
      return;
    }
    // ADR 0065 D2 + codex review pass 5 finding 3 — `customTemplate` carries
    // an author-authored element subtree whose children participate in the
    // rendered page (the materializer clones the template once per entry
    // and suffixes anchorIds per entry to avoid cross-card collisions,
    // pass 4 F4). That per-entry suffixing assumes anchorIds WITHIN the
    // single template are already unique; without this recursion, two
    // template children sharing `anchorId: 'cta'` slip past validation,
    // materialize as duplicate ids per entry, and produce duplicate DOM
    // ids on the published page (e.g. `cta--<slug>` shared by two cards
    // per entry). Recurse the same way Tabs panels recurse — the
    // anchor-id pool is page-wide, customTemplate children share it.
    //
    // Mirror with `entries[][]` is intentionally NOT walked here: those
    // are materializer output regenerated at publish time, with per-entry
    // suffixing already applied. The editor-state walk only needs to
    // enforce uniqueness on the editable surface.
    if (el.type === 'collection' && Array.isArray(el.customTemplate)) {
      el.customTemplate.forEach((child, childIdx) => {
        visitElementTree(child, pathJoin(pathJoin(elementPath, 'customTemplate'), childIdx));
      });
      return;
    }
  };
  const visitSection = (section: unknown, sectionPath: string): void => {
    if (!isRecord(section)) return;
    visit(section.anchorId, sectionPath);
    if (!Array.isArray(section.elements)) return;
    section.elements.forEach((el, eIdx) => {
      const elementPath = pathJoin(pathJoin(sectionPath, 'elements'), eIdx);
      visitElementTree(el, elementPath);
    });
  };
  // ADR 0059 — pages that suppress the site header/footer do not render it,
  // so its anchor ids do not participate in the per-page uniqueness check.
  if (page.suppressHeader !== true) visitSection(header, 'state.header');
  page.sections.forEach((section, sIdx) => {
    const sectionPath = pathJoin(pathJoin(basePath, 'sections'), sIdx);
    visitSection(section, sectionPath);
  });
  if (page.suppressFooter !== true) visitSection(footer, 'state.footer');
}

function validatePageCardinality(pages: unknown[], errors: string[]): void {
  const custom404Count = pages.filter(
    (page) => isRecord(page) && page.slug === CUSTOM_404_PAGE_SLUG,
  ).length;
  const primaryPageCount = pages.length - custom404Count;
  if (primaryPageCount < 1) {
    errors.push('state.pages must contain at least one primary canvas page');
  }
  if (custom404Count > 1) {
    errors.push('state.pages must contain at most one _404 page');
  }
}

// ---------------------------------------------------------------------------
// FIELD_VALIDATORS — registry-driven exhaustiveness (ADR 0012 dec 2)
// ---------------------------------------------------------------------------
//
// Every key of `EditableSite` has an entry. The mapped type
// `Record<keyof EditableSite, SiteFieldValidator>` makes "added a schema
// field but forgot to validate it" a TypeScript compile error — mirroring
// the INSPECTOR_DISPATCH / SIDEBAR_DISPATCH / AGENT_TOOL_DISPATCH /
// Y_*_DISPATCH pattern from ADR 0011.
//
// Each validator inspects ONE field by name. Cross-field deps
// (`customStyleKit` requires `styleKit === 'custom'`; `header`/`footer`
// section validation needs the `validPageIds` set built from the pages
// array) get their inputs via the `SiteFieldValidatorCtx` payload, which
// `validateSiteShape` populates in a documented order: page-id +
// page-slug uniqueness checks build `validPageIds` first; only after that
// does the dispatch run.
//
// Fields whose validation depends on the page-id set (`header`, `footer`,
// and `pages` itself for per-page deep validation) run AFTER the dispatch
// pass — the dispatch handles shape only; deep validation is the next
// phase of `validateSiteShape`.
interface SiteFieldValidatorCtx {
  state: Record<string, unknown>;
  errors: string[];
}

type SiteFieldValidator = (ctx: SiteFieldValidatorCtx) => void;

function validateOptionalDomainObject(
  value: unknown,
  path: string,
  validate: (value: unknown) => void,
  errors: string[],
): void {
  if (value === undefined) return;
  try {
    validate(value);
  } catch (err) {
    errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function validateDomainArray(
  value: unknown,
  path: string,
  validate: (value: unknown) => void,
  errors: string[],
): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array when present (got ${describe(value)})`);
    return;
  }
  value.forEach((item, index) => {
    validateOptionalDomainObject(item, `${path}[${String(index)}]`, validate, errors);
  });
}

const SITE_FIELD_VALIDATORS: { [K in keyof EditableSite]: SiteFieldValidator } = {
  // ADR 0016 — `styleKit` and `customStyleKit` are a discriminated union at
  // the type layer. The validator owns the cross-field contract: when the
  // discriminator is `'custom'`, the sibling must be present; in either
  // case, a present sibling is shape-validated so a malformed object can't
  // ride through the publish spread.
  styleKit: ({ state, errors }) => {
    assertOneOf<StyleKit>(state.styleKit, STYLE_KITS, 'styleKit', errors);
    if (state.styleKit === 'custom') {
      if (state.customStyleKit === undefined) {
        errors.push('customStyleKit is required when styleKit === "custom"');
        return;
      }
    } else if (state.customStyleKit === undefined) {
      return;
    }
    validateCustomStyleKit(state.customStyleKit, 'customStyleKit', errors);
  },
  pages: ({ state, errors }) => {
    if (!Array.isArray(state.pages) || state.pages.length === 0) {
      errors.push('pages must be a non-empty array');
    }
  },
  // `header` and `footer` are sections. Top-level shape (when present) is
  // an object; deep section validation runs in `validateSiteShape`'s post-
  // dispatch phase because it needs `validPageIds`. The shape check here
  // catches "header was set to a number" early so the deep pass never sees
  // a non-object.
  header: ({ state, errors }) => {
    if (state.header !== undefined && !isRecord(state.header)) {
      errors.push(
        `state.header must be a section object when present (got ${describe(state.header)})`,
      );
    }
  },
  footer: ({ state, errors }) => {
    if (state.footer !== undefined && !isRecord(state.footer)) {
      errors.push(
        `state.footer must be a section object when present (got ${describe(state.footer)})`,
      );
    }
  },
  defaultLocale: ({ state, errors }) => {
    // Locale uses the same "non-empty string when present" shape as the
    // helper but carries an extra "BCP-47" hint in the error prose;
    // surface it inline so the helper stays format-uniform.
    if (state.defaultLocale !== undefined && !isNonEmptyString(state.defaultLocale)) {
      errors.push(
        `defaultLocale must be a non-empty BCP-47 string when present (got ${describe(state.defaultLocale)})`,
      );
    }
  },
  siteNoIndex: ({ state, errors }) => {
    assertOptionalBoolean(state.siteNoIndex, 'siteNoIndex', errors);
  },
  visitorTheme: ({ state, errors }) => {
    if (state.visitorTheme === undefined) return;
    if (
      state.visitorTheme !== 'light' &&
      state.visitorTheme !== 'dark' &&
      state.visitorTheme !== 'toggleable'
    ) {
      errors.push(
        `visitorTheme must be 'light', 'dark', or 'toggleable' when present (got ${describe(state.visitorTheme)})`,
      );
    }
  },
  faviconAssetId: ({ state, errors }) => {
    if (state.faviconAssetId !== undefined && !isAssetIdLike(state.faviconAssetId)) {
      errors.push(
        `faviconAssetId must be an asset id matching /^[A-Za-z0-9._-]+$/ when present (got ${describe(state.faviconAssetId)})`,
      );
    }
  },
  // ADR 0050 dec 3 — site-level page-scroll behaviour. Both fields are
  // independent optionals; the renderer emits only the rules whose fields
  // are set. Bounds on paddingTop kept loose (finite, >= 0) — there is no
  // upper rail because legitimate use cases include very tall fixed banners.
  scrollBehavior: ({ state, errors }) => {
    if (state.scrollBehavior === undefined) return;
    if (!isRecord(state.scrollBehavior)) {
      errors.push(
        `scrollBehavior must be an object when present (got ${describe(state.scrollBehavior)})`,
      );
      return;
    }
    const sb = state.scrollBehavior;
    if (sb.smooth !== undefined && typeof sb.smooth !== 'boolean') {
      errors.push(
        `scrollBehavior.smooth must be a boolean when present (got ${describe(sb.smooth)})`,
      );
    }
    if (sb.paddingTop !== undefined) {
      if (!isFiniteNumber(sb.paddingTop) || sb.paddingTop < 0) {
        errors.push(
          `scrollBehavior.paddingTop must be a finite number >= 0 when present (got ${describe(sb.paddingTop)})`,
        );
      }
    }
  },
  motionSequences: ({ state, errors }) => {
    validateDomainArray(
      state.motionSequences,
      'motionSequences',
      (value) => validateMotionSequence(value as MotionSequence),
      errors,
    );
  },
  scrollScenes: ({ state, errors }) => {
    validateDomainArray(
      state.scrollScenes,
      'scrollScenes',
      (value) => validateScrollScene(value as ScrollScene),
      errors,
    );
  },
  overlaySections: ({ state, errors }) => {
    if (state.overlaySections !== undefined && !Array.isArray(state.overlaySections)) {
      errors.push(
        `overlaySections must be an array when present (got ${describe(state.overlaySections)})`,
      );
    }
  },
  overlays: ({ state, errors }) => {
    validateDomainArray(
      state.overlays,
      'overlays',
      (value) => validateOverlay(value as Overlay),
      errors,
    );
  },
  richMotionAssets: ({ state, errors }) => {
    validateDomainArray(
      state.richMotionAssets,
      'richMotionAssets',
      (value) => validateRichMotionAsset(value as RichMotionAsset),
      errors,
    );
  },
  loadExperience: ({ state, errors }) => {
    validateOptionalDomainObject(
      state.loadExperience,
      'loadExperience',
      (value) => validateLoadExperience(value as LoadExperience),
      errors,
    );
  },
  routeTransition: ({ state, errors }) => {
    validateOptionalDomainObject(
      state.routeTransition,
      'routeTransition',
      (value) => validateRouteTransition(value as RouteTransition),
      errors,
    );
  },
};

function validateSiteShape(state: unknown, errors: string[]): void {
  if (!isRecord(state)) {
    errors.push('state must be an object');
    return;
  }

  // Phase 1 — per-field shape via SITE_FIELD_VALIDATORS dispatch.
  // Missing a field is a compile error via the mapped type above.
  const ctx: SiteFieldValidatorCtx = { state, errors };
  for (const validate of Object.values(SITE_FIELD_VALIDATORS)) {
    validate(ctx);
  }

  // Phase 2 — cross-field structural validation that needs the page-id
  // and page-slug sets built from the pages array.
  if (!Array.isArray(state.pages) || state.pages.length === 0) return;
  validatePageCardinality(state.pages, errors);
  const validPageIds = new Set<string>();
  const pageSlugs = new Set<string>();
  state.pages.forEach((page, idx) => {
    if (!isRecord(page)) return;
    if (isNonEmptyString(page.id)) {
      assertUnique(page.id, validPageIds, `pages[${String(idx)}].id`, 'across pages', errors);
    }
    if (isNonEmptyString(page.slug)) {
      assertUnique(page.slug, pageSlugs, `pages[${String(idx)}].slug`, 'across pages', errors);
    }
  });
  state.pages.forEach((page, idx) => {
    validatePage(page, `pages[${String(idx)}]`, errors, validPageIds);
  });
  // Site-wide header and footer are optional top-level sections. When present,
  // validate them with the same section validator used for page sections; the
  // `isPinnedSiteSection: true` flag selects the lower height minimum (ADR 0059).
  if (isRecord(state.header)) {
    const headerIds = new Set<string>();
    validateSection(
      state.header,
      PAGE_WIDTH_MAX,
      'state.header',
      errors,
      headerIds,
      validPageIds,
      true,
    );
  }
  if (isRecord(state.footer)) {
    const footerIds = new Set<string>();
    validateSection(
      state.footer,
      PAGE_WIDTH_MAX,
      'state.footer',
      errors,
      footerIds,
      validPageIds,
      true,
    );
  }
  if (Array.isArray(state.overlaySections)) {
    const overlayIds = new Set<string>();
    state.overlaySections.forEach((section, idx) => {
      validateSection(
        section,
        PAGE_WIDTH_MAX,
        `overlaySections[${String(idx)}]`,
        errors,
        overlayIds,
        validPageIds,
      );
    });
  }
  validateDesignerInteractionRelations(state, errors);
  // ADR 0050 dec 2 — per-page anchor uniqueness across (header + sections + footer).
  if (Array.isArray(state.pages)) {
    state.pages.forEach((page, idx) => {
      if (!isRecord(page)) return;
      validatePageAnchorIdUniqueness(
        page,
        `pages[${String(idx)}]`,
        state.header,
        state.footer,
        errors,
      );
    });
  }
}

interface DesignerInteractionIdIndex {
  pageIds: Set<string>;
  sectionIds: Set<string>;
  overlaySectionIds: Set<string>;
  elementIds: Set<string>;
  motionSequenceIds: Set<string>;
  overlayIds: Set<string>;
  richMotionAssetIds: Set<string>;
  richMotionReferences: Array<{ path: string; richMotionAssetId: string }>;
}

function collectStringId(value: unknown, ids: Set<string>): void {
  if (typeof value === 'string' && value.length > 0) ids.add(value);
}

function collectUniqueDesignerId(
  value: unknown,
  ids: Set<string>,
  path: string,
  collectionLabel: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || value.length === 0) return;
  if (ids.has(value)) {
    errors.push(`${collectionLabel} id "${value}" is duplicated at ${path}`);
    return;
  }
  ids.add(value);
}

function collectElementInteractionIds(
  element: unknown,
  elementPath: string,
  index: DesignerInteractionIdIndex,
): void {
  if (!isRecord(element)) return;
  collectStringId(element.id, index.elementIds);
  if (typeof element.richMotionAssetId === 'string' && element.richMotionAssetId.length > 0) {
    index.richMotionReferences.push({
      path: `${elementPath}.richMotionAssetId`,
      richMotionAssetId: element.richMotionAssetId,
    });
  }
  if (element.type === 'tabs' && Array.isArray(element.tabs)) {
    element.tabs.forEach((tab, tabIdx) => {
      if (!isRecord(tab) || !Array.isArray(tab.elements)) return;
      tab.elements.forEach((child, childIdx) => {
        collectElementInteractionIds(
          child,
          pathJoin(pathJoin(pathJoin(pathJoin(elementPath, 'tabs'), tabIdx), 'elements'), childIdx),
          index,
        );
      });
    });
  }
  if (element.type === 'collection' && Array.isArray(element.entries)) {
    element.entries.forEach((entry, entryIdx) => {
      if (!Array.isArray(entry)) return;
      entry.forEach((child, childIdx) => {
        collectElementInteractionIds(
          child,
          pathJoin(pathJoin(pathJoin(elementPath, 'entries'), entryIdx), childIdx),
          index,
        );
      });
    });
  }
}

function collectSectionInteractionIds(
  section: unknown,
  sectionPath: string,
  index: DesignerInteractionIdIndex,
  errors: string[],
  options: { overlaySection?: boolean } = {},
): void {
  if (!isRecord(section)) return;
  const id = section.id;
  if (typeof id === 'string' && id.length > 0) {
    if (options.overlaySection && index.sectionIds.has(id)) {
      errors.push(`${sectionPath}.id "${id}" duplicates a rendered page/header/footer section id`);
    }
    index.sectionIds.add(id);
    if (options.overlaySection) index.overlaySectionIds.add(id);
  }
  if (!Array.isArray(section.elements)) return;
  section.elements.forEach((element, elementIdx) => {
    collectElementInteractionIds(
      element,
      pathJoin(pathJoin(sectionPath, 'elements'), elementIdx),
      index,
    );
  });
}

function buildDesignerInteractionIdIndex(
  state: Record<string, unknown>,
  errors: string[],
): DesignerInteractionIdIndex {
  const index: DesignerInteractionIdIndex = {
    pageIds: new Set<string>(),
    sectionIds: new Set<string>(),
    overlaySectionIds: new Set<string>(),
    elementIds: new Set<string>(),
    motionSequenceIds: new Set<string>(),
    overlayIds: new Set<string>(),
    richMotionAssetIds: new Set<string>(),
    richMotionReferences: [],
  };

  if (Array.isArray(state.pages)) {
    state.pages.forEach((page, pageIdx) => {
      if (!isRecord(page)) return;
      collectStringId(page.id, index.pageIds);
      if (Array.isArray(page.sections)) {
        page.sections.forEach((section, sectionIdx) => {
          collectSectionInteractionIds(
            section,
            pathJoin(pathJoin(`pages[${String(pageIdx)}]`, 'sections'), sectionIdx),
            index,
            errors,
          );
        });
      }
    });
  }
  collectSectionInteractionIds(state.header, 'state.header', index, errors);
  collectSectionInteractionIds(state.footer, 'state.footer', index, errors);

  if (Array.isArray(state.overlaySections)) {
    state.overlaySections.forEach((section, sectionIdx) => {
      collectSectionInteractionIds(
        section,
        `overlaySections[${String(sectionIdx)}]`,
        index,
        errors,
        { overlaySection: true },
      );
    });
  }

  if (Array.isArray(state.motionSequences)) {
    state.motionSequences.forEach((sequence, sequenceIdx) => {
      if (!isRecord(sequence)) return;
      collectUniqueDesignerId(
        sequence.id,
        index.motionSequenceIds,
        `motionSequences[${String(sequenceIdx)}].id`,
        'motionSequences',
        errors,
      );
    });
  }
  if (Array.isArray(state.overlays)) {
    state.overlays.forEach((overlay, overlayIdx) => {
      if (!isRecord(overlay)) return;
      collectUniqueDesignerId(
        overlay.id,
        index.overlayIds,
        `overlays[${String(overlayIdx)}].id`,
        'overlays',
        errors,
      );
    });
  }
  if (Array.isArray(state.richMotionAssets)) {
    state.richMotionAssets.forEach((asset, assetIdx) => {
      if (!isRecord(asset)) return;
      collectUniqueDesignerId(
        asset.id,
        index.richMotionAssetIds,
        `richMotionAssets[${String(assetIdx)}].id`,
        'richMotionAssets',
        errors,
      );
    });
  }

  return index;
}

function assertKnownId(
  ids: Set<string>,
  value: unknown,
  path: string,
  label: string,
  errors: string[],
): void {
  if (typeof value !== 'string' || value.length === 0) return;
  if (!ids.has(value)) errors.push(`${path} "${value}" does not resolve to a known ${label}`);
}

function validateInteractionTriggerRelations(
  trigger: unknown,
  basePath: string,
  index: DesignerInteractionIdIndex,
  errors: string[],
): void {
  if (!isRecord(trigger) || typeof trigger.type !== 'string') return;
  if (trigger.type === 'viewport-enter' || trigger.type === 'scroll-progress') {
    assertKnownId(
      index.sectionIds,
      trigger.sectionId,
      `${basePath}.sectionId`,
      'section id',
      errors,
    );
    assertKnownId(
      index.elementIds,
      trigger.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (trigger.type === 'hover' || trigger.type === 'click') {
    assertKnownId(
      index.elementIds,
      trigger.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (trigger.type === 'pointer-move') {
    assertKnownId(
      index.elementIds,
      trigger.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (trigger.type === 'route-navigation') {
    assertKnownId(index.pageIds, trigger.fromPageId, `${basePath}.fromPageId`, 'page id', errors);
    assertKnownId(index.pageIds, trigger.toPageId, `${basePath}.toPageId`, 'page id', errors);
  }
}

function validateInteractionTargetRelations(
  target: unknown,
  basePath: string,
  index: DesignerInteractionIdIndex,
  errors: string[],
): void {
  if (!isRecord(target) || typeof target.type !== 'string') return;
  const typedTarget = target as InteractionTarget;
  if (typedTarget.type === 'page') {
    assertKnownId(index.pageIds, typedTarget.pageId, `${basePath}.pageId`, 'page id', errors);
  } else if (typedTarget.type === 'section') {
    assertKnownId(
      index.sectionIds,
      typedTarget.sectionId,
      `${basePath}.sectionId`,
      'section id',
      errors,
    );
  } else if (typedTarget.type === 'element') {
    assertKnownId(
      index.elementIds,
      typedTarget.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (typedTarget.type === 'component-part') {
    assertKnownId(
      index.elementIds,
      typedTarget.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (typedTarget.type === 'text-split') {
    assertKnownId(
      index.elementIds,
      typedTarget.elementId,
      `${basePath}.elementId`,
      'element id',
      errors,
    );
  } else if (typedTarget.type === 'overlay') {
    assertKnownId(
      index.overlayIds,
      typedTarget.overlayId,
      `${basePath}.overlayId`,
      'overlay id',
      errors,
    );
  }
}

function validateMotionSequenceRelations(
  sequence: unknown,
  basePath: string,
  index: DesignerInteractionIdIndex,
  errors: string[],
): void {
  if (!isRecord(sequence)) return;
  validateInteractionTriggerRelations(sequence.trigger, `${basePath}.trigger`, index, errors);
  if (!Array.isArray(sequence.steps)) return;
  sequence.steps.forEach((step, stepIdx) => {
    if (!isRecord(step)) return;
    validateInteractionTargetRelations(
      step.target,
      `${basePath}.steps[${String(stepIdx)}].target`,
      index,
      errors,
    );
  });
}

function validateOverlayFocusTargetRelations(
  target: unknown,
  basePath: string,
  index: DesignerInteractionIdIndex,
  errors: string[],
): void {
  if (!isRecord(target) || target.type !== 'element') return;
  const typedTarget = target as Extract<OverlayFocusTarget, { type: 'element' }>;
  assertKnownId(
    index.elementIds,
    typedTarget.elementId,
    `${basePath}.elementId`,
    'element id',
    errors,
  );
}

function validateDesignerInteractionRelations(
  state: Record<string, unknown>,
  errors: string[],
): void {
  const index = buildDesignerInteractionIdIndex(state, errors);

  if (Array.isArray(state.motionSequences)) {
    state.motionSequences.forEach((sequence, sequenceIdx) => {
      validateMotionSequenceRelations(
        sequence,
        `motionSequences[${String(sequenceIdx)}]`,
        index,
        errors,
      );
    });
  }

  if (Array.isArray(state.scrollScenes)) {
    state.scrollScenes.forEach((scene, sceneIdx) => {
      if (!isRecord(scene)) return;
      validateInteractionTriggerRelations(
        scene.trigger,
        `scrollScenes[${String(sceneIdx)}].trigger`,
        index,
        errors,
      );
      validateMotionSequenceRelations(
        scene.sequence,
        `scrollScenes[${String(sceneIdx)}].sequence`,
        index,
        errors,
      );
    });
  }

  if (Array.isArray(state.overlays)) {
    state.overlays.forEach((overlay, overlayIdx) => {
      if (!isRecord(overlay)) return;
      const overlayPath = `overlays[${String(overlayIdx)}]`;
      assertKnownId(
        index.overlaySectionIds,
        overlay.contentSectionId,
        `${overlayPath}.contentSectionId`,
        'overlay section id',
        errors,
      );
      validateInteractionTriggerRelations(overlay.trigger, `${overlayPath}.trigger`, index, errors);
      if (isRecord(overlay.placement) && overlay.placement.type === 'anchored') {
        assertKnownId(
          index.elementIds,
          overlay.placement.anchorElementId,
          `${overlayPath}.placement.anchorElementId`,
          'element id',
          errors,
        );
      }
      assertKnownId(
        index.motionSequenceIds,
        overlay.openSequenceId,
        `${overlayPath}.openSequenceId`,
        'motion sequence id',
        errors,
      );
      assertKnownId(
        index.motionSequenceIds,
        overlay.closeSequenceId,
        `${overlayPath}.closeSequenceId`,
        'motion sequence id',
        errors,
      );
      if (isRecord(overlay.focus)) {
        validateOverlayFocusTargetRelations(
          overlay.focus.initial,
          `${overlayPath}.focus.initial`,
          index,
          errors,
        );
        validateOverlayFocusTargetRelations(
          overlay.focus.returnTo,
          `${overlayPath}.focus.returnTo`,
          index,
          errors,
        );
      }
    });
  }

  if (Array.isArray(state.richMotionAssets)) {
    state.richMotionAssets.forEach((asset, assetIdx) => {
      if (!isRecord(asset) || !isRecord(asset.playback)) return;
      validateInteractionTriggerRelations(
        asset.playback.trigger,
        `richMotionAssets[${String(assetIdx)}].playback.trigger`,
        index,
        errors,
      );
    });
  }
  index.richMotionReferences.forEach((ref) => {
    assertKnownId(
      index.richMotionAssetIds,
      ref.richMotionAssetId,
      ref.path,
      'rich motion asset id',
      errors,
    );
  });

  if (isRecord(state.loadExperience)) {
    const loadExperience = state.loadExperience as unknown as LoadExperience;
    assertKnownId(
      index.motionSequenceIds,
      loadExperience.introSequenceId,
      'loadExperience.introSequenceId',
      'motion sequence id',
      errors,
    );
    assertKnownId(
      index.motionSequenceIds,
      loadExperience.exitSequenceId,
      'loadExperience.exitSequenceId',
      'motion sequence id',
      errors,
    );
  }

  if (isRecord(state.routeTransition)) {
    const routeTransition = state.routeTransition as unknown as RouteTransition;
    assertKnownId(
      index.motionSequenceIds,
      routeTransition.outgoingSequenceId,
      'routeTransition.outgoingSequenceId',
      'motion sequence id',
      errors,
    );
    assertKnownId(
      index.motionSequenceIds,
      routeTransition.incomingSequenceId,
      'routeTransition.incomingSequenceId',
      'motion sequence id',
      errors,
    );
    if (isRecord(routeTransition.focusTarget) && routeTransition.focusTarget.type === 'element') {
      assertKnownId(
        index.elementIds,
        routeTransition.focusTarget.elementId,
        'routeTransition.focusTarget.elementId',
        'element id',
        errors,
      );
    }
  }
}

function validatePublishedMediaReferencesInSection(
  section: unknown,
  basePath: string,
  errors: string[],
): void {
  if (!isRecord(section) || !Array.isArray(section.elements)) return;
  section.elements.forEach((element, elementIdx) => {
    if (!isRecord(element) || element.type !== 'media') return;
    const elementPath = `${basePath}.elements[${String(elementIdx)}]`;
    if (element.assetId === '') {
      errors.push(`${elementPath}.assetId must be non-empty in published snapshots`);
    }
    if (typeof element.posterAssetId === 'string' && element.posterAssetId === '') {
      errors.push(`${elementPath}.posterAssetId must be non-empty in published snapshots`);
    }
  });
}

function validatePublishedMediaReferences(snapshot: unknown, errors: string[]): void {
  if (!isRecord(snapshot)) return;
  if (Array.isArray(snapshot.pages)) {
    snapshot.pages.forEach((page, pageIdx) => {
      if (!isRecord(page) || !Array.isArray(page.sections)) return;
      page.sections.forEach((section, sectionIdx) => {
        validatePublishedMediaReferencesInSection(
          section,
          `pages[${String(pageIdx)}].sections[${String(sectionIdx)}]`,
          errors,
        );
      });
    });
  }
  if (snapshot.header !== undefined) {
    validatePublishedMediaReferencesInSection(snapshot.header, 'header', errors);
  }
  if (snapshot.footer !== undefined) {
    validatePublishedMediaReferencesInSection(snapshot.footer, 'footer', errors);
  }
}

export function validateEditableSite(state: unknown): ValidationResult {
  const errors: string[] = [];
  validateSiteShape(state, errors);
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

/**
 * Fields the published snapshot requires that the editable site does not.
 * ADR 0012 dec 5 makes the diff between the two validators enumerated, not
 * implicit. The parity smoke (`canvas/validate-parity.smoke.ts`) iterates
 * this list and asserts that the only failures `validatePublishedSnapshot`
 * surfaces beyond what `validateEditableSite` rejects come from one of
 * these checks.
 *
 *  - `version`: the publish counter, integer >= 1.
 *  - `publishedAt`: ISO date string parseable by `new Date(...)`.
 *  - `media.assetId-non-empty`: every media element's `assetId` (and
 *    `posterAssetId` when present) must be non-empty in the published
 *    snapshot, even though the editor allows the placeholder `''`.
 */
export const PUBLISH_ONLY_REQUIRED_FIELDS = [
  'version',
  'publishedAt',
  'media.assetId-non-empty',
] as const;

export function validatePublishedSnapshot(snapshot: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(snapshot)) {
    return { valid: false, errors: ['snapshot must be an object'] };
  }
  if (!isFiniteNumber(snapshot.version) || snapshot.version < 1) {
    errors.push(`version must be a finite number >= 1 (got ${describe(snapshot.version)})`);
  }
  if (!isNonEmptyString(snapshot.publishedAt)) {
    errors.push('publishedAt must be a non-empty ISO date string');
  } else if (!isParseableDate(snapshot.publishedAt)) {
    errors.push(`publishedAt "${snapshot.publishedAt}" is not a parseable Date`);
  }
  // Re-use the editable validator on the full snapshot. Passing the snapshot
  // directly (rather than a stripped {styleKit, pages, header, footer} literal)
  // lets the site-level field validators inside validateSiteShape see
  // customStyleKit / defaultLocale / siteNoIndex / visitorTheme /
  // faviconAssetId — otherwise those fields silently round-trip onto the
  // snapshot via the spread at publish.ts:373-386.
  validateSiteShape(snapshot, errors);
  validatePublishedMediaReferences(snapshot, errors);
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

/**
 * Validate that every media element in a fixture references an `assetId` (and
 * `posterAssetId` when present) that exists in {@link SEED_ASSET_REGISTRY}.
 *
 * This validator is INTENTIONALLY separate from `validateEditableSite` /
 * `validatePublishedSnapshot`. Customer-uploaded assets have ids the registry
 * does not know about (they are generated on upload via crypto.randomUUID);
 * only the bundled seed fixture is gated against the registry so a new site
 * created from a Template Seed never points at media bytes the materialiser
 * doesn't know about.
 *
 * Walks every page → section → element. Returns ALL errors at once so the
 * fixture author sees every missing id in one pass.
 */
export function validateSeedFixture(state: EditableSite): ValidationResult {
  const errors: string[] = [];

  function validateSeedSection(section: CanvasSection | undefined, sectionPath: string): void {
    if (!section) return;
    for (let elIdx = 0; elIdx < section.elements.length; elIdx++) {
      const element = section.elements[elIdx];
      if (!element || element.type !== 'media') continue;
      const elementPath = `${sectionPath}.elements[${String(elIdx)}]`;
      const assetId = element.assetId;
      const seedAsset = SEED_ASSET_REGISTRY[assetId];
      if (!seedAsset) {
        errors.push(`${elementPath}.assetId "${assetId}" is not registered in SEED_ASSET_REGISTRY`);
      } else if (seedAsset.kind !== element.mediaKind) {
        errors.push(
          `${elementPath}.assetId "${assetId}" is registered as ${seedAsset.kind}, but mediaKind is ${element.mediaKind}`,
        );
      }
      if (element.mediaKind === 'video' && element.posterAssetId !== undefined) {
        const posterSeedAsset = SEED_ASSET_REGISTRY[element.posterAssetId];
        if (!posterSeedAsset) {
          errors.push(
            `${elementPath}.posterAssetId "${element.posterAssetId}" is not registered in SEED_ASSET_REGISTRY`,
          );
        } else if (posterSeedAsset.kind !== 'image') {
          errors.push(
            `${elementPath}.posterAssetId "${element.posterAssetId}" is registered as ${posterSeedAsset.kind}, but posters must be image assets`,
          );
        }
      }
    }
  }

  for (let pageIdx = 0; pageIdx < state.pages.length; pageIdx++) {
    const page = state.pages[pageIdx];
    if (!page) continue;
    const pagePath = `pages[${String(pageIdx)}]`;
    for (let sectionIdx = 0; sectionIdx < page.sections.length; sectionIdx++) {
      validateSeedSection(page.sections[sectionIdx], `${pagePath}.sections[${String(sectionIdx)}]`);
    }
  }
  validateSeedSection(state.header, 'header');
  validateSeedSection(state.footer, 'footer');

  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}
