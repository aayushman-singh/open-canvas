// src/document/schema.ts
//
// Source of truth for the rev01 document vocabulary.
//
// Defines the JSON shape of a page document (root `doc` -> sections -> blocks
// -> inlines), the mark vocabulary, and a structural registry (`NODE_SCHEMA`)
// keyed by node type. The renderer and validator consume the same definitions
// here; TipTap (task #8) and the agent tool surface (task #9) will derive their
// runtime schemas from these declarations as well.
//
// Spec: docs/specs/template-schema.md §1.
//
// No runtime imports. Pure types + const data.

// ---------------------------------------------------------------------------
// Enumerated values (single source of truth for validator + agent tool defs).
// ---------------------------------------------------------------------------

export const SECTION_KINDS = [
  'hero',
  'feature',
  'pricing',
  'gallery',
  'cta',
  'footer',
  'custom',
] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const PADDING_SIZES = ['sm', 'md', 'lg'] as const;
export type PaddingSize = (typeof PADDING_SIZES)[number];

export const ALIGNMENTS = ['start', 'center', 'end'] as const;
export type Alignment = (typeof ALIGNMENTS)[number];

export const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
export type HeadingLevel = (typeof HEADING_LEVELS)[number];

export const MEDIA_TYPES = ['image', 'video', 'iframe'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_LOADING = ['lazy', 'eager'] as const;
export type MediaLoading = (typeof MEDIA_LOADING)[number];

export const ACTION_VARIANTS = ['primary', 'secondary', 'ghost'] as const;
export type ActionVariant = (typeof ACTION_VARIANTS)[number];

export const COLUMN_COUNTS = [2, 3, 4] as const;
export type ColumnCount = (typeof COLUMN_COUNTS)[number];

export const COLUMN_GAPS = ['sm', 'md', 'lg'] as const;
export type ColumnGap = (typeof COLUMN_GAPS)[number];

export const COLUMN_WIDTHS = ['auto', '1/2', '1/3', '2/3', '1/4', '3/4'] as const;
export type ColumnWidth = (typeof COLUMN_WIDTHS)[number];

export const DIVIDER_STYLES = ['line', 'dot', 'space'] as const;
export type DividerStyle = (typeof DIVIDER_STYLES)[number];

export const LIST_STYLES = ['bullet', 'numbered', 'check'] as const;
export type ListStyle = (typeof LIST_STYLES)[number];

export const LINK_TARGETS = ['_self', '_blank'] as const;
export type LinkTarget = (typeof LINK_TARGETS)[number];

// Common rel tokens permitted on link marks. The validator accepts any
// whitespace-separated subset of these.
export const LINK_RELS = ['noopener', 'noreferrer', 'nofollow', 'sponsored', 'ugc'] as const;
export type LinkRel = (typeof LINK_RELS)[number];

// Embed allowlist — exact host or subdomain match. Spec §5.
export const EMBED_ALLOWLIST = [
  'youtube.com',
  'vimeo.com',
  'loom.com',
  'codesandbox.io',
  'figma.com',
] as const;
export type EmbedHost = (typeof EMBED_ALLOWLIST)[number];

// ---------------------------------------------------------------------------
// Marks.
// ---------------------------------------------------------------------------

export interface BoldMark {
  type: 'bold';
}
export interface ItalicMark {
  type: 'italic';
}
export interface UnderlineMark {
  type: 'underline';
}
export interface CodeMark {
  type: 'code';
}
export interface LinkMark {
  type: 'link';
  attrs: {
    href: string;
    target?: LinkTarget;
    rel?: string; // space-separated list of LINK_RELS
  };
}
export interface ColorMark {
  type: 'color';
  attrs: { value: string }; // theme-token ref or hex
}
export interface HighlightMark {
  type: 'highlight';
  attrs: { value: string }; // theme-token ref or hex
}

export type Mark =
  | BoldMark
  | ItalicMark
  | UnderlineMark
  | CodeMark
  | LinkMark
  | ColorMark
  | HighlightMark;

export const MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'code',
  'link',
  'color',
  'highlight',
] as const;
export type MarkType = (typeof MARK_TYPES)[number];

// `code` excludes all other marks (spec §1.3).
export const MARK_EXCLUSIONS: Record<MarkType, readonly MarkType[]> = {
  bold: [],
  italic: [],
  underline: [],
  code: ['bold', 'italic', 'underline', 'link', 'color', 'highlight'],
  link: [],
  color: [],
  highlight: [],
};

// ---------------------------------------------------------------------------
// Inline nodes.
// ---------------------------------------------------------------------------

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export type InlineNode = TextNode;

// ---------------------------------------------------------------------------
// Block nodes.
// ---------------------------------------------------------------------------

export interface HeadingNode {
  type: 'heading';
  attrs: {
    level: HeadingLevel;
    align?: Alignment;
  };
  content: InlineNode[];
}

export interface ParagraphNode {
  type: 'paragraph';
  attrs?: {
    align?: Alignment;
  };
  content?: InlineNode[];
}

export interface MediaNode {
  type: 'media';
  attrs: {
    src: string;
    mediaType: MediaType;
    alt?: string;
    aspectRatio?: string; // e.g. "16/9"
    loading?: MediaLoading;
  };
}

export interface ActionNode {
  type: 'action';
  attrs: {
    href: string;
    label: string;
    variant?: ActionVariant;
    newTab?: boolean;
  };
}

export interface ActionsNode {
  type: 'actions';
  attrs?: {
    align?: Alignment;
  };
  content: ActionNode[];
}

export interface ColumnNode {
  type: 'column';
  attrs?: {
    width?: ColumnWidth;
    align?: Alignment;
  };
  content: BlockNode[];
}

export interface ColumnsNode {
  type: 'columns';
  attrs: {
    count: ColumnCount;
    gap?: ColumnGap;
  };
  content: ColumnNode[];
}

export interface DividerNode {
  type: 'divider';
  attrs?: {
    style?: DividerStyle;
  };
}

export interface ListItemNode {
  type: 'listItem';
  content: InlineNode[];
}

export interface ListNode {
  type: 'list';
  attrs: {
    style: ListStyle;
  };
  content: ListItemNode[];
}

export type BlockNode =
  | HeadingNode
  | ParagraphNode
  | MediaNode
  | ActionsNode
  | ColumnsNode
  | DividerNode
  | ListNode;

// ---------------------------------------------------------------------------
// Section + root.
// ---------------------------------------------------------------------------

export interface SectionNode {
  type: 'section';
  attrs: {
    kind: SectionKind;
    surface?: string;
    padding?: PaddingSize;
    bg?: string;
  };
  content: BlockNode[];
}

export interface DocumentJSON {
  type: 'doc';
  content: SectionNode[];
}

export type AnyNode =
  | DocumentJSON
  | SectionNode
  | BlockNode
  | ActionNode
  | ColumnNode
  | ListItemNode
  | InlineNode;

// ---------------------------------------------------------------------------
// Theme tokens (spec §2).
// ---------------------------------------------------------------------------

export type ThemeRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';
export type ThemeDensity = 'compact' | 'normal' | 'comfortable';

export interface ThemeTokenSet {
  paletteSeed: string; // OKLCH-ready hex
  font: { heading: string; body: string };
  radius: ThemeRadius;
  density: ThemeDensity;
}

// ---------------------------------------------------------------------------
// Node schema registry.
//
// Used by the validator and by future agent tool-use definitions. Required +
// optional attrs are listed verbatim from the spec table; `children` describes
// the allowed content group.
// ---------------------------------------------------------------------------

export type NodeType =
  | 'doc'
  | 'section'
  | 'heading'
  | 'paragraph'
  | 'media'
  | 'actions'
  | 'action'
  | 'columns'
  | 'column'
  | 'divider'
  | 'list'
  | 'listItem'
  | 'text';

export type ChildrenRule =
  | 'section+'
  | 'block+'
  | 'inline+'
  | 'inline*'
  | 'action+'
  | 'column+'
  | 'listItem+'
  | 'none';

export interface NodeSchemaEntry {
  required: readonly string[];
  optional: readonly string[];
  children: ChildrenRule;
}

export const NODE_SCHEMA: Record<NodeType, NodeSchemaEntry> = {
  doc: {
    required: [],
    optional: [],
    children: 'section+',
  },
  section: {
    required: ['kind'],
    optional: ['surface', 'padding', 'bg'],
    children: 'block+',
  },
  heading: {
    required: ['level'],
    optional: ['align'],
    children: 'inline+',
  },
  paragraph: {
    required: [],
    optional: ['align'],
    children: 'inline*',
  },
  media: {
    required: ['src', 'mediaType'],
    optional: ['alt', 'aspectRatio', 'loading'],
    children: 'none',
  },
  actions: {
    required: [],
    optional: ['align'],
    children: 'action+',
  },
  action: {
    required: ['href', 'label'],
    optional: ['variant', 'newTab'],
    children: 'none',
  },
  columns: {
    required: ['count'],
    optional: ['gap'],
    children: 'column+',
  },
  column: {
    required: [],
    optional: ['width', 'align'],
    children: 'block+',
  },
  divider: {
    required: [],
    optional: ['style'],
    children: 'none',
  },
  list: {
    required: ['style'],
    optional: [],
    children: 'listItem+',
  },
  listItem: {
    required: [],
    optional: [],
    children: 'inline+',
  },
  text: {
    required: ['text'],
    optional: ['marks'],
    children: 'none',
  },
};

export const BLOCK_NODE_TYPES = [
  'heading',
  'paragraph',
  'media',
  'actions',
  'columns',
  'divider',
  'list',
] as const satisfies readonly NodeType[];

export const INLINE_NODE_TYPES = ['text'] as const satisfies readonly NodeType[];

export const ALL_NODE_TYPES = Object.keys(NODE_SCHEMA) as NodeType[];
