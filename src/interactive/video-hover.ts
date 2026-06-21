// src/interactive/video-hover.ts
//
// Schema-owned video stream hover primitive. Authored video media can play only
// while the visitor hovers/focuses the media surface. Invalid attributes emit
// a named failure event and throw; playback promise rejection also fails loudly.

export interface VideoHoverRuntimeOptions {
  reducedMotion?: 'no-preference' | 'reduce';
}

export interface VideoHoverElement {
  nodeType: number;
  tagName?: string;
  muted?: boolean;
  playsInline?: boolean;
  duration?: number;
  currentTime?: number;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  play?(): Promise<void>;
  pause?(): void;
  load?(): void;
  closest?(selector: string): VideoHoverElement | null;
  addEventListener(type: string, listener: (ev: VideoHoverEvent) => void): void;
  getBoundingClientRect?(): { left: number; width: number };
}

export interface VideoHoverEvent {
  clientX?: number;
}

export interface VideoHoverElementList {
  length: number;
  [index: number]: VideoHoverElement | undefined;
}

export interface VideoHoverParentNode {
  querySelectorAll(selectors: string): VideoHoverElementList;
}

export interface VideoHoverWindow {
  dispatchEvent(event: Record<string, unknown>): boolean;
  matchMedia(query: string): { matches: boolean };
}

declare const document: {
  querySelectorAll(selectors: string): VideoHoverElementList;
};
declare const window: VideoHoverWindow;
declare const CustomEvent: new (
  typeArg: string,
  eventInitDict?: { detail: unknown },
) => Record<string, unknown>;
declare const setTimeout: (handler: () => void, timeout: number) => unknown;
declare const clearTimeout: (handle: unknown) => void;

export function emitVideoHoverFailure(
  video: VideoHoverElement | null,
  code: string,
  message: string,
  cause: unknown,
): never {
  const wrapper =
    video && typeof video.closest === 'function'
      ? video.closest('[data-opencanvas-element]')
      : null;
  const detail = {
    code: code,
    message: message,
    elementId:
      wrapper && typeof wrapper.getAttribute === 'function'
        ? wrapper.getAttribute('data-opencanvas-element')
        : null,
    cause: cause
      ? String(
          (cause as Record<string, unknown>) && (cause as Record<string, unknown>).message
            ? (cause as Record<string, unknown>).message
            : cause,
        )
      : null,
  };
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function' &&
    typeof CustomEvent === 'function'
  ) {
    window.dispatchEvent(new CustomEvent('opencanvas:video-hover-failure', { detail: detail }));
  }
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[opencanvas video-hover] ' + message, detail);
  }
  throw new Error('[opencanvas video-hover] ' + message);
}

export function videoHoverPrefersReducedMotion(options?: VideoHoverRuntimeOptions): boolean {
  if (options && options.reducedMotion === 'reduce') return true;
  if (options && options.reducedMotion === 'no-preference') return false;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function readVideoHoverConfig(video: VideoHoverElement): {
  mode: 'play-pause' | 'play-reset';
  scrubOnHover: boolean;
  reducedMotion: 'disabled' | 'allow';
  streamSrc: string | null;
  posterSrc: string | null;
  intentDelayMs: number;
} {
  const mode = video.getAttribute('data-opencanvas-video-hover-mode');
  if (mode !== 'play-pause' && mode !== 'play-reset') {
    emitVideoHoverFailure(
      video,
      'invalid-mode',
      'Video hover mode must be play-pause or play-reset',
      mode,
    );
  }
  const reducedMotion = video.getAttribute('data-opencanvas-video-hover-reduced-motion');
  if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
    emitVideoHoverFailure(
      video,
      'invalid-reduced-motion',
      'Video hover reduced-motion mode must be disabled or allow',
      reducedMotion,
    );
  }
  const scrubOnHover = video.getAttribute('data-opencanvas-video-hover-scrub') === 'true';
  const streamSrc = video.getAttribute('data-opencanvas-video-hover-stream-src');
  if (streamSrc !== null && streamSrc.trim() === '') {
    emitVideoHoverFailure(
      video,
      'stream-src-empty',
      'Video hover alternate stream source cannot be empty',
      streamSrc,
    );
  }
  const posterSrc = video.getAttribute('data-opencanvas-video-hover-poster-src');
  if (posterSrc !== null && posterSrc.trim() === '') {
    emitVideoHoverFailure(
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
    if (!isFinite(intentDelayMs) || intentDelayMs < 0 || intentDelayMs > 5000) {
      emitVideoHoverFailure(
        video,
        'invalid-intent-delay',
        'Video hover intent delay must be between 0 and 5000ms',
        intentDelayAttr,
      );
    }
  }
  return {
    mode: mode,
    scrubOnHover: scrubOnHover,
    reducedMotion: reducedMotion,
    streamSrc: streamSrc,
    posterSrc: posterSrc,
    intentDelayMs: intentDelayMs,
  };
}

export function setVideoHoverSource(
  video: VideoHoverElement,
  src: string | null,
  poster: string | null,
  code: string,
): void {
  if (!src) return;
  try {
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      if (typeof video.load === 'function') video.load();
    }
    if (poster !== null && poster !== undefined) video.setAttribute('poster', poster);
  } catch (err) {
    emitVideoHoverFailure(video, code, 'Video hover source swap failed', err);
  }
}

export function restoreVideoHoverSource(
  video: VideoHoverElement,
  originalSrc: string,
  originalPoster: string | null,
): void {
  if (!originalSrc) {
    emitVideoHoverFailure(
      video,
      'original-src-missing',
      'Video hover cannot restore the original video source',
      null,
    );
  }
  try {
    if (video.getAttribute('src') !== originalSrc) {
      video.setAttribute('src', originalSrc);
      if (typeof video.load === 'function') video.load();
    }
    if (originalPoster === null || originalPoster === undefined) {
      video.removeAttribute('poster');
    } else {
      video.setAttribute('poster', originalPoster);
    }
  } catch (err) {
    emitVideoHoverFailure(video, 'source-restore-failed', 'Video hover source restore failed', err);
  }
}

export function scrubVideoHover(
  video: VideoHoverElement,
  target: VideoHoverElement | null,
  ev: VideoHoverEvent | null,
): void {
  if (!ev || typeof ev.clientX !== 'number') return;
  const duration = Number(video.duration);
  if (!isFinite(duration) || duration <= 0) {
    emitVideoHoverFailure(
      video,
      'scrub-duration-missing',
      'Video hover scrub requires a finite video duration',
      video.duration,
    );
  }
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    emitVideoHoverFailure(
      video,
      'scrub-target-missing',
      'Video hover scrub target must be measurable',
      null,
    );
  }
  const rect = target.getBoundingClientRect();
  if (!(rect.width > 0)) {
    emitVideoHoverFailure(
      video,
      'scrub-target-width',
      'Video hover scrub target width must be > 0',
      rect.width,
    );
  }
  let progress = (ev.clientX - rect.left) / rect.width;
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;
  video.currentTime = progress * duration;
}

export function hydrateVideoHoverStreams(
  scope?: VideoHoverParentNode,
  options: VideoHoverRuntimeOptions = {},
): void {
  const root = scope || document;
  const videos = root.querySelectorAll('[data-opencanvas-video-hover="true"]');
  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    if (!video) continue;
    if (video.getAttribute('data-opencanvas-video-hover-hydrated') === 'true') continue;
    if (typeof video.tagName === 'string' && video.tagName.toLowerCase() !== 'video') {
      emitVideoHoverFailure(
        video,
        'invalid-video-node',
        'Video hover can only hydrate video elements',
        video.tagName,
      );
    }
    const config = readVideoHoverConfig(video);
    const reduce = videoHoverPrefersReducedMotion(options);
    if (reduce && config.reducedMotion === 'disabled') {
      video.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
      video.setAttribute('data-opencanvas-video-hover-reduced', 'disabled');
      continue;
    }
    if (typeof video.play !== 'function' || typeof video.pause !== 'function') {
      emitVideoHoverFailure(
        video,
        'missing-video-api',
        'Video hover requires play and pause support',
        null,
      );
    }
    video.muted = true;
    video.playsInline = true;
    const target = video.closest ? video.closest('[data-opencanvas-element]') || video : video;
    if (typeof target.addEventListener !== 'function') {
      emitVideoHoverFailure(
        video,
        'missing-event-target-api',
        'Video hover target requires addEventListener support',
        null,
      );
    }
    const originalSrc = video.getAttribute('src') || '';
    const originalPoster = video.getAttribute('poster');
    if (config.streamSrc && !originalSrc) {
      emitVideoHoverFailure(
        video,
        'original-src-missing',
        'Video hover alternate stream requires an original source to restore',
        null,
      );
    }
    let active = false;
    let intentTimer: unknown = null;
    let pendingIntentEvent: VideoHoverEvent | null = null;
    const activate = function (ev: VideoHoverEvent | null): void {
      try {
        setVideoHoverSource(video, config.streamSrc, config.posterSrc, 'source-swap-failed');
        if (config.scrubOnHover) {
          video.pause!();
          scrubVideoHover(video, target, ev);
          return;
        }
        if (config.mode === 'play-reset') video.currentTime = 0;
        const result = video.play!();
        if (result !== undefined && typeof result.catch === 'function') {
          result.catch(function (err: unknown) {
            emitVideoHoverFailure(video, 'play-rejected', 'Video hover play() was rejected', err);
          });
        }
      } catch (err) {
        emitVideoHoverFailure(video, 'play-failed', 'Video hover play failed', err);
      }
    };
    const enter = function (ev: VideoHoverEvent): void {
      if (active) return;
      active = true;
      pendingIntentEvent = ev;
      if (config.intentDelayMs > 0) {
        intentTimer = setTimeout(function () {
          intentTimer = null;
          activate(pendingIntentEvent);
          pendingIntentEvent = null;
        }, config.intentDelayMs);
        return;
      }
      activate(ev);
      pendingIntentEvent = null;
    };
    const leave = function (): void {
      if (!active) return;
      active = false;
      if (intentTimer !== null) {
        clearTimeout(intentTimer);
        intentTimer = null;
        pendingIntentEvent = null;
        return;
      }
      try {
        video.pause!();
        if (config.mode === 'play-reset') video.currentTime = 0;
        if (config.streamSrc) restoreVideoHoverSource(video, originalSrc, originalPoster);
      } catch (err) {
        emitVideoHoverFailure(video, 'pause-failed', 'Video hover pause failed', err);
      }
    };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('pointermove', function (ev: VideoHoverEvent) {
      if (!active || !config.scrubOnHover) return;
      if (intentTimer !== null) {
        pendingIntentEvent = ev;
        return;
      }
      scrubVideoHover(video, target, ev);
    });
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    video.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
  }
}

export const VIDEO_HOVER_RUNTIME_SRC = [
  emitVideoHoverFailure,
  videoHoverPrefersReducedMotion,
  readVideoHoverConfig,
  setVideoHoverSource,
  restoreVideoHoverSource,
  scrubVideoHover,
  hydrateVideoHoverStreams,
]
  .map((fn) => fn.toString())
  .join('\n');
