// src/editor-client/inspector-component-style.ts
//
// ADR 0067 — generic Component Style inspector mount. One renderer covers
// form/accordion/tabs/carousel, driven by the shared canvas field catalog plus
// editor-only labels/section metadata.

import type { PersistContext, RenderContext } from './editor-context.js';
import { field } from './dom-builders.js';
import type { CanvasElement } from '../canvas/schema.js';
import {
  ACCORDION_STYLE_SPEC,
  ACTION_STYLE_SPEC,
  CAROUSEL_STYLE_SPEC,
  COLLECTION_STYLE_SPEC,
  COMPONENT_STYLE_FONT_WEIGHTS,
  FORM_STYLE_SPEC,
  TABS_STYLE_SPEC,
  type ComponentStyleFieldDef,
  type ComponentStyleSpec,
} from '../canvas/elements/component-style.js';

export type InspectorComponentStyleContext = RenderContext & PersistContext;

interface ComponentStyleMeta {
  label: string;
  section: string;
  placeholder?: string;
  swatchDefault?: string;
  min?: number;
  max?: number;
  step?: number;
  visibleVariants?: readonly string[];
}

const COMMON_WEIGHT_LABELS: Record<string, string> = {
  normal: 'Normal',
  medium: 'Medium',
  bold: 'Bold',
};

const STYLE_META: Record<string, Record<string, ComponentStyleMeta>> = {
  actionStyle: {
    backgroundColor: { section: 'Button', label: 'Background', swatchDefault: '#111111' },
    color: { section: 'Button', label: 'Text color', swatchDefault: '#ffffff' },
    borderRadius: { section: 'Button', label: 'Radius', min: 0, max: 999, placeholder: '8' },
    shadow: { section: 'Button', label: 'Shadow', placeholder: '0 8px 24px rgba(0,0,0,.2)' },
    fontFamily: { section: 'Typography', label: 'Font' },
    fontFamilyCustom: { section: 'Typography', label: 'Custom font', placeholder: 'Inter, system-ui' },
    fontSize: { section: 'Typography', label: 'Size', min: 8, max: 48, placeholder: 'inherit' },
    fontWeight: { section: 'Typography', label: 'Weight' },
    letterSpacing: { section: 'Typography', label: 'Letter spacing', min: 0, max: 20, step: 0.1, placeholder: '0' },
    iconGap: { section: 'Icon', label: 'Gap', min: 0, max: 64, placeholder: '8' },
  },
  formStyle: {
    fontFamily: { section: 'Typography', label: 'Font' },
    fontFamilyCustom: { section: 'Typography', label: 'Custom font', placeholder: 'Inter, system-ui' },
    fontSize: { section: 'Typography', label: 'Base size', min: 8, max: 48, placeholder: 'inherit' },
    fieldGap: { section: 'Typography', label: 'Field gap', min: 0, max: 64, placeholder: '14' },
    labelColor: { section: 'Labels', label: 'Color', swatchDefault: '#222222' },
    labelFontSize: { section: 'Labels', label: 'Size', min: 8, max: 32, placeholder: 'inherit' },
    labelFontWeight: { section: 'Labels', label: 'Weight' },
    inputBackgroundColor: { section: 'Inputs', label: 'Background', swatchDefault: '#ffffff' },
    inputColor: { section: 'Inputs', label: 'Text color', swatchDefault: '#222222' },
    inputBorderColor: { section: 'Inputs', label: 'Border color', swatchDefault: '#cccccc' },
    inputBorderWidth: { section: 'Inputs', label: 'Border width', min: 0, max: 8, placeholder: '1' },
    inputBorderRadius: { section: 'Inputs', label: 'Radius', min: 0, max: 40, placeholder: '6' },
    inputPaddingX: { section: 'Inputs', label: 'Padding X', min: 0, max: 40, placeholder: '12' },
    inputPaddingY: { section: 'Inputs', label: 'Padding Y', min: 0, max: 40, placeholder: '10' },
    inputPlaceholderColor: { section: 'Inputs', label: 'Placeholder', swatchDefault: '#999999' },
    inputFocusRingColor: { section: 'Inputs', label: 'Focus ring', swatchDefault: '#3b82f6' },
    submitBackgroundColor: { section: 'Submit', label: 'Background', swatchDefault: '#3b82f6' },
    submitColor: { section: 'Submit', label: 'Text color', swatchDefault: '#ffffff' },
    submitHoverBackgroundColor: { section: 'Submit', label: 'Hover background', swatchDefault: '#2563eb' },
    submitBorderColor: { section: 'Submit', label: 'Border color', swatchDefault: '#3b82f6' },
    submitBorderWidth: { section: 'Submit', label: 'Border width', min: 0, max: 8, placeholder: '0' },
    submitBorderRadius: { section: 'Submit', label: 'Radius', min: 0, max: 40, placeholder: '6' },
    submitPaddingX: { section: 'Submit', label: 'Padding X', min: 0, max: 60, placeholder: '18' },
    submitPaddingY: { section: 'Submit', label: 'Padding Y', min: 0, max: 40, placeholder: '10' },
    submitFontSize: { section: 'Submit', label: 'Font size', min: 8, max: 32, placeholder: '14' },
    submitFontWeight: { section: 'Submit', label: 'Font weight' },
    submitFullWidth: { section: 'Submit', label: 'Full width' },
    fieldSurfaceBackgroundColor: {
      section: 'Field surface',
      label: 'Background',
      swatchDefault: '#f6f6f6',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfaceBorderColor: {
      section: 'Field surface',
      label: 'Border color',
      swatchDefault: '#cccccc',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfaceBorderWidth: {
      section: 'Field surface',
      label: 'Border width',
      min: 0,
      max: 8,
      placeholder: '0',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfaceBorderRadius: {
      section: 'Field surface',
      label: 'Radius',
      min: 0,
      max: 48,
      placeholder: '10',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfaceShadow: {
      section: 'Field surface',
      label: 'Shadow',
      placeholder: '0 4px 16px rgba(0,0,0,.14)',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfacePaddingX: {
      section: 'Field surface',
      label: 'Padding X',
      min: 0,
      max: 64,
      placeholder: '16',
      visibleVariants: ['card', 'spotlight'],
    },
    fieldSurfacePaddingY: {
      section: 'Field surface',
      label: 'Padding Y',
      min: 0,
      max: 64,
      placeholder: '14',
      visibleVariants: ['card', 'spotlight'],
    },
    spotlightGlowColor: {
      section: 'Spotlight',
      label: 'Glow color',
      swatchDefault: '#7dd3fc',
      visibleVariants: ['spotlight'],
    },
    spotlightGlowSize: {
      section: 'Spotlight',
      label: 'Glow size',
      min: 40,
      max: 640,
      placeholder: '240',
      visibleVariants: ['spotlight'],
    },
    spotlightGlowOpacity: {
      section: 'Spotlight',
      label: 'Glow opacity',
      min: 0,
      max: 1,
      step: 0.01,
      placeholder: '0.22',
      visibleVariants: ['spotlight'],
    },
  },
  accordionStyle: {
    gap: { section: 'Layout', label: 'Gap', min: 0, max: 64, placeholder: '8' },
    itemBackgroundColor: { section: 'Item', label: 'Background', swatchDefault: '#222222' },
    itemBorderColor: { section: 'Item', label: 'Border color', swatchDefault: '#444444' },
    itemBorderWidth: { section: 'Item', label: 'Border width', min: 0, max: 8, placeholder: '1' },
    itemBorderRadius: { section: 'Item', label: 'Radius', min: 0, max: 48, placeholder: '8' },
    itemShadow: { section: 'Item', label: 'Shadow', placeholder: 'none' },
    headerBackgroundColor: { section: 'Header', label: 'Background', swatchDefault: '#222222' },
    headerColor: { section: 'Header', label: 'Text color', swatchDefault: '#ffffff' },
    headerPaddingX: { section: 'Header', label: 'Padding X', min: 0, max: 64, placeholder: '16' },
    headerPaddingY: { section: 'Header', label: 'Padding Y', min: 0, max: 64, placeholder: '12' },
    bodyColor: { section: 'Body', label: 'Text color', swatchDefault: '#222222' },
    bodyFontSize: { section: 'Body', label: 'Font size', min: 8, max: 48, placeholder: '14' },
    bodyLineHeight: { section: 'Body', label: 'Line height', min: 0.8, max: 3, step: 0.05, placeholder: '1.55' },
    bodyPaddingX: { section: 'Body', label: 'Padding X', min: 0, max: 64, placeholder: '16' },
    bodyPaddingY: { section: 'Body', label: 'Padding Y', min: 0, max: 64, placeholder: '14' },
  },
  tabsStyle: {
    barGap: { section: 'Bar', label: 'Gap', min: 0, max: 48, placeholder: '8' },
    barBackgroundColor: { section: 'Bar', label: 'Background', swatchDefault: '#222222' },
    barBorderColor: { section: 'Bar', label: 'Border color', swatchDefault: '#444444' },
    barBorderWidth: { section: 'Bar', label: 'Border width', min: 0, max: 8, placeholder: '1' },
    barRadius: { section: 'Bar', label: 'Radius', min: 0, max: 999, placeholder: '0' },
    tabPaddingX: { section: 'Tabs', label: 'Padding X', min: 0, max: 64, placeholder: '18' },
    tabPaddingY: { section: 'Tabs', label: 'Padding Y', min: 0, max: 48, placeholder: '0' },
    tabRadius: { section: 'Tabs', label: 'Radius', min: 0, max: 999, placeholder: '8' },
    tabColor: { section: 'Tabs', label: 'Text color', swatchDefault: '#9ca3af' },
    tabFontWeight: { section: 'Tabs', label: 'Font weight' },
    activeTabBackgroundColor: { section: 'Active tab', label: 'Background', swatchDefault: '#7dd3fc' },
    activeTabColor: { section: 'Active tab', label: 'Text color', swatchDefault: '#0c0c0d' },
    activeTabFontWeight: { section: 'Active tab', label: 'Font weight' },
    activeIndicatorColor: { section: 'Active tab', label: 'Indicator', swatchDefault: '#7dd3fc' },
    panelBackgroundColor: { section: 'Panel', label: 'Background', swatchDefault: '#ffffff' },
    panelBorderColor: { section: 'Panel', label: 'Border color', swatchDefault: '#dddddd' },
    panelBorderWidth: { section: 'Panel', label: 'Border width', min: 0, max: 8, placeholder: '0' },
    panelRadius: { section: 'Panel', label: 'Radius', min: 0, max: 64, placeholder: '0' },
  },
  carouselStyle: {
    captionBackgroundColor: { section: 'Caption', label: 'Background', swatchDefault: '#000000' },
    captionColor: { section: 'Caption', label: 'Text color', swatchDefault: '#ffffff' },
    captionFontSize: { section: 'Caption', label: 'Font size', min: 8, max: 64, placeholder: '14' },
    captionFontWeight: { section: 'Caption', label: 'Font weight' },
    captionLineHeight: { section: 'Caption', label: 'Line height', min: 0.8, max: 3, step: 0.05, placeholder: '1.4' },
    captionPaddingX: { section: 'Caption', label: 'Padding X', min: 0, max: 80, placeholder: '24' },
    captionPaddingY: { section: 'Caption', label: 'Padding Y', min: 0, max: 80, placeholder: '14' },
    arrowBackgroundColor: { section: 'Arrows', label: 'Background', swatchDefault: '#000000' },
    arrowColor: { section: 'Arrows', label: 'Text color', swatchDefault: '#ffffff' },
    arrowSize: { section: 'Arrows', label: 'Size', min: 16, max: 96, placeholder: '40' },
    dotBackgroundColor: { section: 'Dots', label: 'Background', swatchDefault: '#ffffff' },
    dotActiveBackgroundColor: { section: 'Dots', label: 'Active background', swatchDefault: '#ffffff' },
    dotSize: { section: 'Dots', label: 'Size', min: 4, max: 40, placeholder: '10' },
  },
  collectionStyle: {
    gridGap: { section: 'Grid', label: 'Gap', min: 0, max: 96, placeholder: '16' },
    cardBackgroundColor: {
      section: 'Card',
      label: 'Background',
      swatchDefault: '#ffffff',
      visibleVariants: ['card', 'custom'],
    },
    cardBorderColor: {
      section: 'Card',
      label: 'Border color',
      swatchDefault: '#dddddd',
      visibleVariants: ['card', 'custom'],
    },
    cardBorderWidth: {
      section: 'Card',
      label: 'Border width',
      min: 0,
      max: 8,
      placeholder: '0',
      visibleVariants: ['card', 'custom'],
    },
    cardBorderRadius: {
      section: 'Card',
      label: 'Radius',
      min: 0,
      max: 64,
      placeholder: '8',
      visibleVariants: ['card', 'custom'],
    },
    cardShadow: {
      section: 'Card',
      label: 'Shadow',
      placeholder: '0 8px 24px rgba(0,0,0,.16)',
      visibleVariants: ['card', 'custom'],
    },
    cardPadding: {
      section: 'Card',
      label: 'Padding',
      min: 0,
      max: 80,
      placeholder: '0',
      visibleVariants: ['card', 'custom'],
    },
    cardImageRadius: {
      section: 'Card image',
      label: 'Radius',
      min: 0,
      max: 64,
      placeholder: '0',
      visibleVariants: ['card', 'custom'],
    },
    imageOnlyGap: {
      section: 'Image only',
      label: 'Gap',
      min: 0,
      max: 96,
      placeholder: '16',
      visibleVariants: ['image-only'],
    },
    imageOnlyRadius: {
      section: 'Image only',
      label: 'Radius',
      min: 0,
      max: 64,
      placeholder: '0',
      visibleVariants: ['image-only'],
    },
  },
};

function specForElement(element: CanvasElement): ComponentStyleSpec | null {
  if (element.type === 'action') return ACTION_STYLE_SPEC;
  if (element.type === 'form') return FORM_STYLE_SPEC;
  if (element.type === 'accordion') return ACCORDION_STYLE_SPEC;
  if (element.type === 'tabs') return TABS_STYLE_SPEC;
  if (element.type === 'carousel') return CAROUSEL_STYLE_SPEC;
  if (element.type === 'collection') return COLLECTION_STYLE_SPEC;
  return null;
}

function currentVariant(element: CanvasElement): string {
  if (element.type === 'action') return element.variant;
  if (element.type === 'form') return element.variant ?? 'classic';
  if (element.type === 'accordion') return element.variant ?? 'list';
  if (element.type === 'tabs') return element.variant ?? 'classic';
  if (element.type === 'carousel') return element.variant ?? 'classic';
  if (element.type === 'collection') return element.display ?? 'card';
  return '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function styleObject(element: CanvasElement, spec: ComponentStyleSpec): Record<string, unknown> | undefined {
  const value = (element as unknown as Record<string, unknown>)[spec.styleKey];
  return isRecord(value) ? value : undefined;
}

function ensureStyleObject(element: CanvasElement, spec: ComponentStyleSpec): Record<string, unknown> {
  const existing = styleObject(element, spec);
  if (existing !== undefined) return existing;
  const next: Record<string, unknown> = {};
  (element as unknown as Record<string, unknown>)[spec.styleKey] = next;
  return next;
}

function deleteEmptyStyleObject(element: CanvasElement, spec: ComponentStyleSpec): void {
  const style = styleObject(element, spec);
  if (style === undefined) return;
  for (const value of Object.values(style)) {
    if (value !== undefined) return;
  }
  delete (element as unknown as Record<string, unknown>)[spec.styleKey];
}

function removePinnedConflict(element: CanvasElement, fieldDef: ComponentStyleFieldDef): void {
  if (fieldDef.cssVar === undefined || !isRecord(element.pinnedStyle)) return;
  delete element.pinnedStyle[fieldDef.cssVar];
  if (Object.keys(element.pinnedStyle).length === 0) delete element.pinnedStyle;
}

function isColourField(fieldDef: ComponentStyleFieldDef): boolean {
  return (
    fieldDef.kind === 'string' &&
    (fieldDef.key.endsWith('Color') ||
      fieldDef.key.endsWith('BackgroundColor') ||
      fieldDef.key === 'activeIndicatorColor')
  );
}

function setDataInput(node: HTMLElement, key: string): void {
  node.setAttribute('data-component-style-input', key);
}

function mountTextControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  meta: ComponentStyleMeta,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  setDataInput(input, fieldDef.key);
  input.placeholder = meta.placeholder ?? meta.swatchDefault ?? 'Unset';
  const current = styleObject(element, spec)?.[fieldDef.key];
  input.value = typeof current === 'string' ? current : '';
  input.addEventListener('input', function () {
    const raw = input.value.trim();
    const style = ensureStyleObject(element, spec);
    if (raw === '') {
      delete style[fieldDef.key];
      if (fieldDef.key === 'fontFamily') delete style.fontFamilyCustom;
    } else {
      style[fieldDef.key] = raw;
    }
    commit(fieldDef);
  });
  return input;
}

function mountColourControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  meta: ComponentStyleMeta,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'style-row';
  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'color-swatch';
  const text = document.createElement('input');
  text.type = 'text';
  text.className = 'color-hex';
  setDataInput(text, fieldDef.key);
  const current = styleObject(element, spec)?.[fieldDef.key];
  const fallback = meta.swatchDefault ?? '#000000';
  swatch.value = typeof current === 'string' && /^#[0-9a-fA-F]{6}$/.test(current) ? current : fallback;
  text.value = typeof current === 'string' ? current : '';
  text.placeholder = fallback;
  function setValue(value: string): void {
    const style = ensureStyleObject(element, spec);
    if (value.trim() === '') delete style[fieldDef.key];
    else style[fieldDef.key] = value.trim();
    commit(fieldDef);
  }
  swatch.addEventListener('input', function () {
    text.value = swatch.value;
    setValue(swatch.value);
  });
  text.addEventListener('input', function () {
    if (/^#[0-9a-fA-F]{6}$/.test(text.value.trim())) swatch.value = text.value.trim();
    setValue(text.value);
  });
  row.appendChild(swatch);
  row.appendChild(text);
  return row;
}

function mountNumberControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  meta: ComponentStyleMeta,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'style-row';
  const input = document.createElement('input');
  input.type = 'number';
  setDataInput(input, fieldDef.key);
  input.min = String(meta.min ?? 0);
  if (meta.max !== undefined) input.max = String(meta.max);
  if (meta.step !== undefined) input.step = String(meta.step);
  input.placeholder = meta.placeholder ?? 'Unset';
  const current = styleObject(element, spec)?.[fieldDef.key];
  input.value = typeof current === 'number' ? String(current) : '';
  input.addEventListener('change', function () {
    const raw = input.value.trim();
    const style = ensureStyleObject(element, spec);
    if (raw === '') {
      delete style[fieldDef.key];
      commit(fieldDef);
      return;
    }
    const n = Number(raw);
    const min = meta.min ?? 0;
    const max = meta.max;
    if (!Number.isFinite(n) || n < min || (max !== undefined && n > max)) {
      input.value = typeof current === 'number' ? String(current) : '';
      return;
    }
    style[fieldDef.key] = n;
    commit(fieldDef);
  });
  row.appendChild(input);
  if (fieldDef.kind === 'numberPx') {
    const unit = document.createElement('span');
    unit.className = 'unit-label';
    unit.textContent = 'px';
    row.appendChild(unit);
  }
  return row;
}

function mountWeightControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const select = document.createElement('select');
  setDataInput(select, fieldDef.key);
  const unset = document.createElement('option');
  unset.value = '';
  unset.textContent = 'Default';
  select.appendChild(unset);
  for (const weight of COMPONENT_STYLE_FONT_WEIGHTS) {
    const opt = document.createElement('option');
    opt.value = weight;
    opt.textContent = COMMON_WEIGHT_LABELS[weight] ?? weight;
    select.appendChild(opt);
  }
  const current = styleObject(element, spec)?.[fieldDef.key];
  select.value = typeof current === 'string' ? current : '';
  select.addEventListener('change', function () {
    const style = ensureStyleObject(element, spec);
    if (select.value === '') delete style[fieldDef.key];
    else style[fieldDef.key] = select.value;
    commit(fieldDef);
  });
  return select;
}

function mountFontFamilyControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const select = document.createElement('select');
  setDataInput(select, fieldDef.key);
  const options = [
    { value: '', label: 'Default' },
    { value: 'kit-display', label: 'Kit display' },
    { value: 'kit-body', label: 'Kit body' },
    { value: 'kit-mono', label: 'Kit mono' },
    { value: 'custom', label: 'Custom' },
  ];
  for (const entry of options) {
    const opt = document.createElement('option');
    opt.value = entry.value;
    opt.textContent = entry.label;
    select.appendChild(opt);
  }
  const current = styleObject(element, spec)?.[fieldDef.key];
  select.value = typeof current === 'string' && current !== 'inherit' ? current : '';
  select.addEventListener('change', function () {
    const style = ensureStyleObject(element, spec);
    if (select.value === '') {
      delete style[fieldDef.key];
      delete style.fontFamilyCustom;
    } else {
      style[fieldDef.key] = select.value;
      if (select.value !== 'custom') delete style.fontFamilyCustom;
    }
    commit(fieldDef);
  });
  return select;
}

function mountBooleanControl(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  const label = document.createElement('label');
  label.className = 'opencanvas-toggle';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'opencanvas-toggle-input';
  setDataInput(input, fieldDef.key);
  input.checked = styleObject(element, spec)?.[fieldDef.key] === true;
  const track = document.createElement('span');
  track.className = 'opencanvas-toggle-track';
  track.setAttribute('aria-hidden', 'true');
  label.appendChild(input);
  label.appendChild(track);
  input.addEventListener('change', function () {
    const style = ensureStyleObject(element, spec);
    if (input.checked) style[fieldDef.key] = true;
    else delete style[fieldDef.key];
    commit(fieldDef);
  });
  return label;
}

function controlForField(
  element: CanvasElement,
  spec: ComponentStyleSpec,
  fieldDef: ComponentStyleFieldDef,
  meta: ComponentStyleMeta,
  commit: (fieldDef: ComponentStyleFieldDef) => void,
): HTMLElement {
  if (fieldDef.kind === 'boolean') return mountBooleanControl(element, spec, fieldDef, commit);
  if (fieldDef.kind === 'fontFamily') return mountFontFamilyControl(element, spec, fieldDef, commit);
  if (fieldDef.kind === 'fontWeight') return mountWeightControl(element, spec, fieldDef, commit);
  if (
    fieldDef.kind === 'numberPx' ||
    fieldDef.kind === 'numberUnitless' ||
    fieldDef.kind === 'opacity'
  ) {
    return mountNumberControl(element, spec, fieldDef, meta, commit);
  }
  if (isColourField(fieldDef)) return mountColourControl(element, spec, fieldDef, meta, commit);
  return mountTextControl(element, spec, fieldDef, meta, commit);
}

function styleSections(
  element: CanvasElement,
  spec: ComponentStyleSpec,
): Map<string, Array<{ fieldDef: ComponentStyleFieldDef; meta: ComponentStyleMeta }>> {
  const metaByKey = STYLE_META[spec.styleKey];
  if (metaByKey === undefined) {
    throw new Error('mountComponentStyle: no metadata for ' + JSON.stringify(spec.styleKey));
  }
  const variant = currentVariant(element);
  const sections = new Map<string, Array<{ fieldDef: ComponentStyleFieldDef; meta: ComponentStyleMeta }>>();
  for (const fieldDef of spec.fields) {
    const meta = metaByKey[fieldDef.key];
    if (meta === undefined) {
      throw new Error(
        'mountComponentStyle: missing metadata for ' + spec.styleKey + '.' + fieldDef.key,
      );
    }
    if (meta.visibleVariants !== undefined && !meta.visibleVariants.includes(variant)) continue;
    const rows = sections.get(meta.section) ?? [];
    rows.push({ fieldDef, meta });
    sections.set(meta.section, rows);
  }
  return sections;
}

function makeDetails(title: string): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'form-style-section component-style-section';
  const summary = document.createElement('summary');
  summary.textContent = title;
  details.appendChild(summary);
  return details;
}

export function mountComponentStyle(
  ctx: InspectorComponentStyleContext,
  element: CanvasElement,
  host: HTMLElement,
): void {
  const spec = specForElement(element);
  if (spec === null) return;
  const styleSpec = spec;

  function commit(fieldDef: ComponentStyleFieldDef): void {
    removePinnedConflict(element, fieldDef);
    deleteEmptyStyleObject(element, styleSpec);
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  }

  const sections = styleSections(element, styleSpec);
  for (const [sectionTitle, rows] of sections) {
    if (rows.length === 0) continue;
    const details = makeDetails(sectionTitle);
    for (const row of rows) {
      const control = controlForField(element, styleSpec, row.fieldDef, row.meta, commit);
      details.appendChild(field(row.meta.label, control));
    }
    host.appendChild(details);
  }
}
