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
 * `'custom'` (Wave 2 #10 — the resolver pulls tokens from
 * `CanvasSiteState.customStyleKit` instead of `STYLE_KIT_PRESETS`). The
 * built-in presets do not include a `custom` row; resolvers must check the
 * selector before looking up the preset.
 *
 * See docs/superpowers/plans/2026-05-23-10-custom-theme-editor.md.
 */
export const STYLE_KITS = [...BUILT_IN_STYLE_KITS, 'custom'] as const;
export type StyleKit = (typeof STYLE_KITS)[number];

export const ELEMENT_TYPES = [
  'text',
  'media',
  'action',
  'shape',
  'container',
  // Phase 0 scaffold — element bodies defined in `src/canvas/elements/<type>.ts`
  // and re-exported via `src/canvas/elements/index.ts`. Their render stubs
  // throw until the owning wave agent fills them in.
  'symbol-instance',
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

// -- Responsive overrides (Wave 1 #1 — see plan 01-responsive-canvas) -------
//
// Owner-authored optional overrides per Positioned Element at named
// breakpoints. The Phase 0 scaffold declares the types; the responsive
// translator + CSS emitter live under `src/canvas/responsive/` and are filled
// in by the Wave 1 agent. Both publishing and editor preview consume these.

export const BREAKPOINTS = ['desktop', 'tablet', 'phone'] as const;
export type Breakpoint = (typeof BREAKPOINTS)[number];

/**
 * Per-element override at a named breakpoint. Every field is optional — the
 * translator falls back to the canonical desktop `box` for any unspecified
 * dimension. `hidden: true` removes the element entirely at that breakpoint.
 */
export interface ResponsiveBoxOverride {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  hidden?: boolean;
}

export interface ResponsiveOverrides {
  tablet?: ResponsiveBoxOverride;
  phone?: ResponsiveBoxOverride;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  box: PositionedBox;
  motion?: { preset: MotionPreset; delayMs?: number };
  pinnedStyle?: Record<string, string>;
  /**
   * Phase 0 scaffold — Wave 1 (#1) consumes. Omitted on every existing fixture
   * element; the translator treats absence as "scale proportionally from
   * desktop box at the smaller breakpoints."
   */
  responsive?: ResponsiveOverrides;
}

export interface TextElement extends BaseElement {
  type: 'text';
  // 1..N inline runs; the concatenation of run.text is the plain-text
  // projection. Replaces the prior `text: string` field — there is no
  // backwards-compat shim, the dev DB is empty.
  content: InlineRun[];
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

export type ActionHref =
  | { type: 'external'; url: string }
  | { type: 'page'; pageId: string; anchor?: string };

export function resolveActionHref(
  href: ActionHref,
  pages: CanvasPage[],
): string {
  if (href.type === 'external') return href.url;
  const page = pages.find((p) => p.id === href.pageId);
  if (!page) {
    throw new Error(`ActionHref pageId "${href.pageId}" does not reference an existing page`);
  }
  const base = '/' + page.slug;
  return href.anchor ? base + '#' + href.anchor : base;
}

export interface ActionElement extends BaseElement {
  type: 'action';
  label: string;
  href: ActionHref;
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

// -- CanvasElement discriminated union -------------------------------------
//
// The five originals (text, media, action, shape, container) are defined
// inline above for historical reasons; the nine Phase 0 element interfaces
// live in `src/canvas/elements/*.ts` and are re-exported through
// `src/canvas/elements/index.ts`. Each element file imports `BaseElement` and
// related primitives from this module — schema is the root of the dependency
// tree. The `CanvasElement` union pulls each new interface in via a type-only
// import; TypeScript handles the cycle between schema.ts and elements/*.ts
// because the references are types, not runtime values.
import type { AccordionElement } from './elements/accordion.js';
import type { CarouselElement } from './elements/carousel.js';
import type { ChartElement } from './elements/chart.js';
import type { CodeElement } from './elements/code.js';
import type { EmbedElement } from './elements/embed.js';
import type { FormElement } from './elements/form.js';
import type { NavElement } from './elements/nav.js';
import type { SymbolInstanceElement } from './elements/symbol-instance.js';
import type { TableElement } from './elements/table.js';
import type { CollectionElement } from './elements/collection.js';

export type CanvasElement =
  | TextElement
  | MediaElement
  | ActionElement
  | ShapeElement
  | ContainerElement
  | SymbolInstanceElement
  | FormElement
  | EmbedElement
  | ChartElement
  | AccordionElement
  | CarouselElement
  | TableElement
  | CodeElement
  | NavElement
  | CollectionElement;

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
  trigger?: { type: 'exit-intent' | 'delay' | 'scroll'; value?: number };
  backgroundVideo?: string;
  elements: CanvasElement[];
}

// -- SymbolMaster (Wave 3 #14 — see plan 14-symbols) ------------------------
//
// A SymbolMaster is a site-level reusable section. Symbol Instances reference
// it by id (see `SymbolInstanceElement` in `elements/symbol-instance.ts`) and
// optionally override individual inner element fields. Editing the master
// propagates to every instance; overrides survive master edits.
//
// Storage: lives in `CanvasSiteState.symbols[]` for the POC (Yjs-friendly).
// A `siteSymbol` DB table is reserved in Phase 0 for future cross-site
// sharing but is not the source of truth today.
export interface SymbolMaster {
  id: string;
  name: string;
  /** The master content — a complete CanvasSection rendered when an Instance resolves. */
  section: CanvasSection;
}

export interface CanvasPage {
  id: string;
  slug: string;
  /**
   * Page display name AND SEO `<title>` source. Required and non-empty — the
   * SEO plan (#21) treats this as the `<title>` value, falling back to the
   * site name only when the field is missing at runtime (cannot happen given
   * the type, but the renderer is defensive).
   */
  title: string;
  width: number;
  sections: CanvasSection[];
  // -- SEO metadata (Wave 3 #21 — see plan 21-seo-meta) ---------------------
  // Optional everywhere. Renderer falls back to site-level defaults when
  // absent; sitemap (#22) reads `noIndex` to exclude entries.
  description?: string;
  ogImageAssetId?: string;
  canonical?: string;
  noIndex?: boolean;
  /** BCP-47 locale (e.g. 'en', 'ar') — drives `<html lang>` and i18n (Wave 5 #25). */
  locale?: string;
  // -- Page metadata (CMS collections) ----------------------------------------
  publishedDate?: string;
  author?: string;
  tags?: string[];
  category?: string;
}

export interface CanvasSiteState {
  styleKit: StyleKit;
  pages: CanvasPage[];
  /** Site-wide header section shared across all pages. */
  header?: CanvasSection;
  /** Site-wide footer section shared across all pages. */
  footer?: CanvasSection;
  /**
   * Wave 2 #10 — `styleKit === 'custom'` selects this preset. Required to be
   * present when the selector is `'custom'`; ignored otherwise. The Phase 0
   * scaffold leaves enforcement to the Wave 2 owner; until then the renderer
   * still picks built-in presets.
   */
  customStyleKit?: StyleKitPreset;
  /**
   * Wave 3 #14 — site-level symbol masters. Empty array on every existing
   * fixture; the Wave 3 owner adds CRUD that mutates this array.
   */
  symbols: SymbolMaster[];
  /**
   * Wave 5 #25 — default locale for pages with no explicit `locale`. Optional
   * everywhere; `'en'` when absent.
   */
  defaultLocale?: string;
  /**
   * Wave 3 #21 — when true, renderer emits `<meta name="robots" content="noindex">`
   * across every page regardless of per-page settings. Owner switch for
   * "publish but don't expose yet."
   */
  siteNoIndex?: boolean;
  /**
   * Wave 3 #20 — when true, public renderer emits both light and dark token
   * blocks plus the inline mode-setter script. Owner-controlled per site.
   */
  darkModeEnabled?: boolean;
}

export interface PublishedSnapshot {
  version: number;
  publishedAt: string;
  styleKit: StyleKit;
  pages: CanvasPage[];
  /** Mirror of `CanvasSiteState.header`; site-wide header rendered on every page. */
  header?: CanvasSection;
  /** Mirror of `CanvasSiteState.footer`; site-wide footer rendered on every page. */
  footer?: CanvasSection;
  /** Mirror of `CanvasSiteState.customStyleKit` carried through publish. */
  customStyleKit?: StyleKitPreset;
  /** Mirror of `CanvasSiteState.symbols`; the renderer needs masters to resolve instances. */
  symbols?: SymbolMaster[];
  /** Mirror of `CanvasSiteState.defaultLocale`; used by public `<html lang>`. */
  defaultLocale?: string;
  /** Mirror of `CanvasSiteState.siteNoIndex`; used by SEO meta emission. */
  siteNoIndex?: boolean;
  /** Mirror of `CanvasSiteState.darkModeEnabled`; used by visitor-mode CSS emission. */
  darkModeEnabled?: boolean;
}

// -- Style Kit token contract (Task 8) -------------------------------------
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
   * Wave 3 #20 — partial override applied in dark mode. Any field of the
   * preset may be re-specified; the resolver merges over the light base.
   * Optional everywhere; the existing four built-in kits leave it unset for
   * now.
   */
  dark?: Partial<StyleKitPreset>;
}
