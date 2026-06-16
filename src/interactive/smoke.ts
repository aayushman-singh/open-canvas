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
import {
  injectInteractiveRuntime,
  interactiveRuntimeSourceForSnapshot,
  snapshotNeedsInteractiveRuntime,
  snapshotNeedsLottieRuntime,
} from './inject.js';
import { ANIMEJS_WAAPI_RUNTIME_SRC } from './vendor/animejs-waapi.generated.js';
import { FLOATING_UI_DOM_RUNTIME_SRC } from './vendor/floating-ui-dom.generated.js';
import { LOTTIE_WEB_LIGHT_RUNTIME_SRC } from './vendor/lottie-web-light.generated.js';

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
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
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
  readonly nodeType = 1;
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

  get childNodes(): StubElement[] {
    return this.children;
  }

  private assignOwnerDocument(doc: StubDocument | null): void {
    this.ownerDocument = doc;
    for (const child of this.children) child.assignOwnerDocument(doc);
  }

  appendChild(child: StubElement): void {
    child.parent = this;
    child.assignOwnerDocument(this.ownerDocument);
    this.children.push(child);
  }

  replaceChildren(...children: StubElement[]): void {
    for (const child of this.children) {
      child.parent = null;
      child.assignOwnerDocument(null);
    }
    this.children = [];
    for (const child of children) this.appendChild(child);
  }

  addEventListener(type: string, listener: Listener): void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(
      type,
      listeners.filter((fn) => fn !== listener),
    );
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
    if (this.ownerDocument) this.ownerDocument.dispatchBubbledEvent(event);
  }

  animate(keyframes: unknown, options: unknown): { finished: Promise<void>; cancel(): void } {
    this.animations.push({ keyframes, options });
    return {
      finished: Promise.resolve(),
      cancel() {
        return undefined;
      },
    };
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
  title = '';
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

  removeEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    this.listeners.set(
      type,
      listeners.filter((fn) => fn !== listener),
    );
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.root.querySelectorAll(selector);
  }
  querySelector(selector: string): StubElement | null {
    return this.root.querySelector(selector);
  }
  createElement(tagName: string): StubElement {
    const element = new StubElement(tagName);
    element.ownerDocument = this;
    return element;
  }
  dispatchEvent(event: StubEvent): void {
    event.target = null;
    this.dispatchBubbledEvent(event);
  }

  dispatchBubbledEvent(event: StubEvent): void {
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

function makeEvent(
  type: string,
  init: {
    key?: string;
    button?: number;
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
  } = {},
): StubEvent {
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
  if (init.button !== undefined) event.button = init.button;
  if (init.metaKey !== undefined) event.metaKey = init.metaKey;
  if (init.ctrlKey !== undefined) event.ctrlKey = init.ctrlKey;
  if (init.shiftKey !== undefined) event.shiftKey = init.shiftKey;
  if (init.altKey !== undefined) event.altKey = init.altKey;
  return event;
}

async function flushMicrotasks(turns = 5): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function installNoopIntersectionObserver(doc: StubDocument): void {
  doc.defaultView.IntersectionObserver = class StubNoopIntersectionObserver {
    observe(): void {
      return undefined;
    }

    disconnect(): void {
      return undefined;
    }
  };
}

// Execute the runtime IIFE against a stub document. The IIFE references the
// global `document` via the runtime entry; we pass our stub in as a parameter
// to `new Function` and the body references it directly.
function runRuntimeAgainstDocument(doc: StubDocument, source = INTERACTIVE_RUNTIME_SRC): void {
  // The IIFE wraps `function hydrateX(root) { ... }` declarations + the
  // hydrateAll dispatch + the readyState branch. `new Function('document', ...)`
  // gives the runtime a fresh scope where `document` resolves to our stub.
  // `no-implied-eval` is intentional here: the smoke MUST execute the exact
  // string the visitor browser will execute — anything else (e.g. importing
  // the TS modules directly) would let a divergence between source-of-truth
  // and shipped bytes slip through.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see comment above.
  const fn = new Function('document', source) as (d: StubDocument) => void;
  fn(doc);
}

function withoutGlobalAdapter(globalName: string, fn: () => void): void {
  const globals = globalThis as Record<string, unknown>;
  const previous = globals[globalName];
  delete globals[globalName];
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete globals[globalName];
    } else {
      globals[globalName] = previous;
    }
  }
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
assert(injectedHtml.includes('__opencanvasFloating'), 'runtime body missing Floating UI adapter');

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
              id: 'open-popover',
              type: 'action',
              box: { x: 280, y: 240, w: 180, h: 48, z: 2 },
              label: [{ text: 'Open popover' }],
              href: { type: 'external', url: 'https://example.com/popover' },
              variant: 'outline',
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
    {
      id: 'overlay-popover-section',
      recipeId: 'custom',
      name: 'Project Popover Overlay',
      height: 220,
      elements: [
        {
          id: 'overlay-popover-title',
          type: 'text',
          box: { x: 32, y: 32, w: 320, h: 56, z: 1 },
          content: [{ text: 'Anchored popover' }],
          role: 'heading',
          fontSize: 28,
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
    {
      id: 'hero-viewport-reveal',
      trigger: { type: 'viewport-enter', elementId: 'hero-title' },
      steps: [
        {
          id: 'headline-viewport',
          target: { type: 'element', elementId: 'hero-title' },
          properties: { opacity: [0, 1], y: [18, 0] },
          durationMs: 320,
          easing: 'out-cubic',
        },
      ],
    },
    {
      id: 'project-click-pulse',
      trigger: { type: 'click', elementId: 'open-project' },
      steps: [
        {
          id: 'project-pulse',
          target: { type: 'element', elementId: 'open-project' },
          properties: { scale: [1, 1.08] },
          durationMs: 180,
          easing: 'out-cubic',
        },
      ],
    },
    {
      id: 'popover-hover-lift',
      trigger: { type: 'hover', elementId: 'open-popover' },
      steps: [
        {
          id: 'popover-lift',
          target: { type: 'element', elementId: 'open-popover' },
          properties: { y: [0, -8] },
          durationMs: 180,
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
    {
      id: 'project-popover',
      contentSectionId: 'overlay-popover-section',
      trigger: { type: 'click', elementId: 'open-popover' },
      modality: 'non-modal',
      placement: { type: 'anchored', anchorElementId: 'open-popover', side: 'right' },
      dismissal: {
        closeButton: true,
        escapeKey: true,
        backdropClick: true,
        routeChange: true,
      },
      focus: {
        initial: { type: 'overlay' },
        returnTo: { type: 'trigger' },
        trap: false,
      },
      bodyScroll: 'allow',
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
assert(
  snapshotNeedsLottieRuntime(designerSnapshot) === true,
  'lottie-json rich-motion assets should require the conditional Lottie runtime',
);
assert(
  INTERACTIVE_RUNTIME_SRC.includes(LOTTIE_WEB_LIGHT_RUNTIME_SRC) === false,
  'base interactive runtime should not include the Lottie payload',
);
assert(
  interactiveRuntimeSourceForSnapshot(designerSnapshot).includes(LOTTIE_WEB_LIGHT_RUNTIME_SRC),
  'designer snapshot runtime should include the conditional Lottie payload',
);
const unusedLottieSnapshot = {
  ...designerSnapshot,
  pages: designerSnapshot.pages.map((page) => ({
    ...page,
    sections: page.sections.map((section) => ({
      ...section,
      elements: section.elements.map((element) =>
        element.id === 'hero-lottie-owner' ? { ...element, richMotionAssetId: undefined } : element,
      ),
    })),
  })),
} as unknown as PublishedSnapshot;
assert(
  snapshotNeedsLottieRuntime(unusedLottieSnapshot) === false,
  'unreferenced Lottie rich-motion assets should not require the Lottie payload',
);
assert(
  interactiveRuntimeSourceForSnapshot(unusedLottieSnapshot).includes(
    LOTTIE_WEB_LIGHT_RUNTIME_SRC,
  ) === false,
  'unreferenced Lottie rich-motion assets should not inject the Lottie payload',
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
const designerPopoverTrigger = designerDoc.querySelector(
  '[data-opencanvas-element="open-popover"]',
) as StubElement;
const designerOverlay = designerDoc.querySelector(
  '[data-opencanvas-overlay="project-detail"]',
) as StubElement;
const designerPopover = designerDoc.querySelector(
  '[data-opencanvas-overlay="project-popover"]',
) as StubElement;
const designerClose = designerDoc.querySelector(
  '[data-opencanvas-overlay-close="project-detail"]',
) as StubElement;
const designerPopoverClose = designerDoc.querySelector(
  '[data-opencanvas-overlay-close="project-popover"]',
) as StubElement;
const designerPopoverPanel = designerPopover
  ? designerPopover.querySelector('[data-opencanvas-overlay-panel]')
  : null;
const designerRich = designerDoc.querySelector(
  '[data-opencanvas-rich-motion="hero-lottie"]',
) as StubElement;
assert(designerTitle !== null, 'designer title target must exist');
assert(designerTrigger !== null, 'designer overlay trigger target must exist');
assert(designerPopoverTrigger !== null, 'designer popover trigger target must exist');
assert(designerOverlay !== null, 'designer overlay shell must exist');
assert(designerPopover !== null, 'designer popover shell must exist');
assert(designerClose !== null, 'designer overlay close control must exist');
assert(designerPopoverClose !== null, 'designer popover close control must exist');
assert(designerPopoverPanel !== null, 'designer popover panel must exist');
assert(designerRich !== null, 'designer rich-motion owner must exist');

let richMotionFailures = 0;
let richMotionFailureDetail:
  | { assetId?: string; elementId?: string; family?: string; source?: string; phase?: string }
  | undefined;
designerRich.addEventListener('opencanvas:rich-motion-failure', () => {
  richMotionFailures++;
});
designerRich.addEventListener('opencanvas:rich-motion-failure', (event) => {
  richMotionFailureDetail = event.detail as typeof richMotionFailureDetail;
});
let floatingAutoUpdateCalls = 0;
let floatingCleanupCalls = 0;
let floatingComputeCalls = 0;
designerDoc.defaultView.__opencanvasFloating = {
  autoUpdate(_reference: unknown, _floating: unknown, update: () => unknown) {
    floatingAutoUpdateCalls++;
    void update();
    return () => {
      floatingCleanupCalls++;
    };
  },
  computePosition(_reference: unknown, _floating: unknown, options: { placement?: string }) {
    floatingComputeCalls++;
    assert(options.placement === 'right', 'anchored overlay should pass schema side as placement');
    return Promise.resolve({ x: 321, y: 123, placement: 'right' });
  },
  flip() {
    return { name: 'flip' };
  },
  offset(value: unknown) {
    return { name: 'offset', value };
  },
  shift(options: unknown) {
    return { name: 'shift', options };
  },
};
let motionObserverCallback:
  | ((entries: Array<{ isIntersecting: boolean }>) => void)
  | undefined;
let motionObserverTarget = null as StubElement | null;
let motionObserverDisconnects = 0;
designerDoc.defaultView.IntersectionObserver = class StubMotionIntersectionObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    motionObserverCallback = callback;
  }

  observe(target: StubElement): void {
    motionObserverTarget = target;
  }

  disconnect(): void {
    motionObserverDisconnects++;
  }
};
runRuntimeAgainstDocument(designerDoc);
const generatedFloatingAdapter = (globalThis as Record<string, unknown>).__opencanvasFloating as
  | { computePosition?: unknown }
  | undefined;
assert(
  typeof generatedFloatingAdapter?.computePosition === 'function',
  'generated Floating UI runtime should register global computePosition adapter',
);

assert(designerTitle.animations.length > 0, 'load motion should create WAAPI animations');
const titleAnimationsAfterLoad = designerTitle.animations.length;
assert(
  designerTitle.getAttribute('data-opencanvas-motion-played') === 'hero-intro',
  'load motion should mark the played sequence id',
);
assert(
  designerTitle.getAttribute('data-opencanvas-motion-adapter') === 'animejs-waapi',
  'load motion should run through the Anime.js WAAPI adapter',
);
const observedMotionTargetId =
  motionObserverTarget?.getAttribute('data-opencanvas-element') ?? null;
assert(observedMotionTargetId === 'hero-title', 'viewport-enter motion should observe the trigger element');
assert(motionObserverCallback !== undefined, 'viewport-enter motion should install observer');
motionObserverCallback([{ isIntersecting: false }]);
assert(
  designerTitle.animations.length === titleAnimationsAfterLoad,
  'non-intersecting viewport entry should not play sequence',
);
motionObserverCallback([{ isIntersecting: true }]);
assert(
  designerTitle.animations.length > titleAnimationsAfterLoad,
  'intersecting viewport entry should play the sequence once',
);
assert(
  designerTitle.getAttribute('data-opencanvas-motion-played') === 'hero-viewport-reveal',
  'viewport-enter motion should mark the played sequence id',
);
assert(
  motionObserverDisconnects === 1,
  'viewport-enter motion should disconnect after first play',
);
const clickMotionAnimationsBefore = designerTrigger.animations.length;
designerTrigger.dispatchEvent(makeEvent('click'));
assert(
  designerTrigger.animations.length === clickMotionAnimationsBefore + 1,
  'click-triggered motion should play when the trigger is clicked',
);
assert(
  designerTrigger.getAttribute('data-opencanvas-motion-played') === 'project-click-pulse',
  'click-triggered motion should mark the clicked target',
);
const hoverMotionAnimationsBefore = designerPopoverTrigger.animations.length;
designerPopoverTrigger.dispatchEvent(makeEvent('mouseenter'));
assert(
  designerPopoverTrigger.animations.length === hoverMotionAnimationsBefore + 1,
  'hover-triggered motion should play on pointer entry',
);
assert(
  designerPopoverTrigger.getAttribute('data-opencanvas-motion-played') === 'popover-hover-lift',
  'hover-triggered motion should mark the hovered target',
);
assert(richMotionFailures === 1, 'rich motion unsupported runtime should emit one failure event');
assert(
  designerRich.getAttribute('data-opencanvas-rich-motion-failed') === 'adapter-unavailable',
  'missing Lottie runtime should mark the element as adapter-unavailable',
);
assert(
  richMotionFailureDetail?.assetId === 'hero-lottie' &&
    richMotionFailureDetail.elementId === 'hero-lottie-owner' &&
    richMotionFailureDetail.family === 'vector-animation' &&
    richMotionFailureDetail.source === 'lottie-json' &&
    richMotionFailureDetail.phase === 'adapter-unavailable',
  'Lottie failure detail should include asset, element, family, source, and phase',
);

const lottieDoc = new StubDocument();
const lottieParsed = parseHtml(designerHtml);
for (const child of lottieParsed.children) lottieDoc.root.appendChild(child);
const lottieRich = lottieDoc.querySelector(
  '[data-opencanvas-rich-motion="hero-lottie"]',
) as StubElement;
assert(lottieRich !== null, 'lottie rich-motion owner must exist');
let lottieReadyEvents = 0;
let lottieFailureEvents = 0;
const lottiePlayCalls = { value: 0 };
const lottiePauseCalls = { value: 0 };
let lottieSpeed: number | null = null;
let lottieLoadOptions:
  | {
      path?: string;
      loop?: boolean;
      autoplay?: boolean;
      renderer?: string;
      container?: StubElement;
    }
  | undefined;
let lottieObserverCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | undefined;
lottieRich.addEventListener('opencanvas:rich-motion-ready', () => {
  lottieReadyEvents++;
});
lottieRich.addEventListener('opencanvas:rich-motion-failure', () => {
  lottieFailureEvents++;
});
lottieDoc.defaultView.__opencanvasLottie = {
  loadAnimation(options: typeof lottieLoadOptions) {
    lottieLoadOptions = options;
    return {
      setSpeed(speed: number) {
        lottieSpeed = speed;
      },
      addEventListener(name: string, listener: () => void) {
        if (name === 'DOMLoaded') listener();
      },
      play() {
        lottiePlayCalls.value++;
      },
      pause() {
        lottiePauseCalls.value++;
      },
      destroy() {
        return undefined;
      },
    };
  },
};
lottieDoc.defaultView.IntersectionObserver = class StubIntersectionObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    lottieObserverCallback = callback;
  }

  observe(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
};
runRuntimeAgainstDocument(lottieDoc);
assert(lottieFailureEvents === 0, 'available Lottie adapter should not emit a failure');
assert(lottieReadyEvents === 1, 'available Lottie adapter should emit one ready event');
assert(
  lottieLoadOptions?.path === '/assets/asset-lottie',
  'Lottie adapter should receive asset URL',
);
assert(lottieLoadOptions?.renderer === 'svg', 'Lottie adapter should use the SVG renderer');
assert(lottieLoadOptions?.loop === false, 'Lottie adapter should receive playback loop setting');
assert(
  lottieLoadOptions?.autoplay === false,
  'viewport-enter Lottie playback should not autoplay before intersection',
);
assert(lottieSpeed === 1, 'Lottie adapter should receive playback speed');
assert(
  lottieRich.getAttribute('data-opencanvas-rich-motion-ready') === 'lottie-web',
  'Lottie success should mark the rich-motion node as ready',
);
assert(
  lottieRich.querySelector('[data-opencanvas-lottie-container]') !== null,
  'Lottie success should create a playback container',
);
assert(lottieObserverCallback !== undefined, 'viewport-enter Lottie should install observer');
const lottiePlayCallsBeforeIntersection: number = lottiePlayCalls.value;
assert(
  lottiePlayCallsBeforeIntersection === 0,
  'viewport-enter Lottie should wait for intersection before play',
);
lottieObserverCallback([{ isIntersecting: true }]);
const lottiePlayCallsAfterIntersection: number = lottiePlayCalls.value;
assert(
  lottiePlayCallsAfterIntersection === 1,
  'viewport-enter Lottie should play on first intersection',
);
assert(lottiePauseCalls.value === 0, 'non-reduced-motion Lottie should not pause playback');

const reducedMotionDoc = new StubDocument();
const reducedMotionParsed = parseHtml(designerHtml);
for (const child of reducedMotionParsed.children) reducedMotionDoc.root.appendChild(child);
const reducedMotionRich = reducedMotionDoc.querySelector(
  '[data-opencanvas-rich-motion="hero-lottie"]',
) as StubElement;
reducedMotionRich.setAttribute('data-opencanvas-rich-motion-poster-url', '/assets/poster-lottie');
let reducedLottieLoadCalls = 0;
reducedMotionDoc.defaultView.matchMedia = () => ({ matches: true });
reducedMotionDoc.defaultView.__opencanvasLottie = {
  loadAnimation() {
    reducedLottieLoadCalls++;
    return {};
  },
};
runRuntimeAgainstDocument(reducedMotionDoc);
assert(reducedLottieLoadCalls === 0, 'reduced-motion poster mode should not load Lottie');
assert(
  reducedMotionRich.querySelector('[data-opencanvas-rich-motion-poster]') !== null,
  'reduced-motion poster mode should render the poster asset',
);
assert(
  reducedMotionRich.getAttribute('data-opencanvas-rich-motion-ready') === 'lottie-web',
  'reduced-motion poster mode should mark the node ready',
);

const unsupportedTriggerDoc = new StubDocument();
const unsupportedTriggerParsed = parseHtml(designerHtml);
for (const child of unsupportedTriggerParsed.children)
  unsupportedTriggerDoc.root.appendChild(child);
const unsupportedTriggerRich = unsupportedTriggerDoc.querySelector(
  '[data-opencanvas-rich-motion="hero-lottie"]',
) as StubElement;
unsupportedTriggerRich.setAttribute('data-opencanvas-rich-motion-trigger', 'click');
let unsupportedTriggerFailures = 0;
unsupportedTriggerRich.addEventListener('opencanvas:rich-motion-failure', (event) => {
  unsupportedTriggerFailures++;
  const detail = event.detail as { phase?: string; elementId?: string; trigger?: string };
  assert(detail.phase === 'unsupported-trigger', 'click Lottie trigger should fail explicitly');
  assert(
    detail.elementId === 'hero-lottie-owner',
    'unsupported trigger failure should include element id',
  );
  assert(detail.trigger === 'click', 'unsupported trigger failure should include trigger type');
});
unsupportedTriggerDoc.defaultView.__opencanvasLottie = {
  loadAnimation() {
    throw new Error('should not load unsupported trigger');
  },
};
runRuntimeAgainstDocument(unsupportedTriggerDoc);
assert(
  unsupportedTriggerFailures === 1,
  'unsupported Lottie trigger should emit one failure event',
);
assert(
  unsupportedTriggerRich.getAttribute('data-opencanvas-rich-motion-failed') ===
    'unsupported-trigger',
  'unsupported Lottie trigger should mark the rich-motion node as failed',
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

designerPopoverTrigger.dispatchEvent(makeEvent('click'));
await flushMicrotasks();
assert(
  designerPopover.getAttribute('hidden') === null,
  'anchored overlay trigger click should remove hidden from the overlay shell',
);
assert(
  designerPopover.getAttribute('data-opencanvas-overlay-open') === 'true',
  'anchored overlay trigger click should mark the overlay open',
);
assert(
  floatingAutoUpdateCalls === 1,
  'anchored overlay should subscribe to Floating UI autoUpdate',
);
assert(floatingComputeCalls >= 1, 'anchored overlay should compute position through Floating UI');
assert(
  designerPopoverPanel.style.getPropertyValue('left') === '321px',
  'anchored overlay should apply Floating UI computed left',
);
assert(
  designerPopoverPanel.style.getPropertyValue('top') === '123px',
  'anchored overlay should apply Floating UI computed top',
);
assert(
  designerPopover.getAttribute('data-opencanvas-overlay-position-adapter') === 'floating-ui-dom',
  'anchored overlay should mark the Floating UI adapter',
);
assert(
  designerPopover.getAttribute('data-opencanvas-overlay-placement-resolved') === 'right',
  'anchored overlay should mark the resolved placement',
);
designerPopoverClose.dispatchEvent(makeEvent('click'));
assert(floatingCleanupCalls === 1, 'anchored overlay close should clean up Floating UI autoUpdate');
assert(
  designerPopover.getAttribute('hidden') !== null,
  'anchored overlay close control should restore hidden on the overlay shell',
);

const noAnimateDoc = new StubDocument();
const noAnimateParsed = parseHtml(designerHtml);
for (const child of noAnimateParsed.children) noAnimateDoc.root.appendChild(child);
installNoopIntersectionObserver(noAnimateDoc);
const noAnimateTitle = noAnimateDoc.querySelector(
  '[data-opencanvas-element="hero-title"]',
) as StubElement;
let motionFailures = 0;
noAnimateTitle.addEventListener('opencanvas:motion-failure', (event) => {
  motionFailures++;
  const detail = event.detail as { phase?: string; detail?: { adapter?: string } };
  assert(detail.phase === 'adapter-error', 'motion failure should name the adapter error phase');
  assert(
    detail.detail?.adapter === 'animejs-waapi',
    'motion failure should name the Anime.js WAAPI adapter',
  );
});
noAnimateTitle.animate = undefined as never;
runRuntimeAgainstDocument(noAnimateDoc);
assert(motionFailures === 1, 'motion without element.animate should emit one failure event');
assert(
  noAnimateTitle.getAttribute('data-opencanvas-motion-failed') === 'adapter-error',
  'motion without element.animate should mark the target as failed',
);
assert(
  noAnimateTitle.getAttribute('data-opencanvas-motion-played') === null,
  'motion adapter failure must not mark the sequence as played',
);
assert(
  noAnimateTitle.style.getPropertyValue('opacity') === '',
  'motion adapter failure must not write a final opacity fallback',
);
assert(
  noAnimateTitle.style.getPropertyValue('transform') === '',
  'motion adapter failure must not write a final transform fallback',
);

const missingAdapterDoc = new StubDocument();
const missingAdapterParsed = parseHtml(designerHtml);
for (const child of missingAdapterParsed.children) missingAdapterDoc.root.appendChild(child);
installNoopIntersectionObserver(missingAdapterDoc);
const missingAdapterTitle = missingAdapterDoc.querySelector(
  '[data-opencanvas-element="hero-title"]',
) as StubElement;
let adapterUnavailableFailures = 0;
missingAdapterTitle.addEventListener('opencanvas:motion-failure', (event) => {
  adapterUnavailableFailures++;
  const detail = event.detail as { phase?: string; detail?: { adapter?: string } };
  assert(
    detail.phase === 'adapter-unavailable',
    'missing Anime adapter should name the unavailable phase',
  );
  assert(
    detail.detail?.adapter === 'animejs-waapi',
    'missing Anime adapter failure should name the adapter',
  );
});
const runtimeWithoutAnime = INTERACTIVE_RUNTIME_SRC.replace(ANIMEJS_WAAPI_RUNTIME_SRC, '');
assert(
  runtimeWithoutAnime.length < INTERACTIVE_RUNTIME_SRC.length,
  'test runtime should remove the generated Anime adapter',
);
withoutGlobalAdapter('__opencanvasAnime', () =>
  runRuntimeAgainstDocument(missingAdapterDoc, runtimeWithoutAnime),
);
assert(adapterUnavailableFailures === 1, 'missing Anime adapter should emit one failure event');
assert(
  missingAdapterTitle.getAttribute('data-opencanvas-motion-failed') === 'adapter-unavailable',
  'missing Anime adapter should mark the target as failed',
);
assert(
  missingAdapterTitle.getAttribute('data-opencanvas-motion-played') === null,
  'missing Anime adapter must not mark the sequence as played',
);

const missingFloatingDoc = new StubDocument();
const missingFloatingParsed = parseHtml(designerHtml);
for (const child of missingFloatingParsed.children) missingFloatingDoc.root.appendChild(child);
const missingFloatingTrigger = missingFloatingDoc.querySelector(
  '[data-opencanvas-element="open-popover"]',
) as StubElement;
const missingFloatingOverlay = missingFloatingDoc.querySelector(
  '[data-opencanvas-overlay="project-popover"]',
) as StubElement;
let floatingFailures = 0;
missingFloatingOverlay.addEventListener('opencanvas:overlay-position-failure', (event) => {
  floatingFailures++;
  const detail = event.detail as { phase?: string; detail?: { adapter?: string } };
  assert(
    detail.phase === 'adapter-unavailable',
    'missing Floating UI adapter should name the unavailable phase',
  );
  assert(
    detail.detail?.adapter === 'floating-ui-dom',
    'missing Floating UI adapter failure should name the adapter',
  );
});
const runtimeWithoutFloating = INTERACTIVE_RUNTIME_SRC.replace(FLOATING_UI_DOM_RUNTIME_SRC, '');
assert(
  runtimeWithoutFloating.length < INTERACTIVE_RUNTIME_SRC.length,
  'test runtime should remove the generated Floating UI adapter',
);
withoutGlobalAdapter('__opencanvasFloating', () => {
  runRuntimeAgainstDocument(missingFloatingDoc, runtimeWithoutFloating);
  missingFloatingTrigger.dispatchEvent(makeEvent('click'));
});
assert(floatingFailures === 1, 'missing Floating UI adapter should emit one failure event');
assert(
  missingFloatingOverlay.getAttribute('hidden') !== null,
  'missing Floating UI adapter should leave the anchored overlay hidden',
);
assert(
  missingFloatingOverlay.getAttribute('data-opencanvas-overlay-open') === null,
  'missing Floating UI adapter must not mark the anchored overlay open',
);
assert(
  missingFloatingOverlay.getAttribute('data-opencanvas-overlay-position-failed') ===
    'adapter-unavailable',
  'missing Floating UI adapter should mark the overlay as failed',
);

const rejectingFloatingDoc = new StubDocument();
const rejectingFloatingParsed = parseHtml(designerHtml);
for (const child of rejectingFloatingParsed.children) rejectingFloatingDoc.root.appendChild(child);
const rejectingFloatingTrigger = rejectingFloatingDoc.querySelector(
  '[data-opencanvas-element="open-popover"]',
) as StubElement;
const rejectingFloatingOverlay = rejectingFloatingDoc.querySelector(
  '[data-opencanvas-overlay="project-popover"]',
) as StubElement;
let rejectingFloatingFailures = 0;
rejectingFloatingOverlay.addEventListener('opencanvas:overlay-position-failure', (event) => {
  rejectingFloatingFailures++;
  const detail = event.detail as { phase?: string; detail?: { adapter?: string } };
  assert(detail.phase === 'position-error', 'Floating UI rejection should name position-error');
  assert(
    detail.detail?.adapter === 'floating-ui-dom',
    'Floating UI rejection should name the adapter',
  );
});
rejectingFloatingDoc.defaultView.__opencanvasFloating = {
  autoUpdate(_reference: unknown, _floating: unknown, update: () => unknown) {
    void update;
    return () => undefined;
  },
  computePosition() {
    return Promise.reject(new Error('layout unavailable'));
  },
  flip() {
    return { name: 'flip' };
  },
  offset(value: unknown) {
    return { name: 'offset', value };
  },
  shift(options: unknown) {
    return { name: 'shift', options };
  },
};
runRuntimeAgainstDocument(rejectingFloatingDoc);
rejectingFloatingTrigger.dispatchEvent(makeEvent('click'));
await flushMicrotasks();
assert(
  rejectingFloatingFailures === 1,
  'Floating UI compute rejection should emit one failure event',
);
assert(
  rejectingFloatingOverlay.getAttribute('hidden') !== null,
  'Floating UI compute rejection should leave the anchored overlay hidden',
);
assert(
  rejectingFloatingOverlay.getAttribute('data-opencanvas-overlay-open') === null,
  'Floating UI compute rejection must not mark the anchored overlay open',
);
assert(
  rejectingFloatingOverlay.getAttribute('data-opencanvas-overlay-position-failed') ===
    'position-error',
  'Floating UI compute rejection should mark the overlay as failed',
);

// ---------------------------------------------------------------------------
// (8) Load Experience hydration: bounded gates play intro + exit sequences.
// ---------------------------------------------------------------------------

const loadExperienceSnapshot = {
  version: 1,
  publishedAt: '2026-06-16T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-load',
      slug: 'load',
      title: 'Load',
      width: 1200,
      sections: [
        {
          id: 'section-load',
          recipeId: 'custom',
          name: 'Load section',
          height: 360,
          elements: [
            {
              id: 'load-intro-target',
              type: 'text',
              box: { x: 80, y: 64, w: 420, h: 72, z: 1 },
              content: [{ text: 'Intro' }],
              role: 'heading',
              fontSize: 40,
              fontWeight: 700,
              align: 'left',
            },
            {
              id: 'load-exit-target',
              type: 'text',
              box: { x: 80, y: 164, w: 420, h: 72, z: 1 },
              content: [{ text: 'Exit' }],
              role: 'heading',
              fontSize: 40,
              fontWeight: 700,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
  motionSequences: [
    {
      id: 'load-intro-sequence',
      trigger: { type: 'click', elementId: 'load-intro-target' },
      steps: [
        {
          id: 'load-intro-step',
          target: { type: 'element', elementId: 'load-intro-target' },
          properties: { opacity: [0, 1] },
          durationMs: 160,
          easing: 'out-cubic',
        },
      ],
    },
    {
      id: 'load-exit-sequence',
      trigger: { type: 'click', elementId: 'load-exit-target' },
      steps: [
        {
          id: 'load-exit-step',
          target: { type: 'element', elementId: 'load-exit-target' },
          properties: { y: [12, 0] },
          durationMs: 160,
          easing: 'out-cubic',
        },
      ],
    },
  ],
  loadExperience: {
    id: 'site-load',
    run: 'every-visit',
    gates: [{ type: 'document-ready' }],
    timeoutMs: 1000,
    introSequenceId: 'load-intro-sequence',
    exitSequenceId: 'load-exit-sequence',
    failureEvent: 'opencanvas:load-experience-failed',
  },
} as unknown as PublishedSnapshot;

const loadExperienceHtml = injectInteractiveRuntime(
  renderCanvasSnapshot(loadExperienceSnapshot, '/assets', 'load-site', {
    turnstileSiteKey: 'turnstile-test-key',
  }),
  loadExperienceSnapshot,
);
const loadExperienceDoc = new StubDocument();
const loadExperienceParsed = parseHtml(loadExperienceHtml);
for (const child of loadExperienceParsed.children) loadExperienceDoc.root.appendChild(child);
const loadIntroTarget = loadExperienceDoc.querySelector(
  '[data-opencanvas-element="load-intro-target"]',
) as StubElement;
const loadExitTarget = loadExperienceDoc.querySelector(
  '[data-opencanvas-element="load-exit-target"]',
) as StubElement;
let loadReadyEvents = 0;
let loadReadyDetail: { id?: string } | undefined;
loadExperienceDoc.addEventListener('opencanvas:load-experience-ready', (event) => {
  loadReadyEvents++;
  loadReadyDetail = event.detail as typeof loadReadyDetail;
});
runRuntimeAgainstDocument(loadExperienceDoc);
await flushMicrotasks();
assert(loadIntroTarget.animations.length > 0, 'load experience should play intro sequence');
assert(loadExitTarget.animations.length > 0, 'load experience should play exit sequence');
assert(loadReadyEvents === 1, 'load experience should emit one ready event');
assert(loadReadyDetail?.id === 'site-load', 'load experience ready event should include id');

// ---------------------------------------------------------------------------
// (9) Route Transition hydration: same-site navigation swaps, hydrates, and
//     restores the current page when a dependent phase fails.
// ---------------------------------------------------------------------------

const routeTransitionSnapshot = {
  version: 1,
  publishedAt: '2026-06-16T00:00:00.000Z',
  styleKit: 'charcoal',
  pages: [
    {
      id: 'page-current',
      slug: 'current',
      title: 'Current',
      width: 1200,
      sections: [
        {
          id: 'section-current',
          recipeId: 'custom',
          name: 'Current section',
          height: 360,
          elements: [
            {
              id: 'route-current-title',
              type: 'text',
              box: { x: 80, y: 64, w: 520, h: 72, z: 1 },
              content: [{ text: 'Current route' }],
              role: 'heading',
              fontSize: 40,
              fontWeight: 700,
              align: 'left',
            },
            {
              id: 'route-link',
              type: 'action',
              box: { x: 80, y: 164, w: 180, h: 48, z: 2 },
              label: [{ text: 'Next route' }],
              href: { type: 'page', pageId: 'page-next' },
              variant: 'solid',
            },
          ],
        },
      ],
    },
    {
      id: 'page-next',
      slug: 'next',
      title: 'Next',
      width: 1200,
      sections: [
        {
          id: 'section-next',
          recipeId: 'custom',
          name: 'Next section',
          height: 360,
          elements: [
            {
              id: 'route-next-title',
              type: 'text',
              box: { x: 80, y: 64, w: 520, h: 72, z: 1 },
              content: [{ text: 'Next route' }],
              role: 'heading',
              fontSize: 40,
              fontWeight: 700,
              align: 'left',
            },
          ],
        },
      ],
    },
  ],
  motionSequences: [
    {
      id: 'route-out',
      trigger: { type: 'route-navigation', fromPageId: 'page-current', toPageId: 'page-next' },
      steps: [
        {
          id: 'route-out-step',
          target: { type: 'element', elementId: 'route-current-title' },
          properties: { opacity: [1, 0] },
          durationMs: 0,
          easing: 'out-cubic',
        },
      ],
    },
    {
      id: 'route-in',
      trigger: { type: 'route-navigation', fromPageId: 'page-current', toPageId: 'page-next' },
      steps: [
        {
          id: 'route-in-step',
          target: { type: 'element', elementId: 'route-next-title' },
          properties: { opacity: [0, 1], y: [16, 0] },
          durationMs: 0,
          easing: 'out-cubic',
        },
      ],
    },
  ],
  routeTransition: {
    id: 'route-swap',
    trigger: { type: 'same-site-navigation' },
    outgoingSequenceId: 'route-out',
    incomingSequenceId: 'route-in',
    swapAt: 'after-outgoing',
    scrollRestoration: 'top',
    focusTarget: { type: 'element', elementId: 'route-next-title' },
    hydrate: true,
    failureEvent: 'opencanvas:route-transition-failed',
  },
} as unknown as PublishedSnapshot;

const routeCurrentPage = routeTransitionSnapshot.pages[0]!;
const routeNextPage = routeTransitionSnapshot.pages[1]!;
const routeCurrentHtml = injectInteractiveRuntime(
  renderCanvasSnapshot(routeTransitionSnapshot, '/assets', 'route-site', {
    renderPages: [routeCurrentPage],
    turnstileSiteKey: 'turnstile-test-key',
  }),
  routeTransitionSnapshot,
);
const routeNextHtml = injectInteractiveRuntime(
  renderCanvasSnapshot(routeTransitionSnapshot, '/assets', 'route-site', {
    renderPages: [routeNextPage],
    turnstileSiteKey: 'turnstile-test-key',
  }),
  routeTransitionSnapshot,
);
const routeNextDocumentHtml = `<html><head><title>Next Route</title></head><body><div data-opencanvas-public-root>${routeNextHtml}</div></body></html>`;

function installRouteDocumentServices(
  doc: StubDocument,
  options: {
    nextHtml: string;
    hydrateThrows?: boolean;
  },
): { fetchUrls: string[]; pushedUrls: string[]; scrollCalls: Array<[number, number]> } {
  const fetchUrls: string[] = [];
  const pushedUrls: string[] = [];
  const scrollCalls: Array<[number, number]> = [];
  const location = {
    href: 'https://route.example/current',
    origin: 'https://route.example',
    protocol: 'https:',
    host: 'route.example',
    pathname: '/current',
    search: '',
    hash: '',
  };
  const assignLocation = (href: string): void => {
    const url = new URL(href, location.href);
    location.href = url.href;
    location.origin = url.origin;
    location.protocol = url.protocol;
    location.host = url.host;
    location.pathname = url.pathname;
    location.search = url.search;
    location.hash = url.hash;
  };
  doc.defaultView.location = location;
  doc.defaultView.history = {
    pushState(_state: unknown, _title: string, href: string) {
      pushedUrls.push(href);
      assignLocation(href);
    },
  };
  doc.defaultView.scrollTo = (x: number, y: number) => {
    scrollCalls.push([x, y]);
  };
  doc.defaultView.fetch = (href: string) => {
    fetchUrls.push(href);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(options.nextHtml),
    });
  };
  doc.defaultView.DOMParser = class StubDOMParser {
    parseFromString(html: string): {
      title: string;
      querySelector(selector: string): StubElement | null;
    } {
      const parsed = parseHtml(html);
      const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
      return {
        title: titleMatch?.[1] ?? '',
        querySelector(selector: string) {
          return parsed.querySelector(selector);
        },
      };
    }
  };
  if (options.hydrateThrows === true) {
    doc.defaultView.__opencanvasHydrate = () => {
      throw new Error('route hydrate failed');
    };
  }
  return { fetchUrls, pushedUrls, scrollCalls };
}

const routeDoc = new StubDocument();
routeDoc.title = 'Current Route';
const routeParsed = parseHtml(
  `<div data-opencanvas-public-root>${routeCurrentHtml}</div>`,
);
for (const child of routeParsed.children) routeDoc.root.appendChild(child);
const routeServices = installRouteDocumentServices(routeDoc, { nextHtml: routeNextDocumentHtml });
const routePublicRoot = routeDoc.querySelector('[data-opencanvas-public-root]') as StubElement;
const routeLink = routeDoc.querySelector('[href="/next"]') as StubElement;
const routeCurrentTitle = routeDoc.querySelector(
  '[data-opencanvas-element="route-current-title"]',
) as StubElement;
let routeReadyEvents = 0;
let routeReadyDetail: { id?: string; url?: string } | undefined;
routeDoc.addEventListener('opencanvas:route-transition-ready', (event) => {
  routeReadyEvents++;
  routeReadyDetail = event.detail as typeof routeReadyDetail;
});
assert(routePublicRoot !== null, 'route public root must exist');
assert(routeLink !== null, 'route same-site link must exist');
assert(routeCurrentTitle !== null, 'route current motion target must exist');
runRuntimeAgainstDocument(routeDoc);
const routeClick = makeEvent('click', { button: 0 });
routeLink.dispatchEvent(routeClick);
await flushMicrotasks(10);
const routeNextTitle = routeDoc.querySelector(
  '[data-opencanvas-element="route-next-title"]',
) as StubElement;
assert(routeClick.defaultPrevented, 'route transition should intercept same-site link click');
assert(routeServices.fetchUrls[0] === 'https://route.example/next', 'route transition should fetch the same-site target document');
assert(routeCurrentTitle.animations.length > 0, 'route transition should play outgoing sequence');
assert(routeNextTitle !== null, 'route transition should swap in the next public root HTML');
assert(routeNextTitle.animations.length > 0, 'route transition should play incoming sequence after hydrate');
assert(routeNextTitle.focused, 'route transition should focus the configured element target');
assert(routeDoc.title === 'Next Route', 'route transition should update document title from fetched HTML');
assert(
  routeServices.pushedUrls[0] === 'https://route.example/next',
  'route transition should push history after successful hydrate',
);
assert(
  routeServices.scrollCalls.length === 1 &&
    routeServices.scrollCalls[0]?.[0] === 0 &&
    routeServices.scrollCalls[0]?.[1] === 0,
  'route transition should scroll to top after successful hydrate',
);
assert(routeReadyEvents === 1, 'route transition should emit one ready event');
assert(routeReadyDetail?.id === 'route-swap', 'route ready event should include transition id');
assert(
  routeReadyDetail?.url === 'https://route.example/next',
  'route ready event should include resolved target URL',
);

const routeHydrateFailureDoc = new StubDocument();
routeHydrateFailureDoc.title = 'Current Route';
const routeHydrateFailureParsed = parseHtml(
  `<div data-opencanvas-public-root>${routeCurrentHtml}</div>`,
);
for (const child of routeHydrateFailureParsed.children)
  routeHydrateFailureDoc.root.appendChild(child);
const routeHydrateFailureServices = installRouteDocumentServices(routeHydrateFailureDoc, {
  nextHtml: routeNextDocumentHtml,
  hydrateThrows: true,
});
const routeHydrateFailureLink = routeHydrateFailureDoc.querySelector('[href="/next"]') as StubElement;
let routeFailureEvents = 0;
let routeFailureDetail: { id?: string; phase?: string; url?: string; error?: string } | undefined;
routeHydrateFailureDoc.addEventListener('opencanvas:route-transition-failure', (event) => {
  routeFailureEvents++;
  routeFailureDetail = event.detail as typeof routeFailureDetail;
});
runRuntimeAgainstDocument(routeHydrateFailureDoc);
routeHydrateFailureDoc.defaultView.__opencanvasHydrate = () => {
  throw new Error('route hydrate failed');
};
const routeHydrateFailureClick = makeEvent('click', { button: 0 });
routeHydrateFailureLink.dispatchEvent(routeHydrateFailureClick);
await flushMicrotasks(10);
assert(
  routeHydrateFailureClick.defaultPrevented,
  'route transition should intercept same-site link before hydrate failure',
);
assert(
  routeHydrateFailureDoc.querySelector('[data-opencanvas-element="route-current-title"]') !== null,
  'route hydrate failure should restore the current page DOM',
);
assert(
  routeHydrateFailureDoc.querySelector('[data-opencanvas-element="route-next-title"]') === null,
  'route hydrate failure must not leave swapped next-page DOM active',
);
assert(
  routeHydrateFailureServices.pushedUrls.length === 0,
  'route hydrate failure must not push history',
);
assert(routeFailureEvents === 1, 'route hydrate failure should emit one failure event');
assert(routeFailureDetail?.phase === 'hydrate', 'route failure detail should name hydrate phase');
assert(
  routeFailureDetail?.id === 'route-swap',
  'route failure detail should include transition id',
);

// ---------------------------------------------------------------------------
// All assertions passed.
// ---------------------------------------------------------------------------

console.log(`[interactive:smoke] OK — runtime size ${String(INTERACTIVE_RUNTIME_SRC_CHARS)} chars`);
