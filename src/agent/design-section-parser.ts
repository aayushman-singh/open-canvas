import {
  ACTION_VARIANTS,
  BACKGROUND_EFFECTS,
  MOTION_PRESETS,
  SHAPE_VARIANTS,
  SURFACE_VARIANTS,
  type BackgroundEffect,
  type MotionPreset,
} from '../canvas/schema.js';
import { isAllowedHref } from '../canvas/validate.js';
import {
  COLOR_TOKENS,
  DESIGN_ELEMENT_TYPES,
  ELEMENT_SIZES,
  FONT_TOKENS,
  GAP_TOKENS,
  GRID_COLUMNS,
  LAYOUT_ALIGNS,
  SPLIT_RATIOS,
  STACK_DIRECTIONS,
  type DesignSectionInput,
  type ElementNode,
  type LayoutNode,
} from '../canvas/layout/tree.js';

const ELEMENT_PROP_KEYS = DESIGN_ELEMENT_TYPES;
const DESIGN_ELEMENT_MAX = 30;
const HEIGHT_MIN = 240;
const HEIGHT_MAX = 1200;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 96;
const CONTAINER_PADDING_MAX = 80;

export type ParseDesignSectionResult =
  | { ok: true; afterSectionId: string | null; input: DesignSectionInput }
  | { ok: false; error: string };

export function parseDesignSectionToolArgs(args: unknown): ParseDesignSectionResult {
  if (!isRecord(args)) return { ok: false, error: 'designSection arguments must be an object' };
  if (!isNonEmptyString(args.sectionName)) {
    return { ok: false, error: 'designSection.sectionName must be a non-empty string' };
  }
  if (!isRecord(args.layout)) {
    return { ok: false, error: 'designSection.layout must be an object' };
  }

  const layoutParsed = parseLayoutTree(args.layout, 'layout', 0);
  if (typeof layoutParsed === 'string') {
    return { ok: false, error: `designSection.layout: ${layoutParsed}` };
  }
  if ('element' in layoutParsed) {
    return { ok: false, error: 'designSection.layout root must be a layout node, not an element' };
  }

  const elementCount = countElementNodes(layoutParsed);
  if (elementCount > DESIGN_ELEMENT_MAX) {
    return {
      ok: false,
      error: `designSection.layout has ${String(elementCount)} elements; maximum is ${String(DESIGN_ELEMENT_MAX)}`,
    };
  }

  let afterSectionId: string | null = null;
  if (args.afterSectionId !== undefined && args.afterSectionId !== '') {
    if (!isNonEmptyString(args.afterSectionId)) {
      return {
        ok: false,
        error: 'designSection.afterSectionId must be a non-empty string when provided',
      };
    }
    afterSectionId = args.afterSectionId;
  }

  const input: DesignSectionInput = { sectionName: args.sectionName, layout: layoutParsed };

  if (args.height !== undefined) {
    if (!isFiniteNumber(args.height) || args.height < HEIGHT_MIN || args.height > HEIGHT_MAX) {
      return {
        ok: false,
        error: `designSection.height must be a number between ${String(HEIGHT_MIN)} and ${String(HEIGHT_MAX)}`,
      };
    }
    input.height = args.height;
  }
  if (args.backgroundEffect !== undefined) {
    if (!isOneOf<BackgroundEffect>(args.backgroundEffect, BACKGROUND_EFFECTS)) {
      return {
        ok: false,
        error: `designSection.backgroundEffect must be one of [${BACKGROUND_EFFECTS.join(', ')}]`,
      };
    }
    input.backgroundEffect = args.backgroundEffect;
  }
  if (args.entrance !== undefined) {
    if (!isOneOf<MotionPreset>(args.entrance, MOTION_PRESETS)) {
      return {
        ok: false,
        error: `designSection.entrance must be one of [${MOTION_PRESETS.join(', ')}]`,
      };
    }
    input.entrance = args.entrance;
  }

  return { ok: true, afterSectionId, input };
}

function parseLayoutTree(
  value: unknown,
  path: string,
  depth: number,
): LayoutNode | ElementNode | string {
  if (depth > 6) return `${path} exceeds maximum nesting depth (6)`;
  if (!isRecord(value)) return `${path} must be an object`;

  if ('element' in value) return parseElementNode(value, path);

  if (!isOneOf(value.type, ['stack', 'grid', 'split'] as const)) {
    return `${path}.type must be stack|grid|split (got ${JSON.stringify(value.type)})`;
  }
  if (!Array.isArray(value.children)) return `${path}.children must be an array`;
  if (value.children.length === 0) return `${path}.children must be a non-empty array`;

  const children: (LayoutNode | ElementNode)[] = [];
  for (let i = 0; i < value.children.length; i++) {
    const parsed = parseLayoutTree(value.children[i], `${path}.children[${String(i)}]`, depth + 1);
    if (typeof parsed === 'string') return parsed;
    children.push(parsed);
  }

  const node: LayoutNode = { type: value.type, children };

  const common = parseCommonLayoutFields(value, node, path);
  if (common !== null) return common;

  if (node.type === 'stack') {
    if (value.direction !== undefined) {
      if (!isOneOf(value.direction, STACK_DIRECTIONS)) {
        return `${path}.direction must be one of [${STACK_DIRECTIONS.join(', ')}]`;
      }
      node.direction = value.direction;
    }
    if (value.columns !== undefined) return `${path}.columns is only valid on grid nodes`;
    if (value.ratio !== undefined) return `${path}.ratio is only valid on split nodes`;
  }

  if (node.type === 'grid') {
    if (value.columns !== undefined) {
      if (!isOneOf(value.columns, GRID_COLUMNS)) {
        return `${path}.columns must be one of [${GRID_COLUMNS.join(', ')}]`;
      }
      node.columns = value.columns;
    }
    if (value.direction !== undefined) return `${path}.direction is only valid on stack nodes`;
    if (value.ratio !== undefined) return `${path}.ratio is only valid on split nodes`;
  }

  if (node.type === 'split') {
    if (children.length !== 2) return `${path}.children must contain exactly 2 children`;
    if (value.ratio !== undefined) {
      if (!isOneOf(value.ratio, SPLIT_RATIOS)) {
        return `${path}.ratio must be one of [${SPLIT_RATIOS.join(', ')}]`;
      }
      node.ratio = value.ratio;
    }
    if (value.direction !== undefined) return `${path}.direction is only valid on stack nodes`;
    if (value.columns !== undefined) return `${path}.columns is only valid on grid nodes`;
  }

  return node;
}

function parseCommonLayoutFields(
  value: Record<string, unknown>,
  node: LayoutNode,
  path: string,
): string | null {
  if (value.gap !== undefined) {
    if (!isOneOf(value.gap, GAP_TOKENS)) {
      return `${path}.gap must be one of [${GAP_TOKENS.join(', ')}]`;
    }
    node.gap = value.gap;
  }
  if (value.align !== undefined) {
    if (!isOneOf(value.align, LAYOUT_ALIGNS)) {
      return `${path}.align must be one of [${LAYOUT_ALIGNS.join(', ')}]`;
    }
    node.align = value.align;
  }
  return null;
}

function parseElementNode(value: Record<string, unknown>, path: string): ElementNode | string {
  const el = value.element;
  if (!isRecord(el)) return `${path}.element must be an object`;
  if (!isOneOf(el.type, DESIGN_ELEMENT_TYPES)) {
    return `${path}.element.type must be text|media|action|shape|container (got ${JSON.stringify(el.type)})`;
  }

  for (const key of ELEMENT_PROP_KEYS) {
    if (key !== el.type && el[key] !== undefined) {
      return `${path}.element.${key} must not be present when element.type is ${el.type}`;
    }
  }

  const node: ElementNode = { element: { type: el.type } };
  if (value.size !== undefined) {
    if (!isOneOf(value.size, ELEMENT_SIZES)) {
      return `${path}.size must be one of [${ELEMENT_SIZES.join(', ')}]`;
    }
    node.size = value.size;
  }

  if (el.type === 'text') {
    if (!isRecord(el.text)) return `${path}.element.text must be an object`;
    const parsed = parseTextProps(el.text, path);
    if (typeof parsed === 'string') return parsed;
    node.element.text = parsed;
  }
  if (el.type === 'media') {
    if (!isRecord(el.media)) return `${path}.element.media must be an object`;
    const parsed = parseMediaProps(el.media, path);
    if (typeof parsed === 'string') return parsed;
    node.element.media = parsed;
  }
  if (el.type === 'action') {
    if (!isRecord(el.action)) return `${path}.element.action must be an object`;
    const parsed = parseActionProps(el.action, path);
    if (typeof parsed === 'string') return parsed;
    node.element.action = parsed;
  }
  if (el.type === 'shape') {
    if (!isRecord(el.shape)) return `${path}.element.shape must be an object`;
    const parsed = parseShapeProps(el.shape, path);
    if (typeof parsed === 'string') return parsed;
    node.element.shape = parsed;
  }
  if (el.type === 'container') {
    if (!isRecord(el.container)) return `${path}.element.container must be an object`;
    const parsed = parseContainerProps(el.container, path);
    if (typeof parsed === 'string') return parsed;
    node.element.container = parsed;
  }

  return node;
}

function parseTextProps(
  value: Record<string, unknown>,
  path: string,
): NonNullable<ElementNode['element']['text']> | string {
  if (!isNonEmptyString(value.content))
    return `${path}.element.text.content must be a non-empty string`;
  if (!isOneOf(value.role, ['heading', 'body', 'label'] as const)) {
    return `${path}.element.text.role must be heading|body|label`;
  }
  if (!isOneOf(value.color, COLOR_TOKENS)) {
    return `${path}.element.text.color must be one of [${COLOR_TOKENS.join(', ')}]`;
  }
  if (!isOneOf(value.font, FONT_TOKENS)) {
    return `${path}.element.text.font must be one of [${FONT_TOKENS.join(', ')}]`;
  }
  if (!isFiniteNumber(value.size) || value.size < FONT_SIZE_MIN || value.size > FONT_SIZE_MAX) {
    return `${path}.element.text.size must be a number between ${String(FONT_SIZE_MIN)} and ${String(FONT_SIZE_MAX)}`;
  }
  return {
    content: value.content,
    role: value.role,
    color: value.color,
    font: value.font,
    size: value.size,
  };
}

function parseMediaProps(
  value: Record<string, unknown>,
  path: string,
): NonNullable<ElementNode['element']['media']> | string {
  if (!isNonEmptyString(value.imagePrompt)) {
    return `${path}.element.media.imagePrompt must be a non-empty string`;
  }
  if (!isOneOf(value.fit, ['cover', 'contain'] as const)) {
    return `${path}.element.media.fit must be cover|contain`;
  }
  return { imagePrompt: value.imagePrompt, fit: value.fit };
}

function parseActionProps(
  value: Record<string, unknown>,
  path: string,
): NonNullable<ElementNode['element']['action']> | string {
  if (!isNonEmptyString(value.label))
    return `${path}.element.action.label must be a non-empty string`;
  if (!isOneOf(value.variant, ACTION_VARIANTS)) {
    return `${path}.element.action.variant must be one of [${ACTION_VARIANTS.join(', ')}]`;
  }
  if (!isNonEmptyString(value.href))
    return `${path}.element.action.href must be a non-empty string`;
  if (!isAllowedHref(value.href)) {
    return `${path}.element.action.href ${JSON.stringify(value.href)} is not allowed`;
  }
  return {
    label: [{ text: value.label }],
    variant: value.variant,
    href: { type: 'external', url: value.href },
  };
}

function parseShapeProps(
  value: Record<string, unknown>,
  path: string,
): NonNullable<ElementNode['element']['shape']> | string {
  if (!isOneOf(value.variant, SHAPE_VARIANTS)) {
    return `${path}.element.shape.variant must be one of [${SHAPE_VARIANTS.join(', ')}]`;
  }
  return { variant: value.variant };
}

function parseContainerProps(
  value: Record<string, unknown>,
  path: string,
): NonNullable<ElementNode['element']['container']> | string {
  if (!isOneOf(value.variant, SURFACE_VARIANTS)) {
    return `${path}.element.container.variant must be one of [${SURFACE_VARIANTS.join(', ')}]`;
  }
  if (
    !isFiniteNumber(value.padding) ||
    value.padding < 0 ||
    value.padding > CONTAINER_PADDING_MAX
  ) {
    return `${path}.element.container.padding must be a number between 0 and ${String(CONTAINER_PADDING_MAX)}`;
  }
  return { variant: value.variant, padding: value.padding };
}

function countElementNodes(node: LayoutNode | ElementNode): number {
  if ('element' in node) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countElementNodes(child);
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOneOf<T extends string | number>(value: unknown, allowed: readonly T[]): value is T {
  return (allowed as readonly unknown[]).includes(value);
}
