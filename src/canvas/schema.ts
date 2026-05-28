// src/canvas/schema.ts
//
// Canvas document model for the canvas-first POC.
//
// Domain language follows CONTEXT.md: an Editable Site is a set of Canvas
// Pages, each made of Canvas Sections, each containing Positioned Elements.
// A Published Snapshot wraps the same Canvas Pages with publish metadata for
// the visitor-facing site.

/**
 * The four deterministic built-in kits. Iterating over presets — emitting
 * per-kit CSS, smoke-test loops, editor preview — uses this list.
 */
export const BUILT_IN_STYLE_KITS = [
  'charcoal',
  'orange-editorial',
  'blue-saas',
  'green-organic',
] as const;
export type BuiltInStyleKit = (typeof BUILT_IN_STYLE_KITS)[number];

/**
 * Full set of selector values an Owner may store on a site. Built-ins plus
 * `'custom'`: when the selector is `'custom'` the resolver pulls tokens from
 * `EditableSite.customStyleKit` instead of `STYLE_KIT_PRESETS`. The
 * built-in presets do not include a `custom` row; resolvers must check the
 * selector before looking up the preset.
 */
export const STYLE_KITS = [...BUILT_IN_STYLE_KITS, 'custom'] as const;
export type StyleKit = (typeof STYLE_KITS)[number];

export const ELEMENT_TYPES = [
  'text',
  'media',
  'action',
  'shape',
  'container',
  'form',
  'embed',
  'chart',
  'accordion',
  'carousel',
  'table',
  'code',
  'nav',
  'collection',
] as const;
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
  'fade-down',
  'fade-in',
  'fade-right',
  'slide-left',
  'slide-up',
  'slide-right',
  'scale-in',
  'zoom-out',
  'blur-in',
  'rotate-in',
  'flip-in',
  'bounce-in',
  'stagger-children',
  'slow-drift',
  'parallax-soft',
] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const SCROLL_TRIGGER_MODES = ['on-scroll', 'on-load'] as const;
export type ScrollTriggerMode = (typeof SCROLL_TRIGGER_MODES)[number];

export const AGENT_RECIPE_IDS = [
  'hero-split',
  'feature-grid',
  'gallery-strip',
  'cta-band',
  'logo-strip',
  'testimonial-row',
  'video-hero',
] as const;
export type AgentRecipeId = (typeof AGENT_RECIPE_IDS)[number];

export const SECTION_RECIPE_IDS = [...AGENT_RECIPE_IDS, 'custom'] as const;
export type SectionRecipeId = (typeof SECTION_RECIPE_IDS)[number];

// Inline rich-text marks for the rich text inside a TextElement. The set is
// intentionally small: bold/italic/underline/strike/code/highlight/link. There
// are no block-level nodes — a TextElement is always a single visual paragraph
// whose box, alignment, font size, and role come from the surrounding fields.
export const INLINE_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'link',
] as const;
export type InlineMarkType = (typeof INLINE_MARK_TYPES)[number];

export type InlineMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight' }
  | { type: 'link'; href: string; target?: '_blank' };

export interface InlineRun {
  // raw text, no HTML; newlines are literal U+000A
  text: string;
  // 0..N marks; order is style-irrelevant but must be deduplicated by type
  marks?: InlineMark[];
}

export const BACKGROUND_EFFECTS = [
  'none',
  'grain',
  'grid',
  'soft-light',
  'paper',
  'glass',
] as const;
export type BackgroundEffect = (typeof BACKGROUND_EFFECTS)[number];

export interface PositionedBox {
  x: number;
  y: number;
  w: number;
  h: number;
  // rotation is optional because absence means "no transform" — the renderer
  // emits no rotation CSS at all. `z` is required because stacking order is
  // intrinsic to every element (even at z=0, layout has to commit to a layer).
  rotation?: number;
  z: number;
}

// -- Responsive overrides ---------------------------------------------------
//
// Owner-authored optional overrides per Positioned Element at named
// breakpoints. The responsive translator + CSS emitter live under
// `src/canvas/responsive/`. Both publishing and editor preview consume these.

export const BREAKPOINTS = ['desktop', 'tablet', 'phone'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/**
 * Per-element override at a named breakpoint. Every field is optional — the
 * translator falls back to the canonical desktop `box` for any unspecified
 * dimension. `hidden: true` removes the element entirely at that breakpoint.
 *
 * Box fields are derived from `PositionedBox` so adding a new dimension to
 * the canonical box automatically widens the override shape.
 */
export type ResponsiveBoxOverride = Partial<Pick<PositionedBox, 'x' | 'y' | 'w' | 'h'>> & {
  hidden?: boolean;
};

/**
 * Owner-authored overrides at smaller breakpoints. The canonical desktop box
 * lives on `BaseElement.box` itself, which is why there is no `desktop?`
 * field here — the breakpoint set is "smaller-than-canonical" only.
 */
export interface ResponsiveOverrides {
  tablet?: ResponsiveBoxOverride;
  phone?: ResponsiveBoxOverride;
}

export const BACKGROUND_SIZES = ['cover', 'contain'] as const;
export type BackgroundSize = (typeof BACKGROUND_SIZES)[number];

export const OVERFLOW_VALUES = ['visible', 'hidden'] as const;
export type OverflowValue = (typeof OVERFLOW_VALUES)[number];

export interface ElementStyle {
  backgroundColor?: string;
  backgroundImageAssetId?: string;
  backgroundSize?: BackgroundSize;
  borderRadius?: number;
  borderColor?: string;
  borderWidth?: number;
  opacity?: number;
  boxShadow?: string;
  color?: string;
  overflow?: OverflowValue;
}

/**
 * @internal Shared shape extended by every concrete `*Element` interface.
 * Not a domain object on its own — exported only so element modules in
 * `./elements/*.ts` can `extends BaseElement`.
 */
export interface BaseElement {
  id: string;
  type: ElementType;
  box: PositionedBox;
  motion?: { preset: MotionPreset; delayMs?: number };
  /**
   * Escape hatch: arbitrary CSS custom-property overrides applied to the
   * element's root, untouched by the renderer's element-style serializer.
   * Reserved for one-off visual tweaks the structured `elementStyle` graph
   * cannot express; persists across style-kit changes ("pinned").
   */
  pinnedStyle?: Record<string, string>;
  elementStyle?: ElementStyle;
  /**
   * Omitted on most fixture elements; the translator treats absence as
   * "scale proportionally from desktop box at the smaller breakpoints."
   */
  responsive?: ResponsiveOverrides;
}

export const TEXT_ROLES = ['heading', 'body', 'label'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

// -- CanvasElement discriminated union -------------------------------------
//
// All 14 element interfaces live in `src/canvas/elements/*.ts`. Each file
// owns its interface and renderer together; schema.ts is the root of the
// dependency tree (provides BaseElement and the variant enums) but does not
// define any element interface itself. The `CanvasElement` union pulls each
// interface in via a type-only import; TypeScript handles the cycle between
// schema.ts and elements/*.ts because the references are types, not runtime
// values. Re-exported below so existing `import type { TextElement } from
// '../canvas/schema'` consumers continue to resolve without change.
import type { TextElement } from './elements/text.js';
import type { MediaElement, ImageMediaElement, VideoMediaElement } from './elements/media.js';
import type { ActionElement, ActionHref } from './elements/action.js';
import type { ShapeElement } from './elements/shape.js';
import type { ContainerElement } from './elements/container.js';
import type { AccordionElement } from './elements/accordion.js';
import type { CarouselElement } from './elements/carousel.js';
import type { ChartElement } from './elements/chart.js';
import type { CodeElement } from './elements/code.js';
import type { EmbedElement } from './elements/embed.js';
import type { FormElement } from './elements/form.js';
import type { NavElement } from './elements/nav.js';
import type { TableElement } from './elements/table.js';
import type { CollectionElement } from './elements/collection.js';

// Re-export so callers can keep importing element types from schema. Adding
// a new element type only requires updating the import block above + the
// CanvasElement union; consumers do not need to change their import paths.
export type {
  TextElement,
  MediaElement,
  ImageMediaElement,
  VideoMediaElement,
  ActionElement,
  ActionHref,
  ShapeElement,
  ContainerElement,
};

export type CanvasElement =
  | TextElement
  | MediaElement
  | ActionElement
  | ShapeElement
  | ContainerElement
  | FormElement
  | EmbedElement
  | ChartElement
  | AccordionElement
  | CarouselElement
  | TableElement
  | CodeElement
  | NavElement
  | CollectionElement;

// Compile-time invariants: ELEMENT_TYPES and CanvasElement['type'] must
// stay bidirectionally exhaustive — adding a new element interface without
// listing its `type` literal in ELEMENT_TYPES (or vice-versa) fails
// type-check on one of these two consts. Split into two checks instead of
// an intersection so `@typescript-eslint/no-duplicate-type-constituents`
// doesn't flatten the bidirectional pair.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ELEMENT_TYPES_COVERS_UNION: Exclude<ElementType, CanvasElement['type']> extends never
  ? true
  : never = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UNION_COVERS_ELEMENT_TYPES: Exclude<CanvasElement['type'], ElementType> extends never
  ? true
  : never = true;

// Same invariants for inline mark types ↔ InlineMark variants.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _MARK_TYPES_COVERS_UNION: Exclude<InlineMarkType, InlineMark['type']> extends never
  ? true
  : never = true;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _UNION_COVERS_MARK_TYPES: Exclude<InlineMark['type'], InlineMarkType> extends never
  ? true
  : never = true;

export const SECTION_ROLES = ['header', 'footer', 'body'] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export interface CanvasSection {
  id: string;
  recipeId: SectionRecipeId;
  name: string;
  height: number;
  role?: SectionRole;
  backgroundEffect?: BackgroundEffect;
  entrance?: MotionPreset;
  /**
   * Popup-section trigger. Discriminated by `type` so `exit-intent` cannot
   * carry a `value` and the other two arms require one. Unit of `value`
   * depends on the arm; documented inline because the persistence layer
   * (yjs + data-rev01-trigger-value attribute) shares a single key.
   */
  trigger?:
    | { type: 'exit-intent' }
    | { type: 'delay'; /** Milliseconds after page load. */ value: number }
    | { type: 'scroll'; /** Vertical scroll percentage in [0, 100]. */ value: number };
  /** Owner asset id of an MP4/webm clip played behind the section. Same `*AssetId` shape as image/poster references. */
  backgroundVideoAssetId?: string;
  elements: CanvasElement[];
}

export interface CanvasPage {
  id: string;
  slug: string;
  /**
   * Page display name AND SEO `<title>` source. Required and non-empty — the
   * renderer treats this as the `<title>` value, falling back to the site
   * name only when the field is missing at runtime (cannot happen given the
   * type, but the renderer is defensive).
   */
  title: string;
  /** Canvas width in pixels — the design surface against which element boxes are positioned. */
  width: number;
  sections: CanvasSection[];
  // -- SEO metadata -----------------------------------------------------------
  // Optional everywhere. Renderer falls back to site-level defaults when
  // absent; the sitemap emitter reads `noIndex` to exclude entries.
  description?: string;
  ogImageAssetId?: string;
  /** Absolute URL used verbatim as `<link rel="canonical">`. When unset the SEO emitter composes one from the configured host. */
  canonical?: string;
  noIndex?: boolean;
  /** BCP-47 locale (e.g. 'en', 'ar') — drives `<html lang>` and i18n. */
  locale?: string;
  // -- Page-level motion & layout ---------------------------------------------
  entranceAnimation?: MotionPreset;
  scrollTriggerMode?: ScrollTriggerMode;
  /** Any valid CSS `background` shorthand (color, gradient, `url(...)`); emitted verbatim onto the page wrapper after value-escaping. */
  pageBackground?: string;
  defaultMotionPreset?: MotionPreset;
  /** Vertical gap between sections, in pixels. When unset, sections stack with no flex gap. */
  sectionGap?: number;
  /** Hard cap on rendered page width, in pixels. Clamps `width` downward at render time. */
  maxWidth?: number;
  // -- Page metadata (CMS collections) ----------------------------------------
  publishedDate?: string;
  author?: string;
  tags?: string[];
  category?: string;
}

export interface EditableSite {
  styleKit: StyleKit;
  pages: CanvasPage[];
  /** Site-wide header section shared across all pages. */
  header?: CanvasSection;
  /** Site-wide footer section shared across all pages. */
  footer?: CanvasSection;
  /**
   * Selected when `styleKit === 'custom'`. Required to be present in that
   * case; ignored otherwise.
   */
  customStyleKit?: StyleKitPreset;
  /**
   * Default locale for pages with no explicit `locale`. Optional everywhere;
   * `'en'` when absent.
   */
  defaultLocale?: string;
  /**
   * When true, renderer emits `<meta name="robots" content="noindex">` across
   * every page regardless of per-page settings. Owner switch for "publish but
   * don't expose yet."
   */
  siteNoIndex?: boolean;
  /**
   * When true, public renderer emits both light and dark token blocks plus
   * the inline mode-setter script. Owner-controlled per site.
   */
  darkModeEnabled?: boolean;
  /**
   * Owner-selected favicon asset (ownerAsset.id). Emitted as `<link rel="icon">`
   * across every page. The same `/assets/<id>` URL the publish route uses for
   * any other asset reference — no special handling.
   */
  faviconAssetId?: string;
}

/**
 * A frozen `EditableSite` at publish time, plus the publish counter and
 * timestamp. Structurally identical to the editable site — the rename
 * indicates the value is now immutable, not that the fields differ. Adding
 * a field to `EditableSite` automatically extends the snapshot.
 */
export type PublishedSnapshot = EditableSite & {
  /** Monotonic publish counter, starting at 1. Bumped by +1 per successful publish; not a semver. */
  version: number;
  /** ISO-8601 timestamp in UTC (`new Date().toISOString()`), e.g. `"2026-05-28T14:23:00.000Z"`. */
  publishedAt: string;
};

// -- Style Kit token contract ---------------------------------------------
//
// A Style Kit is a curated visual system — colour, typography, surfaces,
// shapes, actions, and motion — that the editor preview and the published
// renderer translate into a block of `--rev01-*` CSS custom properties on the
// page wrapper. The actual preset DATA lives in `src/canvas/style-kits.ts`
// (one definition shared by editor + public renderer); the schema retains
// only the TYPE so it stays free of runtime data and Cloudflare-bundle weight.
//
// `Record<X, ...>` is intentional: TypeScript enforces that every kit covers
// every value of `SurfaceVariant`, `ActionVariant`, `MotionPreset`. A kit
// that wants the default for a given variant uses `{}` — present, empty.

export interface SurfaceVariantTokens {
  background?: string;
  border?: string;
  shadow?: string;
  radius?: string;
}

export interface ActionVariantTokens {
  background?: string;
  color?: string;
  border?: string;
  weight?: number;
  borderRadius?: string;
  textDecoration?: string;
  backdropFilter?: string;
  boxShadow?: string;
  padding?: string;
  letterSpacing?: string;
}

export interface MotionPresetTokens {
  delayMs?: number;
  transform?: string;
  opacity?: number;
}

export interface StyleKitPreset {
  // Colour
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  // Typography
  fontFamilyDisplay: string;
  fontFamilyBody: string;
  fontFamilyMono: string;
  headingScale: number;
  bodyScale: number;
  labelScale: number;
  lineHeight: number;
  // Surfaces (containers)
  radius: string;
  borderWidth: string;
  shadow: string;
  surfaceVariants: Record<SurfaceVariant, SurfaceVariantTokens>;
  // Shapes
  shapeFill: string;
  shapeStroke: string;
  shapeStrokeWidth: string;
  // Actions
  actionRadius: string;
  actionPadding: string;
  actionVariants: Record<ActionVariant, ActionVariantTokens>;
  // Motion
  motionDurationMs: number;
  motionEasing: string;
  motionPresets: Record<MotionPreset, MotionPresetTokens>;
  /**
   * Partial override applied in dark mode. Any field of the preset may be
   * re-specified; the resolver merges over the light base. Optional
   * everywhere; the four built-in kits leave it unset. `dark` itself is
   * excluded from the partial so nesting (`dark.dark.dark…`) is unrepresentable.
   */
  dark?: Partial<Omit<StyleKitPreset, 'dark'>>;
}
