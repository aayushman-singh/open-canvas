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
function readVideoHoverConfig(video) {
  var mode = video.getAttribute('data-opencanvas-video-hover-mode');
  if (mode !== 'play-pause' && mode !== 'play-reset') {
    emitVideoHoverFailure(video, 'invalid-mode', 'Video hover mode must be play-pause or play-reset', mode);
  }
  var reducedMotion = video.getAttribute('data-opencanvas-video-hover-reduced-motion');
  if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
    emitVideoHoverFailure(video, 'invalid-reduced-motion', 'Video hover reduced-motion mode must be disabled or allow', reducedMotion);
  }
  return { mode: mode, reducedMotion: reducedMotion };
}
function hydrateVideoHoverStreams(scope) {
  var root = scope || document;
  var videos = root.querySelectorAll('video[data-opencanvas-video-hover="true"]');
  for (var i = 0; i < videos.length; i++) {
    var video = videos[i];
    if (video.getAttribute('data-opencanvas-video-hover-hydrated') === 'true') continue;
    var config = readVideoHoverConfig(video);
    var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    var active = false;
    var enter = function() {
      if (active) return;
      active = true;
      try {
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
      } catch (err) {
        emitVideoHoverFailure(video, 'pause-failed', 'Video hover pause failed', err);
      }
    };
    target.addEventListener('pointerenter', enter);
    target.addEventListener('pointerleave', leave);
    target.addEventListener('focusin', enter);
    target.addEventListener('focusout', leave);
    video.setAttribute('data-opencanvas-video-hover-hydrated', 'true');
  }
}
`;
