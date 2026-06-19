// src/interactive/behaviour.ts
//
// Behaviour runtime fragment. Parses the authored behaviour payload, hydrates
// load experience chrome, text-split targets, motion sequences, scroll scenes,
// and image-sequence rich motion assets. Emits `opencanvas:behaviour-failure`
// and throws on any unresolved target, asset, or adapter mismatch.

export const BEHAVIOUR_RUNTIME_SRC = String.raw`
function behaviourFailure(code, context, cause) {
  var detail = { code: code, context: context, cause: cause && cause.message ? cause.message : String(cause) };
  if (typeof console !== 'undefined' && console.error) console.error('[opencanvas behaviour]', detail);
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('opencanvas:behaviour-failure', { detail: detail }));
  }
  throw cause instanceof Error ? cause : new Error(code + ': ' + detail.cause);
}

function behaviourPrefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function parseBehaviourPayload() {
  var node = document.querySelector('script[data-opencanvas-behaviour-payload]');
  if (!node) return null;
  try {
    return JSON.parse(node.textContent || '');
  } catch (err) {
    behaviourFailure('behaviour-payload-parse', {}, err);
  }
}

function behaviourFindSequence(payload, sequenceId) {
  var sequences = payload.motionSequences || [];
  for (var i = 0; i < sequences.length; i++) {
    if (sequences[i].id === sequenceId) return sequences[i];
  }
  behaviourFailure('behaviour-sequence-missing', { sequenceId: sequenceId }, new Error('motion sequence not found'));
}

function behaviourFindScrollScene(payload, scrollSceneId) {
  var scenes = payload.scrollScenes || [];
  for (var i = 0; i < scenes.length; i++) {
    if (scenes[i].id === scrollSceneId) return scenes[i];
  }
  behaviourFailure('behaviour-scroll-scene-missing', { scrollSceneId: scrollSceneId }, new Error('scroll scene not found'));
}

function behaviourResolveTarget(target, root) {
  root = root || document;
  if (target.type === 'site') return [document.documentElement];
  if (target.type === 'page') {
    var page = root.querySelector('[data-opencanvas-page="' + target.pageId + '"]');
    if (!page) behaviourFailure('behaviour-target-missing', { target: target }, new Error('page target not found'));
    return [page];
  }
  if (target.type === 'section') {
    var section = root.querySelector('[data-opencanvas-section="' + target.sectionId + '"]');
    if (!section) behaviourFailure('behaviour-target-missing', { target: target }, new Error('section target not found'));
    return [section];
  }
  if (target.type === 'element') {
    var element = root.querySelector('[data-opencanvas-element="' + target.elementId + '"]');
    if (!element) behaviourFailure('behaviour-target-missing', { target: target }, new Error('element target not found'));
    return [element];
  }
  if (target.type === 'text-split') {
    var textEl = root.querySelector('[data-opencanvas-element="' + target.elementId + '"]');
    if (!textEl) behaviourFailure('behaviour-target-missing', { target: target }, new Error('text-split target not found'));
    return behaviourSplitTextTarget(textEl, target.unit);
  }
  behaviourFailure('behaviour-target-unknown', { target: target }, new Error('unknown behaviour target type'));
}

function behaviourTextHost(node) {
  var inner = node.querySelector('.opencanvas-text');
  return inner || node;
}

function behaviourSplitTextTarget(el, unit) {
  if (el.getAttribute('data-opencanvas-text-split') === unit) {
    return el.querySelectorAll('.opencanvas-text-split');
  }
  var host = behaviourTextHost(el);
  var text = host.textContent || '';
  var parts = [];
  if (unit === 'char') {
    parts = text.split('');
  } else if (unit === 'word') {
    parts = text.match(/\S+\s*/g) || [];
  } else if (unit === 'line') {
    parts = text.split(/\n/);
  } else {
    behaviourFailure('behaviour-text-split-unit', { unit: unit }, new Error('unsupported text split unit'));
  }
  host.textContent = '';
  host.setAttribute('aria-label', text);
  var spans = [];
  for (var i = 0; i < parts.length; i++) {
    var span = document.createElement('span');
    span.className = 'opencanvas-text-split';
    span.setAttribute('data-opencanvas-text-split-unit', unit);
    span.setAttribute('aria-hidden', 'true');
    span.style.display = unit === 'line' ? 'block' : 'inline-block';
    span.textContent = parts[i];
    host.appendChild(span);
    spans.push(span);
  }
  el.setAttribute('data-opencanvas-text-split', unit);
  return spans;
}

function behaviourNumeric(value, fallback) {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    var parsed = parseFloat(value);
    if (isFinite(parsed)) return parsed;
  }
  return fallback;
}

function behaviourTransformValue(props, prefix) {
  var tx = behaviourNumeric(props.translateX, 0);
  var ty = behaviourNumeric(props.translateY, 0);
  var scale = behaviourNumeric(props.scale, 1);
  var rotate = behaviourNumeric(props.rotate, 0);
  var parts = [];
  if (props.translateX !== undefined || props.translateY !== undefined || prefix === 'to') {
    parts.push('translate(' + tx + 'px,' + ty + 'px)');
  }
  if (props.scale !== undefined || prefix === 'to') {
    parts.push('scale(' + scale + ')');
  }
  if (props.rotate !== undefined || prefix === 'to') {
    parts.push('rotate(' + rotate + 'deg)');
  }
  return parts.length > 0 ? parts.join(' ') : '';
}

function behaviourInterpolateProp(prop, fromVal, toVal, progress) {
  if (prop === 'opacity' || prop === 'scale' || prop === 'translateX' || prop === 'translateY' || prop === 'rotate') {
    var fromNum = behaviourNumeric(fromVal, prop === 'opacity' ? 1 : prop === 'scale' ? 1 : 0);
    var toNum = behaviourNumeric(toVal, fromNum);
    return fromNum + (toNum - fromNum) * progress;
  }
  return progress >= 1 ? toVal : fromVal;
}

function behaviourPropsAtProgress(from, to, progress) {
  var out = {};
  var keys = ['opacity', 'translateX', 'translateY', 'scale', 'rotate', 'clipPath', 'filter'];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    if (to[key] !== undefined || from[key] !== undefined) {
      out[key] = behaviourInterpolateProp(key, from[key], to[key], progress);
    }
  }
  return out;
}

function behaviourApplyProps(node, props) {
  if (props.opacity !== undefined) node.style.opacity = String(props.opacity);
  if (props.clipPath !== undefined) node.style.clipPath = String(props.clipPath);
  if (props.filter !== undefined) node.style.filter = String(props.filter);
  var transform = behaviourTransformValue(props, 'to');
  if (transform) node.style.transform = transform;
}

function behaviourAnimateTargets(targets, step, reducedMode, progress) {
  var from = step.from || {};
  var to = step.to || {};
  var stagger = step.staggerMs || 0;
  if (progress !== undefined) {
    for (var i = 0; i < targets.length; i++) {
      behaviourApplyProps(targets[i], behaviourPropsAtProgress(from, to, progress));
    }
    return;
  }
  if (reducedMode === 'skip') return;
  if (reducedMode === 'final-state') {
    for (var j = 0; j < targets.length; j++) {
      behaviourApplyProps(targets[j], to);
    }
    return;
  }
  for (var k = 0; k < targets.length; k++) {
  (function (node, index) {
    var keyframes = [];
    var fromProps = Object.assign({}, from);
    var toProps = Object.assign({}, to);
    keyframes.push(behaviourPropsAtProgress(fromProps, toProps, 0));
    keyframes.push(behaviourPropsAtProgress(fromProps, toProps, 1));
    var options = {
      duration: step.durationMs || 0,
      delay: (step.delayMs || 0) + index * stagger,
      easing: step.easing || 'ease',
      fill: 'forwards',
    };
    var animKeyframes = keyframes.map(function (frame) {
      var out = {};
      if (frame.opacity !== undefined) out.opacity = frame.opacity;
      if (frame.clipPath !== undefined) out.clipPath = String(frame.clipPath);
      if (frame.filter !== undefined) out.filter = String(frame.filter);
      var transform = behaviourTransformValue(frame, 'to');
      if (transform) out.transform = transform;
      return out;
    });
    node.animate(animKeyframes, options);
  })(targets[k], k);
  }
}

function behaviourRunSequence(sequence, root, reducedMode, progress) {
  var steps = sequence.steps || [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var targets = behaviourResolveTarget(step.target, root);
    behaviourAnimateTargets(targets, step, reducedMode, progress);
  }
}

function behaviourSetupSectionEnter(sequence, root) {
  if (sequence.trigger.type !== 'section-enter') return;
  var section = root.querySelector('[data-opencanvas-section="' + sequence.trigger.sectionId + '"]');
  if (!section) {
    behaviourFailure('behaviour-target-missing', { sequenceId: sequence.id, sectionId: sequence.trigger.sectionId }, new Error('section-enter section not found'));
  }
  var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
  if (typeof IntersectionObserver !== 'function') {
    behaviourFailure('behaviour-intersection-observer-missing', { sequenceId: sequence.id }, new Error('IntersectionObserver unavailable'));
  }
  var fired = false;
  var observer = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting && !fired) {
        fired = true;
        behaviourRunSequence(sequence, root, reducedMode);
        observer.disconnect();
      }
    }
  }, { threshold: 0.12 });
  observer.observe(section);
}

function behaviourSceneProgress(scene, section) {
  var rect = section.getBoundingClientRect();
  var sectionTop = window.scrollY + rect.top;
  var scrolled = window.scrollY - sectionTop + scene.startOffsetPx;
  var range = scene.endOffsetPx - scene.startOffsetPx;
  if (!(range > 0)) return 0;
  return Math.max(0, Math.min(1, scrolled / range));
}

function behaviourApplyPin(pinEl, scene, section, progress) {
  if (progress <= 0 || progress >= 1) {
    pinEl.style.position = '';
    pinEl.style.top = '';
    pinEl.style.left = '';
    pinEl.style.width = '';
    pinEl.style.zIndex = '';
    return;
  }
  var rect = section.getBoundingClientRect();
  pinEl.style.position = 'fixed';
  pinEl.style.top = '0px';
  pinEl.style.left = rect.left + 'px';
  pinEl.style.width = rect.width + 'px';
  pinEl.style.zIndex = '20';
}

function behaviourSetupScrollScene(scene, sequence, root) {
  var section = root.querySelector('[data-opencanvas-section="' + scene.sectionId + '"]');
  if (!section) {
    behaviourFailure('behaviour-target-missing', { scrollSceneId: scene.id, sectionId: scene.sectionId }, new Error('scroll scene section not found'));
  }
  var pinEl = scene.pinTarget.type === 'section'
    ? root.querySelector('[data-opencanvas-section="' + scene.pinTarget.sectionId + '"]')
    : root.querySelector('[data-opencanvas-element="' + scene.pinTarget.elementId + '"]');
  if (!pinEl) {
    behaviourFailure('behaviour-target-missing', { scrollSceneId: scene.id, pinTarget: scene.pinTarget }, new Error('scroll scene pin target not found'));
  }
  var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
  var ticking = false;
  function update() {
    ticking = false;
    var progress = behaviourSceneProgress(scene, section);
    if (reducedMode !== 'skip') {
      behaviourApplyPin(pinEl, scene, section, progress);
      behaviourRunSequence(sequence, root, reducedMode, progress);
    }
  }
  window.addEventListener('scroll', function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

function behaviourFindRichMotionNodes(root, assetId) {
  return root.querySelectorAll('[data-rich-motion-asset-ref="' + assetId + '"]');
}

function behaviourHydrateImageSequence(asset, root, payload) {
  if (asset.kind !== 'image-sequence') {
    behaviourFailure('rich-motion-unsupported-kind', { assetId: asset.id, kind: asset.kind }, new Error('unsupported rich motion kind'));
  }
  if (!asset.frameUrls || asset.frameUrls.length === 0) {
    behaviourFailure('rich-motion-empty-frames', { assetId: asset.id }, new Error('image sequence has no frame urls'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  var images = [];
  var loaded = 0;
  var failed = false;
  function onFrameReady() {
    if (failed) return;
    loaded += 1;
    if (loaded < images.length) return;
    for (var n = 0; n < nodes.length; n++) {
      behaviourStartImageSequencePlayback(nodes[n], asset, images, payload, root);
    }
  }
  for (var i = 0; i < asset.frameUrls.length; i++) {
    (function (url, index) {
      var img = new Image();
      img.decoding = 'async';
      images.push(img);
      img.onload = onFrameReady;
      img.onerror = function (err) {
        if (failed) return;
        failed = true;
        behaviourFailure('rich-motion-frame-load', { assetId: asset.id, frameIndex: index, url: url }, err || new Error('frame load failed'));
      };
      img.src = url;
    })(asset.frameUrls[i], i);
  }
}

var behaviourRiveRuntimePromise = null;
var behaviourRiveRuntimeUrl = 'https://unpkg.com/@rive-app/canvas@2.38.1/rive.js';
var behaviourLottieRuntimePromise = null;
var behaviourLottieRuntimeUrl = 'https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/build/player/lottie.min.js';
var behaviourModelViewerRuntimePromise = null;
var behaviourModelViewerRuntimeUrl = 'https://cdn.jsdelivr.net/npm/@google/model-viewer@4.3.1/dist/model-viewer.min.js';
function behaviourLoadRiveRuntime() {
  if (typeof window !== 'undefined' && window.rive && typeof window.rive.Rive === 'function') {
    return Promise.resolve(window.rive);
  }
  if (behaviourRiveRuntimePromise) return behaviourRiveRuntimePromise;
  behaviourRiveRuntimePromise = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = behaviourRiveRuntimeUrl;
    script.async = true;
    script.onload = function () {
      if (window.rive && typeof window.rive.Rive === 'function') {
        resolve(window.rive);
      } else {
        reject(new Error('Rive runtime loaded without window.rive.Rive'));
      }
    };
    script.onerror = function () {
      reject(new Error('Rive runtime failed to load'));
    };
    document.head.appendChild(script);
  });
  return behaviourRiveRuntimePromise;
}

function behaviourLoadLottieRuntime() {
  if (typeof window !== 'undefined' && window.lottie && typeof window.lottie.loadAnimation === 'function') {
    return Promise.resolve(window.lottie);
  }
  if (behaviourLottieRuntimePromise) return behaviourLottieRuntimePromise;
  behaviourLottieRuntimePromise = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = behaviourLottieRuntimeUrl;
    script.async = true;
    script.onload = function () {
      if (window.lottie && typeof window.lottie.loadAnimation === 'function') {
        resolve(window.lottie);
      } else {
        reject(new Error('Lottie runtime loaded without window.lottie.loadAnimation'));
      }
    };
    script.onerror = function () {
      reject(new Error('Lottie runtime failed to load'));
    };
    document.head.appendChild(script);
  });
  return behaviourLottieRuntimePromise;
}

function behaviourLoadModelViewerRuntime() {
  if (typeof window !== 'undefined' && window.customElements && window.customElements.get('model-viewer')) {
    return Promise.resolve();
  }
  if (behaviourModelViewerRuntimePromise) return behaviourModelViewerRuntimePromise;
  behaviourModelViewerRuntimePromise = new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.type = 'module';
    script.src = behaviourModelViewerRuntimeUrl;
    script.onload = function () {
      if (!window.customElements) {
        reject(new Error('customElements unavailable for model-viewer'));
        return;
      }
      window.customElements.whenDefined('model-viewer').then(resolve).catch(reject);
    };
    script.onerror = function () {
      reject(new Error('model-viewer runtime failed to load'));
    };
    document.head.appendChild(script);
  });
  return behaviourModelViewerRuntimePromise;
}

function behaviourHydrateRive(asset, root) {
  if (!asset.srcUrl) {
    behaviourFailure('rich-motion-rive-src-missing', { assetId: asset.id }, new Error('Rive asset srcUrl missing'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  behaviourLoadRiveRuntime().then(function (riveRuntime) {
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (node.getAttribute('data-opencanvas-rive-hydrated') === 'true') continue;
      var canvas = behaviourFindRichMotionCanvas(node);
      var reduced = behaviourPrefersReducedMotion() && asset.reducedMotion === 'pause';
      try {
        var options = {
          src: asset.srcUrl,
          canvas: canvas,
          autoplay: reduced ? false : asset.autoplay !== false
        };
        if (asset.artboard) options.artboard = asset.artboard;
        if (asset.stateMachine) options.stateMachines = asset.stateMachine;
        var instance = new riveRuntime.Rive(options);
        node.__opencanvasRive = instance;
        if (reduced) node.setAttribute('data-opencanvas-rive-reduced', 'pause');
        node.setAttribute('data-opencanvas-rive-hydrated', 'true');
      } catch (err) {
        behaviourFailure('rich-motion-rive-init', { assetId: asset.id }, err || new Error('Rive init failed'));
      }
    }
  }).catch(function (err) {
    behaviourFailure('rich-motion-rive-runtime', { assetId: asset.id, runtimeUrl: behaviourRiveRuntimeUrl }, err || new Error('Rive runtime unavailable'));
  });
}

function behaviourHydrateModel3D(asset, root) {
  if (!asset.srcUrl) {
    behaviourFailure('rich-motion-model-3d-src-missing', { assetId: asset.id }, new Error('model-3d asset srcUrl missing'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  behaviourLoadModelViewerRuntime().then(function () {
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (node.getAttribute('data-opencanvas-model-3d-hydrated') === 'true') continue;
      try {
        var canvas = node.querySelector('[data-opencanvas-rich-motion-canvas]');
        if (canvas) canvas.setAttribute('hidden', '');
        var viewer = document.createElement('model-viewer');
        viewer.setAttribute('src', asset.srcUrl);
        viewer.setAttribute('alt', asset.alt || '');
        viewer.setAttribute('data-opencanvas-model-3d-viewer', asset.id);
        viewer.style.width = '100%';
        viewer.style.height = '100%';
        viewer.style.display = 'block';
        if (asset.posterUrl) viewer.setAttribute('poster', asset.posterUrl);
        if (asset.cameraControls === true) viewer.setAttribute('camera-controls', '');
        var reduce = behaviourPrefersReducedMotion() && asset.reducedMotion === 'static';
        if (asset.autoRotate === true && !reduce) viewer.setAttribute('auto-rotate', '');
        if (reduce) node.setAttribute('data-opencanvas-model-3d-reduced', 'static');
        viewer.addEventListener('error', function (event) {
          behaviourFailure('rich-motion-model-3d-load', { assetId: asset.id }, event && event.error ? event.error : new Error('model-viewer load failed'));
        });
        node.appendChild(viewer);
        node.setAttribute('data-opencanvas-model-3d-hydrated', 'true');
      } catch (err) {
        behaviourFailure('rich-motion-model-3d-init', { assetId: asset.id }, err || new Error('model-3d init failed'));
      }
    }
  }).catch(function (err) {
    behaviourFailure('rich-motion-model-3d-runtime', { assetId: asset.id, runtimeUrl: behaviourModelViewerRuntimeUrl }, err || new Error('model-viewer runtime unavailable'));
  });
}

function behaviourHydrateLottie(asset, root) {
  if (!asset.srcUrl) {
    behaviourFailure('rich-motion-lottie-src-missing', { assetId: asset.id }, new Error('Lottie asset srcUrl missing'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  behaviourLoadLottieRuntime().then(function (lottieRuntime) {
    for (var n = 0; n < nodes.length; n++) {
      var node = nodes[n];
      if (node.getAttribute('data-opencanvas-lottie-hydrated') === 'true') continue;
      var reduced = behaviourPrefersReducedMotion() && asset.reducedMotion === 'pause';
      try {
        var container = document.createElement('div');
        container.setAttribute('data-opencanvas-lottie-container', asset.id);
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.display = 'block';
        node.appendChild(container);
        var instance = lottieRuntime.loadAnimation({
          container: container,
          renderer: asset.renderer || 'svg',
          loop: asset.loop === true,
          autoplay: reduced ? false : asset.autoplay !== false,
          path: asset.srcUrl
        });
        node.__opencanvasLottie = instance;
        if (reduced) node.setAttribute('data-opencanvas-lottie-reduced', 'pause');
        node.setAttribute('data-opencanvas-lottie-hydrated', 'true');
      } catch (err) {
        behaviourFailure('rich-motion-lottie-init', { assetId: asset.id }, err || new Error('Lottie init failed'));
      }
    }
  }).catch(function (err) {
    behaviourFailure('rich-motion-lottie-runtime', { assetId: asset.id, runtimeUrl: behaviourLottieRuntimeUrl }, err || new Error('Lottie runtime unavailable'));
  });
}

function behaviourDrawFrame(canvas, image, fit) {
  var ctx = canvas.getContext('2d');
  if (!ctx) {
    behaviourFailure('rich-motion-canvas-context', {}, new Error('canvas 2d context unavailable'));
  }
  var width = canvas.clientWidth || canvas.width;
  var height = canvas.clientHeight || canvas.height;
  if (!(width > 0) || !(height > 0)) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  var iw = image.naturalWidth || image.width;
  var ih = image.naturalHeight || image.height;
  if (!(iw > 0) || !(ih > 0)) return;
  var scale = fit === 'contain'
    ? Math.min(width / iw, height / ih)
    : Math.max(width / iw, height / ih);
  var drawW = iw * scale;
  var drawH = ih * scale;
  var dx = (width - drawW) / 2;
  var dy = (height - drawH) / 2;
  ctx.drawImage(image, dx, dy, drawW, drawH);
}

function behaviourFindRichMotionCanvas(node) {
  var canvas = node.querySelector('[data-opencanvas-rich-motion-canvas]');
  if (!canvas) {
    behaviourFailure('rich-motion-canvas-missing', {}, new Error('rich motion canvas not found'));
  }
  return canvas;
}

function behaviourStartImageSequencePlayback(node, asset, images, payload, root) {
  var canvas = behaviourFindRichMotionCanvas(node);
  var fit = node.getAttribute('data-rich-motion-fit') || 'contain';
  var fps = asset.playback && asset.playback.fps ? asset.playback.fps : 12;
  var loop = !!(asset.playback && asset.playback.loop);
  if (asset.playback && asset.playback.driver === 'scroll-scene') {
    var scene = behaviourFindScrollScene(payload, asset.playback.scrollSceneId || '');
    var section = root.querySelector('[data-opencanvas-section="' + scene.sectionId + '"]');
    if (!section) {
      behaviourFailure('behaviour-target-missing', { assetId: asset.id, scrollSceneId: scene.id }, new Error('scroll-scene image sequence section not found'));
    }
    var ticking = false;
    function paint() {
      ticking = false;
      var progress = behaviourSceneProgress(scene, section);
      var frameIndex = Math.min(images.length - 1, Math.max(0, Math.floor(progress * (images.length - 1))));
      behaviourDrawFrame(canvas, images[frameIndex], fit);
    }
    window.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(paint);
      }
    }, { passive: true });
    paint();
    return;
  }
  var frameIndex = 0;
  behaviourDrawFrame(canvas, images[0], fit);
  var interval = window.setInterval(function () {
    frameIndex += 1;
    if (frameIndex >= images.length) {
      if (!loop) {
        window.clearInterval(interval);
        return;
      }
      frameIndex = 0;
    }
    behaviourDrawFrame(canvas, images[frameIndex], fit);
  }, Math.max(16, Math.round(1000 / fps)));
}

function behaviourHydrateLoadExperience(load, payload, root) {
  var node = root.querySelector('[data-opencanvas-load-experience="' + load.id + '"]');
  if (!node) {
    behaviourFailure('behaviour-load-experience-missing', { loadExperienceId: load.id }, new Error('load experience node not found'));
  }
  if (node.getAttribute('data-opencanvas-load-hydrated') === 'true') return;
  node.setAttribute('data-opencanvas-load-hydrated', 'true');
  var enter = node.querySelector('[data-opencanvas-load-enter]');
  var sequence = behaviourFindSequence(payload, load.sequenceId);
  function dismiss() {
    node.setAttribute('data-opencanvas-load-hidden', 'true');
    node.style.pointerEvents = 'none';
    node.style.opacity = '0';
    var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
    behaviourRunSequence(sequence, root, reducedMode);
  }
  if (enter) {
    enter.addEventListener('click', function (event) {
      event.preventDefault();
      dismiss();
    });
  }
}

function hydrateBehaviour(scope) {
  var root = scope || document;
  if (root === document && document.documentElement.getAttribute('data-opencanvas-behaviour-hydrated') === 'true') return;
  var payload = parseBehaviourPayload();
  if (!payload) return;
  if (payload.loadExperience) {
    behaviourHydrateLoadExperience(payload.loadExperience, payload, root);
  }
  var sequences = payload.motionSequences || [];
  for (var i = 0; i < sequences.length; i++) {
    var sequence = sequences[i];
    if (sequence.trigger.type === 'load-enter') {
      if (!payload.loadExperience) {
        var reducedLoad = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
        behaviourRunSequence(sequence, root, reducedLoad);
      }
    } else if (sequence.trigger.type === 'section-enter') {
      behaviourSetupSectionEnter(sequence, root);
    }
  }
  var scenes = payload.scrollScenes || [];
  for (var s = 0; s < scenes.length; s++) {
    var scene = scenes[s];
    var linked = behaviourFindSequence(payload, scene.sequenceId);
    if (linked.trigger.type !== 'scroll-scene' || linked.trigger.scrollSceneId !== scene.id) {
      behaviourFailure('behaviour-scroll-scene-sequence', { scrollSceneId: scene.id, sequenceId: scene.sequenceId }, new Error('scroll scene sequence trigger mismatch'));
    }
    behaviourSetupScrollScene(scene, linked, root);
  }
  var assets = payload.richMotionAssets || [];
  for (var a = 0; a < assets.length; a++) {
    if (assets[a].kind === 'image-sequence') {
      behaviourHydrateImageSequence(assets[a], root, payload);
    } else if (assets[a].kind === 'rive') {
      behaviourHydrateRive(assets[a], root);
    } else if (assets[a].kind === 'lottie') {
      behaviourHydrateLottie(assets[a], root);
    } else if (assets[a].kind === 'model-3d') {
      behaviourHydrateModel3D(assets[a], root);
    } else {
      behaviourFailure('rich-motion-unsupported-kind', { assetId: assets[a].id, kind: assets[a].kind }, new Error('unsupported rich motion kind'));
    }
  }
  if (root === document) document.documentElement.setAttribute('data-opencanvas-behaviour-hydrated', 'true');
}
`;
