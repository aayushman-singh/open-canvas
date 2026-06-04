// src/editor-client/create-editor-runtime.smoke.ts
//
// ADR 0015 Phase 3.1 — RUNTIME smoke for the createEditor boot path.
//
// The existing create-editor:smoke is type-only — it reads index.ts as
// text and grep-asserts that no `stub('X')` strings remain. It never
// invokes createEditor. Phase 3 (1236e28) made createEditor the
// production entrypoint; Phase 3.1 (this commit's parent) wired up the
// real impls. This smoke closes the loop: it installs a minimal DOM
// stub on globalThis, mocks `fetch` against a valid editableState
// payload, invokes createEditor(boot), and asserts the boot async block
// resolves without throwing.
//
// Why we don't use happy-dom: the project ships no DOM library
// dependency. A hand-rolled stub here covers exactly the surface
// createEditor reaches at boot — getElementById, createElement, the
// `setAttribute` / `appendChild` / `addEventListener` mutators on
// returned elements, document.body, window listeners, and fetch. New
// DOM surface in createEditor surfaces here as a TypeError rather than
// silently passing.

declare const process: {
  on(event: 'unhandledRejection', handler: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', handler: (reason: unknown) => void): void;
  exit(code?: number): never;
};

export {};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[create-editor-runtime:smoke] ${message}`);
}

// ---- Minimal DOM stub --------------------------------------------------

interface StubElement {
  tagName: string;
  id: string;
  className: string;
  hidden: boolean;
  textContent: string | null;
  innerHTML: string;
  value: string;
  src: string;
  alt: string;
  title: string;
  href: string;
  type: string;
  disabled: boolean;
  parentNode: StubElement | null;
  children: StubElement[];
  childNodes: StubElement[];
  style: Record<string, string>;
  classList: {
    add(...names: string[]): void;
    remove(...names: string[]): void;
    toggle(name: string, force?: boolean): boolean;
    contains(name: string): boolean;
  };
  dataset: Record<string, string>;
  attributes: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  hasAttribute(name: string): boolean;
  appendChild(child: StubElement): StubElement;
  insertBefore(newNode: StubElement, refNode: StubElement | null): StubElement;
  removeChild(child: StubElement): StubElement;
  replaceChildren(...newChildren: StubElement[]): void;
  remove(): void;
  contains(node: StubElement): boolean;
  closest(selector: string): StubElement | null;
  querySelector(selector: string): StubElement | null;
  querySelectorAll(selector: string): StubElement[];
  getElementsByTagName(tag: string): StubElement[];
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number };
  getClientRects(): { top: number; left: number; right: number; bottom: number; width: number; height: number }[];
  addEventListener(type: string, handler: unknown, opts?: unknown): void;
  removeEventListener(type: string, handler: unknown): void;
  dispatchEvent(ev: unknown): boolean;
  focus(opts?: { preventScroll?: boolean }): void;
  click(): void;
  getContext(_kind: string): unknown;
  scrollTop: number;
  scrollHeight: number;
  offsetWidth: number;
  offsetHeight: number;
  clientWidth: number;
  clientHeight: number;
  nodeType: number;
}

const classNames: WeakMap<StubElement, Set<string>> = new WeakMap();

function ensureClassSet(el: StubElement): Set<string> {
  let set = classNames.get(el);
  if (!set) {
    set = new Set(el.className ? el.className.split(/\s+/).filter(Boolean) : []);
    classNames.set(el, set);
  }
  return set;
}

function syncClassName(el: StubElement): void {
  const set = ensureClassSet(el);
  Object.defineProperty(el, 'className', {
    get: () => Array.from(set).join(' '),
    set: (value: string) => {
      const next = new Set((value || '').split(/\s+/).filter(Boolean));
      classNames.set(el, next);
    },
    configurable: true,
  });
}

function makeElement(tagName: string): StubElement {
  const el: StubElement = {
    tagName: tagName.toUpperCase(),
    id: '',
    className: '',
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    src: '',
    alt: '',
    title: '',
    href: '',
    type: '',
    disabled: false,
    parentNode: null,
    children: [],
    childNodes: [],
    style: {},
    dataset: {},
    attributes: new Map<string, string>(),
    nodeType: 1,
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 1000,
    offsetHeight: 800,
    clientWidth: 1000,
    clientHeight: 800,
    classList: undefined as unknown as StubElement['classList'],
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
      if (name === 'class') this.className = value;
      if (name === 'id') this.id = value;
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
        this.dataset[key] = value;
      }
    },
    getAttribute(name: string): string | null {
      if (this.attributes.has(name)) return this.attributes.get(name)!;
      if (name === 'class') return this.className || null;
      if (name === 'id') return this.id || null;
      if (name === 'contenteditable') return null;
      return null;
    },
    removeAttribute(name: string): void {
      this.attributes.delete(name);
    },
    hasAttribute(name: string): boolean {
      return this.attributes.has(name);
    },
    appendChild(child: StubElement): StubElement {
      this.children.push(child);
      this.childNodes.push(child);
      child.parentNode = this;
      return child;
    },
    insertBefore(newNode: StubElement, refNode: StubElement | null): StubElement {
      if (!refNode) {
        return this.appendChild(newNode);
      }
      const idx = this.children.indexOf(refNode);
      if (idx < 0) return this.appendChild(newNode);
      this.children.splice(idx, 0, newNode);
      this.childNodes.splice(idx, 0, newNode);
      newNode.parentNode = this;
      return newNode;
    },
    removeChild(child: StubElement): StubElement {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        this.childNodes.splice(idx, 1);
      }
      child.parentNode = null;
      return child;
    },
    replaceChildren(...newChildren: StubElement[]): void {
      for (const c of this.children) c.parentNode = null;
      this.children = [...newChildren];
      this.childNodes = [...newChildren];
      for (const c of newChildren) c.parentNode = this;
    },
    remove(): void {
      if (this.parentNode) {
        const p = this.parentNode;
        const idx = p.children.indexOf(this);
        if (idx >= 0) {
          p.children.splice(idx, 1);
          p.childNodes.splice(idx, 1);
        }
        this.parentNode = null;
      }
    },
    contains(node: StubElement): boolean {
      if (node === this) return true;
      for (const c of this.children) {
        if (c.contains(node)) return true;
      }
      return false;
    },
    closest(_selector: string): StubElement | null {
      return null;
    },
    querySelector(_selector: string): StubElement | null {
      return null;
    },
    querySelectorAll(_selector: string): StubElement[] {
      return [];
    },
    getElementsByTagName(_tag: string): StubElement[] {
      return [];
    },
    getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
      return { top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
    },
    getClientRects(): { top: number; left: number; right: number; bottom: number; width: number; height: number }[] {
      return [{ top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800 }];
    },
    addEventListener(_type: string, _handler: unknown, _opts?: unknown): void {
      // no-op — the smoke only verifies boot completion, not listener firing
    },
    removeEventListener(_type: string, _handler: unknown): void {
      // no-op
    },
    dispatchEvent(_ev: unknown): boolean {
      return true;
    },
    focus(_opts?: { preventScroll?: boolean }): void {
      // no-op
    },
    click(): void {
      // no-op
    },
    getContext(_kind: string): unknown {
      // Used by media-asset-ops's video-poster extraction path, but the
      // boot smoke never reaches that code path (no upload triggered).
      return null;
    },
  };
  el.classList = {
    add(...names: string[]): void {
      const set = ensureClassSet(el);
      for (const n of names) set.add(n);
    },
    remove(...names: string[]): void {
      const set = ensureClassSet(el);
      for (const n of names) set.delete(n);
    },
    toggle(name: string, force?: boolean): boolean {
      const set = ensureClassSet(el);
      const has = set.has(name);
      if (force === true || (force === undefined && !has)) {
        set.add(name);
        return true;
      }
      if (force === false || (force === undefined && has)) {
        set.delete(name);
        return false;
      }
      return has;
    },
    contains(name: string): boolean {
      return ensureClassSet(el).has(name);
    },
  };
  syncClassName(el);
  return el;
}

// Map of id → element for getElementById lookups. The smoke pre-creates
// the editor route's static DOM IDs so createEditor's caching phase
// returns live stubs rather than nulls (which would skip downstream
// wiring entirely and mask the very bugs we want to catch).
const elementsById = new Map<string, StubElement>();

const STATIC_IDS = [
  'canvas-root',
  'canvas-inspector',
  'canvas-status',
  'canvas-sidebar',
  'canvas-save',
  'canvas-publish',
  'canvas-version',
  'canvas-save-template',
  'canvas-chat-toggle',
  'canvas-chat-panel',
  'canvas-chat-close',
  'canvas-chat-selection',
  'canvas-chat-selection-text',
  'canvas-chat-selection-clear',
  'canvas-add-page',
  'canvas-page-list',
  'sidebar-toggle',
  'inspector-toggle',
  'canvas-chat-input',
  'canvas-chat-form',
  'canvas-chat-messages',
  'canvas-chat-welcome',
];

const bodyEl = makeElement('body');
const mainEl = makeElement('main');
mainEl.className = 'opencanvas-editor';
bodyEl.appendChild(mainEl);

for (const id of STATIC_IDS) {
  const el = makeElement('div');
  el.id = id;
  elementsById.set(id, el);
  bodyEl.appendChild(el);
}

// canvas-publish must be a button-like with a `disabled` setter — the
// publish module reads ctx.publishButton as HTMLButtonElement | null.
const publishBtn = elementsById.get('canvas-publish');
if (publishBtn) publishBtn.tagName = 'BUTTON';

// canvas-root needs a parent for mountViewport's parent.insertBefore /
// appendChild dance.
const root = elementsById.get('canvas-root');
if (root) {
  // root.parentNode is already bodyEl from appendChild above.
  assert(root.parentNode === bodyEl, 'canvas-root must have body as parent');
}

const stubDocument = {
  body: bodyEl,
  documentElement: bodyEl,
  compatMode: 'CSS1Compat',
  defaultView: undefined as unknown as Window,
  getElementById(id: string): StubElement | null {
    return elementsById.get(id) || null;
  },
  createElement(tag: string): StubElement {
    return makeElement(tag);
  },
  createTextNode(text: string): StubElement {
    const node = makeElement('#text');
    node.textContent = text;
    node.nodeType = 3;
    return node;
  },
  createDocumentFragment(): StubElement {
    return makeElement('#fragment');
  },
  querySelector(selector: string): StubElement | null {
    if (selector === 'main.opencanvas-editor') return mainEl;
    return null;
  },
  querySelectorAll(_selector: string): StubElement[] {
    return [];
  },
  addEventListener(_type: string, _handler: unknown, _opts?: unknown): void {
    // no-op
  },
  removeEventListener(_type: string, _handler: unknown): void {
    // no-op
  },
  contains(node: StubElement): boolean {
    return bodyEl.contains(node);
  },
};

const stubWindow = {
  document: stubDocument,
  location: { href: 'https://test.local/edit', host: 'test.local', hostname: 'test.local' },
  navigator: { userAgent: 'smoke', clipboard: { writeText: () => Promise.resolve() } },
  innerWidth: 1280,
  innerHeight: 800,
  scrollX: 0,
  scrollY: 0,
  pageXOffset: 0,
  pageYOffset: 0,
  localStorage: {
    getItem(_k: string): string | null { return null; },
    setItem(_k: string, _v: string): void { /* no-op */ },
    removeItem(_k: string): void { /* no-op */ },
  },
  __opencanvasEditorBoot: undefined as unknown,
  __opencanvasCoEdit: undefined as unknown,
  katex: undefined as unknown,
  fetch(_input: unknown, _init?: unknown): Promise<Response> {
    return Promise.resolve(new Response(
      JSON.stringify({
        editableState: {
          styleKit: 'charcoal',
          pages: [
            {
              id: 'page-1',
              slug: 'home',
              title: 'Home',
              width: 1440,
              sections: [],
            },
          ],
        },
        publishedVersion: 0,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
  },
  addEventListener(_type: string, _handler: unknown, _opts?: unknown): void { /* no-op */ },
  removeEventListener(_type: string, _handler: unknown): void { /* no-op */ },
  setTimeout(cb: () => void, ms?: number): ReturnType<typeof setTimeout> {
    return globalThis.setTimeout(cb, ms);
  },
  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    globalThis.clearTimeout(handle);
  },
  setInterval(cb: () => void, ms?: number): ReturnType<typeof setInterval> {
    return globalThis.setInterval(cb, ms);
  },
  clearInterval(handle: ReturnType<typeof setInterval>): void {
    globalThis.clearInterval(handle);
  },
  requestAnimationFrame(cb: () => void): number {
    return globalThis.setTimeout(cb, 0);
  },
  cancelAnimationFrame(id: number): void {
    globalThis.clearTimeout(id);
  },
  getSelection: () => null,
  getComputedStyle: (_el: unknown) => ({ getPropertyValue: () => '' }) as unknown as CSSStyleDeclaration,
  alert: (_msg: string) => { /* no-op */ },
  confirm: (_msg: string) => false,
  prompt: (_msg: string) => null,
};

stubDocument.defaultView = stubWindow as unknown as Window;

// ---- Install on globalThis ---------------------------------------------
//
// EditorContext code paths reach for `document.X`, `window.X`, `fetch`,
// `setTimeout`. Install the stubs as globals so the imports that follow
// see them. ESM hoists the import binding before this assignment runs,
// so we MUST set globals BEFORE the dynamic import below.

const g = globalThis as unknown as Record<string, unknown>;
g.document = stubDocument;
g.fetch = (input: unknown, init?: unknown) => stubWindow.fetch(input, init);
g.localStorage = stubWindow.localStorage;
g.HTMLElement = class HTMLElement {};
g.Element = class Element {};
g.Node = class Node {};
g.Event = class Event { constructor(public type: string) {} };

// ---- Dynamic import (after globals installed) -------------------------

const { createEditor } = await import('./index.js');
g.window = stubWindow;

// ---- Configure boot + invoke createEditor -----------------------------

const boot = {
  siteId: 'site-runtime-smoke',
  apiBase: '/api',
  wsToken: '',
  displayName: 'Smoke',
  userId: 'user-runtime-smoke',
};
stubWindow.__opencanvasEditorBoot = boot;

// Capture any throw from createEditor's synchronous skeleton + boot
// async block. The boot block is an `void (async () => { ... })()` so
// throws inside reach window.onerror / unhandledrejection rather than
// surfacing here directly — we listen on process.on('unhandledRejection')
// to catch them.

const unhandled: unknown[] = [];
function onUnhandled(reason: unknown): void {
  unhandled.push(reason);
}
process.on('unhandledRejection', onUnhandled);

// Track every setStatus(text, tone) call by intercepting appendChild on
// #canvas-status. setStatus clears textContent then appendChild's a
// fresh text node carrying the new status string (after an optional
// spinner span for trailing tones. A successful boot ends with 'Ready';
// anything else means the boot block did not complete its happy path.
const statusEl = elementsById.get('canvas-status')!;
const statusWrites: string[] = [];
const originalAppend = statusEl.appendChild.bind(statusEl);
statusEl.appendChild = (child: StubElement): StubElement => {
  if (child.nodeType === 3 && child.textContent) {
    statusWrites.push(child.textContent);
  }
  return originalAppend(child);
};

try {
  createEditor(boot);
} catch (err: unknown) {
  throw new Error(
    `createEditor threw synchronously: ${err instanceof Error ? err.message : String(err)}`,
  );
}

// Let the boot async block resolve. The async IIFE awaits authFetch,
// then runs through ~12 follow-on calls (renderAll, attachRootEvents,
// ensureVersionsTabMounted, etc.). 200ms is generous — the mock fetch
// resolves microtask-fast and there are no genuine timers in the path.
await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200));

process.off('unhandledRejection', onUnhandled);

if (unhandled.length > 0) {
  const summary = unhandled
    .map((r) => (r instanceof Error ? r.stack || r.message : String(r)))
    .join('\n---\n');
  throw new Error(
    `createEditor boot block produced ${String(unhandled.length)} unhandled rejection(s):\n${summary}`,
  );
}

// Hard assertion: at least one setStatus call must have landed on the
// status element. setStatus is the load-bearing surface that broke in
// the 1236e28 cutover (the boot block called stub('setStatus')
// unconditionally on success AND failure paths). If statusWrites is
// empty, either setStatus is silently no-oping OR the boot async block
// never ran AND never threw — both regressions worth catching.
assert(
  statusWrites.length > 0,
  'createEditor boot must write at least one status line — none observed',
);

const lastStatus = statusWrites[statusWrites.length - 1] ?? '';
assert(
  lastStatus === 'Ready',
  `createEditor boot final status was unexpected: ${JSON.stringify(lastStatus)} ` +
    `(full sequence: ${JSON.stringify(statusWrites)})`,
);

// Smoke verifies a few invariants that PROVE installRuntimeHelpers ran:
//   - ctx.setStatus must no longer be the runtimeHelperNotInstalled
//     thrower; calling it must not throw.
// We can't reach ctx directly from outside (createEditor doesn't return
// it), so we re-verify the source-level contract: the bundle must
// contain installRuntimeHelpers(ctx) immediately after the skeleton
// returns, and the boot path must call mountViewportImpl before
// renderAll. The existing create-editor:smoke covers the source-level
// invariants; this smoke covers that calling createEditor against a
// minimal DOM completes the boot async block without throwing.

// ---- Second boot pass: failure path -----------------------------------
//
// Exercise the catch branch of the boot async block. Before 3.1, the
// catch branch's `ctx.setStatus('Failed to load site: ' + ..., 'error')`
// call threw on the setStatus stub. Re-running createEditor with a
// fetch that returns a 500 must surface a 'Failed to load site...'
// status without throwing the smoke.

// Reset the status capture for the second pass.
const statusWritesFailure: string[] = [];
statusEl.appendChild = (child: StubElement): StubElement => {
  if (child.nodeType === 3 && child.textContent) {
    statusWritesFailure.push(child.textContent);
  }
  return originalAppend(child);
};

// Swap fetch to a 500 response so the boot's `if (!response.ok)`
// branch fires with the 'Failed to load site' status writer (the inline
// IIFE's most common boot-failure surface).
stubWindow.fetch = (_input: unknown, _init?: unknown): Promise<Response> =>
  Promise.resolve(new Response('{"error":"boom"}', {
    status: 500,
    headers: { 'content-type': 'application/json' },
  }));
g.fetch = (input: unknown, init?: unknown) => stubWindow.fetch(input, init);

const unhandledFailure: unknown[] = [];
function onUnhandledFailure(reason: unknown): void {
  unhandledFailure.push(reason);
}
process.on('unhandledRejection', onUnhandledFailure);

try {
  createEditor(boot);
} catch (err: unknown) {
  throw new Error(
    `createEditor (failure-path) threw synchronously: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}
await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 200));
process.off('unhandledRejection', onUnhandledFailure);

if (unhandledFailure.length > 0) {
  const summary = unhandledFailure
    .map((r) => (r instanceof Error ? r.stack || r.message : String(r)))
    .join('\n---\n');
  throw new Error(
    `createEditor (failure-path) produced ${String(unhandledFailure.length)} unhandled rejection(s):\n${summary}`,
  );
}

const failureLast = statusWritesFailure[statusWritesFailure.length - 1] ?? '';
assert(
  failureLast.startsWith('Failed to load site'),
  `failure-path final status was unexpected: ${JSON.stringify(failureLast)} ` +
    `(full sequence: ${JSON.stringify(statusWritesFailure)})`,
);

console.log(
  '[create-editor-runtime:smoke] OK — happy:',
  JSON.stringify(statusWrites),
  '/ failure:',
  JSON.stringify(statusWritesFailure),
);
// createEditor's boot installs a session-keepalive setInterval and the
// boot block schedules a token-refresh setTimeout chain. Neither is a
// failure path — both are intentional production behaviours. Exit
// explicitly so Bun's event loop doesn't keep the process alive on
// those handles forever.
process.exit(0);
