// src/document/render.ts
//
// Pure-function renderer: DocumentJSON + ThemeTokenSet -> HTML string.
//
// No I/O, no async, no external libs. Deterministic — the same input yields
// the same output byte-for-byte. The renderer assumes input has been
// validated; on unknown shapes it throws (the only place a throw is okay,
// per the failure-handling stance).
//
// Spec: docs/specs/template-schema.md §1 + ADR 0001 decision 10.

import { deriveTokens, tokensToCssDecls } from '../theme/derive.js';
import type {
  ActionNode,
  ActionsNode,
  BlockNode,
  ColumnNode,
  ColumnsNode,
  DividerNode,
  DocumentJSON,
  HeadingNode,
  InlineNode,
  ListItemNode,
  ListNode,
  Mark,
  MediaNode,
  ParagraphNode,
  SectionNode,
  TextNode,
  ThemeTokenSet,
} from './schema.js';

// ---------------------------------------------------------------------------
// Public entry.
// ---------------------------------------------------------------------------

export function renderDoc(doc: DocumentJSON, theme: ThemeTokenSet): string {
  if (doc.type !== 'doc') {
    throw new Error(`renderDoc: expected doc.type === "doc", got ${String(doc.type)}`);
  }
  const sections = doc.content.map(renderSection).join('');
  return `<article class="rev01-doc">${renderThemeStyle(theme)}${sections}</article>`;
}

// ---------------------------------------------------------------------------
// Theme injection.
//
// Derives the twelve-token OKLCH graph from the palette seed at render time
// (see src/theme/derive.ts) and emits all of them as CSS custom properties on
// `.rev01-doc`, alongside the literal font/radius/density values from the
// stored ThemeTokenSet. The seed itself is also surfaced so callers can read
// it back from the DOM.
// ---------------------------------------------------------------------------

function renderThemeStyle(theme: ThemeTokenSet): string {
  const derived = tokensToCssDecls(deriveTokens(theme.paletteSeed));
  const literal = [
    `--rev01-palette-seed: ${cssValue(theme.paletteSeed)};`,
    `--rev01-font-heading: ${cssValue(theme.font.heading)};`,
    `--rev01-font-body: ${cssValue(theme.font.body)};`,
    `--rev01-radius: ${cssValue(theme.radius)};`,
    `--rev01-density: ${cssValue(theme.density)};`,
  ].join(' ');
  return `<style>.rev01-doc{${derived} ${literal}}</style>`;
}

// ---------------------------------------------------------------------------
// Section + block dispatcher.
// ---------------------------------------------------------------------------

function renderSection(section: SectionNode): string {
  const a = section.attrs;
  const attrs: string[] = [`data-kind="${escAttr(a.kind)}"`];
  if (a.surface !== undefined) attrs.push(`data-surface="${escAttr(a.surface)}"`);
  if (a.padding !== undefined) attrs.push(`data-padding="${escAttr(a.padding)}"`);
  if (a.bg !== undefined) attrs.push(`style="background-image:url('${escAttr(a.bg)}')"`);
  const body = section.content.map(renderBlock).join('');
  return `<section ${attrs.join(' ')}>${body}</section>`;
}

function renderBlock(node: BlockNode): string {
  switch (node.type) {
    case 'heading':
      return renderHeading(node);
    case 'paragraph':
      return renderParagraph(node);
    case 'media':
      return renderMedia(node);
    case 'actions':
      return renderActions(node);
    case 'columns':
      return renderColumns(node);
    case 'divider':
      return renderDivider(node);
    case 'list':
      return renderList(node);
    default: {
      const _exhaust: never = node;
      throw new Error(`renderBlock: unknown block type ${JSON.stringify(_exhaust)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Individual block renderers.
// ---------------------------------------------------------------------------

function renderHeading(node: HeadingNode): string {
  const tag = `h${String(node.attrs.level)}`;
  const cls = alignClass(node.attrs.align);
  const inner = node.content.map(renderInline).join('');
  return `<${tag}${cls}>${inner}</${tag}>`;
}

function renderParagraph(node: ParagraphNode): string {
  const cls = alignClass(node.attrs?.align);
  const inner = (node.content ?? []).map(renderInline).join('');
  return `<p${cls}>${inner}</p>`;
}

function renderMedia(node: MediaNode): string {
  const a = node.attrs;
  switch (a.mediaType) {
    case 'image': {
      const parts = [`<img src="${escAttr(a.src)}"`];
      parts.push(`alt="${escAttr(a.alt ?? '')}"`);
      if (a.loading !== undefined) parts.push(`loading="${escAttr(a.loading)}"`);
      if (a.aspectRatio !== undefined) {
        parts.push(`style="aspect-ratio:${escAttr(a.aspectRatio)}"`);
      }
      return `${parts.join(' ')}>`;
    }
    case 'video': {
      const parts = [`<video src="${escAttr(a.src)}" controls`];
      if (a.aspectRatio !== undefined) {
        parts.push(`style="aspect-ratio:${escAttr(a.aspectRatio)}"`);
      }
      return `${parts.join(' ')}></video>`;
    }
    case 'iframe': {
      const parts = [
        `<iframe src="${escAttr(a.src)}"`,
        'sandbox="allow-same-origin allow-scripts"',
      ];
      if (a.loading !== undefined) parts.push(`loading="${escAttr(a.loading)}"`);
      if (a.aspectRatio !== undefined) {
        parts.push(`style="aspect-ratio:${escAttr(a.aspectRatio)}"`);
      }
      if (a.alt !== undefined) parts.push(`title="${escAttr(a.alt)}"`);
      return `${parts.join(' ')}></iframe>`;
    }
    default: {
      const _exhaust: never = a.mediaType;
      throw new Error(`renderMedia: unknown mediaType ${JSON.stringify(_exhaust)}`);
    }
  }
}

function renderActions(node: ActionsNode): string {
  const align = node.attrs?.align;
  const cls = `actions${align ? ` align-${align}` : ''}`;
  const inner = node.content.map(renderAction).join('');
  return `<div class="${escAttr(cls)}">${inner}</div>`;
}

function renderAction(node: ActionNode): string {
  const a = node.attrs;
  const attrs: string[] = [`href="${escAttr(a.href)}"`];
  if (a.variant !== undefined) attrs.push(`data-variant="${escAttr(a.variant)}"`);
  if (a.newTab === true) {
    attrs.push('target="_blank"');
    attrs.push('rel="noopener noreferrer"');
  }
  return `<a ${attrs.join(' ')}>${escText(a.label)}</a>`;
}

function renderColumns(node: ColumnsNode): string {
  const a = node.attrs;
  const parts = [`columns`, `columns-${String(a.count)}`];
  if (a.gap !== undefined) parts.push(`gap-${a.gap}`);
  const inner = node.content.map(renderColumn).join('');
  return `<div class="${escAttr(parts.join(' '))}">${inner}</div>`;
}

function renderColumn(node: ColumnNode): string {
  const a = node.attrs ?? {};
  const classes = ['column'];
  if (a.width !== undefined) classes.push(`width-${widthSlug(a.width)}`);
  if (a.align !== undefined) classes.push(`align-${a.align}`);
  const inner = node.content.map(renderBlock).join('');
  return `<div class="${escAttr(classes.join(' '))}">${inner}</div>`;
}

function renderDivider(node: DividerNode): string {
  const style = node.attrs?.style ?? 'line';
  if (style === 'space') {
    return `<div class="divider divider-space" role="separator"></div>`;
  }
  return `<hr class="divider divider-${escAttr(style)}">`;
}

function renderList(node: ListNode): string {
  const items = node.content.map(renderListItem).join('');
  switch (node.attrs.style) {
    case 'bullet':
      return `<ul>${items}</ul>`;
    case 'numbered':
      return `<ol>${items}</ol>`;
    case 'check':
      return `<ul class="check">${items}</ul>`;
    default: {
      const _exhaust: never = node.attrs.style;
      throw new Error(`renderList: unknown style ${JSON.stringify(_exhaust)}`);
    }
  }
}

function renderListItem(node: ListItemNode): string {
  const inner = node.content.map(renderInline).join('');
  return `<li>${inner}</li>`;
}

// ---------------------------------------------------------------------------
// Inline + marks.
// ---------------------------------------------------------------------------

function renderInline(node: InlineNode): string {
  if (node.type === 'text') {
    return renderText(node);
  }
  const _exhaust: never = node.type;
  throw new Error(`renderInline: unknown inline type ${JSON.stringify(_exhaust)}`);
}

function renderText(node: TextNode): string {
  const escaped = escText(node.text);
  if (!node.marks || node.marks.length === 0) return escaped;
  return renderMarks(escaped, node.marks);
}

function renderMarks(escapedText: string, marks: Mark[]): string {
  // Apply marks in a stable order so the output is deterministic regardless of
  // the order the marks appear on the text node. `code` short-circuits other
  // marks (per spec §1.3).
  if (marks.some((m) => m.type === 'code')) {
    return `<code>${escapedText}</code>`;
  }
  const ordered = [...marks].sort(markSortKey);
  let out = escapedText;
  for (const m of ordered) {
    out = wrapMark(out, m);
  }
  return out;
}

const MARK_ORDER: Record<Mark['type'], number> = {
  link: 0,
  bold: 1,
  italic: 2,
  underline: 3,
  highlight: 4,
  color: 5,
  code: 6,
};

function markSortKey(a: Mark, b: Mark): number {
  return MARK_ORDER[a.type] - MARK_ORDER[b.type];
}

function wrapMark(inner: string, mark: Mark): string {
  switch (mark.type) {
    case 'bold':
      return `<strong>${inner}</strong>`;
    case 'italic':
      return `<em>${inner}</em>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'code':
      return `<code>${inner}</code>`;
    case 'link': {
      const a = mark.attrs;
      const parts: string[] = [`href="${escAttr(a.href)}"`];
      if (a.target !== undefined) parts.push(`target="${escAttr(a.target)}"`);
      if (a.rel !== undefined) parts.push(`rel="${escAttr(a.rel)}"`);
      return `<a ${parts.join(' ')}>${inner}</a>`;
    }
    case 'color':
      return `<span style="color:${escAttr(mark.attrs.value)}">${inner}</span>`;
    case 'highlight':
      return `<mark style="background-color:${escAttr(mark.attrs.value)}">${inner}</mark>`;
    default: {
      const _exhaust: never = mark;
      throw new Error(`wrapMark: unknown mark ${JSON.stringify(_exhaust)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function alignClass(align: string | undefined): string {
  return align === undefined ? '' : ` class="align-${escAttr(align)}"`;
}

function widthSlug(w: string): string {
  // `1/2` -> `1-2`, `2/3` -> `2-3`. `auto` passes through.
  return w.replace(/\//g, '-');
}

function escText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(s: string): string {
  // Same set as escText: attribute values need the same five chars escaped.
  return escText(s);
}

function cssValue(s: string): string {
  // Strip anything outside a conservative CSS-safe set so injected theme
  // values cannot break out of the style attribute.
  return s.replace(/[^A-Za-z0-9 ,\-_./%#()'":]/g, '');
}
