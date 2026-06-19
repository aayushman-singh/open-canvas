// src/editor-client/hydrate-interactives.ts
//
// TS-native counterpart to the visitor IIFE runtime. The visitor receives
// an inline <script> built from `RUNTIME_ENTRY_SRC + CAROUSEL_RUNTIME_SRC +
// ACCORDION_RUNTIME_SRC + POPUP_RUNTIME_SRC` (see
// `src/interactive/build.ts`). The editor — whose DOM is constructed by
// `body-builders-data.ts` rather than a pre-rendered snapshot — calls
// `hydrateInteractives()` to mount the SAME behaviour on its live DOM.
// The functions below mirror the runtime fragments line-by-line.
//
// Why this lives here and not under `src/interactive/`: the visitor-side
// modules in `src/interactive/` ship as JS source strings (vanilla ES5,
// no DOM types pulled in) so the root tsconfig's worker-typed compile
// stays tight. This module reaches for the DOM directly, which only the
// `editor-client` tsconfig allows (`lib: ["DOM", ...]`).
//
// Editor-vs-visitor contract differences:
//   - The editor calls this AFTER every renderAll so newly-mounted
//     carousels / accordions get listeners.
//   - The editor passes `{ skipPopups: true }` so a delay-popup or
//     exit-intent popup never fires while the Owner is editing — popups
//     are visitor-only chrome.
//   - Every event handler calls stopPropagation so the editor's drag/select
//     root listener on `ctx.root` does NOT receive the click. The visitor
//     runtime doesn't need this (no competing root listener) but the same
//     handler runs against both, so the visitor pays one cheap no-op.
//   - Idempotent — re-running against an already-hydrated wrapper short-
//     circuits via the `data-opencanvas-hydrated="true"` flag, matching the
//     visitor runtime's contract.

import type { EditableSite } from '../canvas/schema.js';
import { hydrateBehaviourPreview } from './hydrate-behaviour.js';

export interface HydrateOptions {
  /** When true, popup sections (`[data-opencanvas-popup="true"]`) are
   *  skipped. The editor passes `true` so an Owner editing a popup-
   *  triggered section doesn't get the popup chrome (overlay + close
   *  button) hijacking the canvas. Defaults to false (full visitor parity). */
  skipPopups?: boolean;
  /** Editable site state for behaviour primitive preview hydration. */
  behaviourState?: EditableSite;
  /** Asset base path used to resolve image-sequence frame URLs in preview. */
  behaviourAssetBasePath?: string;
  /** Explicit authoring override for previewing visitor reduced-motion paths. */
  reducedMotion?: 'no-preference' | 'reduce';
}

export interface RuntimeHydratorOptions extends HydrateOptions {
  /** Diagnostic reason supplied by visitor/editor/live-publish callers. */
  reason?: string;
}

declare global {
  interface Window {
    __opencanvasHydrate?: (scope?: ParentNode, options?: RuntimeHydratorOptions) => void;
  }
}

/**
 * Editor Runtime Hydrator boundary. Visitor pages expose the same
 * window.__opencanvasHydrate name from src/interactive/runtime.ts; the editor
 * installs a TS-native implementation that delegates to the existing editor
 * hydrators, then consumes the same named entrypoint after every render.
 */
export function installEditorRuntimeHydrator(baseOptions: HydrateOptions): void {
  window.__opencanvasHydrate = (scope?: ParentNode, options: RuntimeHydratorOptions = {}): void => {
    const { reason: _reason, ...runtimeOptions } = options;
    hydrateInteractives(scope ?? document, { ...baseOptions, ...runtimeOptions });
  };
}

export function runEditorRuntimeHydrator(
  root: ParentNode,
  options: RuntimeHydratorOptions,
): void {
  installEditorRuntimeHydrator(options);
  const hydrate = window.__opencanvasHydrate;
  if (typeof hydrate !== 'function') {
    throw new Error('Runtime Hydrator missing in editor after install');
  }
  hydrate(root, options);
}

/**
 * Walk `root` (any element subtree, typically the editor's canvas-root)
 * and hydrate every `[data-opencanvas-interactive]` element that is not
 * already hydrated.
 *
 * Mirrors the visitor runtime's `hydrateAll()` dispatch in
 * `./runtime.ts` — same data-attribute contract, same idempotence guard.
 */
export function hydrateInteractives(
  root: ParentNode,
  options: HydrateOptions = {},
): void {
  const wrappers = root.querySelectorAll('[data-opencanvas-interactive]');
  for (let i = 0; i < wrappers.length; i++) {
    const wrapper = wrappers[i];
    if (!(wrapper instanceof HTMLElement)) continue;
    if (wrapper.getAttribute('data-opencanvas-hydrated') === 'true') continue;
    wrapper.setAttribute('data-opencanvas-hydrated', 'true');
    const kind = wrapper.getAttribute('data-opencanvas-interactive');
    if (kind === 'carousel') {
      hydrateCarousel(wrapper);
    } else if (kind === 'accordion') {
      hydrateAccordion(wrapper);
    } else {
      // Unknown interactive kind. Per the no-fallback rule, log loudly so
      // a future interactive added without a TS hydrator surfaces here
      // instead of silently no-oping in the editor.
      console.error(
        '[hydrateInteractives] unknown interactive kind "' +
          String(kind) +
          '" on element ' +
          (wrapper.id || '<no id>') +
          '; add a hydrator to src/editor-client/hydrate-interactives.ts',
      );
    }
  }
  if (!options.skipPopups) {
    hydratePopups(root);
  }
  // ADR 0066 dec 4 — pointer-fx is a document-wide pass keyed on the
  // [data-opencanvas-pointer-fx] attribute (not a data-opencanvas-interactive
  // dispatch arm), mirroring hydratePointerFx in `./pointer-fx.ts` so the
  // editor preview reacts to the cursor exactly as the published site does.
  hydratePointerFx(root, options);
  if (options.behaviourState && options.behaviourAssetBasePath) {
    hydrateBehaviourPreview(root, options.behaviourState, options.behaviourAssetBasePath, options.reducedMotion);
  }
  hydrateMarquees(root, options);
  hydrateVideoHoverStreams(root, options);
}

function prefersReducedMotion(options: HydrateOptions): boolean {
  if (options.reducedMotion === 'reduce') return true;
  if (options.reducedMotion === 'no-preference') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Video Stream Hover — mirrors VIDEO_HOVER_RUNTIME_SRC in `src/interactive/video-hover.ts`.
// ---------------------------------------------------------------------------

function failVideoHover(
  video: HTMLVideoElement,
  code: string,
  message: string,
  cause: string | Error | null,
): never {
  const wrapper = video.closest('[data-opencanvas-element]');
  const detail = {
    code,
    message,
    elementId: wrapper?.getAttribute('data-opencanvas-element') ?? null,
    cause: cause instanceof Error ? cause.message : cause,
  };
  window.dispatchEvent(new CustomEvent('opencanvas:video-hover-failure', { detail }));
  console.error('[opencanvas video-hover] ' + message, detail);
  throw new Error('[opencanvas video-hover] ' + message);
}

function readVideoHoverConfig(video: HTMLVideoElement): {
  mode: 'play-pause' | 'play-reset';
  scrubOnHover: boolean;
  reducedMotion: 'disabled' | 'allow';
  streamSrc: string | null;
  posterSrc: string | null;
  intentDelayMs: number;
} {
  const mode = video.getAttribute('data-opencanvas-video-hover-mode');
  if (mode !== 'play-pause' && mode !== 'play-reset') {
    failVideoHover(video, 'invalid-mode', 'Video hover mode must be play-pause or play-reset', mode);
  }
  const reducedMotion = video.getAttribute('data-opencanvas-video-hover-reduced-motion');
  if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
    failVideoHover(
      video,
      'invalid-reduced-motion',
      'Video hover reduced-motion mode must be disabled or allow',
      reducedMotion,
    );
  }
  const scrubOnHover = video.getAttribute('data-opencanvas-video-hover-scrub') === 'true';
  const streamSrc = video.getAttribute('data-opencanvas-video-hover-stream-src');
  if (streamSrc !== null && streamSrc.trim() === '') {
    failVideoHover(
      video,
      'stream-src-empty',
      'Video hover alternate stream source cannot be empty',
      streamSrc,
    );
  }
  const posterSrc = video.getAttribute('data-opencanvas-video-hover-poster-src');
  if (posterSrc !== null && posterSrc.trim() === '') {
    failVideoHover(
      video,
      'poster-src-empty',
      'Video hover alternate poster source cannot be empty',
      posterSrc,
    );
  }
  const intentDelayAttr = video.getAttribute('data-opencanvas-video-hover-intent-delay-ms');
  let intentDelayMs = 0;
  if (intentDelayAttr !== null) {
    intentDelayMs = Number(intentDelayAttr);
    if (!Number.isFinite(intentDelayMs) || intentDelayMs < 0 || intentDelayMs > 5000) {
      failVideoHover(
        video,
        'invalid-intent-delay',
        'Video hover intent delay must be between 0 and 5000ms',
        intentDelayAttr,
      );
    }
  }
  return { mode, scrubOnHover, reducedMotion, streamSrc, posterSrc, intentDelayMs };
}

function videoHoverError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (typeof err === 'number' || typeof err === 'boolean') return new Error(String(err));
  return new Error('non-error video hover failure');
}

function setVideoHoverSource(
  video: HTMLVideoElement,
  src: string | null,
  poster: string | null,
  code: string,
): void {
  if (src === null) return;
  try {
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      video.load();
    }
    if (poster !== null) video.setAttribute('poster', poster);
  } catch (err: unknown) {
    failVideoHover(video, code, 'Video hover source swap failed', videoHoverError(err));
  }
}

function restoreVideoHoverSource(
  video: HTMLVideoElement,
  originalSrc: string,
  originalPoster: string | null,
): void {
  if (originalSrc.length === 0) {
    failVideoHover(
      video,
      'original-src-missing',
      'Video hover cannot restore the original video source',
      null,
    );
  }
  try {
    if (video.getAttribute('src') !== originalSrc) {
      video.setAttribute('src', originalSrc);
      video.load();
    }
    if (originalPoster === null) {
      video.removeAttribute('poster');
    } else {
      video.setAttribute('poster', originalPoster);
    }
  } catch (err: unknown) {
    failVideoHover(video, 'source-restore-failed', 'Video hover source restore failed', videoHoverError(err));
  }
}

function scrubVideoHover(video: HTMLVideoElement, target: Element, ev: Event): void {
  if (!(ev instanceof PointerEvent)) return;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    failVideoHover(
      video,
      'scrub-duration-missing',
      'Video hover scrub requires a finite video duration',
      String(video.duration),
    );
  }
  const rect = target.getBoundingClientRect();
  if (!(rect.width > 0)) {
    failVideoHover(
      video,
      'scrub-target-width',
      'Video hover scrub target width must be > 0',
      String(rect.width),
    );
  }
  const progress = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  video.currentTime = progress * duration;
}

function hydrateVideoHoverStreams(scope: ParentNode, options: HydrateOptions = {}): void {
  const videos = scope.querySelectorAll('[data-opencanvas-video-hover="true"]');
  for (let i = 0; i < videos.length; i++) {
    const node = videos[i];
    if (!(node instanceof HTMLVideoElement)) continue;
    if (node.getAttribute('data-opencanvas-video-hover-hydrated') === 'true') continue;
    const config = readVideoHoverConfig(node);
    const reduce = prefersReducedMotion(options);
    if (reduce && config.reducedMotion === 'disabled') {
      node.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
      node.setAttribute('data-opencanvas-video-hover-reduced', 'disabled');
      continue;
    }
    if (typeof node.play !== 'function' || typeof node.pause !== 'function') {
      failVideoHover(node, 'missing-video-api', 'Video hover requires play and pause support', null);
    }
    node.muted = true;
    node.playsInline = true;
    const target = node.closest('[data-opencanvas-element]') ?? node;
    const originalSrc = node.getAttribute('src') ?? '';
    const originalPoster = node.getAttribute('poster');
    if (config.streamSrc !== null && originalSrc.length === 0) {
      failVideoHover(
        node,
        'original-src-missing',
        'Video hover alternate stream requires an original source to restore',
        null,
      );
    }
    let active = false;
    let intentTimer: number | null = null;
    let pendingIntentEvent: Event | null = null;
    const activate = (ev: Event | null): void => {
      try {
        setVideoHoverSource(node, config.streamSrc, config.posterSrc, 'source-swap-failed');
        if (config.scrubOnHover) {
          node.pause();
          if (ev !== null) scrubVideoHover(node, target, ev);
          return;
        }
        if (config.mode === 'play-reset') node.currentTime = 0;
        node.play().catch((err: unknown) => {
          failVideoHover(
            node,
            'play-rejected',
            'Video hover play() was rejected',
            videoHoverError(err),
          );
        });
      } catch (err: unknown) {
        failVideoHover(
          node,
          'play-failed',
          'Video hover play failed',
          videoHoverError(err),
        );
      }
    };
    const enter = (ev: Event): void => {
      if (active) return;
      active = true;
      pendingIntentEvent = ev;
      if (config.intentDelayMs > 0) {
        intentTimer = window.setTimeout((): void => {
          intentTimer = null;
          activate(pendingIntentEvent);
          pendingIntentEvent = null;
        }, config.intentDelayMs);
        return;
      }
      activate(ev);
      pendingIntentEvent = null;
    };
    const leave = (): void => {
      if (!active) return;
      active = false;
      if (intentTimer !== null) {
        window.clearTimeout(intentTimer);
        intentTimer = null;
        pendingIntentEvent = null;
        return;
      }
      try {
        node.pause();
        if (config.mode === 'play-reset') node.currentTime = 0;
        if (config.streamSrc !== null) restoreVideoHoverSource(node, originalSrc, originalPoster);
      } catch (err: unknown) {
        failVideoHover(
          node,
          'pause-failed',
          'Video hover pause failed',
          videoHoverError(err),
        );
      }
    };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('pointermove', (ev: Event): void => {
      if (!active || !config.scrubOnHover) return;
      if (intentTimer !== null) {
        pendingIntentEvent = ev;
        return;
      }
      scrubVideoHover(node, target, ev);
    });
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    node.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
  }
}

// ---------------------------------------------------------------------------
// Marquee — mirrors MARQUEE_RUNTIME_SRC in `src/interactive/marquee.ts`.
// ---------------------------------------------------------------------------

function failMarquee(el: HTMLElement, code: string, message: string, cause: string | null): never {
  const detail = {
    code,
    message,
    elementId: el.getAttribute('data-opencanvas-element'),
    cause,
  };
  window.dispatchEvent(new CustomEvent('opencanvas:marquee-failure', { detail }));
  console.error('[opencanvas marquee] ' + message, detail);
  throw new Error('[opencanvas marquee] ' + message);
}

function readMarqueeConfig(el: HTMLElement): {
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
    failMarquee(el, 'invalid-direction', 'Marquee direction must be left or right', direction);
  }
  const speedRaw = el.getAttribute('data-opencanvas-marquee-speed');
  const speed = speedRaw === null ? Number.NaN : Number(speedRaw);
  if (!Number.isFinite(speed) || speed <= 0) {
    failMarquee(el, 'invalid-speed', 'Marquee speed must be a finite number > 0', speedRaw);
  }
  const reducedMotion = el.getAttribute('data-opencanvas-marquee-reduced-motion');
  if (reducedMotion !== 'static' && reducedMotion !== 'slow') {
    failMarquee(
      el,
      'invalid-reduced-motion',
      'Marquee reduced-motion mode must be static or slow',
      reducedMotion,
    );
  }
  const pauseOnHover = el.getAttribute('data-opencanvas-marquee-pause') === 'true';
  const hoverReverse = el.getAttribute('data-opencanvas-marquee-hover-reverse') === 'true';
  if (pauseOnHover && hoverReverse) {
    failMarquee(
      el,
      'hover-mode-conflict',
      'Marquee cannot pause and reverse on hover at the same time',
      null,
    );
  }
  const rowsRaw = el.getAttribute('data-opencanvas-marquee-rows');
  const rows = rowsRaw === null ? 1 : Number(rowsRaw);
  if (!Number.isFinite(rows) || !Number.isInteger(rows) || rows < 1 || rows > 6) {
    failMarquee(el, 'invalid-rows', 'Marquee rows must be an integer between 1 and 6', rowsRaw);
  }
  const rowGapRaw = el.getAttribute('data-opencanvas-marquee-row-gap');
  const rowGapPx = rowGapRaw === null ? 0 : Number(rowGapRaw);
  if (!Number.isFinite(rowGapPx) || rowGapPx < 0 || rowGapPx > 200) {
    failMarquee(el, 'invalid-row-gap', 'Marquee row gap must be between 0 and 200px', rowGapRaw);
  }
  const rowOffsetRaw = el.getAttribute('data-opencanvas-marquee-row-offset');
  const rowOffsetPercent = rowOffsetRaw === null ? 50 : Number(rowOffsetRaw);
  if (!Number.isFinite(rowOffsetPercent) || rowOffsetPercent < 0 || rowOffsetPercent > 100) {
    failMarquee(
      el,
      'invalid-row-offset',
      'Marquee row offset must be between 0 and 100%',
      rowOffsetRaw,
    );
  }
  return {
    direction,
    speed,
    pauseOnHover,
    hoverReverse,
    rows,
    rowGapPx,
    rowOffsetPercent,
    reducedMotion,
  };
}

function wireMarqueeHover(
  node: HTMLElement,
  animations: Animation[],
  config: { pauseOnHover: boolean; hoverReverse: boolean },
): void {
  if (config.pauseOnHover) {
    node.addEventListener('mouseenter', () => {
      for (const animation of animations) animation.pause();
    });
    node.addEventListener('mouseleave', () => {
      for (const animation of animations) animation.play();
    });
  } else if (config.hoverReverse) {
    const normalPlaybackRates = animations.map((animation) => animation.playbackRate || 1);
    node.addEventListener('mouseenter', () => {
      for (let i = 0; i < animations.length; i++) {
        animations[i]!.playbackRate = -Math.abs(normalPlaybackRates[i] ?? 1);
      }
    });
    node.addEventListener('mouseleave', () => {
      for (let i = 0; i < animations.length; i++) {
        animations[i]!.playbackRate = Math.abs(normalPlaybackRates[i] ?? 1);
      }
    });
  }
}

function isMarqueeEditorChrome(node: ChildNode): boolean {
  if (!(node instanceof HTMLElement)) return false;
  return (
    node.classList.contains('element-menu-trigger') ||
    node.classList.contains('resize-handle') ||
    node.hasAttribute('data-resize-handle')
  );
}

function stripMarqueeCloneInteractivity(node: HTMLElement): void {
  node.removeAttribute('id');
  node.setAttribute('aria-hidden', 'true');
  node.inert = true;
  const focusables = node.querySelectorAll('a,button,input,select,textarea,[tabindex]');
  for (let i = 0; i < focusables.length; i++) {
    focusables[i]?.setAttribute('tabindex', '-1');
  }
  const descendants = node.querySelectorAll('[id]');
  for (let i = 0; i < descendants.length; i++) {
    descendants[i]?.removeAttribute('id');
  }
}

function buildMarqueeLane(
  node: HTMLElement,
  content: HTMLElement,
  rowIndex: number,
): { lane: HTMLElement; content: HTMLElement } {
  const lane = document.createElement('div');
  lane.setAttribute('data-opencanvas-marquee-lane', String(rowIndex));
  lane.style.display = 'flex';
  lane.style.alignItems = 'stretch';
  lane.style.width = 'max-content';
  lane.style.minWidth = '100%';
  lane.style.height = '100%';
  lane.style.willChange = 'transform';
  const rowContent = rowIndex === 0 ? content : content.cloneNode(true);
  if (!(rowContent instanceof HTMLElement)) {
    failMarquee(node, 'row-clone-failed', 'Marquee row content clone did not produce an element', null);
  }
  if (rowIndex > 0) stripMarqueeCloneInteractivity(rowContent);
  const clone = rowContent.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    failMarquee(node, 'clone-failed', 'Marquee content clone did not produce an HTMLElement', null);
  }
  stripMarqueeCloneInteractivity(clone);
  clone.style.pointerEvents = 'none';
  lane.appendChild(rowContent);
  lane.appendChild(clone);
  return { lane, content: rowContent };
}

function hydrateMarquees(scope: ParentNode, options: HydrateOptions = {}): void {
  const nodes = scope.querySelectorAll('[data-opencanvas-marquee="true"]');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!(node instanceof HTMLElement)) continue;
    if (node.getAttribute('data-opencanvas-marquee-hydrated') === 'true') continue;
    const config = readMarqueeConfig(node);
    const reduce = prefersReducedMotion(options);
    if (reduce && config.reducedMotion === 'static') {
      node.setAttribute('data-opencanvas-marquee-hydrated', 'true');
      node.setAttribute('data-opencanvas-marquee-reduced', 'static');
      continue;
    }
    if (typeof node.animate !== 'function') {
      failMarquee(node, 'missing-waapi', 'Marquee requires Element.animate support', null);
    }
    if (reduce && config.reducedMotion === 'slow') {
      config.speed = Math.max(1, config.speed / 4);
      node.setAttribute('data-opencanvas-marquee-reduced', 'slow');
    }
    const belt = document.createElement('div');
    belt.setAttribute('data-opencanvas-marquee-belt', 'true');
    belt.style.display = config.rows > 1 ? 'grid' : 'flex';
    belt.style.alignItems = 'stretch';
    if (config.rows > 1) {
      belt.style.gridTemplateRows = 'repeat(' + String(config.rows) + ', minmax(0, 1fr))';
      belt.style.rowGap = String(config.rowGapPx) + 'px';
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
    const chrome: ChildNode[] = [];
    while (node.firstChild) {
      const child = node.firstChild;
      node.removeChild(child);
      if (isMarqueeEditorChrome(child)) {
        chrome.push(child);
      } else {
        content.appendChild(child);
      }
    }
    if (!content.firstChild) {
      failMarquee(node, 'empty-content', 'Marquee element has no visual content to animate', null);
    }
    const lanes: Array<{ lane: HTMLElement; content: HTMLElement }> = [];
    for (let rowIndex = 0; rowIndex < config.rows; rowIndex++) {
      const lane = buildMarqueeLane(node, content, rowIndex);
      lanes.push(lane);
      belt.appendChild(lane.lane);
    }
    node.appendChild(belt);
    for (const child of chrome) node.appendChild(child);
    node.style.overflow = 'hidden';
    const firstContent = lanes[0]!.content;
    let width = firstContent.getBoundingClientRect().width;
    if (!(width > 0)) width = content.scrollWidth || belt.scrollWidth / 2 || node.clientWidth || 0;
    if (!(width > 0)) {
      failMarquee(node, 'zero-width', 'Marquee content width must be measurable', null);
    }
    const duration = Math.max(100, Math.round((width / config.speed) * 1000));
    const frames =
      config.direction === 'left'
        ? [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(-' + width + 'px,0,0)' }]
        : [{ transform: 'translate3d(-' + width + 'px,0,0)' }, { transform: 'translate3d(0,0,0)' }];
    const animations: Animation[] = [];
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      const animation = lanes[laneIndex]!.lane.animate(frames, {
        duration,
        iterations: Infinity,
        easing: 'linear',
      });
      if (laneIndex > 0 && config.rowOffsetPercent > 0) {
        try {
          animation.currentTime = duration * (((config.rowOffsetPercent / 100) * laneIndex) % 1);
        } catch (err: unknown) {
          failMarquee(
            node,
            'row-stagger-failed',
            'Marquee row animation phase could not be staggered',
            err instanceof Error ? err.message : String(err),
          );
        }
      }
      animations.push(animation);
    }
    wireMarqueeHover(node, animations, config);
    node.setAttribute('data-opencanvas-marquee-hydrated', 'true');
  }
}

// ---------------------------------------------------------------------------
// Pointer-fx — mirrors POINTER_FX_RUNTIME_SRC in `src/interactive/pointer-fx.ts`.
// Publishes pointer state as CSS custom properties; never paints. Idempotent via
// the data-opencanvas-pfx-hydrated marker. Recentres on pointerleave so the
// authored static base (ADR dec 6) is restored.
// ---------------------------------------------------------------------------

function hydratePointerFx(scope: ParentNode, options: HydrateOptions = {}): void {
  const nodes = scope.querySelectorAll('[data-opencanvas-pointer-fx]');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (!(el instanceof HTMLElement)) continue;
    if (el.getAttribute('data-opencanvas-pfx-hydrated') === 'true') continue;
    const primitive = el.getAttribute('data-opencanvas-pointer-fx');
    const reducedMotion = el.getAttribute('data-opencanvas-pointer-fx-reduced-motion');
    if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
      failPointerFx(
        el,
        'invalid-reduced-motion',
        'Pointer FX reduced-motion mode must be disabled or allow',
        reducedMotion,
      );
    }
    const reduce = prefersReducedMotion(options);
    if (reduce && reducedMotion === 'disabled') {
      el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
      el.setAttribute('data-opencanvas-pointer-fx-reduced', 'disabled');
      continue;
    }
    el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
    if (primitive === 'spotlight') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const px = ((ev.clientX - r.left) / r.width) * 100;
        const py = ((ev.clientY - r.top) / r.height) * 100;
        el.style.setProperty('--opencanvas-ptr-x', px.toFixed(2) + '%');
        el.style.setProperty('--opencanvas-ptr-y', py.toFixed(2) + '%');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-ptr-x', '50%');
        el.style.setProperty('--opencanvas-ptr-y', '50%');
      });
    } else if (primitive === 'reveal-mask') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const px = ((ev.clientX - r.left) / r.width) * 100;
        const py = ((ev.clientY - r.top) / r.height) * 100;
        el.style.setProperty('--opencanvas-reveal-x', px.toFixed(2) + '%');
        el.style.setProperty('--opencanvas-reveal-y', py.toFixed(2) + '%');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-reveal-x', '50%');
        el.style.setProperty('--opencanvas-reveal-y', '50%');
      });
    } else if (primitive === 'tilt') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--opencanvas-tilt-x', (nx * 12).toFixed(2) + 'deg');
        el.style.setProperty('--opencanvas-tilt-y', (-ny * 12).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-tilt-x', '0deg');
        el.style.setProperty('--opencanvas-tilt-y', '0deg');
      });
    } else if (primitive === 'magnetic') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--opencanvas-magnetic-x', (nx * 24).toFixed(2) + 'px');
        el.style.setProperty('--opencanvas-magnetic-y', (ny * 24).toFixed(2) + 'px');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-magnetic-x', '0px');
        el.style.setProperty('--opencanvas-magnetic-y', '0px');
      });
    } else if (primitive === 'cursor-follow') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--opencanvas-cursor-follow-x', (nx * 96).toFixed(2) + 'px');
        el.style.setProperty('--opencanvas-cursor-follow-y', (ny * 96).toFixed(2) + 'px');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-cursor-follow-x', '0px');
        el.style.setProperty('--opencanvas-cursor-follow-y', '0px');
      });
    } else if (primitive === 'pointer-parallax') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        const r = el.getBoundingClientRect();
        if (!(r.width > 0) || !(r.height > 0)) return;
        const nx = (ev.clientX - r.left) / r.width - 0.5;
        const ny = (ev.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--opencanvas-parallax-x', (nx * -18).toFixed(2) + 'px');
        el.style.setProperty('--opencanvas-parallax-y', (ny * -18).toFixed(2) + 'px');
      });
      el.addEventListener('pointerleave', (): void => {
        el.style.setProperty('--opencanvas-parallax-x', '0px');
        el.style.setProperty('--opencanvas-parallax-y', '0px');
      });
    } else if (primitive === 'cursor-trail') {
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        appendPointerTrail(el, ev);
      });
    } else if (primitive === 'image-follow') {
      const img = appendPointerImageFollow(el, el.getAttribute('data-opencanvas-pointer-fx-preview-src'));
      el.addEventListener('pointermove', (ev: PointerEvent): void => {
        positionPointerImageFollow(el, img, ev);
      });
      el.addEventListener('pointerleave', (): void => {
        img.setAttribute('data-opencanvas-pointer-image-follow-active', 'false');
      });
    } else {
      failPointerFx(
        el,
        'invalid-primitive',
        'Pointer FX primitive must be spotlight, tilt, magnetic, cursor-follow, reveal-mask, pointer-parallax, cursor-trail, or image-follow',
        primitive,
      );
    }
  }
}

function appendPointerImageFollow(el: HTMLElement, previewSrc: string | null): HTMLImageElement {
  if (!previewSrc) {
    failPointerFx(
      el,
      'image-follow-src-missing',
      'Pointer FX image-follow requires preview asset metadata',
      previewSrc,
    );
  }
  const img = el.ownerDocument.createElement('img');
  img.className = 'opencanvas-pointer-image-follow';
  img.setAttribute('src', previewSrc);
  img.setAttribute('alt', '');
  img.setAttribute('aria-hidden', 'true');
  el.appendChild(img);
  return img;
}

function positionPointerImageFollow(el: HTMLElement, img: HTMLImageElement, ev: PointerEvent): void {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  const px = ((ev.clientX - r.left) / r.width) * 100;
  const py = ((ev.clientY - r.top) / r.height) * 100;
  img.style.left = px.toFixed(2) + '%';
  img.style.top = py.toFixed(2) + '%';
  img.setAttribute('data-opencanvas-pointer-image-follow-active', 'true');
}

function appendPointerTrail(el: HTMLElement, ev: PointerEvent): void {
  const r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  const px = ((ev.clientX - r.left) / r.width) * 100;
  const py = ((ev.clientY - r.top) / r.height) * 100;
  const trail = el.ownerDocument.createElement('span');
  trail.className = 'opencanvas-pointer-trail';
  trail.setAttribute('aria-hidden', 'true');
  trail.style.left = px.toFixed(2) + '%';
  trail.style.top = py.toFixed(2) + '%';
  el.appendChild(trail);
  setTimeout(() => {
    trail.remove();
  }, 560);
}

function failPointerFx(
  el: HTMLElement,
  code: string,
  message: string,
  cause: string | null,
): never {
  const detail = {
    code,
    message,
    elementId: el.getAttribute('data-opencanvas-element'),
    cause,
  };
  window.dispatchEvent(new CustomEvent('opencanvas:pointer-fx-failure', { detail }));
  console.error('[opencanvas pointer-fx] ' + message, detail);
  throw new Error('[opencanvas pointer-fx] ' + message);
}

// ---------------------------------------------------------------------------
// Carousel — mirrors CAROUSEL_RUNTIME_SRC in `./carousel.ts`. Same selector
// shape, same index clamp, same dot aria-selected mirroring. Adds
// stopPropagation so the editor's root drag/select handler does NOT also
// fire when the Owner clicks an arrow / dot. The visitor runtime omits
// stopPropagation; the editor's drag-resize wiring separately bails on
// pointerdown when the target is inside an arrow / dot (see
// `src/editor-client/drag-resize.ts`).
// ---------------------------------------------------------------------------

function hydrateCarousel(root: HTMLElement): void {
  const countAttr = root.getAttribute('data-opencanvas-slide-count');
  const count = countAttr ? parseInt(countAttr, 10) : 0;
  if (!(count > 0)) {
    // Empty carousel — nothing to hydrate. Mirror visitor runtime: a zero-
    // slide carousel renders only the chrome and the wrapper.
    return;
  }
  function readIndex(): number {
    const raw = root.getAttribute('data-opencanvas-slide-index');
    let n = raw ? parseInt(raw, 10) : 0;
    if (isNaN(n) || n < 0) n = 0;
    if (n > count - 1) n = count - 1;
    return n;
  }
  // ADR 0066 — mirror CAROUSEL_RUNTIME_SRC's per-slide --opencanvas-slide-offset
  // publishing so the editor preview's `coverflow` variant paints identically
  // to the published site.
  function publishOffsets(active: number): void {
    const slides = root.querySelectorAll('[data-opencanvas-carousel-slide-index]');
    for (let s = 0; s < slides.length; s++) {
      const slide = slides[s];
      if (!(slide instanceof HTMLElement)) continue;
      const sIdx = parseInt(slide.getAttribute('data-opencanvas-carousel-slide-index') || '0', 10);
      slide.style.setProperty('--opencanvas-slide-offset', String(sIdx - active));
    }
  }
  function setIndex(next: number): void {
    let n = next;
    if (n < 0) n = 0;
    if (n > count - 1) n = count - 1;
    root.setAttribute('data-opencanvas-slide-index', String(n));
    const dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (!dot) continue;
      const dotIdx = parseInt(dot.getAttribute('data-opencanvas-carousel-dot') || '0', 10);
      dot.setAttribute('aria-selected', dotIdx === n ? 'true' : 'false');
    }
    publishOffsets(n);
  }
  publishOffsets(readIndex());
  // Each event handler stops propagation so the editor's root mousedown +
  // click listeners don't ALSO process the same event (drag-start or
  // element-deselect). Mousedown blockers run before drag-resize's root
  // mousedown handler thanks to bubble-order.
  function block(ev: Event): void {
    ev.preventDefault();
    ev.stopPropagation();
  }
  const prev = root.querySelector('[data-opencanvas-carousel-prev]');
  if (prev) {
    prev.addEventListener('mousedown', block);
    prev.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setIndex(readIndex() - 1);
    });
  }
  const next = root.querySelector('[data-opencanvas-carousel-next]');
  if (next) {
    next.addEventListener('mousedown', block);
    next.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopPropagation();
      setIndex(readIndex() + 1);
    });
  }
  const dots = root.querySelectorAll('[data-opencanvas-carousel-dot]');
  for (let i = 0; i < dots.length; i++) {
    const dot = dots[i];
    if (!dot) continue;
    ((capturedDot: Element): void => {
      capturedDot.addEventListener('mousedown', block);
      capturedDot.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        const target = parseInt(
          capturedDot.getAttribute('data-opencanvas-carousel-dot') || '0',
          10,
        );
        setIndex(target);
      });
    })(dot);
  }
}

// ---------------------------------------------------------------------------
// Accordion — mirrors ACCORDION_RUNTIME_SRC in `./accordion.ts`. Multi-open
// vs single-open semantics, aria-expanded mirroring, hidden attr toggle on
// the body region. Same Enter / Space keyboard contract.
// ---------------------------------------------------------------------------

function hydrateAccordion(root: HTMLElement): void {
  const multi = root.getAttribute('data-opencanvas-allow-multi-open') === 'true';
  function setItemOpen(item: Element, open: boolean): void {
    if (open) {
      item.setAttribute('data-opencanvas-acc-open', 'true');
    } else {
      item.removeAttribute('data-opencanvas-acc-open');
    }
    const toggles = item.querySelectorAll('[data-opencanvas-acc-toggle]');
    for (let i = 0; i < toggles.length; i++) {
      const t = toggles[i];
      if (t) t.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    const bodies = item.querySelectorAll('[data-opencanvas-acc-body]');
    for (let j = 0; j < bodies.length; j++) {
      const b = bodies[j];
      if (!b) continue;
      if (open) {
        b.removeAttribute('hidden');
      } else {
        b.setAttribute('hidden', '');
      }
    }
  }
  function toggleItem(item: Element): void {
    const currentlyOpen = item.getAttribute('data-opencanvas-acc-open') === 'true';
    const willOpen = !currentlyOpen;
    if (willOpen && !multi) {
      const siblings = root.querySelectorAll('[data-opencanvas-acc-item]');
      for (let i = 0; i < siblings.length; i++) {
        const sib = siblings[i];
        if (sib && sib !== item) setItemOpen(sib, false);
      }
    }
    setItemOpen(item, willOpen);
  }
  const toggles = root.querySelectorAll('[data-opencanvas-acc-toggle]');
  for (let k = 0; k < toggles.length; k++) {
    const toggle = toggles[k];
    if (!toggle) continue;
    ((capturedToggle: Element): void => {
      const item = capturedToggle.closest('[data-opencanvas-acc-item]');
      if (!item) return;
      capturedToggle.addEventListener('mousedown', function (ev: Event) {
        // Block the editor's root mousedown from starting a drag on the
        // accordion wrapper.
        ev.stopPropagation();
      });
      capturedToggle.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        toggleItem(item);
      });
      capturedToggle.addEventListener('keydown', function (event: Event) {
        const ke = event as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ' || ke.key === 'Spacebar') {
          event.preventDefault();
          event.stopPropagation();
          toggleItem(item);
        }
      });
    })(toggle);
  }
}

// ---------------------------------------------------------------------------
// Popup — mirrors POPUP_RUNTIME_SRC in `./popup.ts`. Visitor-only. The
// editor calls `hydrateInteractives(root, { skipPopups: true })` so this
// code path never runs in edit mode. Kept here so a future "Preview" mode
// can opt in.
// ---------------------------------------------------------------------------

function hydratePopups(root: ParentNode): void {
  const els = root.querySelectorAll('[data-opencanvas-popup="true"]');
  for (let i = 0; i < els.length; i++) {
    const sec = els[i];
    if (!(sec instanceof HTMLElement)) continue;
    if (sec.getAttribute('data-opencanvas-popup-hydrated') === 'true') continue;
    sec.setAttribute('data-opencanvas-popup-hydrated', 'true');
    ((capturedSec: HTMLElement): void => {
      const id = capturedSec.getAttribute('data-opencanvas-section');
      const type = capturedSec.getAttribute('data-opencanvas-trigger-type');
      const val = parseInt(capturedSec.getAttribute('data-opencanvas-trigger-value') || '0', 10);
      const key = 'opencanvas-popup-dismissed-' + String(id);
      try {
        if (window.localStorage.getItem(key)) return;
      } catch {
        // localStorage may throw in privacy mode; fail loudly via console
        // but still allow the popup to show — the dismissal is best-effort.
        console.error('[hydratePopups] localStorage.getItem failed for key=' + key);
      }
      const originalStyle = capturedSec.getAttribute('style');
      let fired = false;
      function show(): void {
        if (fired) return;
        fired = true;
        const bg = document.createElement('div');
        bg.style.cssText =
          'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.5)';
        const btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Close popup');
        btn.style.cssText =
          'position:fixed;top:16px;right:16px;z-index:100000;background:none;border:none;color:#fff;font-size:24px;cursor:pointer';
        btn.textContent = 'x';
        capturedSec.style.display = 'block';
        capturedSec.style.position = 'fixed';
        capturedSec.style.top = '50%';
        capturedSec.style.left = '50%';
        capturedSec.style.transform = 'translate(-50%,-50%)';
        capturedSec.style.zIndex = '99999';
        capturedSec.style.maxWidth = '90vw';
        capturedSec.style.maxHeight = '90vh';
        capturedSec.style.overflow = 'auto';
        document.body.appendChild(bg);
        document.body.appendChild(btn);
        function close(): void {
          try {
            window.localStorage.setItem(key, '1');
          } catch {
            // see localStorage.getItem comment above
          }
          if (originalStyle === null) {
            capturedSec.removeAttribute('style');
          } else {
            capturedSec.setAttribute('style', originalStyle);
          }
          if (bg.parentNode) bg.parentNode.removeChild(bg);
          if (btn.parentNode) btn.parentNode.removeChild(btn);
        }
        btn.addEventListener('click', close);
        bg.addEventListener('click', close);
      }
      if (type === 'exit-intent') {
        document.documentElement.addEventListener('mouseleave', function (e: MouseEvent) {
          if (e.clientY <= 0) show();
        });
      } else if (type === 'delay') {
        setTimeout(show, val || 3000);
      } else if (type === 'scroll') {
        const thr = val || 50;
        window.addEventListener('scroll', function () {
          if (document.documentElement.scrollHeight <= window.innerHeight) return;
          const pct =
            (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
          if (pct >= thr) show();
        });
      }
    })(sec);
  }
}

function queryByAttributeValue(root: ParentNode, attr: string, value: string): HTMLElement | null {
  const nodes = root.querySelectorAll('[' + attr + ']');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node instanceof HTMLElement && node.getAttribute(attr) === value) return node;
  }
  return null;
}

function rootDocument(root: ParentNode): Document {
  if ('ownerDocument' in root && root.ownerDocument) return root.ownerDocument;
  return document;
}

function ensurePreviewLayer(root: ParentNode): HTMLElement {
  const doc = rootDocument(root);
  const existing = doc.querySelector('[data-opencanvas-editor-preview-layer]');
  if (existing instanceof HTMLElement) return existing;
  const layer = doc.createElement('div');
  layer.setAttribute('data-opencanvas-editor-preview-layer', 'true');
  doc.body.appendChild(layer);
  return layer;
}

function closeEditorPreviewShell(shell: HTMLElement): void {
  shell.removeAttribute('data-opencanvas-overlay-open');
  shell.setAttribute('hidden', '');
  if (shell.getAttribute('data-opencanvas-editor-preview-temp') === 'true') shell.remove();
}

export function previewOverlayInEditor(root: ParentNode, overlayId: string): void {
  const overlay = queryByAttributeValue(root, 'data-opencanvas-overlay', overlayId);
  if (!overlay) {
    console.error('[previewOverlayInEditor] missing overlay shell for id=' + overlayId);
    return;
  }
  overlay.removeAttribute('hidden');
  overlay.setAttribute('data-opencanvas-overlay-open', 'true');
  const doc = rootDocument(root);
  const close = overlay.querySelector('[data-opencanvas-overlay-editor-close]');
  if (!close) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'opencanvas-overlay-close';
    button.setAttribute('data-opencanvas-overlay-editor-close', 'true');
    button.setAttribute('aria-label', 'Close overlay preview');
    button.textContent = 'x';
    button.addEventListener('click', () => closeEditorPreviewShell(overlay));
    overlay.appendChild(button);
  }
}

export function previewLoadExperienceInEditor(root: ParentNode): void {
  const doc = rootDocument(root);
  let shell = root.querySelector('[data-opencanvas-load-experience]');
  if (!(shell instanceof HTMLElement)) {
    const layer = ensurePreviewLayer(root);
    shell = doc.createElement('div');
    shell.className = 'opencanvas-load-experience';
    shell.setAttribute('data-opencanvas-load-experience', 'editor-load-preview');
    shell.setAttribute('data-opencanvas-load-preset', 'fade');
    shell.setAttribute('data-opencanvas-load-run-policy', 'every-visit');
    shell.setAttribute('data-opencanvas-load-gates', 'document-ready');
    shell.setAttribute('data-opencanvas-load-timeout-ms', '4000');
    shell.setAttribute('data-opencanvas-editor-preview-temp', 'true');
    const brand = doc.createElement('div');
    brand.className = 'opencanvas-load-brand';
    brand.setAttribute('data-opencanvas-load-part', 'brand');
    brand.textContent = 'Loading';
    const progress = doc.createElement('div');
    progress.className = 'opencanvas-load-progress';
    progress.setAttribute('data-opencanvas-load-part', 'progress');
    progress.appendChild(doc.createElement('span'));
    shell.appendChild(brand);
    shell.appendChild(progress);
    layer.appendChild(shell);
  }
  shell.removeAttribute('hidden');
  shell.removeAttribute('data-opencanvas-load-hidden');
  window.setTimeout(() => {
    if (!(shell instanceof HTMLElement)) return;
    shell.setAttribute('data-opencanvas-load-hidden', 'true');
    if (shell.getAttribute('data-opencanvas-editor-preview-temp') === 'true') {
      window.setTimeout(() => shell.remove(), 220);
    }
  }, 1200);
}

export function previewRouteTransitionInEditor(root: ParentNode): void {
  let container: Element | null = root.querySelector('[data-opencanvas-route-container]');
  if (!container && root instanceof HTMLElement) container = root;
  if (!(container instanceof HTMLElement)) {
    console.error('[previewRouteTransitionInEditor] missing route transition container');
    return;
  }
  if (!container.hasAttribute('data-opencanvas-route-mode')) {
    container.setAttribute('data-opencanvas-route-mode', 'fade');
  }
  container.setAttribute('data-opencanvas-route-container', '');
  container.setAttribute('data-opencanvas-route-state', 'outgoing');
  window.setTimeout(() => {
    container.removeAttribute('data-opencanvas-route-state');
  }, 420);
}
