// src/canvas/validate.ts
//
// Pure validators for the canvas document model. Both validators collect ALL
// errors encountered rather than failing fast — the smoke and the editor want
// the full picture so the Owner can fix every issue at once.

import { SEED_ASSET_REGISTRY } from './seed-assets.js';
import { CUSTOM_404_PAGE_SLUG } from './page-routing.js';
import { PAGE_METADATA_FIELDS } from './elements/collection.js';
import { escapeCssValue } from './elements/render-utils.js';
import {
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  BACKGROUND_SIZES,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  OVERFLOW_VALUES,
  SCROLL_TRIGGER_MODES,
  SECTION_RECIPE_IDS,
  SECTION_ROLES,
  SHAPE_VARIANTS,
  STYLE_KITS,
  SURFACE_VARIANTS,
  type ActionVariant,
  type BackgroundEffect,
  type BackgroundSize,
  type CanvasElement,
  type CanvasPage,
  type CanvasSection,
  type CanvasSiteState,
  type ElementType,
  type InlineMarkType,
  type MediaKind,
  type MotionPreset,
  type OverflowValue,
  type PublishedSnapshot,
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

const ALLOWED_HREF_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'] as const;
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
    if (!isNonEmptyString(h.url)) {
      errors.push(basePath + '.url must be a non-empty string');
    } else if (!isAllowedHref(h.url)) {
      errors.push(
        basePath + '.url "' + h.url + '" is not allowed (must be http:, https:, mailto:, tel:, /relative, or #anchor)',
      );
    }
  } else if (h.type === 'page') {
    if (!isNonEmptyString(h.pageId)) {
      errors.push(basePath + '.pageId must be a non-empty string');
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

const ASSET_ID_RE = /^[A-Za-z0-9._-]+$/;

function validateElementStyle(value: unknown, basePath: string, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push(`${basePath}.elementStyle must be an object when present`);
    return;
  }
  const p = `${basePath}.elementStyle`;
  if (value.backgroundColor !== undefined) {
    if (typeof value.backgroundColor !== 'string') {
      errors.push(`${p}.backgroundColor must be a string`);
    } else {
      const issue = pinnedStyleValueIssue(value.backgroundColor);
      if (issue !== null) {
        errors.push(`${p}.backgroundColor value ${JSON.stringify(value.backgroundColor)} contains ${issue}`);
      }
    }
  }
  if (value.backgroundImageAssetId !== undefined) {
    if (typeof value.backgroundImageAssetId !== 'string') {
      errors.push(`${p}.backgroundImageAssetId must be a string`);
    } else if (!ASSET_ID_RE.test(value.backgroundImageAssetId)) {
      errors.push(`${p}.backgroundImageAssetId must be an asset id, not a path or URL`);
    }
  }
  if (value.backgroundSize !== undefined) {
    if (!isOneOf<BackgroundSize>(value.backgroundSize, BACKGROUND_SIZES)) {
      errors.push(`${p}.backgroundSize must be cover|contain (got ${describe(value.backgroundSize)})`);
    }
  }
  if (value.borderRadius !== undefined) {
    if (!isFiniteNumber(value.borderRadius) || value.borderRadius < 0) {
      errors.push(`${p}.borderRadius must be a non-negative number`);
    }
  }
  if (value.borderColor !== undefined) {
    if (typeof value.borderColor !== 'string') {
      errors.push(`${p}.borderColor must be a string`);
    } else {
      const issue = pinnedStyleValueIssue(value.borderColor);
      if (issue !== null) {
        errors.push(`${p}.borderColor value ${JSON.stringify(value.borderColor)} contains ${issue}`);
      }
    }
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
    if (typeof value.boxShadow !== 'string') {
      errors.push(`${p}.boxShadow must be a string`);
    } else {
      const issue = pinnedStyleValueIssue(value.boxShadow);
      if (issue !== null) {
        errors.push(`${p}.boxShadow value ${JSON.stringify(value.boxShadow)} contains ${issue}`);
      }
    }
  }
  if (value.color !== undefined) {
    if (typeof value.color !== 'string') {
      errors.push(`${p}.color must be a string`);
    } else {
      const issue = pinnedStyleValueIssue(value.color);
      if (issue !== null) {
        errors.push(`${p}.color value ${JSON.stringify(value.color)} contains ${issue}`);
      }
    }
  }
  if (value.overflow !== undefined) {
    if (!isOneOf<OverflowValue>(value.overflow, OVERFLOW_VALUES)) {
      errors.push(`${p}.overflow must be visible|hidden (got ${describe(value.overflow)})`);
    }
  }
}

function validatePageMotionLayout(page: Record<string, unknown>, basePath: string, errors: string[]): void {
  if (page.entranceAnimation !== undefined) {
    if (!isOneOf<MotionPreset>(page.entranceAnimation, MOTION_PRESETS)) {
      errors.push(
        `${basePath}.entranceAnimation must be one of [${MOTION_PRESETS.join(', ')}] (got ${describe(page.entranceAnimation)})`,
      );
    }
  }
  if (page.scrollTriggerMode !== undefined) {
    if (!isOneOf<ScrollTriggerMode>(page.scrollTriggerMode, SCROLL_TRIGGER_MODES)) {
      errors.push(
        `${basePath}.scrollTriggerMode must be on-scroll|on-load (got ${describe(page.scrollTriggerMode)})`,
      );
    }
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
    if (!isOneOf<MotionPreset>(page.defaultMotionPreset, MOTION_PRESETS)) {
      errors.push(
        `${basePath}.defaultMotionPreset must be one of [${MOTION_PRESETS.join(', ')}] (got ${describe(page.defaultMotionPreset)})`,
      );
    }
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

function registerElementId(
  element: unknown,
  elementPath: string,
  pageIds: Set<string>,
  errors: string[],
): void {
  if (!isRecord(element) || !isNonEmptyString(element.id)) return;
  if (pageIds.has(element.id)) {
    errors.push(`${elementPath}.id "${element.id}" is duplicated within page`);
  } else {
    pageIds.add(element.id);
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
        if (mark.target !== undefined && mark.target !== '_blank') {
          errors.push(
            `text element ${idLabel}.content[${String(runIdx)}].marks[${String(markIdx)}].target must be "_blank" when present (got ${describe(mark.target)})`,
          );
        }
      }
    });
  });
  if (concatenated.length === 0) {
    errors.push(`text element ${idLabel} has empty concatenated plain text`);
  }
}

function validateCollectionChildren(
  children: unknown,
  childWidth: number,
  childHeight: number,
  basePath: string,
  errors: string[],
  pageIds?: Set<string>,
  validPageIds: Set<string> | null = null,
): void {
  if (!Array.isArray(children)) {
    errors.push(`${basePath} must be an array`);
    return;
  }
  children.forEach((child, idx) => {
    const childPath = pathJoin(basePath, idx);
    if (pageIds) registerElementId(child, childPath, pageIds, errors);
    validateElement(child, childWidth, childHeight, childPath, errors, validPageIds, pageIds);
  });
}

function validateCollectionEntries(
  entries: unknown,
  childWidth: number,
  childHeight: number,
  basePath: string,
  errors: string[],
  pageIds?: Set<string>,
  validPageIds: Set<string> | null = null,
): void {
  if (!Array.isArray(entries)) {
    errors.push(`${basePath} must be an array`);
    return;
  }
  entries.forEach((entry, entryIdx) => {
    const entryPath = pathJoin(basePath, entryIdx);
    validateCollectionChildren(
      entry,
      childWidth,
      childHeight,
      entryPath,
      errors,
      pageIds,
      validPageIds,
    );
  });
}

function validateElement(
  element: unknown,
  pageWidth: number,
  sectionHeight: number,
  basePath: string,
  errors: string[],
  validPageIds: Set<string> | null,
  pageIds?: Set<string>,
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
    return;
  }

  validateBox(element.box, pageWidth, sectionHeight, basePath, errors);
  validateMotion(element.motion, basePath, errors);
  validatePinnedStyle(element.pinnedStyle, basePath, errors);
  validateElementStyle(element.elementStyle, basePath, errors);

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
      if (
        element.fontWeight !== 400 &&
        element.fontWeight !== 500 &&
        element.fontWeight !== 600 &&
        element.fontWeight !== 700
      ) {
        errors.push(
          `${basePath}.fontWeight must be 400|500|600|700 (got ${describe(element.fontWeight)})`,
        );
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
      if (typeof element.assetId !== 'string') {
        errors.push(
          `${basePath}.assetId must be a string (empty string allowed for unfilled slots)`,
        );
      }
      if (element.posterAssetId !== undefined && typeof element.posterAssetId !== 'string') {
        errors.push(
          `${basePath}.posterAssetId must be a string when present (empty string allowed for unfilled slots)`,
        );
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
      validateActionHref(element.href, basePath + '.href', errors, validPageIds);
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
    case 'collection': {
      if (!isOneOf(element.mode, ['manual', 'page-bound'] as const)) {
        errors.push(`${basePath}.mode must be manual|page-bound (got ${describe(element.mode)})`);
      }
      const childWidth =
        isRecord(element.box) && isFiniteNumber(element.box.w) && element.box.w > 0
          ? element.box.w
          : pageWidth;
      const childHeight =
        isRecord(element.box) && isFiniteNumber(element.box.h) && element.box.h > 0
          ? element.box.h
          : sectionHeight;
      validateCollectionChildren(
        element.entryTemplate,
        childWidth,
        childHeight,
        `${basePath}.entryTemplate`,
        errors,
        pageIds,
        validPageIds,
      );
      validateCollectionEntries(
        element.entries,
        childWidth,
        childHeight,
        `${basePath}.entries`,
        errors,
        pageIds,
        validPageIds,
      );
      if (!isRecord(element.layout)) {
        errors.push(`${basePath}.layout must be an object`);
      } else {
        if (
          !isFiniteNumber(element.layout.columns) ||
          !Number.isInteger(element.layout.columns) ||
          element.layout.columns < 1
        ) {
          errors.push(`${basePath}.layout.columns must be a positive integer`);
        }
        if (!isFiniteNumber(element.layout.gap) || element.layout.gap < 0) {
          errors.push(`${basePath}.layout.gap must be >= 0`);
        }
      }
      if (element.mode === 'page-bound') {
        if (element.filter !== undefined) {
          if (!isRecord(element.filter)) {
            errors.push(`${basePath}.filter must be an object when present`);
          } else {
            if (
              element.filter.category !== undefined &&
              !isNonEmptyString(element.filter.category)
            ) {
              errors.push(`${basePath}.filter.category must be a non-empty string when present`);
            }
            if (element.filter.tags !== undefined) {
              if (!Array.isArray(element.filter.tags)) {
                errors.push(`${basePath}.filter.tags must be an array when present`);
              } else {
                element.filter.tags.forEach((tag, tagIdx) => {
                  if (!isNonEmptyString(tag)) {
                    errors.push(
                      `${basePath}.filter.tags[${String(tagIdx)}] must be a non-empty string`,
                    );
                  }
                });
              }
            }
            if (
              element.filter.limit !== undefined &&
              (!isFiniteNumber(element.filter.limit) ||
                !Number.isInteger(element.filter.limit) ||
                element.filter.limit < 1)
            ) {
              errors.push(`${basePath}.filter.limit must be a positive integer when present`);
            }
          }
        }
        if (element.sort !== undefined) {
          if (!isRecord(element.sort)) {
            errors.push(`${basePath}.sort must be an object when present`);
          } else {
            if (!isOneOf(element.sort.field, ['publishedDate', 'title'] as const)) {
              errors.push(
                `${basePath}.sort.field must be publishedDate|title (got ${describe(element.sort.field)})`,
              );
            }
            if (!isOneOf(element.sort.order, ['asc', 'desc'] as const)) {
              errors.push(
                `${basePath}.sort.order must be asc|desc (got ${describe(element.sort.order)})`,
              );
            }
          }
        }
        if (element.cardTemplate !== undefined) {
          validateCollectionChildren(
            element.cardTemplate,
            childWidth,
            childHeight,
            `${basePath}.cardTemplate`,
            errors,
            pageIds,
            validPageIds,
          );
        }
        if (element.fieldBindings !== undefined) {
          if (!isRecord(element.fieldBindings)) {
            errors.push(`${basePath}.fieldBindings must be an object when present`);
          } else {
            for (const [elementId, field] of Object.entries(element.fieldBindings)) {
              if (!isNonEmptyString(elementId)) {
                errors.push(`${basePath}.fieldBindings keys must be non-empty element ids`);
              }
              if (!isOneOf(field, PAGE_METADATA_FIELDS)) {
                errors.push(
                  `${basePath}.fieldBindings["${elementId}"] must be one of [${PAGE_METADATA_FIELDS.join(', ')}] (got ${describe(field)})`,
                );
              }
            }
          }
        }
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
): void {
  if (!isRecord(section)) {
    errors.push(`${basePath} must be an object`);
    return;
  }
  if (!isNonEmptyString(section.id)) {
    errors.push(`${basePath}.id must be a non-empty string`);
  } else if (localIds.has(section.id)) {
    errors.push(`${basePath}.id "${section.id}" is duplicated within page`);
  } else {
    localIds.add(section.id);
  }
  if (!isOneOf<SectionRecipeId>(section.recipeId, SECTION_RECIPE_IDS)) {
    errors.push(
      `${basePath}.recipeId must be one of [${SECTION_RECIPE_IDS.join(', ')}] (got ${describe(section.recipeId)})`,
    );
  }
  if (!isNonEmptyString(section.name)) {
    errors.push(`${basePath}.name must be a non-empty string`);
  }
  if (section.role !== undefined && !isOneOf<SectionRole>(section.role, SECTION_ROLES)) {
    errors.push(
      `${basePath}.role must be header|footer|body when present (got ${describe(section.role)})`,
    );
  }
  const minHeight =
    section.role === 'header' || section.role === 'footer'
      ? PINNED_SECTION_HEIGHT_MIN
      : SECTION_HEIGHT_MIN;
  const heightValid =
    isFiniteNumber(section.height) &&
    section.height >= minHeight &&
    section.height <= SECTION_HEIGHT_MAX;
  if (!heightValid) {
    errors.push(
      `${basePath}.height must be a finite number in [${String(minHeight)}, ${String(SECTION_HEIGHT_MAX)}] (got ${describe(section.height)})`,
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
  if (section.entrance !== undefined && !isOneOf<MotionPreset>(section.entrance, MOTION_PRESETS)) {
    errors.push(
      `${basePath}.entrance must be one of [${MOTION_PRESETS.join(', ')}] (got ${describe(section.entrance)})`,
    );
  }
  validateSectionTrigger(section.trigger, pathJoin(basePath, 'trigger'), errors);
  validateBackgroundVideo(section.backgroundVideo, pathJoin(basePath, 'backgroundVideo'), errors);
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
    registerElementId(element, elementPath, localIds, errors);
    validateElement(element, pageWidth, effectiveHeight, elementPath, errors, validPageIds, localIds);
  });
}

function validateSectionTrigger(trigger: unknown, basePath: string, errors: string[]): void {
  if (trigger === undefined) return;
  if (!isRecord(trigger)) {
    errors.push(`${basePath} must be an object when present`);
    return;
  }
  if (!isOneOf(trigger.type, POPUP_TRIGGER_TYPES)) {
    errors.push(
      `${basePath}.type must be one of [${POPUP_TRIGGER_TYPES.join(', ')}] (got ${describe(trigger.type)})`,
    );
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
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    errors.push(`${basePath} must be an asset id, not a path or URL`);
  }
}

function validateSectionRolePlacement(
  sections: unknown[],
  basePath: string,
  errors: string[],
): void {
  let headerCount = 0;
  let footerCount = 0;
  for (let idx = 0; idx < sections.length; idx += 1) {
    const section = sections[idx];
    if (!isRecord(section)) continue;
    const sectionPath = pathJoin(pathJoin(basePath, 'sections'), idx);
    if (section.role === 'header') {
      headerCount += 1;
      if (idx !== 0) {
        errors.push(`${sectionPath}.role header role must be at sections[0]`);
      }
    }
    if (section.role === 'footer') {
      footerCount += 1;
      if (idx !== sections.length - 1) {
        errors.push(`${sectionPath}.role footer role must be at sections[last]`);
      }
    }
  }
  if (headerCount > 1) {
    errors.push(`${basePath}.sections must contain at most one Header Section`);
  }
  if (footerCount > 1) {
    errors.push(`${basePath}.sections must contain at most one Footer Section`);
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
  if (!isNonEmptyString(page.title)) {
    errors.push(`${basePath}.title must be a non-empty string`);
  }
  if (page.publishedDate !== undefined) {
    if (!isNonEmptyString(page.publishedDate)) {
      errors.push(`${basePath}.publishedDate must be a non-empty string when present`);
    } else if (!Number.isFinite(Date.parse(page.publishedDate))) {
      errors.push(`${basePath}.publishedDate must be parseable as a date`);
    }
  }
  if (page.author !== undefined && !isNonEmptyString(page.author)) {
    errors.push(`${basePath}.author must be a non-empty string when present`);
  }
  if (page.tags !== undefined) {
    if (!Array.isArray(page.tags)) {
      errors.push(`${basePath}.tags must be an array when present`);
    } else {
      page.tags.forEach((tag, tagIdx) => {
        if (!isNonEmptyString(tag)) {
          errors.push(`${basePath}.tags[${String(tagIdx)}] must be a non-empty string`);
        }
      });
    }
  }
  if (page.category !== undefined && !isNonEmptyString(page.category)) {
    errors.push(`${basePath}.category must be a non-empty string when present`);
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
  validateSectionRolePlacement(page.sections, basePath, errors);
  const ids = new Set<string>();
  if (isNonEmptyString(page.id)) ids.add(page.id);
  const effectiveWidth = widthValid ? (page.width as number) : PAGE_WIDTH_MAX;
  page.sections.forEach((section, idx) => {
    const path = pathJoin(pathJoin(basePath, 'sections'), idx);
    validateSection(section, effectiveWidth, path, errors, ids, validPageIds);
  });
}

function validatePageSetShape(pages: unknown[], errors: string[]): void {
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
  validatePageSetShape(state.pages, errors);
  const validPageIds = new Set<string>();
  const pageSlugs = new Set<string>();
  state.pages.forEach((page, idx) => {
    if (!isRecord(page)) return;
    if (isNonEmptyString(page.id)) {
      if (validPageIds.has(page.id)) {
        errors.push(`pages[${String(idx)}].id "${page.id}" is duplicated across pages`);
      } else {
        validPageIds.add(page.id);
      }
    }
    if (isNonEmptyString(page.slug)) {
      if (pageSlugs.has(page.slug)) {
        errors.push(`pages[${String(idx)}].slug "${page.slug}" is duplicated across pages`);
      } else {
        pageSlugs.add(page.slug);
      }
    }
  });
  state.pages.forEach((page, idx) => {
    validatePage(page, `pages[${String(idx)}]`, errors, validPageIds);
  });
  // Site-wide header and footer are optional top-level sections. When present,
  // validate them with the same section validator used for page sections.
  // Use PAGE_WIDTH_MAX as the width bound since header/footer span the full
  // viewport and are not tied to a single page's width.
  if (state.header !== undefined) {
    const headerIds = new Set<string>();
    validateSection(state.header, PAGE_WIDTH_MAX, 'state.header', errors, headerIds, validPageIds);
  }
  if (state.footer !== undefined) {
    const footerIds = new Set<string>();
    validateSection(state.footer, PAGE_WIDTH_MAX, 'state.footer', errors, footerIds, validPageIds);
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
  // Re-use the editable validator on the snapshot's pages + style kit +
  // optional header/footer sections.
  validateEditableShape(
    {
      styleKit: snapshot.styleKit,
      pages: snapshot.pages,
      header: snapshot.header,
      footer: snapshot.footer,
    },
    errors,
  );
  validatePublishedMediaReferences(snapshot, errors);
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

  function validateSeedSection(section: CanvasSection | undefined, sectionPath: string): void {
    if (!section) return;
    for (let elIdx = 0; elIdx < section.elements.length; elIdx++) {
      const element = section.elements[elIdx];
      if (!element || element.type !== 'media') continue;
      const elementPath = `${sectionPath}.elements[${String(elIdx)}]`;
      const assetId = element.assetId;
      const seedAsset = SEED_ASSET_REGISTRY[assetId];
      if (!seedAsset) {
        errors.push(
          `${elementPath}.assetId "${assetId}" is not registered in SEED_ASSET_REGISTRY`,
        );
      } else if (seedAsset.kind !== element.mediaKind) {
        errors.push(
          `${elementPath}.assetId "${assetId}" is registered as ${seedAsset.kind}, but mediaKind is ${element.mediaKind}`,
        );
      }
      if (element.posterAssetId !== undefined) {
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
      validateSeedSection(
        page.sections[sectionIdx],
        `${pagePath}.sections[${String(sectionIdx)}]`,
      );
    }
  }
  validateSeedSection(state.header, 'header');
  validateSeedSection(state.footer, 'footer');

  if (errors.length === 0) return { valid: true };
  return { valid: false, errors };
}

// Re-exported types for downstream callers that only depend on validate.ts.
export type { CanvasElement, CanvasPage, CanvasSection, CanvasSiteState, PublishedSnapshot };
