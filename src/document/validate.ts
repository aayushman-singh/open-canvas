// src/document/validate.ts
//
// Pure-function validator for the rev01 document JSON. Walks the tree, checks
// node types are known, required attrs are present, enum values are within
// range, content children obey their group rule, and media srcs match their
// media type (with an embed allowlist for iframes).
//
// Returns at most 20 errors per call so completely-broken input does not blow
// up the error list. Does not throw — invalid input is data, not an exception.
//
// Spec: docs/specs/template-schema.md §4.

import {
  ACTION_VARIANTS,
  ALIGNMENTS,
  BLOCK_NODE_TYPES,
  COLUMN_COUNTS,
  COLUMN_GAPS,
  COLUMN_WIDTHS,
  DIVIDER_STYLES,
  EMBED_ALLOWLIST,
  HEADING_LEVELS,
  INLINE_NODE_TYPES,
  LINK_RELS,
  LINK_TARGETS,
  LIST_STYLES,
  MARK_TYPES,
  MEDIA_LOADING,
  MEDIA_TYPES,
  NODE_SCHEMA,
  PADDING_SIZES,
  SECTION_KINDS,
  type ChildrenRule,
  type NodeType,
} from './schema.js';

export type ValidationResult = { valid: true } | { valid: false; errors: string[] };

const MAX_ERRORS = 20;

interface Ctx {
  errors: string[];
}

const stop = (ctx: Ctx): boolean => ctx.errors.length >= MAX_ERRORS;

const pushErr = (ctx: Ctx, path: string, msg: string): void => {
  if (stop(ctx)) return;
  ctx.errors.push(`${path}: ${msg}`);
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isOneOf = <T extends string | number>(v: unknown, allowed: readonly T[]): v is T =>
  allowed.includes(v as T);

// ---------------------------------------------------------------------------
// Top-level entry.
// ---------------------------------------------------------------------------

export function validateDocument(doc: unknown): ValidationResult {
  const ctx: Ctx = { errors: [] };

  if (!isPlainObject(doc)) {
    return { valid: false, errors: ['$: document must be an object'] };
  }

  if (doc.type !== 'doc') {
    pushErr(ctx, '$', `root type must be "doc", got ${JSON.stringify(doc.type)}`);
  }

  const content = doc.content;
  if (!Array.isArray(content)) {
    pushErr(ctx, '$', 'root must have a content array');
    return finish(ctx);
  }

  if (content.length === 0) {
    pushErr(ctx, '$.content', 'document must contain at least one section');
  }

  for (let i = 0; i < content.length; i++) {
    if (stop(ctx)) break;
    validateSection(content[i], `$.content[${i}]`, ctx);
  }

  return finish(ctx);
}

const finish = (ctx: Ctx): ValidationResult =>
  ctx.errors.length === 0 ? { valid: true } : { valid: false, errors: ctx.errors };

// ---------------------------------------------------------------------------
// Section.
// ---------------------------------------------------------------------------

function validateSection(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'section must be an object');
    return;
  }
  if (node.type !== 'section') {
    pushErr(ctx, path, `expected type "section", got ${JSON.stringify(node.type)}`);
    return;
  }

  const attrs = checkAttrs(node, path, 'section', ctx);
  if (attrs) {
    if (!isOneOf(attrs.kind, SECTION_KINDS)) {
      pushErr(ctx, `${path}.attrs.kind`, `must be one of ${SECTION_KINDS.join(', ')}`);
    }
    if (attrs.padding !== undefined && !isOneOf(attrs.padding, PADDING_SIZES)) {
      pushErr(ctx, `${path}.attrs.padding`, `must be one of ${PADDING_SIZES.join(', ')}`);
    }
    if (attrs.surface !== undefined && typeof attrs.surface !== 'string') {
      pushErr(ctx, `${path}.attrs.surface`, 'must be a string');
    }
    if (attrs.bg !== undefined && typeof attrs.bg !== 'string') {
      pushErr(ctx, `${path}.attrs.bg`, 'must be a string');
    }
  }

  validateChildren(node, path, 'section', ctx);
}

// ---------------------------------------------------------------------------
// Block dispatcher.
// ---------------------------------------------------------------------------

function validateBlock(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'block must be an object');
    return;
  }
  const type = node.type;
  if (typeof type !== 'string') {
    pushErr(ctx, path, 'block.type must be a string');
    return;
  }
  if (!(BLOCK_NODE_TYPES as readonly string[]).includes(type)) {
    pushErr(
      ctx,
      path,
      `unknown block type ${JSON.stringify(type)} (expected one of ${BLOCK_NODE_TYPES.join(', ')})`,
    );
    return;
  }

  switch (type as (typeof BLOCK_NODE_TYPES)[number]) {
    case 'heading':
      validateHeading(node, path, ctx);
      break;
    case 'paragraph':
      validateParagraph(node, path, ctx);
      break;
    case 'media':
      validateMedia(node, path, ctx);
      break;
    case 'actions':
      validateActions(node, path, ctx);
      break;
    case 'columns':
      validateColumns(node, path, ctx);
      break;
    case 'divider':
      validateDivider(node, path, ctx);
      break;
    case 'list':
      validateList(node, path, ctx);
      break;
  }
}

// ---------------------------------------------------------------------------
// Individual block validators.
// ---------------------------------------------------------------------------

function validateHeading(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'heading', ctx);
  if (attrs) {
    if (!isOneOf(attrs.level, HEADING_LEVELS)) {
      pushErr(ctx, `${path}.attrs.level`, `must be one of ${HEADING_LEVELS.join(', ')}`);
    }
    if (attrs.align !== undefined && !isOneOf(attrs.align, ALIGNMENTS)) {
      pushErr(ctx, `${path}.attrs.align`, `must be one of ${ALIGNMENTS.join(', ')}`);
    }
  }
  validateChildren(node, path, 'heading', ctx);
}

function validateParagraph(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'paragraph', ctx);
  if (attrs && attrs.align !== undefined && !isOneOf(attrs.align, ALIGNMENTS)) {
    pushErr(ctx, `${path}.attrs.align`, `must be one of ${ALIGNMENTS.join(', ')}`);
  }
  validateChildren(node, path, 'paragraph', ctx);
}

function validateMedia(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'media', ctx);
  if (!attrs) return;

  const { src, mediaType } = attrs;

  if (typeof src !== 'string' || src.length === 0) {
    pushErr(ctx, `${path}.attrs.src`, 'must be a non-empty string');
  }
  if (!isOneOf(mediaType, MEDIA_TYPES)) {
    pushErr(ctx, `${path}.attrs.mediaType`, `must be one of ${MEDIA_TYPES.join(', ')}`);
  }
  if (attrs.alt !== undefined && typeof attrs.alt !== 'string') {
    pushErr(ctx, `${path}.attrs.alt`, 'must be a string');
  }
  if (attrs.aspectRatio !== undefined && typeof attrs.aspectRatio !== 'string') {
    pushErr(ctx, `${path}.attrs.aspectRatio`, 'must be a string');
  }
  if (attrs.loading !== undefined && !isOneOf(attrs.loading, MEDIA_LOADING)) {
    pushErr(ctx, `${path}.attrs.loading`, `must be one of ${MEDIA_LOADING.join(', ')}`);
  }

  if (typeof src === 'string' && isOneOf(mediaType, MEDIA_TYPES)) {
    checkMediaSrc(src, mediaType, `${path}.attrs.src`, ctx);
  }
}

function validateActions(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'actions', ctx);
  if (attrs && attrs.align !== undefined && !isOneOf(attrs.align, ALIGNMENTS)) {
    pushErr(ctx, `${path}.attrs.align`, `must be one of ${ALIGNMENTS.join(', ')}`);
  }
  validateChildren(node, path, 'actions', ctx);
}

function validateAction(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'action must be an object');
    return;
  }
  if (node.type !== 'action') {
    pushErr(ctx, path, `expected type "action", got ${JSON.stringify(node.type)}`);
    return;
  }
  const attrs = checkAttrs(node, path, 'action', ctx);
  if (!attrs) return;

  if (typeof attrs.href !== 'string' || attrs.href.length === 0) {
    pushErr(ctx, `${path}.attrs.href`, 'must be a non-empty string');
  }
  if (typeof attrs.label !== 'string' || attrs.label.length === 0) {
    pushErr(ctx, `${path}.attrs.label`, 'must be a non-empty string');
  }
  if (attrs.variant !== undefined && !isOneOf(attrs.variant, ACTION_VARIANTS)) {
    pushErr(ctx, `${path}.attrs.variant`, `must be one of ${ACTION_VARIANTS.join(', ')}`);
  }
  if (attrs.newTab !== undefined && typeof attrs.newTab !== 'boolean') {
    pushErr(ctx, `${path}.attrs.newTab`, 'must be a boolean');
  }
}

function validateColumns(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'columns', ctx);
  if (attrs) {
    if (!isOneOf(attrs.count, COLUMN_COUNTS)) {
      pushErr(ctx, `${path}.attrs.count`, `must be one of ${COLUMN_COUNTS.join(', ')}`);
    }
    if (attrs.gap !== undefined && !isOneOf(attrs.gap, COLUMN_GAPS)) {
      pushErr(ctx, `${path}.attrs.gap`, `must be one of ${COLUMN_GAPS.join(', ')}`);
    }
  }
  validateChildren(node, path, 'columns', ctx);
}

function validateColumn(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'column must be an object');
    return;
  }
  if (node.type !== 'column') {
    pushErr(ctx, path, `expected type "column", got ${JSON.stringify(node.type)}`);
    return;
  }
  const attrs = checkAttrs(node, path, 'column', ctx);
  if (attrs) {
    if (attrs.width !== undefined && !isOneOf(attrs.width, COLUMN_WIDTHS)) {
      pushErr(ctx, `${path}.attrs.width`, `must be one of ${COLUMN_WIDTHS.join(', ')}`);
    }
    if (attrs.align !== undefined && !isOneOf(attrs.align, ALIGNMENTS)) {
      pushErr(ctx, `${path}.attrs.align`, `must be one of ${ALIGNMENTS.join(', ')}`);
    }
  }
  validateChildren(node, path, 'column', ctx);
}

function validateDivider(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = node.attrs;
  if (attrs !== undefined) {
    if (!isPlainObject(attrs)) {
      pushErr(ctx, `${path}.attrs`, 'must be an object when present');
      return;
    }
    if (attrs.style !== undefined && !isOneOf(attrs.style, DIVIDER_STYLES)) {
      pushErr(ctx, `${path}.attrs.style`, `must be one of ${DIVIDER_STYLES.join(', ')}`);
    }
    checkUnknownAttrs(attrs, 'divider', path, ctx);
  }
}

function validateList(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  const attrs = checkAttrs(node, path, 'list', ctx);
  if (attrs && !isOneOf(attrs.style, LIST_STYLES)) {
    pushErr(ctx, `${path}.attrs.style`, `must be one of ${LIST_STYLES.join(', ')}`);
  }
  validateChildren(node, path, 'list', ctx);
}

function validateListItem(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'listItem must be an object');
    return;
  }
  if (node.type !== 'listItem') {
    pushErr(ctx, path, `expected type "listItem", got ${JSON.stringify(node.type)}`);
    return;
  }
  validateChildren(node, path, 'listItem', ctx);
}

// ---------------------------------------------------------------------------
// Inline (text).
// ---------------------------------------------------------------------------

function validateInline(node: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(node)) {
    pushErr(ctx, path, 'inline node must be an object');
    return;
  }
  if (!(INLINE_NODE_TYPES as readonly string[]).includes(node.type as string)) {
    pushErr(
      ctx,
      path,
      `unknown inline type ${JSON.stringify(node.type)} (expected one of ${INLINE_NODE_TYPES.join(', ')})`,
    );
    return;
  }
  // Only `text` is inline today.
  validateText(node, path, ctx);
}

function validateText(node: Record<string, unknown>, path: string, ctx: Ctx): void {
  if (typeof node.text !== 'string') {
    pushErr(ctx, `${path}.text`, 'must be a string');
  }
  if ('content' in node) {
    pushErr(ctx, `${path}.content`, 'text nodes must not have content');
  }
  if ('attrs' in node) {
    pushErr(ctx, `${path}.attrs`, 'text nodes must not have attrs');
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks)) {
      pushErr(ctx, `${path}.marks`, 'must be an array');
    } else {
      for (let i = 0; i < node.marks.length; i++) {
        validateMark(node.marks[i], `${path}.marks[${i}]`, ctx);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Marks.
// ---------------------------------------------------------------------------

function validateMark(mark: unknown, path: string, ctx: Ctx): void {
  if (!isPlainObject(mark)) {
    pushErr(ctx, path, 'mark must be an object');
    return;
  }
  const type = mark.type;
  if (!(MARK_TYPES as readonly string[]).includes(type as string)) {
    pushErr(
      ctx,
      path,
      `unknown mark type ${JSON.stringify(type)} (expected one of ${MARK_TYPES.join(', ')})`,
    );
    return;
  }

  switch (type as (typeof MARK_TYPES)[number]) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'code':
      if (mark.attrs !== undefined) {
        pushErr(ctx, `${path}.attrs`, `${type as string} mark must not have attrs`);
      }
      break;
    case 'link': {
      const attrs = mark.attrs;
      if (!isPlainObject(attrs)) {
        pushErr(ctx, `${path}.attrs`, 'link mark must have an attrs object');
        break;
      }
      if (typeof attrs.href !== 'string' || attrs.href.length === 0) {
        pushErr(ctx, `${path}.attrs.href`, 'must be a non-empty string');
      }
      if (attrs.target !== undefined && !isOneOf(attrs.target, LINK_TARGETS)) {
        pushErr(ctx, `${path}.attrs.target`, `must be one of ${LINK_TARGETS.join(', ')}`);
      }
      if (attrs.rel !== undefined) {
        if (typeof attrs.rel !== 'string') {
          pushErr(ctx, `${path}.attrs.rel`, 'must be a string');
        } else {
          const tokens = attrs.rel.split(/\s+/).filter(Boolean);
          for (const t of tokens) {
            if (!(LINK_RELS as readonly string[]).includes(t)) {
              pushErr(
                ctx,
                `${path}.attrs.rel`,
                `unknown rel token ${JSON.stringify(t)} (expected one of ${LINK_RELS.join(', ')})`,
              );
            }
          }
        }
      }
      break;
    }
    case 'color':
    case 'highlight': {
      const attrs = mark.attrs;
      if (!isPlainObject(attrs)) {
        pushErr(ctx, `${path}.attrs`, `${type as string} mark must have an attrs object`);
        break;
      }
      if (typeof attrs.value !== 'string' || attrs.value.length === 0) {
        pushErr(ctx, `${path}.attrs.value`, 'must be a non-empty string');
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers — attrs and children.
// ---------------------------------------------------------------------------

function checkAttrs(
  node: Record<string, unknown>,
  path: string,
  type: NodeType,
  ctx: Ctx,
): Record<string, unknown> | undefined {
  const entry = NODE_SCHEMA[type];
  const attrs = node.attrs;

  if (entry.required.length === 0 && attrs === undefined) {
    return {};
  }

  if (!isPlainObject(attrs)) {
    if (entry.required.length === 0) {
      pushErr(ctx, `${path}.attrs`, 'must be an object when present');
      return undefined;
    }
    pushErr(
      ctx,
      `${path}.attrs`,
      `must be an object (required attrs: ${entry.required.join(', ')})`,
    );
    return undefined;
  }

  for (const key of entry.required) {
    if (!(key in attrs)) {
      pushErr(ctx, `${path}.attrs.${key}`, 'is required');
    }
  }

  checkUnknownAttrs(attrs, type, path, ctx);

  return attrs;
}

function checkUnknownAttrs(
  attrs: Record<string, unknown>,
  type: NodeType,
  path: string,
  ctx: Ctx,
): void {
  const entry = NODE_SCHEMA[type];
  const allowed = new Set([...entry.required, ...entry.optional]);
  for (const k of Object.keys(attrs)) {
    if (!allowed.has(k)) {
      pushErr(
        ctx,
        `${path}.attrs.${k}`,
        `unknown attr for ${type} (allowed: ${[...allowed].join(', ') || '(none)'})`,
      );
    }
  }
}

function validateChildren(
  node: Record<string, unknown>,
  path: string,
  type: NodeType,
  ctx: Ctx,
): void {
  const rule: ChildrenRule = NODE_SCHEMA[type].children;
  if (rule === 'none') {
    if ('content' in node) {
      pushErr(ctx, `${path}.content`, `${type} must not have content`);
    }
    return;
  }

  const content = node.content;
  const minimum = rule.endsWith('*') ? 0 : 1;

  if (content === undefined && minimum === 0) {
    return;
  }

  if (!Array.isArray(content)) {
    pushErr(ctx, `${path}.content`, 'must be an array');
    return;
  }

  if (content.length < minimum) {
    pushErr(ctx, `${path}.content`, `${type} requires at least ${minimum} child(ren)`);
  }

  for (let i = 0; i < content.length; i++) {
    if (stop(ctx)) break;
    const childPath = `${path}.content[${i}]`;
    switch (rule) {
      case 'block+':
        validateBlock(content[i], childPath, ctx);
        break;
      case 'inline+':
      case 'inline*':
        validateInline(content[i], childPath, ctx);
        break;
      case 'action+':
        validateAction(content[i], childPath, ctx);
        break;
      case 'column+':
        validateColumn(content[i], childPath, ctx);
        break;
      case 'listItem+':
        validateListItem(content[i], childPath, ctx);
        break;
      case 'section+':
        // Only used at the doc level; not reached here.
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Media src checks.
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'] as const;

function isHttpUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u;
    return null;
  } catch {
    return null;
  }
}

function isDataUrl(s: string): boolean {
  return s.startsWith('data:');
}

function hasImageExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function checkMediaSrc(src: string, mediaType: string, path: string, ctx: Ctx): void {
  if (mediaType === 'image') {
    if (isDataUrl(src)) return;
    const u = isHttpUrl(src);
    if (!u) {
      pushErr(ctx, path, 'image src must be an http(s) url or data url');
      return;
    }
    if (!hasImageExtension(u.pathname)) {
      pushErr(ctx, path, `image src must end in one of ${IMAGE_EXTENSIONS.join(', ')}`);
    }
    return;
  }
  if (mediaType === 'video') {
    const u = isHttpUrl(src);
    if (!u) {
      pushErr(ctx, path, 'video src must be an http(s) url');
    }
    return;
  }
  if (mediaType === 'iframe') {
    const u = isHttpUrl(src);
    if (!u) {
      pushErr(ctx, path, 'iframe src must be an http(s) url');
      return;
    }
    const host = u.hostname.toLowerCase();
    const ok = EMBED_ALLOWLIST.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    if (!ok) {
      pushErr(
        ctx,
        path,
        `iframe host ${JSON.stringify(host)} not in embed allowlist (${EMBED_ALLOWLIST.join(', ')})`,
      );
    }
  }
}
