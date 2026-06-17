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
  style = new StubStyle();
  clientWidth = 320;
  clientHeight = 240;

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
}

class StubWindow {
  scrollY = 0;
  innerHeight = 900;
  listeners = new Map<string, Listener[]>();
  rafQueue: Array<() => void> = [];
  intervals: Array<() => void> = [];

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
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
  mountRenderedHtml(doc, html);
  runBehaviour(doc, win, StubImage);
  const load = doc.querySelector('[data-opencanvas-load-experience="load-main"]');
  assert(load !== null, 'load experience node must exist');
  assert(
    load.getAttribute('data-opencanvas-load-hydrated') === 'true',
    'load experience must be marked hydrated',
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
    track.style.transform.includes('-200px'),
    'scroll scene must apply interpolated transform at mid progress',
  );
}

// (5) image sequence refuses an empty frame list
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

assert(
  INTERACTIVE_RUNTIME_SRC.includes('hydrateBehaviour'),
  'assembled interactive runtime must include hydrateBehaviour',
);
assert(
  injectInteractiveRuntime('<main></main>', baseSnapshot()).includes('hydrateBehaviour'),
  'behaviour snapshots must inject runtime containing hydrateBehaviour',
);

console.log('[behaviour-runtime:smoke] OK');
