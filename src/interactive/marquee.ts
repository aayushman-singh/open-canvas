// src/interactive/marquee.ts
//
// Schema-owned marquee primitive. The renderer/editor wrapper emits
// data-opencanvas-marquee* attributes; this runtime turns the element's visual
// children into a duplicated belt and drives a continuous WAAPI transform.
// Malformed authored attributes dispatch `opencanvas:marquee-failure` and
// throw instead of silently degrading.

export interface MarqueeRuntimeOptions {
  reducedMotion?: 'no-preference' | 'reduce';
}

export interface MarqueeStyle {
  display: string;
  alignItems: string;
  width: string;
  minWidth: string;
  height: string;
  willChange: string;
  gridTemplateRows?: string;
  rowGap?: string;
  pointerEvents?: string;
  overflow?: string;
  flex?: string;
}

export interface MarqueeElement {
  nodeType: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelectorAll(selector: string): MarqueeElementList;
  querySelector(selector: string): MarqueeElement | null;
  appendChild(node: MarqueeElement): MarqueeElement;
  removeChild(node: MarqueeElement): MarqueeElement;
  closest(selector: string): MarqueeElement | null;
  addEventListener(type: string, listener: (ev: Record<string, unknown>) => void): void;
  getBoundingClientRect?(): { width: number };
  animate?(keyframes: Record<string, string>[], options: Record<string, string | number>): MarqueeAnimation;
  style: MarqueeStyle;
  firstChild: MarqueeElement | null;
  classList?: {
    contains(token: string): boolean;
  };
  inert?: boolean;
  className?: string;
  scrollWidth?: number;
  clientWidth?: number;
  cloneNode(deep?: boolean): MarqueeElement;
}

export interface MarqueeElementList {
  length: number;
  [index: number]: MarqueeElement | undefined;
}

export interface MarqueeAnimation {
  currentTime?: number | null;
  playbackRate?: number;
  pause(): void;
  play(): void;
}

export interface MarqueeDocument {
  createElement(tagName: string): MarqueeElement;
  querySelectorAll(selectors: string): MarqueeElementList;
}

export interface MarqueeWindow {
  dispatchEvent(event: Record<string, unknown>): boolean;
  matchMedia(query: string): { matches: boolean };
}

export interface MarqueeCustomEvent {
  detail: unknown;
}

declare const document: MarqueeDocument;
declare const window: MarqueeWindow;
declare const CustomEvent: new (typeArg: string, eventInitDict?: { detail: unknown }) => Record<string, unknown>;

// Local narrow structural types to satisfy root compiler without DOM library
export interface ParentNode {
  querySelectorAll(selectors: string): MarqueeElementList;
}

export function emitMarqueeFailure(
  el: { getAttribute?(name: string): string | null } | null,
  code: string,
  message: string,
  cause: unknown
): never {
  const detail = {
    code: code,
    message: message,
    elementId: el && typeof el.getAttribute === 'function' ? el.getAttribute('data-opencanvas-element') : null,
    cause: cause ? String((cause as Record<string, unknown>) && (cause as Record<string, unknown>).message ? (cause as Record<string, unknown>).message : cause) : null
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:marquee-failure', { detail: detail }));
  }
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[opencanvas marquee] ' + message, detail);
  }
  throw new Error('[opencanvas marquee] ' + message);
}

export function marqueePrefersReducedMotion(options?: MarqueeRuntimeOptions): boolean {
  if (options && options.reducedMotion === 'reduce') return true;
  if (options && options.reducedMotion === 'no-preference') return false;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readMarqueeConfig(el: MarqueeElement): {
  direction: 'left' | 'right';
  speed: number;
  pauseOnHover: boolean;
  hoverReverse: boolean;
  rows: number;
  rowGapPx: number;
  rowOffsetPercent: number;
  reducedMotion: 'static' | 'slow';
} {
  const direction = el.getAttribute('data-opencanvas-marquee-direction');
  if (direction !== 'left' && direction !== 'right') {
    emitMarqueeFailure(el, 'invalid-direction', 'Marquee direction must be left or right', direction);
  }
  const speedRaw = el.getAttribute('data-opencanvas-marquee-speed');
  const speed = speedRaw === null ? NaN : Number(speedRaw);
  if (!isFinite(speed) || speed <= 0) {
    emitMarqueeFailure(el, 'invalid-speed', 'Marquee speed must be a finite number > 0', speedRaw);
  }
  const reducedMotion = el.getAttribute('data-opencanvas-marquee-reduced-motion');
  if (reducedMotion !== 'static' && reducedMotion !== 'slow') {
    emitMarqueeFailure(el, 'invalid-reduced-motion', 'Marquee reduced-motion mode must be static or slow', reducedMotion);
  }
  const pauseOnHover = el.getAttribute('data-opencanvas-marquee-pause') === 'true';
  const hoverReverse = el.getAttribute('data-opencanvas-marquee-hover-reverse') === 'true';
  if (pauseOnHover && hoverReverse) {
    emitMarqueeFailure(el, 'hover-mode-conflict', 'Marquee cannot pause and reverse on hover at the same time', null);
  }
  const rowsRaw = el.getAttribute('data-opencanvas-marquee-rows');
  const rows = rowsRaw === null ? 1 : Number(rowsRaw);
  if (!isFinite(rows) || Math.floor(rows) !== rows || rows < 1 || rows > 6) {
    emitMarqueeFailure(el, 'invalid-rows', 'Marquee rows must be an integer between 1 and 6', rowsRaw);
  }
  const rowGapRaw = el.getAttribute('data-opencanvas-marquee-row-gap');
  const rowGapPx = rowGapRaw === null ? 0 : Number(rowGapRaw);
  if (!isFinite(rowGapPx) || rowGapPx < 0 || rowGapPx > 200) {
    emitMarqueeFailure(el, 'invalid-row-gap', 'Marquee row gap must be between 0 and 200px', rowGapRaw);
  }
  const rowOffsetRaw = el.getAttribute('data-opencanvas-marquee-row-offset');
  const rowOffsetPercent = rowOffsetRaw === null ? 50 : Number(rowOffsetRaw);
  if (!isFinite(rowOffsetPercent) || rowOffsetPercent < 0 || rowOffsetPercent > 100) {
    emitMarqueeFailure(el, 'invalid-row-offset', 'Marquee row offset must be between 0 and 100%', rowOffsetRaw);
  }
  return {
    direction: direction,
    speed: speed,
    pauseOnHover: pauseOnHover,
    hoverReverse: hoverReverse,
    rows: rows,
    rowGapPx: rowGapPx,
    rowOffsetPercent: rowOffsetPercent,
    reducedMotion: reducedMotion
  };
}

export function wireMarqueeHover(el: MarqueeElement, animations: MarqueeAnimation[], config: { pauseOnHover: boolean; hoverReverse: boolean }): void {
  if (config.pauseOnHover) {
    el.addEventListener('mouseenter', function(){
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (anim) anim.pause();
      }
    });
    el.addEventListener('mouseleave', function(){
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (anim) anim.play();
      }
    });
  } else if (config.hoverReverse) {
    const normalPlaybackRates: number[] = [];
    for (let r = 0; r < animations.length; r++) {
      const anim = animations[r];
      normalPlaybackRates.push(anim ? anim.playbackRate || 1 : 1);
    }
    el.addEventListener('mouseenter', function(){
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (anim) {
          anim.playbackRate = -Math.abs(normalPlaybackRates[i] || 1);
        }
      }
    });
    el.addEventListener('mouseleave', function(){
      for (let i = 0; i < animations.length; i++) {
        const anim = animations[i];
        if (anim) {
          anim.playbackRate = Math.abs(normalPlaybackRates[i] || 1);
        }
      }
    });
  }
}

export function isMarqueeEditorChrome(node: { nodeType: number; className?: string; hasAttribute?(name: string): boolean } | null): boolean {
  if (!node || node.nodeType !== 1) return false;
  const el = node;
  const cls = typeof el.className === 'string' ? el.className : '';
  return /(^|\s)element-menu-trigger(\s|$)/.test(cls) || /(^|\s)resize-handle(\s|$)/.test(cls) || (typeof el.hasAttribute === 'function' && el.hasAttribute('data-resize-handle'));
}

export function stripMarqueeCloneInteractivity(node: MarqueeElement | null): void {
  if (!node || node.nodeType !== 1) return;
  const el = node;
  el.removeAttribute('id');
  el.setAttribute('aria-hidden', 'true');
  if ('inert' in el) el.inert = true;
  const focusables = el.querySelectorAll('a,button,input,select,textarea,[tabindex]');
  for (let i = 0; i < focusables.length; i++) {
    const item = focusables[i];
    if (item) item.setAttribute('tabindex', '-1');
  }
  const descendants = el.querySelectorAll('[id]');
  for (let j = 0; j < descendants.length; j++) {
    const item = descendants[j];
    if (item) item.removeAttribute('id');
  }
}

export function buildMarqueeLane(el: MarqueeElement, content: MarqueeElement, rowIndex: number): { lane: MarqueeElement, content: MarqueeElement } {
  const lane = document.createElement('div');
  lane.setAttribute('data-opencanvas-marquee-lane', String(rowIndex));
  lane.style.display = 'flex';
  lane.style.alignItems = 'stretch';
  lane.style.width = 'max-content';
  lane.style.minWidth = '100%';
  lane.style.height = '100%';
  lane.style.willChange = 'transform';
  const rowContent = rowIndex === 0 ? content : content.cloneNode(true);
  if (!rowContent || rowContent.nodeType !== 1) {
    emitMarqueeFailure(el, 'row-clone-failed', 'Marquee row content clone did not produce an element', null);
  }
  if (rowIndex > 0) stripMarqueeCloneInteractivity(rowContent);
  const clone = rowContent.cloneNode(true);
  if (!clone || clone.nodeType !== 1) {
    emitMarqueeFailure(el, 'clone-failed', 'Marquee content clone did not produce an element', null);
  }
  stripMarqueeCloneInteractivity(clone);
  clone.style.pointerEvents = 'none';
  lane.appendChild(rowContent);
  lane.appendChild(clone);
  return { lane: lane, content: rowContent };
}

export function hydrateMarquees(scope: ParentNode, options: MarqueeRuntimeOptions = {}): void {
  const root = scope || document;
  const nodes = root.querySelectorAll('[data-opencanvas-marquee="true"]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!el) continue;
    if (el.getAttribute('data-opencanvas-marquee-hydrated') === 'true') continue;
    const config = readMarqueeConfig(el);
    const reduce = marqueePrefersReducedMotion(options);
    if (reduce && config.reducedMotion === 'static') {
      el.setAttribute('data-opencanvas-marquee-hydrated', 'true');
      el.setAttribute('data-opencanvas-marquee-reduced', 'static');
      continue;
    }
    if (typeof el.animate !== 'function') {
      emitMarqueeFailure(el, 'missing-waapi', 'Marquee requires Element.animate support', null);
    }
    if (reduce && config.reducedMotion === 'slow') {
      config.speed = Math.max(1, config.speed / 4);
      el.setAttribute('data-opencanvas-marquee-reduced', 'slow');
    }
    const belt = document.createElement('div');
    belt.setAttribute('data-opencanvas-marquee-belt', 'true');
    belt.style.display = config.rows > 1 ? 'grid' : 'flex';
    belt.style.alignItems = 'stretch';
    if (config.rows > 1) {
      belt.style.gridTemplateRows = 'repeat(' + config.rows + ', minmax(0, 1fr))';
      belt.style.rowGap = config.rowGapPx + 'px';
    }
    belt.style.width = 'max-content';
    belt.style.minWidth = '100%';
    belt.style.height = '100%';
    belt.style.willChange = 'transform';
    const content = document.createElement('div');
    content.setAttribute('data-opencanvas-marquee-content', 'true');
    content.style.display = 'inline-flex';
    content.style.alignItems = 'center';
    content.style.flex = '0 0 auto';
    content.style.minWidth = '100%';
    content.style.height = '100%';
    const chrome: MarqueeElement[] = [];
    while (el.firstChild) {
      const child = el.firstChild;
      el.removeChild(child);
      if (isMarqueeEditorChrome(child)) {
        chrome.push(child);
      } else {
        content.appendChild(child);
      }
    }
    if (!content.firstChild) {
      emitMarqueeFailure(el, 'empty-content', 'Marquee element has no visual content to animate', null);
    }
    const lanes: Array<{ lane: MarqueeElement, content: MarqueeElement }> = [];
    for (let rowIndex = 0; rowIndex < config.rows; rowIndex++) {
      const lane = buildMarqueeLane(el, content, rowIndex);
      lanes.push(lane);
      belt.appendChild(lane.lane);
    }
    el.appendChild(belt);
    for (let c = 0; c < chrome.length; c++) {
      const child = chrome[c];
      if (child) el.appendChild(child);
    }
    el.style.overflow = 'hidden';
    const firstContent = lanes[0] ? lanes[0].content : null;
    let width = firstContent && firstContent.getBoundingClientRect ? firstContent.getBoundingClientRect().width : 0;
    if (!(width > 0)) {
      width = content.scrollWidth || (belt.scrollWidth ? belt.scrollWidth / 2 : 0);
    }
    if (!(width > 0)) {
      width = el.clientWidth || 0;
    }
    if (!(width > 0)) {
      emitMarqueeFailure(el, 'zero-width', 'Marquee content width must be measurable', null);
    }
    const duration = Math.max(100, Math.round(width / config.speed * 1000));
    const frames = config.direction === 'left'
      ? [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(-' + width + 'px,0,0)' }]
      : [{ transform: 'translate3d(-' + width + 'px,0,0)' }, { transform: 'translate3d(0,0,0)' }];
    const animations: MarqueeAnimation[] = [];
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const laneObj = lanes[laneIndex];
      if (!laneObj || typeof laneObj.lane.animate !== 'function') {
        emitMarqueeFailure(el, 'missing-waapi', 'Marquee requires Element.animate support', null);
      }
      const animation = laneObj.lane.animate(frames, { duration: duration, iterations: Infinity, easing: 'linear' });
      if (laneIndex > 0 && config.rowOffsetPercent > 0) {
        try {
          animation.currentTime = duration * (((config.rowOffsetPercent / 100) * laneIndex) % 1);
        } catch (err) {
          emitMarqueeFailure(el, 'row-stagger-failed', 'Marquee row animation phase could not be staggered', err);
        }
      }
      animations.push(animation);
    }
    wireMarqueeHover(el, animations, config);
    el.setAttribute('data-opencanvas-marquee-hydrated', 'true');
  }
}

export const MARQUEE_RUNTIME_SRC = [
  emitMarqueeFailure,
  marqueePrefersReducedMotion,
  readMarqueeConfig,
  wireMarqueeHover,
  isMarqueeEditorChrome,
  stripMarqueeCloneInteractivity,
  buildMarqueeLane,
  hydrateMarquees,
]
  .map((fn) => fn.toString())
  .join('\n');
