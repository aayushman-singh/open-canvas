// src/canvas/elements/inspector-dispatch.smoke.ts
//
// Completeness smoke for INSPECTOR_DISPATCH (ADR 0011 Step 1 dec 4).
//
// The mapped-type constraint catches "case missing entirely" at compile
// time — but it does NOT catch "case present but stub" (returns an empty
// fields array, references a path the element doesn't have, ships a
// `select` with zero options). This smoke fixtures one element per
// migrated type and walks each dispatch entry over its fixture,
// surfacing those failure modes as a build-time check.
//
// Coverage:
//   1. Every key in INSPECTOR_DISPATCH is a valid `CanvasElement['type']`.
//   2. Every spec has at least one field.
//   3. Every field has a known `kind`.
//   4. Every field references a `path` that is a property on the
//      corresponding fixture element (catches typos like 'lable' or stale
//      paths after an element shape changes).
//   5. Kind-specific shape: `select` options non-empty; `select-mapped`
//      options have label+number-value pairs; `textarea` rows positive
//      when present.

import { INSPECTOR_DISPATCH } from './index.js';
import type { InspectorField } from './inspector-spec.js';
import type { CanvasElement } from '../schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inspector-dispatch:smoke] ${message}`);
}

// One fixture per migrated element type. Only the fields a spec might
// reference need to be set — but every field that a spec MIGHT reference
// must be present here, or the path check below catches the gap. Keep the
// fixtures minimal: they document what the inspector reads, not what the
// renderer reads.
const FIXTURES: { [K in CanvasElement['type']]?: Extract<CanvasElement, { type: K }> } = {
  shape: {
    id: 'fx-shape',
    type: 'shape',
    box: { x: 0, y: 0, w: 100, h: 100, z: 0 },
    variant: 'rect',
  },
  container: {
    id: 'fx-container',
    type: 'container',
    box: { x: 0, y: 0, w: 100, h: 100, z: 0 },
    variant: 'flat',
  },
  code: {
    id: 'fx-code',
    type: 'code',
    box: { x: 0, y: 0, w: 100, h: 100, z: 0 },
    language: 'typescript',
    source: 'export const x = 1;',
    showLineNumbers: true,
  },
  embed: {
    id: 'fx-embed',
    type: 'embed',
    box: { x: 0, y: 0, w: 100, h: 100, z: 0 },
    url: 'https://youtube.com/watch?v=test',
    title: 'Test embed',
    aspectRatio: 16 / 9,
  },
  text: {
    id: 'fx-text',
    type: 'text',
    box: { x: 0, y: 0, w: 200, h: 60, z: 0 },
    content: [{ text: 'Heading', marks: [] }],
    role: 'heading',
    fontSize: 32,
    fontWeight: 600,
    align: 'left',
    lineHeight: 1.2,
  },
  action: {
    id: 'fx-action',
    type: 'action',
    box: { x: 0, y: 0, w: 120, h: 40, z: 0 },
    label: [{ text: 'Click me' }],
    variant: 'solid',
    href: { type: 'external', url: 'https://example.com' },
  },
  media: {
    id: 'fx-media',
    type: 'media',
    box: { x: 0, y: 0, w: 160, h: 120, z: 0 },
    mediaKind: 'image',
    assetId: 'fx-asset',
    alt: 'fixture image',
    fit: 'cover',
  },
  accordion: {
    id: 'fx-accordion',
    type: 'accordion',
    box: { x: 0, y: 0, w: 320, h: 240, z: 0 },
    items: [{ id: 'fx-item-1', title: 'Item 1', body: [{ text: 'Body', marks: [] }] }],
    allowMultipleOpen: false,
  },
  carousel: {
    id: 'fx-carousel',
    type: 'carousel',
    box: { x: 0, y: 0, w: 480, h: 320, z: 0 },
    slides: [{ id: 'fx-slide-1', assetId: '__placeholder__', caption: '' }],
    showArrows: true,
    showDots: true,
    direction: 'horizontal',
    arrowPosition: 'split-vertical-center',
    arrowStyle: 'round',
    mode: 'paginate',
  },
  tabs: {
    id: 'fx-tabs',
    type: 'tabs',
    box: { x: 0, y: 0, w: 640, h: 360, z: 0 },
    activeTabId: 'overview',
    tabBarHeight: 56,
    tabs: [
      { id: 'overview', label: [{ text: 'Overview' }], elements: [] },
      { id: 'details', label: [{ text: 'Details' }], elements: [] },
    ],
  },
  table: {
    id: 'fx-table',
    type: 'table',
    box: { x: 0, y: 0, w: 480, h: 240, z: 0 },
    columns: [{ id: 'fx-col-1', header: 'Name' }],
    rows: [{ id: 'fx-row-1', cells: { 'fx-col-1': 'Alice' } }],
    zebra: true,
    collapseOnPhone: false,
  },
  nav: {
    id: 'fx-nav',
    type: 'nav',
    box: { x: 0, y: 0, w: 800, h: 60, z: 0 },
    links: [{ label: 'Home', href: '/', kind: 'internal' }],
    layout: 'left-right',
    sticky: false,
    // logoAssetId is intentionally absent — the spec uses `emptyOmits` for
    // this field so "absent" is its canonical empty state. The path check
    // below exempts emptyOmits text fields for this reason.
  },
  chart: {
    id: 'fx-chart',
    type: 'chart',
    box: { x: 0, y: 0, w: 480, h: 320, z: 0 },
    kind: 'bar',
    series: [{ label: 'A', values: [1, 2, 3] }],
    categories: ['Jan', 'Feb', 'Mar'],
    showLegend: true,
    // xAxisTitle + yAxisTitle intentionally absent (emptyOmits).
  },
  form: {
    id: 'fx-form',
    type: 'form',
    box: { x: 0, y: 0, w: 360, h: 240, z: 0 },
    title: 'Contact form',
    fields: [{ id: 'fx-field-1', label: 'Name', kind: 'text', required: false }],
    submitLabel: 'Submit',
    successMessage: 'Thanks!',
    webhookUrl: '',
  },
};

// Action handlers, busy flags, and mount handlers the interpreter binds
// inside canvas-client.ts. Mirrored here so the smoke can verify that every
// `button-action` / `custom-mount` field in a migrated spec names a
// registered handler — the interpreter throws at first mount on a missing
// handler, so this check catches the gap at build-time instead.
const REGISTERED_ACTIONS = ['rewrite-text', 'replace-media'] as const;
const REGISTERED_BUSY_FLAGS = ['aiBusy'] as const;
const REGISTERED_MOUNTS = [
  'media-picker',
  'media-ai',
  'video-playback',
  'accordion-items',
  'carousel-slides',
  'table-grid',
  'nav-links',
  'nav-primary-action',
  'chart-data',
  'form-fields',
  'form-style',
] as const;

function checkField(field: InspectorField, fixture: object, where: string): void {
  // `action-href` carries its own two labels (discriminator + value) instead
  // of a single `label` — both must be non-empty strings.
  // `custom-mount` is label-free and path-free by design: its handler runs
  // imperative DOM and may decide to render nothing (e.g. video-playback on
  // image elements). Skip both checks for that kind.
  if (field.kind === 'action-href') {
    assert(
      typeof field.discriminatorLabel === 'string' && field.discriminatorLabel.length > 0,
      `${where} action-href: discriminatorLabel required`,
    );
    assert(
      typeof field.valueLabel === 'string' && field.valueLabel.length > 0,
      `${where} action-href: valueLabel required`,
    );
  } else if (field.kind !== 'custom-mount') {
    assert(typeof field.label === 'string' && field.label.length > 0, `${where}: label required`);
  }

  // `button-action` + `custom-mount` are the path-free field kinds — they
  // dispatch via named handlers instead of binding to an element property.
  // Text fields with `emptyOmits` are exempt from the path-presence check
  // because their canonical empty state is "key absent" — the fixture
  // omitting the key is the correct shape, not a typo.
  if (field.kind !== 'button-action' && field.kind !== 'custom-mount') {
    assert(typeof field.path === 'string' && field.path.length > 0, `${where}: path required`);
    const exempt = field.kind === 'text' && field.emptyOmits === true;
    if (!exempt) {
      assert(
        Object.prototype.hasOwnProperty.call(fixture, field.path),
        `${where}: path "${field.path}" is not present on the fixture (catches typos and stale paths)`,
      );
    }
  }

  switch (field.kind) {
    case 'select':
      assert(field.options.length > 0, `${where} select: options must be non-empty`);
      for (const opt of field.options) {
        assert(typeof opt === 'string', `${where} select: options must be strings`);
      }
      return;
    case 'select-mapped':
      assert(field.options.length > 0, `${where} select-mapped: options must be non-empty`);
      for (const opt of field.options) {
        assert(
          typeof opt.label === 'string' && opt.label.length > 0,
          `${where} select-mapped: option.label required`,
        );
        assert(
          typeof opt.value === 'number' && Number.isFinite(opt.value),
          `${where} select-mapped: option.value must be a finite number`,
        );
      }
      assert(
        typeof field.defaultValue === 'number' && Number.isFinite(field.defaultValue),
        `${where} select-mapped: defaultValue must be a finite number`,
      );
      return;
    case 'text':
      return;
    case 'textarea':
      if (field.rows !== undefined) {
        assert(
          Number.isInteger(field.rows) && field.rows > 0,
          `${where} textarea: rows must be a positive integer when present`,
        );
      }
      return;
    case 'checkbox':
      return;
    case 'number':
      if (field.min !== undefined && field.max !== undefined) {
        assert(
          field.min <= field.max,
          `${where} number: min (${String(field.min)}) must be <= max (${String(field.max)})`,
        );
      }
      return;
    case 'button-action':
      assert(
        REGISTERED_ACTIONS.includes(field.action as (typeof REGISTERED_ACTIONS)[number]),
        `${where} button-action: action "${field.action}" is not in REGISTERED_ACTIONS (register the handler in canvas-client.ts before referencing it from a spec)`,
      );
      if (field.busyFlag !== undefined) {
        assert(
          REGISTERED_BUSY_FLAGS.includes(field.busyFlag as (typeof REGISTERED_BUSY_FLAGS)[number]),
          `${where} button-action: busyFlag "${field.busyFlag}" is not in REGISTERED_BUSY_FLAGS`,
        );
      }
      return;
    case 'action-href': {
      const value = (fixture as Record<string, unknown>)[field.path];
      assert(
        value !== null && typeof value === 'object',
        `${where} action-href: fixture[${field.path}] must be an object (the ActionHref DU)`,
      );
      const type = (value as { type?: unknown }).type;
      assert(
        type === 'external' || type === 'page',
        `${where} action-href: fixture[${field.path}].type must be 'external' or 'page', got ${JSON.stringify(type)}`,
      );
      return;
    }
    case 'custom-mount':
      assert(
        REGISTERED_MOUNTS.includes(field.name as (typeof REGISTERED_MOUNTS)[number]),
        `${where} custom-mount: name "${field.name}" is not in REGISTERED_MOUNTS (register the mount handler in canvas-client.ts before referencing it from a spec)`,
      );
      return;
    default: {
      const exhaustive: never = field;
      void exhaustive;
      throw new Error(
        `${where}: unknown field kind ${JSON.stringify((field as { kind: string }).kind)}`,
      );
    }
  }
}

const tabsSpec = (
  INSPECTOR_DISPATCH as unknown as Record<
    string,
    { readonly fields: readonly InspectorField[] } | undefined
  >
).tabs;
assert(tabsSpec !== undefined, 'tabs: sidebar-creatable elements must have an inspector spec');
assert(
  tabsSpec.fields.some((field) => 'path' in field && field.path === 'activeTabId') &&
    tabsSpec.fields.some((field) => 'path' in field && field.path === 'tabBarHeight'),
  'tabs: inspector spec must expose activeTabId and tabBarHeight',
);

const types = Object.keys(INSPECTOR_DISPATCH) as Array<keyof typeof INSPECTOR_DISPATCH>;
assert(types.length > 0, 'INSPECTOR_DISPATCH must declare at least one entry');

for (const type of types) {
  const spec = INSPECTOR_DISPATCH[type];
  assert(spec !== undefined, `${type}: dispatch entry must be defined`);
  assert(
    spec.fields.length > 0,
    `${type}: spec.fields must be non-empty (a stub spec hides the editor field)`,
  );

  const fixture = FIXTURES[type];
  assert(
    fixture !== undefined,
    `${type}: no fixture in this smoke — add one to FIXTURES so path checks can run`,
  );

  spec.fields.forEach((field, i) => {
    checkField(field, fixture, `${type}[${String(i)}]`);
  });
}

console.log(`[inspector-dispatch:smoke] OK — ${String(types.length)} dispatch entries verified`);
