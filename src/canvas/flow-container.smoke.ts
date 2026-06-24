// src/canvas/flow-container.smoke.ts
//
// Flow Container v1 (ADRs 0078-0080):
//   1. A Flow Container is a compound element inside a Canvas Section.
//   2. Its layout grammar emits real stack/row/grid flow DOM.
//   3. Flow Items place hosted Content Elements without reusing the
//      section-positioned absolute wrapper.
//   4. Validation owns layout/item shape, nested ids, and nested anchors.
//   5. Yjs projection round-trips the nested item graph without data loss.
//
// Run with `bun.cmd run src/canvas/flow-container.smoke.ts`.

import type {
  ActionElement,
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  MediaElement,
  PublishedSnapshot,
  TextElement,
} from './schema.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite, validatePublishedSnapshot } from './validate.js';
import { decodeYDoc, encodeYDoc } from './yjs-projection.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[flow-container:smoke] ${message}`);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

function assertDeepEqual(actual: unknown, expected: unknown, label: string): void {
  const a = stableStringify(actual);
  const e = stableStringify(expected);
  assert(a === e, `${label}: deep-equal failed\nactual: ${a}\nexpected: ${e}`);
}

function textElement(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'flow-copy',
    type: 'text',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    content: [{ text: 'Flow headline' }],
    role: 'heading',
    fontSize: 28,
    fontWeight: 600,
    align: 'left',
    ...overrides,
  };
}

function copyAction(): ActionElement {
  return {
    id: 'flow-action',
    type: 'action',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    label: [{ text: 'Copy email' }],
    behavior: { type: 'copy', value: 'hello@example.com' },
    variant: 'solid',
  };
}

function imageElement(overrides: Partial<MediaElement> = {}): MediaElement {
  return {
    id: 'flow-image',
    type: 'media',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    mediaKind: 'image',
    assetId: 'asset-flow-image',
    alt: 'Flow image',
    fit: 'cover',
    ...overrides,
  };
}

function flowElement(overrides: Record<string, unknown> = {}): CanvasElement {
  const flow = {
    id: 'flow-grid',
    type: 'flow-container',
    box: { x: 80, y: 96, w: 960, h: 360, z: 2 },
    layout: {
      mode: 'grid',
      columns: 3,
      gap: { row: 24, column: 16 },
      padding: { top: 12, right: 14, bottom: 16, left: 18 },
      align: 'stretch',
      justify: 'start',
      responsive: {
        tablet: { columns: 2 },
        phone: { columns: 1, gap: { row: 12, column: 12 } },
      },
    },
    items: [
      {
        id: 'headline',
        span: 2,
        align: 'center',
        element: textElement({ id: 'flow-headline', anchorId: 'flow-anchor' }),
      },
      {
        id: 'cta',
        element: copyAction(),
        responsive: { phone: { order: -1 } },
      },
    ],
    ...overrides,
  };
  return flow as unknown as CanvasElement;
}

function siteWith(elements: CanvasElement[]): EditableSite {
  const section: CanvasSection = {
    id: 'section-flow',
    recipeId: 'custom',
    name: 'Flow',
    height: 720,
    elements,
  };
  const page: CanvasPage = {
    id: 'page-flow',
    slug: 'flow',
    title: 'Flow',
    width: 1200,
    sections: [section],
  };
  return { styleKit: 'charcoal', pages: [page] };
}

function renderHtml(state: EditableSite): string {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-16T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'flow-site', {
    turnstileSiteKey: 'test-turnstile-key',
  });
}

// Renderer: root layout and Flow Items emit semantic flow DOM.
{
  const html = renderHtml(siteWith([flowElement()]));
  assert(
    html.includes('data-element-type="flow-container"'),
    `missing flow element wrapper: ${html}`,
  );
  assert(
    html.includes('data-opencanvas-flow-container="flow-grid"'),
    `missing flow container root: ${html}`,
  );
  assert(html.includes('data-flow-layout-mode="grid"'), `missing grid layout mode: ${html}`);
  assert(
    html.includes('display:grid') &&
      html.includes('grid-template-columns:repeat(3,minmax(0,1fr))') &&
      html.includes('gap:24px 16px') &&
      html.includes('padding:12px 14px 16px 18px'),
    `grid style did not render expected grammar: ${html}`,
  );
  assert(
    html.includes('data-opencanvas-flow-item="headline"') &&
      html.includes('grid-column:span 2') &&
      html.includes('align-self:center'),
    `flow item placement style missing: ${html}`,
  );
  assert(
    html.includes('<style data-opencanvas-flow-responsive="flow-grid"') &&
      html.includes('@media (max-width: 767px)') &&
      html.includes('[data-opencanvas-flow-container="flow-grid"]') &&
      html.includes('grid-template-columns:repeat(1,minmax(0,1fr))') &&
      html.includes('[data-opencanvas-flow-item="cta"]') &&
      html.includes('order:-1'),
    `flow responsive overrides did not emit scoped CSS: ${html}`,
  );
}

// Renderer: stack mode emits vertical flex flow without row wrapping.
{
  const html = renderHtml(
    siteWith([
      flowElement({
        id: 'flow-stack',
        layout: {
          mode: 'stack',
          gap: { row: 10, column: 0 },
          padding: { top: 8, right: 8, bottom: 8, left: 8 },
          align: 'start',
          justify: 'center',
        },
        items: [
          { id: 'stack-copy', element: textElement({ id: 'stack-copy' }) },
          { id: 'stack-action', element: copyAction() },
        ],
      }),
    ]),
  );
  assert(html.includes('data-flow-layout-mode="stack"'), `missing stack layout mode: ${html}`);
  assert(
    html.includes('display:flex') &&
      html.includes('flex-direction:column') &&
      html.includes('gap:10px 0px') &&
      html.includes('justify-content:center') &&
      !html.includes('flex-wrap'),
    `stack style did not render expected vertical grammar: ${html}`,
  );
  assert(
    html.includes('data-opencanvas-flow-item="stack-copy"') && html.includes('width:100%'),
    `stack items with stretch alignment should fill available width: ${html}`,
  );
}

// Renderer: row mode keeps wrapping explicit for both wrap and no-wrap cases.
{
  const wrappingHtml = renderHtml(
    siteWith([
      flowElement({
        id: 'flow-row-wrap',
        layout: {
          mode: 'row',
          wrap: true,
          gap: { row: 8, column: 12 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          align: 'center',
          justify: 'space-between',
        },
        items: [
          { id: 'row-a', element: textElement({ id: 'row-a' }) },
          { id: 'row-b', element: textElement({ id: 'row-b' }) },
        ],
      }),
    ]),
  );
  assert(
    wrappingHtml.includes('data-flow-layout-mode="row"') &&
      wrappingHtml.includes('flex-direction:row') &&
      wrappingHtml.includes('flex-wrap:wrap') &&
      wrappingHtml.includes('justify-content:space-between'),
    `row wrap style did not render expected grammar: ${wrappingHtml}`,
  );

  const noWrapHtml = renderHtml(
    siteWith([
      flowElement({
        id: 'flow-row-nowrap',
        layout: {
          mode: 'row',
          wrap: false,
          gap: { row: 8, column: 12 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          align: 'center',
          justify: 'start',
        },
        items: [
          { id: 'row-c', element: textElement({ id: 'row-c' }) },
          { id: 'row-d', element: textElement({ id: 'row-d' }) },
        ],
      }),
    ]),
  );
  assert(
    noWrapHtml.includes('data-flow-layout-mode="row"') &&
      noWrapHtml.includes('flex-direction:row') &&
      noWrapHtml.includes('flex-wrap:nowrap'),
    `row no-wrap style did not render expected grammar: ${noWrapHtml}`,
  );
}

// Renderer: narrower breakpoint overrides can unhide an item hidden at tablet.
{
  const html = renderHtml(
    siteWith([
      flowElement({
        items: [
          {
            id: 'toggle-copy',
            element: textElement({ id: 'toggle-copy' }),
            responsive: {
              tablet: { hidden: true },
              phone: { hidden: false },
            },
          },
        ],
      }),
    ]),
  );
  assert(
    html.includes('@media (max-width: 1023px)') &&
      html.includes('[data-opencanvas-flow-item="toggle-copy"]{display:none !important') &&
      html.includes('@media (max-width: 767px)') &&
      html.includes('[data-opencanvas-flow-item="toggle-copy"]{display:block !important'),
    `phone hidden:false should override tablet hidden:true for Flow Items: ${html}`,
  );
}

// Renderer: hosted child keeps element attrs/body but is not section-positioned.
{
  const html = renderHtml(siteWith([flowElement()]));
  const childMatch = html.match(
    /<div class="opencanvas-element opencanvas-flow-content"[^>]*data-opencanvas-element="flow-headline"[^>]*style="([^"]*)"/,
  );
  assert(childMatch !== null, `missing hosted child wrapper: ${html}`);
  const style = childMatch[1] ?? '';
  assert(
    !style.includes('position:absolute'),
    `hosted child must not use absolute wrapper: ${style}`,
  );
  assert(
    style.includes('position:relative'),
    `hosted child should anchor body with relative positioning: ${style}`,
  );
  assert(
    style.includes('height:auto'),
    `text hosted child should size to content height inside flow items: ${style}`,
  );
  assert(html.includes('Flow headline'), `hosted text body did not render: ${html}`);
  assert(
    html.includes('data-opencanvas-copy-handler'),
    `copy action nested in Flow Item must still trigger visitor runtime injection: ${html}`,
  );
}

// Renderer: nested flow cards inside stack items must keep content-driven height.
{
  const nestedCard = {
    id: 'nested-card',
    type: 'flow-container',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    layout: {
      mode: 'stack',
      gap: { row: 12, column: 0 },
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      align: 'stretch',
      justify: 'start',
    },
    items: [
      {
        id: 'nested-card-copy',
        element: textElement({ id: 'nested-card-copy' }),
      },
      {
        id: 'nested-card-cta',
        element: copyAction(),
      },
    ],
  } as unknown as CanvasElement;
  const html = renderHtml(
    siteWith([
      flowElement({
        id: 'flow-stack-hosted-card',
        layout: {
          mode: 'stack',
          gap: { row: 20, column: 0 },
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          align: 'stretch',
          justify: 'start',
        },
        items: [{ id: 'hosted-card', element: nestedCard }],
      }),
    ]),
  );
  const nestedCardMatch = html.match(
    /<div class="opencanvas-element opencanvas-flow-content"[^>]*data-opencanvas-element="nested-card"[^>]*style="([^"]*)"/,
  );
  assert(nestedCardMatch !== null, `missing nested hosted flow card wrapper: ${html}`);
  const nestedCardStyle = nestedCardMatch[1] ?? '';
  assert(
    nestedCardStyle.includes('height:auto'),
    `nested flow card wrapper should not force full-height inside stack items: ${nestedCardStyle}`,
  );
  const nestedFlowRootMatch = html.match(
    /<div class="opencanvas-flow-container" data-opencanvas-flow-container="nested-card"[^>]*style="([^"]*)"/,
  );
  assert(nestedFlowRootMatch !== null, `missing nested flow container root: ${html}`);
  const nestedFlowRootStyle = nestedFlowRootMatch[1] ?? '';
  assert(
    nestedFlowRootStyle.includes('height:auto'),
    `nested flow container body should size to content height when hosted: ${nestedFlowRootStyle}`,
  );
  const nestedCopyMatch = html.match(
    /<div class="opencanvas-element opencanvas-flow-content"[^>]*data-opencanvas-element="nested-card-copy"[^>]*style="([^"]*)"/,
  );
  assert(nestedCopyMatch !== null, `missing nested hosted text wrapper: ${html}`);
  const nestedCopyStyle = nestedCopyMatch[1] ?? '';
  assert(
    nestedCopyStyle.includes('height:auto'),
    `nested hosted text should keep content-driven height inside hosted cards: ${nestedCopyStyle}`,
  );
}

// Validation: well-formed Flow Container is accepted.
{
  const result = validateEditableSite(siteWith([flowElement()]));
  assert(result.valid, result.valid ? '' : `good flow rejected: ${result.errors.join('; ')}`);
}

// Validation: item ids are unique inside the Flow Container.
{
  const bad = flowElement({
    items: [
      { id: 'dup', element: textElement({ id: 'one' }) },
      { id: 'dup', element: textElement({ id: 'two' }) },
    ],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid && result.errors.some((e) => e.includes('items[1].id "dup"')),
    `duplicate item id should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: grid item span cannot exceed layout columns.
{
  const bad = flowElement({
    items: [{ id: 'too-wide', span: 4, element: textElement({ id: 'too-wide-copy' }) }],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid && result.errors.some((e) => e.includes('span') && e.includes('columns')),
    `span beyond columns should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: responsive fields that only render in grid mode are rejected outside grid.
{
  const bad = flowElement({
    layout: {
      mode: 'row',
      wrap: true,
      gap: { row: 16, column: 16 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
      responsive: { phone: { columns: 2 } },
    },
    items: [
      {
        id: 'row-copy',
        element: textElement({ id: 'row-copy' }),
        responsive: { phone: { span: 2 } },
      },
    ],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid &&
      result.errors.some((e) => e.includes('layout.responsive.phone.columns')) &&
      result.errors.some((e) => e.includes('items[0].responsive.phone.span')),
    `row layout responsive grid-only fields should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: Flow grammar rejects unknown layout/item keys instead of ignoring them.
{
  const bad = flowElement({
    layout: {
      mode: 'grid',
      columns: 3,
      gap: { row: 24, column: 16, diagonal: 8 },
      padding: { top: 12, right: 14, bottom: 16, left: 18, inline: 4 },
      align: 'stretch',
      justify: 'start',
      responsive: { phone: { columns: 1, mystery: true } },
      unknownLayoutKey: true,
    },
    items: [
      {
        id: 'strict-copy',
        element: textElement({ id: 'strict-copy' }),
        unknownItemKey: true,
        responsive: { phone: { order: 1, unknownResponsiveKey: true } },
      },
    ],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid &&
      result.errors.some((e) => e.includes('layout.unknownLayoutKey is not supported')) &&
      result.errors.some((e) => e.includes('layout.gap.diagonal is not supported')) &&
      result.errors.some((e) => e.includes('layout.padding.inline is not supported')) &&
      result.errors.some((e) => e.includes('layout.responsive.phone.mystery is not supported')) &&
      result.errors.some((e) => e.includes('items[0].unknownItemKey is not supported')) &&
      result.errors.some((e) =>
        e.includes('items[0].responsive.phone.unknownResponsiveKey is not supported'),
      ),
    `unknown Flow grammar keys should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: Flow-hosted elements cannot carry section-positioned origins.
{
  const bad = flowElement({
    items: [
      {
        id: 'offset-child',
        element: textElement({
          id: 'offset-copy',
          box: { x: 12, y: 0, w: 320, h: 72, z: 0 },
        }),
      },
    ],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid && result.errors.some((e) => e.includes('items[0].element.box.x must be 0')),
    `section-positioned child origin should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: Flow-hosted elements cannot carry placement fields ignored by hosted rendering.
{
  const bad = flowElement({
    items: [
      {
        id: 'placement-child',
        element: textElement({
          id: 'placement-copy',
          box: { x: 0, y: 0, w: 320, h: 72, z: 0, rotation: 8 },
          responsive: { phone: { hidden: true } },
          stickyOffset: 20,
        }),
      },
    ],
  });
  const result = validateEditableSite(siteWith([bad]));
  assert(
    !result.valid &&
      result.errors.some((e) => e.includes('items[0].element.box.rotation is not supported')) &&
      result.errors.some((e) => e.includes('items[0].element.box.w must be 0')) &&
      result.errors.some((e) => e.includes('items[0].element.box.h must be 0')) &&
      result.errors.some((e) => e.includes('items[0].element.responsive is not supported')) &&
      result.errors.some((e) => e.includes('items[0].element.stickyOffset is not supported')),
    `Flow-hosted ignored placement fields should fail validation: ${JSON.stringify(result)}`,
  );
}

// Validation: nested anchors in Flow Items participate in page-wide uniqueness.
{
  const result = validateEditableSite(
    siteWith([textElement({ id: 'top-anchor', anchorId: 'flow-anchor' }), flowElement()]),
  );
  assert(
    !result.valid && result.errors.some((e) => e.includes('anchorId "flow-anchor"')),
    `duplicate nested anchor should fail validation: ${JSON.stringify(result)}`,
  );
}

// Projection: Yjs preserves layout + nested Flow Items.
{
  const state = siteWith([flowElement()]);
  const decoded = decodeYDoc(encodeYDoc(state));
  assertDeepEqual(decoded, state, 'flow yjs round-trip');
}

// Publish validation: nested Flow-hosted media obey publish-only asset rules.
{
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-16T00:00:00.000Z',
    ...siteWith([
      flowElement({
        items: [{ id: 'image', element: imageElement({ assetId: '' }) }],
      }),
    ]),
  };
  const result = validatePublishedSnapshot(snapshot);
  assert(
    !result.valid &&
      result.errors.some((e) =>
        e.includes('items[0].element.assetId must be non-empty in published snapshots'),
      ),
    `published Flow-hosted media with empty assetId should fail: ${JSON.stringify(result)}`,
  );
}

console.log('[flow-container:smoke] OK');
