// src/agent/canvas-tools.ts
//
// LLM tool definitions for the canvas AI flow (T7). The agent gets mutating
// tools for:
//
//   - `rewriteText` — replace the inline runs of a text element.
//   - `replaceMedia` — swap a media element's asset id (LLM picks an
//     EXISTING uploaded asset; the tool does not generate bytes).
//   - `designSection` — create a section from a semantic layout tree; the
//     LLM describes structure while the layout engine computes geometry.
//   - Element, section, page, Style Kit, and site-config edits.
//
// Each schema is tight: marks and design tokens are enumerated, link hrefs
// carry the same allowlist hint the validator enforces, and descriptions
// call out the contracts the model must honour so the LLM cannot drift into
// plain strings, invented tokens, or pixel positions.

import {
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  BUILT_IN_STYLE_KITS,
  ELEMENT_TYPES,
  INLINE_MARK_TYPES,
  MEDIA_KINDS,
  MOTION_PRESETS,
  SHAPE_VARIANTS,
  SURFACE_VARIANTS,
} from '../canvas/schema.js';
import { CHART_KINDS } from '../canvas/elements/chart.js';
import { CODE_LANGUAGES } from '../canvas/elements/code.js';
import {
  COLOR_TOKENS,
  FONT_TOKENS,
  GAP_TOKENS,
  GRID_COLUMNS,
  LAYOUT_ALIGNS,
  SPLIT_RATIOS,
  STACK_DIRECTIONS,
  ELEMENT_SIZES,
} from '../canvas/layout/tree.js';
import type { JsonSchema, LlmTool } from './llm.js';

// ---------------------------------------------------------------------------
// rewriteText
// ---------------------------------------------------------------------------

// One inline mark. The `type` field discriminates the union; `href` is only
// required when type === 'link'. JsonSchema as represented in `LlmTool` does
// not support `oneOf`, so we expose a single object schema and rely on the
// description to spell out the contract. The apply function + validator
// reject invalid combinations loudly.
const inlineMarkSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline mark applied to a run of text. Valid shapes:\n' +
    '  { "type": "bold" } | { "type": "italic" } | { "type": "underline" } |\n' +
    '  { "type": "strike" } | { "type": "code" } | { "type": "highlight" } |\n' +
    '  { "type": "link", "href": "https://example.com" }\n' +
    'For link marks, `href` MUST be http:, https:, mailto:, tel:, /relative, or #anchor — javascript: and data: are rejected.',
  properties: {
    type: {
      type: 'string',
      enum: [...INLINE_MARK_TYPES],
      description: 'Mark kind. Required.',
    },
    href: {
      type: 'string',
      description:
        'Required ONLY when type=="link". http:/https:/mailto:/tel: schemes, plus /relative and #anchor, are allowed.',
    },
  },
  required: ['type'],
};

const inlineRunSchema: JsonSchema = {
  type: 'object',
  description:
    'One inline run of text. `text` is the raw run text (no HTML). `marks` carries 0..N InlineMark objects.',
  properties: {
    text: {
      type: 'string',
      description:
        'Raw text for this run. Empty string is allowed only when the run carries marks.',
    },
    marks: {
      type: 'array',
      items: inlineMarkSchema,
      description:
        'Optional. 0..N marks applied to this run. A run cannot carry two marks of the same `type`.',
    },
  },
  required: ['text'],
};

const rewriteTextSchema: JsonSchema = {
  type: 'object',
  properties: {
    elementId: {
      type: 'string',
      description: 'The id of the existing text element to rewrite. Must be present on the page.',
    },
    content: {
      type: 'array',
      items: inlineRunSchema,
      description:
        'The replacement content. MUST be an array of InlineRun objects — NEVER a plain string. ' +
        'Example: [{ "text": "Ship a site that feels " }, { "text": "lived-in", "marks": [{ "type": "bold" }] }, { "text": "." }]. ' +
        'The concatenated plain text must not be empty.',
    },
  },
  required: ['elementId', 'content'],
};

// ---------------------------------------------------------------------------
// replaceMedia
// ---------------------------------------------------------------------------

const replaceMediaSchema: JsonSchema = {
  type: 'object',
  properties: {
    elementId: {
      type: 'string',
      description: 'The id of the existing media element whose asset should be replaced.',
    },
    mediaKind: {
      type: 'string',
      enum: [...MEDIA_KINDS],
      description: 'The kind of media — must match the kind of the uploaded asset.',
    },
    assetId: {
      type: 'string',
      description:
        'The id of an EXISTING uploaded asset on this site. The model does NOT generate media bytes; ' +
        'the Owner uploads assets via the canvas API, and the model picks one of those ids.',
    },
    alt: {
      type: 'string',
      description:
        'Accessible alt text for the new asset. Empty string is acceptable for purely decorative media.',
    },
  },
  required: ['elementId', 'mediaKind', 'assetId', 'alt'],
};

// ---------------------------------------------------------------------------
// designSection
// ---------------------------------------------------------------------------

const textPropsSchema: JsonSchema = {
  type: 'object',
  description: 'Text element properties. All fields required.',
  properties: {
    content: { type: 'string', description: 'The text content. Must not be empty.' },
    role: { type: 'string', enum: ['heading', 'body', 'label'], description: 'Text role.' },
    color: {
      type: 'string',
      enum: [...COLOR_TOKENS],
      description: 'Semantic color token resolved from the active Style Kit.',
    },
    font: {
      type: 'string',
      enum: [...FONT_TOKENS],
      description: 'Semantic font token resolved from the active Style Kit.',
    },
    size: {
      type: 'number',
      minimum: 12,
      maximum: 96,
      description: 'Font size in px. Clamped to [12, 96].',
    },
  },
  required: ['content', 'role', 'color', 'font', 'size'],
};

const mediaPropsSchema: JsonSchema = {
  type: 'object',
  description: 'Media element with an image prompt for AI generation.',
  properties: {
    imagePrompt: {
      type: 'string',
      description:
        'Text description of the image to generate. Be specific about style, subject, mood.',
    },
    fit: {
      type: 'string',
      enum: ['cover', 'contain'],
      description: 'How the image fills its box.',
    },
  },
  required: ['imagePrompt', 'fit'],
};

const actionPropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: 'Button label text.' },
    variant: {
      type: 'string',
      enum: [...ACTION_VARIANTS],
      description: 'Visual style of the button.',
    },
    href: {
      type: 'string',
      description: 'Link destination. Use "#" for placeholder links.',
    },
  },
  required: ['label', 'variant', 'href'],
};

const shapePropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    variant: { type: 'string', enum: [...SHAPE_VARIANTS], description: 'Shape variant.' },
  },
  required: ['variant'],
};

const containerPropsSchema: JsonSchema = {
  type: 'object',
  properties: {
    variant: { type: 'string', enum: [...SURFACE_VARIANTS], description: 'Surface variant.' },
    padding: { type: 'number', minimum: 0, maximum: 80, description: 'Inner padding in px.' },
  },
  required: ['variant', 'padding'],
};

const layoutChildSchema: JsonSchema = {
  type: 'object',
  description:
    'A child node. Use either a nested layout node (type + children) or an element leaf (element + optional size). ' +
    'For element leaves, exactly one of text/action/shape/container must match element.type.',
  properties: {
    type: {
      type: 'string',
      enum: ['stack', 'grid', 'split'],
      description: 'Nested layout node type when this child is a layout node.',
    },
    children: {
      type: 'array',
      description: 'Nested child nodes when this child is a layout node.',
    },
    element: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['text', 'action', 'shape', 'container'],
          description: 'Element type. Must match exactly one of the property objects below.',
        },
        text: textPropsSchema,
        media: mediaPropsSchema,
        action: actionPropsSchema,
        shape: shapePropsSchema,
        container: containerPropsSchema,
      },
      required: ['type'],
    },
    size: {
      type: 'string',
      enum: [...ELEMENT_SIZES],
      description:
        '"hug" = use intrinsic size (default for most elements). "fill" = expand to fill remaining space. ' +
        'Container elements with "fill" become background panels spanning the parent layout node.',
    },
  },
  required: ['element'],
};

// LayoutNode is recursive (children can be LayoutNode | ElementNode).
// JSON Schema `$ref` is not in the LlmTool subset, so we inline a single
// level of nesting and rely on the description to explain deeper nesting.
const layoutNodeSchema: JsonSchema = {
  type: 'object',
  description:
    'A layout node that positions its children. Types:\n' +
    '  stack — sequential layout (row or column) with gap and alignment.\n' +
    '  grid — equal-width columns (2, 3, or 4).\n' +
    '  split — two children divided at a ratio (1:1, 1:2, 2:1).\n' +
    'Children can be element nodes OR nested layout nodes (for complex layouts like a grid of stacks).',
  properties: {
    type: {
      type: 'string',
      enum: ['stack', 'grid', 'split'],
      description: 'Layout type.',
    },
    direction: {
      type: 'string',
      enum: [...STACK_DIRECTIONS],
      description: 'Stack direction. Only used when type="stack". Default: "column".',
    },
    gap: {
      type: 'string',
      enum: [...GAP_TOKENS],
      description:
        'Spacing between children. tight=12px, normal=24px, loose=48px. Default: "normal".',
    },
    align: {
      type: 'string',
      enum: [...LAYOUT_ALIGNS],
      description:
        'Cross-axis alignment. Affects text alignment within children. Default: "start".',
    },
    columns: {
      type: 'number',
      enum: [...GRID_COLUMNS],
      description: 'Number of columns. Only used when type="grid". Default: 3.',
    },
    ratio: {
      type: 'string',
      enum: [...SPLIT_RATIOS],
      description: 'Width ratio between two children. Only used when type="split". Default: "1:1".',
    },
    children: {
      type: 'array',
      items: layoutChildSchema,
      description:
        'Child nodes — each is either an element node (has "element" key) or a nested layout node (has "type" key with stack/grid/split).',
    },
  },
  required: ['type', 'children'],
};

const designSectionSchema: JsonSchema = {
  type: 'object',
  properties: {
    sectionName: {
      type: 'string',
      description: 'Human-readable section name (e.g. "Hero", "Pricing", "Testimonials").',
    },
    height: {
      type: 'number',
      minimum: 240,
      maximum: 1200,
      description: 'Section height in px. Default: 720. Clamped to [240, 1200].',
    },
    backgroundEffect: {
      type: 'string',
      enum: [...BACKGROUND_EFFECTS],
      description: 'Optional background visual effect.',
    },
    entrance: {
      type: 'string',
      enum: [...MOTION_PRESETS],
      description: 'Optional entrance animation preset.',
    },
    afterSectionId: {
      type: 'string',
      description:
        'The id of the section after which to insert this new section. ' +
        'Empty string or omitted = append at the end of the page.',
    },
    layout: layoutNodeSchema,
  },
  required: ['sectionName', 'layout'],
};

// ---------------------------------------------------------------------------
// Exported tool set
// ---------------------------------------------------------------------------

export const CANVAS_AGENT_TOOLS: LlmTool[] = [
  {
    name: 'rewriteText',
    description:
      'Replace the inline runs of an existing text element. The replacement MUST be an InlineRun[] ' +
      '(array of { text, marks? } objects) — never a plain string. The concatenated plain text must not be empty.',
    parameters: rewriteTextSchema,
  },
  {
    name: 'replaceMedia',
    description:
      "Replace a media element's asset with an EXISTING uploaded asset id. " +
      'The model picks an asset that has already been uploaded to the site; this tool does NOT generate media bytes.',
    parameters: replaceMediaSchema,
  },
  {
    name: 'designSection',
    description:
      'Design a new section from scratch using a semantic layout tree. Describe the structure ' +
      'as nested stack/grid/split nodes with element leaves. The layout engine computes positions; ' +
      'output is previewed before applying. Use this for any new section shape. ' +
      'Do not include media leaves until image generation is wired into this preview flow.',
    parameters: designSectionSchema,
  },

  // -------------------------------------------------------------------------
  // deleteElement
  // -------------------------------------------------------------------------
  {
    name: 'deleteElement',
    description:
      'Remove a content element from its section. Pass the element ID. Cannot be undone within the agent turn.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'The ID of the element to delete.' },
      },
      required: ['elementId'],
    },
  },

  // -------------------------------------------------------------------------
  // updateElement
  // -------------------------------------------------------------------------
  {
    name: 'updateElement',
    description:
      'Update properties of an existing content element. You MUST pass elementType matching the element\'s actual type — a mismatch is rejected. Only include the fields you want to change. Use rewriteText instead for changing text content with inline marks.',
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'The ID of the element to update.' },
        elementType: {
          type: 'string',
          enum: [...ELEMENT_TYPES],
          description: 'The element\'s current type. Must match the actual type — acts as a validation gate.',
        },
        // -- Shared BaseElement fields --
        box: {
          type: 'object',
          description: 'Partial position/size update. Only include fields you want to change.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
            z: { type: 'number' },
            rotation: { type: 'number' },
          },
        },
        motion: {
          type: 'object',
          description: 'Animation preset for this element.',
          properties: {
            preset: { type: 'string', enum: [...MOTION_PRESETS] },
            delayMs: { type: 'number' },
          },
        },
        // -- Text fields --
        fontSize: { type: 'number', description: 'Font size in px (12-96). Text elements only.' },
        fontWeight: {
          type: 'number',
          description: 'Font weight (400, 500, 600, 700). Text elements only.',
        },
        align: {
          type: 'string',
          enum: ['left', 'center', 'right'],
          description: 'Text alignment. Text elements only.',
        },
        role: {
          type: 'string',
          enum: ['heading', 'body', 'label'],
          description: 'Semantic role. Text elements only.',
        },
        // -- Media fields --
        fit: {
          type: 'string',
          enum: ['cover', 'contain'],
          description: 'Media fit mode. Media elements only.',
        },
        alt: { type: 'string', description: 'Alt text. Media elements only.' },
        assetId: {
          type: 'string',
          description:
            'Asset ID to display. Media elements only. Must be an existing uploaded asset.',
        },
        mediaKind: {
          type: 'string',
          enum: [...MEDIA_KINDS],
          description: 'Media kind. Media elements only.',
        },
        // -- Action fields --
        label: { type: 'string', description: 'Button label text. Action elements only.' },
        href: {
          type: 'string',
          description:
            'Button link URL. Action elements only. Must be http/https/mailto/tel or a relative path.',
        },
        variant: {
          type: 'string',
          description:
            'Visual variant. For action: button style. For shape: shape type. For container: surface style.',
          enum: [...new Set([...ACTION_VARIANTS, ...SHAPE_VARIANTS, ...SURFACE_VARIANTS])],
        },
        // -- Chart fields --
        kind: {
          type: 'string',
          enum: [...CHART_KINDS],
          description: 'Chart type. Chart elements only.',
        },
        showLegend: { type: 'boolean', description: 'Show chart legend. Chart elements only.' },
        series: {
          type: 'array',
          description: 'Chart data series. Chart elements only.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              values: { type: 'array', items: { type: 'number' } },
            },
            required: ['label', 'values'],
          },
        },
        categories: {
          type: 'array',
          description: 'Chart category labels. Chart elements only.',
          items: { type: 'string' },
        },
        // -- Code fields --
        language: {
          type: 'string',
          enum: [...CODE_LANGUAGES],
          description: 'Programming language. Code elements only.',
        },
        source: { type: 'string', description: 'Source code content. Code elements only.' },
        showLineNumbers: {
          type: 'boolean',
          description: 'Show line numbers. Code elements only.',
        },
        // -- Form fields --
        submitLabel: {
          type: 'string',
          description: 'Submit button text. Form elements only.',
        },
        successMessage: {
          type: 'string',
          description: 'Message shown after submission. Form elements only.',
        },
        // -- Embed fields --
        url: {
          type: 'string',
          description: 'Embed URL (YouTube, Vimeo, etc). Embed elements only.',
        },
        title: { type: 'string', description: 'Embed title. Embed elements only.' },
        aspectRatio: {
          type: 'number',
          description: 'Embed aspect ratio (default 16/9). Embed elements only.',
        },
        // -- Accordion fields --
        allowMultipleOpen: {
          type: 'boolean',
          description: 'Allow multiple accordion items open. Accordion elements only.',
        },
        // -- Carousel fields --
        showArrows: {
          type: 'boolean',
          description: 'Show navigation arrows. Carousel elements only.',
        },
        showDots: {
          type: 'boolean',
          description: 'Show dot pagination. Carousel elements only.',
        },
        // -- Table fields --
        zebra: {
          type: 'boolean',
          description: 'Alternating row colors. Table elements only.',
        },
        collapseOnPhone: {
          type: 'boolean',
          description: 'Collapse to card layout on phone. Table elements only.',
        },
        // -- Nav fields --
        sticky: { type: 'boolean', description: 'Sticky positioning. Nav elements only.' },
        layout: {
          type: 'string',
          enum: ['left-center-right', 'left-right'],
          description: 'Nav layout. Nav elements only.',
        },
      },
      required: ['elementId', 'elementType'],
    },
  },

  // -------------------------------------------------------------------------
  // addElement
  // -------------------------------------------------------------------------
  {
    name: 'addElement',
    description:
      'Add a new content element to an existing section. The element is placed below existing content by default. Provide box to override positioning. For creating whole new sections with layout, use designSection instead.',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'The section to add the element to.' },
        elementType: {
          type: 'string',
          enum: [...ELEMENT_TYPES],
          description: 'The type of element to create.',
        },
        box: {
          type: 'object',
          description:
            'Optional explicit positioning. If omitted, element is auto-placed below existing content.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
          required: ['x', 'y', 'w', 'h'],
        },
        // Text
        content: {
          type: 'array',
          description: 'Text content as InlineRun[]. Required for text elements.',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              marks: { type: 'array', items: { type: 'object' } },
            },
            required: ['text'],
          },
        },
        role: { type: 'string', enum: ['heading', 'body', 'label'] },
        fontSize: { type: 'number' },
        fontWeight: { type: 'number' },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
        // Media
        assetId: {
          type: 'string',
          description: 'Existing uploaded asset ID. Required for media elements.',
        },
        mediaKind: { type: 'string', enum: [...MEDIA_KINDS] },
        alt: { type: 'string' },
        fit: { type: 'string', enum: ['cover', 'contain'] },
        // Action
        label: { type: 'string', description: 'Button label. Required for action elements.' },
        href: { type: 'string', description: 'Button link URL.' },
        variant: {
          type: 'string',
          enum: [...new Set([...ACTION_VARIANTS, ...SHAPE_VARIANTS, ...SURFACE_VARIANTS])],
        },
        // Chart
        kind: { type: 'string', enum: [...CHART_KINDS] },
        series: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              values: { type: 'array', items: { type: 'number' } },
            },
            required: ['label', 'values'],
          },
        },
        categories: { type: 'array', items: { type: 'string' } },
        showLegend: { type: 'boolean' },
        // Code
        language: { type: 'string', enum: [...CODE_LANGUAGES] },
        source: { type: 'string' },
        showLineNumbers: { type: 'boolean' },
        // Form
        fields: {
          type: 'array',
          description: 'Form field definitions. Required for form elements.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['text', 'email', 'textarea', 'checkbox', 'select'],
              },
              required: { type: 'boolean' },
              placeholder: { type: 'string' },
            },
            required: ['id', 'label', 'kind', 'required'],
          },
        },
        submitLabel: { type: 'string' },
        successMessage: { type: 'string' },
        // Embed
        url: { type: 'string' },
        title: { type: 'string' },
        aspectRatio: { type: 'number' },
        // Accordion
        items: {
          type: 'array',
          description: 'Accordion items. Required for accordion elements.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              body: { type: 'array', items: { type: 'object' } },
            },
            required: ['id', 'title', 'body'],
          },
        },
        allowMultipleOpen: { type: 'boolean' },
        // Carousel
        slides: {
          type: 'array',
          description: 'Carousel slides. Required for carousel elements.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              assetId: { type: 'string' },
              caption: { type: 'string' },
            },
            required: ['id', 'assetId'],
          },
        },
        showArrows: { type: 'boolean' },
        showDots: { type: 'boolean' },
        // Table
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              header: { type: 'string' },
              align: { type: 'string', enum: ['left', 'center', 'right'] },
            },
            required: ['id', 'header'],
          },
        },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              cells: { type: 'object' },
            },
            required: ['id', 'cells'],
          },
        },
        zebra: { type: 'boolean' },
        collapseOnPhone: { type: 'boolean' },
        // Nav
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              href: { type: 'string' },
              kind: { type: 'string', enum: ['internal', 'external'] },
            },
            required: ['label', 'href', 'kind'],
          },
        },
        layout: { type: 'string', enum: ['left-center-right', 'left-right'] },
        sticky: { type: 'boolean' },
        logoAssetId: { type: 'string' },
      },
      required: ['sectionId', 'elementType'],
    },
  },

  // -------------------------------------------------------------------------
  // updateSection
  // -------------------------------------------------------------------------
  {
    name: 'updateSection',
    description:
      'Update properties of an existing canvas section (name, height, background effect, entrance animation).',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'The ID of the section to update.' },
        name: { type: 'string', description: 'Section display name.' },
        height: { type: 'number', description: 'Section height in pixels (240-1200).' },
        backgroundEffect: {
          type: 'string',
          enum: [...BACKGROUND_EFFECTS],
          description: 'Background visual effect.',
        },
        entrance: {
          type: 'string',
          enum: [...MOTION_PRESETS],
          description: 'Entrance animation preset.',
        },
      },
      required: ['sectionId'],
    },
  },

  // -------------------------------------------------------------------------
  // deleteSection
  // -------------------------------------------------------------------------
  {
    name: 'deleteSection',
    description:
      'Remove a section from the page. Cannot delete the last section on a page. Can delete header and footer sections (removes them site-wide).',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'The ID of the section to delete.' },
      },
      required: ['sectionId'],
    },
  },

  // -------------------------------------------------------------------------
  // moveSection
  // -------------------------------------------------------------------------
  {
    name: 'moveSection',
    description:
      'Move a body section to a new position on its page. Pass afterSectionId to place it after a specific section, or empty string to move it to the top of the page. Cannot move header or footer sections.',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'The ID of the section to move.' },
        afterSectionId: {
          type: 'string',
          description: 'Place after this section ID. Empty string = move to top of page.',
        },
      },
      required: ['sectionId', 'afterSectionId'],
    },
  },

  // -------------------------------------------------------------------------
  // duplicateSection
  // -------------------------------------------------------------------------
  {
    name: 'duplicateSection',
    description:
      'Create a copy of an existing body section with new IDs. The copy is inserted immediately after the original. Cannot duplicate header or footer sections.',
    parameters: {
      type: 'object',
      properties: {
        sectionId: { type: 'string', description: 'The ID of the section to duplicate.' },
      },
      required: ['sectionId'],
    },
  },

  // -------------------------------------------------------------------------
  // addPage
  // -------------------------------------------------------------------------
  {
    name: 'addPage',
    description:
      'Create a new page on the site with a title and URL slug. The page starts with one blank section.',
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Page display title (also used for SEO <title>).',
        },
        slug: {
          type: 'string',
          description: 'URL slug (e.g. "about", "contact"). Lowercase, no spaces.',
        },
      },
      required: ['title', 'slug'],
    },
  },

  // -------------------------------------------------------------------------
  // updatePage
  // -------------------------------------------------------------------------
  {
    name: 'updatePage',
    description:
      'Update page properties including title, slug, and SEO metadata. Only include fields you want to change.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'The ID of the page to update.' },
        title: { type: 'string', description: 'Page title.' },
        slug: { type: 'string', description: 'URL slug.' },
        description: { type: 'string', description: 'SEO meta description.' },
        ogImageAssetId: {
          type: 'string',
          description: 'Asset ID for the Open Graph image.',
        },
        canonical: { type: 'string', description: 'Canonical URL.' },
        noIndex: {
          type: 'boolean',
          description: 'When true, tells search engines not to index this page.',
        },
        locale: {
          type: 'string',
          description: 'BCP-47 locale code (e.g. "en", "fr", "ar").',
        },
        publishedDate: {
          type: 'string',
          description: 'Publication date (ISO 8601 string).',
        },
        author: { type: 'string', description: 'Author name.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Content tags.' },
        category: { type: 'string', description: 'Content category.' },
      },
      required: ['pageId'],
    },
  },

  // -------------------------------------------------------------------------
  // deletePage
  // -------------------------------------------------------------------------
  {
    name: 'deletePage',
    description: 'Remove a page from the site. Cannot delete the last page.',
    parameters: {
      type: 'object',
      properties: {
        pageId: { type: 'string', description: 'The ID of the page to delete.' },
      },
      required: ['pageId'],
    },
  },

  // -------------------------------------------------------------------------
  // setStyleKit
  // -------------------------------------------------------------------------
  {
    name: 'setStyleKit',
    description:
      'Switch the site\'s visual theme to one of the built-in style kits. This restyles the entire site without changing content.',
    parameters: {
      type: 'object',
      properties: {
        styleKit: {
          type: 'string',
          enum: [...BUILT_IN_STYLE_KITS],
          description:
            'The style kit to apply: charcoal (modern dark), orange-editorial (warm print-inspired), blue-saas (corporate blue), green-organic (natural warm).',
        },
      },
      required: ['styleKit'],
    },
  },

  // -------------------------------------------------------------------------
  // setSiteConfig
  // -------------------------------------------------------------------------
  {
    name: 'setSiteConfig',
    description:
      'Update site-level configuration flags. Only include fields you want to change.',
    parameters: {
      type: 'object',
      properties: {
        darkModeEnabled: {
          type: 'boolean',
          description: 'Enable visitor dark/light mode toggle on published site.',
        },
        defaultLocale: {
          type: 'string',
          description: 'Default BCP-47 locale for the site (e.g. "en", "fr").',
        },
        siteNoIndex: {
          type: 'boolean',
          description:
            'When true, tells search engines not to index any page on this site.',
        },
      },
    },
  },
];
