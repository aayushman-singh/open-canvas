// src/canvas/yjs-projection.ts
//
// Phase 0 — Yjs projection module. Frozen contract consumed by:
//   * Wave 1 #3 — version history (snapshot capture + restore broadcasts).
//   * Wave 1 #4 — co-edit (Y.Doc held in SiteRoom DO, autosaved to Postgres).
//
// The canonical operation model per ADR 0007 is a `Y.Doc`. Every other
// subsystem (agent ops, validators, renderer, publish) still consumes the
// JSON `CanvasSiteState`. This module owns the bridge in BOTH directions:
//
//   encodeYDoc(state)  : CanvasSiteState  -> Y.Doc
//   decodeYDoc(doc)    : Y.Doc             -> CanvasSiteState
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
//   'darkModeEnabled'? -> boolean
//   'symbols'          -> Y.Array<Y.Map<unknown>>    (SymbolMaster[])
//   'pages'            -> Y.Array<Y.Map<unknown>>    (CanvasPage[])
//
// Each SymbolMaster Y.Map:
//   'id'       -> string
//   'name'     -> string
//   'section'  -> Y.Map<unknown>                     (CanvasSection)
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
//   'sections'        -> Y.Array<Y.Map<unknown>>     (CanvasSection[])
//
// Each CanvasSection Y.Map:
//   'id'                -> string
//   'recipeId'          -> string
//   'name'              -> string
//   'height'            -> number
//   'role'?             -> string
//   'backgroundEffect'? -> string
//   'entrance'?         -> string
//   'trigger'?          -> Y.Map<unknown>
//   'backgroundVideo'?  -> string
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
//   'overrides'?  -> Y.Map<Y.Map<unknown>>           (SymbolInstance overrides)
//
// InlineRun Y.Map:
//   'text'   -> string
//   'marks'? -> Y.Array<Y.Map<unknown>>              (InlineMark[])
//
// InlineMark Y.Map:
//   'type' -> string         (one of INLINE_MARK_TYPES)
//   'href' -> string         (only when type === 'link')
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
  ActionElement,
  BaseElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  CanvasSiteState,
  ContainerElement,
  InlineMark,
  InlineRun,
  MediaElement,
  PositionedBox,
  ResponsiveOverrides,
  ShapeElement,
  StyleKit,
  StyleKitPreset,
  SymbolMaster,
  TextElement,
} from './schema.js';
import type {
  AccordionElement,
  AccordionItem,
  CarouselElement,
  CarouselSlide,
  ChartElement,
  ChartSeries,
  CodeElement,
  CollectionElement,
  EmbedElement,
  FormElement,
  FormFieldDef,
  NavElement,
  NavLink,
  SymbolInstanceElement,
  SymbolInstanceOverrides,
  TableColumn,
  TableElement,
  TableRow,
} from './elements/index.js';

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
 * walkers (`encodeCustomStyleKit`, `encodeNestedTokenRecord`,
 * `encodeSymbolInstanceOverrides`). Those walkers deliberately iterate
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
  return out;
}

function encodeInlineRuns(runs: InlineRun[]): Y.Array<Y.Map<unknown>> {
  const out = new Y.Array<Y.Map<unknown>>();
  for (const run of runs) out.push([encodeInlineRun(run)]);
  return out;
}

function encodeBaseElementFields(target: Y.Map<unknown>, el: BaseElement): void {
  target.set('id', el.id);
  target.set('type', el.type);
  target.set('box', encodePositionedBox(el.box));
  if (el.motion !== undefined) target.set('motion', encodeMotion(el.motion));
  if (el.pinnedStyle !== undefined) target.set('pinnedStyle', encodeStringRecord(el.pinnedStyle));
  if (el.responsive !== undefined) target.set('responsive', encodeResponsive(el.responsive));
}

function encodeTextElement(el: TextElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('content', encodeInlineRuns(el.content));
  out.set('role', el.role);
  out.set('fontSize', el.fontSize);
  out.set('fontWeight', el.fontWeight);
  out.set('align', el.align);
  return out;
}

function encodeMediaElement(el: MediaElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('mediaKind', el.mediaKind);
  out.set('assetId', el.assetId);
  setIfDefined(out, 'posterAssetId', el.posterAssetId);
  out.set('alt', el.alt);
  out.set('fit', el.fit);
  if (el.playback !== undefined) {
    const playback = new Y.Map<unknown>();
    setIfDefined(playback, 'autoplay', el.playback.autoplay);
    setIfDefined(playback, 'muted', el.playback.muted);
    setIfDefined(playback, 'loop', el.playback.loop);
    setIfDefined(playback, 'controls', el.playback.controls);
    out.set('playback', playback);
  }
  return out;
}

function encodeActionHref(href: ActionElement['href']): Y.Map<unknown> {
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

function encodeActionElement(el: ActionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('label', el.label);
  out.set('href', encodeActionHref(el.href));
  out.set('variant', el.variant);
  return out;
}

function encodeShapeElement(el: ShapeElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('variant', el.variant);
  return out;
}

function encodeContainerElement(el: ContainerElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('variant', el.variant);
  return out;
}

function encodeSymbolInstanceOverrides(overrides: SymbolInstanceOverrides): Y.Map<Y.Map<unknown>> {
  const out = new Y.Map<Y.Map<unknown>>();
  for (const elementId of Object.keys(overrides).sort()) {
    const patch = overrides[elementId];
    if (patch === undefined) continue;
    const patchMap = new Y.Map<unknown>();
    // The override is a Partial<CanvasElement> — we copy primitive fields and
    // nested compound fields the same way we encode whole elements, but every
    // field is optional. Iterate over a fixed superset of known field names
    // in alphabetical order for determinism.
    const fieldNames = Object.keys(patch).sort();
    for (const field of fieldNames) {
      const value = (patch as Record<string, unknown>)[field];
      if (value === undefined) continue;
      // Compound fields known to need Y types:
      if (field === 'box' && isPositionedBox(value)) {
        patchMap.set('box', encodePositionedBox(value));
        continue;
      }
      if (field === 'motion' && isMotion(value)) {
        patchMap.set('motion', encodeMotion(value));
        continue;
      }
      if (field === 'pinnedStyle' && isStringRecord(value)) {
        patchMap.set('pinnedStyle', encodeStringRecord(value));
        continue;
      }
      if (field === 'responsive' && isResponsive(value)) {
        patchMap.set('responsive', encodeResponsive(value));
        continue;
      }
      if (field === 'content' && Array.isArray(value)) {
        patchMap.set('content', encodeInlineRuns(value as InlineRun[]));
        continue;
      }
      patchMap.set(field, encodeJsonValue(value));
    }
    out.set(elementId, patchMap);
  }
  return out;
}

function encodeSymbolInstanceElement(el: SymbolInstanceElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('symbolId', el.symbolId);
  out.set('overrides', encodeSymbolInstanceOverrides(el.overrides));
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

function encodeFormElement(el: FormElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  const fields = new Y.Array<Y.Map<unknown>>();
  for (const field of el.fields) fields.push([encodeFormFieldDef(field)]);
  out.set('fields', fields);
  out.set('submitLabel', el.submitLabel);
  out.set('successMessage', el.successMessage);
  setIfDefined(out, 'webhookUrl', el.webhookUrl);
  return out;
}

function encodeEmbedElement(el: EmbedElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('url', el.url);
  setIfDefined(out, 'title', el.title);
  setIfDefined(out, 'aspectRatio', el.aspectRatio);
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
  const links = new Y.Array<Y.Map<unknown>>();
  for (const link of el.links) links.push([encodeNavLink(link)]);
  out.set('links', links);
  out.set('layout', el.layout);
  out.set('sticky', el.sticky);
  return out;
}

function encodeCollectionElement(el: CollectionElement): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  encodeBaseElementFields(out, el);
  out.set('mode', el.mode);
  const entryTemplate = new Y.Array<Y.Map<unknown>>();
  for (const child of el.entryTemplate) entryTemplate.push([encodeElement(child)]);
  out.set('entryTemplate', entryTemplate);
  const entries = new Y.Array<Y.Array<Y.Map<unknown>>>();
  for (const entry of el.entries) {
    const row = new Y.Array<Y.Map<unknown>>();
    for (const child of entry) row.push([encodeElement(child)]);
    entries.push([row]);
  }
  out.set('entries', entries);
  if (el.filter !== undefined) {
    const filterMap = new Y.Map<unknown>();
    if (el.filter.category !== undefined) filterMap.set('category', el.filter.category);
    if (el.filter.tags !== undefined) {
      const tagsArr = new Y.Array<string>();
      for (const tag of el.filter.tags) tagsArr.push([tag]);
      filterMap.set('tags', tagsArr);
    }
    if (el.filter.limit !== undefined) filterMap.set('limit', el.filter.limit);
    out.set('filter', filterMap);
  }
  if (el.sort !== undefined) {
    const sortMap = new Y.Map<unknown>();
    sortMap.set('field', el.sort.field);
    sortMap.set('order', el.sort.order);
    out.set('sort', sortMap);
  }
  if (el.cardTemplate !== undefined) {
    const cardTemplate = new Y.Array<Y.Map<unknown>>();
    for (const child of el.cardTemplate) cardTemplate.push([encodeElement(child)]);
    out.set('cardTemplate', cardTemplate);
  }
  if (el.fieldBindings !== undefined) {
    const bindingsMap = new Y.Map<string>();
    for (const [elementId, field] of Object.entries(el.fieldBindings)) {
      bindingsMap.set(elementId, field);
    }
    out.set('fieldBindings', bindingsMap);
  }
  const layoutMap = new Y.Map<unknown>();
  layoutMap.set('columns', el.layout.columns);
  layoutMap.set('gap', el.layout.gap);
  out.set('layout', layoutMap);
  return out;
}

function encodeElement(el: CanvasElement): Y.Map<unknown> {
  switch (el.type) {
    case 'text':
      return encodeTextElement(el);
    case 'media':
      return encodeMediaElement(el);
    case 'action':
      return encodeActionElement(el);
    case 'shape':
      return encodeShapeElement(el);
    case 'container':
      return encodeContainerElement(el);
    case 'symbol-instance':
      return encodeSymbolInstanceElement(el);
    case 'form':
      return encodeFormElement(el);
    case 'embed':
      return encodeEmbedElement(el);
    case 'chart':
      return encodeChartElement(el);
    case 'accordion':
      return encodeAccordionElement(el);
    case 'carousel':
      return encodeCarouselElement(el);
    case 'table':
      return encodeTableElement(el);
    case 'code':
      return encodeCodeElement(el);
    case 'nav':
      return encodeNavElement(el);
    case 'collection':
      return encodeCollectionElement(el);
    default: {
      // Exhaustiveness — TS narrows `el` to `never` here. If a new
      // ElementType is added to the schema without an encode case, the
      // compiler refuses to compile this line.
      const _exhaustive: never = el;
      throw new Error(`yjs-projection: unknown element type ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function encodeSection(section: CanvasSection): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', section.id);
  out.set('recipeId', section.recipeId);
  out.set('name', section.name);
  out.set('height', section.height);
  setIfDefined(out, 'role', section.role);
  setIfDefined(out, 'backgroundEffect', section.backgroundEffect);
  setIfDefined(out, 'entrance', section.entrance);
  if (section.trigger !== undefined) {
    const trigger = new Y.Map<unknown>();
    trigger.set('type', section.trigger.type);
    setIfDefined(trigger, 'value', section.trigger.value);
    out.set('trigger', trigger);
  }
  setIfDefined(out, 'backgroundVideo', section.backgroundVideo);
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
  const sections = new Y.Array<Y.Map<unknown>>();
  for (const section of page.sections) sections.push([encodeSection(section)]);
  out.set('sections', sections);
  return out;
}

function encodeSymbolMaster(symbol: SymbolMaster): Y.Map<unknown> {
  const out = new Y.Map<unknown>();
  out.set('id', symbol.id);
  out.set('name', symbol.name);
  out.set('section', encodeSection(symbol.section));
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
 * Encode a CanvasSiteState into a fresh Y.Doc.
 *
 * One transaction wraps the entire encode so a downstream `attachAutosave`
 * sees a single update event per encode call rather than one per nested set.
 */
export function encodeYDoc(state: CanvasSiteState): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const root = doc.getMap<unknown>('state');
    root.set('styleKit', state.styleKit);
    if (state.customStyleKit !== undefined) {
      root.set('customStyleKit', encodeCustomStyleKit(state.customStyleKit));
    }
    setIfDefined(root, 'defaultLocale', state.defaultLocale);
    setIfDefined(root, 'siteNoIndex', state.siteNoIndex);
    setIfDefined(root, 'darkModeEnabled', state.darkModeEnabled);

    const symbols = new Y.Array<Y.Map<unknown>>();
    for (const symbol of state.symbols) symbols.push([encodeSymbolMaster(symbol)]);
    root.set('symbols', symbols);

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
    return { type, href: map.get('href') as string };
  }
  return { type };
}

function decodeInlineRun(map: Y.Map<unknown>): InlineRun {
  const run: InlineRun = { text: map.get('text') as string };
  if (map.has('marks')) {
    const arr = map.get('marks') as Y.Array<Y.Map<unknown>>;
    run.marks = arr.map(decodeInlineMark);
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
  if (map.has('pinnedStyle')) {
    out.pinnedStyle = decodeStringRecord(map.get('pinnedStyle') as Y.Map<string>);
  }
  if (map.has('responsive')) {
    out.responsive = decodeResponsive(map.get('responsive') as Y.Map<unknown>);
  }
  return out;
}

function decodeElement(map: Y.Map<unknown>): CanvasElement {
  const base = decodeBaseElement(map);
  const type = base.type;
  switch (type) {
    case 'text': {
      const el: TextElement = {
        ...base,
        type,
        content: decodeInlineRuns(map.get('content') as Y.Array<Y.Map<unknown>>),
        role: map.get('role') as TextElement['role'],
        fontSize: map.get('fontSize') as number,
        fontWeight: map.get('fontWeight') as TextElement['fontWeight'],
        align: map.get('align') as TextElement['align'],
      };
      return el;
    }
    case 'media': {
      const el: MediaElement = {
        ...base,
        type,
        mediaKind: map.get('mediaKind') as MediaElement['mediaKind'],
        assetId: map.get('assetId') as string,
        alt: map.get('alt') as string,
        fit: map.get('fit') as MediaElement['fit'],
      };
      if (map.has('posterAssetId')) el.posterAssetId = map.get('posterAssetId') as string;
      if (map.has('playback')) {
        const playback = map.get('playback') as Y.Map<unknown>;
        const playbackOut: NonNullable<MediaElement['playback']> = {};
        if (playback.has('autoplay')) playbackOut.autoplay = playback.get('autoplay') as boolean;
        if (playback.has('muted')) playbackOut.muted = playback.get('muted') as boolean;
        if (playback.has('loop')) playbackOut.loop = playback.get('loop') as boolean;
        if (playback.has('controls')) playbackOut.controls = playback.get('controls') as boolean;
        el.playback = playbackOut;
      }
      return el;
    }
    case 'action': {
      const hrefMap = map.get('href') as Y.Map<unknown>;
      const hrefType = hrefMap.get('type') as string;
      const href: ActionElement['href'] =
        hrefType === 'page'
          ? {
              type: 'page',
              pageId: hrefMap.get('pageId') as string,
              ...(hrefMap.has('anchor') ? { anchor: hrefMap.get('anchor') as string } : {}),
            }
          : { type: 'external', url: hrefMap.get('url') as string };
      const el: ActionElement = {
        ...base,
        type,
        label: map.get('label') as string,
        href,
        variant: map.get('variant') as ActionElement['variant'],
      };
      return el;
    }
    case 'shape': {
      const el: ShapeElement = {
        ...base,
        type,
        variant: map.get('variant') as ShapeElement['variant'],
      };
      return el;
    }
    case 'container': {
      const el: ContainerElement = {
        ...base,
        type,
        variant: map.get('variant') as ContainerElement['variant'],
      };
      return el;
    }
    case 'symbol-instance': {
      const el: SymbolInstanceElement = {
        ...base,
        type,
        symbolId: map.get('symbolId') as string,
        overrides: decodeSymbolInstanceOverrides(map.get('overrides') as Y.Map<Y.Map<unknown>>),
      };
      return el;
    }
    case 'form': {
      const fields = (map.get('fields') as Y.Array<Y.Map<unknown>>).map(decodeFormFieldDef);
      const el: FormElement = {
        ...base,
        type,
        fields,
        submitLabel: map.get('submitLabel') as string,
        successMessage: map.get('successMessage') as string,
      };
      if (map.has('webhookUrl')) el.webhookUrl = map.get('webhookUrl') as string;
      return el;
    }
    case 'embed': {
      const el: EmbedElement = {
        ...base,
        type,
        url: map.get('url') as string,
      };
      if (map.has('title')) el.title = map.get('title') as string;
      if (map.has('aspectRatio')) el.aspectRatio = map.get('aspectRatio') as number;
      return el;
    }
    case 'chart': {
      const series = (map.get('series') as Y.Array<Y.Map<unknown>>).map(decodeChartSeries);
      const categories = (map.get('categories') as Y.Array<string>).toArray();
      const el: ChartElement = {
        ...base,
        type,
        kind: map.get('kind') as ChartElement['kind'],
        series,
        categories,
        showLegend: map.get('showLegend') as boolean,
      };
      if (map.has('xAxisTitle')) el.xAxisTitle = map.get('xAxisTitle') as string;
      if (map.has('yAxisTitle')) el.yAxisTitle = map.get('yAxisTitle') as string;
      return el;
    }
    case 'accordion': {
      const items = (map.get('items') as Y.Array<Y.Map<unknown>>).map(decodeAccordionItem);
      const el: AccordionElement = {
        ...base,
        type,
        items,
        allowMultipleOpen: map.get('allowMultipleOpen') as boolean,
      };
      return el;
    }
    case 'carousel': {
      const slides = (map.get('slides') as Y.Array<Y.Map<unknown>>).map(decodeCarouselSlide);
      const el: CarouselElement = {
        ...base,
        type,
        slides,
        showArrows: map.get('showArrows') as boolean,
        showDots: map.get('showDots') as boolean,
      };
      return el;
    }
    case 'table': {
      const columns = (map.get('columns') as Y.Array<Y.Map<unknown>>).map(decodeTableColumn);
      const rows = (map.get('rows') as Y.Array<Y.Map<unknown>>).map(decodeTableRow);
      const el: TableElement = {
        ...base,
        type,
        columns,
        rows,
        zebra: map.get('zebra') as boolean,
        collapseOnPhone: map.get('collapseOnPhone') as boolean,
      };
      return el;
    }
    case 'code': {
      const el: CodeElement = {
        ...base,
        type,
        language: map.get('language') as CodeElement['language'],
        source: map.get('source') as string,
        showLineNumbers: map.get('showLineNumbers') as boolean,
      };
      return el;
    }
    case 'nav': {
      const links = (map.get('links') as Y.Array<Y.Map<unknown>>).map(decodeNavLink);
      const el: NavElement = {
        ...base,
        type,
        links,
        layout: map.get('layout') as NavElement['layout'],
        sticky: map.get('sticky') as boolean,
      };
      if (map.has('logoAssetId')) el.logoAssetId = map.get('logoAssetId') as string;
      return el;
    }
    case 'collection': {
      const entryTemplate = (map.get('entryTemplate') as Y.Array<Y.Map<unknown>>).map(
        decodeElement,
      );
      const rawEntries = map.get('entries') as Y.Array<Y.Array<Y.Map<unknown>>>;
      const entries = rawEntries.map((row) => row.map(decodeElement));
      const layoutMap = map.get('layout') as Y.Map<unknown>;
      const el: CollectionElement = {
        ...base,
        type,
        mode: map.get('mode') as CollectionElement['mode'],
        entryTemplate,
        entries,
        layout: {
          columns: layoutMap.get('columns') as number,
          gap: layoutMap.get('gap') as number,
        },
      };
      if (map.has('filter')) {
        const filterMap = map.get('filter') as Y.Map<unknown>;
        const filter: CollectionElement['filter'] = {};
        if (filterMap.has('category')) filter.category = filterMap.get('category') as string;
        if (filterMap.has('tags')) {
          filter.tags = (filterMap.get('tags') as Y.Array<string>).toArray();
        }
        if (filterMap.has('limit')) filter.limit = filterMap.get('limit') as number;
        el.filter = filter;
      }
      if (map.has('sort')) {
        const sortMap = map.get('sort') as Y.Map<unknown>;
        el.sort = {
          field: sortMap.get('field') as CollectionElement['sort'] extends undefined
            ? never
            : NonNullable<CollectionElement['sort']>['field'],
          order: sortMap.get('order') as 'asc' | 'desc',
        };
      }
      if (map.has('cardTemplate')) {
        el.cardTemplate = (map.get('cardTemplate') as Y.Array<Y.Map<unknown>>).map(decodeElement);
      }
      if (map.has('fieldBindings')) {
        const bindingsMap = map.get('fieldBindings') as Y.Map<string>;
        const bindings: Record<string, string> = {};
        for (const [elementId, field] of bindingsMap.entries()) {
          bindings[elementId] = field;
        }
        el.fieldBindings = bindings as Record<
          string,
          NonNullable<CollectionElement['fieldBindings']>[string]
        >;
      }
      return el;
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`yjs-projection: unknown element type ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function decodeSymbolInstanceOverrides(map: Y.Map<Y.Map<unknown>>): SymbolInstanceOverrides {
  const out: SymbolInstanceOverrides = {};
  for (const [elementId, patchMap] of map.entries()) {
    const patch: Record<string, unknown> = {};
    for (const [field, value] of patchMap.entries()) {
      if (field === 'box' && value instanceof Y.Map) {
        patch.box = decodePositionedBox(value as Y.Map<unknown>);
        continue;
      }
      if (field === 'motion' && value instanceof Y.Map) {
        patch.motion = decodeMotion(value as Y.Map<unknown>);
        continue;
      }
      if (field === 'pinnedStyle' && value instanceof Y.Map) {
        patch.pinnedStyle = decodeStringRecord(value as Y.Map<string>);
        continue;
      }
      if (field === 'responsive' && value instanceof Y.Map) {
        patch.responsive = decodeResponsive(value as Y.Map<unknown>);
        continue;
      }
      if (field === 'content' && value instanceof Y.Array) {
        patch.content = decodeInlineRuns(value as Y.Array<Y.Map<unknown>>);
        continue;
      }
      patch[field] = decodeJsonValue(value);
    }
    out[elementId] = patch;
  }
  return out;
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
    section.role = map.get('role') as NonNullable<CanvasSection['role']>;
  }
  if (map.has('backgroundEffect')) {
    section.backgroundEffect = map.get('backgroundEffect') as NonNullable<
      CanvasSection['backgroundEffect']
    >;
  }
  if (map.has('entrance')) {
    section.entrance = map.get('entrance') as NonNullable<CanvasSection['entrance']>;
  }
  if (map.has('trigger')) {
    const triggerMap = map.get('trigger') as Y.Map<unknown>;
    section.trigger = {
      type: triggerMap.get('type') as NonNullable<CanvasSection['trigger']>['type'],
    };
    if (triggerMap.has('value')) {
      section.trigger.value = triggerMap.get('value') as number;
    }
  }
  if (map.has('backgroundVideo')) {
    section.backgroundVideo = map.get('backgroundVideo') as string;
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
    page.entranceAnimation = map.get('entranceAnimation') as NonNullable<CanvasPage['entranceAnimation']>;
  }
  if (map.has('scrollTriggerMode')) {
    page.scrollTriggerMode = map.get('scrollTriggerMode') as NonNullable<CanvasPage['scrollTriggerMode']>;
  }
  if (map.has('pageBackground')) page.pageBackground = map.get('pageBackground') as string;
  if (map.has('defaultMotionPreset')) {
    page.defaultMotionPreset = map.get('defaultMotionPreset') as NonNullable<CanvasPage['defaultMotionPreset']>;
  }
  if (map.has('sectionGap')) page.sectionGap = map.get('sectionGap') as number;
  if (map.has('maxWidth')) page.maxWidth = map.get('maxWidth') as number;
  if (map.has('publishedDate')) page.publishedDate = map.get('publishedDate') as string;
  if (map.has('author')) page.author = map.get('author') as string;
  if (map.has('tags')) page.tags = (map.get('tags') as Y.Array<string>).toArray();
  if (map.has('category')) page.category = map.get('category') as string;
  return page;
}

function decodeSymbolMaster(map: Y.Map<unknown>): SymbolMaster {
  return {
    id: map.get('id') as string,
    name: map.get('name') as string,
    section: decodeSection(map.get('section') as Y.Map<unknown>),
  };
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
    for (const [innerKey, innerValue] of innerMap.entries()) inner[innerKey] = decodeJsonValue(innerValue);
    out[outerKey] = inner;
  }
  return out;
}

/**
 * Decode a Y.Doc encoded by `encodeYDoc` back into a plain CanvasSiteState.
 *
 * Round-trip invariant: `decodeYDoc(encodeYDoc(state))` is deep-equal to
 * the input. The smoke test enforces this for both fixtures and a synthetic
 * state covering every ElementType.
 */
export function decodeYDoc(doc: Y.Doc): CanvasSiteState {
  const root = doc.getMap<unknown>('state');

  const state: CanvasSiteState = {
    styleKit: root.get('styleKit') as StyleKit,
    pages: (root.get('pages') as Y.Array<Y.Map<unknown>>).map(decodePage),
    symbols: (root.get('symbols') as Y.Array<Y.Map<unknown>>).map(decodeSymbolMaster),
  };
  if (root.has('customStyleKit')) {
    state.customStyleKit = decodeCustomStyleKit(root.get('customStyleKit') as Y.Map<unknown>);
  }
  if (root.has('defaultLocale')) state.defaultLocale = root.get('defaultLocale') as string;
  if (root.has('siteNoIndex')) state.siteNoIndex = root.get('siteNoIndex') as boolean;
  if (root.has('darkModeEnabled')) {
    state.darkModeEnabled = root.get('darkModeEnabled') as boolean;
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
  onPersist: (state: CanvasSiteState) => void | Promise<void>,
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
    // next debounce window. Any rejection is the caller's responsibility to
    // surface (consistent with the project's "fail loudly" posture).
    const result = onPersist(projected);
    if (result && typeof result.then === 'function') {
      // Attach a noop catch so an unawaited rejection doesn't trip
      // `unhandledRejection` handlers in the host runtime. The caller's
      // `.then` chain elsewhere remains the source of truth for errors.
      result.catch((err: unknown) => {
        console.error('[yjs-projection] autosave onPersist rejected', err);
      });
    }
  };

  const observer = (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, _tr: Y.Transaction) => {
    void _update;
    void _origin;
    void _doc;
    void _tr;
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

// ----------------------------------------------------------------------------
// Tiny runtime type-guards (used by the override encoder)
// ----------------------------------------------------------------------------

function isPositionedBox(value: unknown): value is PositionedBox {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.w === 'number' &&
    typeof v.h === 'number' &&
    typeof v.z === 'number'
  );
}

function isMotion(value: unknown): value is { preset: string; delayMs?: number } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.preset === 'string';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) return false;
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

function isResponsive(value: unknown): value is ResponsiveOverrides {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.tablet !== undefined && (typeof v.tablet !== 'object' || v.tablet === null)) return false;
  if (v.phone !== undefined && (typeof v.phone !== 'object' || v.phone === null)) return false;
  return true;
}
