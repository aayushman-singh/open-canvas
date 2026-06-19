import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PublishedSnapshot } from '../canvas/schema.js';
import { buildBehaviourPayload, serializeBehaviourPayload } from '../canvas/behaviour-payload.js';
import { renderCanvasSnapshot } from '../canvas/render.js';
import { validatePublishedSnapshot } from '../canvas/validate.js';
import { BEHAVIOUR_RUNTIME_SRC } from './behaviour.js';
import { injectInteractiveRuntime, snapshotNeedsInteractiveRuntime } from './inject.js';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[video-stream-rich-motion:smoke] ' + message);
}

type Listener = (event: StubEvent) => void;

interface StubEvent {
  type: string;
  defaultPrevented: boolean;
  preventDefault(): void;
  target: StubElement | null;
  currentTarget: StubElement | null;
}

class StubStyle {
  display = '';
  width = '';
  height = '';
  objectFit = '';
}

class StubElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  style = new StubStyle();
  textContent = '';
  tabIndex = -1;

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  appendChild(child: StubElement): void {
    child.parent = this;
    this.children.push(child);
  }

  addEventListener(type: string, listener: Listener): void {
    const next = this.listeners.get(type) ?? [];
    next.push(listener);
    this.listeners.set(type, next);
  }

  dispatchEvent(event: StubEvent): void {
    event.target = this;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- intentional: bubble through the stub parent chain from this node.
    let node: StubElement | null = this;
    while (node) {
      const listeners = node.listeners.get(event.type);
      if (listeners) {
        event.currentTarget = node;
        for (const listener of listeners) listener(event);
      }
      node = node.parent;
    }
  }

  matchesSelector(selector: string): boolean {
    const tagAttrMatch = /^([a-zA-Z0-9-]+)\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(
      selector.trim(),
    );
    if (tagAttrMatch) {
      const tagName = tagAttrMatch[1];
      const attr = tagAttrMatch[2];
      const expected = tagAttrMatch[3] ?? null;
      if (tagName === undefined || attr === undefined) return false;
      if (this.tagName !== tagName.toLowerCase()) return false;
      if (!this.attributes.has(attr)) return false;
      if (expected === null) return true;
      return this.attributes.get(attr) === expected;
    }
    const match = /^\[([a-zA-Z0-9-]+)(?:="([^"]*)")?\]$/.exec(selector.trim());
    if (!match) throw new Error('[stub] unsupported selector ' + selector);
    const attr = match[1];
    const expected = match[2] ?? null;
    if (attr === undefined || !this.attributes.has(attr)) return false;
    if (expected === null) return true;
    return this.attributes.get(attr) === expected;
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

  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

class StubVideo extends StubElement {
  src = '';
  poster = '';
  preload = '';
  muted = false;
  loop = false;
  controls = false;
  playsInline = false;
  paused: boolean = true;
  currentTime = 0;
  playCount = 0;
  pauseCount = 0;

  constructor() {
    super('video');
  }

  play(): Promise<void> {
    this.playCount += 1;
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCount += 1;
    this.paused = true;
  }
}

class StubDocument {
  documentElement = new StubElement('html');
  head = new StubElement('head');
  body = new StubElement('body');
  customEventListeners: Listener[] = [];

  constructor() {
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  querySelector(selector: string): StubElement | null {
    return this.documentElement.querySelector(selector);
  }

  querySelectorAll(selector: string): StubElement[] {
    return this.documentElement.querySelectorAll(selector);
  }

  createElement(tag: string): StubElement {
    return tag.toLowerCase() === 'video' ? new StubVideo() : new StubElement(tag);
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === 'opencanvas:behaviour-failure') {
      this.customEventListeners.push(listener);
    }
  }

  dispatchEvent(event: { type: string; detail?: unknown }): void {
    if (event.type !== 'opencanvas:behaviour-failure') return;
    for (const listener of this.customEventListeners) {
      listener({ ...makeEvent(event.type), target: null, currentTarget: null });
    }
  }
}

class StubWindow {
  matchMedia(): { matches: boolean } {
    return { matches: false };
  }
}

function makeEvent(type: string): StubEvent {
  return {
    type,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    target: null,
    currentTarget: null,
  };
}

function runBehaviour(doc: StubDocument, win: StubWindow): void {
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
    'CustomEvent',
    'requestAnimationFrame',
    `${BEHAVIOUR_RUNTIME_SRC}\nhydrateBehaviour(document);`,
  ) as (
    document: StubDocument,
    window: StubWindow,
    customEvent: new (type: string, init?: { detail?: unknown }) => { type: string; detail?: unknown },
    raf: (fn: () => void) => number,
  ) => void;
  fn(doc, win, CustomEventCtor, (cb: () => void) => {
    cb();
    return 1;
  });
}

const snapshot = {
  styleKit: 'charcoal',
  version: 1,
  publishedAt: '2026-06-19T00:00:00.000Z',
  richMotionAssets: [
    {
      id: 'hover-stream',
      kind: 'video-stream',
      assetId: 'hover-stream.mp4',
      posterAssetId: 'hover-poster.webp',
      alt: 'Hover preview stream',
      muted: true,
      loop: true,
      controls: false,
      playback: { trigger: 'hover-focus', resetOnExit: true },
      reducedMotion: 'poster',
    },
  ],
  pages: [
    {
      id: 'home',
      slug: 'home',
      title: 'Home',
      width: 1200,
      sections: [
        {
          id: 'hero',
          recipeId: 'custom',
          name: 'Hero',
          height: 720,
          elements: [
            {
              id: 'stream-el',
              type: 'rich-motion',
              box: { x: 80, y: 80, w: 640, h: 420, z: 1 },
              assetRefId: 'hover-stream',
              fit: 'cover',
              label: 'Hover preview stream',
            },
          ],
        },
      ],
    },
  ],
} as unknown as PublishedSnapshot;

const validation = validatePublishedSnapshot(snapshot);
assert(
  validation.valid,
  `video-stream rich-motion snapshot must publish: ${validation.valid ? '' : validation.errors.join('; ')}`,
);

const payload = buildBehaviourPayload(snapshot, '/assets');
assert(payload !== null, 'video-stream rich motion must build a behaviour payload');
const stream = payload.richMotionAssets[0] as {
  kind: string;
  srcUrl?: string;
  posterUrl?: string;
  playback?: { trigger?: string };
};
assert(stream.kind === 'video-stream', 'payload must preserve video-stream kind');
assert(stream.srcUrl === '/assets/hover-stream.mp4', 'payload must resolve video src url');
assert(stream.posterUrl === '/assets/hover-poster.webp', 'payload must resolve video poster url');
assert(stream.playback?.trigger === 'hover-focus', 'payload must preserve stream trigger');

assert(snapshotNeedsInteractiveRuntime(snapshot), 'video-stream rich motion must request interactive runtime');
const html = renderCanvasSnapshot(snapshot, '/assets', 'site-video-stream', {
  turnstileSiteKey: 'test-turnstile-key',
});
assert(
  injectInteractiveRuntime(html, snapshot).includes('data-opencanvas-behaviour-payload'),
  'injected HTML must include behaviour payload script',
);

const doc = new StubDocument();
const script = new StubElement('script');
script.setAttribute('data-opencanvas-behaviour-payload', '');
script.textContent = serializeBehaviourPayload(payload);
doc.body.appendChild(script);
const richMotion = new StubElement('div');
richMotion.setAttribute('data-opencanvas-rich-motion', 'stream-el');
richMotion.setAttribute('data-rich-motion-asset-ref', 'hover-stream');
richMotion.setAttribute('data-rich-motion-fit', 'cover');
const canvas = new StubElement('canvas');
canvas.setAttribute('data-opencanvas-rich-motion-canvas', 'stream-el');
richMotion.appendChild(canvas);
doc.body.appendChild(richMotion);

runBehaviour(doc, new StubWindow());

const video = richMotion.querySelector('[data-opencanvas-video-stream="hover-stream"]') as StubVideo | null;
assert(video !== null, 'runtime must mount a video stream element');
const videoPaused = (): boolean => video.paused;
assert(video.src === '/assets/hover-stream.mp4', 'runtime must assign video src');
assert(video.poster === '/assets/hover-poster.webp', 'runtime must assign poster src');
assert(video.muted === true, 'runtime must preserve muted playback contract');
assert(video.loop === true, 'runtime must preserve loop playback contract');
assert(video.playsInline === true, 'runtime must force inline playback');
assert(canvas.style.display === 'none', 'runtime must hide the canvas mount for video-stream assets');
assert(
  richMotion.getAttribute('data-opencanvas-video-stream-hydrated') === 'true',
  'runtime must mark video-stream nodes hydrated',
);

richMotion.dispatchEvent(makeEvent('pointerenter'));
await Promise.resolve();
assert(video.playCount === 1 && !videoPaused(), 'pointerenter must play the video stream');
video.currentTime = 4.2;
richMotion.dispatchEvent(makeEvent('pointerleave'));
assert(video.pauseCount === 1 && videoPaused(), 'pointerleave must pause the video stream');
assert(video.currentTime === 0, 'resetOnExit must rewind the video stream');

const panelSource = readFileSync(join(process.cwd(), 'src', 'editor-client', 'interactions-panel.ts'), 'utf8');
assert(panelSource.includes('Add video stream asset'), 'Interactions panel must create video stream assets');
assert(panelSource.includes('renderVideoStreamAssetFields'), 'Interactions panel must expose video stream fields');

console.log('[video-stream-rich-motion:smoke] OK');
