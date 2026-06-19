// src/interactive/video-hover.ts
//
// Video Stream Hover primitive. Authored video media can play only while the
// visitor hovers/focuses the media surface. Invalid attributes emit a named
// failure event and throw; playback promise rejection also fails loudly.

export const VIDEO_HOVER_RUNTIME_SRC = String.raw`
function emitVideoHoverFailure(video, code, message, cause) {
  var wrapper = video && video.closest ? video.closest('[data-opencanvas-element]') : null;
  var detail = {
    code: code,
    message: message,
    elementId: wrapper && wrapper.getAttribute ? wrapper.getAttribute('data-opencanvas-element') : null,
    cause: cause ? String(cause && cause.message ? cause.message : cause) : null
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:video-hover-failure', { detail: detail }));
  }
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[opencanvas video-hover] ' + message, detail);
  }
  throw new Error('[opencanvas video-hover] ' + message);
}
function videoHoverPrefersReducedMotion(options) {
  if (options && options.reducedMotion === 'reduce') return true;
  if (options && options.reducedMotion === 'no-preference') return false;
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function readVideoHoverConfig(video) {
  var mode = video.getAttribute('data-opencanvas-video-hover-mode');
  if (mode !== 'play-pause' && mode !== 'play-reset') {
    emitVideoHoverFailure(video, 'invalid-mode', 'Video hover mode must be play-pause or play-reset', mode);
  }
  var reducedMotion = video.getAttribute('data-opencanvas-video-hover-reduced-motion');
  if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
    emitVideoHoverFailure(video, 'invalid-reduced-motion', 'Video hover reduced-motion mode must be disabled or allow', reducedMotion);
  }
  var scrubOnHover = video.getAttribute('data-opencanvas-video-hover-scrub') === 'true';
  var streamSrc = video.getAttribute('data-opencanvas-video-hover-stream-src');
  if (streamSrc !== null && streamSrc.trim() === '') {
    emitVideoHoverFailure(video, 'stream-src-empty', 'Video hover alternate stream source cannot be empty', streamSrc);
  }
  var posterSrc = video.getAttribute('data-opencanvas-video-hover-poster-src');
  if (posterSrc !== null && posterSrc.trim() === '') {
    emitVideoHoverFailure(video, 'poster-src-empty', 'Video hover alternate poster source cannot be empty', posterSrc);
  }
  return { mode: mode, scrubOnHover: scrubOnHover, reducedMotion: reducedMotion, streamSrc: streamSrc, posterSrc: posterSrc };
}
function setVideoHoverSource(video, src, poster, code) {
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
function restoreVideoHoverSource(video, originalSrc, originalPoster) {
  if (!originalSrc) {
    emitVideoHoverFailure(video, 'original-src-missing', 'Video hover cannot restore the original video source', null);
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
function scrubVideoHover(video, target, ev) {
  if (!ev || typeof ev.clientX !== 'number') return;
  var duration = Number(video.duration);
  if (!isFinite(duration) || duration <= 0) {
    emitVideoHoverFailure(video, 'scrub-duration-missing', 'Video hover scrub requires a finite video duration', video.duration);
  }
  if (!target || typeof target.getBoundingClientRect !== 'function') {
    emitVideoHoverFailure(video, 'scrub-target-missing', 'Video hover scrub target must be measurable', null);
  }
  var rect = target.getBoundingClientRect();
  if (!(rect.width > 0)) {
    emitVideoHoverFailure(video, 'scrub-target-width', 'Video hover scrub target width must be > 0', rect.width);
  }
  var progress = (ev.clientX - rect.left) / rect.width;
  if (progress < 0) progress = 0;
  if (progress > 1) progress = 1;
  video.currentTime = progress * duration;
}
function hydrateVideoHoverStreams(scope, options) {
  var root = scope || document;
  var videos = root.querySelectorAll('video[data-opencanvas-video-hover="true"]');
  for (var i = 0; i < videos.length; i++) {
    var video = videos[i];
    if (video.getAttribute('data-opencanvas-video-hover-hydrated') === 'true') continue;
    var config = readVideoHoverConfig(video);
    var reduce = videoHoverPrefersReducedMotion(options);
    if (reduce && config.reducedMotion === 'disabled') {
      video.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
      video.setAttribute('data-opencanvas-video-hover-reduced', 'disabled');
      continue;
    }
    if (typeof video.play !== 'function' || typeof video.pause !== 'function') {
      emitVideoHoverFailure(video, 'missing-video-api', 'Video hover requires play and pause support', null);
    }
    video.muted = true;
    video.playsInline = true;
    var target = video.closest ? video.closest('[data-opencanvas-element]') || video : video;
    var originalSrc = video.getAttribute('src') || '';
    var originalPoster = video.getAttribute('poster');
    if (config.streamSrc && !originalSrc) {
      emitVideoHoverFailure(video, 'original-src-missing', 'Video hover alternate stream requires an original source to restore', null);
    }
    var active = false;
    var enter = function(ev) {
      if (active) return;
      active = true;
      try {
        setVideoHoverSource(video, config.streamSrc, config.posterSrc, 'source-swap-failed');
        if (config.scrubOnHover) {
          video.pause();
          scrubVideoHover(video, target, ev);
          return;
        }
        if (config.mode === 'play-reset') video.currentTime = 0;
        var result = video.play();
        if (result && typeof result.catch === 'function') {
          result.catch(function(err){ emitVideoHoverFailure(video, 'play-rejected', 'Video hover play() was rejected', err); });
        }
      } catch (err) {
        emitVideoHoverFailure(video, 'play-failed', 'Video hover play failed', err);
      }
    };
    var leave = function() {
      if (!active) return;
      active = false;
      try {
        video.pause();
        if (config.mode === 'play-reset') video.currentTime = 0;
        if (config.streamSrc) restoreVideoHoverSource(video, originalSrc, originalPoster);
      } catch (err) {
        emitVideoHoverFailure(video, 'pause-failed', 'Video hover pause failed', err);
      }
    };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('pointermove', function(ev) {
      if (!active || !config.scrubOnHover) return;
      scrubVideoHover(video, target, ev);
    });
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    video.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
  }
}
`;
