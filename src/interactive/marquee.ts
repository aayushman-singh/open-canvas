// src/interactive/marquee.ts
//
// Schema-owned marquee primitive. The renderer/editor wrapper emits
// data-opencanvas-marquee* attributes; this runtime turns the element's visual
// children into a duplicated belt and drives a continuous WAAPI transform.
// Malformed authored attributes dispatch `opencanvas:marquee-failure` and
// throw instead of silently degrading.

export const MARQUEE_RUNTIME_SRC = String.raw`
function emitMarqueeFailure(el, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    elementId: el && el.getAttribute ? el.getAttribute('data-opencanvas-element') : null,
    cause: cause ? String(cause && cause.message ? cause.message : cause) : null
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:marquee-failure', { detail: detail }));
  }
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error('[opencanvas marquee] ' + message, detail);
  }
  throw new Error('[opencanvas marquee] ' + message);
}
function marqueePrefersReducedMotion(options) {
  if (options && options.reducedMotion === 'reduce') return true;
  if (options && options.reducedMotion === 'no-preference') return false;
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function readMarqueeConfig(el) {
  var direction = el.getAttribute('data-opencanvas-marquee-direction');
  if (direction !== 'left' && direction !== 'right') {
    emitMarqueeFailure(el, 'invalid-direction', 'Marquee direction must be left or right', direction);
  }
  var speedRaw = el.getAttribute('data-opencanvas-marquee-speed');
  var speed = speedRaw === null ? NaN : Number(speedRaw);
  if (!isFinite(speed) || speed <= 0) {
    emitMarqueeFailure(el, 'invalid-speed', 'Marquee speed must be a finite number > 0', speedRaw);
  }
  var reducedMotion = el.getAttribute('data-opencanvas-marquee-reduced-motion');
  if (reducedMotion !== 'static' && reducedMotion !== 'slow') {
    emitMarqueeFailure(el, 'invalid-reduced-motion', 'Marquee reduced-motion mode must be static or slow', reducedMotion);
  }
  var pauseOnHover = el.getAttribute('data-opencanvas-marquee-pause') === 'true';
  var hoverReverse = el.getAttribute('data-opencanvas-marquee-hover-reverse') === 'true';
  if (pauseOnHover && hoverReverse) {
    emitMarqueeFailure(el, 'hover-mode-conflict', 'Marquee cannot pause and reverse on hover at the same time', null);
  }
  var rowsRaw = el.getAttribute('data-opencanvas-marquee-rows');
  var rows = rowsRaw === null ? 1 : Number(rowsRaw);
  if (!isFinite(rows) || Math.floor(rows) !== rows || rows < 1 || rows > 6) {
    emitMarqueeFailure(el, 'invalid-rows', 'Marquee rows must be an integer between 1 and 6', rowsRaw);
  }
  var rowGapRaw = el.getAttribute('data-opencanvas-marquee-row-gap');
  var rowGapPx = rowGapRaw === null ? 0 : Number(rowGapRaw);
  if (!isFinite(rowGapPx) || rowGapPx < 0 || rowGapPx > 200) {
    emitMarqueeFailure(el, 'invalid-row-gap', 'Marquee row gap must be between 0 and 200px', rowGapRaw);
  }
  var rowOffsetRaw = el.getAttribute('data-opencanvas-marquee-row-offset');
  var rowOffsetPercent = rowOffsetRaw === null ? 50 : Number(rowOffsetRaw);
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
function wireMarqueeHover(el, animations, config) {
  if (config.pauseOnHover) {
    el.addEventListener('mouseenter', function(){
      for (var i = 0; i < animations.length; i++) animations[i].pause();
    });
    el.addEventListener('mouseleave', function(){
      for (var i = 0; i < animations.length; i++) animations[i].play();
    });
  } else if (config.hoverReverse) {
    var normalPlaybackRates = [];
    for (var r = 0; r < animations.length; r++) normalPlaybackRates.push(animations[r].playbackRate || 1);
    el.addEventListener('mouseenter', function(){
      for (var i = 0; i < animations.length; i++) animations[i].playbackRate = -Math.abs(normalPlaybackRates[i] || 1);
    });
    el.addEventListener('mouseleave', function(){
      for (var i = 0; i < animations.length; i++) animations[i].playbackRate = Math.abs(normalPlaybackRates[i] || 1);
    });
  }
}
function isMarqueeEditorChrome(node) {
  if (!node || node.nodeType !== 1) return false;
  var el = node;
  var cls = typeof el.className === 'string' ? el.className : '';
  return cls.indexOf('element-menu-trigger') >= 0 || cls.indexOf('resize-handle') >= 0 || el.hasAttribute('data-resize-handle');
}
function stripMarqueeCloneInteractivity(node) {
  if (!node || node.nodeType !== 1) return;
  var el = node;
  el.removeAttribute('id');
  el.setAttribute('aria-hidden', 'true');
  if ('inert' in el) el.inert = true;
  var focusables = el.querySelectorAll('a,button,input,select,textarea,[tabindex]');
  for (var i = 0; i < focusables.length; i++) {
    focusables[i].setAttribute('tabindex', '-1');
  }
  var descendants = el.querySelectorAll('[id]');
  for (var j = 0; j < descendants.length; j++) {
    descendants[j].removeAttribute('id');
  }
}
function buildMarqueeLane(el, content, rowIndex) {
  var lane = document.createElement('div');
  lane.setAttribute('data-opencanvas-marquee-lane', String(rowIndex));
  lane.style.display = 'flex';
  lane.style.alignItems = 'stretch';
  lane.style.width = 'max-content';
  lane.style.minWidth = '100%';
  lane.style.height = '100%';
  lane.style.willChange = 'transform';
  var rowContent = rowIndex === 0 ? content : content.cloneNode(true);
  if (!rowContent || rowContent.nodeType !== 1) {
    emitMarqueeFailure(el, 'row-clone-failed', 'Marquee row content clone did not produce an element', null);
  }
  if (rowIndex > 0) stripMarqueeCloneInteractivity(rowContent);
  var clone = rowContent.cloneNode(true);
  if (!clone || clone.nodeType !== 1) {
    emitMarqueeFailure(el, 'clone-failed', 'Marquee content clone did not produce an element', null);
  }
  stripMarqueeCloneInteractivity(clone);
  clone.style.pointerEvents = 'none';
  lane.appendChild(rowContent);
  lane.appendChild(clone);
  return { lane: lane, content: rowContent };
}
function hydrateMarquees(scope, options) {
  var root = scope || document;
  var nodes = root.querySelectorAll('[data-opencanvas-marquee="true"]');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    if (el.getAttribute('data-opencanvas-marquee-hydrated') === 'true') continue;
    var config = readMarqueeConfig(el);
    var reduce = marqueePrefersReducedMotion(options);
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
    var belt = document.createElement('div');
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
    var content = document.createElement('div');
    content.setAttribute('data-opencanvas-marquee-content', 'true');
    content.style.display = 'inline-flex';
    content.style.alignItems = 'center';
    content.style.flex = '0 0 auto';
    content.style.minWidth = '100%';
    content.style.height = '100%';
    var chrome = [];
    while (el.firstChild) {
      var child = el.firstChild;
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
    var lanes = [];
    for (var rowIndex = 0; rowIndex < config.rows; rowIndex++) {
      var lane = buildMarqueeLane(el, content, rowIndex);
      lanes.push(lane);
      belt.appendChild(lane.lane);
    }
    el.appendChild(belt);
    for (var c = 0; c < chrome.length; c++) el.appendChild(chrome[c]);
    el.style.overflow = 'hidden';
    var firstContent = lanes[0].content;
    var width = firstContent.getBoundingClientRect ? firstContent.getBoundingClientRect().width : 0;
    if (!(width > 0)) width = content.scrollWidth || belt.scrollWidth / 2 || el.clientWidth || 0;
    if (!(width > 0)) {
      emitMarqueeFailure(el, 'zero-width', 'Marquee content width must be measurable', null);
    }
    var duration = Math.max(100, Math.round(width / config.speed * 1000));
    var frames = config.direction === 'left'
      ? [{ transform: 'translate3d(0,0,0)' }, { transform: 'translate3d(-' + width + 'px,0,0)' }]
      : [{ transform: 'translate3d(-' + width + 'px,0,0)' }, { transform: 'translate3d(0,0,0)' }];
    var animations = [];
    for (var laneIndex = 0; laneIndex < lanes.length; laneIndex++) {
      var animation = lanes[laneIndex].lane.animate(frames, { duration: duration, iterations: Infinity, easing: 'linear' });
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
`;
