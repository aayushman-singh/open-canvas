// src/interactive/smoke.ts
//
// `bun run interactive:smoke` — Wave 4 #17 smoke. Exercises the five
// assertions the plan demands:
//
//   1. Render snapshot with one accordion + one carousel → injected HTML
//      contains the runtime <script> tag and the correct data attributes on
//      each element.
//   2. Render snapshot WITHOUT interactive elements → no runtime injected.
//   3. Simulate accordion toggle via a hand-rolled DOM stub → the open state
//      flips on click.
//   4. Simulate carousel next/prev → slide index updates with bounds.
//   5. Keyboard: pressing Enter on a focused accordion header toggles.
//
// All assertions are pure-CPU; no network, no jsdom, no Workers globals.
//
// The hand-rolled DOM stub below is the smallest viable scaffold that lets
// the production runtime IIFE execute unmodified. It implements only the
// methods the runtime actually calls — anything outside that set is
// deliberately absent so a runtime that drifts toward heavier DOM APIs trips
// a smoke failure rather than passing silently.

import type { AccordionElement } from '../canvas/elements/accordion.js';
import { renderAccordion } from '../canvas/elements/accordion.js';
import type { CarouselElement } from '../canvas/elements/carousel.js';
import { renderCarousel } from '../canvas/elements/carousel.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { INTERACTIVE_RUNTIME_SRC, INTERACTIVE_RUNTIME_SRC_CHARS } from './build.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[interactive:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Minimal DOM stub. Implements the subset the runtime calls:
//
//   - Node tree:     children[], parent, tagName, attributes (Map<string,string>)
//   - querySelector / querySelectorAll with the limited selector shapes the
//     runtime uses: '[attr]', '[attr="value"]'. Selector parser is a single
//     regex; selectors outside this grammar throw loudly.
//   - getAttribute / setAttribute / removeAttribute
//   - addEventListener / dispatchEvent with bubbling.
//   - closest(selector) (used by the accordion runtime).
// ---------------------------------------------------------------------------

interface StubEvent {
  type: string;
  key?: string;
  detail?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  target: StubElement | null;
  // Mutable on the element while dispatch walks ancestors.
  currentTarget: StubElement | null;
}

type Listener = (event: StubEvent) => void;

class StubStyle {
  private readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? '';
  }
}

class StubElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  animations: Array<{ keyframes: unknown; options: unknown }> = [];
  style = new StubStyle();
  textContent = '';
  ownerDocument: StubDocument | null = null;
  focused = false;

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  appendChild(child: StubElement): void {
    child.parent = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
  }

  addEventListener(type: string, listener: Listener): void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener);
  }

  dispatchEvent(event: StubEvent): void {
    if (event.target === null) event.target = this;
    // Bubble: this element + every ancestor.
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- intentional: walking up the parent chain from `this`.
    let node: StubElement | null = this;
    while (node) {
      const listeners = node.listeners.get(event.type);
      if (listeners) {
        event.currentTarget = node;
        for (const fn of listeners) fn(event);
      }
      node = node.parent;
    }
  }

  animate(keyframes: unknown, options: unknown): { finished: Promise<void> } {
    this.animations.push({ keyframes, options });
    return { finished: Promise.resolve() };
  }

  focus(): void {
    this.focused = true;
  }

  // Selector grammar accepted: `[attr]`, `[attr="value"]`, `[attr='value']`,
  // or a comma-separated list of the above. Anything else is a programmer
  // error and we throw loudly so the smoke surfaces the drift immediately.
  matchesSelector(selector: string): boolean {
    const trimmed = selector.trim();
    const match = /^\[([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?\]$/.exec(trimmed);
    if (!match) {
      throw new Error(`[stub] unsupported selector "${selector}"`);
    }
    const attrName = match[1];
    if (attrName === undefined) return false;
    const expected = match[2] ?? match[3] ?? null;
    if (!this.attributes.has(attrName)) return false;
    if (expected === null) return true;
    return this.attributes.get(attrName) === expected;
  }

  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const walk = (node: StubElement): void => {
      for (const child of node.children) {
        if (child.matchesSelector(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): StubElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? (all[0] ?? null) : null;
  }

  closest(selector: string): StubElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- intentional: walking ancestors from `this`.
    let node: StubElement | null = this;
    while (node) {
      if (node.matchesSelector(selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

// Build a stub `document` carrying the runtime's three contracts:
//   - document.readyState (the entry-point branch)
//   - document.addEventListener (the DOMContentLoaded handler)
//   - document.querySelectorAll (the per-root hydration scan)
class StubDocument {
  readyState: 'loading' | 'interactive' | 'complete' = 'complete';
  root: StubElement = new StubElement('html');
  body: StubElement = new StubElement('body');
  defaultView: Record<string, unknown> = {
    CustomEvent: class StubCustomEvent implements StubEvent {
      defaultPrevented = false;
      target: StubElement | null = null;
      currentTarget: StubElement | null = null;

      constructor(
        readonly type: string,
        init: { detail?: unknown } = {},
      ) {
        this.detail = init.detail;
      }

      detail?: unknown;

      preventDefault(): void {
        this.defaultPrevented = true;
      }
    },
  };
  domContentLoadedListeners: Listener[] = [];
  listeners = new Map<string, Listener[]>();

  constructor() {
    this.root.ownerDocument = this;
    this.body.ownerDocument = this;
    this.root.appendChild(this.body);
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'DOMContentLoaded') {
      this.domContentLoadedListeners.push(listener);
      return;
    }
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = [];
      this.listeners.set(type, listeners);
    }
    listeners.push(listener);
  }
  querySelectorAll(selector: string): StubElement[] {
    return this.root.querySelectorAll(selector);
  }
  querySelector(selector: string): StubElement | null {
    return this.root.querySelector(selector);
  }
  dispatchEvent(event: StubEvent): void {
    event.target = null;
    const listeners = this.listeners.get(event.type);
    if (!listeners) return;
    for (const listener of listeners) listener(event);
  }
}

// Tiny HTML → StubElement parser. Handles the subset the renderer emits:
//   - Open tags `<tag attr="value" boolean>` (any number of attrs).
//   - Close tags `</tag>`.
//   - Self-closing void tags (`<img ... />`, `<br>`) — we recognise the `/>`
//     and `<img>`/`<input>` shapes.
//   - Text nodes (collapsed into the parent's textContent).
//
// Anything outside this grammar throws loudly. The renderer's output is
// deterministic — when it grows a new shape, we want this parser to fail so
// the smoke catches the drift.
const VOID_TAGS = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);

function parseAttrs(attrPart: string): Map<string, string> {
  const out = new Map<string, string>();
  // Match `name`, `name="value"`, `name='value'`, `name=value`.
  const re = /([a-zA-Z0-9_:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrPart)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out.set(name, value);
  }
  return out;
}

function parseHtml(html: string): StubElement {
  const root = new StubElement('#root');
  const stack: StubElement[] = [root];
  let cursor = 0;
  while (cursor < html.length) {
    const lt = html.indexOf('<', cursor);
    if (lt < 0) {
      const top = stack[stack.length - 1] as StubElement;
      top.textContent += html.slice(cursor);
      break;
    }
    if (lt > cursor) {
      const top = stack[stack.length - 1] as StubElement;
      top.textContent += html.slice(cursor, lt);
    }
    const gt = html.indexOf('>', lt);
    if (gt < 0) throw new Error('[stub] unterminated tag');
    const tagBody = html.slice(lt + 1, gt);
    cursor = gt + 1;
    if (tagBody.startsWith('/')) {
      // Close tag.
      stack.pop();
      continue;
    }
    // Open tag (possibly self-closing).
    const selfClosing = tagBody.endsWith('/');
    const inner = selfClosing ? tagBody.slice(0, -1).trim() : tagBody.trim();
    const spaceIdx = inner.search(/\s/);
    const tagName = spaceIdx < 0 ? inner : inner.slice(0, spaceIdx);
    const attrPart = spaceIdx < 0 ? '' : inner.slice(spaceIdx + 1);
    const element = new StubElement(tagName);
    const attrs = parseAttrs(attrPart);
    for (const [k, v] of attrs) element.setAttribute(k, v);
    const parent = stack[stack.length - 1] as StubElement;
    parent.appendChild(element);
    if (!selfClosing && !VOID_TAGS.has(tagName.toLowerCase())) {
      stack.push(element);
    }
  }
  return root;
}

function makeEvent(type: string, init: { key?: string } = {}): StubEvent {
  const event: StubEvent = {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: null,
    currentTarget: null,
  };
  if (init.key !== undefined) event.key = init.key;
  return event;
}

// Execute the runtime IIFE against a stub document. The IIFE references the
// global `document` via the runtime entry; we pass our stub in as a parameter
// to `new Function` and the body references it directly.
function runRuntimeAgainstDocument(doc: StubDocument): void {
  // The IIFE wraps `function hydrateX(root) { ... }` declarations + the
  // hydrateAll dispatch + the readyState branch. `new Function('document', ...)`
  // gives the runtime a fresh scope where `document` resolves to our stub.
  // `no-implied-eval` is intentional here: the smoke MUST execute the exact
  // string the visitor browser will execute — anything else (e.g. importing
  // the TS modules directly) would let a divergence between source-of-truth
  // and shipped bytes slip through.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see comment above.
  const fn = new Function('document', INTERACTIVE_RUNTIME_SRC) as (d: StubDocument) => void;
  fn(doc);
}

// ---------------------------------------------------------------------------
// (1) Render snapshot with one accordion + one carousel — injected HTML
//     contains runtime <script> tag + correct data attributes.
// ---------------------------------------------------------------------------

const accordionEl: AccordionElement = {
  id: 'acc-1',
  type: 'accordion',
  box: { x: 0, y: 0, w: 600, h: 400, z: 1 },
  items: [
    { id: 'a', title: 'Question A', body: [{ text: 'Answer A.' }] },
    { id: 'b', title: 'Question B', body: [{ text: 'Answer B.' }] },
    { id: 'c', title: 'Question C', body: [{ text: 'Answer C.' }] },
  ],
  allowMultipleOpen: false,
};

const carouselEl: CarouselElement = {
  id: 'car-1',
  type: 'carousel',
  box: { x: 0, y: 400, w: 800, h: 500, z: 1 },
  slides: [
    { id: 's1', assetId: 'asset-1', caption: 'First' },
    { id: 's2', assetId: 'asset-2' },
    { id: 's3', assetId: 'asset-3', caption: 'Third', href: 'https://example.com' },
  ],
  showArrows: true,
  showDots: true,
};

const interactiveSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-home',
      slug: 'home',
      title: 'Home',
      width: 1440,
      sections: [
        {
          id: 'sec-1',
          recipeId: 'hero-split',
          name: 'Interactive section',
          height: 900,
          elements: [accordionEl, carouselEl],
        },
      ],
    },
  ],
};

const accordionHtml = renderAccordion(accordionEl, { styleKit: 'charcoal' });
const carouselHtml = renderCarousel(carouselEl, {
  styleKit: 'charcoal',
  assetBasePath: '/assets',
});
const combinedHtml = `<main>${accordionHtml}${carouselHtml}</main>`;
const injectedHtml = injectInteractiveRuntime(combinedHtml, interactiveSnapshot);

assert(
  injectedHtml.includes('data-opencanvas-interactive="accordion"'),
  'accordion wrapper missing data-opencanvas-interactive attribute',
);
assert(
  injectedHtml.includes('data-opencanvas-interactive="carousel"'),
  'carousel wrapper missing data-opencanvas-interactive attribute',
);
assert(
  injectedHtml.includes('data-opencanvas-acc-item="a"'),
  'accordion item id "a" marker missing',
);
assert(
  injectedHtml.includes('data-opencanvas-acc-toggle="a"'),
  'accordion toggle id "a" marker missing',
);
assert(
  injectedHtml.includes('data-opencanvas-carousel-slide="s1"'),
  'carousel slide id "s1" marker missing',
);
assert(
  injectedHtml.includes('data-opencanvas-carousel-prev'),
  'carousel prev arrow marker missing',
);
assert(
  injectedHtml.includes('data-opencanvas-carousel-next'),
  'carousel next arrow marker missing',
);
assert(injectedHtml.includes('data-opencanvas-carousel-dot="0"'), 'carousel dot index 0 missing');
assert(
  injectedHtml.includes('<script data-opencanvas-interactive-runtime>'),
  'runtime <script> tag missing from injected HTML',
);
assert(injectedHtml.includes('hydrateAccordion'), 'runtime body missing hydrateAccordion fn');
assert(injectedHtml.includes('hydrateCarousel'), 'runtime body missing hydrateCarousel fn');

// First item open by default (assertion lives here so the renderer can change
// the default state behaviour and a single line tells you).
assert(
  /data-opencanvas-acc-item="a"[^>]*data-opencanvas-acc-open="true"/.test(injectedHtml),
  'first accordion item should be open by default in rendered HTML',
);
assert(
  /<div class="opencanvas-accordion-body"[^>]*data-opencanvas-acc-body="b"[^>]*hidden/.test(
    injectedHtml,
  ),
  'second accordion body should be hidden by default in rendered HTML',
);

// Accordion buttons must be real <button type="button"> so default focus +
// Enter activation comes for free.
assert(
  /<button class="opencanvas-accordion-header" type="button"/.test(injectedHtml),
  'accordion header should be a real <button type="button">',
);

// Carousel arrows must be real buttons too.
assert(
  /<button class="opencanvas-carousel-arrow opencanvas-carousel-arrow-prev"/.test(injectedHtml),
  'carousel prev arrow should be a real <button>',
);

// ---------------------------------------------------------------------------
// (2) Render snapshot WITHOUT interactives — no runtime injected.
// ---------------------------------------------------------------------------

const bareSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-bare',
      slug: 'bare',
      title: 'Bare',
      width: 1440,
      sections: [
        {
          id: 'sec-bare',
          recipeId: 'hero-split',
          name: 'No interactives',
          height: 200,
          // A bare text element — no interactives at all.
          elements: [
            {
              id: 'txt-1',
              type: 'text',
              box: { x: 0, y: 0, w: 300, h: 40, z: 1 },
              content: [{ text: 'Hello' }],
              role: 'body',
              fontSize: 16,
              fontWeight: 400,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
};

const bareHtml = '<main>nothing here</main>';
const bareOut = injectInteractiveRuntime(bareHtml, bareSnapshot);
assert(bareOut === bareHtml, 'snapshot without interactive elements must produce HTML untouched');
assert(
  !bareOut.includes('<script data-opencanvas-interactive-runtime>'),
  'bare snapshot must NOT carry the runtime <script>',
);
assert(
  snapshotNeedsInteractiveRuntime(bareSnapshot) === false,
  'snapshotNeedsInteractiveRuntime must return false for a bare snapshot',
);
assert(
  snapshotNeedsInteractiveRuntime(interactiveSnapshot) === true,
  'snapshotNeedsInteractiveRuntime must return true for an interactive snapshot',
);
const nestedInteractiveSnapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-23T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-tabs',
      slug: 'tabs',
      title: 'Tabs',
      width: 1440,
      sections: [
        {
          id: 'sec-tabs',
          recipeId: 'custom',
          name: 'Nested interactive',
          height: 900,
          elements: [
            {
              id: 'tabs-with-accordion',
              type: 'tabs',
              box: { x: 0, y: 0, w: 900, h: 640, z: 1 },
              activeTabId: 'faq',
              tabs: [
                {
                  id: 'faq',
                  label: [{ text: 'FAQ' }],
                  elements: [accordionEl],
                },
                {
                  id: 'empty',
                  label: [{ text: 'Empty' }],
                  elements: [],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
assert(
  snapshotNeedsInteractiveRuntime(nestedInteractiveSnapshot) === true,
  'snapshotNeedsInteractiveRuntime must recurse into tab panels',
);
assert(
  injectInteractiveRuntime('<main>nested</main>', nestedInteractiveSnapshot).includes(
    '<script data-opencanvas-interactive-runtime>',
  ),
  'nested interactive snapshots must receive the runtime script',
);

// ---------------------------------------------------------------------------
// (3) Simulate accordion toggle via the stub DOM — open state flips on click.
// ---------------------------------------------------------------------------

const doc1 = new StubDocument();
const parsed1 = parseHtml(injectedHtml);
// Move parsed children into the document root so querySelectorAll walks them.
for (const child of parsed1.children) {
  doc1.root.appendChild(child);
}
runRuntimeAgainstDocument(doc1);

assert(
  typeof doc1.defaultView.__opencanvasHydrate === 'function',
  'runtime must expose window.__opencanvasHydrate for live DOM swaps',
);

const accRoot = doc1.querySelectorAll('[data-opencanvas-interactive="accordion"]')[0];
assert(accRoot !== undefined, 'accordion root not found in parsed DOM');
const itemA = accRoot.querySelector('[data-opencanvas-acc-item="a"]');
const itemB = accRoot.querySelector('[data-opencanvas-acc-item="b"]');
const toggleA = accRoot.querySelector('[data-opencanvas-acc-toggle="a"]');
const toggleB = accRoot.querySelector('[data-opencanvas-acc-toggle="b"]');
const bodyA = accRoot.querySelector('[data-opencanvas-acc-body="a"]');
const bodyB = accRoot.querySelector('[data-opencanvas-acc-body="b"]');
assert(itemA !== null && itemB !== null, 'expected items a + b in accordion DOM');
assert(toggleA !== null && toggleB !== null, 'expected toggles a + b in accordion DOM');
assert(bodyA !== null && bodyB !== null, 'expected bodies a + b in accordion DOM');

// Initial state from render: a is open, b is closed.
assert(itemA.getAttribute('data-opencanvas-acc-open') === 'true', 'item a should start open');
assert(itemB.getAttribute('data-opencanvas-acc-open') === null, 'item b should start closed');
assert(bodyB.getAttribute('hidden') !== null, 'body b should start with hidden attr');

// Click toggle b → b opens, a closes (single-open mode).
toggleB.dispatchEvent(makeEvent('click'));
assert(
  itemB.getAttribute('data-opencanvas-acc-open') === 'true',
  'item b should be open after clicking toggle b',
);
assert(
  itemA.getAttribute('data-opencanvas-acc-open') === null,
  'item a should be closed after clicking toggle b (single-open mode)',
);
assert(
  toggleB.getAttribute('aria-expanded') === 'true',
  'toggle b aria-expanded should be "true" after open',
);
assert(
  toggleA.getAttribute('aria-expanded') === 'false',
  'toggle a aria-expanded should be "false" after sibling open',
);
assert(bodyB.getAttribute('hidden') === null, 'body b should no longer be hidden after open');

// Click toggle b again → b closes.
toggleB.dispatchEvent(makeEvent('click'));
assert(
  itemB.getAttribute('data-opencanvas-acc-open') === null,
  'item b should be closed after second click on toggle b',
);
assert(
  bodyB.getAttribute('hidden') !== null,
  'body b should be hidden again after toggle closes it',
);

// Idempotent hydration: re-running the runtime must NOT double-bind listeners.
// We invoke runRuntimeAgainstDocument again, then verify a single click still
// produces exactly one toggle.
runRuntimeAgainstDocument(doc1);
const stateBeforeRehydrate = itemB.getAttribute('data-opencanvas-acc-open');
toggleB.dispatchEvent(makeEvent('click'));
const stateAfterOneClick = itemB.getAttribute('data-opencanvas-acc-open');
assert(
  stateBeforeRehydrate !== stateAfterOneClick,
  'one click after re-hydrate should toggle item b once (not twice)',
);

const lateAccordionHtml = renderAccordion(
  {
    ...accordionEl,
    id: 'late-acc',
    items: [{ id: 'late', title: 'Late Question', body: [{ text: 'Late answer.' }] }],
  },
  { styleKit: 'charcoal' },
);
const lateParsed = parseHtml(lateAccordionHtml);
for (const child of lateParsed.children) doc1.root.appendChild(child);
const lateRoot = doc1.querySelectorAll('[data-opencanvas-interactive="accordion"]').at(-1);
assert(lateRoot !== undefined, 'late accordion root not found after append');
assert(
  lateRoot.getAttribute('data-opencanvas-hydrated') === null,
  'late accordion must start unhydrated before global hydrator call',
);
(doc1.defaultView.__opencanvasHydrate as () => void)();
assert(
  lateRoot.getAttribute('data-opencanvas-hydrated') === 'true',
  'global hydrator must hydrate late-inserted interactive roots',
);

// Accordion with allowMultipleOpen: true — opening b should NOT close a.
const multiAcc: AccordionElement = { ...accordionEl, allowMultipleOpen: true };
const multiHtml = renderAccordion(multiAcc, { styleKit: 'charcoal' });
const multiInjected = injectInteractiveRuntime(`<main>${multiHtml}</main>`, {
  ...interactiveSnapshot,
  pages: [
    {
      ...(interactiveSnapshot.pages[0] as PublishedSnapshot['pages'][number]),
      sections: [
        {
          ...((interactiveSnapshot.pages[0] as PublishedSnapshot['pages'][number])
            .sections[0] as PublishedSnapshot['pages'][number]['sections'][number]),
          elements: [multiAcc],
        },
      ],
    },
  ],
});
const docMulti = new StubDocument();
const parsedMulti = parseHtml(multiInjected);
for (const child of parsedMulti.children) docMulti.root.appendChild(child);
runRuntimeAgainstDocument(docMulti);
const multiRoot = docMulti.querySelectorAll(
  '[data-opencanvas-interactive="accordion"]',
)[0] as StubElement;
const multiItemA = multiRoot.querySelector('[data-opencanvas-acc-item="a"]') as StubElement;
const multiItemB = multiRoot.querySelector('[data-opencanvas-acc-item="b"]') as StubElement;
const multiToggleB = multiRoot.querySelector('[data-opencanvas-acc-toggle="b"]') as StubElement;
assert(
  multiItemA.getAttribute('data-opencanvas-acc-open') === 'true',
  'multi-open accordion: item a starts open',
);
multiToggleB.dispatchEvent(makeEvent('click'));
assert(
  multiItemA.getAttribute('data-opencanvas-acc-open') === 'true',
  'multi-open accordion: item a should STAY open after opening b',
);
assert(
  multiItemB.getAttribute('data-opencanvas-acc-open') === 'true',
  'multi-open accordion: item b should be open after click',
);

// ---------------------------------------------------------------------------
// (4) Simulate carousel next/prev — slide index updates with bounds.
// ---------------------------------------------------------------------------

const carRoot = doc1.querySelectorAll('[data-opencanvas-interactive="carousel"]')[0];
assert(carRoot !== undefined, 'carousel root not found in parsed DOM');
const prev = carRoot.querySelector('[data-opencanvas-carousel-prev]');
const next = carRoot.querySelector('[data-opencanvas-carousel-next]');
const dot0 = carRoot.querySelector('[data-opencanvas-carousel-dot="0"]');
const dot2 = carRoot.querySelector('[data-opencanvas-carousel-dot="2"]');
assert(prev !== null && next !== null, 'expected prev + next arrow nodes');
assert(dot0 !== null && dot2 !== null, 'expected dot 0 and dot 2 nodes');

assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '0',
  'carousel index should start at 0',
);

next.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '1',
  'carousel index should be 1 after one next click',
);
assert(
  dot0.getAttribute('aria-selected') === 'false',
  'dot 0 should no longer be selected after next',
);

next.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '2',
  'carousel index should be 2 after two next clicks',
);
assert(
  dot2.getAttribute('aria-selected') === 'true',
  'dot 2 should be selected after reaching index 2',
);

// Upper bound: another click stays at 2 (3 slides total → max index 2).
next.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '2',
  'carousel index should be CLAMPED to 2 (max) — no wrap-around per plan',
);

// Prev twice → 1 → 0.
prev.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '1',
  'carousel index should be 1 after one prev from 2',
);
prev.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '0',
  'carousel index should be 0 after another prev',
);

// Lower bound: another click stays at 0.
prev.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '0',
  'carousel index should be CLAMPED to 0 (min) — no wrap-around per plan',
);

// Click directly on dot 2 — index jumps to 2.
dot2.dispatchEvent(makeEvent('click'));
assert(
  carRoot.getAttribute('data-opencanvas-slide-index') === '2',
  'clicking dot 2 should set index to 2',
);

// ---------------------------------------------------------------------------
// (5) Keyboard: pressing Enter on a focused accordion header toggles.
// ---------------------------------------------------------------------------

// Fresh document so we know the starting state.
const doc5 = new StubDocument();
const parsed5 = parseHtml(injectedHtml);
for (const child of parsed5.children) doc5.root.appendChild(child);
runRuntimeAgainstDocument(doc5);
const acc5 = doc5.querySelectorAll('[data-opencanvas-interactive="accordion"]')[0] as StubElement;
const item5b = acc5.querySelector('[data-opencanvas-acc-item="b"]') as StubElement;
const toggle5b = acc5.querySelector('[data-opencanvas-acc-toggle="b"]') as StubElement;
assert(
  item5b.getAttribute('data-opencanvas-acc-open') === null,
  'keyboard test: item b should start closed',
);

toggle5b.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
assert(
  item5b.getAttribute('data-opencanvas-acc-open') === 'true',
  'pressing Enter on toggle b should open item b',
);

toggle5b.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
assert(
  item5b.getAttribute('data-opencanvas-acc-open') === null,
  'pressing Enter on toggle b again should close item b',
);

// Space also toggles.
toggle5b.dispatchEvent(makeEvent('keydown', { key: ' ' }));
assert(
  item5b.getAttribute('data-opencanvas-acc-open') === 'true',
  'pressing Space on toggle b should open item b',
);

// Non-toggle keys must NOT change state.
const before = item5b.getAttribute('data-opencanvas-acc-open');
toggle5b.dispatchEvent(makeEvent('keydown', { key: 'a' }));
const after = item5b.getAttribute('data-opencanvas-acc-open');
assert(before === after, 'pressing unrelated key "a" must NOT change accordion open state');

// ---------------------------------------------------------------------------
// (6) DOMContentLoaded gating: when readyState === 'loading', hydration
//     deferred until DOMContentLoaded fires.
// ---------------------------------------------------------------------------

const docLoading = new StubDocument();
docLoading.readyState = 'loading';
const parsedLoading = parseHtml(injectedHtml);
for (const child of parsedLoading.children) docLoading.root.appendChild(child);
runRuntimeAgainstDocument(docLoading);
const accLoading = docLoading.querySelectorAll(
  '[data-opencanvas-interactive="accordion"]',
)[0] as StubElement;
const toggleLoadingB = accLoading.querySelector('[data-opencanvas-acc-toggle="b"]') as StubElement;
const itemLoadingB = accLoading.querySelector('[data-opencanvas-acc-item="b"]') as StubElement;
// Before DOMContentLoaded fires, listeners are not yet attached — a click
// should be a no-op.
toggleLoadingB.dispatchEvent(makeEvent('click'));
assert(
  itemLoadingB.getAttribute('data-opencanvas-acc-open') === null,
  'click before DOMContentLoaded should NOT toggle (runtime is waiting)',
);
// Fire DOMContentLoaded — listeners attach now.
for (const fn of docLoading.domContentLoadedListeners) {
  fn(makeEvent('DOMContentLoaded'));
}
toggleLoadingB.dispatchEvent(makeEvent('click'));
assert(
  itemLoadingB.getAttribute('data-opencanvas-acc-open') === 'true',
  'click after DOMContentLoaded should toggle (runtime hydrated)',
);

// ---------------------------------------------------------------------------
// (7) Designer interaction hydration: motion, overlay, and rich-motion failure.
// ---------------------------------------------------------------------------

const designerSnapshot = {
  version: 1,
  publishedAt: '2026-06-16T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-designer',
      slug: 'designer',
      title: 'Designer',
      width: 1200,
      sections: [
        {
          id: 'section-hero',
          recipeId: 'hero-split',
          name: 'Hero',
          height: 560,
          elements: [
            {
              id: 'hero-title',
              type: 'text',
              box: { x: 80, y: 90, w: 560, h: 120, z: 1 },
              content: [{ text: 'Designer motion' }],
              role: 'heading',
              fontSize: 56,
              fontWeight: 700,
              align: 'left',
            },
            {
              id: 'open-project',
              type: 'action',
              box: { x: 80, y: 240, w: 180, h: 48, z: 2 },
              label: [{ text: 'Open project' }],
              href: { type: 'external', url: 'https://example.com/project' },
              variant: 'solid',
            },
            {
              id: 'hero-lottie-owner',
              type: 'media',
              box: { x: 720, y: 72, w: 320, h: 320, z: 1 },
              mediaKind: 'image',
              assetId: 'asset-lottie',
              alt: '',
              fit: 'cover',
              richMotionAssetId: 'hero-lottie',
            },
          ],
        },
      ],
    },
  ],
  overlaySections: [
    {
      id: 'overlay-project-detail-section',
      recipeId: 'custom',
      name: 'Project Detail Overlay',
      height: 420,
      elements: [
        {
          id: 'overlay-title',
          type: 'text',
          box: { x: 48, y: 48, w: 640, h: 72, z: 1 },
          content: [{ text: 'Project detail' }],
          role: 'heading',
          fontSize: 36,
          fontWeight: 700,
          align: 'left',
        },
      ],
    },
  ],
  motionSequences: [
    {
      id: 'hero-intro',
      trigger: { type: 'load' },
      steps: [
        {
          id: 'headline-in',
          target: { type: 'element', elementId: 'hero-title' },
          properties: { opacity: [0, 1], y: [24, 0] },
          durationMs: 500,
          easing: 'out-cubic',
        },
      ],
    },
  ],
  overlays: [
    {
      id: 'project-detail',
      contentSectionId: 'overlay-project-detail-section',
      trigger: { type: 'click', elementId: 'open-project' },
      modality: 'modal',
      placement: { type: 'center' },
      dismissal: {
        closeButton: true,
        escapeKey: true,
        backdropClick: true,
        routeChange: true,
      },
      focus: {
        initial: { type: 'overlay' },
        returnTo: { type: 'trigger' },
        trap: true,
      },
      bodyScroll: 'lock',
    },
  ],
  richMotionAssets: [
    {
      id: 'hero-lottie',
      ownerAssetId: 'asset-lottie',
      family: 'vector-animation',
      source: { kind: 'lottie-json' },
      playback: {
        trigger: { type: 'viewport-enter', elementId: 'hero-lottie-owner' },
        loop: false,
        speed: 1,
        reducedMotion: 'poster',
      },
    },
  ],
} as unknown as PublishedSnapshot;

assert(
  snapshotNeedsInteractiveRuntime(designerSnapshot) === true,
  'designer interaction fields should require interactive runtime injection',
);

const designerHtml = injectInteractiveRuntime(
  renderCanvasSnapshot(designerSnapshot, '/assets', 'smoke-site', {
    turnstileSiteKey: 'turnstile-test-key',
  }),
  designerSnapshot,
);
const designerDoc = new StubDocument();
const designerParsed = parseHtml(designerHtml);
for (const child of designerParsed.children) designerDoc.root.appendChild(child);
const designerTitle = designerDoc.querySelector(
  '[data-opencanvas-element="hero-title"]',
) as StubElement;
const designerTrigger = designerDoc.querySelector(
  '[data-opencanvas-element="open-project"]',
) as StubElement;
const designerOverlay = designerDoc.querySelector(
  '[data-opencanvas-overlay="project-detail"]',
) as StubElement;
const designerClose = designerDoc.querySelector(
  '[data-opencanvas-overlay-close="project-detail"]',
) as StubElement;
const designerRich = designerDoc.querySelector(
  '[data-opencanvas-rich-motion="hero-lottie"]',
) as StubElement;
assert(designerTitle !== null, 'designer title target must exist');
assert(designerTrigger !== null, 'designer overlay trigger target must exist');
assert(designerOverlay !== null, 'designer overlay shell must exist');
assert(designerClose !== null, 'designer overlay close control must exist');
assert(designerRich !== null, 'designer rich-motion owner must exist');

let richMotionFailures = 0;
designerRich.addEventListener('opencanvas:rich-motion-failure', () => {
  richMotionFailures++;
});
runRuntimeAgainstDocument(designerDoc);

assert(designerTitle.animations.length === 1, 'load motion should call element.animate once');
assert(
  designerTitle.getAttribute('data-opencanvas-motion-played') === 'hero-intro',
  'load motion should mark the played sequence id',
);
assert(richMotionFailures === 1, 'rich motion unsupported runtime should emit one failure event');
assert(
  designerRich.getAttribute('data-opencanvas-rich-motion-failed') === 'unsupported-runtime',
  'rich motion unsupported runtime should mark the element as failed',
);

designerTrigger.dispatchEvent(makeEvent('click'));
assert(
  designerOverlay.getAttribute('hidden') === null,
  'overlay trigger click should remove hidden from the overlay shell',
);
assert(
  designerOverlay.getAttribute('data-opencanvas-overlay-open') === 'true',
  'overlay trigger click should mark the overlay open',
);
assert(
  designerDoc.body.style.getPropertyValue('overflow') === 'hidden',
  'modal overlay with bodyScroll=lock should lock body scroll',
);

designerClose.dispatchEvent(makeEvent('click'));
assert(
  designerOverlay.getAttribute('hidden') !== null,
  'overlay close control should restore hidden on the overlay shell',
);
assert(
  designerOverlay.getAttribute('data-opencanvas-overlay-open') === null,
  'overlay close control should clear the open marker',
);
assert(
  designerDoc.body.style.getPropertyValue('overflow') === '',
  'closing the modal overlay should release body scroll lock',
);

const noAnimateDoc = new StubDocument();
const noAnimateParsed = parseHtml(designerHtml);
for (const child of noAnimateParsed.children) noAnimateDoc.root.appendChild(child);
const noAnimateTitle = noAnimateDoc.querySelector(
  '[data-opencanvas-element="hero-title"]',
) as StubElement;
noAnimateTitle.animate = undefined as never;
runRuntimeAgainstDocument(noAnimateDoc);
assert(
  noAnimateTitle.style.getPropertyValue('opacity') === '1',
  'motion without element.animate should apply final opacity directly',
);
assert(
  noAnimateTitle.style.getPropertyValue('transform') === 'translateY(0px)',
  'motion without element.animate should apply final transform directly',
);

// ---------------------------------------------------------------------------
// All assertions passed.
// ---------------------------------------------------------------------------

console.log(`[interactive:smoke] OK — runtime size ${String(INTERACTIVE_RUNTIME_SRC_CHARS)} chars`);
