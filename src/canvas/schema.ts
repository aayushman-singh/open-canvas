// src/canvas/schema.ts
//
// Canvas document model for the canvas-first POC.
//
// Domain language follows CONTEXT.md: an Editable Site is a set of Canvas
// Pages, each made of Canvas Sections, each containing Positioned Elements.
// A Published Snapshot wraps the same Canvas Pages with publish metadata for
// the visitor-facing site.

export const STYLE_KITS = ['charcoal', 'orange-editorial', 'blue-saas', 'green-organic'] as const;
export type StyleKit = (typeof STYLE_KITS)[number];

export const ELEMENT_TYPES = ['text', 'media', 'action', 'shape', 'container'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const ACTION_VARIANTS = [
  'solid',
  'outline',
  'ghost',
  'pill',
  'glass',
  'brutalist',
  'underline',
] as const;
export type ActionVariant = (typeof ACTION_VARIANTS)[number];

export const SURFACE_VARIANTS = [
  'flat',
  'raised',
  'glass',
  'outlined',
  'sticker',
  'editorial-frame',
  'soft-panel',
] as const;
export type SurfaceVariant = (typeof SURFACE_VARIANTS)[number];

export const SHAPE_VARIANTS = ['rect', 'pill', 'circle', 'line', 'badge', 'blob'] as const;
export type ShapeVariant = (typeof SHAPE_VARIANTS)[number];

export const MOTION_PRESETS = [
  'none',
  'fade-up',
  'slide-left',
  'scale-in',
  'blur-in',
  'stagger-children',
  'slow-drift',
  'parallax-soft',
] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const SECTION_RECIPE_IDS = [
  'hero-split',
  'feature-grid',
  'gallery-strip',
  'cta-band',
  'logo-strip',
  'testimonial-row',
  'video-hero',
] as const;
export type SectionRecipeId = (typeof SECTION_RECIPE_IDS)[number];

export const BACKGROUND_EFFECTS = [
  'none',
  'grain',
  'grid',
  'soft-light',
  'paper',
  'glass',
] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

export interface CanvasPoint {
  x: number;
  y: number;
}
export interface CanvasSize {
  w: number;
  h: number;
}
export interface PositionedBox extends CanvasPoint, CanvasSize {
  rotation?: number;
  z: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  box: PositionedBox;
  motion?: { preset: MotionPreset; delayMs?: number };
  pinnedStyle?: Record<string, string>;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  role: 'heading' | 'body' | 'label';
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  align: 'left' | 'center' | 'right';
}

export interface MediaElement extends BaseElement {
  type: 'media';
  mediaKind: MediaKind;
  assetId: string;
  posterAssetId?: string;
  alt: string;
  fit: 'cover' | 'contain';
  playback?: {
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
  };
}

export interface ActionElement extends BaseElement {
  type: 'action';
  label: string;
  href: string;
  variant: ActionVariant;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
}

export interface ContainerElement extends BaseElement {
  type: 'container';
  variant: SurfaceVariant;
}

export type CanvasElement =
  | TextElement
  | MediaElement
  | ActionElement
  | ShapeElement
  | ContainerElement;

export interface CanvasSection {
  id: string;
  recipeId: SectionRecipeId;
  name: string;
  height: number;
  backgroundEffect?: BackgroundEffect;
  entrance?: MotionPreset;
  elements: CanvasElement[];
}

export interface CanvasPage {
  id: string;
  slug: string;
  title: string;
  width: number;
  sections: CanvasSection[];
}

export interface CanvasSiteState {
  styleKit: StyleKit;
  pages: CanvasPage[];
}

export interface PublishedSnapshot {
  version: number;
  publishedAt: string;
  styleKit: StyleKit;
  pages: CanvasPage[];
}
