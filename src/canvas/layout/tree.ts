// src/canvas/layout/tree.ts
//
// Semantic layout tree types for Section Design (ADR 0010).
//
// The LLM outputs a layout tree using these types; the layout engine
// (engine.ts) resolves it into positioned CanvasElements. The tree is
// ephemeral — computed at tool-call time, never persisted.

import type {
  ActionVariant,
  BackgroundEffect,
  ElementType,
  MotionPreset,
  ShapeVariant,
  SurfaceVariant,
} from '../schema.js';

export const COLOR_TOKENS = ['accent', 'text', 'muted', 'bg', 'panel', 'emphasis'] as const;
export type ColorToken = (typeof COLOR_TOKENS)[number];

export const FONT_TOKENS = ['display', 'body', 'mono'] as const;
export type FontToken = (typeof FONT_TOKENS)[number];

export const GAP_TOKENS = ['tight', 'normal', 'loose'] as const;
export type GapToken = (typeof GAP_TOKENS)[number];

export const LAYOUT_ALIGNS = ['start', 'center', 'end'] as const;
export type LayoutAlign = (typeof LAYOUT_ALIGNS)[number];

export const STACK_DIRECTIONS = ['row', 'column'] as const;
export type StackDirection = (typeof STACK_DIRECTIONS)[number];

export const GRID_COLUMNS = [2, 3, 4] as const;
export type GridColumns = (typeof GRID_COLUMNS)[number];

export const SPLIT_RATIOS = ['1:1', '1:2', '2:1'] as const;
export type SplitRatio = (typeof SPLIT_RATIOS)[number];

export const ELEMENT_SIZES = ['fill', 'hug'] as const;
export type ElementSize = (typeof ELEMENT_SIZES)[number];

export interface TextProps {
  content: string;
  role: 'heading' | 'body' | 'label';
  color: ColorToken;
  font: FontToken;
  size: number;
}

export interface MediaProps {
  imagePrompt: string;
  fit: 'cover' | 'contain';
}

export interface ActionProps {
  label: string;
  variant: ActionVariant;
  href: string;
}

export interface ShapeProps {
  variant: ShapeVariant;
}

export interface ContainerProps {
  variant: SurfaceVariant;
  padding: number;
}

export interface ElementNode {
  element: {
    type: ElementType;
    text?: TextProps;
    media?: MediaProps;
    action?: ActionProps;
    shape?: ShapeProps;
    container?: ContainerProps;
  };
  size?: ElementSize;
}

export interface LayoutNode {
  type: 'stack' | 'grid' | 'split';
  direction?: StackDirection;
  gap?: GapToken;
  align?: LayoutAlign;
  columns?: GridColumns;
  ratio?: SplitRatio;
  children: (LayoutNode | ElementNode)[];
}

export function isElementNode(node: LayoutNode | ElementNode): node is ElementNode {
  return 'element' in node;
}

export interface DesignSectionInput {
  sectionName: string;
  height?: number;
  backgroundEffect?: BackgroundEffect;
  entrance?: MotionPreset;
  layout: LayoutNode;
}

export interface DesignSectionResult {
  section: import('../schema.js').CanvasSection;
  imagePrompts: Map<string, string>;
}
