// src/canvas/action-expressiveness.smoke.ts
//
// Smoke test for the four contracts landed by ADR 0051:
//   1. ActionElement.label as InlineRun[]      (dec 1)
//   2. ActionElement.iconKind + ShapeElement   (dec 2)
//      'icon' variant + iconKind, sharing the icon registry
//   3. ActionElement href / behavior union     (dec 3)
//      mutual exclusion, copy behaviour emits <button> not <a>
//   4. Visitor-side copy handler script        (dec 4)
//      only emitted when a copy action exists
//   5. ContainerElement.linkHref               (dec 5)
//      outer wrapper becomes <a href="…"> instead of <div>
//
// Run with `bun.cmd run action-expressiveness:smoke`.

import type {
  ActionElement,
  ContainerElement,
  EditableSite,
  PublishedSnapshot,
  ShapeElement,
} from './schema.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function siteWith(elements: EditableSite['pages'][number]['sections'][number]['elements']): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Action smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 240,
            elements,
          },
        ],
      },
    ],
  };
}

function renderHtml(state: EditableSite): string {
  const snapshot: PublishedSnapshot = {
    version: 1,
    publishedAt: '2026-06-02T00:00:00.000Z',
    ...state,
  };
  return renderCanvasSnapshot(snapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: TURNSTILE,
  });
}

// ============================================================================
// Decision 1 — label: InlineRun[]
// ============================================================================

{
  const action: ActionElement = {
    id: 'a-1',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [
      { text: 'Get started ' },
      { text: 'now', marks: [{ type: 'bold' }] },
    ],
    href: { type: 'external', url: '/signup' },
    variant: 'solid',
  };
  const html = renderHtml(siteWith([action]));
  assert(
    html.includes('<a class="opencanvas-action"') && html.includes('href="/signup"'),
    `expected action <a> with href; got ${html}`,
  );
  assert(
    html.includes('Get started ') && html.includes('<strong>now</strong>'),
    `expected rich label including <strong>; got ${html}`,
  );
}

// Negative — empty label.
{
  const action = {
    id: 'a-empty',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [],
    href: { type: 'external' as const, url: '/x' },
    variant: 'solid' as const,
  };
  const r = validateEditableSite(siteWith([action]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('label') && e.includes('non-empty array')),
    `expected empty-label rejection; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// Decision 2 — iconKind on Action + Shape 'icon' variant
// ============================================================================

{
  const action: ActionElement = {
    id: 'a-icon',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Download' }],
    iconKind: 'download',
    href: { type: 'external', url: '/file.pdf' },
    variant: 'ghost',
  };
  const html = renderHtml(siteWith([action]));
  assert(
    html.includes('data-opencanvas-icon="download"') && html.includes('<svg'),
    `expected inline SVG icon for download; got ${html}`,
  );
}

// Shape variant 'icon' + iconKind renders the SVG.
{
  const shape: ShapeElement = {
    id: 'sh-icon',
    type: 'shape',
    box: { x: 0, y: 0, w: 32, h: 32, z: 1 },
    variant: 'icon',
    iconKind: 'check',
  };
  const html = renderHtml(siteWith([shape]));
  assert(
    html.includes('data-icon-kind="check"') && html.includes('data-opencanvas-icon="check"'),
    `expected shape icon SVG; got ${html}`,
  );
}

// Negative — shape variant 'icon' without iconKind.
{
  const shape = {
    id: 'sh-bad-icon',
    type: 'shape' as const,
    box: { x: 0, y: 0, w: 32, h: 32, z: 1 },
    variant: 'icon' as const,
  };
  const r = validateEditableSite(siteWith([shape]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('iconKind is required when variant')),
    `expected missing-iconKind rejection; got ${JSON.stringify(r)}`,
  );
}

// Negative — unknown iconKind name.
{
  const action = {
    id: 'a-bad-icon',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'X' }],
    iconKind: 'sparkle',
    href: { type: 'external' as const, url: '/x' },
    variant: 'solid' as const,
  };
  const r = validateEditableSite(siteWith([action as unknown as ActionElement]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('iconKind') && e.includes('one of')),
    `expected unknown-iconKind rejection; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// Decision 3 — href / behavior union
// ============================================================================

// Copy behaviour emits <button> with data-opencanvas-copy.
{
  const action: ActionElement = {
    id: 'a-copy',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Copy email' }],
    iconKind: 'copy',
    behavior: { type: 'copy', value: 'hello@example.com' },
    variant: 'ghost',
  };
  const html = renderHtml(siteWith([action]));
  assert(
    html.includes('<button type="button" class="opencanvas-action"') &&
      html.includes('data-opencanvas-copy="hello@example.com"'),
    `expected copy button with data attr; got ${html}`,
  );
  assert(!/<a [^>]*class="opencanvas-action"/.test(html), 'copy action must not emit <a>');
}

// Negative — both href AND behavior.
{
  const action = {
    id: 'a-both',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'X' }],
    href: { type: 'external' as const, url: '/x' },
    behavior: { type: 'copy' as const, value: 'x' },
    variant: 'solid' as const,
  };
  const r = validateEditableSite(siteWith([action as unknown as ActionElement]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('got both')),
    `expected both-set rejection; got ${JSON.stringify(r)}`,
  );
}

// Negative — neither href NOR behavior.
{
  const action = {
    id: 'a-neither',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'X' }],
    variant: 'solid' as const,
  };
  const r = validateEditableSite(siteWith([action as unknown as ActionElement]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('got neither')),
    `expected neither-set rejection; got ${JSON.stringify(r)}`,
  );
}

// Negative — behavior with empty value.
{
  const action = {
    id: 'a-empty-copy',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'X' }],
    behavior: { type: 'copy' as const, value: '' },
    variant: 'solid' as const,
  };
  const r = validateEditableSite(siteWith([action]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('behavior.value must be a non-empty')),
    `expected empty-value rejection; got ${JSON.stringify(r)}`,
  );
}

// ============================================================================
// Decision 4 — visitor-side copy handler
// ============================================================================

// Emits a single inline <script> when at least one copy action exists.
{
  const copyAction: ActionElement = {
    id: 'a-copy-2',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Copy' }],
    behavior: { type: 'copy', value: 'abc' },
    variant: 'ghost',
  };
  const html = renderHtml(siteWith([copyAction]));
  assert(
    html.includes('data-opencanvas-copy-handler') && html.includes('navigator.clipboard.writeText'),
    `expected copy handler script; got ${html}`,
  );
  assert(
    html.includes('.then(function()') &&
      html.includes('.catch(function(err)') &&
      html.includes('data-opencanvas-copy-failed'),
    `copy handler must expose success and failure states after clipboard write; got ${html}`,
  );
}

// No script emitted when only link actions exist.
{
  const linkAction: ActionElement = {
    id: 'a-link-only',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Visit' }],
    href: { type: 'external', url: '/' },
    variant: 'solid',
  };
  const html = renderHtml(siteWith([linkAction]));
  assert(
    !html.includes('data-opencanvas-copy-handler'),
    'no copy actions must mean no handler script',
  );
}

// ============================================================================
// Decision 5 — ContainerElement.linkHref
// ============================================================================

// linkHref makes the outer wrapper an <a>.
{
  const container: ContainerElement = {
    id: 'c-link',
    type: 'container',
    box: { x: 0, y: 0, w: 400, h: 200, z: 1 },
    variant: 'raised',
    linkHref: { type: 'external', url: '/project' },
    linkLabel: 'Open project',
  };
  const html = renderHtml(siteWith([container]));
  assert(
    /<a class="opencanvas-element" href="\/project" aria-label="Open project"/.test(html),
    `expected <a> wrapper for linkHref container; got ${html}`,
  );
  assert(
    !/<a class="opencanvas-element"[^>]*aria-hidden="true"/.test(html) &&
      !/<a class="opencanvas-element"[^>]*role="presentation"/.test(html),
    `linked container wrapper must remain exposed to assistive tech; got ${html}`,
  );
  // Ensure the inner surface div still emits inside the <a>.
  assert(
    html.includes('class="opencanvas-surface"'),
    'inner surface div must still emit inside the <a> wrapper',
  );
}

// No linkHref → wrapper stays a <div>.
{
  const container: ContainerElement = {
    id: 'c-plain',
    type: 'container',
    box: { x: 0, y: 0, w: 400, h: 200, z: 1 },
    variant: 'raised',
  };
  const html = renderHtml(siteWith([container]));
  assert(
    /<div class="opencanvas-element"[^>]*data-element-type="container"/.test(html),
    `expected <div> wrapper when no linkHref; got ${html}`,
  );
  assert(
    !/<a class="opencanvas-element"[^>]*data-element-type="container"/.test(html),
    'no linkHref must not emit <a> wrapper',
  );
}

// Negative - linked containers must expose a human-readable link label.
{
  const container = {
    id: 'c-link-missing-label',
    type: 'container' as const,
    box: { x: 0, y: 0, w: 400, h: 200, z: 1 },
    variant: 'raised' as const,
    linkHref: { type: 'external' as const, url: '/project' },
  };
  const r = validateEditableSite(siteWith([container]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('linkLabel')),
    `expected missing linkLabel rejection; got ${JSON.stringify(r)}`,
  );
}

console.log('[action-expressiveness:smoke] OK');
