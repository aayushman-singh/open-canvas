// src/canvas/validate.ts
//
// Pure validators for the canvas document model. Both validators collect ALL
// errors encountered rather than failing fast — the smoke and the editor want
// the full picture so the Owner can fix every issue at once.

import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import {
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  SECTION_RECIPE_IDS,
  SHAPE_VARIANTS,
  STYLE_KITS,
  SURFACE_VARIANTS,
  type ActionVariant,
  type BackgroundEffect,
  type CanvasElement,
  type CanvasPage,
  type CanvasSection,
  type CanvasSiteState,
  type ElementType,
  type InlineMarkType,
  type MediaKind,
  type MotionPreset,
  type PublishedSnapshot,
  type SectionRecipeId,
  type ShapeVariant,
  type StyleKit,
  type SurfaceVariant,
} from './schema.js';

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

const PAGE_WIDTH_MIN = 960;
const PAGE_WIDTH_MAX = 1920;
const SECTION_HEIGHT_MIN = 240;
const SECTION_HEIGHT_MAX = 1400;

const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
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
 * The single source of truth for href allowlisting. Used by both
 * ActionElement.href and inline link marks inside TextElement.content so the
 * two paths cannot drift.
 */
export function isAllowedHref(href: string): boolean {
  // In-page anchor or root-relative path are allowed without scheme.
  if (href.startsWith('#') || href.startsWith('/')) return true;
  // Reject the javascript: scheme explicitly even when oddly cased or padded.
  const trimmed = href.trim().toLowerCase();
  if (trimmed.startsWith('javascript:')) return false;
  // Anything else must parse as one of the allow-listed schemes.
  try {
    const url = new URL(href);
    return (ALLOWED_HREF_SCHEMES as readonly string[]).includes(url.protocol);
  } catch {
    return false;
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
  if (!isFiniteNumber(x)) errors.push(`${basePath}.box.x must be a finite number`);
  if (!isFiniteNumber(y)) errors.push(`${basePath}.box.y must be a finite number`);
  if (!isFiniteNumber(w)) errors.push(`${basePath}.box.w must be a finite number`);
  if (!isFiniteNumber(h)) errors.push(`${basePath}.box.h must be a finite number`);
  if (!isFiniteNumber(z)) errors.push(`${basePath}.box.z must be a finite number`);
  if (rotation !== undefined && !isFiniteNumber(rotation)) {
    errors.push(`${basePath}.box.rotation must be a finite number when present`);
  }
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
  if (!isOneOf<MotionPreset>(motion.preset, MOTION_PRESETS)) {
    errors.push(
      `${basePath}.motion.preset must be one of [${MOTION_PRESETS.join(', ')}] (got ${describe(motion.preset)})`,
    );
  }
  if (motion.delayMs !== undefined && !isFiniteNumber(motion.delayMs)) {
    errors.push(`${basePath}.motion.delayMs must be a finite number when present`);
  }
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

/**
 * Validate the rich text payload of a TextElement: a non-empty array of
 * inline runs whose marks are well-formed and whose concatenated text is not
 * empty. Errors are appended to `errors` — never short-circuit, the Owner
 * wants every issue listed at once.
 *
 * `idLabel` is the textual element id used in error messages so the Owner can
 * find the broken element by id. If the element has no usable id we pass
 * `'<unknown>'` so the message still reads.
 */
function validateTextContent(content: unknown, idLabel: string, errors: string[]): void {
  if (!Array.isArray(content) || content.length === 0) {
    errors.push(`text element ${idLabel}.content must be a non-empty array`);
    return;
  }
  let concatenated = '';
  content.forEach((run, runIdx) => {
    if (!isRecord(run)) {
      errors.push(`text element ${idLabel}.content[${String(runIdx)}] must be an object`);
      return;
    }
    if (typeof run.text !== 'string') {
      errors.push(
        `text element ${idLabel}.content[${String(runIdx)}].text must be a string (got ${describe(run.text)})`,
      );
    } else {
      concatenated += run.text;
    }
    if (run.marks === undefined) return;
    if (!Array.isArray(run.marks)) {
      errors.push(
        `text element ${idLabel}.content[${String(runIdx)}].marks must be an array when present`,
      );
      return;
    }
    const seenTypes = new Set<string>();
    run.marks.forEach((mark, markIdx) => {
      if (!isRecord(mark)) {
        errors.push(
          `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}] must be an object`,
        );
        return;
      }
      if (!isOneOf<InlineMarkType>(mark.type, INLINE_MARK_TYPES)) {
        errors.push(
          `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].type must be one of [${INLINE_MARK_TYPES.join(', ')}] (got ${describe(mark.type)})`,
        );
        return;
      }
      if (seenTypes.has(mark.type)) {
        errors.push(
          `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].type "${mark.type}" is duplicated within the same run`,
        );
      } else {
        seenTypes.add(mark.type);
      }
      if (mark.type === 'link') {
        if (typeof mark.href !== 'string' || mark.href.length === 0) {
          errors.push(
            `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].href must be a non-empty string for link marks (got ${describe(mark.href)})`,
          );
          return;
        }
        if (!isAllowedHref(mark.href)) {
          errors.push(
            `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].href "${mark.href}" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)`,
          );
        }
      }
    });
  });
  if (concatenated.length === 0) {
    errors.push(`text element ${idLabel} has empty concatenated plain text`);
  }
}

function validateElement(
  element: unknown,
  pageWidth: number,
  sectionHeight: number,
  basePath: string,
  errors: string[],
): void {
  if (!isRecord(element)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(element.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  }
  if (!isOneOf<ElementType>(element.type, ELEMENT_TYPES)) {
    errors.push(
      `${basePath}.type must be one of [${ELEMENT_TYPES.join(', ')}] (got ${describe(element.type)})`,
    );
    // Without a known type we cannot validate the body — skip the rest.
    validateBox(element.box, pageWidth, sectionHeight, basePath, errors);
    validateMotion(element.motion, basePath, errors);
    validatePinnedStyle(element.pinnedStyle, basePath, errors);
    return;
  }

  validateBox(element.box, pageWidth, sectionHeight, basePath, errors);
  validateMotion(element.motion, basePath, errors);
  validatePinnedStyle(element.pinnedStyle, basePath, errors);

  switch (element.type) {
    case 'text': {
      const idLabel = isNonEmptyString(element.id) ? element.id : '<unknown>';
      validateTextContent(element.content, idLabel, errors);
      if (!isOneOf(element.role, ['heading', 'body', 'label'] as const)) {
        errors.push(`${basePath}.role must be heading|body|label (got ${describe(element.role)})`);
      }
      if (!isFiniteNumber(element.fontSize) || element.fontSize <= 0) {
        errors.push(`${basePath}.fontSize must be a positive number`);
      }
      if (element.fontWeight !== 400 && element.fontWeight !== 500 && element.fontWeight !== 600 && element.fontWeight !== 700) {
        errors.push(`${basePath}.fontWeight must be 400|500|600|700 (got ${describe(element.fontWeight)})`);
      }
      if (!isOneOf(element.align, ['left', 'center', 'right'] as const)) {
        errors.push(`${basePath}.align must be left|center|right (got ${describe(element.align)})`);
      }
      break;
    }
    case 'media': {
      if (!isOneOf<MediaKind>(element.mediaKind, MEDIA_KINDS)) {
        errors.push(
          `${basePath}.mediaKind must be one of [${MEDIA_KINDS.join(', ')}] (got ${describe(element.mediaKind)})`,
        );
      }
      if (!isNonEmptyString(element.assetId)) {
        errors.push(`${basePath}.assetId must be a non-empty string`);
      }
      if (element.posterAssetId !== undefined && !isNonEmptyString(element.posterAssetId)) {
        errors.push(`${basePath}.posterAssetId must be a non-empty string when present`);
      }
      if (typeof element.alt !== 'string') {
        errors.push(`${basePath}.alt must be a string`);
      }
      if (!isOneOf(element.fit, ['cover', 'contain'] as const)) {
        errors.push(`${basePath}.fit must be cover|contain (got ${describe(element.fit)})`);
      }
      if (element.playback !== undefined && !isRecord(element.playback)) {
        errors.push(`${basePath}.playback must be an object when present`);
      }
      if (element.mediaKind === 'video' && isRecord(element.playback)) {
        const { autoplay, muted } = element.playback;
        if (autoplay === true && muted !== true) {
          errors.push(
            `${basePath}.playback: video with autoplay=true must also set muted=true (visitor autoplay policy)`,
          );
        }
      }
      break;
    }
    case 'action': {
      if (!isNonEmptyString(element.label)) {
        errors.push(`${basePath}.label must be a non-empty string`);
      }
      if (!isNonEmptyString(element.href)) {
        errors.push(`${basePath}.href must be a non-empty string`);
      } else if (!isAllowedHref(element.href)) {
        errors.push(
          `${basePath}.href "${element.href}" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)`,
        );
      }
      if (!isOneOf<ActionVariant>(element.variant, ACTION_VARIANTS)) {
        errors.push(
          `${basePath}.variant must be one of [${ACTION_VARIANTS.join(', ')}] (got ${describe(element.variant)})`,
        );
      }
      break;
    }
    case 'shape': {
      if (!isOneOf<ShapeVariant>(element.variant, SHAPE_VARIANTS)) {
        errors.push(
          `${basePath}.variant must be one of [${SHAPE_VARIANTS.join(', ')}] (got ${describe(element.variant)})`,
        );
      }
      break;
    }
    case 'container': {
      if (!isOneOf<SurfaceVariant>(element.variant, SURFACE_VARIANTS)) {
        errors.push(
          `${basePath}.variant must be one of [${SURFACE_VARIANTS.join(', ')}] (got ${describe(element.variant)})`,
        );
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
  pageIds: Set<string>,
): void {
  if (!isRecord(section)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(section.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  } else if (pageIds.has(section.id)) {
    errors.push(`${basePath}.id "${section.id}" is duplicated within page`);
  } else {
    pageIds.add(section.id);
  }
  if (!isOneOf<SectionRecipeId>(section.recipeId, SECTION_RECIPE_IDS)) {
    errors.push(
      `${basePath}.recipeId must be one of [${SECTION_RECIPE_IDS.join(', ')}] (got ${describe(section.recipeId)})`,
    );
  }
  if (!isNonEmptyString(section.name)) {
    errors.push(`${basePath}.name must be a non-empty string`);
  }
  const heightValid =
    isFiniteNumber(section.height) &&
    section.height >= SECTION_HEIGHT_MIN &&
    section.height <= SECTION_HEIGHT_MAX;
  if (!heightValid) {
    errors.push(
      `${basePath}.height must be a finite number in [${String(SECTION_HEIGHT_MIN)}, ${String(SECTION_HEIGHT_MAX)}] (got ${describe(section.height)})`,
    );
  }
  if (
    section.backgroundEffect !== undefined &&
    !isOneOf<BackgroundEffect>(section.backgroundEffect, BACKGROUND_EFFECTS)
  ) {
    errors.push(
      `${basePath}.backgroundEffect must be one of [${BACKGROUND_EFFECTS.join(', ')}] (got ${describe(section.backgroundEffect)})`,
    );
  }
  if (
    section.entrance !== undefined &&
    !isOneOf<MotionPreset>(section.entrance, MOTION_PRESETS)
  ) {
    errors.push(
      `${basePath}.entrance must be one of [${MOTION_PRESETS.join(', ')}] (got ${describe(section.entrance)})`,
    );
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
    if (isRecord(element) && isNonEmptyString(element.id)) {
      if (pageIds.has(element.id)) {
        errors.push(`${elementPath}.id "${element.id}" is duplicated within page`);
      } else {
        pageIds.add(element.id);
      }
    }
    validateElement(element, pageWidth, effectiveHeight, elementPath, errors);
  });
}

function validatePage(page: unknown, basePath: string, errors: string[]): void {
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
  if (!isNonEmptyString(page.title)) {
    errors.push(`${basePath}.title must be a non-empty string`);
  }
  const widthValid =
    isFiniteNumber(page.width) && page.width >= PAGE_WIDTH_MIN && page.width <= PAGE_WIDTH_MAX;
  if (!widthValid) {
    errors.push(
      `${basePath}.width must be a finite number in [${String(PAGE_WIDTH_MIN)}, ${String(PAGE_WIDTH_MAX)}] (got ${describe(page.width)})`,
    );
  }
  if (!Array.isArray(page.sections) || page.sections.length === 0) {
    errors.push(`${basePath}.sections must be a non-empty array`);
    return;
  }
  const ids = new Set<string>();
  if (isNonEmptyString(page.id)) ids.add(page.id);
  const effectiveWidth = widthValid ? (page.width as number) : PAGE_WIDTH_MAX;
  page.sections.forEach((section, idx) => {
    const path = pathJoin(pathJoin(basePath, 'sections'), idx);
    validateSection(section, effectiveWidth, path, errors, ids);
  });
}

function validateEditableShape(state: unknown, errors: string[]): void {
  if (!isRecord(state)) {
    errors.push('state must be an object');
    return;
  }
  if (!isOneOf<StyleKit>(state.styleKit, STYLE_KITS)) {
    errors.push(
      `styleKit must be one of [${STYLE_KITS.join(', ')}] (got ${describe(state.styleKit)})`,
    );
  }
  if (!Array.isArray(state.pages) || state.pages.length === 0) {
    errors.push('pages must be a non-empty array');
    return;
  }
  // Single-page POC invariant: the validator pins state.pages to length 1.
  // Applies to both editable and published states because
  // validatePublishedSnapshot calls back into validateEditableShape.
  if (state.pages.length !== 1) {
    errors.push(
      'state.pages must contain exactly one canvas page (POC enforces single-page sites)',
    );
  }
  state.pages.forEach((page, idx) => {
    validatePage(page, `pages[${String(idx)}]`, errors);
  });
}

export function validateCanvasSiteState(state: unknown): ValidationResult {
  const errors: string[] = [];
  validateEditableShape(state, errors);
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

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
  } else {
    const parsed = new Date(snapshot.publishedAt);
    if (Number.isNaN(parsed.getTime())) {
      errors.push(`publishedAt "${snapshot.publishedAt}" is not a parseable Date`);
    }
  }
  // Re-use the editable validator on the snapshot's pages + style kit.
  validateEditableShape({ styleKit: snapshot.styleKit, pages: snapshot.pages }, errors);
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

/**
 * Validate that every media element in a fixture references an `assetId` (and
 * `posterAssetId` when present) that exists in {@link SEED_ASSET_REGISTRY}.
 *
 * This validator is INTENTIONALLY separate from `validateCanvasSiteState` /
 * `validatePublishedSnapshot`. Customer-uploaded assets have ids the registry
 * does not know about (they are generated on upload via crypto.randomUUID);
 * only the bundled seed fixture is gated against the registry so a new site
 * created from a Template Seed never points at media bytes the materialiser
 * doesn't know about.
 *
 * Walks every page → section → element. Returns ALL errors at once so the
 * fixture author sees every missing id in one pass.
 */
export function validateSeedFixture(state: CanvasSiteState): ValidationResult {
  const errors: string[] = [];
  for (let pageIdx = 0; pageIdx < state.pages.length; pageIdx++) {
    const page = state.pages[pageIdx];
    if (!page) continue;
    const pagePath = `pages[${String(pageIdx)}]`;
    for (let sectionIdx = 0; sectionIdx < page.sections.length; sectionIdx++) {
      const section = page.sections[sectionIdx];
      if (!section) continue;
      const sectionPath = `${pagePath}.sections[${String(sectionIdx)}]`;
      for (let elIdx = 0; elIdx < section.elements.length; elIdx++) {
        const element = section.elements[elIdx];
        if (!element || element.type !== 'media') continue;
        const elementPath = `${sectionPath}.elements[${String(elIdx)}]`;
        const assetId = element.assetId;
        if (!Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, assetId)) {
          errors.push(
            `${elementPath}.assetId "${assetId}" is not registered in SEED_ASSET_REGISTRY`,
          );
        }
        if (element.posterAssetId !== undefined) {
          if (!Object.prototype.hasOwnProperty.call(SEED_ASSET_REGISTRY, element.posterAssetId)) {
            errors.push(
              `${elementPath}.posterAssetId "${element.posterAssetId}" is not registered in SEED_ASSET_REGISTRY`,
            );
          }
        }
      }
    }
  }
  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

// Re-exported types for downstream callers that only depend on validate.ts.
export type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  PublishedSnapshot,
};
