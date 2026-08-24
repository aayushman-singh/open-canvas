// Cross-surface Render Parity Contract for editor preview vs Published Site.
//
// This smoke compares normalized semantic snapshots, not raw HTML. It ignores
// editor-owned chrome and URL roots, but fails on visible content, class hooks,
// runtime data attributes, accessibility attributes, and child topology.

import type { ActionElement, MediaElement, TabsElement } from '../canvas/schema.js';
import { renderAction } from '../canvas/elements/action.js';
import { renderCarousel, type CarouselElement } from '../canvas/elements/carousel.js';
import { renderMedia } from '../canvas/elements/media.js';
import { renderNav, type NavElement } from '../canvas/elements/nav.js';
import { renderTabs } from '../canvas/elements/tabs.js';
import {
  buildActionBodyImpl,
  buildMediaBodyImpl,
} from './body-builders-basic.js';
import {
  buildCarouselBodyImpl,
  buildNavBodyImpl,
  buildTabsBodyImpl,
} from './body-builders-data.js';

const EDITOR_ASSET_ROOT = 'https://editor.example.test/assets';
const PUBLIC_ASSET_ROOT = '/assets';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[render-parity:smoke] ${message}`);
}

type Attrs = Record<string, string>;

interface SemanticNode {
  tag: string;
  classes: string[];
  attrs: Attrs;
  text: string;
  children: SemanticNode[];
}

class StubStyle {
  private readonly entries = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.entries.set(name, value);
  }
}

class StubElement {
  readonly tagName: string;
  readonly children: StubElement[] = [];
  readonly style = new Proxy(new StubStyle(), {
    set(target, prop, value): boolean {
      target.setProperty(String(prop), String(value));
      return true;
    },
  }) as StubStyle & Record<string, string>;
  readonly attrs = new Map<string, string>();
  private classNameValue = '';
  private textContentValue = '';
  private innerHTMLValue = '';

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  set className(value: string) {
    this.classNameValue = value;
    if (value.length > 0) this.attrs.set('class', value);
  }

  get className(): string {
    return this.classNameValue;
  }

  set textContent(value: string) {
    this.textContentValue = value;
  }

  get textContent(): string {
    return this.textContentValue;
  }

  set innerHTML(value: string) {
    this.innerHTMLValue = value;
  }

  get innerHTML(): string {
    return this.innerHTMLValue;
  }

  set src(value: string) {
    this.attrs.set('src', value);
  }

  get src(): string {
    return this.attrs.get('src') ?? '';
  }

  set alt(value: string) {
    this.attrs.set('alt', value);
  }

  get alt(): string {
    return this.attrs.get('alt') ?? '';
  }

  set loading(value: string) {
    this.attrs.set('loading', value);
  }

  set type(value: string) {
    this.attrs.set('type', value);
  }

  set muted(value: boolean) {
    if (value) this.attrs.set('muted', '');
  }

  appendChild(child: StubElement): StubElement {
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
    if (name === 'class') this.classNameValue = value;
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  addEventListener(): void {
    // Event wiring is editor-owned; this smoke compares rendered semantics.
  }
}

interface GlobalWithDocument {
  document?: { createElement(tag: string): StubElement };
}

function withStubDocument<T>(fn: () => T): T {
  const globalRef = globalThis as unknown as GlobalWithDocument;
  const savedDocument = globalRef.document;
  globalRef.document = {
    createElement(tag: string): StubElement {
      return new StubElement(tag);
    },
  };
  try {
    return fn();
  } finally {
    if (savedDocument === undefined) {
      delete globalRef.document;
    } else {
      globalRef.document = savedDocument;
    }
  }
}

function normalizeAssetRoot(value: string): string {
  return value.replace(new RegExp(EDITOR_ASSET_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), PUBLIC_ASSET_ROOT);
}

function semanticFromEditor(node: StubElement): SemanticNode {
  const attrs: Attrs = {};
  for (const [key, rawValue] of node.attrs.entries()) {
    if (key === 'style') continue;
    attrs[key] = normalizeAssetRoot(rawValue);
  }
  const classes = (attrs.class ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  delete attrs.class;
  return {
    tag: node.tagName.toLowerCase(),
    classes,
    attrs,
    text: node.textContent,
    children: node.children.map(semanticFromEditor),
  };
}

function attrValue(html: string, name: string): string | null {
  const pattern = new RegExp(`${name}(?:="([^"]*)")?`);
  const match = pattern.exec(html);
  if (!match) return null;
  return match[1] ?? '';
}

function countMatches(html: string, pattern: RegExp): number {
  return [...html.matchAll(pattern)].length;
}

function editorCtx() {
  return {
    siteBase: 'https://editor.example.test',
    state: { pages: [{ id: 'home', slug: 'home' }] },
    currentPage: () => ({ id: 'home', slug: 'home' }),
    goToHrefOnCanvas: () => {
      throw new Error('goToHrefOnCanvas should not fire during render parity');
    },
    setActivePage: () => {
      throw new Error('setActivePage should not fire during render parity');
    },
    panToPage: () => {
      throw new Error('panToPage should not fire during render parity');
    },
    rebuildElement: () => {
      throw new Error('rebuildElement should not fire during render parity');
    },
    scheduleSave: () => {
      throw new Error('scheduleSave should not fire during render parity');
    },
    buildElementNode: (element: { id: string; type: string }) => {
      const child = new StubElement('div');
      child.className = 'opencanvas-element';
      child.setAttribute('data-opencanvas-element', element.id);
      child.setAttribute('data-element-type', element.type);
      return child;
    },
  };
}

const actionFixture: ActionElement = {
  id: 'action-1',
  type: 'action',
  box: { x: 0, y: 0, w: 180, h: 48, z: 1 },
  label: [{ text: 'View ' }, { text: 'project', marks: [{ type: 'bold' }] }],
  href: { type: 'external', url: 'https://example.com/project' },
  variant: 'solid',
  iconKind: 'arrow-up-right',
};

const videoFixture: MediaElement = {
  id: 'media-1',
  type: 'media',
  box: { x: 0, y: 0, w: 320, h: 180, z: 1 },
  assetId: 'video-main',
  alt: 'Launch reel',
  fit: 'cover',
  mediaKind: 'video',
  posterAssetId: 'video-poster',
  playback: { autoplay: true, loop: true, controls: true },
  hoverPlayback: {
    enabled: true,
    mode: 'play-reset',
    scrubOnHover: true,
    streamAssetId: 'video-stream',
    streamPosterAssetId: 'video-stream-poster',
    intentDelayMs: 120,
    reducedMotion: 'allow',
  },
};

const navFixture: NavElement = {
  id: 'nav-1',
  type: 'nav',
  box: { x: 0, y: 0, w: 760, h: 72, z: 1 },
  logoAssetId: 'logo-main',
  siteTitle: 'Open Canvas',
  links: [
    { label: 'Home', href: 'home', kind: 'internal' },
    { label: 'Docs', href: 'https://example.com/docs', kind: 'external' },
  ],
  primaryAction: { label: 'Start', href: '#start', kind: 'anchor' },
  layout: 'left-center-right',
  sticky: true,
  themeOnScroll: {
    enabled: true,
    defaultTheme: 'light',
    reducedMotion: 'instant',
  },
  navStyle: { recipe: 'glass-float' },
};

const carouselFixture: CarouselElement = {
  id: 'carousel-1',
  type: 'carousel',
  box: { x: 0, y: 0, w: 420, h: 260, z: 1 },
  slides: [
    { id: 'slide-a', assetId: 'slide-a-img', caption: 'Alpha', href: 'https://example.com/a' },
    { id: 'slide-b', assetId: 'slide-b-img', caption: 'Beta' },
  ],
  showArrows: true,
  showDots: true,
  direction: 'horizontal',
  arrowPosition: 'bunched-bottom-right',
  arrowStyle: 'pill',
  mode: 'paginate',
  variant: 'coverflow',
};

const tabsFixture: TabsElement = {
  id: 'tabs-1',
  type: 'tabs',
  box: { x: 0, y: 0, w: 500, h: 300, z: 1 },
  activeTabId: 'overview',
  tabBarHeight: 64,
  variant: 'underline',
  tabs: [
    {
      id: 'overview',
      label: [{ text: 'Overview' }],
      elements: [{ ...actionFixture, id: 'nested-action' }],
    },
    {
      id: 'details',
      label: [{ text: 'Details' }],
      elements: [],
    },
  ],
};

function assertActionParity(): void {
  const editor = withStubDocument(() =>
    semanticFromEditor(buildActionBodyImpl(editorCtx() as never, actionFixture) as unknown as StubElement),
  );
  const published = renderAction(actionFixture, { pages: [] });
  assert(editor.tag === 'a', 'Action editor preview must render link actions as anchors');
  const editorHref = editor.attrs.href;
  assert(editorHref !== undefined, 'Action editor preview must emit href');
  assert(editorHref === attrValue(published, 'href'), 'Action href must match published href');
  assert(editor.attrs['data-variant'] === 'solid', 'Action variant data attribute must match');
  assert(published.includes(editorHref), 'Published Action must include editor href');
  assert(published.includes('arrow-up-right'), 'Published Action must include the icon svg');
  assert(editor.children.length === 0 && editor.text === '', 'Action rich label is represented by innerHTML');
}

function assertMediaParity(): void {
  const editor = withStubDocument(() =>
    semanticFromEditor(buildMediaBodyImpl(editorCtx() as never, videoFixture) as unknown as StubElement),
  );
  const video = editor.children[0];
  const published = renderMedia(videoFixture, { assetBasePath: PUBLIC_ASSET_ROOT });
  assert(video !== undefined, 'Media editor preview must render the video child');
  assert(video.tag === 'video', 'Media editor preview must render video as <video>');
  assert(video.attrs.src === attrValue(published, 'src'), 'Media video src must match after URL normalization');
  assert(video.attrs.poster === attrValue(published, 'poster'), 'Media poster must match published poster');
  assert(video.attrs.playsinline === '', 'Media video must carry playsinline like published video');
  assert(
    video.attrs['data-opencanvas-video-hover'] === 'true',
    'Media video-hover runtime marker must match published video',
  );
  assert(
    video.attrs['data-opencanvas-video-hover-stream-src'] === `${PUBLIC_ASSET_ROOT}/video-stream`,
    'Media video-hover stream src must normalize to the published asset URL',
  );
}

function assertNavParity(): void {
  const editor = withStubDocument(() =>
    semanticFromEditor(buildNavBodyImpl(editorCtx() as never, navFixture) as unknown as StubElement),
  );
  const published = renderNav(navFixture, {
    styleKit: 'charcoal',
    assetBasePath: PUBLIC_ASSET_ROOT,
    pageSlug: 'home',
  });
  assert(editor.tag === 'nav', 'Nav editor preview must render a nav root');
  assert(editor.attrs['data-opencanvas-nav-layout'] === attrValue(published, 'data-opencanvas-nav-layout'), 'Nav layout must match');
  assert(editor.attrs['data-opencanvas-nav-theme-root'] === 'nav-1', 'Nav theme root must match');
  assert(editor.children[0]?.attrs['data-slot'] === 'left', 'Nav left slot must match published slot topology');
  const editorExternal = editor.children[1]?.children[1];
  assert(editorExternal !== undefined, 'Nav editor preview must render external link');
  assert(editorExternal.attrs.target === '_blank', 'Nav external link target must match');
  assert(
    editorExternal.attrs.rel === 'noopener noreferrer',
    'Nav external link rel must match published rel exactly',
  );
}

function assertCarouselParity(): void {
  const editor = withStubDocument(() =>
    semanticFromEditor(
      buildCarouselBodyImpl(editorCtx() as never, carouselFixture) as unknown as StubElement,
    ),
  );
  const published = renderCarousel(carouselFixture, {
    styleKit: 'charcoal',
    assetBasePath: PUBLIC_ASSET_ROOT,
  });
  assert(editor.attrs['data-opencanvas-interactive'] === 'carousel', 'Carousel runtime marker must match');
  assert(editor.attrs['data-opencanvas-carousel-mode'] === 'paginate', 'Carousel mode must match');
  assert(editor.attrs['data-variant'] === 'coverflow', 'Carousel variant must match');
  const editorTrack = editor.children[0];
  assert(editorTrack?.children.length === 2, 'Carousel editor preview must render both slides');
  assert(
    countMatches(published, /data-opencanvas-carousel-slide-index=/g) === 2,
    'Published Carousel must render both slide indexes',
  );
  const editorDots = editor.children.find((child) => child.classes.includes('opencanvas-carousel-dots'));
  assert(editorDots !== undefined, 'Carousel editor preview must render dots');
  assert(
    editorDots.children[0]?.attrs['data-opencanvas-slide-target-id'] === 'slide-a',
    'Carousel dot must carry slide target id like published output',
  );
}

function assertTabsParity(): void {
  const editor = withStubDocument(() =>
    semanticFromEditor(buildTabsBodyImpl(editorCtx() as never, tabsFixture) as unknown as StubElement),
  );
  const published = renderTabs(tabsFixture, {
    styleKit: 'charcoal',
    renderChild: (element) =>
      `<div class="opencanvas-element" data-opencanvas-element="${element.id}" data-element-type="${element.type}"></div>`,
  });
  assert(editor.attrs['data-opencanvas-tabs'] === 'tabs-1', 'Tabs root must carry the runtime id');
  assert(editor.attrs['data-variant'] === 'underline', 'Tabs variant must match');
  assert(
    countMatches(published, /data-opencanvas-tab-panel-id=/g) === 2,
    'Published Tabs must render every panel',
  );
  const editorPanels = editor.children.filter((child) => child.classes.includes('opencanvas-tab-panel'));
  assert(editorPanels.length === 2, 'Tabs editor preview must render every panel, not only the active panel');
  assert(
    editorPanels.map((panel) => panel.attrs['data-opencanvas-tab-panel-id']).join(',') ===
      'overview,details',
    'Tabs editor panel ids must match published panel ids',
  );
}

assertActionParity();
assertMediaParity();
assertNavParity();
assertCarouselParity();
assertTabsParity();

console.log('[render-parity:smoke] OK');
