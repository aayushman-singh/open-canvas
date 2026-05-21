// LLM tool definitions for the rev01 agent.
//
// Each tool's JSON schema is tight enough that the model emits well-formed
// arguments; ambiguous tools waste a turn. Names and shapes match DocOp 1:1
// so parseToolCall is a switch + a couple of type checks. Adding a new tool
// requires:
//
//   1. Add a DocOp variant in ops.ts and update applyDocOp[ToYDoc].
//   2. Add an LlmTool entry to AGENT_TOOLS here.
//   3. Add a translator branch to parseToolCall.
//
// Keep the surface deliberately narrow — five tools is enough for the demo
// narrative ("change the headline", "add a new section", "rename the call to
// action"). Expansion (swapImage, setTheme, addAction, mark formatting) is
// gated on observed demand.

import type { LlmTool } from './llm';
import type { DocOp } from './ops';
import { SECTION_KINDS } from '../document/schema';

export const AGENT_TOOLS: LlmTool[] = [
  {
    name: 'setHeadingText',
    description:
      "Replace the text of a heading inside a section. Use this when the user wants to change a title or any h1/h2/h3 wording. sectionIndex is 0-based; headingIndex is the position of the heading among that section's blocks (0-based, counting only blocks of any kind, NOT only headings).",
    parameters: {
      type: 'object',
      properties: {
        sectionIndex: {
          type: 'integer',
          minimum: 0,
          description: '0-based index of the section in doc.content.',
        },
        headingIndex: {
          type: 'integer',
          minimum: 0,
          description:
            '0-based index of the heading block within section.content. The targeted block MUST have type="heading".',
        },
        text: { type: 'string', description: 'The new heading text. Plain text only.' },
      },
      required: ['sectionIndex', 'headingIndex', 'text'],
    },
  },
  {
    name: 'setParagraphText',
    description:
      "Replace the text of a paragraph inside a section. Use this to rewrite body copy in place. paragraphIndex is the 0-based position of the paragraph among that section's blocks (counting all block types).",
    parameters: {
      type: 'object',
      properties: {
        sectionIndex: { type: 'integer', minimum: 0 },
        paragraphIndex: {
          type: 'integer',
          minimum: 0,
          description:
            'Index of the paragraph block within section.content; block.type must be "paragraph".',
        },
        text: { type: 'string', description: 'The new paragraph text. Plain text only.' },
      },
      required: ['sectionIndex', 'paragraphIndex', 'text'],
    },
  },
  {
    name: 'insertSection',
    description:
      "Insert a new section at the given index. Use this to add a new region to the page (hero, feature, cta, footer, etc.). Provide an optional heading and/or paragraph for the section's initial content. If neither is provided a placeholder paragraph is inserted so the section is valid.",
    parameters: {
      type: 'object',
      properties: {
        index: {
          type: 'integer',
          minimum: 0,
          description:
            'Position to insert at. 0 prepends, doc.content.length appends. Out-of-range values are clamped.',
        },
        sectionKind: {
          type: 'string',
          enum: [...SECTION_KINDS],
          description: 'Semantic kind for the new section.',
        },
        headingText: {
          type: 'string',
          description: 'Optional heading text (rendered as h2).',
        },
        paragraphText: {
          type: 'string',
          description: 'Optional paragraph text.',
        },
      },
      required: ['index', 'sectionKind'],
    },
  },
  {
    name: 'removeSection',
    description:
      'Remove the section at the given index. Destructive — ASK THE USER for confirmation in your text reply before calling this, unless the user already explicitly said "remove" / "delete" / "drop" the specific section. The doc must always have at least one section; removing the last section is rejected.',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'integer', minimum: 0 },
      },
      required: ['index'],
    },
  },
  {
    name: 'setActionLabel',
    description:
      'Update the label (and optionally the href) of an action button inside an actions block. Use when the user wants to rename a call-to-action like "See the menu" or "Sign up".',
    parameters: {
      type: 'object',
      properties: {
        sectionIndex: { type: 'integer', minimum: 0 },
        actionsIndex: {
          type: 'integer',
          minimum: 0,
          description:
            'Index of the actions block within section.content; block.type must be "actions".',
        },
        actionIndex: {
          type: 'integer',
          minimum: 0,
          description: 'Index of the action inside actions.content.',
        },
        label: { type: 'string', description: 'New visible button label.' },
        href: {
          type: 'string',
          description:
            'Optional new href. Use http(s) urls, mailto:, or in-page anchors like "#menu".',
        },
      },
      required: ['sectionIndex', 'actionsIndex', 'actionIndex', 'label'],
    },
  },
];

// ---------------------------------------------------------------------------
// LLM tool call  ->  typed DocOp.
//
// Returns a structured Result type so the orchestrator can feed validation
// errors back to the model as a tool result instead of throwing.
// ---------------------------------------------------------------------------

export type ParseToolCallResult = { ok: true; op: DocOp } | { ok: false; error: string };

export function parseToolCall(name: string, args: unknown): ParseToolCallResult {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return { ok: false, error: `tool ${name}: arguments must be an object` };
  }
  const a = args as Record<string, unknown>;

  switch (name) {
    case 'setHeadingText': {
      const sectionIndex = readInt(a.sectionIndex, 'sectionIndex');
      if (sectionIndex.ok === false) return sectionIndex;
      const headingIndex = readInt(a.headingIndex, 'headingIndex');
      if (headingIndex.ok === false) return headingIndex;
      const text = readString(a.text, 'text');
      if (text.ok === false) return text;
      return {
        ok: true,
        op: {
          kind: 'setHeadingText',
          sectionIndex: sectionIndex.value,
          headingIndex: headingIndex.value,
          text: text.value,
        },
      };
    }
    case 'setParagraphText': {
      const sectionIndex = readInt(a.sectionIndex, 'sectionIndex');
      if (sectionIndex.ok === false) return sectionIndex;
      const paragraphIndex = readInt(a.paragraphIndex, 'paragraphIndex');
      if (paragraphIndex.ok === false) return paragraphIndex;
      const text = readString(a.text, 'text');
      if (text.ok === false) return text;
      return {
        ok: true,
        op: {
          kind: 'setParagraphText',
          sectionIndex: sectionIndex.value,
          paragraphIndex: paragraphIndex.value,
          text: text.value,
        },
      };
    }
    case 'insertSection': {
      const index = readInt(a.index, 'index');
      if (index.ok === false) return index;
      const sectionKind = readEnum(a.sectionKind, SECTION_KINDS, 'sectionKind');
      if (sectionKind.ok === false) return sectionKind;
      const headingText =
        a.headingText !== undefined ? readString(a.headingText, 'headingText') : null;
      if (headingText && headingText.ok === false) return headingText;
      const paragraphText =
        a.paragraphText !== undefined ? readString(a.paragraphText, 'paragraphText') : null;
      if (paragraphText && paragraphText.ok === false) return paragraphText;
      return {
        ok: true,
        op: {
          kind: 'insertSection',
          index: index.value,
          sectionKind: sectionKind.value,
          ...(headingText && headingText.ok ? { headingText: headingText.value } : {}),
          ...(paragraphText && paragraphText.ok ? { paragraphText: paragraphText.value } : {}),
        },
      };
    }
    case 'removeSection': {
      const index = readInt(a.index, 'index');
      if (index.ok === false) return index;
      return { ok: true, op: { kind: 'removeSection', index: index.value } };
    }
    case 'setActionLabel': {
      const sectionIndex = readInt(a.sectionIndex, 'sectionIndex');
      if (sectionIndex.ok === false) return sectionIndex;
      const actionsIndex = readInt(a.actionsIndex, 'actionsIndex');
      if (actionsIndex.ok === false) return actionsIndex;
      const actionIndex = readInt(a.actionIndex, 'actionIndex');
      if (actionIndex.ok === false) return actionIndex;
      const label = readString(a.label, 'label');
      if (label.ok === false) return label;
      const href = a.href !== undefined ? readString(a.href, 'href') : null;
      if (href && href.ok === false) return href;
      return {
        ok: true,
        op: {
          kind: 'setActionLabel',
          sectionIndex: sectionIndex.value,
          actionsIndex: actionsIndex.value,
          actionIndex: actionIndex.value,
          label: label.value,
          ...(href && href.ok ? { href: href.value } : {}),
        },
      };
    }
    default:
      return { ok: false, error: `unknown tool name: ${name}` };
  }
}

type Read<T> = { ok: true; value: T } | { ok: false; error: string };

function readInt(v: unknown, key: string): Read<number> {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return { ok: true, value: Math.trunc(v) };
  }
  if (typeof v === 'string' && /^-?\d+$/.test(v)) {
    return { ok: true, value: parseInt(v, 10) };
  }
  return { ok: false, error: `${key} must be an integer, got ${JSON.stringify(v)}` };
}

function readString(v: unknown, key: string): Read<string> {
  if (typeof v === 'string' && v.length > 0) {
    return { ok: true, value: v };
  }
  return { ok: false, error: `${key} must be a non-empty string, got ${JSON.stringify(v)}` };
}

function readEnum<T extends string>(v: unknown, allowed: readonly T[], key: string): Read<T> {
  if (typeof v === 'string' && (allowed as readonly string[]).includes(v)) {
    return { ok: true, value: v as T };
  }
  return {
    ok: false,
    error: `${key} must be one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`,
  };
}
