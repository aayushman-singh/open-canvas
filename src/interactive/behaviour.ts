// src/interactive/behaviour.ts
//
// Behaviour runtime fragment. Parses the authored behaviour payload, hydrates
// load experience chrome, text-split targets, motion sequences, scroll scenes,
// layout transitions, and rich motion assets. Emits `opencanvas:behaviour-failure`
// and throws on any unresolved target, asset, or adapter mismatch.

export const BEHAVIOUR_RUNTIME_SRC = String.raw`
var behaviourRuntimeOptions = {};
function behaviourFailure(code, context, cause) {
  var detail = { code: code, context: context, cause: cause && cause.message ? cause.message : String(cause) };
  if (typeof console !== 'undefined' && console.error) console.error('[opencanvas behaviour]', detail);
  if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
    document.dispatchEvent(new CustomEvent('opencanvas:behaviour-failure', { detail: detail }));
  }
  throw cause instanceof Error ? cause : new Error(code + ': ' + detail.cause);
}

function behaviourPrefersReducedMotion() {
  if (behaviourRuntimeOptions && behaviourRuntimeOptions.reducedMotion === 'reduce') return true;
  if (behaviourRuntimeOptions && behaviourRuntimeOptions.reducedMotion === 'no-preference') return false;
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

function behaviourSequenceRepeatOptions(repeat) {
  if (!repeat) return { iterations: 1, direction: 'normal' };
  var count = Number(repeat.count);
  if (!isFinite(count) || Math.floor(count) !== count || count < 1 || count > 20) {
    behaviourFailure('motion-sequence-repeat-count', { repeat: repeat }, new Error('repeat count must be 1-20'));
  }
  if (repeat.mode !== 'restart' && repeat.mode !== 'yoyo') {
    behaviourFailure('motion-sequence-repeat-mode', { repeat: repeat }, new Error('unsupported repeat mode'));
  }
  return {
    iterations: count + 1,
    direction: repeat.mode === 'yoyo' ? 'alternate' : 'normal'
  };
}

function behaviourAnimateTargets(targets, step, reducedMode, progress, repeat, playbackDirection) {
  var from = step.from || {};
  var to = step.to || {};
  var direction = playbackDirection || 'normal';
  if (direction !== 'normal' && direction !== 'reverse') {
    behaviourFailure('motion-sequence-playback-direction', { playbackDirection: playbackDirection }, new Error('unsupported playback direction'));
  }
  if (progress !== undefined && direction === 'reverse') {
    behaviourFailure('motion-sequence-playback-direction-scroll-scene', { playbackDirection: playbackDirection }, new Error('scroll-scene Motion Sequences cannot reverse playback'));
  }
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
    keyframes.push(behaviourPropsAtProgress(fromProps, toProps, direction === 'reverse' ? 1 : 0));
    keyframes.push(behaviourPropsAtProgress(fromProps, toProps, direction === 'reverse' ? 0 : 1));
    var repeatOptions = behaviourSequenceRepeatOptions(repeat);
    var options = {
      duration: step.durationMs || 0,
      delay: (step.delayMs || 0) + index * stagger,
      easing: step.easing || 'ease',
      fill: 'forwards',
      iterations: repeatOptions.iterations,
      direction: repeatOptions.direction,
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
    behaviourAnimateTargets(
      targets,
      step,
      reducedMode,
      progress,
      progress === undefined ? sequence.repeat : null,
      sequence.playbackDirection || 'normal',
    );
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
  if (sequence.repeat) {
    behaviourFailure('motion-sequence-repeat-scroll-scene', { sequenceId: sequence.id, scrollSceneId: scene.id }, new Error('scroll-scene Motion Sequences cannot repeat'));
  }
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

function behaviourShaderColor(asset, value, role) {
  var match = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(String(value || ''));
  if (!match) {
    behaviourFailure('rich-motion-shader-color', { assetId: asset.id, role: role, value: value }, new Error('shader-scene color must be hex'));
  }
  var hex = match[1];
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16) / 255,
      parseInt(hex[1] + hex[1], 16) / 255,
      parseInt(hex[2] + hex[2], 16) / 255
    ];
  }
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255
  ];
}

function behaviourShaderPresetIndex(asset) {
  if (asset.preset === 'aurora-flow') return 0;
  if (asset.preset === 'racing-lines') return 1;
  if (asset.preset === 'particle-field') return 2;
  behaviourFailure('rich-motion-shader-preset', { assetId: asset.id, preset: asset.preset }, new Error('unsupported shader-scene preset'));
}

function behaviourCompileShader(gl, type, source, asset) {
  var shader = gl.createShader(type);
  if (!shader) {
    behaviourFailure('rich-motion-shader-program', { assetId: asset.id }, new Error('WebGL shader allocation failed'));
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var info = gl.getShaderInfoLog(shader) || 'shader compile failed';
    gl.deleteShader(shader);
    behaviourFailure('rich-motion-shader-program', { assetId: asset.id, info: info }, new Error(info));
  }
  return shader;
}

function behaviourCreateShaderProgram(gl, asset) {
  var vertexSource = 'attribute vec2 a_position; void main(){ gl_Position = vec4(a_position, 0.0, 1.0); }';
  var fragmentSource = [
    'precision mediump float;',
    'uniform vec2 u_resolution;',
    'uniform float u_time;',
    'uniform float u_density;',
    'uniform float u_preset;',
    'uniform vec3 u_colorA;',
    'uniform vec3 u_colorB;',
    'void main(){',
    'vec2 uv = gl_FragCoord.xy / max(u_resolution, vec2(1.0));',
    'float v = 0.0;',
    'if (u_preset < 0.5) {',
    '  v = 0.5 + 0.5 * sin((uv.x * 5.0) + (uv.y * 3.0) + u_time);',
    '} else if (u_preset < 1.5) {',
    '  float lane = abs(sin((uv.y + uv.x * 0.18 + u_time * 0.28) * (12.0 + u_density * 28.0)));',
    '  v = smoothstep(0.86, 1.0, lane);',
    '} else {',
    '  vec2 grid = fract(uv * (8.0 + u_density * 34.0) + vec2(u_time * 0.04, u_time * 0.02));',
    '  float dotField = 1.0 - smoothstep(0.0, 0.18, length(grid - 0.5));',
    '  v = dotField;',
    '}',
    'vec3 color = mix(u_colorB, u_colorA, clamp(v, 0.0, 1.0));',
    'gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('');
  var vertex = behaviourCompileShader(gl, gl.VERTEX_SHADER, vertexSource, asset);
  var fragment = behaviourCompileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, asset);
  var program = gl.createProgram();
  if (!program) {
    behaviourFailure('rich-motion-shader-program', { assetId: asset.id }, new Error('WebGL program allocation failed'));
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var info = gl.getProgramInfoLog(program) || 'shader link failed';
    behaviourFailure('rich-motion-shader-program', { assetId: asset.id, info: info }, new Error(info));
  }
  return program;
}

function behaviourHydrateShaderScene(asset, root) {
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];
    if (node.getAttribute('data-opencanvas-shader-scene-hydrated') === 'true') continue;
    try {
      var canvas = behaviourFindRichMotionCanvas(node);
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        behaviourFailure('rich-motion-shader-context', { assetId: asset.id }, new Error('WebGL context unavailable'));
      }
      var width = canvas.clientWidth || canvas.width;
      var height = canvas.clientHeight || canvas.height;
      if (!(width > 0) || !(height > 0)) {
        behaviourFailure('rich-motion-shader-size', { assetId: asset.id, width: width, height: height }, new Error('shader-scene canvas has no drawable size'));
      }
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      var program = behaviourCreateShaderProgram(gl, asset);
      var position = gl.getAttribLocation(program, 'a_position');
      if (position < 0) {
        behaviourFailure('rich-motion-shader-program', { assetId: asset.id }, new Error('shader position attribute missing'));
      }
      var buffer = gl.createBuffer();
      if (!buffer) {
        behaviourFailure('rich-motion-shader-program', { assetId: asset.id }, new Error('WebGL buffer allocation failed'));
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
      gl.useProgram(program);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      var resolution = gl.getUniformLocation(program, 'u_resolution');
      var time = gl.getUniformLocation(program, 'u_time');
      var density = gl.getUniformLocation(program, 'u_density');
      var preset = gl.getUniformLocation(program, 'u_preset');
      var colorA = gl.getUniformLocation(program, 'u_colorA');
      var colorB = gl.getUniformLocation(program, 'u_colorB');
      if (!resolution || !time || !density || !preset || !colorA || !colorB) {
        behaviourFailure('rich-motion-shader-program', { assetId: asset.id }, new Error('shader uniforms missing'));
      }
      var rgbA = behaviourShaderColor(asset, asset.colorA, 'colorA');
      var rgbB = behaviourShaderColor(asset, asset.colorB, 'colorB');
      var presetIndex = behaviourShaderPresetIndex(asset);
      var speed = typeof asset.speed === 'number' && isFinite(asset.speed) ? asset.speed : 1;
      var dens = typeof asset.density === 'number' && isFinite(asset.density) ? asset.density : 0.5;
      var reduce = behaviourPrefersReducedMotion() && asset.reducedMotion === 'static';
      if (reduce) node.setAttribute('data-opencanvas-shader-scene-reduced', 'static');
      var start = 0;
      function draw(now) {
        if (!start) start = now || 0;
        var elapsed = reduce ? 0 : ((now || 0) - start) / 1000 * speed;
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.uniform2f(resolution, canvas.width, canvas.height);
        gl.uniform1f(time, elapsed);
        gl.uniform1f(density, Math.max(0, Math.min(1, dens)));
        gl.uniform1f(preset, presetIndex);
        gl.uniform3f(colorA, rgbA[0], rgbA[1], rgbA[2]);
        gl.uniform3f(colorB, rgbB[0], rgbB[1], rgbB[2]);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        if (!reduce) requestAnimationFrame(draw);
      }
      draw(0);
      node.setAttribute('data-opencanvas-shader-scene-hydrated', 'true');
    } catch (err) {
      behaviourFailure('rich-motion-shader-init', { assetId: asset.id }, err || new Error('shader-scene init failed'));
    }
  }
}

function behaviourRiveEventName(eventName) {
  if (eventName === 'pointer-enter') return 'pointerenter';
  if (eventName === 'pointer-leave') return 'pointerleave';
  if (eventName === 'focus') return 'focusin';
  if (eventName === 'blur') return 'focusout';
  if (eventName === 'click') return 'click';
  behaviourFailure('rich-motion-rive-input-event', { event: eventName }, new Error('unsupported Rive input event'));
}

function behaviourRiveInputTypeName(input) {
  return String(input && input.type !== undefined ? input.type : '').toLowerCase();
}

function behaviourRiveInputMatches(input, binding) {
  var actual = behaviourRiveInputTypeName(input);
  if (binding.inputType === 'boolean') return actual === 'boolean' || actual === 'bool';
  if (binding.inputType === 'number') return actual === 'number';
  if (binding.inputType === 'trigger') return actual === 'trigger' || typeof input.fire === 'function';
  return false;
}

function behaviourFindRiveInput(asset, binding, inputs) {
  var input = null;
  for (var i = 0; i < inputs.length; i++) {
    if (inputs[i] && inputs[i].name === binding.inputName) {
      input = inputs[i];
      break;
    }
  }
  if (!input) {
    behaviourFailure('rich-motion-rive-input-missing', {
      assetId: asset.id,
      bindingId: binding.id,
      inputName: binding.inputName,
      stateMachine: asset.stateMachine
    }, new Error('Rive state machine input not found'));
  }
  if (!behaviourRiveInputMatches(input, binding)) {
    behaviourFailure('rich-motion-rive-input-type', {
      assetId: asset.id,
      bindingId: binding.id,
      inputName: binding.inputName,
      expectedType: binding.inputType,
      actualType: input.type
    }, new Error('Rive state machine input type mismatch'));
  }
  return input;
}

function behaviourApplyRiveInput(asset, binding, input, value) {
  if (binding.inputType === 'trigger') {
    if (typeof input.fire !== 'function') {
      behaviourFailure('rich-motion-rive-input-fire', {
        assetId: asset.id,
        bindingId: binding.id,
        inputName: binding.inputName
      }, new Error('Rive trigger input cannot fire'));
    }
    input.fire();
    return;
  }
  if (binding.inputType === 'boolean') {
    if (typeof value !== 'boolean') {
      behaviourFailure('rich-motion-rive-input-value', {
        assetId: asset.id,
        bindingId: binding.id,
        inputName: binding.inputName,
        value: value
      }, new Error('Rive boolean input value must be boolean'));
    }
    input.value = value;
    return;
  }
  if (binding.inputType === 'number') {
    if (typeof value !== 'number' || !isFinite(value)) {
      behaviourFailure('rich-motion-rive-input-value', {
        assetId: asset.id,
        bindingId: binding.id,
        inputName: binding.inputName,
        value: value
      }, new Error('Rive number input value must be finite number'));
    }
    input.value = value;
    return;
  }
  behaviourFailure('rich-motion-rive-input-type', {
    assetId: asset.id,
    bindingId: binding.id,
    inputName: binding.inputName,
    expectedType: binding.inputType
  }, new Error('unsupported Rive input binding type'));
}

function behaviourBindRiveInputs(asset, node, instance, root, payload) {
  var bindings = asset.inputs || [];
  if (!bindings.length) return;
  if (node.getAttribute('data-opencanvas-rive-inputs-hydrated') === 'true') return;
  if (behaviourPrefersReducedMotion() && asset.reducedMotion === 'pause') {
    node.setAttribute('data-opencanvas-rive-inputs-reduced', 'skip');
    return;
  }
  if (!asset.stateMachine) {
    behaviourFailure('rich-motion-rive-state-machine-missing', { assetId: asset.id }, new Error('Rive input bindings require stateMachine'));
  }
  if (!instance || typeof instance.stateMachineInputs !== 'function') {
    behaviourFailure('rich-motion-rive-input-api', { assetId: asset.id }, new Error('Rive stateMachineInputs API unavailable'));
  }
  var inputs = instance.stateMachineInputs(asset.stateMachine);
  if (!inputs || typeof inputs.length !== 'number') {
    behaviourFailure('rich-motion-rive-input-api', { assetId: asset.id, stateMachine: asset.stateMachine }, new Error('Rive stateMachineInputs did not return an input list'));
  }
  for (var i = 0; i < bindings.length; i++) {
    var binding = bindings[i];
    var input = behaviourFindRiveInput(asset, binding, inputs);
    if (binding.event === 'scroll-progress') {
      var scene = behaviourFindScrollScene(payload, binding.scrollSceneId || '');
      var section = root.querySelector('[data-opencanvas-section="' + scene.sectionId + '"]');
      if (!section) {
        behaviourFailure('rich-motion-rive-scroll-target-missing', {
          assetId: asset.id,
          bindingId: binding.id,
          scrollSceneId: scene.id,
          sectionId: scene.sectionId
        }, new Error('Rive scroll-progress section not found'));
      }
      (function (sceneRef, sectionRef, bindingRef, inputRef) {
        var ticking = false;
        function paint() {
          ticking = false;
          behaviourApplyRiveInput(asset, bindingRef, inputRef, behaviourSceneProgress(sceneRef, sectionRef));
          node.setAttribute('data-opencanvas-rive-input-last', bindingRef.id);
        }
        window.addEventListener('scroll', function () {
          if (!ticking) {
            ticking = true;
            requestAnimationFrame(paint);
          }
        }, { passive: true });
        paint();
      })(scene, section, binding, input);
      continue;
    }
    var eventName = behaviourRiveEventName(binding.event);
    if ((eventName === 'focusin' || eventName === 'focusout') && !node.getAttribute('tabindex')) {
      node.setAttribute('tabindex', '0');
    }
    (function (bindingRef, inputRef, eventRef) {
      node.addEventListener(eventRef, function () {
        behaviourApplyRiveInput(asset, bindingRef, inputRef, bindingRef.value);
        node.setAttribute('data-opencanvas-rive-input-last', bindingRef.id);
      });
    })(binding, input, eventName);
  }
  node.setAttribute('data-opencanvas-rive-inputs-hydrated', 'true');
}

function behaviourHydrateRive(asset, root, payload) {
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
      (function (nodeRef, canvasRef) {
      try {
        var instance = null;
        var options = {
          src: asset.srcUrl,
          canvas: canvasRef,
          autoplay: reduced ? false : asset.autoplay !== false
        };
        if (asset.artboard) options.artboard = asset.artboard;
        if (asset.stateMachine) options.stateMachines = asset.stateMachine;
        if (asset.inputs && asset.inputs.length) {
          options.onLoad = function () {
            behaviourBindRiveInputs(asset, nodeRef, instance, root, payload);
          };
        }
        instance = new riveRuntime.Rive(options);
        nodeRef.__opencanvasRive = instance;
        if (reduced) nodeRef.setAttribute('data-opencanvas-rive-reduced', 'pause');
        nodeRef.setAttribute('data-opencanvas-rive-hydrated', 'true');
      } catch (err) {
        behaviourFailure('rich-motion-rive-init', { assetId: asset.id }, err || new Error('Rive init failed'));
      }
      })(node, canvas);
    }
  }).catch(function (err) {
    behaviourFailure('rich-motion-rive-runtime', { assetId: asset.id, runtimeUrl: behaviourRiveRuntimeUrl }, err || new Error('Rive runtime unavailable'));
  });
}

function behaviourVideoStreamPlay(asset, video, eventName) {
  if (!video || typeof video.play !== 'function') {
    behaviourFailure('rich-motion-video-stream-api', { assetId: asset.id, event: eventName }, new Error('video.play unavailable'));
  }
  var result = video.play();
  if (result && typeof result.catch === 'function') {
    result.catch(function (err) {
      behaviourFailure('rich-motion-video-stream-play', { assetId: asset.id, event: eventName }, err || new Error('video play failed'));
    });
  }
}

function behaviourVideoStreamPause(asset, video, resetOnExit) {
  if (!video || typeof video.pause !== 'function') {
    behaviourFailure('rich-motion-video-stream-api', { assetId: asset.id, event: 'pause' }, new Error('video.pause unavailable'));
  }
  video.pause();
  if (resetOnExit) {
    try {
      video.currentTime = 0;
    } catch (err) {
      behaviourFailure('rich-motion-video-stream-reset', { assetId: asset.id }, err || new Error('video reset failed'));
    }
  }
}

function behaviourHydrateVideoStream(asset, root) {
  if (!asset.srcUrl) {
    behaviourFailure('rich-motion-video-stream-src-missing', { assetId: asset.id }, new Error('video-stream asset srcUrl missing'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  var trigger = asset.playback && asset.playback.trigger;
  if (trigger !== 'hover-focus' && trigger !== 'click-toggle' && trigger !== 'load') {
    behaviourFailure('rich-motion-video-stream-trigger', { assetId: asset.id, trigger: trigger }, new Error('unsupported video-stream trigger'));
  }
  if ((trigger === 'hover-focus' || trigger === 'load') && asset.muted !== true) {
    behaviourFailure('rich-motion-video-stream-muted', { assetId: asset.id, trigger: trigger }, new Error('hover/load video streams must be muted'));
  }
  for (var n = 0; n < nodes.length; n++) {
    var node = nodes[n];
    if (node.getAttribute('data-opencanvas-video-stream-hydrated') === 'true') continue;
    try {
      var canvas = node.querySelector('[data-opencanvas-rich-motion-canvas]');
      if (canvas) {
        canvas.style.display = 'none';
        canvas.setAttribute('hidden', '');
      }
      var video = document.createElement('video');
      video.setAttribute('data-opencanvas-video-stream', asset.id);
      video.setAttribute('src', asset.srcUrl);
      video.src = asset.srcUrl;
      if (asset.posterUrl) {
        video.setAttribute('poster', asset.posterUrl);
        video.poster = asset.posterUrl;
      }
      video.setAttribute('preload', 'metadata');
      video.preload = 'metadata';
      video.setAttribute('playsinline', '');
      video.playsInline = true;
      video.muted = asset.muted === true;
      if (video.muted) video.setAttribute('muted', '');
      video.loop = asset.loop === true;
      if (video.loop) video.setAttribute('loop', '');
      video.controls = asset.controls === true;
      if (video.controls) video.setAttribute('controls', '');
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.display = 'block';
      video.style.objectFit = node.getAttribute('data-rich-motion-fit') === 'contain' ? 'contain' : 'cover';
      if (asset.alt) {
        node.setAttribute('aria-label', asset.alt);
        video.setAttribute('aria-label', asset.alt);
      }
      node.appendChild(video);
      node.setAttribute('data-opencanvas-video-stream-trigger', trigger);
      var reduce = behaviourPrefersReducedMotion() && asset.reducedMotion === 'poster';
      if (reduce) {
        if (!asset.posterUrl) {
          behaviourFailure('rich-motion-video-stream-poster-missing', { assetId: asset.id }, new Error('reduced-motion poster requested without posterUrl'));
        }
        node.setAttribute('data-opencanvas-video-stream-reduced', 'poster');
        node.setAttribute('data-opencanvas-video-stream-hydrated', 'true');
        continue;
      }
      var resetOnExit = !!(asset.playback && asset.playback.resetOnExit);
      if (trigger === 'hover-focus') {
        if (!node.getAttribute('tabindex')) node.setAttribute('tabindex', '0');
        (function (assetRef, videoRef, nodeRef, resetRef) {
          nodeRef.addEventListener('pointerenter', function () {
            behaviourVideoStreamPlay(assetRef, videoRef, 'pointerenter');
          });
          nodeRef.addEventListener('focusin', function () {
            behaviourVideoStreamPlay(assetRef, videoRef, 'focusin');
          });
          nodeRef.addEventListener('pointerleave', function () {
            behaviourVideoStreamPause(assetRef, videoRef, resetRef);
          });
          nodeRef.addEventListener('focusout', function () {
            behaviourVideoStreamPause(assetRef, videoRef, resetRef);
          });
        })(asset, video, node, resetOnExit);
      } else if (trigger === 'click-toggle') {
        if (!node.getAttribute('tabindex')) node.setAttribute('tabindex', '0');
        (function (assetRef, videoRef, nodeRef) {
          function toggle(event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault();
            if (videoRef.paused === false) {
              behaviourVideoStreamPause(assetRef, videoRef, false);
            } else {
              behaviourVideoStreamPlay(assetRef, videoRef, 'click');
            }
          }
          nodeRef.addEventListener('click', toggle);
          nodeRef.addEventListener('keydown', function (event) {
            var key = event && event.key;
            if (key === 'Enter' || key === ' ') toggle(event);
          });
        })(asset, video, node);
      } else {
        behaviourVideoStreamPlay(asset, video, 'load');
      }
      node.setAttribute('data-opencanvas-video-stream-hydrated', 'true');
    } catch (err) {
      behaviourFailure('rich-motion-video-stream-init', { assetId: asset.id }, err || new Error('video-stream init failed'));
    }
  }
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
  if (behaviourShouldSkipLoadExperience(load)) {
    node.setAttribute('data-opencanvas-load-skipped', 'true');
    node.setAttribute('data-opencanvas-load-hidden', 'true');
    node.style.pointerEvents = 'none';
    node.style.opacity = '0';
    return;
  }
  var enter = node.querySelector('[data-opencanvas-load-enter]');
  var sequence = behaviourFindSequence(payload, load.sequenceId);
  var readiness = behaviourHydrateLoadReadiness(node, load, enter);
  behaviourHydrateLoadLogoDraw(node, load);
  var finishProgress = behaviourHydrateLoadProgress(node, load);
  function dismiss() {
    if (!readiness.ready) {
      behaviourFailure('load-readiness-pending', { loadExperienceId: load.id }, new Error('load media readiness is still pending'));
    }
    behaviourMarkLoadExperienceSeen(load);
    finishProgress();
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

function behaviourHydrateLoadReadiness(node, load, enter) {
  var readiness = load.mediaReadiness;
  if (!readiness) return { ready: true };
  var urlsAttr = node.getAttribute('data-opencanvas-load-readiness-urls');
  if (!urlsAttr) {
    behaviourFailure('load-readiness-urls-missing', { loadExperienceId: load.id }, new Error('load readiness urls missing'));
  }
  var urls = urlsAttr.split(/\s+/).filter(Boolean);
  if (!urls.length || urls.length !== readiness.assetIds.length) {
    behaviourFailure('load-readiness-url-count', { loadExperienceId: load.id, expected: readiness.assetIds.length, actual: urls.length }, new Error('load readiness url count mismatch'));
  }
  var timeoutAttr = node.getAttribute('data-opencanvas-load-readiness-timeout-ms');
  var timeoutMs = timeoutAttr === null ? Number(readiness.timeoutMs) : Number(timeoutAttr);
  if (!isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000) {
    behaviourFailure('load-readiness-timeout-invalid', { loadExperienceId: load.id, timeoutMs: timeoutAttr }, new Error('invalid load readiness timeout'));
  }
  if (typeof window.fetch !== 'function') {
    behaviourFailure('load-readiness-fetch-unavailable', { loadExperienceId: load.id }, new Error('fetch unavailable for load readiness'));
  }
  var state = { ready: false };
  var done = false;
  var remaining = urls.length;
  var timeoutId = null;
  node.setAttribute('data-opencanvas-load-readiness', 'pending');
  if (enter) enter.setAttribute('disabled', 'true');
  function finishReady() {
    if (done) return;
    done = true;
    state.ready = true;
    if (timeoutId !== null && typeof window.clearTimeout === 'function') window.clearTimeout(timeoutId);
    node.setAttribute('data-opencanvas-load-readiness', 'ready');
    if (enter) enter.removeAttribute('disabled');
  }
  function failReady(code, url, cause) {
    if (done) return;
    done = true;
    behaviourFailure(code, { loadExperienceId: load.id, url: url }, cause instanceof Error ? cause : new Error(String(cause)));
  }
  if (timeoutMs > 0) {
    if (typeof window.setTimeout !== 'function') {
      behaviourFailure('load-readiness-timeout-unavailable', { loadExperienceId: load.id }, new Error('setTimeout unavailable for load readiness'));
    }
    timeoutId = window.setTimeout(function(){
      failReady('load-readiness-timeout', null, new Error('load readiness timed out'));
    }, timeoutMs);
  }
  for (var i = 0; i < urls.length; i++) {
    (function(url){
      window.fetch(url).then(function(response){
        if (!response || response.ok !== true) {
          failReady('load-readiness-fetch-failed', url, new Error('load readiness fetch failed'));
          return;
        }
        remaining -= 1;
        if (remaining === 0) finishReady();
      }, function(err){
        failReady('load-readiness-fetch-rejected', url, err);
      });
    })(urls[i]);
  }
  return state;
}

function behaviourHydrateLoadLogoDraw(node, load) {
  var logoDraw = load.logoDraw;
  if (!logoDraw) return;
  var logo = node.querySelector('[data-opencanvas-load-logo-draw]');
  if (!logo) {
    behaviourFailure('load-logo-draw-missing', { loadExperienceId: load.id }, new Error('load logo draw node missing'));
  }
  var text = logo.querySelector('[data-opencanvas-load-logo-draw-text]');
  if (!text) {
    behaviourFailure('load-logo-draw-text-missing', { loadExperienceId: load.id }, new Error('load logo draw text node missing'));
  }
  var durationAttr = logo.getAttribute('data-opencanvas-load-logo-draw-duration-ms');
  var duration = durationAttr === null ? Number(logoDraw.durationMs) : Number(durationAttr);
  if (!isFinite(duration) || duration < 0 || duration > 30000) {
    behaviourFailure('load-logo-draw-duration', { loadExperienceId: load.id, durationMs: durationAttr }, new Error('invalid load logo draw duration'));
  }
  if (typeof text.getComputedTextLength !== 'function') {
    behaviourFailure('load-logo-draw-measure-unavailable', { loadExperienceId: load.id }, new Error('SVG text length API unavailable'));
  }
  var length = text.getComputedTextLength();
  if (!isFinite(length) || length <= 0) {
    behaviourFailure('load-logo-draw-zero-length', { loadExperienceId: load.id }, new Error('SVG text length must be measurable'));
  }
  text.style.strokeDasharray = String(length);
  text.style.strokeDashoffset = String(length);
  if (behaviourPrefersReducedMotion() || duration === 0) {
    text.style.strokeDashoffset = '0';
    logo.setAttribute('data-opencanvas-load-logo-draw-hydrated', 'true');
    return;
  }
  if (typeof text.animate !== 'function') {
    behaviourFailure('load-logo-draw-waapi-missing', { loadExperienceId: load.id }, new Error('WAAPI unavailable for load logo draw'));
  }
  text.animate(
    [{ strokeDashoffset: String(length) }, { strokeDashoffset: '0' }],
    { duration: duration, easing: 'ease-out', fill: 'forwards' },
  );
  logo.setAttribute('data-opencanvas-load-logo-draw-hydrated', 'true');
}

function behaviourLoadRunPolicy(load) {
  var policy = load.runPolicy || 'every-visit';
  if (policy !== 'every-visit' && policy !== 'once-per-session') {
    behaviourFailure('load-run-policy-invalid', { loadExperienceId: load.id, runPolicy: policy }, new Error('unsupported load run policy'));
  }
  return policy;
}

function behaviourLoadStorage(load, phase) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) {
      behaviourFailure('load-run-policy-storage-unavailable', { loadExperienceId: load.id, phase: phase }, new Error('sessionStorage unavailable'));
    }
    return window.sessionStorage;
  } catch (err) {
    behaviourFailure('load-run-policy-storage-unavailable', { loadExperienceId: load.id, phase: phase }, err);
  }
}

function behaviourLoadStorageKey(load) {
  return 'opencanvas:load-experience:' + load.id;
}

function behaviourShouldSkipLoadExperience(load) {
  var policy = behaviourLoadRunPolicy(load);
  if (policy === 'every-visit') return false;
  var storage = behaviourLoadStorage(load, 'read');
  try {
    return storage.getItem(behaviourLoadStorageKey(load)) === 'seen';
  } catch (err) {
    behaviourFailure('load-run-policy-storage-read', { loadExperienceId: load.id }, err);
  }
}

function behaviourMarkLoadExperienceSeen(load) {
  var policy = behaviourLoadRunPolicy(load);
  if (policy === 'every-visit') return;
  var storage = behaviourLoadStorage(load, 'write');
  try {
    storage.setItem(behaviourLoadStorageKey(load), 'seen');
  } catch (err) {
    behaviourFailure('load-run-policy-storage-write', { loadExperienceId: load.id }, err);
  }
}

function behaviourHydrateLoadProgress(node, load) {
  var progress = load.progress;
  if (!progress || progress.display === 'hidden') return function(){};
  var display = progress.display;
  if (display !== 'bar' && display !== 'number' && display !== 'bar-number') {
    behaviourFailure('load-progress-display', { loadExperienceId: load.id, display: display }, new Error('unsupported load progress display'));
  }
  var duration = Number(progress.durationMs);
  if (!isFinite(duration) || duration < 0 || duration > 30000) {
    behaviourFailure('load-progress-duration', { loadExperienceId: load.id, durationMs: progress.durationMs }, new Error('invalid load progress duration'));
  }
  var progressNode = node.querySelector('[data-opencanvas-load-progress]');
  if (!progressNode) {
    behaviourFailure('load-progress-missing', { loadExperienceId: load.id }, new Error('load progress node missing'));
  }
  var numberNode = display === 'number' || display === 'bar-number'
    ? progressNode.querySelector('[data-opencanvas-load-progress-number]')
    : null;
  if ((display === 'number' || display === 'bar-number') && !numberNode) {
    behaviourFailure('load-progress-number-missing', { loadExperienceId: load.id }, new Error('load progress number node missing'));
  }
  var barNode = display === 'bar' || display === 'bar-number'
    ? progressNode.querySelector('[data-opencanvas-load-progress-bar]')
    : null;
  if ((display === 'bar' || display === 'bar-number') && !barNode) {
    behaviourFailure('load-progress-bar-missing', { loadExperienceId: load.id }, new Error('load progress bar node missing'));
  }
  progressNode.setAttribute('data-opencanvas-load-progress-hydrated', 'true');
  var done = false;
  var started = Date.now();
  var interval = null;
  function setProgress(value) {
    var clamped = Math.max(0, Math.min(100, Math.round(value)));
    if (numberNode) numberNode.textContent = String(clamped);
    if (barNode) barNode.style.transform = 'scaleX(' + (clamped / 100).toFixed(3) + ')';
    progressNode.setAttribute('data-opencanvas-load-progress-value', String(clamped));
  }
  function finish() {
    if (done) return;
    done = true;
    if (interval !== null) window.clearInterval(interval);
    setProgress(100);
  }
  if (duration === 0) {
    finish();
    return finish;
  }
  interval = window.setInterval(function(){
    var elapsed = Date.now() - started;
    var pct = Math.min(100, elapsed / duration * 100);
    setProgress(pct);
    if (pct >= 100) finish();
  }, 50);
  setProgress(0);
  return finish;
}

function behaviourAttrValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function behaviourFindLayoutElement(root, transition, elementId, role) {
  var node = root.querySelector('[data-opencanvas-element="' + behaviourAttrValue(elementId) + '"]');
  if (!node) {
    behaviourFailure('layout-transition-target-missing', {
      layoutTransitionId: transition.id,
      role: role,
      elementId: elementId
    }, new Error('layout transition ' + role + ' element not found'));
  }
  return node;
}

function behaviourSetLayoutState(transition, source, target, state) {
  var sourceActive = state === 'source';
  source.hidden = !sourceActive;
  target.hidden = sourceActive;
  if (sourceActive) {
    source.setAttribute('data-opencanvas-layout-transition-state', 'active');
    target.removeAttribute('data-opencanvas-layout-transition-state');
    target.setAttribute('aria-hidden', 'true');
    source.removeAttribute('aria-hidden');
  } else {
    target.setAttribute('data-opencanvas-layout-transition-state', 'active');
    source.removeAttribute('data-opencanvas-layout-transition-state');
    source.setAttribute('aria-hidden', 'true');
    target.removeAttribute('aria-hidden');
  }
}

function behaviourClearLayoutViewTransitionName(source, target) {
  source.style.viewTransitionName = '';
  target.style.viewTransitionName = '';
}

function behaviourHydrateLayoutTransition(transition, root) {
  var trigger = behaviourFindLayoutElement(root, transition, transition.triggerElementId, 'trigger');
  var source = behaviourFindLayoutElement(root, transition, transition.sourceElementId, 'source');
  var target = behaviourFindLayoutElement(root, transition, transition.targetElementId, 'target');
  if (trigger.getAttribute('data-opencanvas-layout-transition-hydrated') === transition.id) return;
  trigger.setAttribute('data-opencanvas-layout-transition-hydrated', transition.id);
  var currentState = transition.initialState === 'target' ? 'target' : 'source';
  behaviourSetLayoutState(transition, source, target, currentState);
  trigger.addEventListener('click', function(event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    var nextState = currentState === 'source' ? 'target' : 'source';
    var reduce = behaviourPrefersReducedMotion() && transition.reducedMotion === 'instant';
    if (reduce) {
      behaviourSetLayoutState(transition, source, target, nextState);
      currentState = nextState;
      return;
    }
    if (!document.startViewTransition || typeof document.startViewTransition !== 'function') {
      behaviourFailure('layout-transition-api-missing', {
        layoutTransitionId: transition.id,
        viewTransitionName: transition.viewTransitionName
      }, new Error('View Transition API unavailable'));
    }
    source.style.viewTransitionName = transition.viewTransitionName;
    target.style.viewTransitionName = transition.viewTransitionName;
    var transitionRun;
    try {
      transitionRun = document.startViewTransition(function() {
        behaviourSetLayoutState(transition, source, target, nextState);
        currentState = nextState;
      });
    } catch (err) {
      behaviourClearLayoutViewTransitionName(source, target);
      behaviourFailure('layout-transition-run-failed', {
        layoutTransitionId: transition.id,
        viewTransitionName: transition.viewTransitionName
      }, err || new Error('layout transition failed'));
    }
    if (transitionRun && transitionRun.finished && typeof transitionRun.finished.then === 'function') {
      transitionRun.finished.then(function() {
        behaviourClearLayoutViewTransitionName(source, target);
      }).catch(function(err) {
        behaviourClearLayoutViewTransitionName(source, target);
        behaviourFailure('layout-transition-finished-failed', {
          layoutTransitionId: transition.id,
          viewTransitionName: transition.viewTransitionName
        }, err || new Error('layout transition finish failed'));
      });
    } else {
      behaviourClearLayoutViewTransitionName(source, target);
    }
  });
}

function behaviourHydrateSmoothScroll(payload, root) {
  var config = payload.smoothScroll;
  if (!config) return;
  if (config.mode !== 'inertial') {
    behaviourFailure('smooth-scroll-unsupported-mode', { mode: config.mode }, new Error('unsupported smooth scroll mode'));
  }
  if (!document || !document.documentElement || !window) {
    behaviourFailure('smooth-scroll-api-missing', { step: 'document-window' }, new Error('document/window unavailable'));
  }
  var docEl = document.documentElement;
  if (docEl.getAttribute('data-opencanvas-smooth-scroll-hydrated') === 'true') return;
  var duration = Number(config.durationMs);
  if (!isFinite(duration) || duration < 100 || duration > 5000) {
    behaviourFailure('smooth-scroll-invalid-duration', { durationMs: config.durationMs }, new Error('invalid smooth scroll duration'));
  }
  if (config.reducedMotion !== 'native' && config.reducedMotion !== 'disabled') {
    behaviourFailure('smooth-scroll-invalid-reduced-motion', { reducedMotion: config.reducedMotion }, new Error('invalid smooth scroll reduced-motion policy'));
  }
  docEl.setAttribute('data-opencanvas-smooth-scroll', 'inertial');
  docEl.setAttribute('data-opencanvas-smooth-scroll-duration-ms', String(duration));
  docEl.setAttribute('data-opencanvas-smooth-scroll-reduced-motion', config.reducedMotion);
  if (typeof config.paddingTop === 'number') {
    docEl.style.scrollPaddingTop = String(config.paddingTop) + 'px';
  }
  if (behaviourPrefersReducedMotion()) {
    docEl.setAttribute('data-opencanvas-smooth-scroll-reduced', config.reducedMotion);
    if (config.reducedMotion === 'disabled') docEl.style.scrollBehavior = 'auto';
    docEl.setAttribute('data-opencanvas-smooth-scroll-hydrated', 'true');
    return;
  }
  docEl.setAttribute('data-opencanvas-smooth-scroll-reduced', 'none');
  if (
    typeof window.addEventListener !== 'function' ||
    typeof window.scrollTo !== 'function' ||
    typeof requestAnimationFrame !== 'function'
  ) {
    behaviourFailure('smooth-scroll-api-missing', { step: 'event-loop' }, new Error('required smooth scroll browser APIs unavailable'));
  }
  function readScrollY() {
    return window.scrollY || docEl.scrollTop || (document.body && document.body.scrollTop) || 0;
  }
  function maxScrollY() {
    var scrollHeight = Math.max(
      docEl.scrollHeight || 0,
      document.body && document.body.scrollHeight ? document.body.scrollHeight : 0
    );
    var viewport = window.innerHeight || docEl.clientHeight || 0;
    if (!isFinite(scrollHeight) || !isFinite(viewport) || viewport <= 0) {
      behaviourFailure('smooth-scroll-measurement-invalid', { scrollHeight: scrollHeight, viewport: viewport }, new Error('invalid smooth scroll measurement'));
    }
    return Math.max(0, scrollHeight - viewport);
  }
  function clamp(value) {
    return Math.max(0, Math.min(maxScrollY(), value));
  }
  var currentY = readScrollY();
  var targetY = currentY;
  var active = false;
  var lastTs = 0;
  function step(ts) {
    if (!active) return;
    var now = typeof ts === 'number' ? ts : lastTs + 16;
    var elapsed = lastTs > 0 ? Math.max(1, now - lastTs) : 16;
    lastTs = now;
    var delta = targetY - currentY;
    if (Math.abs(delta) < 0.5) {
      currentY = targetY;
      window.scrollTo(0, currentY);
      active = false;
      lastTs = 0;
      docEl.setAttribute('data-opencanvas-smooth-scrolling', 'false');
      return;
    }
    var amount = Math.min(1, (elapsed / duration) * 10);
    currentY += delta * amount;
    window.scrollTo(0, currentY);
    requestAnimationFrame(step);
  }
  function start() {
    if (active) return;
    active = true;
    docEl.setAttribute('data-opencanvas-smooth-scrolling', 'true');
    requestAnimationFrame(step);
  }
  function moveBy(delta) {
    currentY = readScrollY();
    targetY = clamp(targetY + delta);
    start();
  }
  window.addEventListener('wheel', function(event) {
    if (!event || event.ctrlKey) return;
    if (typeof event.deltaY !== 'number') {
      behaviourFailure('smooth-scroll-wheel-invalid', {}, new Error('wheel event missing deltaY'));
    }
    event.preventDefault();
    moveBy(event.deltaY);
  }, { passive: false });
  window.addEventListener('keydown', function(event) {
    var key = event && event.key;
    var delta = 0;
    if (key === 'ArrowDown') delta = 80;
    else if (key === 'ArrowUp') delta = -80;
    else if (key === 'PageDown' || key === ' ') delta = window.innerHeight * 0.85;
    else if (key === 'PageUp') delta = -window.innerHeight * 0.85;
    else if (key === 'Home') targetY = 0;
    else if (key === 'End') targetY = maxScrollY();
    else return;
    event.preventDefault();
    if (delta !== 0) moveBy(delta);
    else start();
  }, { passive: false });
  window.addEventListener('scroll', function() {
    if (!active) {
      currentY = readScrollY();
      targetY = currentY;
    }
  }, { passive: true });
  docEl.setAttribute('data-opencanvas-smooth-scroll-hydrated', 'true');
}

function behaviourFindNavThemeRoot(root, navElementId) {
  var nodes = root.querySelectorAll('[data-opencanvas-nav-theme-root]');
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute('data-opencanvas-nav-theme-root') === navElementId) return nodes[i];
  }
  behaviourFailure('nav-theme-root-missing', { navElementId: navElementId }, new Error('nav theme root not found'));
}

function behaviourHydrateNavThemes(payload, root) {
  var configs = payload.navThemes || [];
  if (!configs.length) return;
  var targets = root.querySelectorAll('[data-opencanvas-nav-theme-target]');
  if (!targets || targets.length === 0) {
    var ids = [];
    for (var m = 0; m < configs.length; m++) ids.push(configs[m].navElementId);
    behaviourFailure('nav-theme-targets-missing', { navElementIds: ids }, new Error('nav theme targets not found'));
  }
  var navs = [];
  for (var i = 0; i < configs.length; i++) {
    var config = configs[i];
    var nav = behaviourFindNavThemeRoot(root, config.navElementId);
    nav.setAttribute('data-opencanvas-nav-theme-default', config.defaultTheme);
    nav.setAttribute('data-opencanvas-nav-theme-active', config.defaultTheme);
    nav.setAttribute('data-opencanvas-nav-theme-reduced-motion', config.reducedMotion);
    nav.setAttribute('data-opencanvas-nav-theme-hydrated', 'true');
    navs.push({ node: nav, config: config });
  }
  function activeTheme() {
    var probe = (window.innerHeight || document.documentElement.clientHeight || 0) * 0.4;
    for (var t = 0; t < targets.length; t++) {
      var target = targets[t];
      if (typeof target.getBoundingClientRect !== 'function') {
        behaviourFailure('nav-theme-target-unmeasurable', { targetIndex: t }, new Error('nav theme target cannot be measured'));
      }
      var rect = target.getBoundingClientRect();
      if (rect.top <= probe && rect.top + rect.height >= probe) {
        return target.getAttribute('data-opencanvas-nav-theme-target');
      }
    }
    return null;
  }
  function update() {
    var theme = activeTheme();
    for (var n = 0; n < navs.length; n++) {
      navs[n].node.setAttribute('data-opencanvas-nav-theme-active', theme || navs[n].config.defaultTheme);
    }
  }
  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function() {
      scheduled = false;
      update();
    });
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  update();
}
function hydrateBehaviour(scope, options) {
  behaviourRuntimeOptions = options || {};
  var root = scope || document;
  if (root === document && document.documentElement.getAttribute('data-opencanvas-behaviour-hydrated') === 'true') return;
  var payload = parseBehaviourPayload();
  if (!payload) return;
  behaviourHydrateSmoothScroll(payload, root);
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
  var layoutTransitions = payload.layoutTransitions || [];
  for (var l = 0; l < layoutTransitions.length; l++) {
    behaviourHydrateLayoutTransition(layoutTransitions[l], root);
  }
  behaviourHydrateNavThemes(payload, root);
  var assets = payload.richMotionAssets || [];
  for (var a = 0; a < assets.length; a++) {
    if (assets[a].kind === 'image-sequence') {
      behaviourHydrateImageSequence(assets[a], root, payload);
    } else if (assets[a].kind === 'rive') {
      behaviourHydrateRive(assets[a], root, payload);
    } else if (assets[a].kind === 'lottie') {
      behaviourHydrateLottie(assets[a], root);
    } else if (assets[a].kind === 'model-3d') {
      behaviourHydrateModel3D(assets[a], root);
    } else if (assets[a].kind === 'shader-scene') {
      behaviourHydrateShaderScene(assets[a], root);
    } else if (assets[a].kind === 'video-stream') {
      behaviourHydrateVideoStream(assets[a], root);
    } else {
      behaviourFailure('rich-motion-unsupported-kind', { assetId: assets[a].id, kind: assets[a].kind }, new Error('unsupported rich motion kind'));
    }
  }
  if (root === document) document.documentElement.setAttribute('data-opencanvas-behaviour-hydrated', 'true');
}
`;
