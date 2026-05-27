// src/canvas/layout/engine.ts
//
// Layout engine — resolves a semantic layout tree into a positioned
// CanvasSection. Pure function, no side effects, no LLM calls.
//
// The algorithm walks the tree recursively, assigning each node a bounding
// box from its parent. Stack nodes lay children out sequentially (row or
// column); grid nodes divide into equal columns; split nodes divide at a
// ratio. Element nodes become CanvasElements with computed positions.
//
// Container elements with size='fill' are treated as background elements:
// they span the full parent box at a lower z-index, and remaining children
// are laid out within the container's padding.

import type {
  CanvasElement,
  CanvasSection,
  InlineRun,
  PositionedBox,
  StyleKitPreset,
  TextElement,
} from '../schema.js';
import type {
  ColorToken,
  DesignSectionInput,
  DesignSectionResult,
  ElementNode,
  FontToken,
  GapToken,
  LayoutAlign,
  LayoutNode,
  SplitRatio,
} from './tree.js';
import { isElementNode } from './tree.js';

const SECTION_HEIGHT_MIN = 240;
const SECTION_HEIGHT_MAX = 1200;
const FONT_SIZE_MIN = 12;
const FONT_SIZE_MAX = 96;
const CONTAINER_PADDING_MAX = 80;
const ROOT_PADDING = 60;
const MAX_ELEMENTS = 30;

const GAP_PX: Record<GapToken, number> = {
  tight: 12,
  normal: 24,
  loose: 48,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shortRand(): string {
  return crypto.randomUUID().slice(0, 8);
}

interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function resolveColor(token: ColorToken, preset: StyleKitPreset): string {
  switch (token) {
    case 'accent':
      return preset.accent;
    case 'text':
      return preset.text;
    case 'muted':
      return preset.muted;
    case 'bg':
      return preset.bg;
    case 'panel':
      return preset.panel;
  }
}

function resolveFont(token: FontToken, preset: StyleKitPreset): string {
  switch (token) {
    case 'display':
      return preset.fontFamilyDisplay;
    case 'body':
      return preset.fontFamilyBody;
    case 'mono':
      return preset.fontFamilyMono;
  }
}

function needsColorPin(color: ColorToken): boolean {
  return color !== 'text';
}

function needsFontPin(font: FontToken, role: 'heading' | 'body' | 'label'): boolean {
  if (role === 'heading') return font !== 'display';
  return font !== 'body';
}

function alignToTextAlign(align: LayoutAlign): 'left' | 'center' | 'right' {
  switch (align) {
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'end':
      return 'right';
  }
}

function estimateTextHeight(content: string, fontSize: number, availableWidth: number): number {
  const avgCharWidth = fontSize * 0.55;
  const charsPerLine = Math.max(1, Math.floor(availableWidth / avgCharWidth));
  const lineCount = Math.max(1, Math.ceil(content.length / charsPerLine));
  return Math.ceil(lineCount * fontSize * 1.5);
}

function estimateIntrinsicHeight(node: ElementNode, availableWidth: number): number {
  const el = node.element;
  switch (el.type) {
    case 'text': {
      if (!el.text) return 40;
      const fontSize = clamp(el.text.size, FONT_SIZE_MIN, FONT_SIZE_MAX);
      return estimateTextHeight(el.text.content, fontSize, availableWidth);
    }
    case 'action':
      return 48;
    case 'shape':
      return 60;
    case 'container':
      return el.container ? el.container.padding * 2 + 60 : 80;
    case 'media':
      return Math.round(Math.min(availableWidth * 0.5625, 400));
    default:
      return 80;
  }
}

function estimateIntrinsicWidth(node: ElementNode): number {
  const el = node.element;
  switch (el.type) {
    case 'action': {
      const label = el.action?.label ?? 'Click';
      return Math.max(120, label.length * 10 + 40);
    }
    case 'shape':
      return 60;
    default:
      return 200;
  }
}

interface ResolveContext {
  preset: StyleKitPreset;
  elements: CanvasElement[];
  imagePrompts: Map<string, string>;
  zCounter: number;
  parentAlign: LayoutAlign;
}

function isBackgroundContainer(node: ElementNode): boolean {
  return node.element.type === 'container' && (node.size ?? 'hug') === 'fill';
}

function requireTextProps(node: ElementNode): NonNullable<ElementNode['element']['text']> {
  const props = node.element.text;
  if (!props) throw new Error('text element requires text props');
  if (props.content.trim().length === 0) throw new Error('text element content must be non-empty');
  return props;
}

function requireMediaProps(node: ElementNode): NonNullable<ElementNode['element']['media']> {
  const props = node.element.media;
  if (!props) throw new Error('media element requires media props');
  if (props.imagePrompt.trim().length === 0) {
    throw new Error('media element imagePrompt must be non-empty');
  }
  return props;
}

function requireActionProps(node: ElementNode): NonNullable<ElementNode['element']['action']> {
  const props = node.element.action;
  if (!props) throw new Error('action element requires action props');
  if (props.label.trim().length === 0) throw new Error('action element label must be non-empty');
  if (props.href.type === 'external') {
    if (props.href.url.trim().length === 0) {
      throw new Error('action element external href url must be non-empty');
    }
  } else if (props.href.type === 'page') {
    if (props.href.pageId.trim().length === 0) {
      throw new Error('action element page href pageId must be non-empty');
    }
  } else {
    const href = props.href as { type?: unknown };
    throw new Error(`action element href type is unsupported: ${String(href.type)}`);
  }
  return props;
}

function requireShapeProps(node: ElementNode): NonNullable<ElementNode['element']['shape']> {
  const props = node.element.shape;
  if (!props) throw new Error('shape element requires shape props');
  return props;
}

function requireContainerProps(
  node: ElementNode,
): NonNullable<ElementNode['element']['container']> {
  const props = node.element.container;
  if (!props) throw new Error('container element requires container props');
  return props;
}

function countElementNodes(node: LayoutNode | ElementNode): number {
  if (isElementNode(node)) return 1;
  let count = 0;
  for (const child of node.children) {
    count += countElementNodes(child);
  }
  return count;
}

function createCanvasElement(
  node: ElementNode,
  box: PositionedBox,
  ctx: ResolveContext,
): CanvasElement {
  const el = node.element;
  const id = `el-${el.type}-${shortRand()}`;

  switch (el.type) {
    case 'text': {
      const text = requireTextProps(node);
      const fontSize = clamp(text.size, FONT_SIZE_MIN, FONT_SIZE_MAX);
      const fontWeight = text.role === 'heading' ? 700 : text.role === 'label' ? 500 : 400;

      const pinnedStyle: Record<string, string> = {};
      if (needsColorPin(text.color)) {
        pinnedStyle['color'] = resolveColor(text.color, ctx.preset);
      }
      if (needsFontPin(text.font, text.role)) {
        pinnedStyle['font-family'] = resolveFont(text.font, ctx.preset);
      }

      const result: TextElement = {
        id,
        type: 'text',
        box,
        content: [{ text: text.content }] as InlineRun[],
        role: text.role,
        fontSize,
        fontWeight,
        align: alignToTextAlign(ctx.parentAlign),
      };
      if (Object.keys(pinnedStyle).length > 0) {
        result.pinnedStyle = pinnedStyle;
      }
      return result;
    }
    case 'media': {
      const media = requireMediaProps(node);
      ctx.imagePrompts.set(id, media.imagePrompt);
      return {
        id,
        type: 'media',
        box,
        mediaKind: 'image',
        assetId: '',
        alt: media.imagePrompt || 'Generated image',
        fit: media.fit,
      };
    }
    case 'action': {
      const action = requireActionProps(node);
      return {
        id,
        type: 'action',
        box,
        label: action.label,
        href: action.href || '#',
        variant: action.variant,
      };
    }
    case 'shape': {
      const shape = requireShapeProps(node);
      return {
        id,
        type: 'shape',
        box,
        variant: shape.variant,
      };
    }
    case 'container': {
      const container = requireContainerProps(node);
      return {
        id,
        type: 'container',
        box,
        variant: container.variant,
      };
    }
    default: {
      throw new Error(`unsupported designSection element type: ${String(el.type)}`);
    }
  }
}

function resolveNode(node: LayoutNode | ElementNode, box: BoundingBox, ctx: ResolveContext): void {
  if (isElementNode(node)) {
    const posBox: PositionedBox = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
      z: ctx.zCounter++,
    };
    ctx.elements.push(createCanvasElement(node, posBox, ctx));
    return;
  }

  switch (node.type) {
    case 'stack':
      resolveStack(node, box, ctx);
      break;
    case 'grid':
      resolveGrid(node, box, ctx);
      break;
    case 'split':
      resolveSplit(node, box, ctx);
      break;
  }
}

function resolveStack(node: LayoutNode, box: BoundingBox, ctx: ResolveContext): void {
  const direction = node.direction ?? 'column';
  const gap = GAP_PX[node.gap ?? 'normal'];
  const align = node.align ?? 'start';
  const children = node.children;
  if (children.length === 0) return;

  const prevAlign = ctx.parentAlign;
  ctx.parentAlign = align;

  // Separate background containers from flow children.
  const bgContainers: ElementNode[] = [];
  const flowChildren: (LayoutNode | ElementNode)[] = [];
  for (const child of children) {
    if (isElementNode(child) && isBackgroundContainer(child)) {
      bgContainers.push(child);
    } else {
      flowChildren.push(child);
    }
  }

  // Background containers span the full parent box at lower z.
  for (const bg of bgContainers) {
    const posBox: PositionedBox = {
      x: Math.round(box.x),
      y: Math.round(box.y),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
      z: ctx.zCounter++,
    };
    ctx.elements.push(createCanvasElement(bg, posBox, ctx));
  }

  // Compute padded content area if a background container defines padding.
  const rawPadding =
    bgContainers.length > 0 ? (bgContainers[0]!.element.container?.padding ?? 0) : 0;
  const padding = clamp(rawPadding, 0, CONTAINER_PADDING_MAX);
  const contentBox: BoundingBox = {
    x: box.x + padding,
    y: box.y + padding,
    w: Math.max(1, box.w - padding * 2),
    h: Math.max(1, box.h - padding * 2),
  };

  if (flowChildren.length === 0) {
    ctx.parentAlign = prevAlign;
    return;
  }

  if (direction === 'column') {
    resolveColumnStack(flowChildren, contentBox, gap, ctx);
  } else {
    resolveRowStack(flowChildren, contentBox, gap, ctx);
  }

  ctx.parentAlign = prevAlign;
}

function resolveColumnStack(
  children: (LayoutNode | ElementNode)[],
  box: BoundingBox,
  gap: number,
  ctx: ResolveContext,
): void {
  const totalGap = gap * (children.length - 1);
  const childHeights: number[] = [];
  let totalHug = 0;
  let fillCount = 0;

  for (const child of children) {
    if (isElementNode(child) && (child.size ?? 'hug') === 'hug') {
      const h = estimateIntrinsicHeight(child, box.w);
      childHeights.push(h);
      totalHug += h;
    } else {
      childHeights.push(-1);
      fillCount++;
    }
  }

  const remainingForFill = Math.max(0, box.h - totalHug - totalGap);
  const fillHeight = fillCount > 0 ? remainingForFill / fillCount : 0;

  for (let i = 0; i < childHeights.length; i++) {
    if (childHeights[i] === -1) {
      childHeights[i] = fillHeight;
    }
  }

  let currentY = box.y;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const h = childHeights[i]!;
    resolveNode(child, { x: box.x, y: currentY, w: box.w, h }, ctx);
    currentY += h + gap;
  }
}

function resolveRowStack(
  children: (LayoutNode | ElementNode)[],
  box: BoundingBox,
  gap: number,
  ctx: ResolveContext,
): void {
  const totalGap = gap * (children.length - 1);
  const childWidths: number[] = [];
  let totalHug = 0;
  let fillCount = 0;

  for (const child of children) {
    // REVIEW: default is `'fill'` here but column stack at line 404 defaults to `'hug'`. Asymmetric defaults mean an unsized child in a row fills width but an unsized child in a column hugs height. If this is intentional, document the reasoning — otherwise, align both defaults.
    if (isElementNode(child) && (child.size ?? 'fill') === 'hug') {
      const w = estimateIntrinsicWidth(child);
      childWidths.push(w);
      totalHug += w;
    } else {
      childWidths.push(-1);
      fillCount++;
    }
  }

  const remainingForFill = Math.max(0, box.w - totalHug - totalGap);
  const fillWidth = fillCount > 0 ? remainingForFill / fillCount : 0;

  for (let i = 0; i < childWidths.length; i++) {
    if (childWidths[i] === -1) {
      childWidths[i] = fillWidth;
    }
  }

  let currentX = box.x;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const w = childWidths[i]!;
    resolveNode(child, { x: currentX, y: box.y, w, h: box.h }, ctx);
    currentX += w + gap;
  }
}

function resolveGrid(node: LayoutNode, box: BoundingBox, ctx: ResolveContext): void {
  const columns = node.columns ?? 3;
  const gap = GAP_PX[node.gap ?? 'normal'];
  const align = node.align ?? 'start';
  const children = node.children;
  if (children.length === 0) return;

  const prevAlign = ctx.parentAlign;
  ctx.parentAlign = align;

  const totalGap = gap * (columns - 1);
  const colWidth = (box.w - totalGap) / columns;
  const rows = Math.ceil(children.length / columns);
  const rowGap = gap;
  const totalRowGap = rowGap * (rows - 1);
  const rowHeight = (box.h - totalRowGap) / rows;

  for (let i = 0; i < children.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const child = children[i]!;

    resolveNode(
      child,
      {
        x: box.x + col * (colWidth + gap),
        y: box.y + row * (rowHeight + rowGap),
        w: colWidth,
        h: rowHeight,
      },
      ctx,
    );
  }

  ctx.parentAlign = prevAlign;
}

function resolveSplit(node: LayoutNode, box: BoundingBox, ctx: ResolveContext): void {
  const ratio = node.ratio ?? '1:1';
  const gap = GAP_PX[node.gap ?? 'normal'];
  const align = node.align ?? 'start';
  const children = node.children;

  const prevAlign = ctx.parentAlign;
  ctx.parentAlign = align;

  if (children.length === 0) {
    ctx.parentAlign = prevAlign;
    return;
  }
  if (children.length !== 2) {
    ctx.parentAlign = prevAlign;
    throw new Error(`split layout requires exactly 2 children (got ${String(children.length)})`);
  }

  const [leftRatio, rightRatio] = parseSplitRatio(ratio);
  const totalRatio = leftRatio + rightRatio;
  const availableWidth = box.w - gap;
  const leftWidth = (availableWidth * leftRatio) / totalRatio;
  const rightWidth = (availableWidth * rightRatio) / totalRatio;

  resolveNode(children[0]!, { x: box.x, y: box.y, w: leftWidth, h: box.h }, ctx);
  resolveNode(children[1]!, { x: box.x + leftWidth + gap, y: box.y, w: rightWidth, h: box.h }, ctx);

  ctx.parentAlign = prevAlign;
}

// REVIEW: no `default` case — if `SplitRatio` union grows (e.g. '1:3'), this function returns `undefined`. Add `default: throw new Error(...)` or use a const Record<SplitRatio, [number, number]> for exhaustive mapping at compile time.
function parseSplitRatio(ratio: SplitRatio): [number, number] {
  switch (ratio) {
    case '1:1':
      return [1, 1];
    case '1:2':
      return [1, 2];
    case '2:1':
      return [2, 1];
  }
}

export function resolveDesignSection(
  input: DesignSectionInput,
  pageWidth: number,
  preset: StyleKitPreset,
): DesignSectionResult {
  const elementCount = countElementNodes(input.layout);
  if (elementCount > MAX_ELEMENTS) {
    throw new Error(
      `designSection layout exceeds maximum element count (${String(MAX_ELEMENTS)}): ${String(elementCount)}`,
    );
  }

  const height = clamp(input.height ?? 720, SECTION_HEIGHT_MIN, SECTION_HEIGHT_MAX);
  const sectionId = `sec-custom-${shortRand()}`;

  const ctx: ResolveContext = {
    preset,
    elements: [],
    imagePrompts: new Map(),
    zCounter: 2,
    parentAlign: 'start',
  };

  const rootBox: BoundingBox = {
    x: ROOT_PADDING,
    y: ROOT_PADDING,
    w: pageWidth - ROOT_PADDING * 2,
    h: height - ROOT_PADDING * 2,
  };

  resolveNode(input.layout, rootBox, ctx);

  // REVIEW: clamp order dependency — x is clamped first, then w is clamped to `pageWidth - el.box.x`. If an element lands at x=pageWidth-1, max width becomes 1px regardless of the original width. Consider computing bounds from the original unclamped position first, then applying all four clamps together.
  for (const el of ctx.elements) {
    el.box.x = clamp(el.box.x, 0, pageWidth - 1);
    el.box.y = clamp(el.box.y, 0, height - 1);
    el.box.w = clamp(el.box.w, 1, pageWidth - el.box.x);
    el.box.h = clamp(el.box.h, 1, height - el.box.y);
  }

  const section: CanvasSection = {
    id: sectionId,
    recipeId: 'custom',
    name: input.sectionName,
    height,
    elements: ctx.elements,
  };
  if (input.backgroundEffect !== undefined) {
    section.backgroundEffect = input.backgroundEffect;
  }
  if (input.entrance !== undefined) {
    section.entrance = input.entrance;
  }

  return { section, imagePrompts: ctx.imagePrompts };
}
