import assert from 'node:assert/strict';
import type { PublishedSnapshot } from '../canvas/schema.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { ROUTE_TRANSITION_RUNTIME_SRC } from './route-transition.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

const snapshot: PublishedSnapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-17T00:00:00.000Z',
  pages: [{ id: 'home', slug: 'home', title: 'Home', width: 1200, sections: [] }],
  routeTransition: {
    id: 'route-main',
    enabled: true,
    mode: 'wipe',
    durationMs: 240,
    easing: 'ease-in-out',
    sharedElements: [
      {
        id: 'route-shared-hero',
        sourceElementId: 'home-card',
        targetElementId: 'detail-hero',
        viewTransitionName: 'heroMorph',
      },
    ],
  },
};

const html = renderCanvasSnapshot(snapshot, '/assets', 'site-1', { turnstileSiteKey: 'test-key' });
assert.ok(html.includes('data-opencanvas-route-container'));
assert.ok(html.includes('data-opencanvas-route-transition="route-main"'));
assert.ok(html.includes('data-opencanvas-route-mode="wipe"'));
assert.ok(html.includes('data-opencanvas-route-shared-elements='));
assert.ok(html.includes('heroMorph'));
assert.equal(snapshotNeedsInteractiveRuntime(snapshot), true);
const runtime = injectInteractiveRuntime(html, snapshot);
assert.ok(runtime.includes('hydrateRouteTransition'));
assert.ok(runtime.includes('opencanvas:route-transition-failed'));
assert.ok(runtime.includes("swapTo(new URL(window.location.href), 'replace')"));
assert.ok(runtime.includes('document.startViewTransition'));
assert.ok(runtime.includes('shared-elements-api'));
assert.ok(runtime.includes('shared-elements-resolve'));
assert.ok(runtime.includes('data-opencanvas-route-shared-elements'));

interface StubEvent {
  type: string;
  detail?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  target: StubElement | StubDocument | null;
  currentTarget: StubElement | StubDocument | null;
}

type Listener = (event: StubEvent) => void;

const ROUTE_ATTRS = [
  'data-opencanvas-route-transition',
  'data-opencanvas-route-mode',
  'data-opencanvas-route-duration-ms',
  'data-opencanvas-route-easing',
  'data-opencanvas-route-outgoing-sequence',
  'data-opencanvas-route-incoming-sequence',
] as const;

class StubStyle {
  opacity = '';
  transform = '';
  transition = '';
}

class StubElement {
  tagName: string;
  className = '';
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  style = new StubStyle();
  isConnected = true;
  private html = '';

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get innerHTML(): string {
    return this.html;
  }

  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  appendChild(child: StubElement): void {
    child.parent = this;
    this.children.push(child);
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.setAttribute('data-focused', 'true');
  }

  matchesSelector(selector: string): boolean {
    const trimmed = selector.trim();
    const tagAttrMatch = /^([a-zA-Z0-9-]+)\[([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?\]$/.exec(
      trimmed,
    );
    if (tagAttrMatch) {
      const tagName = tagAttrMatch[1];
      const attrName = tagAttrMatch[2];
      if (tagName === undefined || attrName === undefined) return false;
      if (this.tagName !== tagName.toLowerCase()) return false;
      if (!this.attributes.has(attrName)) return false;
      const expected = tagAttrMatch[3] ?? tagAttrMatch[4] ?? null;
      if (expected === null) return true;
      return this.attributes.get(attrName) === expected;
    }
    const attrMatch = /^\[([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?\]$/.exec(trimmed);
    if (!attrMatch) return false;
    const attrName = attrMatch[1];
    if (attrName === undefined || !this.attributes.has(attrName)) return false;
    const expected = attrMatch[2] ?? attrMatch[3] ?? null;
    if (expected === null) return true;
    return this.attributes.get(attrName) === expected;
  }

  querySelector(selector: string): StubElement | null {
    if (this.matchesSelector(selector)) return this;
    for (const child of this.children) {
      const found = child.querySelector(selector);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const walk = (node: StubElement): void => {
      if (node.matchesSelector(selector)) out.push(node);
      for (const child of node.children) walk(child);
    };
    walk(this);
    return out;
  }

  closest(selector: string): StubElement | null {
    if (this.matchesSelector(selector)) return this;
    let node = this.parent;
    while (node) {
      if (node.matchesSelector(selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

class StubDocument {
  body = new StubElement('body');
  listeners = new Map<string, Listener[]>();
  routeFailureEvents: Array<{ type: string; detail?: unknown }> = [];

  constructor() {
    this.body.appendChild(new StubElement('html'));
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  querySelector(selector: string): StubElement | null {
    return this.body.querySelector(selector);
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.body.querySelectorAll(selector);
  }

  dispatchClick(target: StubElement): void {
    const event: StubEvent = {
      type: 'click',
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target,
      currentTarget: null,
    };
    const listeners = this.listeners.get('click') ?? [];
    for (const fn of listeners) {
      event.currentTarget = this;
      fn(event);
    }
  }
}

class StubHistory {
  pushStateCalls = 0;
  replaceStateCalls = 0;

  pushState(): void {
    this.pushStateCalls += 1;
  }

  replaceState(): void {
    this.replaceStateCalls += 1;
  }
}

class StubWindow {
  listeners = new Map<string, Listener[]>();
  history = new StubHistory();
  location = { href: 'http://localhost/home', origin: 'http://localhost' };
  scrollToCalls = 0;
  fetchCalls = 0;
  hydrateCalls = 0;
  hydrateShouldThrow = false;

  constructor() {
    this.__opencanvasHydrate = (scope: unknown, _options?: unknown) => {
      void scope;
      void _options;
      this.hydrateCalls += 1;
      if (this.hydrateShouldThrow) {
        const err = new Error('hydrate boom') as Error & { phase?: string };
        err.phase = 'hydrate';
        throw err;
      }
    };
  }

  __opencanvasHydrate: (scope: unknown, options?: unknown) => void;

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  dispatchEvent(event: { type: string; detail?: unknown }): void {
    const listeners = this.listeners.get(event.type) ?? [];
    const wrapped: StubEvent = {
      type: event.type,
      detail: event.detail,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      target: null,
      currentTarget: null,
    };
    for (const fn of listeners) fn(wrapped);
  }

  setTimeout(fn: () => void): number {
    fn();
    return 1;
  }

  scrollTo(): void {
    this.scrollToCalls += 1;
  }

  fetch(): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
    this.fetchCalls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(nextPageHtml),
    });
  }
}

function parseRouteContainerFromHtml(markup: string): StubElement | null {
  const openMatch = /<main\b([^>]*)>([\s\S]*)<\/main>/i.exec(markup);
  if (!openMatch) return null;
  const attrPart = openMatch[1] ?? '';
  const inner = openMatch[2] ?? '';
  const container = new StubElement('main');
  container.innerHTML = inner.trim();
  const attrRegex = /([a-zA-Z0-9:-]+)(?:="([^"]*)")?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrPart)) !== null) {
    const name = match[1];
    const value = match[2] ?? '';
    if (name) container.setAttribute(name, value);
  }
  return container;
}

class StubDOMParser {
  parseFromString(markup: string): { querySelector(selector: string): StubElement | null } {
    return {
      querySelector: (selector: string) => {
        if (selector !== '[data-opencanvas-route-container]') return null;
        const container = parseRouteContainerFromHtml(markup);
        if (!container || !container.hasAttribute('data-opencanvas-route-container')) return null;
        return container;
      },
    };
  }
}

const nextPageHtml = `<!DOCTYPE html><html><body><main data-opencanvas-route-container data-opencanvas-route-transition="route-next" data-opencanvas-route-mode="fade" data-opencanvas-route-duration-ms="120" data-opencanvas-route-easing="ease"><div id="next-page">Next Page</div></main></body></html>`;

function runRouteTransition(
  doc: StubDocument,
  win: StubWindow,
  runMotionSequenceLite?: (root: unknown, sequenceId: string) => void,
): void {
  const CustomEventCtor = function CustomEvent(
    this: { type: string; detail?: unknown },
    type: string,
    init?: { detail?: unknown },
  ) {
    this.type = type;
    this.detail = init?.detail;
  } as unknown as new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown };

  const consoleRef = { error() {} };

  win.addEventListener('opencanvas:route-transition-failed', (event) => {
    doc.routeFailureEvents.push({ type: event.type, detail: event.detail });
  });

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- must execute visitor route runtime source verbatim.
  const fn = new Function(
    'document',
    'window',
    'fetch',
    'DOMParser',
    'history',
    'URL',
    'CustomEvent',
    'console',
    'runMotionSequenceLite',
    `${ROUTE_TRANSITION_RUNTIME_SRC}\nhydrateRouteTransition(document);`,
  ) as (
    d: StubDocument,
    w: StubWindow,
    f: StubWindow['fetch'],
    p: typeof StubDOMParser,
    h: StubHistory,
    u: typeof URL,
    c: new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown },
    con: { error: () => void },
    motionLite: ((root: unknown, sequenceId: string) => void) | undefined,
  ) => void;

  fn(
    doc,
    win,
    win.fetch.bind(win),
    StubDOMParser,
    win.history,
    URL,
    CustomEventCtor,
    consoleRef,
    runMotionSequenceLite,
  );
}

function makeContainer(): StubElement {
  const container = new StubElement('main');
  container.setAttribute('data-opencanvas-route-container', '');
  container.setAttribute('data-opencanvas-route-transition', 'route-main');
  container.setAttribute('data-opencanvas-route-mode', 'wipe');
  container.setAttribute('data-opencanvas-route-duration-ms', '0');
  container.setAttribute('data-opencanvas-route-easing', 'ease-in-out');
  container.innerHTML = '<div id="current-page">Current Page</div>';
  return container;
}

function snapshotRouteAttrs(container: StubElement): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of ROUTE_ATTRS) {
    out[name] = container.getAttribute(name);
  }
  return out;
}

async function flushRouteTransition(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function testHydrationFailureRestoresCurrentPage(): Promise<void> {
  const doc = new StubDocument();
  const win = new StubWindow();
  const container = makeContainer();
  const beforeHtml = container.innerHTML;
  const beforeAttrs = snapshotRouteAttrs(container);
  doc.body.appendChild(container);

  const link = new StubElement('a');
  link.setAttribute('href', '/about');
  container.appendChild(link);

  runRouteTransition(doc, win);
  win.hydrateShouldThrow = true;

  doc.dispatchClick(link);
  await flushRouteTransition();

  assert.equal(container.innerHTML, beforeHtml, 'hydration failure must restore container HTML');
  assert.deepEqual(snapshotRouteAttrs(container), beforeAttrs, 'hydration failure must restore route attrs');
  assert.equal(win.history.pushStateCalls, 0, 'hydration failure must not advance history');
  assert.equal(win.scrollToCalls, 0, 'hydration failure must not scroll');
  assert.equal(container.getAttribute('data-focused'), null, 'hydration failure must not focus container');
  assert.equal(win.hydrateCalls, 1, 'hydration must run once before failure handling');

  assert.equal(doc.routeFailureEvents.length, 1, 'hydration failure must emit one failure event');
  const failure = doc.routeFailureEvents[0]?.detail as {
    phase?: string;
    transitionId?: string;
    href?: string;
  };
  assert.equal(failure.phase, 'hydrate');
  assert.equal(failure.transitionId, 'route-main');
  assert.equal(failure.href, 'http://localhost/about');

  win.fetchCalls = 0;
  win.hydrateShouldThrow = false;
  doc.dispatchClick(link);
  await flushRouteTransition();
  assert.equal(win.fetchCalls, 1, 'busy must reset so a later navigation can run');
}

async function testFetchFailureUsesFetchPhase(): Promise<void> {
  const doc = new StubDocument();
  const win = new StubWindow();
  const container = makeContainer();
  doc.body.appendChild(container);
  const link = new StubElement('a');
  link.setAttribute('href', '/about');
  container.appendChild(link);

  const failingWin = win;
  failingWin.fetch = () => {
    failingWin.fetchCalls += 1;
    return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  };

  runRouteTransition(doc, failingWin);
  doc.dispatchClick(link);
  await flushRouteTransition();

  const failure = doc.routeFailureEvents[0]?.detail as { phase?: string };
  assert.equal(failure.phase, 'fetch');
}

async function testParseFailureUsesParsePhase(): Promise<void> {
  const doc = new StubDocument();
  const win = new StubWindow();
  const container = makeContainer();
  doc.body.appendChild(container);
  const link = new StubElement('a');
  link.setAttribute('href', '/about');
  container.appendChild(link);

  win.fetch = () => {
    win.fetchCalls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve('<html><body><main>no route container</main></body></html>'),
    });
  };

  runRouteTransition(doc, win);
  doc.dispatchClick(link);
  await flushRouteTransition();

  const failure = doc.routeFailureEvents[0]?.detail as { phase?: string };
  assert.equal(failure.phase, 'parse');
}

async function testOutgoingAnimationFailureEmitsAnimatePhase(): Promise<void> {
  const doc = new StubDocument();
  const win = new StubWindow();
  const container = makeContainer();
  container.setAttribute('data-opencanvas-route-outgoing-sequence', 'out-fade');
  const beforeHtml = container.innerHTML;
  const beforeAttrs = snapshotRouteAttrs(container);
  doc.body.appendChild(container);

  const link = new StubElement('a');
  link.setAttribute('href', '/about');
  container.appendChild(link);

  const motionCalls: Array<{ sequenceId: string }> = [];
  let outgoingMotionThrows = true;
  const runMotionSequenceLite = (_root: unknown, sequenceId: string): void => {
    motionCalls.push({ sequenceId });
    if (sequenceId === 'out-fade' && outgoingMotionThrows) {
      outgoingMotionThrows = false;
      throw new Error('outgoing motion boom');
    }
  };

  runRouteTransition(doc, win, runMotionSequenceLite);
  doc.dispatchClick(link);
  await flushRouteTransition();

  assert.equal(container.innerHTML, beforeHtml, 'animation failure must keep current page content');
  assert.deepEqual(snapshotRouteAttrs(container), beforeAttrs, 'animation failure must keep route attrs');
  assert.equal(container.getAttribute('data-opencanvas-route-state'), null, 'route state must be cleared');
  assert.equal(win.fetchCalls, 0, 'animation failure must not fetch next page');
  assert.equal(win.history.pushStateCalls, 0, 'animation failure must not advance history');
  assert.equal(motionCalls.length, 1, 'outgoing motion must run once before failure');

  assert.equal(doc.routeFailureEvents.length, 1, 'animation failure must emit one failure event');
  const failure = doc.routeFailureEvents[0]?.detail as {
    phase?: string;
    transitionId?: string;
    href?: string;
    error?: string;
  };
  assert.equal(failure.phase, 'animate');
  assert.equal(failure.transitionId, 'route-main');
  assert.equal(failure.href, 'http://localhost/about');
  assert.match(failure.error ?? '', /outgoing motion boom/);

  doc.dispatchClick(link);
  await flushRouteTransition();
  assert.equal(win.fetchCalls, 1, 'busy must reset so a later navigation can run');
}

async function testIncomingAnimationFailureRestoresCurrentPage(): Promise<void> {
  const doc = new StubDocument();
  const win = new StubWindow();
  const container = makeContainer();
  container.setAttribute('data-opencanvas-route-outgoing-sequence', 'out-fade');
  container.setAttribute('data-opencanvas-route-incoming-sequence', 'in-fade');
  const beforeHtml = container.innerHTML;
  const beforeAttrs = snapshotRouteAttrs(container);
  doc.body.appendChild(container);

  const link = new StubElement('a');
  link.setAttribute('href', '/about');
  container.appendChild(link);

  const nextWithIncomingSequence = `<!DOCTYPE html><html><body><main data-opencanvas-route-container data-opencanvas-route-transition="route-next" data-opencanvas-route-mode="fade" data-opencanvas-route-duration-ms="120" data-opencanvas-route-easing="ease" data-opencanvas-route-incoming-sequence="in-fade"><div id="next-page">Next Page</div></main></body></html>`;
  win.fetch = () => {
    win.fetchCalls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(nextWithIncomingSequence),
    });
  };

  const motionCalls: Array<{ sequenceId: string }> = [];
  let incomingMotionThrows = true;
  const runMotionSequenceLite = (_root: unknown, sequenceId: string): void => {
    motionCalls.push({ sequenceId });
    if (sequenceId === 'in-fade' && incomingMotionThrows) {
      incomingMotionThrows = false;
      throw new Error('incoming motion boom');
    }
  };

  runRouteTransition(doc, win, runMotionSequenceLite);
  doc.dispatchClick(link);
  await flushRouteTransition();

  assert.equal(container.innerHTML, beforeHtml, 'incoming animation failure must restore container HTML');
  assert.deepEqual(snapshotRouteAttrs(container), beforeAttrs, 'incoming animation failure must restore route attrs');
  assert.equal(container.getAttribute('data-opencanvas-route-state'), null, 'route state must be cleared');
  assert.equal(win.fetchCalls, 1, 'fetch must complete before incoming animation failure');
  assert.equal(win.hydrateCalls, 1, 'hydrate must complete before incoming animation failure');
  assert.equal(win.history.pushStateCalls, 0, 'incoming animation failure must not advance history');
  assert.equal(win.scrollToCalls, 0, 'incoming animation failure must not scroll');
  assert.equal(container.getAttribute('data-focused'), null, 'incoming animation failure must not focus container');
  assert.deepEqual(
    motionCalls.map((call) => call.sequenceId),
    ['out-fade', 'in-fade'],
    'outgoing and incoming motion must run in order before failure',
  );

  assert.equal(doc.routeFailureEvents.length, 1, 'incoming animation failure must emit one failure event');
  const failure = doc.routeFailureEvents[0]?.detail as {
    phase?: string;
    transitionId?: string;
    href?: string;
    error?: string;
  };
  assert.equal(failure.phase, 'animate');
  assert.equal(failure.transitionId, 'route-main');
  assert.equal(failure.href, 'http://localhost/about');
  assert.match(failure.error ?? '', /incoming motion boom/);

  doc.dispatchClick(link);
  await flushRouteTransition();
  assert.equal(win.fetchCalls, 2, 'busy must reset so a later navigation can run');
}

await testHydrationFailureRestoresCurrentPage();
await testFetchFailureUsesFetchPhase();
await testParseFailureUsesParsePhase();
await testOutgoingAnimationFailureEmitsAnimatePhase();
await testIncomingAnimationFailureRestoresCurrentPage();

console.log('[route-transition:smoke] OK');
