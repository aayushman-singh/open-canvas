// src/canvas/elements/component-style.ts
//
// ADR 0067 — Component Style field catalog. The owner-facing concept is
// "Component Style", but persisted fields stay per element (`formStyle`,
// `accordionStyle`, etc.) so snapshots and validation errors retain ownership.

import type { JsonSchema } from '../../agent/llm.js';
import type { CanvasElement } from '../schema.js';
import { escapeCssValue } from './render-utils.js';

export const COMPONENT_STYLE_FONT_WEIGHTS = ['normal', 'medium', 'bold'] as const;
export type ComponentStyleFontWeight = (typeof COMPONENT_STYLE_FONT_WEIGHTS)[number];

export type ComponentStyleFieldKind =
  | 'boolean'
  | 'fontFamily'
  | 'fontWeight'
  | 'numberPx'
  | 'numberUnitless'
  | 'opacity'
  | 'string';

export interface ComponentStyleFieldDef {
  key: string;
  kind: ComponentStyleFieldKind;
  cssVar?: string;
}

export interface ComponentStyleSpec {
  styleKey: string;
  fields: readonly ComponentStyleFieldDef[];
}

export const ACTION_STYLE_FIELDS = [
  { key: 'backgroundColor', kind: 'string', cssVar: '--opencanvas-action-bg' },
  { key: 'color', kind: 'string', cssVar: '--opencanvas-action-color' },
  { key: 'borderRadius', kind: 'numberPx', cssVar: '--opencanvas-action-radius' },
  { key: 'shadow', kind: 'string', cssVar: '--opencanvas-action-shadow' },
  { key: 'fontFamily', kind: 'fontFamily', cssVar: '--opencanvas-action-font-family' },
  { key: 'fontFamilyCustom', kind: 'string' },
  { key: 'fontSize', kind: 'numberPx', cssVar: '--opencanvas-action-font-size' },
  { key: 'fontWeight', kind: 'fontWeight', cssVar: '--opencanvas-action-font-weight' },
  { key: 'letterSpacing', kind: 'numberPx', cssVar: '--opencanvas-action-letter-spacing' },
  { key: 'iconGap', kind: 'numberPx', cssVar: '--opencanvas-action-gap' },
] as const satisfies readonly ComponentStyleFieldDef[];
export const FORM_STYLE_FIELDS = [
  { key: 'fontFamily', kind: 'fontFamily', cssVar: '--opencanvas-form-font-family' },
  { key: 'fontFamilyCustom', kind: 'string' },
  { key: 'fontSize', kind: 'numberPx', cssVar: '--opencanvas-form-font-size' },
  { key: 'fieldGap', kind: 'numberPx', cssVar: '--opencanvas-form-gap' },
  { key: 'labelColor', kind: 'string', cssVar: '--opencanvas-form-label-color' },
  { key: 'labelFontSize', kind: 'numberPx', cssVar: '--opencanvas-form-label-size' },
  { key: 'labelFontWeight', kind: 'fontWeight', cssVar: '--opencanvas-form-label-weight' },
  { key: 'inputBackgroundColor', kind: 'string', cssVar: '--opencanvas-form-input-bg' },
  { key: 'inputColor', kind: 'string', cssVar: '--opencanvas-form-input-color' },
  { key: 'inputBorderColor', kind: 'string', cssVar: '--opencanvas-form-input-border-color' },
  { key: 'inputBorderWidth', kind: 'numberPx', cssVar: '--opencanvas-form-input-border-width' },
  { key: 'inputBorderRadius', kind: 'numberPx', cssVar: '--opencanvas-form-input-radius' },
  { key: 'inputPaddingX', kind: 'numberPx', cssVar: '--opencanvas-form-input-pad-x' },
  { key: 'inputPaddingY', kind: 'numberPx', cssVar: '--opencanvas-form-input-pad-y' },
  { key: 'inputPlaceholderColor', kind: 'string', cssVar: '--opencanvas-form-placeholder-color' },
  { key: 'inputFocusRingColor', kind: 'string', cssVar: '--opencanvas-form-focus-ring' },
  { key: 'submitBackgroundColor', kind: 'string', cssVar: '--opencanvas-form-submit-bg' },
  { key: 'submitColor', kind: 'string', cssVar: '--opencanvas-form-submit-color' },
  {
    key: 'submitHoverBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-form-submit-hover-bg',
  },
  {
    key: 'submitBorderColor',
    kind: 'string',
    cssVar: '--opencanvas-form-submit-border-color',
  },
  {
    key: 'submitBorderWidth',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-submit-border-width',
  },
  { key: 'submitBorderRadius', kind: 'numberPx', cssVar: '--opencanvas-form-submit-radius' },
  { key: 'submitPaddingX', kind: 'numberPx', cssVar: '--opencanvas-form-submit-pad-x' },
  { key: 'submitPaddingY', kind: 'numberPx', cssVar: '--opencanvas-form-submit-pad-y' },
  { key: 'submitFontSize', kind: 'numberPx', cssVar: '--opencanvas-form-submit-size' },
  { key: 'submitFontWeight', kind: 'fontWeight', cssVar: '--opencanvas-form-submit-weight' },
  { key: 'submitFullWidth', kind: 'boolean' },
  {
    key: 'fieldSurfaceBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-form-field-surface-bg',
  },
  {
    key: 'fieldSurfaceBorderColor',
    kind: 'string',
    cssVar: '--opencanvas-form-field-surface-border-color',
  },
  {
    key: 'fieldSurfaceBorderWidth',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-field-surface-border-width',
  },
  {
    key: 'fieldSurfaceBorderRadius',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-field-surface-radius',
  },
  {
    key: 'fieldSurfaceShadow',
    kind: 'string',
    cssVar: '--opencanvas-form-field-surface-shadow',
  },
  {
    key: 'fieldSurfacePaddingX',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-field-surface-pad-x',
  },
  {
    key: 'fieldSurfacePaddingY',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-field-surface-pad-y',
  },
  {
    key: 'spotlightGlowColor',
    kind: 'string',
    cssVar: '--opencanvas-form-spotlight-glow-color',
  },
  {
    key: 'spotlightGlowSize',
    kind: 'numberPx',
    cssVar: '--opencanvas-form-spotlight-glow-size',
  },
  {
    key: 'spotlightGlowOpacity',
    kind: 'opacity',
    cssVar: '--opencanvas-form-spotlight-glow-opacity',
  },
] as const satisfies readonly ComponentStyleFieldDef[];

export const ACCORDION_STYLE_FIELDS = [
  { key: 'gap', kind: 'numberPx', cssVar: '--opencanvas-accordion-gap' },
  { key: 'itemBackgroundColor', kind: 'string', cssVar: '--opencanvas-accordion-item-bg' },
  {
    key: 'itemBorderColor',
    kind: 'string',
    cssVar: '--opencanvas-accordion-item-border-color',
  },
  {
    key: 'itemBorderWidth',
    kind: 'numberPx',
    cssVar: '--opencanvas-accordion-item-border-width',
  },
  { key: 'itemBorderRadius', kind: 'numberPx', cssVar: '--opencanvas-accordion-item-radius' },
  { key: 'itemShadow', kind: 'string', cssVar: '--opencanvas-accordion-item-shadow' },
  {
    key: 'headerBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-accordion-header-bg',
  },
  { key: 'headerColor', kind: 'string', cssVar: '--opencanvas-accordion-header-color' },
  { key: 'headerPaddingX', kind: 'numberPx', cssVar: '--opencanvas-accordion-header-pad-x' },
  { key: 'headerPaddingY', kind: 'numberPx', cssVar: '--opencanvas-accordion-header-pad-y' },
  { key: 'bodyColor', kind: 'string', cssVar: '--opencanvas-accordion-body-color' },
  { key: 'bodyFontSize', kind: 'numberPx', cssVar: '--opencanvas-accordion-body-font-size' },
  {
    key: 'bodyLineHeight',
    kind: 'numberUnitless',
    cssVar: '--opencanvas-accordion-body-line-height',
  },
  { key: 'bodyPaddingX', kind: 'numberPx', cssVar: '--opencanvas-accordion-body-pad-x' },
  { key: 'bodyPaddingY', kind: 'numberPx', cssVar: '--opencanvas-accordion-body-pad-y' },
] as const satisfies readonly ComponentStyleFieldDef[];

export const TABS_STYLE_FIELDS = [
  { key: 'barGap', kind: 'numberPx', cssVar: '--opencanvas-tabs-bar-gap' },
  { key: 'barBackgroundColor', kind: 'string', cssVar: '--opencanvas-tabs-bar-bg' },
  { key: 'barBorderColor', kind: 'string', cssVar: '--opencanvas-tabs-bar-border-color' },
  { key: 'barBorderWidth', kind: 'numberPx', cssVar: '--opencanvas-tabs-bar-border-width' },
  { key: 'barRadius', kind: 'numberPx', cssVar: '--opencanvas-tabs-bar-radius' },
  { key: 'tabPaddingX', kind: 'numberPx', cssVar: '--opencanvas-tabs-tab-pad-x' },
  { key: 'tabPaddingY', kind: 'numberPx', cssVar: '--opencanvas-tabs-tab-pad-y' },
  { key: 'tabRadius', kind: 'numberPx', cssVar: '--opencanvas-tabs-tab-radius' },
  { key: 'tabColor', kind: 'string', cssVar: '--opencanvas-tabs-tab-color' },
  { key: 'tabFontWeight', kind: 'fontWeight', cssVar: '--opencanvas-tabs-tab-font-weight' },
  {
    key: 'activeTabBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-tabs-active-tab-bg',
  },
  { key: 'activeTabColor', kind: 'string', cssVar: '--opencanvas-tabs-active-tab-color' },
  {
    key: 'activeTabFontWeight',
    kind: 'fontWeight',
    cssVar: '--opencanvas-tabs-active-tab-font-weight',
  },
  {
    key: 'activeIndicatorColor',
    kind: 'string',
    cssVar: '--opencanvas-tabs-active-indicator-color',
  },
  { key: 'panelBackgroundColor', kind: 'string', cssVar: '--opencanvas-tabs-panel-bg' },
  {
    key: 'panelBorderColor',
    kind: 'string',
    cssVar: '--opencanvas-tabs-panel-border-color',
  },
  {
    key: 'panelBorderWidth',
    kind: 'numberPx',
    cssVar: '--opencanvas-tabs-panel-border-width',
  },
  { key: 'panelRadius', kind: 'numberPx', cssVar: '--opencanvas-tabs-panel-radius' },
] as const satisfies readonly ComponentStyleFieldDef[];

export const CAROUSEL_STYLE_FIELDS = [
  {
    key: 'captionBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-carousel-caption-bg',
  },
  { key: 'captionColor', kind: 'string', cssVar: '--opencanvas-carousel-caption-color' },
  {
    key: 'captionFontSize',
    kind: 'numberPx',
    cssVar: '--opencanvas-carousel-caption-font-size',
  },
  {
    key: 'captionFontWeight',
    kind: 'fontWeight',
    cssVar: '--opencanvas-carousel-caption-font-weight',
  },
  {
    key: 'captionLineHeight',
    kind: 'numberUnitless',
    cssVar: '--opencanvas-carousel-caption-line-height',
  },
  { key: 'captionPaddingX', kind: 'numberPx', cssVar: '--opencanvas-carousel-caption-pad-x' },
  { key: 'captionPaddingY', kind: 'numberPx', cssVar: '--opencanvas-carousel-caption-pad-y' },
  { key: 'arrowBackgroundColor', kind: 'string', cssVar: '--opencanvas-carousel-arrow-bg' },
  { key: 'arrowColor', kind: 'string', cssVar: '--opencanvas-carousel-arrow-color' },
  { key: 'arrowSize', kind: 'numberPx', cssVar: '--opencanvas-carousel-arrow-size' },
  { key: 'dotBackgroundColor', kind: 'string', cssVar: '--opencanvas-carousel-dot-bg' },
  {
    key: 'dotActiveBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-carousel-dot-active-bg',
  },
  { key: 'dotSize', kind: 'numberPx', cssVar: '--opencanvas-carousel-dot-size' },
] as const satisfies readonly ComponentStyleFieldDef[];

export const COLLECTION_STYLE_FIELDS = [
  { key: 'gridGap', kind: 'numberPx', cssVar: '--opencanvas-collection-grid-gap' },
  {
    key: 'cardBackgroundColor',
    kind: 'string',
    cssVar: '--opencanvas-collection-card-bg',
  },
  {
    key: 'cardBorderColor',
    kind: 'string',
    cssVar: '--opencanvas-collection-card-border-color',
  },
  {
    key: 'cardBorderWidth',
    kind: 'numberPx',
    cssVar: '--opencanvas-collection-card-border-width',
  },
  {
    key: 'cardBorderRadius',
    kind: 'numberPx',
    cssVar: '--opencanvas-collection-card-radius',
  },
  { key: 'cardShadow', kind: 'string', cssVar: '--opencanvas-collection-card-shadow' },
  { key: 'cardPadding', kind: 'numberPx', cssVar: '--opencanvas-collection-card-padding' },
  {
    key: 'cardImageRadius',
    kind: 'numberPx',
    cssVar: '--opencanvas-collection-card-image-radius',
  },
  { key: 'imageOnlyGap', kind: 'numberPx', cssVar: '--opencanvas-collection-image-only-gap' },
  {
    key: 'imageOnlyRadius',
    kind: 'numberPx',
    cssVar: '--opencanvas-collection-image-only-radius',
  },
] as const satisfies readonly ComponentStyleFieldDef[];

export const ACTION_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'actionStyle',
  fields: ACTION_STYLE_FIELDS,
};
export const FORM_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'formStyle',
  fields: FORM_STYLE_FIELDS,
};
export const ACCORDION_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'accordionStyle',
  fields: ACCORDION_STYLE_FIELDS,
};
export const TABS_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'tabsStyle',
  fields: TABS_STYLE_FIELDS,
};
export const CAROUSEL_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'carouselStyle',
  fields: CAROUSEL_STYLE_FIELDS,
};
export const COLLECTION_STYLE_SPEC: ComponentStyleSpec = {
  styleKey: 'collectionStyle',
  fields: COLLECTION_STYLE_FIELDS,
};

export const COMPONENT_STYLE_SPECS = [
  ACTION_STYLE_SPEC,
  FORM_STYLE_SPEC,
  ACCORDION_STYLE_SPEC,
  TABS_STYLE_SPEC,
  CAROUSEL_STYLE_SPEC,
  COLLECTION_STYLE_SPEC,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fontWeightCss(value: ComponentStyleFontWeight): string {
  if (value === 'normal') return '400';
  if (value === 'medium') return '500';
  return '700';
}

function schemaForField(field: ComponentStyleFieldDef): JsonSchema {
  if (field.kind === 'boolean') return { type: 'boolean' };
  if (field.kind === 'numberPx' || field.kind === 'numberUnitless') {
    return { type: 'number', minimum: 0 };
  }
  if (field.kind === 'opacity') return { type: 'number', minimum: 0, maximum: 1 };
  if (field.kind === 'fontFamily') {
    return {
      type: 'string',
      enum: ['inherit', 'kit-display', 'kit-body', 'kit-mono', 'custom'],
    };
  }
  if (field.kind === 'fontWeight') {
    return { type: 'string', enum: COMPONENT_STYLE_FONT_WEIGHTS };
  }
  return { type: 'string' };
}

export function componentStylePatchProperty(spec: ComponentStyleSpec): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  for (const field of spec.fields) {
    properties[field.key] = schemaForField(field);
  }
  return {
    type: 'object',
    description: `${spec.styleKey} sparse Component Style object. Omit a key to inherit the selected variant; send only the fields you mean to own.`,
    properties,
  };
}

export function parseComponentStylePatchValue(
  value: unknown,
  spec: ComponentStyleSpec,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${spec.styleKey} must be an object`);
  const fields = new Map(spec.fields.map((field) => [field.key, field]));
  const out: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const field = fields.get(key);
    const path = `${spec.styleKey}.${key}`;
    if (field === undefined) throw new Error(`${path} is not a supported field`);
    if (field.kind === 'boolean') {
      if (typeof fieldValue !== 'boolean') throw new Error(`${path} must be a boolean`);
      out[key] = fieldValue;
    } else if (field.kind === 'numberPx' || field.kind === 'numberUnitless') {
      if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue) || fieldValue < 0) {
        throw new Error(`${path} must be a non-negative finite number`);
      }
      out[key] = fieldValue;
    } else if (field.kind === 'opacity') {
      if (
        typeof fieldValue !== 'number' ||
        !Number.isFinite(fieldValue) ||
        fieldValue < 0 ||
        fieldValue > 1
      ) {
        throw new Error(`${path} must be a finite number in [0, 1]`);
      }
      out[key] = fieldValue;
    } else if (field.kind === 'fontFamily') {
      if (
        typeof fieldValue !== 'string' ||
        !['inherit', 'kit-display', 'kit-body', 'kit-mono', 'custom'].includes(fieldValue)
      ) {
        throw new Error(`${path} must be one of [inherit, kit-display, kit-body, kit-mono, custom]`);
      }
      out[key] = fieldValue;
    } else if (field.kind === 'fontWeight') {
      if (
        typeof fieldValue !== 'string' ||
        !(COMPONENT_STYLE_FONT_WEIGHTS as readonly string[]).includes(fieldValue)
      ) {
        throw new Error(`${path} must be one of [${COMPONENT_STYLE_FONT_WEIGHTS.join(', ')}]`);
      }
      out[key] = fieldValue;
    } else {
      if (typeof fieldValue !== 'string') throw new Error(`${path} must be a string`);
      if (escapeCssValue(fieldValue) === '') {
        throw new Error(`${path} contains an unsafe CSS value`);
      }
      out[key] = fieldValue;
    }
  }
  return out;
}

function cssValueForField(
  field: ComponentStyleFieldDef,
  value: unknown,
  style: Record<string, unknown>,
): string | null {
  if (value === undefined) return null;
  if (field.kind === 'fontFamily') {
    if (value === 'inherit') return null;
    if (value === 'kit-display') return 'var(--opencanvas-kit-font-display, inherit)';
    if (value === 'kit-body') return 'var(--opencanvas-kit-font-body, inherit)';
    if (value === 'kit-mono') return 'var(--opencanvas-kit-font-mono, inherit)';
    if (value === 'custom') {
      const custom = style.fontFamilyCustom;
      if (typeof custom !== 'string') return null;
      const safe = escapeCssValue(custom);
      if (safe === '') {
        throw new Error(`${field.key} contains an unsafe CSS value`);
      }
      return safe;
    }
    throw new Error(`${field.key} must be a supported font family`);
  }
  if (field.kind === 'fontWeight') {
    if (!(COMPONENT_STYLE_FONT_WEIGHTS as readonly unknown[]).includes(value)) {
      throw new Error(`${field.key} must be a supported font weight`);
    }
    return fontWeightCss(value as ComponentStyleFontWeight);
  }
  if (field.kind === 'numberPx') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field.key} must be a finite number`);
    }
    return `${String(value)}px`;
  }
  if (field.kind === 'numberUnitless' || field.kind === 'opacity') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${field.key} must be a finite number`);
    }
    return String(value);
  }
  if (field.kind === 'boolean') return null;
  if (typeof value !== 'string') throw new Error(`${field.key} must be a string`);
  const safe = escapeCssValue(value);
  if (safe === '') throw new Error(`${field.key} contains an unsafe CSS value`);
  return safe;
}

export function componentStyleCssEntries(
  spec: ComponentStyleSpec,
  style: Record<string, unknown> | undefined,
): Array<[string, string]> {
  if (style === undefined) return [];
  const fields = new Map(spec.fields.map((field) => [field.key, field]));
  for (const key of Object.keys(style)) {
    if (!fields.has(key)) throw new Error(`${spec.styleKey}.${key} is not a supported field`);
  }
  const entries: Array<[string, string]> = [];
  for (const field of spec.fields) {
    if (field.cssVar === undefined) continue;
    const value = cssValueForField(field, style[field.key], style);
    if (value !== null) entries.push([field.cssVar, value]);
  }
  return entries;
}

export function componentStyleEntriesForElement(element: CanvasElement): Array<[string, string]> {
  if (element.type === 'action') {
    return componentStyleCssEntries(
      ACTION_STYLE_SPEC,
      element.actionStyle as Record<string, unknown> | undefined,
    );
  }
  if (element.type === 'form') {
    return componentStyleCssEntries(
      FORM_STYLE_SPEC,
      element.formStyle as Record<string, unknown> | undefined,
    );
  }
  if (element.type === 'accordion') {
    return componentStyleCssEntries(
      ACCORDION_STYLE_SPEC,
      element.accordionStyle as Record<string, unknown> | undefined,
    );
  }
  if (element.type === 'tabs') {
    return componentStyleCssEntries(
      TABS_STYLE_SPEC,
      element.tabsStyle as Record<string, unknown> | undefined,
    );
  }
  if (element.type === 'carousel') {
    return componentStyleCssEntries(
      CAROUSEL_STYLE_SPEC,
      element.carouselStyle as Record<string, unknown> | undefined,
    );
  }
  if (element.type === 'collection') {
    return componentStyleCssEntries(
      COLLECTION_STYLE_SPEC,
      element.collectionStyle as Record<string, unknown> | undefined,
    );
  }
  return [];
}
