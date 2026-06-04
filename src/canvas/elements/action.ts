// src/canvas/elements/action.ts
//
// `ActionElement` interface (including `ActionHref` and `ActionBehavior`
// sub-types) + renderer + inspector spec + agent-tool spec.
//
// Action is a one-of: a navigation target (`href: ActionHref`) OR a click
// behaviour (`behavior: ActionBehavior`). The two are mutually exclusive at
// the type level and at runtime — per ADR 0051 dec 3. The variant carrying
// `behavior` does not have `href`, and vice versa.
//
// Label content is `InlineRun[]` — the same rich-text array TextElement uses
// — so buttons can carry bold/italic/link/code/highlight marks (ADR 0051 dec 1).
// The agent tool accepts either a string (parsed into a single run) or a full
// InlineRun[] for ergonomic patching.

import type { AgentToolSpec } from './agent-tool-spec.js';
import type { InspectorSpec } from './inspector-spec.js';
import type { SidebarSpec } from './sidebar-spec.js';
import { escapeAttr, renderInlineRun } from './render-utils.js';
import { resolveActionHref } from '../action-href.js';
import {
  ACTION_VARIANTS,
  type ActionVariant,
  type BaseElement,
  type CanvasPage,
  type InlineRun,
} from '../schema.js';
import { isAllowedHref } from '../validate.js';
import { ICON_NAMES, type IconName, isIconName, renderIconSvg } from '../icons.js';
import { inlineRunSchema, parseTextInlineRuns } from './text.js';

export type ActionHref =
  | { type: 'external'; url: string }
  | { type: 'page'; pageId: string; anchor?: string };

/**
 * Click-driven action behaviour. Discriminated union — `copy` is the only
 * member shipping in ADR 0051; future members (`submit-form`, `open-popup`,
 * etc.) extend the union without renaming the field.
 */
export type ActionBehavior = { type: 'copy'; value: string };

/**
 * Action interface — a discriminated union over the link / behaviour split.
 * Both members carry the common label / variant / iconKind shape; only the
 * `href` and `behavior` fields vary. The TypeScript discriminator is the
 * presence-vs-absence of each field; the runtime validator enforces exactly
 * one of them is set.
 */
export type ActionElement = BaseElement & {
  type: 'action';
  label: InlineRun[];
  variant: ActionVariant;
  iconKind?: IconName;
} & ({ href: ActionHref; behavior?: undefined } | { href?: undefined; behavior: ActionBehavior });

export function renderAction(element: ActionElement, ctx: { pages: CanvasPage[] }): string {
  const iconHtml = element.iconKind !== undefined ? renderIconSvg(element.iconKind) : '';
  // Skip the label container entirely when every run has empty text — the
  // "icon-only" affordance. renderInlineRun({text:''}) would otherwise emit
  // `<span></span>`, which (a) reserves no visible content but (b) still
  // participates in flex layout and consumes the gap, breaking the icon-only
  // look. The label is still required to be a non-empty array at-rest per
  // validator; the empty-text contract is `[{text:''}]`.
  const labelPlain = element.label.map((run) => run.text).join('');
  const labelHtml = labelPlain.length === 0 ? '' : element.label.map(renderInlineRun).join('');
  const innerHtml = `${iconHtml}${labelHtml}`;
  const variantAttr = escapeAttr(element.variant);

  if (element.behavior !== undefined) {
    // Copy behaviour — emit a real <button>. The visitor-side copy handler
    // (renderCopyHandlerScript in render.ts) reads data-opencanvas-copy on
    // click. type="button" so the element doesn't accidentally submit a
    // parent <form>.
    const copyValue = escapeAttr(element.behavior.value);
    return `<button type="button" class="opencanvas-action" data-variant="${variantAttr}" data-opencanvas-copy="${copyValue}">${innerHtml}</button>`;
  }

  // Link variant. resolveActionHref handles 'external' verbatim and 'page'
  // by composing the published path; both arms come back as a plain string.
  const resolved = resolveActionHref(element.href, ctx.pages);
  return `<a class="opencanvas-action" data-variant="${variantAttr}" href="${escapeAttr(resolved)}">${innerHtml}</a>`;
}

// Inspector — variant + iconKind + href (link case). Rich-text label editor
// + behaviour editor land in the inspector follow-up PR per ADR 0051's
// follow-ups bullet. Authors editing copy-variant actions go through the
// agent tool or the JSON in the interim.
export const actionInspectorSpec: InspectorSpec = {
  fields: [
    { kind: 'select', label: 'Variant', path: 'variant', options: ACTION_VARIANTS },
    { kind: 'icon', label: 'Icon', path: 'iconKind' },
    {
      kind: 'action-href',
      discriminatorLabel: 'Link Type',
      valueLabel: 'Destination',
      path: 'href',
    },
  ],
};

export const actionSidebarSpec: SidebarSpec = {
  commands: [
    {
      key: 'action',
      sidebarLabel: 'Button',
      sidebarTip: 'Add a clickable button',
      toolbarLabel: '+Btn',
      toolbarTip: 'Add button',
      factoryName: 'action',
    },
  ],
};

// ---------------------------------------------------------------------------
// Agent tool spec — action element
// ---------------------------------------------------------------------------

function isRecordLocal(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseActionHref(value: unknown, fieldName: string): ActionHref {
  if (!isRecordLocal(value)) {
    throw new Error(`${fieldName} must be an ActionHref object`);
  }
  if (value.type === 'external') {
    if (typeof value.url !== 'string' || value.url.length === 0) {
      throw new Error(`${fieldName}.url must be a non-empty string`);
    }
    if (!isAllowedHref(value.url)) {
      throw new Error(`${fieldName}.url ${JSON.stringify(value.url)} is not allowed`);
    }
    return { type: 'external', url: value.url };
  }
  if (value.type === 'page') {
    if (typeof value.pageId !== 'string' || value.pageId.length === 0) {
      throw new Error(`${fieldName}.pageId must be a non-empty string`);
    }
    const href: ActionHref = { type: 'page', pageId: value.pageId };
    if (value.anchor !== undefined) {
      if (typeof value.anchor !== 'string') {
        throw new Error(`${fieldName}.anchor must be a string when present`);
      }
      href.anchor = value.anchor;
    }
    return href;
  }
  throw new Error(`${fieldName}.type must be "external" or "page"`);
}

function parseActionBehavior(value: unknown, fieldName: string): ActionBehavior {
  if (!isRecordLocal(value)) {
    throw new Error(`${fieldName} must be an ActionBehavior object`);
  }
  if (value.type !== 'copy') {
    throw new Error(`${fieldName}.type must be "copy"`);
  }
  if (typeof value.value !== 'string' || value.value.length === 0) {
    throw new Error(`${fieldName}.value must be a non-empty string`);
  }
  return { type: 'copy', value: value.value };
}

/**
 * Parse `label` as either a single-run string (convenience) or a full
 * InlineRun[] (canonical). String-form gets wrapped into `[{text}]`. The
 * at-rest shape on the element is always InlineRun[].
 */
function parseActionLabel(value: unknown): InlineRun[] {
  if (typeof value === 'string') {
    if (value.length === 0)
      throw new Error('label must be a non-empty string when given as a string');
    return [{ text: value }];
  }
  const parsed = parseTextInlineRuns(value);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.runs;
}

export const actionAgentToolSpec: AgentToolSpec = {
  patchProperties: {
    label: {
      oneOf: [{ type: 'string' }, { type: 'array', items: inlineRunSchema }],
      description:
        'Button label content as InlineRun[] (preferred), or a plain string for a single run. Action elements only.',
    },
    href: {
      type: 'object',
      description:
        'Button link target as { type: "external" | "page", ... }. Action elements only. Setting `href` clears any existing `behavior`.',
    },
    behavior: {
      type: 'object',
      description:
        'Click behaviour: { type: "copy", value: "..." }. Action elements only. Setting `behavior` clears any existing `href`.',
    },
    variant: {
      type: 'string',
      enum: [...ACTION_VARIANTS],
      description: 'Action button visual variant. Action elements only.',
    },
    iconKind: {
      type: 'string',
      enum: [...ICON_NAMES],
      description: `Optional icon glyph rendered before the label. One of [${ICON_NAMES.join(', ')}]. Action elements only.`,
    },
  },
  parsePatch: (args) => {
    const patch: Record<string, unknown> = {};
    if (args.variant !== undefined) {
      if (typeof args.variant !== 'string') throw new Error('variant must be a string');
      patch.variant = args.variant;
    }
    if (args.label !== undefined) {
      patch.label = parseActionLabel(args.label);
    }
    if (args.iconKind !== undefined) {
      if (args.iconKind === null || args.iconKind === '') {
        // Caller may clear the icon by passing null/empty.
        patch.iconKind = undefined;
      } else if (!isIconName(args.iconKind)) {
        throw new Error(
          `iconKind must be one of [${ICON_NAMES.join(', ')}] or null/empty to clear`,
        );
      } else {
        patch.iconKind = args.iconKind;
      }
    }
    // Mutual exclusion: setting one of href/behavior clears the other so
    // the at-rest element always matches the discriminated-union contract.
    if (args.href !== undefined) {
      patch.href = parseActionHref(args.href, 'href');
      patch.behavior = undefined;
    }
    if (args.behavior !== undefined) {
      patch.behavior = parseActionBehavior(args.behavior, 'behavior');
      patch.href = undefined;
    }
    return patch;
  },
};
