// src/canvas/tabs-element.smoke.ts
//
// Smoke for the TabsElement (ADR 0052):
//   1. Bar + panels render with the right data attributes and active state.
//   2. Panel children render recursively via renderChild (same path as
//      collection cells), with panel-local coordinates preserved.
//   3. The visitor-side tabs handler script is emitted at end of <main>
//      only when a TabsElement exists in the snapshot.
//   4. Validator accepts well-formed input, rejects every negative shape
//      called out in the ADR.
//
// Run with `bun.cmd run tabs-element:smoke`.

import type {
  EditableSite,
  PublishedSnapshot,
  TabsElement,
  TextElement,
} from './schema.js';
import { renderCanvasSnapshot } from './render.js';
import { validateEditableSite } from './validate.js';

const TURNSTILE = 'turnstile-test-key';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function baseText(overrides: Partial<TextElement> = {}): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 320, h: 60, z: 1 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
    ...overrides,
  };
}

function siteWith(elements: EditableSite['pages'][number]['sections'][number]['elements']): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'Tabs smoke',
        width: 1440,
        sections: [
          {
            id: 'section-smoke',
            recipeId: 'feature-grid',
            name: 'Smoke',
            height: 800,
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

function goodTabs(overrides: Partial<TabsElement> = {}): TabsElement {
  return {
    id: 'el-tabs',
    type: 'tabs',
    box: { x: 0, y: 0, w: 1280, h: 600, z: 1 },
    tabs: [
      {
        id: 'one',
        label: [{ text: 'One' }],
        elements: [baseText({ id: 'p1-text' })],
      },
      {
        id: 'two',
        label: [{ text: 'Two', marks: [{ type: 'bold' }] }],
        elements: [
          baseText({
            id: 'p2-text',
            box: { x: 16, y: 24, w: 200, h: 40, z: 1 },
            content: [{ text: 'panel two body' }],
          }),
        ],
      },
    ],
    activeTabId: 'one',
    ...overrides,
  };
}

// ============================================================================
// Renderer output
// ============================================================================

// Bar buttons + panels emit with the right data attributes.
{
  const html = renderHtml(siteWith([goodTabs()]));
  assert(html.includes('data-opencanvas-tabs="el-tabs"'), `expected tabs root; got ${html}`);
  assert(
    html.includes('data-opencanvas-tab-id="one" data-tab-active'),
    `expected active bar button on "one"; got ${html}`,
  );
  assert(
    /data-opencanvas-tab-id="two"(?! data-tab-active)/.test(html),
    `expected "two" bar button to NOT carry data-tab-active; got ${html}`,
  );
  assert(
    html.includes('data-opencanvas-tab-panel-id="one" data-tab-active'),
    `expected active panel for "one"; got ${html}`,
  );
  assert(
    /data-opencanvas-tab-panel-id="two"(?! data-tab-active)/.test(html),
    `expected inactive panel for "two"; got ${html}`,
  );
  // Rich label mark survives through renderInlineRun
  assert(html.includes('<strong>Two</strong>'), `expected rich label <strong>; got ${html}`);
}

// Panel children render with their own (panel-local) coordinates.
{
  const html = renderHtml(siteWith([goodTabs()]));
  assert(
    html.includes('data-opencanvas-element="p1-text"') &&
      html.includes('data-opencanvas-element="p2-text"'),
    `expected child element wrappers inside panels; got ${html}`,
  );
  // p2-text's box.x=16 should land on the rendered wrapper style
  assert(html.includes('left:16px'), `expected panel-local left:16px; got ${html}`);
}

// Custom tabBarHeight propagates to the bar style + the panel height.
{
  const html = renderHtml(siteWith([goodTabs({ tabBarHeight: 80 })]));
  assert(html.includes('height:80px'), `expected bar height:80px; got ${html}`);
  // Panel height = 600 - 80 = 520
  assert(html.includes('height:520px'), `expected panel height:520px; got ${html}`);
}

// ============================================================================
// Visitor-side tabs handler
// ============================================================================

// Emits a single inline <script> when at least one TabsElement exists.
{
  const html = renderHtml(siteWith([goodTabs()]));
  assert(
    html.includes('data-opencanvas-tabs-handler') && html.includes('toggleAttribute'),
    `expected tabs handler script; got ${html}`,
  );
}

// No script emitted when no TabsElement exists.
{
  const html = renderHtml(siteWith([baseText()]));
  assert(
    !html.includes('data-opencanvas-tabs-handler'),
    'snapshot without TabsElement must not emit tabs handler script',
  );
}

// ============================================================================
// Validator negatives
// ============================================================================

// tabs.length < 2
{
  const bad: TabsElement = {
    ...goodTabs(),
    tabs: [{ id: 'only', label: [{ text: 'Only' }], elements: [] }],
    activeTabId: 'only',
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('tabs must be an array with length >= 2')),
    `expected single-tab rejection; got ${JSON.stringify(r)}`,
  );
}

// Bad tab.id charset
{
  const bad: TabsElement = {
    ...goodTabs(),
    tabs: [
      { id: 'Stack', label: [{ text: 'Stack' }], elements: [] },
      { id: 'work', label: [{ text: 'Work' }], elements: [] },
    ],
    activeTabId: 'Stack',
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('tabs[0].id') && e.includes('must match')),
    `expected bad-id rejection; got ${JSON.stringify(r)}`,
  );
}

// Duplicate tab ids
{
  const bad: TabsElement = {
    ...goodTabs(),
    tabs: [
      { id: 'dup', label: [{ text: 'A' }], elements: [] },
      { id: 'dup', label: [{ text: 'B' }], elements: [] },
    ],
    activeTabId: 'dup',
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('already used by another tab')),
    `expected duplicate-id rejection; got ${JSON.stringify(r)}`,
  );
}

// activeTabId references unknown tab
{
  const bad: TabsElement = {
    ...goodTabs(),
    activeTabId: 'three',
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('activeTabId "three" must reference one of')),
    `expected unknown-activeTabId rejection; got ${JSON.stringify(r)}`,
  );
}

// empty activeTabId
{
  const bad: TabsElement = {
    ...goodTabs(),
    activeTabId: '',
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('activeTabId must be a non-empty string')),
    `expected empty-activeTabId rejection; got ${JSON.stringify(r)}`,
  );
}

// tab.label empty
{
  const bad: TabsElement = {
    ...goodTabs(),
    tabs: [
      { id: 'one', label: [], elements: [] },
      { id: 'two', label: [{ text: 'Two' }], elements: [] },
    ],
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid &&
      r.errors.some((e) => e.includes('tabs[0].label') && e.includes('non-empty array')),
    `expected empty-label rejection; got ${JSON.stringify(r)}`,
  );
}

// tabBarHeight negative
{
  const bad: TabsElement = {
    ...goodTabs(),
    tabBarHeight: -10,
  };
  const r = validateEditableSite(siteWith([bad]));
  assert(
    !r.valid && r.errors.some((e) => e.includes('tabBarHeight')),
    `expected negative tabBarHeight rejection; got ${JSON.stringify(r)}`,
  );
}

// Well-formed tabs validates clean.
{
  const r = validateEditableSite(siteWith([goodTabs()]));
  assert(r.valid, r.valid ? '' : `expected good tabs to validate: ${r.errors.join('; ')}`);
}

console.log('[tabs-element:smoke] OK');
