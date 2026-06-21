// src/canvas/yjs-projection.ts
//
// Yjs projection module. Frozen contract consumed by version history
// (snapshot capture + restore broadcasts) and co-edit (Y.Doc held in
// SiteRoom DO, autosaved to Postgres).
//
// The canonical operation model per ADR 0007 is a `Y.Doc`. Every other
// subsystem (agent ops, validators, renderer, publish) still consumes the
// JSON `EditableSite`. This module owns the bridge in BOTH directions:
//
//   encodeYDoc(state)  : EditableSite  -> Y.Doc
//   decodeYDoc(doc)    : Y.Doc             -> EditableSite
//   attachAutosave(doc): observe edits, debounce, hand projected JSON to caller
//
// The round-trip invariant `decodeYDoc(encodeYDoc(state)) deepEqual state`
// is the contract — fixtures + the synthetic state in the smoke enforce it.
//
// ----------------------------------------------------------------------------
// Y.Doc structure
// ----------------------------------------------------------------------------
//
// doc.getMap('state'):
//   'styleKit'         -> string                     (one of STYLE_KITS)
//   'customStyleKit'?  -> Y.Map<unknown>             (mirrors StyleKitPreset)
//   'defaultLocale'?   -> string
//   'siteNoIndex'?     -> boolean
//   'visitorTheme'?    -> 'light' | 'dark' | 'toggleable' (ADR 0035)
//   'faviconAssetId'?  -> string
//   'scrollBehavior'?  -> Y.Map<unknown>
//   'overlays'?        -> Y.Array<Y.Map<unknown>>    (Overlay[])
//   'loadExperience'?  -> Y.Map<unknown>             (LoadExperience)
//   'routeTransition'? -> Y.Map<unknown>             (RouteTransition)
//   'motionSequences'? -> Y.Array<Y.Map<unknown>>    (MotionSequence[])
//   'scrollScenes'?    -> Y.Array<Y.Map<unknown>>    (ScrollScene[])
//   'richMotionAssets'? -> Y.Array<Y.Map<unknown>>   (RichMotionAsset[])
//   'pages'            -> Y.Array<Y.Map<unknown>>    (CanvasPage[])
//
// Each CanvasPage Y.Map:
//   'id'              -> string
//   'slug'            -> string
//   'title'           -> string
//   'width'           -> number
//   'description'?    -> string
//   'ogImageAssetId'? -> string
//   'canonical'?      -> string
//   'noIndex'?        -> boolean
//   'locale'?         -> string
//   'pageKind'?       -> 'collection-item-template' (ADR 0060; ADR 0063 F5 retired 'collection-index')
//   'collectionSlug'? -> string                       (ADR 0060)
//   'sections'        -> Y.Array<Y.Map<unknown>>     (CanvasSection[])
//
// Each CanvasSection Y.Map:
//   'id'                -> string
//   'recipeId'          -> string
//   'name'              -> string
//   'height'            -> number
//   'role'?             -> string
//   'anchorId'?         -> string
//   'backgroundEffect'? -> string
//   'accentBorder'?     -> Y.Map<unknown>                (ADR 0062)
//   'entrance'?         -> string
//   'trigger'?          -> Y.Map<unknown>
//   'backgroundVideo'?  -> string
//   'responsiveVariants'? -> Y.Array<Y.Map<unknown>> (ResponsiveLayoutVariant[])
//   'elements'          -> Y.Array<Y.Map<unknown>>   (CanvasElement[])
//
// Each CanvasElement Y.Map mirrors its TS interface field-for-field.
// Compound fields:
//   'box'         -> Y.Map<unknown>                  (PositionedBox)
//   'motion'?     -> Y.Map<unknown>                  ({ preset, delayMs? })
//   'pinnedStyle'?-> Y.Map<string>                   (key -> string)
//   'responsive'? -> Y.Map<unknown>                  (ResponsiveOverrides)
//   'content'?    -> Y.Array<Y.Map<unknown>>         (TextElement.content :: InlineRun[])
//                    Per ADR 0007 "Out of scope" item 1, each run is an
//                    opaque Y.Map; per-character text CRDT is a future ADR.
//   'isRichText'? -> boolean                          (TextElement only; ADR 0060 F1)
//
// InlineRun Y.Map:
//   'text'   -> string
//   'marks'? -> Y.Array<Y.Map<unknown>>              (InlineMark[])
//
// InlineMark Y.Map:
//   'type'  -> string        (one of INLINE_MARK_TYPES)
//   'href'  -> string        (only when type === 'link')
//   'target'-> '_blank'      (only when type === 'link' and target is set)
//   'px'    -> number        (only when type === 'fontSize')
//   'color' -> string        (only when type === 'color'; hex per INLINE_COLOR_HEX_RE)
//
// Determinism rule: encoding the same state twice yields byte-equal updates
// (modulo client id) because we walk fields in a stable order — defined by
// the TypeScript interface declarations and the iteration helpers below —
// and never rely on `Object.keys` insertion order for nested records.
//
// Performance: encode wraps the entire build in a single `doc.transact(...)`
// so observers fire at most once per encode call. Decode is a pure walk —
// it never mutates the doc and never creates intermediate Y types.

import * as Y from 'yjs';

import type {
  ActionBehavior,
  ActionElement,
  ActionHref,
  ActionVariant,
  BaseElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  EditableSiteStyleKit,
  ContainerElement,
  ElementStyle,
  InlineMark,
  InlineRun,
  MediaElement,
  PositionedBox,
  ResponsiveOverrides,
  ShapeElement,
  StyleKit,
  StyleKitPreset,
  TextElement,
  VideoMediaElement,
} from './schema.js';
import { SECTION_ROLES } from './schema.js';
import type {
  AccordionElement,
  AccordionItem,
  CarouselElement,
  CarouselSlide,
  ChartElement,
  ChartSeries,
  CodeElement,
  CollectionElement,
  CollectionSort,
  EmbedElement,
  FormElement,
  FormFieldDef,
  FormStyle,
  FlowContainerElement,
  FlowItem,
  FlowItemResponsiveOverride,
  FlowLayout,
  FlowLayoutResponsiveOverride,
  FlowPadding,
  FlowSpacing,
  NavElement,
  NavLink,
  RichMotionElement,
  TableColumn,
  TableElement,
  TableRow,
  Tab,
  TabsElement,
} from './elements/index.js';
import type { IconName } from './icons.js';
import {
  ACCORDION_STYLE_SPEC,
  ACTION_STYLE_SPEC,
  CAROUSEL_STYLE_SPEC,
  COLLECTION_STYLE_SPEC,
  FORM_STYLE_SPEC,
  NAV_STYLE_SPEC,
  TABS_STYLE_SPEC,
  type ComponentStyleSpec,
} from './elements/component-style.js';

// ----------------------------------------------------------------------------
// encode helpers
// ----------------------------------------------------------------------------

/**
 * Set a key on a Y.Map only when the value is not undefined. The encode side
 * uses "key absence" to express undefined optional fields — round-tripping a
 * JSON `undefined` (or a missing key) through a Y.Map present-with-undefined
 * value would surface as `{ key: undefined }` post-decode and break deep
 * equality with the original JSON.
 */
function setIfDefined<T>(map: Y.Map<unknown>, key: string, value: T | undefined): void {
  if (value !== undefined) map.set(key, value);
}

/**
 * Generic JSON → Y type encoder for the catch-all branches of the sorted-key
 * walkers (`encodeCustomStyleKit`, `encodeNestedTokenRecord`). Those walkers
 * deliberately iterate
 * Object.keys instead of destructuring named fields so future schema additions
 * don't require per-field encode/decode pairs. This function is the terminal
 * case: if a value is a plain object or array rather than a primitive, wrap it
 * in the matching Y type recursively. `decodeJsonValue` reverses.
 */
function encodeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const arr = new Y.Array<unknown>();
    for (const item of value) arr.push([encodeJsonValue(item)]);
    return arr;
  }
  const map = new Y.Map<unknown>();
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const v = record[key];
    if (v === undefined) continue;
    map.set(key, encodeJsonValue(v));
  }
  return map;
}

function decodeJsonValue(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of (value as Y.Map<unknown>).entries()) {
      out[k] = decodeJsonValue(v);
    }
    return out;
  }
  if (value instanceof Y.Array) {
    return (value as Y.Array<unknown>).toArray().map(decodeJsonValue);
  }
  return value;
}

function encodePositionedBox(box: PositionedBox): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('x', box.x);
  out.set('y', box.y);
  out.set('w', box.w);
  out.set('h', box.h);
  out.set('z', box.z);
  setIfDefined(out, 'rotation', box.rotation);
  return out;
}

function encodeMotion(motion: { preset: string; delayMs?: number }): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('preset', motion.preset);
  setIfDefined(out, 'delayMs', motion.delayMs);
  return out;
}

function encodeStringRecord(rec: Record<string, string>): Y.Map<string> {
  const out = new Y.Map<string>();
  for (const key of Object.keys(rec).sort()) {
    const value = rec[key];
    if (value === undefined) continue;
    out.set(key, value);
  }
  return out;
}

function encodeResponsive(r: ResponsiveOverrides): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  // ResponsiveOverrides has stable two-key shape; ordering is deterministic.
  for (const bp of ['tablet', 'phone'] as const) {
    const override = r[bp];
    if (!override) continue;
    const inner = new Y.Map<unknown>();
    setIfDefined(inner, 'x', override.x);
    setIfDefined(inner, 'y', override.y);
    setIfDefined(inner, 'w', override.w);
    setIfDefined(inner, 'h', override.h);
    setIfDefined(inner, 'hidden', override.hidden);
    out.set(bp, inner);
  }
  return out;
}

function encodeInlineMark(mark: InlineMark): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('type', mark.type);
  if (mark.type === 'link') {
    out.set('href', mark.href);
    if (mark.target !== undefined) out.set('target', mark.target);
  }
  if (mark.type === 'fontSize') {
    out.set('px', mark.px);
  }
  if (mark.type === 'color') {
    out.set('color', mark.color);
  }
  return out;
}

function encodeInlineRun(run: InlineRun): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('text', run.text);
  if (run.marks !== undefined) {
    const marks = new Y.Array<Y.Map<unknown>>();
    for (const mark of run.marks) marks.push([encodeInlineMark(mark)]);
    out.set('marks', marks);
  }
  if (run.math !== undefined) {
    const math = new Y.Map<unknown>();
    math.set('tex', run.math.tex);
    out.set('math', math);
  }
  return out;
}

function encodeInlineRuns(runs: InlineRun[]): Y.Array<Y.Map<unknown>> {
  const out = new Y.Array<Y.Map<unknown>>();
  for (const run of runs) out.push([encodeInlineRun(run)]);
  return out;
}

function encodeElementStyle(style: ElementStyle): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  setIfDefined(out, 'backgroundColor', style.backgroundColor);
  setIfDefined(out, 'backgroundImageAssetId', style.backgroundImageAssetId);
  setIfDefined(out, 'backgroundSize', style.backgroundSize);
  setIfDefined(out, 'borderRadius', style.borderRadius);
  setIfDefined(out, 'borderColor', style.borderColor);
  setIfDefined(out, 'borderWidth', style.borderWidth);
  setIfDefined(out, 'opacity', style.opacity);
  setIfDefined(out, 'boxShadow', style.boxShadow);
  setIfDefined(out, 'color', style.color);
  setIfDefined(out, 'overflow', style.overflow);
  return out;
}

function decodeElementStyle(map: Y.Map<unknown>): ElementStyle {
  const out: ElementStyle = {};
  if (map.has('backgroundColor')) out.backgroundColor = map.get('backgroundColor') as string;
  if (map.has('backgroundImageAssetId'))
    out.backgroundImageAssetId = map.get('backgroundImageAssetId') as string;
  if (map.has('backgroundSize'))
    out.backgroundSize = map.get('backgroundSize') as NonNullable<ElementStyle['backgroundSize']>;
  if (map.has('borderRadius')) out.borderRadius = map.get('borderRadius') as number;
  if (map.has('borderColor')) out.borderColor = map.get('borderColor') as string;
  if (map.has('borderWidth')) out.borderWidth = map.get('borderWidth') as number;
  if (map.has('opacity')) out.opacity = map.get('opacity') as number;
  if (map.has('boxShadow')) out.boxShadow = map.get('boxShadow') as string;
  if (map.has('color')) out.color = map.get('color') as string;
  if (map.has('overflow'))
    out.overflow = map.get('overflow') as NonNullable<ElementStyle['overflow']>;
  return out;
}

function encodeBaseElementFields(target: Y.Map<unknown>, el: BaseElement): void {
  target.set('id', el.id);
  target.set('type', el.type);
  target.set('box', encodePositionedBox(el.box));
  if (el.motion !== undefined) target.set('motion', encodeMotion(el.motion));
  if (el.marquee !== undefined) target.set('marquee', encodeJsonValue(el.marquee));
  if (el.pointerFx !== undefined) target.set('pointerFx', encodeJsonValue(el.pointerFx));
  if (el.pinnedStyle !== undefined) target.set('pinnedStyle', encodeStringRecord(el.pinnedStyle));
  if (el.elementStyle !== undefined)
    target.set('elementStyle', encodeElementStyle(el.elementStyle));
  if (el.responsive !== undefined) target.set('responsive', encodeResponsive(el.responsive));
  setIfDefined(target, 'anchorId', el.anchorId);
  setIfDefined(target, 'stickyOffset', el.stickyOffset);
}

function encodeTextElement(el: TextElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('content', encodeInlineRuns(el.content));
  out.set('role', el.role);
  out.set('fontSize', el.fontSize);
  out.set('fontWeight', el.fontWeight);
  out.set('align', el.align);
  setIfDefined(out, 'letterSpacing', el.letterSpacing);
  setIfDefined(out, 'textWrap', el.textWrap);
  setIfDefined(out, 'lineHeight', el.lineHeight);
  setIfDefined(out, 'textTransform', el.textTransform);
  if (el.fluidSize !== undefined) {
    const fluid = new Y.Map<unknown>();
    fluid.set('min', el.fluidSize.min);
    fluid.set('max', el.fluidSize.max);
    fluid.set('vw', el.fluidSize.vw);
    out.set('fluidSize', fluid);
  }
  setIfDefined(out, 'isRichText', el.isRichText);
  return out;
}

function encodeMediaElement(el: MediaElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('mediaKind', el.mediaKind);
  out.set('assetId', el.assetId);
  out.set('alt', el.alt);
  out.set('fit', el.fit);
  if (el.mediaKind === 'video') {
    setIfDefined(out, 'posterAssetId', el.posterAssetId);
    if (el.hoverPlayback !== undefined) {
      out.set('hoverPlayback', encodeJsonValue(el.hoverPlayback));
    }
    if (el.playback !== undefined) {
      const playback = new Y.Map<unknown>();
      setIfDefined(playback, 'autoplay', el.playback.autoplay);
      setIfDefined(playback, 'muted', el.playback.muted);
      setIfDefined(playback, 'loop', el.playback.loop);
      setIfDefined(playback, 'controls', el.playback.controls);
      out.set('playback', playback);
    }
  }
  return out;
}

function encodeRichMotionElement(el: RichMotionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('assetRefId', el.assetRefId);
  out.set('fit', el.fit);
  out.set('label', el.label);
  return out;
}

function encodeActionHref(href: ActionHref): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('type', href.type);
  if (href.type === 'external') {
    out.set('url', href.url);
  } else {
    out.set('pageId', href.pageId);
    setIfDefined(out, 'anchor', href.anchor);
  }
  return out;
}

function encodeActionBehavior(behavior: ActionBehavior): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('type', behavior.type);
  out.set('value', behavior.value);
  return out;
}

function encodeActionElement(el: ActionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  // ADR 0051 dec 1 — label is InlineRun[]; encode via the shared helper so
  // text + action go through one code path.
  out.set('label', encodeInlineRuns(el.label));
  out.set('variant', el.variant);
  if (el.actionStyle !== undefined) {
    out.set('actionStyle', encodeComponentStyle(el.actionStyle as Record<string, unknown>, ACTION_STYLE_SPEC));
  }
  // ADR 0051 dec 2 — optional icon glyph.
  setIfDefined(out, 'iconKind', el.iconKind);
  // ADR 0051 dec 3 — discriminated union: exactly one of href / behavior is
  // set. Encode whichever is present; validation guarantees one-and-only-one
  // at write time, so the encoder doesn't need to defend against both.
  if (el.href !== undefined) {
    out.set('href', encodeActionHref(el.href));
  } else {
    out.set('behavior', encodeActionBehavior(el.behavior));
  }
  return out;
}

function encodeShapeElement(el: ShapeElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('variant', el.variant);
  // ADR 0051 dec 2 — variant 'icon' carries an iconKind glyph name.
  setIfDefined(out, 'iconKind', el.iconKind);
  return out;
}

function encodeContainerElement(el: ContainerElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('variant', el.variant);
  // ADR 0051 dec 5 — optional link target. Outer wrapper becomes <a> when set.
  if (el.linkHref !== undefined) out.set('linkHref', encodeActionHref(el.linkHref));
  setIfDefined(out, 'linkLabel', el.linkLabel);
  // Gap #17 — optional accent.
  setIfDefined(out, 'tint', el.tint);
  setIfDefined(out, 'coverGridId', el.coverGridId);
  return out;
}

function encodeFormFieldDef(field: FormFieldDef): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', field.id);
  out.set('label', field.label);
  out.set('kind', field.kind);
  out.set('required', field.required);
  setIfDefined(out, 'placeholder', field.placeholder);
  if (field.options !== undefined) {
    const options = new Y.Array<Y.Map<unknown>>();
    for (const opt of field.options) {
      const optMap = new Y.Map<unknown>();
      optMap.set('value', opt.value);
      optMap.set('label', opt.label);
      options.push([optMap]);
    }
    out.set('options', options);
  }
  return out;
}

function encodeComponentStyle(
  style: Record<string, unknown>,
  spec: ComponentStyleSpec,
): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  for (const field of spec.fields) {
    setIfDefined(out, field.key, style[field.key]);
  }
  return out;
}

function decodeComponentStyle(
  map: Y.Map<unknown>,
  spec: ComponentStyleSpec,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of spec.fields) {
    if (map.has(field.key)) {
      out[field.key] = map.get(field.key);
    }
  }
  return out;
}

function decodeFormStyle(map: Y.Map<unknown>): FormStyle {
  return decodeComponentStyle(map, FORM_STYLE_SPEC);
}

function encodeFormElement(el: FormElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  const fields = new Y.Array<Y.Map<unknown>>();
  for (const field of el.fields) fields.push([encodeFormFieldDef(field)]);
  out.set('fields', fields);
  out.set('submitLabel', el.submitLabel);
  out.set('successMessage', el.successMessage);
  setIfDefined(out, 'webhookUrl', el.webhookUrl);
  setIfDefined(out, 'variant', el.variant); // ADR 0066
  if (el.formStyle !== undefined) {
    out.set(
      'formStyle',
      encodeComponentStyle(el.formStyle as Record<string, unknown>, FORM_STYLE_SPEC),
    );
  }
  return out;
}

function encodeEmbedElement(el: EmbedElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('url', el.url);
  setIfDefined(out, 'title', el.title);
  setIfDefined(out, 'aspectRatio', el.aspectRatio);
  setIfDefined(out, 'drillInEnabled', el.drillInEnabled);
  setIfDefined(out, 'drillInReducedMotion', el.drillInReducedMotion);
  return out;
}

function encodeChartSeries(s: ChartSeries): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('label', s.label);
  const values = new Y.Array<number>();
  for (const v of s.values) values.push([v]);
  out.set('values', values);
  return out;
}

function encodeChartElement(el: ChartElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('kind', el.kind);
  const series = new Y.Array<Y.Map<unknown>>();
  for (const s of el.series) series.push([encodeChartSeries(s)]);
  out.set('series', series);
  const categories = new Y.Array<string>();
  for (const c of el.categories) categories.push([c]);
  out.set('categories', categories);
  setIfDefined(out, 'xAxisTitle', el.xAxisTitle);
  setIfDefined(out, 'yAxisTitle', el.yAxisTitle);
  out.set('showLegend', el.showLegend);
  return out;
}

function encodeAccordionItem(item: AccordionItem): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', item.id);
  out.set('title', item.title);
  out.set('body', encodeInlineRuns(item.body));
  return out;
}

function encodeAccordionElement(el: AccordionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  const items = new Y.Array<Y.Map<unknown>>();
  for (const item of el.items) items.push([encodeAccordionItem(item)]);
  out.set('items', items);
  out.set('allowMultipleOpen', el.allowMultipleOpen);
  setIfDefined(out, 'variant', el.variant); // ADR 0066
  if (el.accordionStyle !== undefined) {
    out.set(
      'accordionStyle',
      encodeComponentStyle(el.accordionStyle as Record<string, unknown>, ACCORDION_STYLE_SPEC),
    );
  }
  return out;
}

function encodeCarouselSlide(slide: CarouselSlide): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', slide.id);
  out.set('assetId', slide.assetId);
  setIfDefined(out, 'caption', slide.caption);
  setIfDefined(out, 'href', slide.href);
  return out;
}

function encodeCarouselElement(el: CarouselElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  const slides = new Y.Array<Y.Map<unknown>>();
  for (const slide of el.slides) slides.push([encodeCarouselSlide(slide)]);
  out.set('slides', slides);
  out.set('showArrows', el.showArrows);
  out.set('showDots', el.showDots);
  setIfDefined(out, 'mode', el.mode);
  setIfDefined(out, 'variant', el.variant); // ADR 0066
  if (el.carouselStyle !== undefined) {
    out.set(
      'carouselStyle',
      encodeComponentStyle(el.carouselStyle as Record<string, unknown>, CAROUSEL_STYLE_SPEC),
    );
  }
  return out;
}

function encodeTableColumn(col: TableColumn): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', col.id);
  out.set('header', col.header);
  setIfDefined(out, 'align', col.align);
  return out;
}

function encodeTableRow(row: TableRow): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', row.id);
  out.set('cells', encodeStringRecord(row.cells));
  return out;
}

function encodeTableElement(el: TableElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  const columns = new Y.Array<Y.Map<unknown>>();
  for (const c of el.columns) columns.push([encodeTableColumn(c)]);
  out.set('columns', columns);
  const rows = new Y.Array<Y.Map<unknown>>();
  for (const r of el.rows) rows.push([encodeTableRow(r)]);
  out.set('rows', rows);
  out.set('zebra', el.zebra);
  out.set('collapseOnPhone', el.collapseOnPhone);
  return out;
}

function encodeCodeElement(el: CodeElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('language', el.language);
  out.set('source', el.source);
  out.set('showLineNumbers', el.showLineNumbers);
  return out;
}

function encodeNavLink(link: NavLink): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('label', link.label);
  out.set('href', link.href);
  out.set('kind', link.kind);
  return out;
}

function encodeNavElement(el: NavElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  setIfDefined(out, 'logoAssetId', el.logoAssetId);
  setIfDefined(out, 'siteTitle', el.siteTitle);
  if (el.primaryAction !== undefined) {
    out.set('primaryAction', encodeNavLink(el.primaryAction));
  }
  const links = new Y.Array<Y.Map<unknown>>();
  for (const link of el.links) links.push([encodeNavLink(link)]);
  out.set('links', links);
  out.set('layout', el.layout);
  out.set('sticky', el.sticky);
  if (el.themeOnScroll !== undefined) {
    const theme = new Y.Map<unknown>();
    theme.set('enabled', el.themeOnScroll.enabled);
    theme.set('defaultTheme', el.themeOnScroll.defaultTheme);
    theme.set('reducedMotion', el.themeOnScroll.reducedMotion);
    out.set('themeOnScroll', theme);
  }
  if (el.navStyle !== undefined) {
    out.set('navStyle', encodeComponentStyle(el.navStyle as Record<string, unknown>, NAV_STYLE_SPEC));
  }
  return out;
}

function encodeTabsElement(el: TabsElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('activeTabId', el.activeTabId);
  setIfDefined(out, 'tabBarHeight', el.tabBarHeight);
  setIfDefined(out, 'variant', el.variant); // ADR 0066
  if (el.tabsStyle !== undefined) {
    out.set(
      'tabsStyle',
      encodeComponentStyle(el.tabsStyle as Record<string, unknown>, TABS_STYLE_SPEC),
    );
  }
  const tabsArr = new Y.Array<Y.Map<unknown>>();
  for (const tab of el.tabs) {
    const tabMap = new Y.Map<unknown>();
    tabMap.set('id', tab.id);
    tabMap.set('label', encodeInlineRuns(tab.label));
    const elements = new Y.Array<Y.Map<unknown>>();
    for (const child of tab.elements) elements.push([encodeElement(child)]);
    tabMap.set('elements', elements);
    tabsArr.push([tabMap]);
  }
  out.set('tabs', tabsArr);
  return out;
}

function encodeFlowSpacing(spacing: FlowSpacing): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('row', spacing.row);
  out.set('column', spacing.column);
  return out;
}

function encodeFlowPadding(padding: FlowPadding): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('top', padding.top);
  out.set('right', padding.right);
  out.set('bottom', padding.bottom);
  out.set('left', padding.left);
  return out;
}

function encodeFlowLayoutResponsiveOverride(
  override: FlowLayoutResponsiveOverride,
): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  if (override.gap !== undefined) out.set('gap', encodeFlowSpacing(override.gap));
  if (override.padding !== undefined) out.set('padding', encodeFlowPadding(override.padding));
  setIfDefined(out, 'align', override.align);
  setIfDefined(out, 'justify', override.justify);
  setIfDefined(out, 'wrap', override.wrap);
  setIfDefined(out, 'columns', override.columns);
  return out;
}

function encodeFlowLayout(layout: FlowLayout): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('mode', layout.mode);
  out.set('gap', encodeFlowSpacing(layout.gap));
  out.set('padding', encodeFlowPadding(layout.padding));
  out.set('align', layout.align);
  out.set('justify', layout.justify);
  setIfDefined(out, 'wrap', layout.wrap);
  setIfDefined(out, 'columns', layout.columns);
  if (layout.responsive !== undefined) {
    const responsive = new Y.Map<unknown>();
    for (const bp of ['tablet', 'phone'] as const) {
      const override = layout.responsive[bp];
      if (override !== undefined) {
        responsive.set(bp, encodeFlowLayoutResponsiveOverride(override));
      }
    }
    out.set('responsive', responsive);
  }
  return out;
}

function encodeFlowItemResponsiveOverride(override: FlowItemResponsiveOverride): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  setIfDefined(out, 'span', override.span);
  setIfDefined(out, 'align', override.align);
  setIfDefined(out, 'hidden', override.hidden);
  setIfDefined(out, 'order', override.order);
  return out;
}

function encodeFlowItem(item: FlowItem): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', item.id);
  out.set('element', encodeElement(item.element));
  setIfDefined(out, 'span', item.span);
  setIfDefined(out, 'align', item.align);
  if (item.responsive !== undefined) {
    const responsive = new Y.Map<unknown>();
    for (const bp of ['tablet', 'phone'] as const) {
      const override = item.responsive[bp];
      if (override !== undefined) {
        responsive.set(bp, encodeFlowItemResponsiveOverride(override));
      }
    }
    out.set('responsive', responsive);
  }
  return out;
}

function encodeFlowContainerElement(el: FlowContainerElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('layout', encodeFlowLayout(el.layout));
  const items = new Y.Array<Y.Map<unknown>>();
  for (const item of el.items) items.push([encodeFlowItem(item)]);
  out.set('items', items);
  return out;
}

function encodeCollectionElement(el: CollectionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  // ADR 0063 canonical fields. `collectionSlug` is the only required-ish
  // axis at the type level (absence = unbound); `sort` / `display` /
  // `manualOrder` / `folder` ride through as plain values.
  if (el.collectionSlug !== undefined) out.set('collectionSlug', el.collectionSlug);
  if (el.folder !== undefined) out.set('folder', el.folder);
  if (el.display !== undefined) out.set('display', el.display);
  if (el.sort !== undefined) out.set('sort', el.sort);
  if (el.gallery !== undefined) {
    const gallery = new Y.Map<unknown>();
    gallery.set('mode', el.gallery.mode);
    gallery.set('detailMode', el.gallery.detailMode);
    gallery.set('reducedMotion', el.gallery.reducedMotion);
    if (el.gallery.sliderAxis !== undefined) {
      gallery.set('sliderAxis', el.gallery.sliderAxis);
    }
    if (el.gallery.sliderInertia !== undefined) {
      gallery.set('sliderInertia', el.gallery.sliderInertia);
    }
    if (el.gallery.showProgress !== undefined) {
      gallery.set('showProgress', el.gallery.showProgress);
    }
    if (el.gallery.videoHover !== undefined) {
      const videoHover = new Y.Map<unknown>();
      videoHover.set('enabled', el.gallery.videoHover.enabled);
      videoHover.set('mode', el.gallery.videoHover.mode);
      videoHover.set('reducedMotion', el.gallery.videoHover.reducedMotion);
      if (el.gallery.videoHover.scrubOnHover !== undefined) {
        videoHover.set('scrubOnHover', el.gallery.videoHover.scrubOnHover);
      }
      if (el.gallery.videoHover.streamAssetId !== undefined) {
        videoHover.set('streamAssetId', el.gallery.videoHover.streamAssetId);
      }
      if (el.gallery.videoHover.streamPosterAssetId !== undefined) {
        videoHover.set('streamPosterAssetId', el.gallery.videoHover.streamPosterAssetId);
      }
      if (el.gallery.videoHover.intentDelayMs !== undefined) {
        videoHover.set('intentDelayMs', el.gallery.videoHover.intentDelayMs);
      }
      gallery.set('videoHover', videoHover);
    }
    out.set('gallery', gallery);
  }
  if (el.search !== undefined) {
    const search = new Y.Map<unknown>();
    search.set('enabled', el.search.enabled);
    search.set('reducedMotion', el.search.reducedMotion);
    if (el.search.placeholder !== undefined) {
      search.set('placeholder', el.search.placeholder);
    }
    if (el.search.emptyMessage !== undefined) {
      search.set('emptyMessage', el.search.emptyMessage);
    }
    out.set('search', search);
  }
  if (el.filterChips !== undefined) {
    const filterChips = new Y.Map<unknown>();
    filterChips.set('enabled', el.filterChips.enabled);
    filterChips.set('field', el.filterChips.field);
    filterChips.set('reducedMotion', el.filterChips.reducedMotion);
    const options = new Y.Array<Y.Map<unknown>>();
    for (const option of el.filterChips.options) {
      const encodedOption = new Y.Map<unknown>();
      encodedOption.set('label', option.label);
      encodedOption.set('value', option.value);
      options.push([encodedOption]);
    }
    filterChips.set('options', options);
    if (el.filterChips.defaultValue !== undefined) {
      filterChips.set('defaultValue', el.filterChips.defaultValue);
    }
    out.set('filterChips', filterChips);
  }
  if (el.entryMetadata !== undefined) {
    const metadataRows = new Y.Array<Y.Map<unknown>>();
    for (const metadata of el.entryMetadata) {
      const row = new Y.Map<unknown>();
      row.set('slug', metadata.slug);
      row.set('title', metadata.title);
      row.set('folder', metadata.folder);
      row.set('category', metadata.category);
      const tags = new Y.Array<string>();
      for (const tag of metadata.tags) tags.push([tag]);
      row.set('tags', tags);
      metadataRows.push([row]);
    }
    out.set('entryMetadata', metadataRows);
  }
  if (el.viewToggle !== undefined) {
    const viewToggle = new Y.Map<unknown>();
    viewToggle.set('enabled', el.viewToggle.enabled);
    viewToggle.set('defaultMode', el.viewToggle.defaultMode);
    viewToggle.set('reducedMotion', el.viewToggle.reducedMotion);
    out.set('viewToggle', viewToggle);
  }
  if (el.manualOrder !== undefined) {
    const arr = new Y.Array<string>();
    for (const id of el.manualOrder) arr.push([id]);
    out.set('manualOrder', arr);
  }
  if (el.collectionStyle !== undefined) {
    out.set(
      'collectionStyle',
      encodeComponentStyle(el.collectionStyle as Record<string, unknown>, COLLECTION_STYLE_SPEC),
    );
  }
  if (el.entries !== undefined) {
    const entries = new Y.Array<Y.Array<Y.Map<unknown>>>();
    for (const entry of el.entries) {
      const row = new Y.Array<Y.Map<unknown>>();
      for (const child of entry) row.push([encodeElement(child)]);
      entries.push([row]);
    }
    out.set('entries', entries);
  }
  // ADR 0065 D2 — `customTemplate` is a flat element subtree (not a
  // matrix), so the encoding is one Y.Array of Y.Map<unknown> entries.
  // Symmetric with the decode walker below.
  if (el.customTemplate !== undefined) {
    const tmpl = new Y.Array<Y.Map<unknown>>();
    for (const child of el.customTemplate) tmpl.push([encodeElement(child)]);
    out.set('customTemplate', tmpl);
  }
  return out;
}

// ----------------------------------------------------------------------------
// Y_ENCODE_DISPATCH (ADR 0011 Step 4)
// ----------------------------------------------------------------------------
//
// The encode/decode pair is the highest-severity drift locus in the
// per-element fanout: encoder + decoder live ~250 lines apart in this file,
// and a missing case in either is a silent data-loss bug on round-trip.
//
// `Y_ENCODE_DISPATCH` formalises what the existing exhaustive switch
// guaranteed at compile time; `Y_DECODE_DISPATCH` (below) does the same for
// the decoder side, which previously inlined every case. The mapped type
// makes "added an ElementType but forgot to wire its encoder/decoder" a
// TypeScript compile error in both directions.
type YEncodeDispatch = {
  [K in CanvasElement['type']]: (el: Extract<CanvasElement, { type: K }>) => Y.Map<unknown>;
};

export const Y_ENCODE_DISPATCH: YEncodeDispatch = {
  text: encodeTextElement,
  media: encodeMediaElement,
  'rich-motion': encodeRichMotionElement,
  action: encodeActionElement,
  shape: encodeShapeElement,
  container: encodeContainerElement,
  form: encodeFormElement,
  embed: encodeEmbedElement,
  chart: encodeChartElement,
  accordion: encodeAccordionElement,
  carousel: encodeCarouselElement,
  table: encodeTableElement,
  code: encodeCodeElement,
  nav: encodeNavElement,
  collection: encodeCollectionElement,
  tabs: encodeTabsElement,
  'flow-container': encodeFlowContainerElement,
};

function encodeElement(el: CanvasElement): Y.Map<unknown> {
  // `el.type` indexes a mapped-type record; TypeScript narrows the encoder
  // arg type per case. The runtime guard against an unknown type at the
  // JSONB boundary (legacy data, failed migration) mirrors renderElementBody.
  const fn = (Y_ENCODE_DISPATCH as Record<string, (e: CanvasElement) => Y.Map<unknown>>)[el.type];
  if (typeof fn !== 'function') {
    throw new Error(
      `yjs-projection: no Y_ENCODE_DISPATCH entry for element type=${JSON.stringify(el.type)} id=${JSON.stringify(el.id)}`,
    );
  }
  return fn(el);
}

function encodeSection(section: CanvasSection): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', section.id);
  out.set('recipeId', section.recipeId);
  out.set('name', section.name);
  out.set('height', section.height);
  setIfDefined(out, 'role', section.role);
  setIfDefined(out, 'anchorId', section.anchorId);
  setIfDefined(out, 'backgroundEffect', section.backgroundEffect);
  setIfDefined(out, 'navThemeTarget', section.navThemeTarget);
  // ADR 0062 — discriminated-union accent border. Encoded as a nested
  // Y.Map keyed by the union's `type` discriminator plus the arm-specific
  // fields. Mirrors the `trigger` encoding above.
  if (section.accentBorder !== undefined) {
    const ab = new Y.Map<unknown>();
    ab.set('type', section.accentBorder.type);
    ab.set('color', section.accentBorder.color);
    if (section.accentBorder.type === 'solid') {
      ab.set('width', section.accentBorder.width);
    } else if (section.accentBorder.type === 'top' || section.accentBorder.type === 'left') {
      ab.set('thickness', section.accentBorder.thickness);
    } else {
      ab.set('radius', section.accentBorder.radius);
      if (section.accentBorder.spread !== undefined) {
        ab.set('spread', section.accentBorder.spread);
      }
    }
    out.set('accentBorder', ab);
  }
  setIfDefined(out, 'entrance', section.entrance);
  if (section.trigger !== undefined) {
    const trigger = new Y.Map<unknown>();
    trigger.set('type', section.trigger.type);
    if (section.trigger.type !== 'exit-intent') {
      trigger.set('value', section.trigger.value);
    }
    out.set('trigger', trigger);
  }
  setIfDefined(out, 'backgroundVideoAssetId', section.backgroundVideoAssetId);
  // ADR 0061 Decision 7 — instanceScope round-trips so post-instantiation
  // state survives Yjs encode/decode. Library rows never carry it; only
  // sections materialised via instantiateTemplate do.
  setIfDefined(out, 'instanceScope', section.instanceScope);
  if (section.responsive !== undefined) {
    out.set('responsive', encodeJsonValue(section.responsive));
  }
  if (section.responsiveVariants !== undefined) {
    const variants = new Y.Array<Y.Map<unknown>>();
    for (const variant of section.responsiveVariants) {
      const item = new Y.Map<unknown>();
      item.set('id', variant.id);
      item.set('breakpoint', variant.breakpoint);
      item.set('contentSourceId', variant.contentSourceId);
      const elementIds = new Y.Array<string>();
      for (const elementId of variant.elementIds) elementIds.push([elementId]);
      item.set('elementIds', elementIds);
      variants.push([item]);
    }
    out.set('responsiveVariants', variants);
  }
  const elements = new Y.Array<Y.Map<unknown>>();
  for (const el of section.elements) elements.push([encodeElement(el)]);
  out.set('elements', elements);
  return out;
}

function encodePage(page: CanvasPage): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', page.id);
  out.set('slug', page.slug);
  out.set('title', page.title);
  out.set('width', page.width);
  setIfDefined(out, 'description', page.description);
  setIfDefined(out, 'ogImageAssetId', page.ogImageAssetId);
  setIfDefined(out, 'canonical', page.canonical);
  setIfDefined(out, 'noIndex', page.noIndex);
  setIfDefined(out, 'locale', page.locale);
  setIfDefined(out, 'entranceAnimation', page.entranceAnimation);
  setIfDefined(out, 'scrollTriggerMode', page.scrollTriggerMode);
  setIfDefined(out, 'pageBackground', page.pageBackground);
  setIfDefined(out, 'defaultMotionPreset', page.defaultMotionPreset);
  setIfDefined(out, 'sectionGap', page.sectionGap);
  setIfDefined(out, 'maxWidth', page.maxWidth);
  setIfDefined(out, 'publishedDate', page.publishedDate);
  setIfDefined(out, 'author', page.author);
  if (page.tags !== undefined) {
    const tags = new Y.Array<string>();
    for (const tag of page.tags) tags.push([tag]);
    out.set('tags', tags);
  }
  setIfDefined(out, 'category', page.category);
  setIfDefined(out, 'pageKind', page.pageKind);
  setIfDefined(out, 'collectionSlug', page.collectionSlug);
  // ADR 0059 — per-page suppression of the site-level header/footer.
  setIfDefined(out, 'suppressHeader', page.suppressHeader);
  setIfDefined(out, 'suppressFooter', page.suppressFooter);
  // ADR 0060 — CMS collection template metadata.
  setIfDefined(out, 'pageKind', page.pageKind);
  setIfDefined(out, 'collectionSlug', page.collectionSlug);
  const sections = new Y.Array<Y.Map<unknown>>();
  for (const section of page.sections) sections.push([encodeSection(section)]);
  out.set('sections', sections);
  return out;
}

function encodeCustomStyleKit(preset: StyleKitPreset): Y.Map<unknown> {
  // The preset is a plain JSON tree with a known field set. We store it as
  // a Y.Map of primitives + nested Y.Maps for the three Record<X, Tokens>
  // fields. Determinism: iterate fields in a fixed alphabetical order.
  //
  // We deliberately don't deconstruct the preset by name here — instead we
  // walk its keys in sorted order so that this stays in sync if the type
  // adds optional fields later (the Wave 2 theme editor may extend it).
  const out = new Y.Map<unknown>();
  for (const key of Object.keys(preset).sort()) {
    const value = (preset as unknown as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'surfaceVariants' || key === 'actionVariants' || key === 'motionPresets') {
      out.set(key, encodeNestedTokenRecord(value as Record<string, Record<string, unknown>>));
      continue;
    }
    if (key === 'dark' && value !== null && typeof value === 'object') {
      out.set(key, encodeCustomStyleKit(value as StyleKitPreset));
      continue;
    }
    out.set(key, encodeJsonValue(value));
  }
  return out;
}

function encodeNestedTokenRecord(
  rec: Record<string, Record<string, unknown>>,
): Y.Map<Y.Map<unknown>> {
  const out = new Y.Map<Y.Map<unknown>>();
  for (const outerKey of Object.keys(rec).sort()) {
    const inner = rec[outerKey];
    if (inner === undefined) continue;
    const innerMap = new Y.Map<unknown>();
    for (const innerKey of Object.keys(inner).sort()) {
      const innerValue = inner[innerKey];
      if (innerValue === undefined) continue;
      innerMap.set(innerKey, encodeJsonValue(innerValue));
    }
    out.set(outerKey, innerMap);
  }
  return out;
}

/**
 * Encode an EditableSite into a fresh Y.Doc.
 *
 * One transaction wraps the entire encode so a downstream `attachAutosave`
 * sees a single update event per encode call rather than one per nested set.
 */
export function encodeYDoc(state: EditableSite): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const root = doc.getMap<unknown>('state');
    root.set('styleKit', state.styleKit);
    if (state.styleKit === 'custom') {
      root.set('customStyleKit', encodeCustomStyleKit(state.customStyleKit));
    }
    setIfDefined(root, 'defaultLocale', state.defaultLocale);
    setIfDefined(root, 'siteNoIndex', state.siteNoIndex);
    setIfDefined(root, 'visitorTheme', state.visitorTheme);
    setIfDefined(root, 'faviconAssetId', state.faviconAssetId);
    if (state.scrollBehavior !== undefined) {
      const scroll = new Y.Map<unknown>();
      setIfDefined(scroll, 'smooth', state.scrollBehavior.smooth);
      setIfDefined(scroll, 'paddingTop', state.scrollBehavior.paddingTop);
      setIfDefined(scroll, 'mode', state.scrollBehavior.mode);
      setIfDefined(scroll, 'durationMs', state.scrollBehavior.durationMs);
      setIfDefined(scroll, 'reducedMotion', state.scrollBehavior.reducedMotion);
      root.set('scrollBehavior', scroll);
    }
    if (state.overlays !== undefined) root.set('overlays', encodeJsonValue(state.overlays));
    if (state.loadExperience !== undefined) {
      root.set('loadExperience', encodeJsonValue(state.loadExperience));
    }
    if (state.routeTransition !== undefined) {
      root.set('routeTransition', encodeJsonValue(state.routeTransition));
    }
    if (state.motionSequences !== undefined) {
      root.set('motionSequences', encodeJsonValue(state.motionSequences));
    }
    if (state.scrollScenes !== undefined) {
      root.set('scrollScenes', encodeJsonValue(state.scrollScenes));
    }
    if (state.layoutTransitions !== undefined) {
      root.set('layoutTransitions', encodeJsonValue(state.layoutTransitions));
    }
    if (state.richMotionAssets !== undefined) {
      root.set('richMotionAssets', encodeJsonValue(state.richMotionAssets));
    }
    if (state.fontFaces !== undefined) {
      root.set('fontFaces', encodeJsonValue(state.fontFaces));
    }
    if (state.anchorRails !== undefined) {
      root.set('anchorRails', encodeJsonValue(state.anchorRails));
    }
    if (state.playableWidgets !== undefined) {
      root.set('playableWidgets', encodeJsonValue(state.playableWidgets));
    }
    if (state.importAnimationInventory !== undefined) {
      root.set('importAnimationInventory', encodeJsonValue(state.importAnimationInventory));
    }

    const pages = new Y.Array<Y.Map<unknown>>();
    for (const page of state.pages) pages.push([encodePage(page)]);
    root.set('pages', pages);

    if (state.header !== undefined) root.set('header', encodeSection(state.header));
    if (state.footer !== undefined) root.set('footer', encodeSection(state.footer));
  });
  return doc;
}

// ----------------------------------------------------------------------------
// decode helpers — pure walks, no Y.Doc mutations
// ----------------------------------------------------------------------------

function decodeStringRecord(map: Y.Map<string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of map.entries()) out[k] = v;
  return out;
}

function decodePositionedBox(map: Y.Map<unknown>): PositionedBox {
  const box: PositionedBox = {
    x: map.get('x') as number,
    y: map.get('y') as number,
    w: map.get('w') as number,
    h: map.get('h') as number,
    z: map.get('z') as number,
  };
  if (map.has('rotation')) box.rotation = map.get('rotation') as number;
  return box;
}

type MotionShape = NonNullable<BaseElement['motion']>;
function decodeMotion(map: Y.Map<unknown>): MotionShape {
  const preset = map.get('preset') as MotionShape['preset'];
  const motion: MotionShape = { preset };
  if (map.has('delayMs')) motion.delayMs = map.get('delayMs') as number;
  return motion;
}

function decodeResponsive(map: Y.Map<unknown>): ResponsiveOverrides {
  const out: ResponsiveOverrides = {};
  for (const bp of ['tablet', 'phone'] as const) {
    if (!map.has(bp)) continue;
    const inner = map.get(bp) as Y.Map<unknown>;
    const override: ResponsiveOverrides[typeof bp] = {};
    if (inner.has('x')) override.x = inner.get('x') as number;
    if (inner.has('y')) override.y = inner.get('y') as number;
    if (inner.has('w')) override.w = inner.get('w') as number;
    if (inner.has('h')) override.h = inner.get('h') as number;
    if (inner.has('hidden')) override.hidden = inner.get('hidden') as boolean;
    out[bp] = override;
  }
  return out;
}

function decodeInlineMark(map: Y.Map<unknown>): InlineMark {
  const type = map.get('type') as InlineMark['type'];
  if (type === 'link') {
    const mark: { type: 'link'; href: string; target?: '_blank' } = {
      type,
      href: map.get('href') as string,
    };
    if (map.has('target')) mark.target = map.get('target') as '_blank';
    return mark;
  }
  if (type === 'fontSize') {
    return { type, px: map.get('px') as number };
  }
  if (type === 'color') {
    return { type, color: map.get('color') as string };
  }
  return { type };
}

function decodeInlineRun(map: Y.Map<unknown>): InlineRun {
  const run: InlineRun = { text: map.get('text') as string };
  if (map.has('marks')) {
    const arr = map.get('marks') as Y.Array<Y.Map<unknown>>;
    run.marks = arr.map(decodeInlineMark);
  }
  if (map.has('math')) {
    const m = map.get('math') as Y.Map<unknown>;
    run.math = { tex: m.get('tex') as string };
  }
  return run;
}

function decodeInlineRuns(arr: Y.Array<Y.Map<unknown>>): InlineRun[] {
  return arr.map(decodeInlineRun);
}

function decodeBaseElement(map: Y.Map<unknown>): BaseElement {
  const out: BaseElement = {
    id: map.get('id') as string,
    type: map.get('type') as BaseElement['type'],
    box: decodePositionedBox(map.get('box') as Y.Map<unknown>),
  };
  if (map.has('motion')) out.motion = decodeMotion(map.get('motion') as Y.Map<unknown>);
  if (map.has('marquee')) {
    const marquee = decodeJsonValue(map.get('marquee')) as BaseElement['marquee'];
    if (marquee !== undefined) out.marquee = marquee;
  }
  if (map.has('pointerFx')) {
    const pointerFx = decodeJsonValue(map.get('pointerFx')) as BaseElement['pointerFx'];
    if (pointerFx !== undefined) out.pointerFx = pointerFx;
  }
  if (map.has('pinnedStyle')) {
    out.pinnedStyle = decodeStringRecord(map.get('pinnedStyle') as Y.Map<string>);
  }
  if (map.has('elementStyle')) {
    out.elementStyle = decodeElementStyle(map.get('elementStyle') as Y.Map<unknown>);
  }
  if (map.has('responsive')) {
    out.responsive = decodeResponsive(map.get('responsive') as Y.Map<unknown>);
  }
  if (map.has('anchorId')) out.anchorId = map.get('anchorId') as string;
  if (map.has('stickyOffset')) out.stickyOffset = map.get('stickyOffset') as number;
  return out;
}

function decodeTextElement(map: Y.Map<unknown>, base: BaseElement): TextElement {
  const out: TextElement = {
    ...base,
    type: 'text',
    content: decodeInlineRuns(map.get('content') as Y.Array<Y.Map<unknown>>),
    role: map.get('role') as TextElement['role'],
    fontSize: map.get('fontSize') as number,
    fontWeight: map.get('fontWeight') as TextElement['fontWeight'],
    align: map.get('align') as TextElement['align'],
  };
  if (map.has('letterSpacing')) out.letterSpacing = map.get('letterSpacing') as string;
  if (map.has('textWrap')) {
    out.textWrap = map.get('textWrap') as NonNullable<TextElement['textWrap']>;
  }
  if (map.has('lineHeight')) out.lineHeight = map.get('lineHeight') as number;
  if (map.has('textTransform')) {
    out.textTransform = map.get('textTransform') as NonNullable<TextElement['textTransform']>;
  }
  if (map.has('fluidSize')) {
    const fluid = map.get('fluidSize') as Y.Map<unknown>;
    out.fluidSize = {
      min: fluid.get('min') as number,
      max: fluid.get('max') as number,
      vw: fluid.get('vw') as number,
    };
  }
  if (map.has('isRichText')) out.isRichText = map.get('isRichText') as boolean;
  return out;
}

function decodeMediaElement(map: Y.Map<unknown>, base: BaseElement): MediaElement {
  const mediaKind = map.get('mediaKind') as MediaElement['mediaKind'];
  const shared = {
    ...base,
    type: 'media' as const,
    assetId: map.get('assetId') as string,
    alt: map.get('alt') as string,
    fit: map.get('fit') as MediaElement['fit'],
  };
  if (mediaKind === 'image') {
    return { ...shared, mediaKind: 'image' };
  }
  const el: VideoMediaElement = { ...shared, mediaKind: 'video' };
  if (map.has('posterAssetId')) el.posterAssetId = map.get('posterAssetId') as string;
  if (map.has('hoverPlayback')) {
    const hoverPlayback = decodeJsonValue(map.get('hoverPlayback')) as VideoMediaElement['hoverPlayback'];
    if (hoverPlayback !== undefined) el.hoverPlayback = hoverPlayback;
  }
  if (map.has('playback')) {
    const playback = map.get('playback') as Y.Map<unknown>;
    const playbackOut: NonNullable<VideoMediaElement['playback']> = {};
    if (playback.has('autoplay')) playbackOut.autoplay = playback.get('autoplay') as boolean;
    if (playback.has('muted')) playbackOut.muted = playback.get('muted') as boolean;
    if (playback.has('loop')) playbackOut.loop = playback.get('loop') as boolean;
    if (playback.has('controls')) playbackOut.controls = playback.get('controls') as boolean;
    el.playback = playbackOut;
  }
  return el;
}

function decodeRichMotionElement(map: Y.Map<unknown>, base: BaseElement): RichMotionElement {
  return {
    ...base,
    type: 'rich-motion',
    assetRefId: map.get('assetRefId') as string,
    fit: map.get('fit') as RichMotionElement['fit'],
    label: map.get('label') as string,
  };
}

function decodeActionElement(map: Y.Map<unknown>, base: BaseElement): ActionElement {
  // ADR 0051 dec 1 — label is InlineRun[].
  const label = decodeInlineRuns(map.get('label') as Y.Array<Y.Map<unknown>>);
  const variant = map.get('variant') as ActionVariant;
  const iconKind = map.has('iconKind') ? (map.get('iconKind') as IconName) : undefined;
  const actionStyle = map.has('actionStyle')
    ? {
        actionStyle: decodeComponentStyle(
          map.get('actionStyle') as Y.Map<unknown>,
          ACTION_STYLE_SPEC,
        ) as NonNullable<ActionElement['actionStyle']>,
      }
    : {};

  // ADR 0051 dec 3 — exactly one of href or behavior is encoded.
  if (map.has('behavior')) {
    const bMap = map.get('behavior') as Y.Map<unknown>;
    const behavior: ActionBehavior = {
      type: 'copy',
      value: bMap.get('value') as string,
    };
    return {
      ...base,
      type: 'action',
      label,
      variant,
      behavior,
      ...actionStyle,
      ...(iconKind !== undefined ? { iconKind } : {}),
    };
  }

  const hrefMap = map.get('href') as Y.Map<unknown>;
  const hrefType = hrefMap.get('type') as string;
  const href: ActionHref =
    hrefType === 'page'
      ? {
          type: 'page',
          pageId: hrefMap.get('pageId') as string,
          ...(hrefMap.has('anchor') ? { anchor: hrefMap.get('anchor') as string } : {}),
        }
      : { type: 'external', url: hrefMap.get('url') as string };
  return {
    ...base,
    type: 'action',
    label,
    variant,
    href,
    ...actionStyle,
    ...(iconKind !== undefined ? { iconKind } : {}),
  };
}

function decodeShapeElement(map: Y.Map<unknown>, base: BaseElement): ShapeElement {
  const out: ShapeElement = {
    ...base,
    type: 'shape',
    variant: map.get('variant') as ShapeElement['variant'],
  };
  if (map.has('iconKind')) out.iconKind = map.get('iconKind') as IconName;
  return out;
}

function decodeContainerElement(map: Y.Map<unknown>, base: BaseElement): ContainerElement {
  const out: ContainerElement = {
    ...base,
    type: 'container',
    variant: map.get('variant') as ContainerElement['variant'],
  };
  if (map.has('linkHref')) {
    const hrefMap = map.get('linkHref') as Y.Map<unknown>;
    const hrefType = hrefMap.get('type') as string;
    out.linkHref =
      hrefType === 'page'
        ? {
            type: 'page',
            pageId: hrefMap.get('pageId') as string,
            ...(hrefMap.has('anchor') ? { anchor: hrefMap.get('anchor') as string } : {}),
          }
        : { type: 'external', url: hrefMap.get('url') as string };
  }
  if (map.has('linkLabel')) out.linkLabel = map.get('linkLabel') as string;
  if (map.has('tint')) out.tint = map.get('tint') as string;
  if (map.has('coverGridId')) out.coverGridId = map.get('coverGridId') as string;
  return out;
}

function decodeFormElement(map: Y.Map<unknown>, base: BaseElement): FormElement {
  const fields = (map.get('fields') as Y.Array<Y.Map<unknown>>).map(decodeFormFieldDef);
  const el: FormElement = {
    ...base,
    type: 'form',
    fields,
    submitLabel: map.get('submitLabel') as string,
    successMessage: map.get('successMessage') as string,
  };
  if (map.has('webhookUrl')) el.webhookUrl = map.get('webhookUrl') as string;
  if (map.has('variant')) el.variant = map.get('variant') as NonNullable<FormElement['variant']>; // ADR 0066
  if (map.has('formStyle')) {
    el.formStyle = decodeFormStyle(map.get('formStyle') as Y.Map<unknown>);
  }
  return el;
}

function decodeEmbedElement(map: Y.Map<unknown>, base: BaseElement): EmbedElement {
  const el: EmbedElement = {
    ...base,
    type: 'embed',
    url: map.get('url') as string,
  };
  if (map.has('title')) el.title = map.get('title') as string;
  if (map.has('aspectRatio')) el.aspectRatio = map.get('aspectRatio') as number;
  if (map.has('drillInEnabled')) el.drillInEnabled = map.get('drillInEnabled') as boolean;
  if (map.has('drillInReducedMotion')) {
    el.drillInReducedMotion = map.get(
      'drillInReducedMotion',
    ) as NonNullable<EmbedElement['drillInReducedMotion']>;
  }
  return el;
}

function decodeChartElement(map: Y.Map<unknown>, base: BaseElement): ChartElement {
  const series = (map.get('series') as Y.Array<Y.Map<unknown>>).map(decodeChartSeries);
  const categories = (map.get('categories') as Y.Array<string>).toArray();
  const el: ChartElement = {
    ...base,
    type: 'chart',
    kind: map.get('kind') as ChartElement['kind'],
    series,
    categories,
    showLegend: map.get('showLegend') as boolean,
  };
  if (map.has('xAxisTitle')) el.xAxisTitle = map.get('xAxisTitle') as string;
  if (map.has('yAxisTitle')) el.yAxisTitle = map.get('yAxisTitle') as string;
  return el;
}

function decodeAccordionElement(map: Y.Map<unknown>, base: BaseElement): AccordionElement {
  const items = (map.get('items') as Y.Array<Y.Map<unknown>>).map(decodeAccordionItem);
  const el: AccordionElement = {
    ...base,
    type: 'accordion',
    items,
    allowMultipleOpen: map.get('allowMultipleOpen') as boolean,
  };
  if (map.has('variant')) {
    el.variant = map.get('variant') as NonNullable<AccordionElement['variant']>;
  }
  if (map.has('accordionStyle')) {
    el.accordionStyle = decodeComponentStyle(
      map.get('accordionStyle') as Y.Map<unknown>,
      ACCORDION_STYLE_SPEC,
    );
  }
  return el;
}

function decodeCarouselElement(map: Y.Map<unknown>, base: BaseElement): CarouselElement {
  const slides = (map.get('slides') as Y.Array<Y.Map<unknown>>).map(decodeCarouselSlide);
  const el: CarouselElement = {
    ...base,
    type: 'carousel',
    slides,
    showArrows: map.get('showArrows') as boolean,
    showDots: map.get('showDots') as boolean,
  };
  if (map.has('mode')) el.mode = map.get('mode') as NonNullable<CarouselElement['mode']>;
  if (map.has('variant'))
    el.variant = map.get('variant') as NonNullable<CarouselElement['variant']>; // ADR 0066
  if (map.has('carouselStyle')) {
    el.carouselStyle = decodeComponentStyle(
      map.get('carouselStyle') as Y.Map<unknown>,
      CAROUSEL_STYLE_SPEC,
    );
  }
  return el;
}

function decodeTableElement(map: Y.Map<unknown>, base: BaseElement): TableElement {
  const columns = (map.get('columns') as Y.Array<Y.Map<unknown>>).map(decodeTableColumn);
  const rows = (map.get('rows') as Y.Array<Y.Map<unknown>>).map(decodeTableRow);
  return {
    ...base,
    type: 'table',
    columns,
    rows,
    zebra: map.get('zebra') as boolean,
    collapseOnPhone: map.get('collapseOnPhone') as boolean,
  };
}

function decodeCodeElement(map: Y.Map<unknown>, base: BaseElement): CodeElement {
  return {
    ...base,
    type: 'code',
    language: map.get('language') as CodeElement['language'],
    source: map.get('source') as string,
    showLineNumbers: map.get('showLineNumbers') as boolean,
  };
}

function decodeNavElement(map: Y.Map<unknown>, base: BaseElement): NavElement {
  const links = (map.get('links') as Y.Array<Y.Map<unknown>>).map(decodeNavLink);
  const el: NavElement = {
    ...base,
    type: 'nav',
    links,
    layout: map.get('layout') as NavElement['layout'],
    sticky: map.get('sticky') as boolean,
  };
  if (map.has('logoAssetId')) el.logoAssetId = map.get('logoAssetId') as string;
  if (map.has('siteTitle')) el.siteTitle = map.get('siteTitle') as string;
  if (map.has('primaryAction')) {
    el.primaryAction = decodeNavLink(map.get('primaryAction') as Y.Map<unknown>);
  }
  if (map.has('themeOnScroll')) {
    const theme = map.get('themeOnScroll') as Y.Map<unknown>;
    el.themeOnScroll = {
      enabled: theme.get('enabled') as boolean,
      defaultTheme: theme.get('defaultTheme') as NonNullable<NavElement['themeOnScroll']>['defaultTheme'],
      reducedMotion: theme.get('reducedMotion') as NonNullable<NavElement['themeOnScroll']>['reducedMotion'],
    };
  }
  if (map.has('navStyle')) {
    const navStyle = decodeComponentStyle(
      map.get('navStyle') as Y.Map<unknown>,
      NAV_STYLE_SPEC,
    ) as NonNullable<NavElement['navStyle']>;
    el.navStyle = navStyle;
  }
  return el;
}

function decodeTabsElement(map: Y.Map<unknown>, base: BaseElement): TabsElement {
  const tabsArr = map.get('tabs') as Y.Array<Y.Map<unknown>>;
  const tabs: Tab[] = tabsArr.map((tabMap) => ({
    id: tabMap.get('id') as string,
    label: decodeInlineRuns(tabMap.get('label') as Y.Array<Y.Map<unknown>>),
    elements: (tabMap.get('elements') as Y.Array<Y.Map<unknown>>).map(decodeElement),
  }));
  const out: TabsElement = {
    ...base,
    type: 'tabs',
    tabs,
    activeTabId: map.get('activeTabId') as string,
  };
  if (map.has('tabBarHeight')) out.tabBarHeight = map.get('tabBarHeight') as number;
  if (map.has('variant')) out.variant = map.get('variant') as NonNullable<TabsElement['variant']>; // ADR 0066
  if (map.has('tabsStyle')) {
    out.tabsStyle = decodeComponentStyle(map.get('tabsStyle') as Y.Map<unknown>, TABS_STYLE_SPEC);
  }
  return out;
}

function decodeFlowSpacing(map: Y.Map<unknown>): FlowSpacing {
  return {
    row: map.get('row') as number,
    column: map.get('column') as number,
  };
}

function decodeFlowPadding(map: Y.Map<unknown>): FlowPadding {
  return {
    top: map.get('top') as number,
    right: map.get('right') as number,
    bottom: map.get('bottom') as number,
    left: map.get('left') as number,
  };
}

function decodeFlowLayoutResponsiveOverride(map: Y.Map<unknown>): FlowLayoutResponsiveOverride {
  const out: FlowLayoutResponsiveOverride = {};
  if (map.has('gap')) out.gap = decodeFlowSpacing(map.get('gap') as Y.Map<unknown>);
  if (map.has('padding')) out.padding = decodeFlowPadding(map.get('padding') as Y.Map<unknown>);
  if (map.has('align')) out.align = map.get('align') as NonNullable<typeof out.align>;
  if (map.has('justify')) out.justify = map.get('justify') as NonNullable<typeof out.justify>;
  if (map.has('wrap')) out.wrap = map.get('wrap') as boolean;
  if (map.has('columns')) out.columns = map.get('columns') as number;
  return out;
}

function decodeFlowLayout(map: Y.Map<unknown>): FlowLayout {
  const out: FlowLayout = {
    mode: map.get('mode') as FlowLayout['mode'],
    gap: decodeFlowSpacing(map.get('gap') as Y.Map<unknown>),
    padding: decodeFlowPadding(map.get('padding') as Y.Map<unknown>),
    align: map.get('align') as FlowLayout['align'],
    justify: map.get('justify') as FlowLayout['justify'],
  };
  if (map.has('wrap')) out.wrap = map.get('wrap') as boolean;
  if (map.has('columns')) out.columns = map.get('columns') as number;
  if (map.has('responsive')) {
    const responsiveMap = map.get('responsive') as Y.Map<Y.Map<unknown>>;
    const responsive: NonNullable<FlowLayout['responsive']> = {};
    for (const bp of ['tablet', 'phone'] as const) {
      if (responsiveMap.has(bp)) {
        responsive[bp] = decodeFlowLayoutResponsiveOverride(responsiveMap.get(bp)!);
      }
    }
    out.responsive = responsive;
  }
  return out;
}

function decodeFlowItemResponsiveOverride(map: Y.Map<unknown>): FlowItemResponsiveOverride {
  const out: FlowItemResponsiveOverride = {};
  if (map.has('span')) out.span = map.get('span') as number;
  if (map.has('align')) out.align = map.get('align') as NonNullable<typeof out.align>;
  if (map.has('hidden')) out.hidden = map.get('hidden') as boolean;
  if (map.has('order')) out.order = map.get('order') as number;
  return out;
}

function decodeFlowItem(map: Y.Map<unknown>): FlowItem {
  const out: FlowItem = {
    id: map.get('id') as string,
    element: decodeElement(map.get('element') as Y.Map<unknown>),
  };
  if (map.has('span')) out.span = map.get('span') as number;
  if (map.has('align')) out.align = map.get('align') as NonNullable<typeof out.align>;
  if (map.has('responsive')) {
    const responsiveMap = map.get('responsive') as Y.Map<Y.Map<unknown>>;
    const responsive: NonNullable<FlowItem['responsive']> = {};
    for (const bp of ['tablet', 'phone'] as const) {
      if (responsiveMap.has(bp)) {
        responsive[bp] = decodeFlowItemResponsiveOverride(responsiveMap.get(bp)!);
      }
    }
    out.responsive = responsive;
  }
  return out;
}

function decodeFlowContainerElement(map: Y.Map<unknown>, base: BaseElement): FlowContainerElement {
  const items = (map.get('items') as Y.Array<Y.Map<unknown>>).map(decodeFlowItem);
  return {
    ...base,
    type: 'flow-container',
    layout: decodeFlowLayout(map.get('layout') as Y.Map<unknown>),
    items,
  };
}

function decodeCollectionElement(map: Y.Map<unknown>, base: BaseElement): CollectionElement {
  const el: CollectionElement = {
    ...base,
    type: 'collection',
  };
  // ADR 0063 canonical fields. Yjs storage is schema-tolerant; any historical
  // keys for retired CollectionElement fields (`mode`, `cardTemplate`,
  // `fieldBindings`, `entryTemplate`, `filter`, `layout`, legacy
  // `{ field, order }` sort) sit unread on the Y.Doc — they cannot resurface
  // because there is no type slot to land in.
  if (map.has('collectionSlug')) el.collectionSlug = map.get('collectionSlug') as string;
  if (map.has('folder')) el.folder = map.get('folder') as string;
  if (map.has('display')) {
    el.display = map.get('display') as NonNullable<CollectionElement['display']>;
  }
  if (map.has('sort')) {
    const raw = map.get('sort');
    // Only the string-union form survives F5b; legacy `{ field, order }`
    // objects (stored as Y.Map) are dropped silently — the materializer
    // already treats `sort === undefined` as `'date-desc'`.
    if (typeof raw === 'string') {
      el.sort = raw as CollectionSort;
    }
  }
  if (map.has('manualOrder')) {
    el.manualOrder = (map.get('manualOrder') as Y.Array<string>).toArray();
  }
  if (map.has('gallery')) {
    const rawGallery = map.get('gallery');
    if (!(rawGallery instanceof Y.Map)) {
      throw new Error(`Collection element ${el.id}: gallery must decode from a Y.Map`);
    }
    el.gallery = {
      mode: rawGallery.get('mode') as NonNullable<CollectionElement['gallery']>['mode'],
      detailMode: rawGallery.get('detailMode') as NonNullable<
        CollectionElement['gallery']
      >['detailMode'],
      reducedMotion: rawGallery.get('reducedMotion') as NonNullable<
        CollectionElement['gallery']
      >['reducedMotion'],
    };
    if (rawGallery.has('sliderAxis')) {
      const sliderAxis: unknown = rawGallery.get('sliderAxis');
      if (sliderAxis !== 'x' && sliderAxis !== 'y') {
        throw new Error(`Collection element ${el.id}: gallery.sliderAxis must decode as x or y`);
      }
      el.gallery.sliderAxis = sliderAxis;
    }
    if (rawGallery.has('sliderInertia')) {
      el.gallery.sliderInertia = rawGallery.get('sliderInertia') as boolean;
    }
    if (rawGallery.has('showProgress')) {
      el.gallery.showProgress = rawGallery.get('showProgress') as boolean;
    }
    if (rawGallery.has('videoHover')) {
      const rawVideoHover: unknown = rawGallery.get('videoHover');
      if (!(rawVideoHover instanceof Y.Map)) {
        throw new Error(`Collection element ${el.id}: gallery.videoHover must decode from a Y.Map`);
      }
      el.gallery.videoHover = {
        enabled: rawVideoHover.get('enabled') === true,
        mode: rawVideoHover.get('mode') as NonNullable<
          NonNullable<CollectionElement['gallery']>['videoHover']
        >['mode'],
        reducedMotion: rawVideoHover.get('reducedMotion') as NonNullable<
          NonNullable<CollectionElement['gallery']>['videoHover']
        >['reducedMotion'],
      };
      if (rawVideoHover.has('scrubOnHover')) {
        el.gallery.videoHover.scrubOnHover = rawVideoHover.get('scrubOnHover') as boolean;
      }
      if (rawVideoHover.has('streamAssetId')) {
        el.gallery.videoHover.streamAssetId = rawVideoHover.get('streamAssetId') as string;
      }
      if (rawVideoHover.has('streamPosterAssetId')) {
        el.gallery.videoHover.streamPosterAssetId = rawVideoHover.get('streamPosterAssetId') as string;
      }
      if (rawVideoHover.has('intentDelayMs')) {
        el.gallery.videoHover.intentDelayMs = rawVideoHover.get('intentDelayMs') as number;
      }
    }
  }
  if (map.has('search')) {
    const rawSearch = map.get('search');
    if (!(rawSearch instanceof Y.Map)) {
      throw new Error(`Collection element ${el.id}: search must decode from a Y.Map`);
    }
    el.search = {
      enabled: rawSearch.get('enabled') === true,
      reducedMotion: rawSearch.get('reducedMotion') as NonNullable<
        CollectionElement['search']
      >['reducedMotion'],
    } as NonNullable<CollectionElement['search']>;
    if (rawSearch.has('placeholder')) {
      el.search.placeholder = rawSearch.get('placeholder') as string;
    }
    if (rawSearch.has('emptyMessage')) {
      el.search.emptyMessage = rawSearch.get('emptyMessage') as string;
    }
  }
  if (map.has('filterChips')) {
    const rawFilter = map.get('filterChips');
    if (!(rawFilter instanceof Y.Map)) {
      throw new Error(`Collection element ${el.id}: filterChips must decode from a Y.Map`);
    }
    const rawOptions: unknown = rawFilter.get('options');
    if (!(rawOptions instanceof Y.Array)) {
      throw new Error(`Collection element ${el.id}: filterChips.options must decode from a Y.Array`);
    }
    const decodedOptions: NonNullable<CollectionElement['filterChips']>['options'] = rawOptions
      .toArray()
      .map((option: unknown) => {
        if (!(option instanceof Y.Map)) {
          throw new Error(`Collection element ${el.id}: filterChips option must decode from a Y.Map`);
        }
        return {
          label: option.get('label') as string,
          value: option.get('value') as string,
        };
      });
    el.filterChips = {
      enabled: rawFilter.get('enabled') === true,
      field: rawFilter.get('field') as NonNullable<CollectionElement['filterChips']>['field'],
      reducedMotion: rawFilter.get('reducedMotion') as NonNullable<
        CollectionElement['filterChips']
      >['reducedMotion'],
      options: decodedOptions,
    } as NonNullable<CollectionElement['filterChips']>;
    if (rawFilter.has('defaultValue')) {
      el.filterChips.defaultValue = rawFilter.get('defaultValue') as string;
    }
  }
  if (map.has('entryMetadata')) {
    const rawMetadata = map.get('entryMetadata');
    if (!(rawMetadata instanceof Y.Array)) {
      throw new Error(`Collection element ${el.id}: entryMetadata must decode from a Y.Array`);
    }
    el.entryMetadata = rawMetadata.toArray().map((row: unknown) => {
      if (!(row instanceof Y.Map)) {
        throw new Error(`Collection element ${el.id}: entryMetadata row must decode from a Y.Map`);
      }
      const tags: unknown = row.get('tags');
      if (!(tags instanceof Y.Array)) {
        throw new Error(`Collection element ${el.id}: entryMetadata.tags must decode from a Y.Array`);
      }
      return {
        slug: row.get('slug') as string,
        title: row.get('title') as string,
        folder: row.get('folder') as string | null,
        category: row.get('category') as string,
        tags: tags.toArray() as string[],
      };
    });
  }
  if (map.has('viewToggle')) {
    const rawViewToggle = map.get('viewToggle');
    if (!(rawViewToggle instanceof Y.Map)) {
      throw new Error(`Collection element ${el.id}: viewToggle must decode from a Y.Map`);
    }
    el.viewToggle = {
      enabled: rawViewToggle.get('enabled') === true,
      defaultMode: rawViewToggle.get('defaultMode') as NonNullable<
        CollectionElement['viewToggle']
      >['defaultMode'],
      reducedMotion: rawViewToggle.get('reducedMotion') as NonNullable<
        CollectionElement['viewToggle']
      >['reducedMotion'],
    } as NonNullable<CollectionElement['viewToggle']>;
  }
  if (map.has('entries')) {
    const rawEntries = map.get('entries') as Y.Array<Y.Array<Y.Map<unknown>>>;
    el.entries = rawEntries.map((row) => row.map(decodeElement));
  }
  // ADR 0065 D2 — `customTemplate` decodes as a flat element array.
  if (map.has('customTemplate')) {
    const tmpl = map.get('customTemplate') as Y.Array<Y.Map<unknown>>;
    el.customTemplate = tmpl.map(decodeElement);
  }
  if (map.has('collectionStyle')) {
    el.collectionStyle = decodeComponentStyle(
      map.get('collectionStyle') as Y.Map<unknown>,
      COLLECTION_STYLE_SPEC,
    );
  }
  return el;
}

// ----------------------------------------------------------------------------
// Y_DECODE_DISPATCH (ADR 0011 Step 4)
// ----------------------------------------------------------------------------
//
// Mirrors Y_ENCODE_DISPATCH above. Each decoder takes the Y.Map plus a
// pre-decoded `BaseElement`, returns its specific element shape. The
// mapped type catches "added an ElementType but forgot its decoder" at
// compile time; the existing round-trip smoke (yjs-projection:smoke) is
// the runtime safety net against silent data loss.
type YDecodeDispatch = {
  [K in CanvasElement['type']]: (
    map: Y.Map<unknown>,
    base: BaseElement,
  ) => Extract<CanvasElement, { type: K }>;
};

export const Y_DECODE_DISPATCH: YDecodeDispatch = {
  text: decodeTextElement,
  media: decodeMediaElement,
  'rich-motion': decodeRichMotionElement,
  action: decodeActionElement,
  shape: decodeShapeElement,
  container: decodeContainerElement,
  form: decodeFormElement,
  embed: decodeEmbedElement,
  chart: decodeChartElement,
  accordion: decodeAccordionElement,
  carousel: decodeCarouselElement,
  table: decodeTableElement,
  code: decodeCodeElement,
  nav: decodeNavElement,
  collection: decodeCollectionElement,
  tabs: decodeTabsElement,
  'flow-container': decodeFlowContainerElement,
};

function decodeElement(map: Y.Map<unknown>): CanvasElement {
  const base = decodeBaseElement(map);
  const fn = (
    Y_DECODE_DISPATCH as Record<string, (m: Y.Map<unknown>, b: BaseElement) => CanvasElement>
  )[base.type];
  if (typeof fn !== 'function') {
    throw new Error(
      `yjs-projection: no Y_DECODE_DISPATCH entry for element type=${JSON.stringify(base.type)} id=${JSON.stringify(base.id)}`,
    );
  }
  return fn(map, base);
}

function decodeFormFieldDef(map: Y.Map<unknown>): FormFieldDef {
  const field: FormFieldDef = {
    id: map.get('id') as string,
    label: map.get('label') as string,
    kind: map.get('kind') as FormFieldDef['kind'],
    required: map.get('required') as boolean,
  };
  if (map.has('placeholder')) field.placeholder = map.get('placeholder') as string;
  if (map.has('options')) {
    const arr = map.get('options') as Y.Array<Y.Map<unknown>>;
    field.options = arr.map((opt) => ({
      value: opt.get('value') as string,
      label: opt.get('label') as string,
    }));
  }
  return field;
}

function decodeChartSeries(map: Y.Map<unknown>): ChartSeries {
  return {
    label: map.get('label') as string,
    values: (map.get('values') as Y.Array<number>).toArray(),
  };
}

function decodeAccordionItem(map: Y.Map<unknown>): AccordionItem {
  return {
    id: map.get('id') as string,
    title: map.get('title') as string,
    body: decodeInlineRuns(map.get('body') as Y.Array<Y.Map<unknown>>),
  };
}

function decodeCarouselSlide(map: Y.Map<unknown>): CarouselSlide {
  const slide: CarouselSlide = {
    id: map.get('id') as string,
    assetId: map.get('assetId') as string,
  };
  if (map.has('caption')) slide.caption = map.get('caption') as string;
  if (map.has('href')) slide.href = map.get('href') as string;
  return slide;
}

function decodeTableColumn(map: Y.Map<unknown>): TableColumn {
  const col: TableColumn = {
    id: map.get('id') as string,
    header: map.get('header') as string,
  };
  if (map.has('align')) col.align = map.get('align') as NonNullable<TableColumn['align']>;
  return col;
}

function decodeTableRow(map: Y.Map<unknown>): TableRow {
  return {
    id: map.get('id') as string,
    cells: decodeStringRecord(map.get('cells') as Y.Map<string>),
  };
}

function decodeNavLink(map: Y.Map<unknown>): NavLink {
  return {
    label: map.get('label') as string,
    href: map.get('href') as string,
    kind: map.get('kind') as NavLink['kind'],
  };
}

function decodeSection(map: Y.Map<unknown>): CanvasSection {
  const section: CanvasSection = {
    id: map.get('id') as string,
    recipeId: map.get('recipeId') as CanvasSection['recipeId'],
    name: map.get('name') as string,
    height: map.get('height') as number,
    elements: (map.get('elements') as Y.Array<Y.Map<unknown>>).map(decodeElement),
  };
  if (map.has('role')) {
    // ADR 0059 — legacy Yjs snapshots may carry role='header' | 'footer' on the
    // pinned slots. SECTION_ROLES is now ['body']; anything else is dropped so
    // the rehydrated state passes publish validation.
    const role = map.get('role') as string;
    if ((SECTION_ROLES as readonly string[]).includes(role)) {
      section.role = role as NonNullable<CanvasSection['role']>;
    }
  }
  if (map.has('anchorId')) {
    section.anchorId = map.get('anchorId') as string;
  }
  if (map.has('backgroundEffect')) {
    section.backgroundEffect = map.get('backgroundEffect') as NonNullable<
      CanvasSection['backgroundEffect']
    >;
  }
  if (map.has('navThemeTarget')) {
    section.navThemeTarget = map.get('navThemeTarget') as NonNullable<
      CanvasSection['navThemeTarget']
    >;
  }
  // ADR 0062 — decode discriminated-union accent border. Mirrors the
  // trigger arm above.
  if (map.has('accentBorder')) {
    const ab = map.get('accentBorder') as Y.Map<unknown>;
    const abType = ab.get('type') as NonNullable<CanvasSection['accentBorder']>['type'];
    const color = ab.get('color') as string;
    if (abType === 'solid') {
      section.accentBorder = { type: 'solid', color, width: ab.get('width') as number };
    } else if (abType === 'top' || abType === 'left') {
      section.accentBorder = { type: abType, color, thickness: ab.get('thickness') as number };
    } else {
      const radius = ab.get('radius') as number;
      const out: { type: 'glow'; color: string; radius: number; spread?: number } = {
        type: 'glow',
        color,
        radius,
      };
      if (ab.has('spread')) out.spread = ab.get('spread') as number;
      section.accentBorder = out;
    }
  }
  if (map.has('entrance')) {
    section.entrance = map.get('entrance') as NonNullable<CanvasSection['entrance']>;
  }
  if (map.has('trigger')) {
    const triggerMap = map.get('trigger') as Y.Map<unknown>;
    const triggerType = triggerMap.get('type') as NonNullable<CanvasSection['trigger']>['type'];
    if (triggerType === 'exit-intent') {
      section.trigger = { type: 'exit-intent' };
    } else {
      section.trigger = { type: triggerType, value: triggerMap.get('value') as number };
    }
  }
  if (map.has('backgroundVideoAssetId')) {
    section.backgroundVideoAssetId = map.get('backgroundVideoAssetId') as string;
  }
  if (map.has('instanceScope')) {
    section.instanceScope = map.get('instanceScope') as string;
  }
  if (map.has('responsive')) {
    section.responsive = decodeJsonValue(
      map.get('responsive'),
    ) as NonNullable<CanvasSection['responsive']>;
  }
  if (map.has('responsiveVariants')) {
    const variants = map.get('responsiveVariants') as Y.Array<Y.Map<unknown>>;
    section.responsiveVariants = variants.map((variant) => ({
      id: variant.get('id') as string,
      breakpoint: variant.get('breakpoint') as NonNullable<
        CanvasSection['responsiveVariants']
      >[number]['breakpoint'],
      contentSourceId: variant.get('contentSourceId') as string,
      elementIds: (variant.get('elementIds') as Y.Array<string>).toArray(),
    }));
  }
  return section;
}

function decodePage(map: Y.Map<unknown>): CanvasPage {
  const page: CanvasPage = {
    id: map.get('id') as string,
    slug: map.get('slug') as string,
    title: map.get('title') as string,
    width: map.get('width') as number,
    sections: (map.get('sections') as Y.Array<Y.Map<unknown>>).map(decodeSection),
  };
  if (map.has('description')) page.description = map.get('description') as string;
  if (map.has('ogImageAssetId')) page.ogImageAssetId = map.get('ogImageAssetId') as string;
  if (map.has('canonical')) page.canonical = map.get('canonical') as string;
  if (map.has('noIndex')) page.noIndex = map.get('noIndex') as boolean;
  if (map.has('locale')) page.locale = map.get('locale') as string;
  if (map.has('entranceAnimation')) {
    page.entranceAnimation = map.get('entranceAnimation') as NonNullable<
      CanvasPage['entranceAnimation']
    >;
  }
  if (map.has('scrollTriggerMode')) {
    page.scrollTriggerMode = map.get('scrollTriggerMode') as NonNullable<
      CanvasPage['scrollTriggerMode']
    >;
  }
  if (map.has('pageBackground')) page.pageBackground = map.get('pageBackground') as string;
  if (map.has('defaultMotionPreset')) {
    page.defaultMotionPreset = map.get('defaultMotionPreset') as NonNullable<
      CanvasPage['defaultMotionPreset']
    >;
  }
  if (map.has('sectionGap')) page.sectionGap = map.get('sectionGap') as number;
  if (map.has('maxWidth')) page.maxWidth = map.get('maxWidth') as number;
  if (map.has('publishedDate')) page.publishedDate = map.get('publishedDate') as string;
  if (map.has('author')) page.author = map.get('author') as string;
  if (map.has('tags')) page.tags = (map.get('tags') as Y.Array<string>).toArray();
  if (map.has('category')) page.category = map.get('category') as string;
  if (map.has('pageKind')) {
    page.pageKind = map.get('pageKind') as NonNullable<CanvasPage['pageKind']>;
  }
  if (map.has('collectionSlug')) page.collectionSlug = map.get('collectionSlug') as string;
  if (map.has('suppressHeader')) page.suppressHeader = map.get('suppressHeader') as boolean;
  if (map.has('suppressFooter')) page.suppressFooter = map.get('suppressFooter') as boolean;
  if (map.has('pageKind')) {
    page.pageKind = map.get('pageKind') as NonNullable<CanvasPage['pageKind']>;
  }
  if (map.has('collectionSlug')) page.collectionSlug = map.get('collectionSlug') as string;
  return page;
}

function decodeCustomStyleKit(map: Y.Map<unknown>): StyleKitPreset {
  const out: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    if (key === 'surfaceVariants' || key === 'actionVariants' || key === 'motionPresets') {
      out[key] = decodeNestedTokenRecord(value as Y.Map<Y.Map<unknown>>);
      continue;
    }
    if (key === 'dark' && value instanceof Y.Map) {
      out[key] = decodeCustomStyleKit(value as Y.Map<unknown>);
      continue;
    }
    out[key] = decodeJsonValue(value);
  }
  return out as unknown as StyleKitPreset;
}

function decodeNestedTokenRecord(
  map: Y.Map<Y.Map<unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [outerKey, innerMap] of map.entries()) {
    const inner: Record<string, unknown> = {};
    for (const [innerKey, innerValue] of innerMap.entries())
      inner[innerKey] = decodeJsonValue(innerValue);
    out[outerKey] = inner;
  }
  return out;
}

/**
 * Decode a Y.Doc encoded by `encodeYDoc` back into a plain EditableSite.
 *
 * Round-trip invariant: `decodeYDoc(encodeYDoc(state))` is deep-equal to
 * the input. The smoke test enforces this for both fixtures and a synthetic
 * state covering every ElementType.
 */
export function decodeYDoc(doc: Y.Doc): EditableSite {
  const root = doc.getMap<unknown>('state');

  const rawStyleKit = root.get('styleKit') as StyleKit;
  const styleKitField: EditableSiteStyleKit =
    rawStyleKit === 'custom'
      ? {
          styleKit: 'custom',
          customStyleKit: decodeCustomStyleKit(root.get('customStyleKit') as Y.Map<unknown>),
        }
      : { styleKit: rawStyleKit };
  const state: EditableSite = {
    ...styleKitField,
    pages: (root.get('pages') as Y.Array<Y.Map<unknown>>).map(decodePage),
  };
  if (root.has('defaultLocale')) state.defaultLocale = root.get('defaultLocale') as string;
  if (root.has('siteNoIndex')) state.siteNoIndex = root.get('siteNoIndex') as boolean;
  if (root.has('visitorTheme')) {
    state.visitorTheme = root.get('visitorTheme') as 'light' | 'dark' | 'toggleable';
  }
  if (root.has('faviconAssetId')) {
    state.faviconAssetId = root.get('faviconAssetId') as string;
  }
  if (root.has('scrollBehavior')) {
    const scroll = root.get('scrollBehavior') as Y.Map<unknown>;
    const scrollBehavior: NonNullable<EditableSite['scrollBehavior']> = {};
    if (scroll.has('smooth')) scrollBehavior.smooth = scroll.get('smooth') as boolean;
    if (scroll.has('paddingTop')) scrollBehavior.paddingTop = scroll.get('paddingTop') as number;
    if (scroll.has('mode')) scrollBehavior.mode = scroll.get('mode') as NonNullable<NonNullable<EditableSite['scrollBehavior']>['mode']>;
    if (scroll.has('durationMs')) scrollBehavior.durationMs = scroll.get('durationMs') as number;
    if (scroll.has('reducedMotion')) {
      scrollBehavior.reducedMotion = scroll.get(
        'reducedMotion',
      ) as NonNullable<NonNullable<EditableSite['scrollBehavior']>['reducedMotion']>;
    }
    state.scrollBehavior = scrollBehavior;
  }
  if (root.has('overlays')) {
    state.overlays = decodeJsonValue(root.get('overlays')) as NonNullable<EditableSite['overlays']>;
  }
  if (root.has('loadExperience')) {
    state.loadExperience = decodeJsonValue(
      root.get('loadExperience'),
    ) as NonNullable<EditableSite['loadExperience']>;
  }
  if (root.has('routeTransition')) {
    state.routeTransition = decodeJsonValue(
      root.get('routeTransition'),
    ) as NonNullable<EditableSite['routeTransition']>;
  }
  if (root.has('motionSequences')) {
    state.motionSequences = decodeJsonValue(
      root.get('motionSequences'),
    ) as NonNullable<EditableSite['motionSequences']>;
  }
  if (root.has('scrollScenes')) {
    state.scrollScenes = decodeJsonValue(
      root.get('scrollScenes'),
    ) as NonNullable<EditableSite['scrollScenes']>;
  }
  if (root.has('layoutTransitions')) {
    state.layoutTransitions = decodeJsonValue(
      root.get('layoutTransitions'),
    ) as NonNullable<EditableSite['layoutTransitions']>;
  }
  if (root.has('richMotionAssets')) {
    state.richMotionAssets = decodeJsonValue(
      root.get('richMotionAssets'),
    ) as NonNullable<EditableSite['richMotionAssets']>;
  }
  if (root.has('fontFaces')) {
    state.fontFaces = decodeJsonValue(root.get('fontFaces')) as NonNullable<
      EditableSite['fontFaces']
    >;
  }
  if (root.has('anchorRails')) {
    state.anchorRails = decodeJsonValue(root.get('anchorRails')) as NonNullable<
      EditableSite['anchorRails']
    >;
  }
  if (root.has('playableWidgets')) {
    state.playableWidgets = decodeJsonValue(root.get('playableWidgets')) as NonNullable<
      EditableSite['playableWidgets']
    >;
  }
  if (root.has('importAnimationInventory')) {
    state.importAnimationInventory = decodeJsonValue(
      root.get('importAnimationInventory'),
    ) as NonNullable<EditableSite['importAnimationInventory']>;
  }
  if (root.has('header')) {
    state.header = decodeSection(root.get('header') as Y.Map<unknown>);
  }
  if (root.has('footer')) {
    state.footer = decodeSection(root.get('footer') as Y.Map<unknown>);
  }
  return state;
}

// ----------------------------------------------------------------------------
// Autosave
// ----------------------------------------------------------------------------

export interface AttachAutosaveOptions {
  /** Debounce window in ms. Defaults to 750. */
  debounceMs?: number;
}

/**
 * Attach a debounced autosave observer to a Y.Doc. The handler subscribes
 * once at `doc.on('update', …)`, so it sees every mutation regardless of
 * which nested Y.Map / Y.Array changed. A single timer collapses bursts of
 * edits into one `onPersist` call after the debounce window elapses.
 *
 * Worker-runtime-safe: uses only `setTimeout` / `clearTimeout`. No external
 * scheduler, no `requestIdleCallback`, no microtask plumbing.
 *
 * Skip rule: the timer is reset on every update, so if no updates arrive
 * during the window after the prior call, `onPersist` is not called again.
 * (Yjs emits an `update` event when local writes happen, including those
 * inside `doc.transact(...)`; an idle window contains no events and thus
 * cannot trigger the callback.)
 */
export function attachAutosave(
  doc: Y.Doc,
  onPersist: (state: EditableSite) => void | Promise<void>,
  options?: AttachAutosaveOptions,
): () => void {
  const debounceMs = options?.debounceMs ?? 750;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    timer = null;
    const projected = decodeYDoc(doc);
    // Promises are intentionally not awaited here. The caller may return a
    // promise to express async persistence; floating it is the right shape
    // for an autosave because we never want one slow persist to block the
    // next debounce window. Any rejection is re-thrown asynchronously so the
    // host runtime surfaces it as an unhandled error rather than silently
    // discarding it. The log includes projected-state context so the crash is
    // debuggable without replaying the Y.Doc bytes.
    const result = onPersist(projected);
    if (result && typeof result.then === 'function') {
      result.catch((err: unknown) => {
        console.error('[canvas:yjs-projection] autosave persist failed', {
          pages: projected.pages.length,
          styleKit: projected.styleKit,
          error: err,
        });
        setTimeout(() => {
          throw err;
        }, 0);
      });
    }
  };

  const observer = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  doc.on('update', observer);

  return () => {
    doc.off('update', observer);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
