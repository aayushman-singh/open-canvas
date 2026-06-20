// src/canvas/schema.ts
//
// Canvas document model for the canvas-first POC.
//
// Domain language follows CONTEXT.md: an Editable Site is a set of Canvas
// Pages, each made of Canvas Sections, each containing Positioned Elements.
// A Published Snapshot wraps the same Canvas Pages with publish metadata for
// the visitor-facing site.

import type {
  LayoutTransition,
  LoadExperience as BehaviourLoadExperience,
  MotionSequence,
  RichMotionAsset,
  ScrollScene,
} from './behaviour-primitives.js';

export type { BehaviourLoadExperience, LayoutTransition };

/**
 * The four deterministic built-in kits. Iterating over presets — emitting
 * per-kit CSS, smoke-test loops, editor preview — uses this list.
 */
export const BUILT_IN_STYLE_KITS = [
  'charcoal',
  'orange-editorial',
  'blue-saas',
  'green-organic',
  'ivory-press',
  'midnight-violet',
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
  'rich-motion',
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
  'tabs',
  'flow-container',
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

export const SHAPE_VARIANTS = ['rect', 'pill', 'circle', 'line', 'badge', 'blob', 'icon'] as const;
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

export const IMPORT_ANIMATION_INVENTORY_STATUSES = ['mapped', 'unsupported'] as const;
export type ImportAnimationInventoryStatus = (typeof IMPORT_ANIMATION_INVENTORY_STATUSES)[number];

export const IMPORT_ANIMATION_PRIMITIVES = [
  'motion-preset',
  'motion-sequence',
  'scroll-scene',
  'text-split-target',
  'rich-motion-asset',
  'layout-transition',
  'overlay',
  'load-experience',
  'route-transition',
  'marquee',
  'pointer-fx',
  'video-hover',
] as const;
export type ImportAnimationPrimitive = (typeof IMPORT_ANIMATION_PRIMITIVES)[number];

export const IMPORT_ANIMATION_SOURCE_TRIGGERS = [
  'load',
  'scroll',
  'hover',
  'focus',
  'click',
  'unknown',
] as const;
export type ImportAnimationSourceTrigger = (typeof IMPORT_ANIMATION_SOURCE_TRIGGERS)[number];

export interface ImportAnimationSource {
  name?: string;
  properties: string[];
  durationMs?: number;
  delayMs?: number;
  easing?: string;
  trigger?: ImportAnimationSourceTrigger;
  transform?: string;
  transition?: string;
  animation?: string;
  willChange?: string;
}

export interface ImportAnimationMappedPrimitive {
  kind: ImportAnimationPrimitive;
  id?: string;
  preset?: MotionPreset;
}

export interface ImportAnimationInventoryItem {
  id: string;
  elementId?: string;
  sectionId?: string;
  status: ImportAnimationInventoryStatus;
  source: ImportAnimationSource;
  mappedPrimitive?: ImportAnimationMappedPrimitive;
  unsupportedReason?: string;
}

export interface ImportAnimationInventory {
  sourceUrl?: string;
  capturedAt?: string;
  items: ImportAnimationInventoryItem[];
}

export const MARQUEE_DIRECTIONS = ['left', 'right'] as const;
export type MarqueeDirection = (typeof MARQUEE_DIRECTIONS)[number];

export const MARQUEE_REDUCED_MOTION_MODES = ['static', 'slow'] as const;
export type MarqueeReducedMotionMode = (typeof MARQUEE_REDUCED_MOTION_MODES)[number];
export const MARQUEE_SOURCE_TYPES = ['manual', 'collection-element'] as const;
export type MarqueeSourceType = (typeof MARQUEE_SOURCE_TYPES)[number];
export const MARQUEE_COLLECTION_FIELDS = ['title', 'excerpt', 'all-text'] as const;
export type MarqueeCollectionField = (typeof MARQUEE_COLLECTION_FIELDS)[number];

export type MarqueeSource =
  | { type: 'manual' }
  | {
      type: 'collection-element';
      elementId: string;
      field: MarqueeCollectionField;
      separator?: string;
      maxItems?: number;
    };

export const POINTER_FX_PRIMITIVES = [
  'spotlight',
  'tilt',
  'magnetic',
  'cursor-follow',
  'reveal-mask',
  'pointer-parallax',
  'cursor-trail',
  'image-follow',
  'drag-inertia',
] as const;
export type PointerFxPrimitive = (typeof POINTER_FX_PRIMITIVES)[number];

export const POINTER_FX_REDUCED_MOTION_MODES = ['disabled', 'allow'] as const;
export type PointerFxReducedMotionMode = (typeof POINTER_FX_REDUCED_MOTION_MODES)[number];

export const POINTER_FX_TOUCH_ACTIVATION_MODES = ['none', 'tap', 'toggle'] as const;
export type PointerFxTouchActivationMode = (typeof POINTER_FX_TOUCH_ACTIVATION_MODES)[number];

export const POINTER_FX_DRAG_AXES = ['x', 'y', 'both'] as const;
export type PointerFxDragAxis = (typeof POINTER_FX_DRAG_AXES)[number];

export const NAV_THEME_TARGETS = ['transparent', 'light', 'dark', 'solid'] as const;
export type NavThemeTarget = (typeof NAV_THEME_TARGETS)[number];

export const NAV_THEME_REDUCED_MOTION_MODES = ['instant', 'allow'] as const;
export type NavThemeReducedMotionMode = (typeof NAV_THEME_REDUCED_MOTION_MODES)[number];

export interface NavThemeOnScroll {
  enabled: boolean;
  defaultTheme: NavThemeTarget;
  reducedMotion: NavThemeReducedMotionMode;
}

export interface MarqueeBehaviour {
  enabled: boolean;
  direction: MarqueeDirection;
  speedPxPerSecond: number;
  pauseOnHover?: boolean;
  edgeFade?: boolean;
  hoverReverse?: boolean;
  rows?: number;
  rowGapPx?: number;
  rowOffsetPercent?: number;
  source?: MarqueeSource;
  reducedMotion: MarqueeReducedMotionMode;
}

export interface PointerFxBehaviour {
  enabled: boolean;
  primitive: PointerFxPrimitive;
  previewAssetId?: string;
  reducedMotion: PointerFxReducedMotionMode;
  touchActivation?: PointerFxTouchActivationMode;
  dragAxis?: PointerFxDragAxis;
  inertia?: boolean;
}

export const SCROLL_TRIGGER_MODES = ['on-load', 'on-scroll'] as const;
export type ScrollTriggerMode = (typeof SCROLL_TRIGGER_MODES)[number];

export const OVERLAY_TRIGGER_TYPES = ['load', 'delay', 'scroll', 'exit-intent', 'element-click'] as const;
export type OverlayTriggerType = (typeof OVERLAY_TRIGGER_TYPES)[number];

export const OVERLAY_PRESENTATION_MODES = [
  'modal',
  'fullscreen-menu',
  'lightbox',
  'command-palette',
  'product-tour',
] as const;
export type OverlayPresentationMode = (typeof OVERLAY_PRESENTATION_MODES)[number];
export const OVERLAY_CHROME_PRESETS = ['standard', 'glass-panel', 'editorial-frame'] as const;
export type OverlayChromePreset = (typeof OVERLAY_CHROME_PRESETS)[number];
export const OVERLAY_BACKDROP_STYLES = ['dim', 'blur', 'solid'] as const;
export type OverlayBackdropStyle = (typeof OVERLAY_BACKDROP_STYLES)[number];
export const OVERLAY_CLOSE_PLACEMENTS = ['top-right', 'top-left', 'inside'] as const;
export type OverlayClosePlacement = (typeof OVERLAY_CLOSE_PLACEMENTS)[number];

export interface OverlayPresentation {
  mode: OverlayPresentationMode;
  chrome?: OverlayChromePreset;
  backdrop?: OverlayBackdropStyle;
  closePlacement?: OverlayClosePlacement;
}

export const LOAD_EXPERIENCE_PRESETS = ['fade', 'wipe', 'logo-card', 'progress-bar'] as const;
export type LoadExperiencePreset = (typeof LOAD_EXPERIENCE_PRESETS)[number];

export const LOAD_EXPERIENCE_RUN_POLICIES = ['every-visit', 'once-per-session'] as const;
export type LoadExperienceRunPolicy = (typeof LOAD_EXPERIENCE_RUN_POLICIES)[number];

export const LOAD_EXPERIENCE_GATES = ['document-ready', 'fonts-ready', 'hero-media-ready'] as const;
export type LoadExperienceGate = (typeof LOAD_EXPERIENCE_GATES)[number];

export const ROUTE_TRANSITION_MODES = ['fade', 'slide', 'wipe', 'crossfade', 'mask'] as const;
export type RouteTransitionMode = (typeof ROUTE_TRANSITION_MODES)[number];

export const MOTION_SEQUENCE_LITE_EFFECTS = ['fade', 'slide', 'scale', 'wipe', 'blur'] as const;
export type MotionSequenceLiteEffect = (typeof MOTION_SEQUENCE_LITE_EFFECTS)[number];

export const MOTION_SEQUENCE_LITE_TARGET_TYPES = [
  'page-container',
  'overlay-surface',
  'overlay-backdrop',
  'load-screen-part',
] as const;
export type MotionSequenceLiteTargetType = (typeof MOTION_SEQUENCE_LITE_TARGET_TYPES)[number];

// ADR 0060 / ADR 0063 — CMS collection page kinds.
//
// ADR 0063 dec 2 + F5 — `'collection-index'` is retired. The element-
// level binding (CollectionElement.collectionSlug) is now the only
// source of truth for "what does this Collection list." The on-load
// migration (E2 / site-load-migration.ts) sweeps any legacy in-DB
// pages on first editor load; F3's audit (2026-06-05, Neon) confirmed
// exactly one prod page (pwtest-engineer's collection-blog-index)
// carries the legacy shape and is handled by that migration.
// `validatePage` from this commit onward REJECTS
// `pageKind === 'collection-index'` outright — the migrator's
// legacy-string awareness still lives in
// `editor-client/site-load-migration.ts` (which keys off the literal
// `'collection-index'` against the raw JSONB shape, not this union),
// so removing the value here cannot blind the migration loop.
// `'collection-item-template'` stays because the publish-time clone-
// per-entry pass keys on the page's slug.
export const COLLECTION_PAGE_KINDS = ['collection-item-template'] as const;
export type CollectionPageKind = (typeof COLLECTION_PAGE_KINDS)[number];

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
// intentionally small: bold/italic/underline/strike/code/highlight/link/
// fontSize/color. There are no block-level nodes — a TextElement is always
// a single visual paragraph whose box, alignment, font size, and role come
// from the surrounding fields.
export const INLINE_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'link',
  'fontSize',
  'color',
] as const;
export type InlineMarkType = (typeof INLINE_MARK_TYPES)[number];

// `fontSize` carries a px payload so paste from a heading-with-body source
// can preserve per-run size differences inside a single TextElement (the
// element's own `fontSize` field still drives the no-mark baseline). The
// renderer wraps the run's outer <span> with an inline `font-size:Npx`
// style; no <h1>/<h2> tag substitution happens — block-level role/tag still
// comes from TextElement.role.
export const INLINE_FONT_SIZE_PX_MIN = 8;
export const INLINE_FONT_SIZE_PX_MAX = 200;

// `color` carries a CSS-colour payload (validated as `#RGB`, `#RRGGBB`, or
// `#RRGGBBAA`) so an Owner can recolour a sub-range of a text element via
// the mark toolbar without touching the element-level `elementStyle.color`.
// The renderer stamps `color:<hex>` on the run's outer span — same wrapper
// the `fontSize` mark stamps `font-size:Npx` onto.
//
// Hex-only on purpose: the native `<input type="color">` returns `#RRGGBB`,
// keeping the payload to a single normalised shape avoids variance across
// browsers and CSS named-colour aliases. Validator pattern below.
export const INLINE_COLOR_HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type InlineMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight' }
  | { type: 'link'; href: string; target?: '_blank' }
  | { type: 'fontSize'; px: number }
  | { type: 'color'; color: string };

// Cap on the TeX source carried by a math run. Bounded so a malicious paste
// can't shovel an arbitrary string through validation; KaTeX itself rejects
// anything pathological at render time. 4 KiB covers any realistic inline
// equation pasted from Notion / MathJax / Wikipedia / LaTeX source.
export const INLINE_MATH_TEX_MAX_LEN = 4096;

export interface InlineRun {
  // raw text, no HTML; newlines are literal U+000A. When `math` is present
  // `text` is the plain-text fallback (aria-label / search / plain-text
  // projection) — KaTeX renders `math.tex` for the visible HTML.
  text: string;
  // 0..N marks; order is style-irrelevant but must be deduplicated by type
  marks?: InlineMark[];
  // Optional inline equation. Renderer replaces the run's text body with
  // KaTeX-rendered HTML (server-rendered at publish; lazy-loaded in editor).
  // Paste handler populates this from KaTeX-rendered web sources, inline
  // MathML, and LaTeX delimiters in plain-text pastes.
  math?: { tex: string };
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

/**
 * ADR 0062 — Section accent border. A single-variant accent treatment
 * applied to the section wrapper. Mutually exclusive by construction —
 * picking one shape replaces whichever was previously set, and "no
 * accent" is encoded as the field being absent rather than as a
 * dedicated `{ type: 'none' }` arm.
 *
 *   - `solid`  — 1–2 px solid line around the section, corner-radius
 *                matching the section wrapper (currently 0; renderer
 *                honours border-radius if a future field adds one).
 *   - `top`    — thin color stripe along the top edge only.
 *   - `left`   — vertical color bar along the left edge only.
 *   - `glow`   — soft outer box-shadow halo in the chosen color, no
 *                hard edge. `radius` controls the blur radius; the
 *                optional `spread` controls how far the halo extends.
 *
 * Color values are CSS color strings, validated through the same
 * `validateInjectionSafeString` path as `elementStyle.backgroundColor`
 * and `elementStyle.borderColor`.
 */
export const ACCENT_BORDER_TYPES = ['solid', 'top', 'left', 'glow'] as const;
export type AccentBorderType = (typeof ACCENT_BORDER_TYPES)[number];

export type AccentBorder =
  | { type: 'solid'; color: string; width: number }
  | { type: 'top'; color: string; thickness: number }
  | { type: 'left'; color: string; thickness: number }
  | { type: 'glow'; color: string; radius: number; spread?: number };

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
  marquee?: MarqueeBehaviour;
  pointerFx?: PointerFxBehaviour;
  /**
   * Escape hatch: arbitrary CSS custom-property overrides applied to the
   * element's root, untouched by the renderer's element-style serializer.
   * Reserved for one-off visual tweaks the structured `elementStyle` graph
   * cannot express; persists across style-kit changes ("pinned").
   *
   * Endorsed pinnedStyle key families — these intentionally stay here rather
   * than being promoted to structured `elementStyle` fields, because each
   * one is a single-property visual-effect knob with no design-system
   * relationship to the rest of the structured surface:
   *
   *   - Visual effects:        `backdrop-filter`, `filter`, `mix-blend-mode`,
   *                            `mask`, `mask-image`, `clip-path`
   *   - One-off color tweaks:  raw `color`, `background`, `border-color`
   *                            (when overriding a kit-derived value at a
   *                            single element; otherwise use elementStyle)
   *   - Typography ornaments:  `font-family`, `font-feature-settings`,
   *                            `text-shadow` (typography STRUCTURE — font
   *                            size/weight/wrap/transform/line-height/letter-
   *                            spacing — lives on TextElement directly)
   *
   * If a pinnedStyle key family starts appearing in >3 fixtures in the same
   * shape, that is the signal to promote it to a structured field — not a
   * single appearance.
   */
  pinnedStyle?: Record<string, string>;
  elementStyle?: ElementStyle;
  /**
   * Omitted on most fixture elements; the translator treats absence as
   * "scale proportionally from desktop box at the smaller breakpoints."
   */
  responsive?: ResponsiveOverrides;
  /**
   * Optional public DOM anchor target. When set, the renderer emits
   * `id="<anchorId>"` on the element wrapper so an in-page link
   * `href="#<anchorId>"` resolves to it. ADR 0050 dec 2: strict charset
   * (`/^[a-z][a-z0-9-]*$/`), unique within a page across sections + elements.
   * Storage-key `id` stays private to the document model.
   */
  anchorId?: string;
  /**
   * Optional sticky-scroll offset in px (ADR 0054 dec 1). When set, the
   * renderer switches the element wrapper from `position: absolute` to
   * `position: sticky`, uses `margin-left` / `margin-top` for the initial
   * position from `box.x` / `box.y`, and emits this value as the CSS `top`
   * for the sticky offset. v1 ships top-only; bottom/left/right land as
   * separate fields if a template needs them.
   *
   * NavElement carries its own boolean `sticky` flag (a higher-level
   * "this nav stays pinned to its section" toggle), so the more granular
   * pixel offset lives under a distinct name here to avoid type collision.
   */
  stickyOffset?: number;
}

export const TEXT_ROLES = ['heading', 'body', 'label'] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

// -- CanvasElement discriminated union -------------------------------------
//
// All 17 element interfaces live in `src/canvas/elements/*.ts`. Each file
// owns its interface and renderer together; schema.ts is the root of the
// dependency tree (provides BaseElement and the variant enums) but does not
// define any element interface itself. The `CanvasElement` union pulls each
// interface in via a type-only import; TypeScript handles the cycle between
// schema.ts and elements/*.ts because the references are types, not runtime
// values. Re-exported below so existing `import type { TextElement } from
// '../canvas/schema'` consumers continue to resolve without change.
import type { TextElement } from './elements/text.js';
import type { MediaElement, ImageMediaElement, VideoMediaElement } from './elements/media.js';
import type { RichMotionElement } from './elements/rich-motion.js';
import type { ActionElement, ActionHref, ActionBehavior } from './elements/action.js';
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
import type { TabsElement } from './elements/tabs.js';
import type { FlowContainerElement } from './elements/flow-container.js';

// Re-export so callers can keep importing element types from schema. Adding
// a new element type only requires updating the import block above + the
// CanvasElement union; consumers do not need to change their import paths.
export type {
  TextElement,
  MediaElement,
  ImageMediaElement,
  VideoMediaElement,
  RichMotionElement,
  ActionElement,
  ActionHref,
  ActionBehavior,
  ShapeElement,
  ContainerElement,
  TabsElement,
  FlowContainerElement,
};

export type CanvasElement =
  | TextElement
  | MediaElement
  | RichMotionElement
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
  | CollectionElement
  | TabsElement
  | FlowContainerElement;

// Compile-time invariants: ELEMENT_TYPES and CanvasElement['type'] must
// stay bidirectionally exhaustive — adding a new element interface without
// listing its `type` literal in ELEMENT_TYPES (or vice-versa) fails
// type-check on one of these two consts. Split into two checks instead of
// an intersection so `@typescript-eslint/no-duplicate-type-constituents`
// doesn't flatten the bidirectional pair.

const _ELEMENT_TYPES_COVERS_UNION: Exclude<ElementType, CanvasElement['type']> extends never
  ? true
  : never = true;

const _UNION_COVERS_ELEMENT_TYPES: Exclude<CanvasElement['type'], ElementType> extends never
  ? true
  : never = true;

// Same invariants for inline mark types ↔ InlineMark variants.

const _MARK_TYPES_COVERS_UNION: Exclude<InlineMarkType, InlineMark['type']> extends never
  ? true
  : never = true;

const _UNION_COVERS_MARK_TYPES: Exclude<InlineMark['type'], InlineMarkType> extends never
  ? true
  : never = true;

// ADR 0059 — `'header'` and `'footer'` removed from the union. Pinned
// header/footer live exclusively at `EditableSite.header` and
// `EditableSite.footer`; the only valid role for a page section is
// `'body'` (typically omitted). Whether to delete the field entirely is
// tracked as an ADR 0059 follow-up.
export const SECTION_ROLES = ['body'] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

export interface CanvasSection {
  id: string;
  recipeId: SectionRecipeId;
  name: string;
  height: number;
  role?: SectionRole;
  backgroundEffect?: BackgroundEffect;
  navThemeTarget?: NavThemeTarget;
  /**
   * ADR 0062 — section accent border. Absent = no accent. The four
   * variants are mutually exclusive by construction (discriminated
   * union); setting one replaces whichever was previously set.
   */
  accentBorder?: AccentBorder;
  entrance?: MotionPreset;
  /**
   * Optional public DOM anchor target for the section wrapper. Same contract
   * as `BaseElement.anchorId`. ADR 0050 dec 2.
   */
  anchorId?: string;
  /**
   * Popup-section trigger. Discriminated by `type` so `exit-intent` cannot
   * carry a `value` and the other two arms require one. Unit of `value`
   * depends on the arm; documented inline because the persistence layer
   * (yjs + data-opencanvas-trigger-value attribute) shares a single key.
   */
  trigger?:
    | { type: 'exit-intent' }
    | { type: 'delay'; /** Milliseconds after page load. */ value: number }
    | { type: 'scroll'; /** Vertical scroll percentage in [0, 100]. */ value: number };
  /** Owner asset id of an MP4/webm clip played behind the section. Same `*AssetId` shape as image/poster references. */
  backgroundVideoAssetId?: string;
  /**
   * ADR 0061 Decision 7 — Section Instance scope.
   *
   * Set at instantiation time when a TemplateSeed composition resolves a
   * `SectionInstanceRef` into a concrete `CanvasSection`. Matches the ref's
   * `instanceId` (`/^[a-z][a-z0-9]*$/`). The Section Library row itself
   * never carries this field; it is added only when the Section is
   * materialised into an EditableSite.
   *
   * The renderer emits it as `data-instance-scope` on the section wrapper
   * so anchor href rewriting can scope `#anchor` lookups per instance. The
   * Yjs codec encodes it so post-instantiation state round-trips cleanly.
   */
  instanceScope?: string;
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
  /** ADR 0060 + ADR 0063 F5 — marks a page as a CMS collection surface.
   *  'collection-item-template' = the ghost detail page; the publisher
   *  clones it once per entry, substituting {{field}} placeholders.
   *  Requires `collectionSlug`.
   *
   *  The retired `'collection-index'` value (ADR 0063 dec 2) is no
   *  longer in the union. Legacy in-DB rows are swept on first editor
   *  load by `migrateLegacyCollectionIndexPagesImpl`; the validator
   *  rejects any fresh occurrence with an explicit error. The page-
   *  level binding model is fully replaced by element-level
   *  `CollectionElement.collectionSlug`. */
  pageKind?: CollectionPageKind;
  /** Which collection (e.g. 'blog') this template page binds to. Required
   *  when `pageKind === 'collection-item-template'` per validate.ts. */
  collectionSlug?: string;
  // -- Site-pin opt-out (ADR 0059) --------------------------------------------
  /** When true, the site-level `EditableSite.header` is not rendered on this page. Absent = show. */
  suppressHeader?: boolean;
  /** When true, the site-level `EditableSite.footer` is not rendered on this page. Absent = show. */
  suppressFooter?: boolean;
}

export type InteractionTrigger =
  | { type: 'load' }
  | { type: 'exit-intent' }
  | { type: 'delay'; value: number }
  | { type: 'scroll'; value: number }
  | { type: 'element-click'; targetElementId: string };

export type OverlayScope = { type: 'site' } | { type: 'pages'; pageIds: string[] };

export type MotionSequenceLiteTarget =
  | { type: 'page-container' }
  | { type: 'overlay-surface' }
  | { type: 'overlay-backdrop' }
  | { type: 'load-screen-part'; part: 'shell' | 'brand' | 'progress' };

export interface MotionSequenceLiteStep {
  id: string;
  target: MotionSequenceLiteTarget;
  effect: MotionSequenceLiteEffect;
  delayMs: number;
  durationMs: number;
  easing: string;
}

export interface MotionSequenceLite {
  id: string;
  steps: MotionSequenceLiteStep[];
}

export interface OverlayDismissal {
  closeButton: boolean;
  escape: boolean;
  backdropClick: boolean;
  bodyScrollLock: boolean;
  focusTrap: boolean;
  returnFocus: boolean;
}

export interface Overlay {
  id: string;
  name: string;
  scope: OverlayScope;
  trigger: InteractionTrigger;
  content: CanvasSection;
  /** Visual and interaction presentation of the authored overlay content canvas. */
  presentation?: OverlayPresentation;
  dismissal: OverlayDismissal;
  openSequence?: MotionSequenceLite;
  closeSequence?: MotionSequenceLite;
}

export interface PremiumLoadExperience {
  id: string;
  enabled: boolean;
  preset: LoadExperiencePreset;
  runPolicy: LoadExperienceRunPolicy;
  gates: LoadExperienceGate[];
  timeoutMs: number;
  handoffSequence?: MotionSequenceLite;
}

export function isPremiumLoadExperience(
  load: PremiumLoadExperience | BehaviourLoadExperience | undefined,
): load is PremiumLoadExperience {
  return load !== undefined && 'enabled' in load;
}

export function isBehaviourLoadExperience(
  load: PremiumLoadExperience | BehaviourLoadExperience | undefined,
): load is BehaviourLoadExperience {
  return load !== undefined && 'label' in load;
}

export interface RouteTransition {
  id: string;
  enabled: boolean;
  mode: RouteTransitionMode;
  durationMs: number;
  easing: string;
  sharedElements?: SharedRouteElement[];
  outgoingSequence?: MotionSequenceLite;
  incomingSequence?: MotionSequenceLite;
}

export interface SharedRouteElement {
  id: string;
  sourceElementId: string;
  targetElementId: string;
  viewTransitionName: string;
}

/**
 * ADR 0016 — `styleKit` and `customStyleKit` form a real discriminated union:
 * `customStyleKit` is required exactly when `styleKit === 'custom'` and absent
 * otherwise. The on-disk JSONB shape is unchanged; the type now enforces the
 * relationship the validator already gates.
 */
export type EditableSiteStyleKit =
  | { styleKit: BuiltInStyleKit }
  | { styleKit: 'custom'; customStyleKit: StyleKitPreset };

export const SCROLL_BEHAVIOR_MODES = ['native', 'inertial'] as const;
export type ScrollBehaviorMode = (typeof SCROLL_BEHAVIOR_MODES)[number];

export const SCROLL_BEHAVIOR_REDUCED_MOTION_MODES = ['native', 'disabled'] as const;
export type ScrollBehaviorReducedMotionMode =
  (typeof SCROLL_BEHAVIOR_REDUCED_MOTION_MODES)[number];

export interface SiteScrollBehavior {
  /** Legacy/native browser smooth scrolling switch retained for existing sites. */
  smooth?: boolean;
  /** Anchor landing offset for fixed headers or top chrome. */
  paddingTop?: number;
  /** Owner-authored page scroll mode. `inertial` is hydrated by Runtime Hydrator. */
  mode?: ScrollBehaviorMode;
  /** Required for inertial mode; ignored by native browser smooth scrolling. */
  durationMs?: number;
  /** Explicit reduced-motion policy for inertial mode. */
  reducedMotion?: ScrollBehaviorReducedMotionMode;
}

export interface EditableSiteBase {
  pages: CanvasPage[];
  /** Site-wide header section shared across all pages. */
  header?: CanvasSection;
  /** Site-wide footer section shared across all pages. */
  footer?: CanvasSection;
  overlays?: Overlay[];
  /** Premium load experience (editor panel) or behaviour-primitive load chrome. */
  loadExperience?: PremiumLoadExperience | BehaviourLoadExperience;
  routeTransition?: RouteTransition;
  /** Declarative motion graph owned by schema/validator/runtime, not templates-as-script. */
  motionSequences?: MotionSequence[];
  /** Scroll-driver declarations referenced by motion sequences and rich motion playback. */
  scrollScenes?: ScrollScene[];
  /** Rich-motion asset declarations referenced by later render/runtime tasks. */
  richMotionAssets?: RichMotionAsset[];
  /** Same-page shared-layout transitions owned by the Runtime Hydrator. */
  layoutTransitions?: LayoutTransition[];
  /** Source animation facts captured during import before exact primitive mapping. */
  importAnimationInventory?: ImportAnimationInventory;
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
   * Visitor theme mode for published pages. Per ADR 0035:
   *   - 'light' (or undefined): site renders light-only; no dual-palette
   *     CSS, no anti-flash script, no toggle element.
   *   - 'dark': site renders dark-only; dual-palette CSS emitted with
   *     data-mode='dark' pinned; anti-flash script in its dark-only
   *     form so the attribute is set before first paint; no toggle
   *     element.
   *   - 'toggleable': visitor sees a toggle and defaults to their OS
   *     prefers-color-scheme; anti-flash script emitted, dual-palette
   *     CSS emitted, toggle element auto-injected.
   *
   * Replaces the previous `darkModeEnabled?: boolean` field.
   * Migration (drizzle/0010_visitor_theme_enum.sql) rewrites existing
   * JSONB: `true → 'toggleable'`, anything else removes the key (the
   * default is 'light'). Hard cutover — the validator rejects the old
   * boolean field from this deploy onward per ADR 0035 decision 2.
   */
  visitorTheme?: 'light' | 'dark' | 'toggleable';
  /**
   * Owner-selected favicon asset (ownerAsset.id). Emitted as `<link rel="icon">`
   * across every page. The same `/assets/<id>` URL the publish route uses for
   * any other asset reference — no special handling.
   */
  faviconAssetId?: string;
  /**
   * Site-level page-scroll behaviour. When set, the renderer emits a single
   * `<style>` block at the head of `<main>` that targets
   * `html { scroll-behavior; scroll-padding-top }` per the fields present.
   * ADR 0050 dec 3. Both fields are independent; absence = browser default.
   */
  scrollBehavior?: SiteScrollBehavior;
}

export type EditableSite = EditableSiteBase & EditableSiteStyleKit;

/**
 * Extract the styleKit DU branch from an EditableSite (or any value that
 * conforms to `EditableSiteStyleKit`). Useful at builder sites that reshape
 * an EditableSite into a snapshot or rebuild it from parts — TS narrows the
 * branch here, so callers spread the result without re-discriminating.
 */
export function pickStyleKitField(state: EditableSiteStyleKit): EditableSiteStyleKit {
  if (state.styleKit === 'custom') {
    return { styleKit: 'custom', customStyleKit: state.customStyleKit };
  }
  return { styleKit: state.styleKit };
}

/**
 * Drop the styleKit DU off an EditableSite and return the base shape only.
 * Builders that want to swap one styleKit branch for another use this to
 * strip both `styleKit` and `customStyleKit` in one narrowing-safe move.
 *
 * Strips `customStyleKit` in both branches because persisted JSONB state
 * can carry a stray `customStyleKit` even on built-in records (TypeScript
 * narrowing protects new writes but not migrated/older payloads), and the
 * caller swapping to another built-in must not write the stale custom kit
 * back. Treat the stripped shape as the contract, not the input shape.
 */
export function pickEditableSiteBase(state: EditableSite): EditableSiteBase {
  const {
    customStyleKit: _customStyleKit,
    styleKit: _styleKit,
    ...rest
  } = state as EditableSite & { customStyleKit?: unknown };
  void _customStyleKit;
  void _styleKit;
  return rest;
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
// renderer translate into a block of `--opencanvas-*` CSS custom properties on the
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
  /**
   * Optional semantic tint tokens — names resolved by `ContainerElement.tint`.
   * Each value is a CSS colour. Authors set `tint: 'forest'` on a container
   * and the kit's `tintTokens.forest` provides the actual colour. Falls back
   * to the literal `tint` value when the lookup misses (so raw CSS colours
   * still work without registering a token first).
   *
   * Keys: any non-empty identifier (`/^[a-z][a-z0-9-]*$/`). Values: any CSS
   * colour expression that passes `escapeCssValue`.
   */
  tintTokens?: Record<string, string>;
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
