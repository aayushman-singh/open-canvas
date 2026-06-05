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
  MOTION_PRESETS,
  SHAPE_VARIANTS,
  SURFACE_VARIANTS,
} from '../canvas/schema.js';
import { AGENT_TOOL_DISPATCH } from '../canvas/elements/index.js';
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
// Per-element schema fragment merger (ADR 0011 Step 2 cutover)
// ---------------------------------------------------------------------------
//
// `updateElement` and `addElement` advertise the union of every element
// type's editable fields. The shape used to live inline (one giant
// "X elements only"-annotated bag per tool). It now comes from
// `AGENT_TOOL_DISPATCH` — each per-element module contributes its own
// `patchProperties`; this merger unions them.
//
// When two specs claim the same field name AND both schemas have `enum`s
// (e.g. `variant` across shape/container/action), the merger unions the
// enums and concatenates the descriptions so the LLM sees every per-type
// meaning. Non-enum collisions keep the first declarer's shape — the
// `agent-tool-dispatch:smoke` check on no-shape-leakage catches surprising
// new collisions at build time.
function mergeAgentPatchProperties(): Record<string, JsonSchema> {
  const merged: Record<string, JsonSchema> = {};
  for (const spec of Object.values(AGENT_TOOL_DISPATCH)) {
    for (const [name, schema] of Object.entries(spec.patchProperties)) {
      const existing = merged[name];
      if (existing === undefined) {
        merged[name] = schema;
        continue;
      }
      if (existing.enum !== undefined && schema.enum !== undefined) {
        const unionEnum = Array.from(new Set([...existing.enum, ...schema.enum]));
        const existingDesc = existing.description ?? '';
        const newDesc = schema.description ?? '';
        merged[name] = {
          ...existing,
          enum: unionEnum,
          description: existingDesc.includes(newDesc)
            ? existingDesc
            : `${existingDesc} ${newDesc}`.trim(),
        };
      }
    }
  }
  return merged;
}

const AGENT_PATCH_PROPERTIES: Record<string, JsonSchema> = mergeAgentPatchProperties();

// Standalone LLM tools that target a single element type (currently
// rewriteText for text, replaceMedia for media). Sourced from the
// `standaloneTool` slot on per-element specs in dispatch insertion order
// (text precedes media, matching the original CANVAS_AGENT_TOOLS order).
const STANDALONE_AGENT_TOOLS: LlmTool[] = Object.values(AGENT_TOOL_DISPATCH)
  .filter((spec) => spec.standaloneTool !== undefined)
  .map((spec) => {
    // Non-null asserted by the filter above; spec.standaloneTool is defined.
    return spec.standaloneTool!.tool;
  });

// ---------------------------------------------------------------------------
// rewriteText + replaceMedia
// ---------------------------------------------------------------------------
//
// The standalone tool schemas now live next to their owning element files
// (text.ts, media.ts) and are sourced via STANDALONE_AGENT_TOOLS above.

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
    pageId: {
      type: 'string',
      description:
        'Target page for the new section. Required when the section should land on a page other than the first one — pass the page id returned by addPage (or read from the current state listing) so the section is inserted there. Omit (or send empty string) to default to the first page.',
    },
    afterSectionId: {
      type: 'string',
      description:
        'The id of the section after which to insert this new section. ' +
        'Empty string or omitted = append at the end of the page. When pageId is provided the afterSectionId must reference a section on that page.',
    },
    layout: layoutNodeSchema,
  },
  required: ['sectionName', 'layout'],
};

// ---------------------------------------------------------------------------
// Exported tool set
// ---------------------------------------------------------------------------

export const CANVAS_AGENT_TOOLS: LlmTool[] = [
  ...STANDALONE_AGENT_TOOLS,
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
      "Update properties of an existing content element. You MUST pass elementType matching the element's actual type — a mismatch is rejected. Only include the fields you want to change. Use rewriteText instead for changing text content with inline marks.",
    parameters: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'The ID of the element to update.' },
        elementType: {
          type: 'string',
          enum: [...ELEMENT_TYPES],
          description:
            "The element's current type. Must match the actual type — acts as a validation gate.",
        },
        // Shared BaseElement fields
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
        // Per-element fields — merged from AGENT_TOOL_DISPATCH (ADR 0011 Step 2)
        ...AGENT_PATCH_PROPERTIES,
      },
      required: ['elementId', 'elementType'],
    },
  },

  // -------------------------------------------------------------------------
  // renameToken — deterministic site-wide find-and-replace
  // -------------------------------------------------------------------------
  {
    name: 'renameToken',
    description:
      'Site-wide find-and-replace on visible string fields (text content including rich-text markdown, action labels, media alt, page titles). USE THIS for any "rename X to Y everywhere" / "replace all instances of …" / "swap brand name" intent — NEVER enumerate per-element rewriteText calls for that case. The walk is deterministic so coverage is 100% across pages, header, footer, tabs, and collection entries. Pure literal substring replace; no regex. caseSensitive defaults to true; pass false for case-insensitive matching with the replacement value substituted verbatim.',
    parameters: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'The literal string to find. Must be non-empty.',
        },
        to: {
          type: 'string',
          description: 'The literal string to substitute. May be empty (deletion).',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Match case when finding occurrences. Default true.',
        },
      },
      required: ['from', 'to'],
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
        // Per-element creation fields — merged from AGENT_TOOL_DISPATCH
        // (ADR 0011 Step 2). Same shape as updateElement: each per-element
        // module owns its fields and the merger unions enums when multiple
        // specs claim the same field name (e.g. variant on shape/container/action).
        ...AGENT_PATCH_PROPERTIES,
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
      "Switch the site's visual theme to one of the built-in style kits. This restyles the entire site without changing content.",
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
    description: 'Update site-level configuration flags. Only include fields you want to change.',
    parameters: {
      type: 'object',
      properties: {
        visitorTheme: {
          type: 'string',
          enum: ['light', 'dark', 'toggleable'],
          description:
            "Visitor theme for the published site. 'light' = light only, no toggle. 'dark' = dark only, no toggle. 'toggleable' = visitors get a moon button + dual palette + system-preference default.",
        },
        defaultLocale: {
          type: 'string',
          description: 'Default BCP-47 locale for the site (e.g. "en", "fr").',
        },
        siteNoIndex: {
          type: 'boolean',
          description: 'When true, tells search engines not to index any page on this site.',
        },
      },
    },
  },
];
