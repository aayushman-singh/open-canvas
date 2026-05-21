// ProseMirror schema for rev01 documents.
//
// Mirrors the rev01 document vocabulary in src/document/schema.ts exactly:
// every node and mark name matches, every attr key matches, content groups
// match. This makes ProseMirror JSON equal to rev01 DocumentJSON modulo the
// usual conventions (omitted optional attrs become `null` defaults, then get
// stripped on round-trip — see snapshot.ts).
//
// Both sides of the wire (this Worker and the TipTap editor in the browser)
// consume the same vocabulary. Adding a node or mark here requires the same
// addition in src/editor/client.ts, or the CRDT desynchronises and content
// vanishes on save/reload.

import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import {
  ACTION_VARIANTS,
  ALIGNMENTS,
  COLUMN_COUNTS,
  COLUMN_GAPS,
  COLUMN_WIDTHS,
  DIVIDER_STYLES,
  HEADING_LEVELS,
  LINK_TARGETS,
  LIST_STYLES,
  MEDIA_LOADING,
  MEDIA_TYPES,
  PADDING_SIZES,
  SECTION_KINDS,
} from '../document/schema';

// ---------------------------------------------------------------------------
// DOM element duck-type guard. The Workers runtime typings (no DOM lib) don't
// expose `Element` as a value, but parseDOM only executes in the browser where
// the global exists. The guard checks for the methods we actually call so it
// satisfies the type system without dragging in `lib.dom`.
// ---------------------------------------------------------------------------

interface DomElementLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

function isElement(dom: unknown): dom is DomElementLike {
  return (
    typeof dom === 'object' &&
    dom !== null &&
    typeof (dom as { getAttribute?: unknown }).getAttribute === 'function'
  );
}

// ---------------------------------------------------------------------------
// Attr parsers — pull from DOM nodes during parseDOM. Each returns either the
// parsed value or `null` (defaulted) when the source attribute is absent.
// ---------------------------------------------------------------------------

function attrEnum<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  if (raw === null) return null;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

function attrNumberEnum<T extends number>(raw: string | null, allowed: readonly T[]): T | null {
  if (raw === null) return null;
  const n = Number(raw);
  return (allowed as readonly number[]).includes(n) ? (n as T) : null;
}

function attrString(raw: string | null): string | null {
  return raw && raw.length > 0 ? raw : null;
}

function attrBool(raw: string | null): boolean | null {
  if (raw === null) return null;
  if (raw === 'true' || raw === '') return true;
  if (raw === 'false') return false;
  return null;
}

// ---------------------------------------------------------------------------
// Helpers — drop entries with null values from a renderHTML attr bag so the
// emitted DOM only carries explicit attributes.
// ---------------------------------------------------------------------------

function liveAttrs(pairs: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(pairs)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      out[k] = v;
    } else if (typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
    }
  }
  return out;
}

// PM's NodeSpec/MarkSpec type node.attrs as `any`; this narrows once at the
// call site so the rest of the spec body stays type-safe.
function nodeAttrs(node: { attrs: Record<string, unknown> }): Record<string, unknown> {
  return node.attrs;
}

function markAttrs(mark: { attrs: Record<string, unknown> }): Record<string, unknown> {
  return mark.attrs;
}

// ---------------------------------------------------------------------------
// Nodes.
// ---------------------------------------------------------------------------

const nodes: Record<string, NodeSpec> = {
  doc: {
    content: 'section+',
  },

  section: {
    content: 'block+',
    group: 'section',
    defining: true,
    isolating: true,
    attrs: {
      kind: { default: 'custom' },
      surface: { default: null },
      padding: { default: null },
      bg: { default: null },
    },
    parseDOM: [
      {
        tag: 'section[data-kind]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            kind: attrEnum(dom.getAttribute('data-kind'), SECTION_KINDS) ?? 'custom',
            surface: attrString(dom.getAttribute('data-surface')),
            padding: attrEnum(dom.getAttribute('data-padding'), PADDING_SIZES),
            bg: attrString(dom.getAttribute('data-bg')),
          };
        },
      },
    ],
    toDOM: (node) => [
      'section',
      liveAttrs({
        'data-kind': nodeAttrs(node).kind,
        'data-surface': nodeAttrs(node).surface,
        'data-padding': nodeAttrs(node).padding,
        'data-bg': nodeAttrs(node).bg,
      }),
      0,
    ],
  },

  heading: {
    // `inline*` here (not `inline+`) so ProseMirror can auto-generate the node
    // during edits — text leaves are not generatable in a required position.
    // The validator enforces at-least-one inline at snapshot time; empty
    // headings make the snapshot invalid and persistSnapshot refuses the write.
    content: 'inline*',
    group: 'block',
    defining: true,
    attrs: {
      level: { default: 1 },
      align: { default: null },
    },
    parseDOM: HEADING_LEVELS.map((level) => ({
      tag: `h${level}`,
      getAttrs: (dom) => {
        if (!isElement(dom)) return false;
        return {
          level,
          align: attrEnum(dom.getAttribute('data-align'), ALIGNMENTS),
        };
      },
    })),
    toDOM: (node) => [
      `h${String(nodeAttrs(node).level)}`,
      liveAttrs({ 'data-align': nodeAttrs(node).align }),
      0,
    ],
  },

  paragraph: {
    content: 'inline*',
    group: 'block',
    attrs: {
      align: { default: null },
    },
    parseDOM: [
      {
        tag: 'p',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            align: attrEnum(dom.getAttribute('data-align'), ALIGNMENTS),
          };
        },
      },
    ],
    toDOM: (node) => ['p', liveAttrs({ 'data-align': nodeAttrs(node).align }), 0],
  },

  media: {
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    attrs: {
      src: { default: '' },
      mediaType: { default: 'image' },
      alt: { default: null },
      aspectRatio: { default: null },
      loading: { default: null },
    },
    parseDOM: [
      {
        tag: 'figure[data-media-type]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            src: attrString(dom.getAttribute('data-src')) ?? '',
            mediaType: attrEnum(dom.getAttribute('data-media-type'), MEDIA_TYPES) ?? 'image',
            alt: attrString(dom.getAttribute('data-alt')),
            aspectRatio: attrString(dom.getAttribute('data-aspect-ratio')),
            loading: attrEnum(dom.getAttribute('data-loading'), MEDIA_LOADING),
          };
        },
      },
    ],
    toDOM: (node) => [
      'figure',
      liveAttrs({
        'data-media-type': nodeAttrs(node).mediaType,
        'data-src': nodeAttrs(node).src,
        'data-alt': nodeAttrs(node).alt,
        'data-aspect-ratio': nodeAttrs(node).aspectRatio,
        'data-loading': nodeAttrs(node).loading,
      }),
    ],
  },

  actions: {
    content: 'action+',
    group: 'block',
    attrs: {
      align: { default: null },
    },
    parseDOM: [
      {
        tag: 'div[data-actions]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            align: attrEnum(dom.getAttribute('data-align'), ALIGNMENTS),
          };
        },
      },
    ],
    toDOM: (node) => [
      'div',
      liveAttrs({ 'data-actions': '', 'data-align': nodeAttrs(node).align }),
      0,
    ],
  },

  action: {
    atom: true,
    selectable: true,
    attrs: {
      href: { default: '' },
      label: { default: '' },
      variant: { default: null },
      newTab: { default: null },
    },
    parseDOM: [
      {
        tag: 'a[data-action]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            href: attrString(dom.getAttribute('href')) ?? '',
            label: dom.textContent ?? '',
            variant: attrEnum(dom.getAttribute('data-variant'), ACTION_VARIANTS),
            newTab: attrBool(dom.getAttribute('data-new-tab')),
          };
        },
      },
    ],
    toDOM: (node) => [
      'a',
      liveAttrs({
        'data-action': '',
        href: nodeAttrs(node).href,
        'data-variant': nodeAttrs(node).variant,
        'data-new-tab': nodeAttrs(node).newTab,
      }),
      typeof nodeAttrs(node).label === 'string' ? (nodeAttrs(node).label as string) : '',
    ],
  },

  columns: {
    content: 'column+',
    group: 'block',
    attrs: {
      count: { default: 2 },
      gap: { default: null },
    },
    parseDOM: [
      {
        tag: 'div[data-columns]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            count: attrNumberEnum(dom.getAttribute('data-count'), COLUMN_COUNTS) ?? 2,
            gap: attrEnum(dom.getAttribute('data-gap'), COLUMN_GAPS),
          };
        },
      },
    ],
    toDOM: (node) => [
      'div',
      liveAttrs({
        'data-columns': '',
        'data-count': nodeAttrs(node).count,
        'data-gap': nodeAttrs(node).gap,
      }),
      0,
    ],
  },

  column: {
    content: 'block+',
    attrs: {
      width: { default: null },
      align: { default: null },
    },
    parseDOM: [
      {
        tag: 'div[data-column]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            width: attrEnum(dom.getAttribute('data-width'), COLUMN_WIDTHS),
            align: attrEnum(dom.getAttribute('data-align'), ALIGNMENTS),
          };
        },
      },
    ],
    toDOM: (node) => [
      'div',
      liveAttrs({
        'data-column': '',
        'data-width': nodeAttrs(node).width,
        'data-align': nodeAttrs(node).align,
      }),
      0,
    ],
  },

  divider: {
    group: 'block',
    atom: true,
    selectable: true,
    attrs: {
      style: { default: null },
    },
    parseDOM: [
      {
        tag: 'hr[data-divider]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            style: attrEnum(dom.getAttribute('data-divider'), DIVIDER_STYLES),
          };
        },
      },
    ],
    toDOM: (node) => ['hr', liveAttrs({ 'data-divider': nodeAttrs(node).style ?? 'line' })],
  },

  list: {
    content: 'listItem+',
    group: 'block',
    attrs: {
      style: { default: 'bullet' },
    },
    parseDOM: [
      {
        tag: 'ul[data-list-style], ol[data-list-style]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            style: attrEnum(dom.getAttribute('data-list-style'), LIST_STYLES) ?? 'bullet',
          };
        },
      },
    ],
    toDOM: (node) => {
      const tag = nodeAttrs(node).style === 'numbered' ? 'ol' : 'ul';
      return [tag, liveAttrs({ 'data-list-style': nodeAttrs(node).style }), 0];
    },
  },

  listItem: {
    // Same as heading — relax to `inline*` for PM generatability, enforce
    // non-empty at validate time.
    content: 'inline*',
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },

  text: {
    group: 'inline',
  },
};

// ---------------------------------------------------------------------------
// Marks.
// ---------------------------------------------------------------------------

const marks: Record<string, MarkSpec> = {
  bold: {
    parseDOM: [{ tag: 'strong' }, { tag: 'b' }, { style: 'font-weight=bold' }],
    toDOM: () => ['strong', 0],
  },
  italic: {
    parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }],
    toDOM: () => ['u', 0],
  },
  code: {
    excludes: '_',
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  link: {
    inclusive: false,
    attrs: {
      href: { default: '' },
      target: { default: null },
      rel: { default: null },
    },
    parseDOM: [
      {
        tag: 'a[href]:not([data-action])',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return {
            href: attrString(dom.getAttribute('href')) ?? '',
            target: attrEnum(dom.getAttribute('target'), LINK_TARGETS),
            rel: attrString(dom.getAttribute('rel')),
          };
        },
      },
    ],
    toDOM: (mark) => [
      'a',
      liveAttrs({
        href: markAttrs(mark).href,
        target: markAttrs(mark).target,
        rel: markAttrs(mark).rel,
      }),
      0,
    ],
  },
  color: {
    attrs: {
      value: { default: '' },
    },
    parseDOM: [
      {
        tag: 'span[data-color]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return { value: attrString(dom.getAttribute('data-color')) ?? '' };
        },
      },
    ],
    toDOM: (mark) => [
      'span',
      liveAttrs({
        'data-color': markAttrs(mark).value,
        style: `color:${String(markAttrs(mark).value)}`,
      }),
      0,
    ],
  },
  highlight: {
    attrs: {
      value: { default: '' },
    },
    parseDOM: [
      {
        tag: 'mark[data-highlight]',
        getAttrs: (dom) => {
          if (!isElement(dom)) return false;
          return { value: attrString(dom.getAttribute('data-highlight')) ?? '' };
        },
      },
    ],
    toDOM: (mark) => [
      'mark',
      liveAttrs({
        'data-highlight': markAttrs(mark).value,
        style: `background-color:${String(markAttrs(mark).value)}`,
      }),
      0,
    ],
  },
};

export const pmSchema = new Schema({ nodes, marks });

export const Y_XML_FRAGMENT_NAME = 'default';
