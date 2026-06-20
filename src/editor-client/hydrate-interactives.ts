// src/editor-client/hydrate-interactives.ts
//
// TS-native counterpart to the visitor IIFE runtime. The visitor receives
// an inline <script> built from `RUNTIME_ENTRY_SRC + CAROUSEL_RUNTIME_SRC +
// ACCORDION_RUNTIME_SRC + POPUP_RUNTIME_SRC + MARQUEE_RUNTIME_SRC` (see
// `src/interactive/build.ts`). The editor — whose DOM is constructed by
// `body-builders-data.ts` rather than a pre-rendered snapshot — calls
// `hydrateInteractives()` to mount the SAME behaviour on its live DOM.
// Most functions below mirror the runtime fragments line-by-line, while
// marquee is imported from the shared adapter in `src/interactive/marquee.ts`.
//
// Why this lives here and not under `src/interactive/` (except for marquee):
// the visitor-side modules in `src/interactive/` ship as JS source strings
// (vanilla ES5, no DOM types pulled in) so the root tsconfig's worker-typed
// compile stays tight. This module reaches for the DOM directly, which only the
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
import type { RuntimeHydratorSurfaceId } from '../interactive/runtime-hydrator-surfaces.js';
import { hydrateBehaviourPreview } from './hydrate-behaviour.js';
import { hydrateMarquees } from '../interactive/marquee.js';

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

export const EDITOR_REGISTRY: Record<
  RuntimeHydratorSurfaceId,
  (root: ParentNode, options: HydrateOptions) => void
> = {
  'interactive:accordion': (wrapper) => {
    if (wrapper instanceof HTMLElement) hydrateAccordion(wrapper);
  },
  'interactive:carousel': (wrapper) => {
    if (wrapper instanceof HTMLElement) hydrateCarousel(wrapper);
  },
  'document:pointer-fx': (root, options) => {
    hydratePointerFx(root, options);
  },
  'behaviour:preview': (root, options) => {
    if (options.behaviourState && options.behaviourAssetBasePath) {
      hydrateBehaviourPreview(
        root,
        options.behaviourState,
        options.behaviourAssetBasePath,
        options.reducedMotion,
      );
    }
  },
  'document:marquee': (root, options) => {
    hydrateMarquees(root, options);
  },
  'document:video-hover': (root, options) => {
    hydrateVideoHoverStreams(root, options);
  },
};

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

function dispatchRequiredSurface(
  id: RuntimeHydratorSurfaceId,
  root: ParentNode,
  options: HydrateOptions,
): void {
  const dispatch = EDITOR_REGISTRY[id];
  if (!dispatch) {
    const msg = `[hydrateInteractives] Required hydration surface "${id}" is missing from EDITOR_REGISTRY.`;
    console.error(msg);
    throw new Error(msg);
  }
  dispatch(root, options);
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
    const surfaceId = `interactive:${kind}`;
    const registryView = EDITOR_REGISTRY as Record<
      string,
      ((root: ParentNode, opts: HydrateOptions) => void) | undefined
    >;
    const dispatch = registryView[surfaceId];
    if (dispatch) {
      dispatch(wrapper, options);
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
    // Popups are visitor-only chrome and not listed in the shared surface catalog.
    hydratePopups(root);
  }
  // Shared non-interactive document/behavior surfaces
  dispatchRequiredSurface('document:pointer-fx', root, options);
  dispatchRequiredSurface('behaviour:preview', root, options);
  dispatchRequiredSurface('document:marquee', root, options);
  hydrateCollectionSearches(root, options);
  dispatchRequiredSurface('document:video-hover', root, options);
}

function prefersReducedMotion(options: HydrateOptions): boolean {
  if (options.reducedMotion === 'reduce') return true;
  if (options.reducedMotion === 'no-preference') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function emitCollectionSearchFailure(root: Element, code: string, message: string, cause: unknown): never {
  const detail = {
    code,
    message,
    collectionId: root.getAttribute('data-opencanvas-element'),
    cause: cause === null ? null : describeCollectionSearchCause(cause),
  };
  window.dispatchEvent(new CustomEvent('opencanvas:collection-search-failed', { detail }));
  console.error('[opencanvas collection-search] ' + message, detail);
  throw new Error('[opencanvas collection-search] ' + message);
}

function emitCollectionFilterFailure(root: Element, code: string, message: string, cause: unknown): never {
  const detail = {
    code,
    message,
    collectionId: root.getAttribute('data-opencanvas-element'),
    cause: cause === null ? null : describeCollectionSearchCause(cause),
  };
  window.dispatchEvent(new CustomEvent('opencanvas:collection-filter-failed', { detail }));
  console.error('[opencanvas collection-filter] ' + message, detail);
  throw new Error('[opencanvas collection-filter] ' + message);
}

function emitCollectionViewFailure(root: Element, code: string, message: string, cause: unknown): never {
  const detail = {
    code,
    message,
    collectionId: root.getAttribute('data-opencanvas-element'),
    cause: cause === null ? null : describeCollectionSearchCause(cause),
  };
  window.dispatchEvent(new CustomEvent('opencanvas:collection-view-failed', { detail }));
  console.error('[opencanvas collection-view] ' + message, detail);
  throw new Error('[opencanvas collection-view] ' + message);
}

function describeCollectionSearchCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  if (typeof cause === 'number' || typeof cause === 'boolean' || typeof cause === 'bigint') {
    return String(cause);
  }
  if (cause === undefined) return 'undefined';
  return Object.prototype.toString.call(cause);
}

function normaliseCollectionSearchText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function updateCollectionQueryVisibility(
  root: Element,
  entries: NodeListOf<HTMLElement>,
  empty: HTMLElement | null,
): void {
  let visible = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const matched =
      entry.getAttribute('data-opencanvas-collection-entry-search-match') !== 'false' &&
      entry.getAttribute('data-opencanvas-collection-entry-filter-match') !== 'false';
    entry.hidden = !matched;
    if (matched) visible += 1;
  }
  root.setAttribute('data-opencanvas-collection-visible-count', String(visible));
  if (empty !== null) empty.hidden = visible !== 0;
}

function isCollectionSearchRoot(value: ParentNode): value is Element {
  const candidate = value as { getAttribute?: unknown };
  return typeof candidate.getAttribute === 'function';
}

function hydrateCollectionSearches(root: ParentNode, options: HydrateOptions): void {
  const nodes: Element[] = [];
  if (
    isCollectionSearchRoot(root) &&
    (root.getAttribute('data-opencanvas-collection-search') === 'true' ||
      root.getAttribute('data-opencanvas-collection-filter') !== null ||
      root.getAttribute('data-opencanvas-collection-view-toggle') === 'true')
  ) {
    nodes.push(root);
  }
  const searchNodes = root.querySelectorAll('[data-opencanvas-collection-search="true"]');
  for (let i = 0; i < searchNodes.length; i++) nodes.push(searchNodes[i]!);
  const filterNodes = root.querySelectorAll('[data-opencanvas-collection-filter]');
  for (let i = 0; i < filterNodes.length; i++) nodes.push(filterNodes[i]!);
  const viewNodes = root.querySelectorAll('[data-opencanvas-collection-view-toggle="true"]');
  for (let i = 0; i < viewNodes.length; i++) nodes.push(viewNodes[i]!);
  for (const node of nodes) {
    const entries = node.querySelectorAll<HTMLElement>('[data-opencanvas-collection-entry]');
    const empty = node.querySelector<HTMLElement>('[data-opencanvas-collection-search-empty]');
    if (
      node.getAttribute('data-opencanvas-collection-search') === 'true' &&
      node.getAttribute('data-opencanvas-collection-search-hydrated') !== 'true'
    ) {
      hydrateCollectionSearch(node, entries, empty, options);
    }
    if (
      node.getAttribute('data-opencanvas-collection-filter') !== null &&
      node.getAttribute('data-opencanvas-collection-filter-hydrated') !== 'true'
    ) {
      hydrateCollectionFilter(node, entries, empty, options);
    }
    if (
      node.getAttribute('data-opencanvas-collection-view-toggle') === 'true' &&
      node.getAttribute('data-opencanvas-collection-view-hydrated') !== 'true'
    ) {
      hydrateCollectionViewToggle(node, options);
    }
  }
}

function hydrateCollectionSearch(
  node: Element,
  entries: NodeListOf<HTMLElement>,
  empty: HTMLElement | null,
  options: HydrateOptions,
): void {
  const reducedMotion = node.getAttribute('data-opencanvas-collection-search-reduced-motion');
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionSearchFailure(
      node,
      'invalid-reduced-motion',
      'Collection search reduced-motion mode must be instant or allow',
      reducedMotion,
    );
  }
  const input = node.querySelector<HTMLInputElement>('[data-opencanvas-collection-search-input]');
  if (input === null) {
    emitCollectionSearchFailure(
      node,
      'missing-search-input',
      'Collection search requires a rendered search input',
      null,
    );
  }
  if (prefersReducedMotion(options) && reducedMotion === 'instant') {
    node.setAttribute('data-opencanvas-collection-search-reduced', 'instant');
  }
  const applySearch = (): void => {
    const query = normaliseCollectionSearchText(input.value);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const matched =
        query.length === 0 ||
        normaliseCollectionSearchText(entry.textContent).indexOf(query) !== -1;
      entry.setAttribute('data-opencanvas-collection-entry-search-match', matched ? 'true' : 'false');
    }
    node.setAttribute('data-opencanvas-collection-search-query', query);
    updateCollectionQueryVisibility(node, entries, empty);
  };
  input.addEventListener('input', applySearch);
  input.addEventListener('mousedown', (ev) => ev.stopPropagation());
  input.addEventListener('click', (ev) => ev.stopPropagation());
  applySearch();
  node.setAttribute('data-opencanvas-collection-search-hydrated', 'true');
}

function collectionEntryMatchesFilter(
  node: Element,
  entry: HTMLElement,
  field: string,
  value: string,
): boolean {
  if (value === '__all__') return true;
  if (field === 'folder') {
    return entry.getAttribute('data-opencanvas-collection-entry-folder') === value;
  }
  if (field === 'category') {
    return entry.getAttribute('data-opencanvas-collection-entry-category') === value;
  }
  if (field === 'tag') {
    try {
      const parsed = JSON.parse(entry.getAttribute('data-opencanvas-collection-entry-tags') ?? '[]') as unknown;
      if (!Array.isArray(parsed)) return false;
      return parsed.includes(value);
    } catch (err: unknown) {
      emitCollectionFilterFailure(
        node,
        'invalid-filter-tags',
        'Collection filter tag metadata must be valid JSON',
        err,
      );
    }
  }
  return false;
}

function hydrateCollectionFilter(
  node: Element,
  entries: NodeListOf<HTMLElement>,
  empty: HTMLElement | null,
  options: HydrateOptions,
): void {
  const field = node.getAttribute('data-opencanvas-collection-filter');
  const reducedMotion = node.getAttribute('data-opencanvas-collection-filter-reduced-motion');
  if (field !== 'folder' && field !== 'category' && field !== 'tag') {
    emitCollectionFilterFailure(node, 'invalid-filter-field', 'Collection filter field must be folder, category, or tag', field);
  }
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionFilterFailure(
      node,
      'invalid-filter-reduced-motion',
      'Collection filter reduced-motion mode must be instant or allow',
      reducedMotion,
    );
  }
  const buttons = node.querySelectorAll<HTMLElement>('[data-opencanvas-collection-filter-option]');
  if (buttons.length === 0) {
    emitCollectionFilterFailure(node, 'missing-filter-options', 'Collection filter requires rendered option buttons', null);
  }
  if (prefersReducedMotion(options) && reducedMotion === 'instant') {
    node.setAttribute('data-opencanvas-collection-filter-reduced', 'instant');
  }
  const setActive = (value: string): void => {
    let matchedButton = false;
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i]!;
      const buttonValue = button.getAttribute('data-opencanvas-collection-filter-option') ?? '__all__';
      const active = buttonValue === value;
      button.setAttribute('data-opencanvas-collection-filter-active', String(active));
      button.setAttribute('aria-pressed', String(active));
      if (active) matchedButton = true;
    }
    if (!matchedButton) {
      emitCollectionFilterFailure(node, 'missing-default-filter', 'Collection filter default must match a rendered option', value);
    }
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      const matched = collectionEntryMatchesFilter(node, entry, field, value);
      entry.setAttribute('data-opencanvas-collection-entry-filter-match', matched ? 'true' : 'false');
    }
    node.setAttribute('data-opencanvas-collection-filter-active-value', value);
    updateCollectionQueryVisibility(node, entries, empty);
  };
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]!;
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setActive(button.getAttribute('data-opencanvas-collection-filter-option') ?? '__all__');
    });
    button.addEventListener('mousedown', (ev) => ev.stopPropagation());
  }
  setActive(node.getAttribute('data-opencanvas-collection-filter-default') ?? '__all__');
  node.setAttribute('data-opencanvas-collection-filter-hydrated', 'true');
}

function hydrateCollectionViewToggle(node: Element, options: HydrateOptions): void {
  const defaultMode = node.getAttribute('data-opencanvas-collection-view-default') ?? 'grid';
  const reducedMotion = node.getAttribute('data-opencanvas-collection-view-reduced-motion');
  if (defaultMode !== 'grid' && defaultMode !== 'list') {
    emitCollectionViewFailure(node, 'invalid-view-default', 'Collection view default must be grid or list', defaultMode);
  }
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionViewFailure(
      node,
      'invalid-view-reduced-motion',
      'Collection view reduced-motion mode must be instant or allow',
      reducedMotion,
    );
  }
  const buttons = node.querySelectorAll<HTMLElement>('[data-opencanvas-collection-view-option]');
  if (buttons.length === 0) {
    emitCollectionViewFailure(node, 'missing-view-options', 'Collection view toggle requires rendered option buttons', null);
  }
  if (prefersReducedMotion(options) && reducedMotion === 'instant') {
    node.setAttribute('data-opencanvas-collection-view-reduced', 'instant');
  }
  const setView = (mode: string): void => {
    if (mode !== 'grid' && mode !== 'list') {
      emitCollectionViewFailure(node, 'invalid-view-option', 'Collection view option must be grid or list', mode);
    }
    let matchedButton = false;
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i]!;
      const buttonMode = button.getAttribute('data-opencanvas-collection-view-option');
      const active = buttonMode === mode;
      button.setAttribute('data-opencanvas-collection-view-active', String(active));
      button.setAttribute('aria-pressed', String(active));
      if (active) matchedButton = true;
    }
    if (!matchedButton) {
      emitCollectionViewFailure(node, 'missing-default-view', 'Collection view default must match a rendered option', mode);
    }
    node.setAttribute('data-opencanvas-collection-view-active', mode);
  };
  for (let i = 0; i < buttons.length; i++) {
    const button = buttons[i]!;
    button.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setView(button.getAttribute('data-opencanvas-collection-view-option') ?? 'grid');
    });
    button.addEventListener('mousedown', (ev) => ev.stopPropagation());
  }
  setView(defaultMode);
  node.setAttribute('data-opencanvas-collection-view-hydrated', 'true');
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
