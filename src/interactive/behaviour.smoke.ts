// src/interactive/behaviour.smoke.ts
//
// `bun run behaviour-runtime:smoke` — verifies the behaviour runtime parses the
// authored payload, hydrates load experience chrome, text-split targets, scroll
// scenes, and image-sequence adapters, and fails loudly on contract breaks.

import type { PublishedSnapshot } from '../canvas/schema.js';
import { serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';
import { injectInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[behaviour-runtime:smoke] ${message}`);
}

interface StubEvent {
  type: string;
  detail?: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  target: StubElement | StubDocument | null;
  currentTarget: StubElement | StubDocument | null;
}

type Listener = (event: StubEvent) => void;

class StubStyle {
  private values = new Map<string, string>();
  opacity = '';
  transform = '';
  clipPath = '';
  filter = '';
  pointerEvents = '';
  position = '';
  top = '';
  left = '';
  width = '';
  zIndex = '';
  viewTransitionName = '';

  setProperty(key: string, value: string): void {
    this.values.set(key, value);
    if (key === 'opacity') this.opacity = value;
    if (key === 'transform') this.transform = value;
    if (key === 'clip-path') this.clipPath = value;
    if (key === 'filter') this.filter = value;
    if (key === 'pointer-events') this.pointerEvents = value;
  }
}

class StubElement {
  tagName: string;
  className = '';
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  textContent = '';
  hidden = false;
  style = new StubStyle();
  clientWidth = 320;
  clientHeight = 240;
  scrollHeight = 2400;
  scrollTop = 0;

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
    this.children.push(child);
  }
  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatchEvent(event: StubEvent): void {
    event.target = this;
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
  matchesSelector(selector: string): boolean {
    const trimmed = selector.trim();
    if (trimmed.startsWith('.')) {
      const className = trimmed.slice(1);
      return this.className.split(/\s+/).includes(className);
    }
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
    const match = /^\[([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?\]$/.exec(trimmed);
    if (!match) throw new Error(`[stub] unsupported selector "${selector}"`);
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
      if (node.matchesSelector(selector)) out.push(node);
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(this);
    return out;
  }
  querySelector(selector: string): StubElement | null {
    const all = this.querySelectorAll(selector);
    return all[0] ?? null;
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
  getBoundingClientRect(): { top: number; left: number; width: number; height: number } {
    return { top: 100, left: 0, width: 1200, height: 800 };
  }
  getComputedTextLength(): number {
    return 320;
  }
  animate(): { cancel: () => void } {
    return { cancel: () => undefined };
  }
  getContext(): { clearRect: () => void; drawImage: () => void } {
    return { clearRect: () => undefined, drawImage: () => undefined };
  }
}

class StubDocument {
  readyState: 'loading' | 'interactive' | 'complete' = 'complete';
  documentElement = new StubElement('html');
  root: StubElement;
  body: StubElement;
  domContentLoadedListeners: Listener[] = [];
  customEventListeners: Listener[] = [];
  viewTransitionCalls = 0;

  constructor() {
    this.root = this.documentElement;
    this.body = new StubElement('body');
    this.documentElement.appendChild(this.body);
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'DOMContentLoaded') {
      this.domContentLoadedListeners.push(listener);
      return;
    }
    if (type === 'opencanvas:behaviour-failure') {
      this.customEventListeners.push(listener);
      return;
    }
    throw new Error(`[stub] document.addEventListener type "${type}" not supported`);
  }
  querySelector(selector: string): StubElement | null {
    const fromBody = this.body.querySelector(selector);
    if (fromBody) return fromBody;
    if (this.documentElement.matchesSelector(selector)) return this.documentElement;
    return null;
  }
  querySelectorAll(selector: string): StubElement[] {
    return this.documentElement.querySelectorAll(selector);
  }
  dispatchEvent(event: StubEvent | { type: string; detail?: unknown }): void {
    if (event.type === 'opencanvas:behaviour-failure') {
      const wrapped = makeEvent(event.type);
      wrapped.detail = 'detail' in event ? event.detail : undefined;
      for (const fn of this.customEventListeners) fn(wrapped);
    }
  }
  createElement(tag: string): StubElement {
    return new StubElement(tag);
  }
  startViewTransition(update: () => void): { finished: Promise<void> } {
    this.viewTransitionCalls += 1;
    update();
    return { finished: Promise.resolve() };
  }
}

class StubSessionStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class StubWindow {
  scrollY = 0;
  innerHeight = 900;
  scrollToCalls = 0;
  sessionStorage = new StubSessionStorage();
  fetchCalls: string[] = [];
  listeners = new Map<string, Listener[]>();
  rafQueue: Array<() => void> = [];
  intervals: Array<() => void> = [];
  timeouts: Array<() => void> = [];

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  scrollTo(_x: number, y?: number): void {
    this.scrollToCalls += 1;
    this.scrollY = typeof y === 'number' ? y : _x;
  }
  dispatchWheel(deltaY: number): StubEvent {
    const event = makeEvent('wheel') as StubEvent & { deltaY: number; ctrlKey: boolean };
    event.deltaY = deltaY;
    event.ctrlKey = false;
    const listeners = this.listeners.get('wheel') ?? [];
    for (const fn of listeners) fn(event);
    return event;
  }
  dispatchScroll(): void {
    const listeners = this.listeners.get('scroll') ?? [];
    for (const fn of listeners) {
      fn({
        type: 'scroll',
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        target: null,
        currentTarget: null,
      });
    }
    this.flushRaf();
  }
  requestAnimationFrame(fn: () => void): number {
    this.rafQueue.push(fn);
    return this.rafQueue.length;
  }
  flushRaf(): void {
    const queue = this.rafQueue.slice();
    this.rafQueue = [];
    for (const fn of queue) fn();
  }
  setInterval(fn: () => void): number {
    this.intervals.push(fn);
    return this.intervals.length;
  }
  clearInterval(): void {
    this.intervals = [];
  }
  setTimeout(fn: () => void): number {
    this.timeouts.push(fn);
    return this.timeouts.length;
  }
  clearTimeout(): void {
    this.timeouts = [];
  }
  fetch(input: string): Promise<{ ok: boolean; status: number }> {
    this.fetchCalls.push(String(input));
    return Promise.resolve({ ok: true, status: 200 });
  }
  matchMedia(): { matches: boolean } {
    return { matches: false };
  }
}

class StubImage {
  onload: (() => void) | null = null;
  onerror: ((err: Error) => void) | null = null;
  decoding = '';
  naturalWidth = 100;
  naturalHeight = 100;
  width = 100;
  height = 100;
  private _src = '';

  set src(value: string) {
    this._src = value;
    if (this.onload) this.onload();
  }

  get src(): string {
    return this._src;
  }
}

function makeEvent(type: string, detail?: unknown): StubEvent {
  return {
    type,
    detail,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: null,
    currentTarget: null,
  };
}

function runBehaviour(doc: StubDocument, win: StubWindow, ImageCtor: typeof StubImage): void {
  const CustomEventCtor = function CustomEvent(
    this: { type: string; detail?: unknown },
    type: string,
    init?: { detail?: unknown },
  ) {
    this.type = type;
    this.detail = init?.detail;
  } as unknown as new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- must execute visitor behaviour runtime source verbatim.
  const fn = new Function(
    'document',
    'window',
    'Image',
    'CustomEvent',
    'IntersectionObserver',
    'requestAnimationFrame',
    `${BEHAVIOUR_RUNTIME_SRC}\nhydrateBehaviour(document);`,
  ) as (
    d: StubDocument,
    w: StubWindow,
    i: typeof StubImage,
    c: new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown },
    io: typeof StubIntersectionObserver,
    raf: (fn: () => void) => number,
  ) => void;

  fn(
    doc,
    win,
    ImageCtor,
    CustomEventCtor,
    StubIntersectionObserver,
    win.requestAnimationFrame.bind(win),
  );
}

class StubIntersectionObserver {
  private cb: (entries: Array<{ isIntersecting: boolean; target: StubElement }>) => void;
  constructor(cb: (entries: Array<{ isIntersecting: boolean; target: StubElement }>) => void) {
    this.cb = cb;
  }
  observe(target: StubElement): void {
    this.cb([{ isIntersecting: true, target }]);
  }
  disconnect(): void {}
}

function baseSnapshot(): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-06-17T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Behaviour Smoke',
        width: 1440,
        sections: [
          {
            id: 'section-story',
            recipeId: 'custom',
            name: 'Story',
            height: 2400,
            elements: [
              {
                id: 'story-track',
                type: 'text',
                box: { x: 0, y: 0, w: 1200, h: 80, z: 1 },
                content: [{ text: 'Track copy' }],
                role: 'body',
                fontSize: 18,
                fontWeight: 400,
                align: 'left',
              },
              {
                id: 'impact-heading',
                type: 'text',
                box: { x: 0, y: 120, w: 800, h: 120, z: 1 },
                content: [{ text: 'Words split here' }],
                role: 'heading',
                fontSize: 48,
                fontWeight: 700,
                align: 'left',
              },
            ],
          },
        ],
      },
    ],
    loadExperience: {
      id: 'load-main',
      label: 'Ari Vale',
      enterLabel: 'Enter',
      background: '#111112',
      foreground: '#C8FF1A',
      runPolicy: 'once-per-session',
      progress: {
        display: 'bar-number',
        durationMs: 900,
        label: 'Loading',
      },
      mediaReadiness: {
        assetIds: ['hero-video', 'hero-poster'],
        timeoutMs: 2000,
      },
      logoDraw: {
        text: 'Ari Vale',
        durationMs: 1000,
        strokeWidth: 2,
      },
      sequenceId: 'load-sequence',
    },
    motionSequences: [
      {
        id: 'load-sequence',
        trigger: { type: 'load-enter' },
        steps: [
          {
            id: 'load-step',
            target: { type: 'site' },
            to: { opacity: 1 },
            durationMs: 200,
          },
        ],
      },
      {
        id: 'impact-split',
        trigger: { type: 'section-enter', sectionId: 'section-story' },
        steps: [
          {
            id: 'impact-words',
            target: { type: 'text-split', elementId: 'impact-heading', unit: 'word' },
            from: { translateY: 24, opacity: 0 },
            to: { translateY: 0, opacity: 1 },
            durationMs: 300,
            staggerMs: 20,
          },
        ],
      },
      {
        id: 'story-scrub',
        trigger: { type: 'scroll-scene', scrollSceneId: 'story-scene' },
        steps: [
          {
            id: 'story-track-x',
            target: { type: 'element', elementId: 'story-track' },
            from: { translateX: 0 },
            to: { translateX: -400 },
            durationMs: 1,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'story-scene',
        sectionId: 'section-story',
        sequenceId: 'story-scrub',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        startOffsetPx: 0,
        endOffsetPx: 800,
        snapPoints: [0, 0.5, 1],
      },
    ],
    richMotionAssets: [
      {
        id: 'helmet-sequence',
        kind: 'image-sequence',
        posterAssetId: 'seed-frame-00',
        alt: 'Helmet sequence',
        frameAssetIds: ['seed-frame-00', 'seed-frame-01'],
        playback: { driver: 'load', fps: 12, loop: false },
      },
    ],
  };
}

function mountRenderedHtml(doc: StubDocument, html: string): void {
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  const payloadMatch = html.match(
    /<script type="application\/json" data-opencanvas-behaviour-payload>([\s\S]*?)<\/script>/,
  );
  assert(payloadMatch !== null, 'rendered html must include behaviour payload script');
  script.textContent = payloadMatch[1] ?? '';
  doc.body.appendChild(script);

  const load = new StubElement('div');
  load.setAttribute('data-opencanvas-load-experience', 'load-main');
  load.setAttribute('data-opencanvas-load-sequence', 'load-sequence');
  const enter = new StubElement('button');
  enter.setAttribute('data-opencanvas-load-enter', '');
  load.appendChild(enter);
  if (html.includes('data-opencanvas-load-logo-draw')) {
    const logo = new StubElement('svg');
    logo.setAttribute('data-opencanvas-load-logo-draw', '');
    const logoText = new StubElement('text');
    logoText.setAttribute('data-opencanvas-load-logo-draw-text', '');
    logo.appendChild(logoText);
    load.appendChild(logo);
  }
  const readinessMatch = html.match(/data-opencanvas-load-readiness-urls="([^"]*)"/);
  if (readinessMatch?.[1]) {
    load.setAttribute('data-opencanvas-load-readiness-urls', readinessMatch[1]);
  }
  const timeoutMatch = html.match(/data-opencanvas-load-readiness-timeout-ms="([^"]*)"/);
  if (timeoutMatch?.[1]) {
    load.setAttribute('data-opencanvas-load-readiness-timeout-ms', timeoutMatch[1]);
  }
  const progress = new StubElement('div');
  progress.setAttribute('data-opencanvas-load-progress', 'bar-number');
  const progressNumber = new StubElement('span');
  progressNumber.setAttribute('data-opencanvas-load-progress-number', '');
  const progressBar = new StubElement('span');
  progressBar.setAttribute('data-opencanvas-load-progress-bar', '');
  progress.appendChild(progressNumber);
  progress.appendChild(progressBar);
  load.appendChild(progress);
  doc.body.appendChild(load);

  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const track = new StubElement('div');
  track.setAttribute('data-opencanvas-element', 'story-track');
  const heading = new StubElement('div');
  heading.setAttribute('data-opencanvas-element', 'impact-heading');
  const headingText = new StubElement('div');
  headingText.className = 'opencanvas-text';
  headingText.textContent = 'Words split here';
  heading.appendChild(headingText);
  section.appendChild(track);
  section.appendChild(heading);
  doc.body.appendChild(section);

  const richMotion = new StubElement('div');
  richMotion.setAttribute('data-opencanvas-rich-motion', 'helmet');
  richMotion.setAttribute('data-rich-motion-asset-ref', 'helmet-sequence');
  const canvas = new StubElement('canvas');
  canvas.setAttribute('data-opencanvas-rich-motion-canvas', 'helmet');
  richMotion.appendChild(canvas);
  doc.body.appendChild(richMotion);
}

// (1) valid payload marks load experience as hydrated
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const snapshot = baseSnapshot();
  const html = renderCanvasSnapshot(snapshot, '/assets', 'site-behaviour-smoke', {
    turnstileSiteKey: 'test-key',
  });
  assert(
    html.includes('data-opencanvas-load-progress-display="bar-number"'),
    'rendered load experience must emit progress display metadata',
  );
  assert(
    html.includes('data-opencanvas-load-run-policy="once-per-session"'),
    'rendered load experience must emit behaviour load run policy',
  );
  assert(
    html.includes('data-opencanvas-load-readiness-urls="/assets/hero-video /assets/hero-poster"'),
    'rendered load experience must emit media readiness asset urls',
  );
  assert(
    html.includes('data-opencanvas-load-logo-draw'),
    'rendered load experience must emit logo draw svg',
  );
  assert(
    html.includes('data-opencanvas-load-progress-number'),
    'rendered load experience must include progress number node',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('behaviourHydrateLoadProgress'),
    'behaviour runtime must hydrate load progress choreography',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('load-progress-number-missing'),
    'behaviour runtime must fail loudly when progress number node is missing',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('load-run-policy-storage-unavailable'),
    'behaviour runtime must fail loudly when once-per-session storage is unavailable',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('behaviourHydrateLoadReadiness'),
    'behaviour runtime must hydrate load media readiness',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('load-readiness-timeout'),
    'behaviour runtime must fail loudly when media readiness times out',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('behaviourHydrateLoadLogoDraw'),
    'behaviour runtime must hydrate load logo draw',
  );
  assert(
    BEHAVIOUR_RUNTIME_SRC.includes('load-logo-draw-missing'),
    'behaviour runtime must fail loudly when logo draw node is missing',
  );
  mountRenderedHtml(doc, html);
  runBehaviour(doc, win, StubImage);
  await Promise.resolve();
  await Promise.resolve();
  const load = doc.querySelector('[data-opencanvas-load-experience="load-main"]');
  assert(load !== null, 'load experience node must exist');
  assert(
    load.getAttribute('data-opencanvas-load-hydrated') === 'true',
    'load experience must be marked hydrated',
  );
  assert(
    load.querySelector('[data-opencanvas-load-progress="bar-number"]')?.getAttribute(
      'data-opencanvas-load-progress-hydrated',
    ) === 'true',
    'load progress choreography must be marked hydrated',
  );
  assert(
    win.fetchCalls.join('|') === '/assets/hero-video|/assets/hero-poster',
    'load media readiness must fetch every authored asset url',
  );
  assert(
    load.getAttribute('data-opencanvas-load-readiness') === 'ready',
    'load media readiness must mark the load experience ready',
  );
  assert(
    load.querySelector('[data-opencanvas-load-logo-draw]')?.getAttribute(
      'data-opencanvas-load-logo-draw-hydrated',
    ) === 'true',
    'load logo draw must be marked hydrated',
  );
  load.querySelector('[data-opencanvas-load-enter]')?.dispatchEvent(makeEvent('click'));
  assert(
    win.sessionStorage.getItem('opencanvas:load-experience:load-main') === 'seen',
    'once-per-session load experience must mark the enter moment as seen',
  );
}

// (2) missing target throws through opencanvas:behaviour-failure
{
  const doc = new StubDocument();
  const win = new StubWindow();
  let failureDetail: unknown = null;
  doc.addEventListener('opencanvas:behaviour-failure', (event) => {
    failureDetail = event.detail;
  });
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'missing-target',
        trigger: { type: 'load-enter' },
        steps: [
          {
            id: 'step-1',
            target: { type: 'element', elementId: 'does-not-exist' },
            to: { opacity: 1 },
            durationMs: 100,
          },
        ],
      },
    ],
    scrollScenes: [],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  let threw = false;
  try {
    runBehaviour(doc, win, StubImage);
  } catch {
    threw = true;
  }
  assert(threw, 'missing target must throw');
  assert(failureDetail !== null, 'missing target must emit opencanvas:behaviour-failure');
}

// (3) text split creates word spans
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'split-seq',
        trigger: { type: 'section-enter', sectionId: 'section-story' },
        steps: [
          {
            id: 'split-step',
            target: { type: 'text-split', elementId: 'impact-heading', unit: 'word' },
            to: { opacity: 1 },
            durationMs: 100,
          },
        ],
      },
    ],
    scrollScenes: [],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const heading = new StubElement('div');
  heading.setAttribute('data-opencanvas-element', 'impact-heading');
  const headingText = new StubElement('div');
  headingText.className = 'opencanvas-text';
  headingText.textContent = 'One two three';
  heading.appendChild(headingText);
  section.appendChild(heading);
  doc.body.appendChild(section);
  runBehaviour(doc, win, StubImage);
  const spans = heading.querySelectorAll('.opencanvas-text-split');
  assert(spans.length === 3, 'text split must create one span per word');
  assert(
    headingText.getAttribute('aria-label') === 'One two three',
    'text split host must preserve semantic aria-label',
  );
  assert(
    spans.every((span) => span.getAttribute('aria-hidden') === 'true'),
    'text split generated spans must be presentational',
  );
}

// (4) scroll scene computes progress and applies transform
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'story-scrub',
        trigger: { type: 'scroll-scene', scrollSceneId: 'story-scene' },
        steps: [
          {
            id: 'story-track-x',
            target: { type: 'element', elementId: 'story-track' },
            from: { translateX: 0 },
            to: { translateX: -400 },
            durationMs: 1,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'story-scene',
        sectionId: 'section-story',
        sequenceId: 'story-scrub',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        startOffsetPx: 0,
        endOffsetPx: 800,
        snapPoints: [0, 0.5, 1],
      },
    ],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const track = new StubElement('div');
  track.setAttribute('data-opencanvas-element', 'story-track');
  section.appendChild(track);
  doc.body.appendChild(section);
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 100 - win.scrollY,
    left: 0,
    width: 1200,
    height: 800,
  });
  runBehaviour(doc, win, StubImage);
  win.scrollY = 380;
  win.dispatchScroll();
  assert(
    track.style.transform.includes('-200px'),
    'scroll scene must snap progress to the nearest authored stop',
  );
}

// (5) scroll scene staggers text-split targets across scroll progress
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'split-scroll',
        trigger: { type: 'scroll-scene', scrollSceneId: 'split-scene' },
        steps: [
          {
            id: 'split-scroll-step',
            target: { type: 'text-split', elementId: 'impact-heading', unit: 'word' },
            textEffect: 'scramble',
            from: { translateY: 24, opacity: 0 },
            to: { translateY: 0, opacity: 1 },
            durationMs: 100,
            staggerMs: 100,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'split-scene',
        sectionId: 'section-story',
        sequenceId: 'split-scroll',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        startOffsetPx: 0,
        endOffsetPx: 800,
      },
    ],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const heading = new StubElement('div');
  heading.setAttribute('data-opencanvas-element', 'impact-heading');
  const headingText = new StubElement('div');
  headingText.className = 'opencanvas-text';
  headingText.textContent = 'One two three';
  heading.appendChild(headingText);
  section.appendChild(heading);
  doc.body.appendChild(section);
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 100 - win.scrollY,
    left: 0,
    width: 1200,
    height: 800,
  });
  runBehaviour(doc, win, StubImage);
  win.scrollY = 500;
  win.dispatchScroll();
  const spans = heading.querySelectorAll('.opencanvas-text-split');
  assert(spans.length === 3, 'scroll text split must resolve every word span');
  assert(spans[0]!.style.opacity === '1', 'first split word must complete by mid scroll progress');
  assert(spans[0]!.textContent === 'One ', 'completed scrambled split word must restore final text');
  assert(spans[1]!.style.opacity === '0.5', 'second split word must be halfway through its stagger at mid scroll progress');
  assert(spans[1]!.textContent !== 'two ', 'halfway split word must render scrambled text');
  assert(spans[1]!.textContent.length === 'two '.length, 'scrambled split word must preserve layout length');
  assert(spans[2]!.style.opacity === '0', 'third split word must not start before its stagger window');
}

// (6) scroll scene mask-reveal text effect clips split text from progress
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'mask-scroll',
        trigger: { type: 'scroll-scene', scrollSceneId: 'mask-scene' },
        steps: [
          {
            id: 'mask-scroll-step',
            target: { type: 'text-split', elementId: 'impact-heading', unit: 'word' },
            textEffect: 'mask-reveal',
            from: { opacity: 0 },
            to: { opacity: 1 },
            durationMs: 100,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'mask-scene',
        sectionId: 'section-story',
        sequenceId: 'mask-scroll',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        startOffsetPx: 0,
        endOffsetPx: 800,
      },
    ],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const heading = new StubElement('div');
  heading.setAttribute('data-opencanvas-element', 'impact-heading');
  const headingText = new StubElement('div');
  headingText.className = 'opencanvas-text';
  headingText.textContent = 'One two';
  heading.appendChild(headingText);
  section.appendChild(heading);
  doc.body.appendChild(section);
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 100 - win.scrollY,
    left: 0,
    width: 1200,
    height: 800,
  });
  runBehaviour(doc, win, StubImage);
  win.scrollY = 500;
  win.dispatchScroll();
  const spans = heading.querySelectorAll('.opencanvas-text-split');
  assert(spans.length === 2, 'mask-reveal text effect must resolve split words');
  assert(
    spans[0]!.getAttribute('data-opencanvas-text-effect') === 'mask-reveal',
    'mask-reveal text effect must mark split spans',
  );
  assert(
    spans[0]!.style.clipPath.includes('50%'),
    'mask-reveal text effect must clip split spans from scroll progress',
  );
  assert(spans[0]!.textContent === 'One ', 'mask-reveal text effect must preserve final text');
}

// (6) scroll scene horizontal track translates with scene progress
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'horizontal-scroll',
        trigger: { type: 'scroll-scene', scrollSceneId: 'horizontal-scene' },
        steps: [
          {
            id: 'horizontal-noop',
            target: { type: 'section', sectionId: 'section-story' },
            to: { opacity: 1 },
            durationMs: 1,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'horizontal-scene',
        sectionId: 'section-story',
        sequenceId: 'horizontal-scroll',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        horizontalTrack: { elementId: 'story-track', distancePx: 600 },
        startOffsetPx: 0,
        endOffsetPx: 800,
      },
    ],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const track = new StubElement('div');
  track.setAttribute('data-opencanvas-element', 'story-track');
  section.appendChild(track);
  doc.body.appendChild(section);
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 100 - win.scrollY,
    left: 0,
    width: 1200,
    height: 800,
  });
  runBehaviour(doc, win, StubImage);
  win.scrollY = 500;
  win.dispatchScroll();
  assert(
    track.getAttribute('data-opencanvas-scroll-horizontal-track') === 'true',
    'scroll scene horizontal track must mark the hydrated track',
  );
  assert(
    track.style.transform.includes('-300px'),
    'scroll scene horizontal track must translate by authored distance and progress',
  );
}

// (7) scroll scene before/after reveal clips the after element from scene progress
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'reveal-scroll',
        trigger: { type: 'scroll-scene', scrollSceneId: 'reveal-scene' },
        steps: [
          {
            id: 'reveal-noop',
            target: { type: 'section', sectionId: 'section-story' },
            to: { opacity: 1 },
            durationMs: 1,
          },
        ],
      },
    ],
    scrollScenes: [
      {
        id: 'reveal-scene',
        sectionId: 'section-story',
        sequenceId: 'reveal-scroll',
        pinTarget: { type: 'section', sectionId: 'section-story' },
        beforeAfterReveal: {
          beforeElementId: 'story-before',
          afterElementId: 'story-after',
          axis: 'x',
          startProgress: 0,
          endProgress: 1,
          reducedMotion: 'end',
        },
        startOffsetPx: 0,
        endOffsetPx: 800,
      },
    ],
    richMotionAssets: [],
  });
  doc.body.appendChild(script);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'section-story');
  const before = new StubElement('div');
  before.setAttribute('data-opencanvas-element', 'story-before');
  const after = new StubElement('div');
  after.setAttribute('data-opencanvas-element', 'story-after');
  section.appendChild(before);
  section.appendChild(after);
  doc.body.appendChild(section);
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 100 - win.scrollY,
    left: 0,
    width: 1200,
    height: 800,
  });
  runBehaviour(doc, win, StubImage);
  win.scrollY = 500;
  win.dispatchScroll();
  assert(
    before.getAttribute('data-opencanvas-scroll-reveal-before') === 'true',
    'scroll scene reveal must mark the before element',
  );
  assert(
    after.getAttribute('data-opencanvas-scroll-reveal-after') === 'true',
    'scroll scene reveal must mark the after element',
  );
  assert(
    after.style.clipPath.includes('50%'),
    'scroll scene reveal must clip the after element from authored progress',
  );
}

// (8) image sequence refuses an empty frame list
{
  const doc = new StubDocument();
  const win = new StubWindow();
  let failureDetail: unknown = null;
  doc.addEventListener('opencanvas:behaviour-failure', (event) => {
    failureDetail = event.detail;
  });
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [],
    scrollScenes: [],
    richMotionAssets: [
      {
        id: 'empty-sequence',
        kind: 'image-sequence',
        posterAssetId: 'seed-frame-00',
        alt: 'Empty',
        frameAssetIds: [],
        frameUrls: [],
        posterUrl: '/assets/seed-frame-00',
        playback: { driver: 'load' },
      },
    ],
  });
  doc.body.appendChild(script);
  const richMotion = new StubElement('div');
  richMotion.setAttribute('data-opencanvas-rich-motion', 'empty');
  richMotion.setAttribute('data-rich-motion-asset-ref', 'empty-sequence');
  const canvas = new StubElement('canvas');
  canvas.setAttribute('data-opencanvas-rich-motion-canvas', 'empty');
  richMotion.appendChild(canvas);
  doc.body.appendChild(richMotion);
  let threw = false;
  try {
    runBehaviour(doc, win, StubImage);
  } catch {
    threw = true;
  }
  assert(threw, 'empty image sequence must throw');
  assert(
    failureDetail !== null &&
      typeof failureDetail === 'object' &&
      (failureDetail as { code?: string }).code === 'rich-motion-empty-frames',
    'empty image sequence must emit rich-motion-empty-frames failure',
  );
}

// (6) layout transition toggles same-page source/detail elements through View Transition API
// (6) Rive input bindings drive state-machine inputs through schema-owned events
{
  const doc = new StubDocument();
  const win = new StubWindow() as StubWindow & {
    rive: { Rive: new (options: Record<string, unknown>) => unknown };
  };
  const captured = { options: null as Record<string, unknown> | null };
  let triggerFireCount = 0;
  const isHovered = { name: 'isHovered', type: 'Boolean', value: false };
  const scrollProgress = { name: 'scrollProgress', type: 'Number', value: 0 };
  const activate = {
    name: 'activate',
    type: 'Trigger',
    fire() {
      triggerFireCount += 1;
    },
  };
  const fakeInstance = {
    stateMachineInputs(name: string) {
      assert(name === 'HeroMachine', 'Rive binding must request the authored state machine');
      return [isHovered, scrollProgress, activate];
    },
  };
  win.rive = {
    Rive: function Rive(options: Record<string, unknown>) {
      captured.options = options;
      return fakeInstance;
    } as unknown as new (options: Record<string, unknown>) => unknown,
  };

  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [
      {
        id: 'hero-scroll-sequence',
        trigger: { type: 'scroll-scene', scrollSceneId: 'hero-scroll' },
        steps: [],
      },
    ],
    scrollScenes: [
      {
        id: 'hero-scroll',
        sectionId: 'hero',
        sequenceId: 'hero-scroll-sequence',
        pinTarget: { type: 'section', sectionId: 'hero' },
        startOffsetPx: 0,
        endOffsetPx: 720,
      },
    ],
    richMotionAssets: [
      {
        id: 'rive-bound',
        kind: 'rive',
        assetId: 'hero.riv',
        srcUrl: '/assets/hero.riv',
        alt: 'Bound Rive',
        stateMachine: 'HeroMachine',
        reducedMotion: 'play',
        inputs: [
          {
            id: 'hover-on',
            inputName: 'isHovered',
            inputType: 'boolean',
            event: 'pointer-enter',
            value: true,
          },
          {
            id: 'scroll-progress',
            inputName: 'scrollProgress',
            inputType: 'number',
            event: 'scroll-progress',
            scrollSceneId: 'hero-scroll',
          },
          {
            id: 'activate',
            inputName: 'activate',
            inputType: 'trigger',
            event: 'click',
          },
        ],
      },
    ],
  });
  doc.body.appendChild(script);

  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'hero');
  section.getBoundingClientRect = () => ({ top: -360, left: 0, width: 1200, height: 720 });
  const richMotion = new StubElement('div');
  richMotion.setAttribute('data-opencanvas-rich-motion', 'rive-el');
  richMotion.setAttribute('data-rich-motion-asset-ref', 'rive-bound');
  const canvas = new StubElement('canvas');
  canvas.setAttribute('data-opencanvas-rich-motion-canvas', 'rive-el');
  richMotion.appendChild(canvas);
  section.appendChild(richMotion);
  doc.body.appendChild(section);

  runBehaviour(doc, win, StubImage);
  await Promise.resolve();
  assert(captured.options !== null, 'Rive runtime must be constructed');
  assert(typeof captured.options.onLoad === 'function', 'Rive input bindings must attach an onLoad hook');
  (captured.options.onLoad as () => void)();

  assert(scrollProgress.value === 0.5, `scroll-progress binding must set number input, got ${scrollProgress.value}`);
  richMotion.dispatchEvent(makeEvent('pointerenter'));
  assert(isHovered.value === true, 'pointer-enter binding must set boolean input');
  richMotion.dispatchEvent(makeEvent('click'));
  assert(triggerFireCount === 1, 'click binding must fire trigger input');
  assert(
    richMotion.getAttribute('data-opencanvas-rive-inputs-hydrated') === 'true',
    'Rive input bindings must mark the node hydrated',
  );
}

// (7) layout transition toggles same-page source/detail elements through View Transition API
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [],
    scrollScenes: [],
    richMotionAssets: [],
    layoutTransitions: [
      {
        id: 'layout-card-detail',
        name: 'Card to detail',
        triggerElementId: 'card-trigger',
        sourceElementId: 'card-trigger',
        targetElementId: 'detail-panel',
        viewTransitionName: 'cardDetail',
        initialState: 'source',
        reducedMotion: 'instant',
      },
    ],
  });
  doc.body.appendChild(script);
  const source = new StubElement('button');
  source.setAttribute('data-opencanvas-element', 'card-trigger');
  const target = new StubElement('article');
  target.setAttribute('data-opencanvas-element', 'detail-panel');
  doc.body.appendChild(source);
  doc.body.appendChild(target);
  runBehaviour(doc, win, StubImage);
  assert(target.hidden === true, 'layout transition hydration must hide the inactive target');
  source.dispatchEvent(makeEvent('click'));
  assert(doc.viewTransitionCalls === 1, 'layout transition must call document.startViewTransition');
  assert(source.hidden === true, 'layout transition must hide source after click');
  assert(Boolean(target.hidden) === false, 'layout transition must reveal target after click');
  assert(
    target.getAttribute('data-opencanvas-layout-transition-state') === 'active',
    'layout transition must mark the active target',
  );
}

// (7) Smooth Scroll intercepts wheel input and drives window scroll through the shared behaviour runtime
{
  const doc = new StubDocument();
  const win = new StubWindow();
  doc.documentElement.scrollHeight = 3000;
  doc.documentElement.clientHeight = 900;
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [],
    scrollScenes: [],
    richMotionAssets: [],
    smoothScroll: {
      mode: 'inertial',
      durationMs: 900,
      reducedMotion: 'native',
      paddingTop: 96,
    },
  });
  doc.body.appendChild(script);
  runBehaviour(doc, win, StubImage);
  assert(
    doc.documentElement.getAttribute('data-opencanvas-smooth-scroll-hydrated') === 'true',
    'Smooth Scroll must mark the document as hydrated',
  );
  const wheel = win.dispatchWheel(480);
  assert(wheel.defaultPrevented === true, 'Smooth Scroll must prevent default wheel scrolling');
  win.flushRaf();
  assert(win.scrollToCalls > 0, 'Smooth Scroll must drive window.scrollTo');
  assert(win.scrollY > 0, 'Smooth Scroll must move toward the wheel target');
}

// (8) nav theme-on-scroll mutates the authored active-theme attribute
{
  const doc = new StubDocument();
  const win = new StubWindow();
  const script = new StubElement('script');
  script.setAttribute('type', 'application/json');
  script.setAttribute('data-opencanvas-behaviour-payload', '');
  script.textContent = serializeBehaviourPayload({
    motionSequences: [],
    scrollScenes: [],
    richMotionAssets: [],
    navThemes: [
      {
        navElementId: 'nav-main',
        defaultTheme: 'transparent',
        reducedMotion: 'instant',
      },
    ],
  });
  doc.body.appendChild(script);
  const nav = new StubElement('nav');
  nav.setAttribute('data-opencanvas-nav-theme-root', 'nav-main');
  nav.setAttribute('data-opencanvas-nav-theme-active', 'transparent');
  nav.setAttribute('data-opencanvas-nav-theme-default', 'transparent');
  nav.setAttribute('data-opencanvas-nav-theme-reduced-motion', 'instant');
  doc.body.appendChild(nav);
  const section = new StubElement('section');
  section.setAttribute('data-opencanvas-section', 'dark-story');
  section.setAttribute('data-opencanvas-nav-theme-target', 'dark');
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 0,
    left: 0,
    width: 1200,
    height: 700,
  });
  doc.body.appendChild(section);
  runBehaviour(doc, win, StubImage);
  assert(
    nav.getAttribute('data-opencanvas-nav-theme-active') === 'dark',
    'nav theme hydration must activate the intersecting section theme',
  );
  section.getBoundingClientRect = (): { top: number; left: number; width: number; height: number } => ({
    top: 1200,
    left: 0,
    width: 1200,
    height: 700,
  });
  win.dispatchScroll();
  assert(
    nav.getAttribute('data-opencanvas-nav-theme-active') === 'transparent',
    'nav theme hydration must restore the default theme outside authored targets',
  );
}

assert(
  INTERACTIVE_RUNTIME_SRC.includes('hydrateBehaviour'),
  'assembled interactive runtime must include hydrateBehaviour',
);
assert(
  injectInteractiveRuntime('<main></main>', baseSnapshot()).includes('hydrateBehaviour'),
  'behaviour snapshots must inject runtime containing hydrateBehaviour',
);

console.log('[behaviour-runtime:smoke] OK');
