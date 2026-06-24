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

function behaviourIsTemplatePreview() {
  if (typeof window === 'undefined' || !window.location || typeof window.location.pathname !== 'string') return false;
  return /^(\/dashboard\/(?:templates\/[^/]+\/preview|admin\/template-source\/preview\/[^/]+)|\/api\/(?:admin\/)?custom-templates\/[^/]+\/preview)$/.test(window.location.pathname);
}

function behaviourEnterTargetIsVisible(target) {
  if (!target || typeof target.getBoundingClientRect !== 'function') return false;
  var rect = target.getBoundingClientRect();
  var vh = window.innerHeight || document.documentElement.clientHeight || 0;
  return rect.height > 0 && rect.top < vh && rect.bottom > 0;
}

function behaviourShouldRunEnterImmediately(target) {
  if (behaviourIsTemplatePreview()) return true;
  return behaviourEnterTargetIsVisible(target);
}

function behaviourIsPartialRouteRender(root) {
  var scope = root && root.querySelector ? root : document;
  var container = scope.querySelector('[data-opencanvas-route-container]');
  return !!(container && container.getAttribute('data-opencanvas-route-transition'));
}

function behaviourSkipMissingEnterTarget(sequence, targetId, targetLabel) {
  if (behaviourIsTemplatePreview() || behaviourIsPartialRouteRender(document)) return true;
  behaviourFailure(
    'behaviour-target-missing',
    { sequenceId: sequence.id, [targetLabel]: targetId },
    new Error(targetLabel + ' not found'),
  );
  return false;
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

function behaviourResolveTarget(target, root, context) {
  root = root || document;
  var failureContext = Object.assign({}, context || {}, { target: target });
  if (target.type === 'site') return [document.documentElement];
  if (target.type === 'page') {
    var page = root.querySelector('[data-opencanvas-page="' + target.pageId + '"]');
    if (!page) behaviourFailure('behaviour-target-missing', failureContext, new Error('page target not found'));
    return [page];
  }
  if (target.type === 'section') {
    var section = root.querySelector('[data-opencanvas-section="' + target.sectionId + '"]');
    if (!section) behaviourFailure('behaviour-target-missing', failureContext, new Error('section target not found'));
    return [section];
  }
  if (target.type === 'element') {
    var element = root.querySelector('[data-opencanvas-element="' + target.elementId + '"]');
    if (!element) behaviourFailure('behaviour-target-missing', failureContext, new Error('element target not found'));
    return [element];
  }
  if (target.type === 'children-of') {
    var host = root.querySelector('[data-opencanvas-element="' + target.elementId + '"]');
    if (!host) behaviourFailure('motion-sequence-target-resolution', failureContext, new Error('children-of host target not found'));
    var descendants = host.querySelectorAll('[data-opencanvas-element]');
    var children = [];
    for (var i = 0; i < descendants.length; i++) {
      if (descendants[i] !== host) children.push(descendants[i]);
    }
    if (children.length === 0) behaviourFailure('motion-sequence-target-resolution', failureContext, new Error('children-of target resolved no child elements'));
    return children;
  }
  if (target.type === 'text-split') {
    var textEl = root.querySelector('[data-opencanvas-element="' + target.elementId + '"]');
    if (!textEl) behaviourFailure('behaviour-target-missing', failureContext, new Error('text-split target not found'));
    return behaviourSplitTextTarget(textEl, target.unit);
  }
  behaviourFailure('behaviour-target-unknown', failureContext, new Error('unknown behaviour target type'));
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
    span.setAttribute('data-opencanvas-text-split-final', parts[i]);
    span.setAttribute('data-opencanvas-text-split-index', String(i));
    span.setAttribute('aria-hidden', 'true');
    span.style.display = unit === 'line' ? 'block' : 'inline-block';
    span.textContent = parts[i];
    host.appendChild(span);
    spans.push(span);
  }
  el.setAttribute('data-opencanvas-text-split', unit);
  return spans;
}

function behaviourMotionTextEffect(step) {
  var effect = step.textEffect || 'none';
  if (effect !== 'none' && effect !== 'scramble' && effect !== 'mask-reveal' && effect !== 'typewriter' && effect !== 'blur-reveal' && effect !== 'wave-rise') {
    behaviourFailure('motion-sequence-text-effect', { stepId: step.id, textEffect: step.textEffect }, new Error('unsupported text effect'));
  }
  if (effect !== 'none' && (!step.target || step.target.type !== 'text-split')) {
    behaviourFailure('motion-sequence-text-effect-target', { stepId: step.id, target: step.target }, new Error('text effects require text-split targets'));
  }
  return effect;
}

function behaviourScrambleText(text, progress) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  var clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  if (clamped >= 1) return text;
  var reveal = Math.floor(text.length * clamped);
  var salt = Math.floor(clamped * 97);
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var ch = text.charAt(i);
    if (/\s/.test(ch)) {
      out += ch;
    } else if (i < reveal) {
      out += ch;
    } else {
      out += alphabet.charAt((text.charCodeAt(i) + i * 13 + salt) % alphabet.length);
    }
  }
  return out;
}

function behaviourApplyTextEffect(node, effect, progress) {
  if (effect === 'none') return;
  if (effect !== 'scramble' && effect !== 'mask-reveal' && effect !== 'typewriter' && effect !== 'blur-reveal' && effect !== 'wave-rise') {
    behaviourFailure('motion-sequence-text-effect', { textEffect: effect }, new Error('unsupported text effect'));
  }
  var finalText = node.getAttribute('data-opencanvas-text-split-final');
  if (finalText === null) {
    behaviourFailure('motion-sequence-text-effect-target', {}, new Error('text effect target is missing split final text'));
  }
  node.setAttribute('data-opencanvas-text-effect', effect);
  if (effect === 'scramble') {
    node.textContent = behaviourScrambleText(finalText, progress);
    return;
  }
  if (effect === 'typewriter') {
    var typedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
    var typedLength = Math.floor(finalText.length * typedProgress);
    node.textContent = finalText.slice(0, typedLength);
    node.setAttribute('data-opencanvas-typewriter-reduced-motion', 'full-text');
    return;
  }
  node.textContent = finalText;
  var clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  if (effect === 'blur-reveal') {
    var blurPx = Math.max(0, (1 - clamped) * 12);
    node.style.filter = 'blur(' + String(Math.round(blurPx * 1000) / 1000) + 'px)';
    node.style.willChange = 'filter';
    return;
  }
  if (effect === 'wave-rise') {
    var index = parseInt(node.getAttribute('data-opencanvas-text-split-index') || '0', 10);
    var distance = Math.max(0, (1 - clamped) * 18);
    var wave = Math.sin(clamped * Math.PI + (isFinite(index) ? index : 0) * 0.55) * distance;
    node.style.transform = 'translateY(' + String(Math.round(wave * 1000) / 1000) + 'px)';
    node.style.willChange = 'transform';
    return;
  }
  var remaining = Math.max(0, Math.min(100, (1 - clamped) * 100));
  var remainingText = String(Math.round(remaining * 1000) / 1000);
  node.style.clipPath = 'inset(0 0 ' + remainingText + '% 0)';
  node.style.willChange = 'clip-path';
}

function behaviourAnimateTextEffect(node, effect, delay, duration, direction) {
  if (effect === 'none') return;
  if (typeof requestAnimationFrame !== 'function') {
    behaviourFailure('motion-sequence-text-effect-raf-missing', { textEffect: effect }, new Error('requestAnimationFrame unavailable'));
  }
  var initialProgress = direction === 'reverse' ? 1 : 0;
  behaviourApplyTextEffect(node, effect, initialProgress);
  var start = 0;
  var started = false;
  var total = Math.max(0, Number(duration) || 0);
  var wait = Math.max(0, Number(delay) || 0);
  function tick(now) {
    if (!start) start = now || 0;
    var elapsed = Math.max(0, (now || 0) - start);
    if (elapsed < wait) {
      requestAnimationFrame(tick);
      return;
    }
    if (!started) {
      started = true;
      start = (now || 0) - wait;
      elapsed = wait;
    }
    var local = total > 0 ? Math.max(0, Math.min(1, (elapsed - wait) / total)) : 1;
    var progress = direction === 'reverse' ? 1 - local : local;
    behaviourApplyTextEffect(node, effect, progress);
    if (local < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
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

function behaviourFontVariationValue(props) {
  var parts = [];
  if (props.fontVariationWeight !== undefined) parts.push('"wght" ' + String(behaviourNumeric(props.fontVariationWeight, 400)));
  if (props.fontVariationWidth !== undefined) parts.push('"wdth" ' + String(behaviourNumeric(props.fontVariationWidth, 100)));
  if (props.fontVariationSlant !== undefined) parts.push('"slnt" ' + String(behaviourNumeric(props.fontVariationSlant, 0)));
  return parts.join(', ');
}

function behaviourInterpolateProp(prop, fromVal, toVal, progress) {
  if (
    prop === 'opacity' ||
    prop === 'scale' ||
    prop === 'translateX' ||
    prop === 'translateY' ||
    prop === 'rotate' ||
    prop === 'fontVariationWeight' ||
    prop === 'fontVariationWidth' ||
    prop === 'fontVariationSlant'
  ) {
    var fallback =
      prop === 'opacity'
        ? 1
        : prop === 'scale'
          ? 1
          : prop === 'fontVariationWeight'
            ? 400
            : prop === 'fontVariationWidth'
              ? 100
              : 0;
    var fromNum = behaviourNumeric(fromVal, fallback);
    var toNum = behaviourNumeric(toVal, fromNum);
    return fromNum + (toNum - fromNum) * progress;
  }
  return progress >= 1 ? toVal : fromVal;
}

function behaviourPropsAtProgress(from, to, progress) {
  var out = {};
  var keys = ['opacity', 'translateX', 'translateY', 'scale', 'rotate', 'clipPath', 'filter', 'strokeDasharray', 'strokeDashoffset', 'fontVariationWeight', 'fontVariationWidth', 'fontVariationSlant'];
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
  if (props.strokeDasharray !== undefined) node.style.strokeDasharray = String(props.strokeDasharray);
  if (props.strokeDashoffset !== undefined) node.style.strokeDashoffset = String(props.strokeDashoffset);
  var fontVariation = behaviourFontVariationValue(props);
  if (fontVariation) node.style.fontVariationSettings = fontVariation;
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

function behaviourAnimateTargets(targets, step, reducedMode, progress, repeat, playbackDirection, baseDelayMs) {
  var from = step.from || {};
  var to = step.to || {};
  var direction = playbackDirection || 'normal';
  if (direction !== 'normal' && direction !== 'reverse') {
    behaviourFailure('motion-sequence-playback-direction', { playbackDirection: playbackDirection }, new Error('unsupported playback direction'));
  }
  if (progress !== undefined && direction === 'reverse') {
    behaviourFailure('motion-sequence-playback-direction-scroll-scene', { playbackDirection: playbackDirection }, new Error('scroll-scene Motion Sequences cannot reverse playback'));
  }
  var textEffect = behaviourMotionTextEffect(step);
  if (textEffect !== 'none' && repeat) {
    behaviourFailure('motion-sequence-text-effect-repeat', { stepId: step.id }, new Error('text effects are not supported on repeating Motion Sequences'));
  }
  var stagger = step.staggerMs || 0;
  if (progress !== undefined) {
    var duration = Number(step.durationMs || 0);
    if (stagger > 0 && !(duration > 0)) {
      behaviourFailure('motion-sequence-scroll-stagger-duration', { stepId: step.id, durationMs: step.durationMs, staggerMs: step.staggerMs }, new Error('scroll-scene stagger requires durationMs > 0'));
      return;
    }
    var total = duration > 0 ? duration + stagger * Math.max(0, targets.length - 1) : 1;
    for (var i = 0; i < targets.length; i++) {
      var localProgress =
        stagger > 0 && duration > 0
          ? Math.max(0, Math.min(1, (progress * total - i * stagger) / duration))
          : progress;
      behaviourApplyProps(targets[i], behaviourPropsAtProgress(from, to, localProgress));
      behaviourApplyTextEffect(targets[i], textEffect, localProgress);
    }
    return;
  }
  if (reducedMode === 'skip') return;
  if (reducedMode === 'final-state') {
    for (var j = 0; j < targets.length; j++) {
      behaviourApplyProps(targets[j], to);
      behaviourApplyTextEffect(targets[j], textEffect, 1);
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
      delay: (baseDelayMs || 0) + (step.delayMs || 0) + index * stagger,
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
      if (frame.strokeDasharray !== undefined) out.strokeDasharray = frame.strokeDasharray;
      if (frame.strokeDashoffset !== undefined) out.strokeDashoffset = frame.strokeDashoffset;
      var fontVariation = behaviourFontVariationValue(frame);
      if (fontVariation) out.fontVariationSettings = fontVariation;
      var transform = behaviourTransformValue(frame, 'to');
      if (transform) out.transform = transform;
      return out;
    });
    node.animate(animKeyframes, options);
    behaviourAnimateTextEffect(node, textEffect, options.delay, options.duration, direction);
  })(targets[k], k);
  }
}

function behaviourRunSequence(sequence, root, reducedMode, progress) {
  var steps = sequence.steps || [];
  var cursorMs = 0;
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (progress !== undefined && step.waitAfterMs !== undefined) {
      behaviourFailure('motion-sequence-wait-scroll-scene', { sequenceId: sequence.id, stepId: step.id }, new Error('waitAfterMs is not supported for scroll-scene Motion Sequences'));
      return;
    }
    if (progress !== undefined && step.startAtMs !== undefined) {
      behaviourFailure('motion-sequence-start-scroll-scene', { sequenceId: sequence.id, stepId: step.id }, new Error('startAtMs is not supported for scroll-scene Motion Sequences'));
      return;
    }
    var baseDelayMs = cursorMs;
    if (progress === undefined && step.startAtMs !== undefined) {
      baseDelayMs = Number(step.startAtMs);
      if (!isFinite(baseDelayMs) || baseDelayMs < 0) {
        behaviourFailure('motion-sequence-start-at', { sequenceId: sequence.id, stepId: step.id, startAtMs: step.startAtMs }, new Error('startAtMs must be a finite number >= 0'));
      }
    }
    var targets = behaviourResolveTarget(step.target, root, { sequenceId: sequence.id, stepId: step.id });
    behaviourAnimateTargets(
      targets,
      step,
      reducedMode,
      progress,
      progress === undefined ? sequence.repeat : null,
      sequence.playbackDirection || 'normal',
      baseDelayMs,
    );
    if (progress === undefined) {
      var stepEndMs = baseDelayMs + (step.delayMs || 0) + (step.durationMs || 0) + (step.staggerMs || 0) * Math.max(0, targets.length - 1) + (step.waitAfterMs || 0);
      cursorMs = Math.max(cursorMs, stepEndMs);
    }
  }
}

function behaviourApplyStepFromStates(sequence, root) {
  var steps = sequence.steps || [];
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var targets = behaviourResolveTarget(step.target, root, { sequenceId: sequence.id, stepId: step.id });
    var from = step.from || {};
    var textEffect = behaviourMotionTextEffect(step);
    for (var j = 0; j < targets.length; j++) {
      behaviourApplyProps(targets[j], from);
      if (textEffect === 'typewriter') {
        behaviourApplyTextEffect(targets[j], textEffect, 0);
      }
    }
  }
}

function behaviourSetupSectionEnter(sequence, root) {
  if (sequence.trigger.type !== 'section-enter') return;
  var section = root.querySelector('[data-opencanvas-section="' + sequence.trigger.sectionId + '"]');
  if (!section) {
    if (behaviourSkipMissingEnterTarget(sequence, sequence.trigger.sectionId, 'sectionId')) return;
  }
  behaviourApplyStepFromStates(sequence, root);
  var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
  if (typeof IntersectionObserver !== 'function') {
    behaviourFailure('behaviour-intersection-observer-missing', { sequenceId: sequence.id }, new Error('IntersectionObserver unavailable'));
  }
  var fired = false;
  var observer = null;
  function runEnterOnce() {
    if (fired) return;
    fired = true;
    behaviourRunSequence(sequence, root, reducedMode);
    if (observer) observer.disconnect();
  }
  observer = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) runEnterOnce();
    }
  }, { threshold: 0.12 });
  observer.observe(section);
  if (behaviourShouldRunEnterImmediately(section)) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(runEnterOnce);
    else runEnterOnce();
  }
}

function behaviourSetupPageEnter(sequence, root) {
  if (sequence.trigger.type !== 'page-enter') return;
  var page = root.querySelector('[data-opencanvas-page="' + sequence.trigger.pageId + '"]');
  if (!page) {
    if (behaviourSkipMissingEnterTarget(sequence, sequence.trigger.pageId, 'pageId')) return;
  }
  behaviourApplyStepFromStates(sequence, root);
  var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
  if (typeof IntersectionObserver !== 'function') {
    behaviourFailure('behaviour-intersection-observer-missing', { sequenceId: sequence.id }, new Error('IntersectionObserver unavailable'));
  }
  var fired = false;
  var observer = null;
  function runEnterOnce() {
    if (fired) return;
    fired = true;
    behaviourRunSequence(sequence, root, reducedMode);
    if (observer) observer.disconnect();
  }
  observer = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) runEnterOnce();
    }
  }, { threshold: 0.12 });
  observer.observe(page);
  if (behaviourShouldRunEnterImmediately(page)) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(runEnterOnce);
    else runEnterOnce();
  }
}

function behaviourSceneProgress(scene, section) {
  var rect = section.getBoundingClientRect();
  var sectionTop = window.scrollY + rect.top;
  var scrolled = window.scrollY - sectionTop + scene.startOffsetPx;
  var range = scene.endOffsetPx - scene.startOffsetPx;
  if (!(range > 0)) return 0;
  var progress = Math.max(0, Math.min(1, scrolled / range));
  return behaviourSnapSceneProgress(scene, progress);
}

function behaviourSnapSceneProgress(scene, progress) {
  if (scene.snapPoints === undefined) return progress;
  if (!Array.isArray(scene.snapPoints) || scene.snapPoints.length === 0) {
    behaviourFailure('scroll-scene-snap-points', { scrollSceneId: scene.id }, new Error('snapPoints must be a non-empty array'));
  }
  var best = null;
  var bestDistance = Infinity;
  var previous = -Infinity;
  for (var i = 0; i < scene.snapPoints.length; i++) {
    var point = Number(scene.snapPoints[i]);
    if (!isFinite(point) || point < 0 || point > 1) {
      behaviourFailure('scroll-scene-snap-point', { scrollSceneId: scene.id, index: i, point: scene.snapPoints[i] }, new Error('snap point must be between 0 and 1'));
    }
    if (point <= previous) {
      behaviourFailure('scroll-scene-snap-point-order', { scrollSceneId: scene.id, index: i, point: point }, new Error('snap points must be strictly increasing'));
    }
    previous = point;
    var distance = Math.abs(progress - point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best === null ? progress : best;
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

function behaviourFindHorizontalTrack(scene, root) {
  if (scene.horizontalTrack === undefined) return null;
  if (!scene.horizontalTrack || typeof scene.horizontalTrack !== 'object') {
    behaviourFailure('scroll-scene-horizontal-track', { scrollSceneId: scene.id }, new Error('horizontalTrack must be an object'));
  }
  if (!scene.horizontalTrack.elementId) {
    behaviourFailure('scroll-scene-horizontal-track-element', { scrollSceneId: scene.id }, new Error('horizontalTrack.elementId is required'));
  }
  var track = root.querySelector('[data-opencanvas-element="' + scene.horizontalTrack.elementId + '"]');
  if (!track) {
    behaviourFailure('scroll-scene-horizontal-track-missing', { scrollSceneId: scene.id, elementId: scene.horizontalTrack.elementId }, new Error('horizontal track element not found'));
  }
  return track;
}

function behaviourHorizontalTrackDistance(scene, track, section) {
  if (scene.horizontalTrack && scene.horizontalTrack.distancePx !== undefined) {
    var authored = Number(scene.horizontalTrack.distancePx);
    if (!isFinite(authored) || authored <= 0) {
      behaviourFailure('scroll-scene-horizontal-track-distance', { scrollSceneId: scene.id, distancePx: scene.horizontalTrack.distancePx }, new Error('horizontal track distance must be greater than 0'));
    }
    return authored;
  }
  if (!track || !section || typeof section.getBoundingClientRect !== 'function') {
    behaviourFailure('scroll-scene-horizontal-track-measurement', { scrollSceneId: scene.id }, new Error('horizontal track cannot be measured'));
  }
  var rect = section.getBoundingClientRect();
  var trackWidth = Number(track.scrollWidth || track.clientWidth || 0);
  var viewportWidth = Number(rect && rect.width);
  var distance = trackWidth - viewportWidth;
  if (!isFinite(distance) || distance <= 0) {
    behaviourFailure('scroll-scene-horizontal-track-measurement', {
      scrollSceneId: scene.id,
      trackWidth: trackWidth,
      viewportWidth: viewportWidth
    }, new Error('horizontal track distance could not be derived'));
  }
  return distance;
}

function behaviourApplyHorizontalTrack(track, scene, section, progress) {
  var distance = behaviourHorizontalTrackDistance(scene, track, section);
  var x = -distance * Math.max(0, Math.min(1, progress));
  track.style.transform = 'translate3d(' + x + 'px,0,0)';
  track.style.willChange = 'transform';
  track.setAttribute('data-opencanvas-scroll-horizontal-track', 'true');
  track.setAttribute('data-opencanvas-scroll-horizontal-progress', String(Math.max(0, Math.min(1, progress)).toFixed(3)));
}

function behaviourFindBeforeAfterReveal(scene, root) {
  if (scene.beforeAfterReveal === undefined) return null;
  if (!scene.beforeAfterReveal || typeof scene.beforeAfterReveal !== 'object') {
    behaviourFailure('scroll-scene-before-after-reveal', { scrollSceneId: scene.id }, new Error('beforeAfterReveal must be an object'));
  }
  if (!scene.beforeAfterReveal.beforeElementId) {
    behaviourFailure('scroll-scene-before-after-reveal-before', { scrollSceneId: scene.id }, new Error('beforeAfterReveal.beforeElementId is required'));
  }
  if (!scene.beforeAfterReveal.afterElementId) {
    behaviourFailure('scroll-scene-before-after-reveal-after', { scrollSceneId: scene.id }, new Error('beforeAfterReveal.afterElementId is required'));
  }
  if (scene.beforeAfterReveal.beforeElementId === scene.beforeAfterReveal.afterElementId) {
    behaviourFailure('scroll-scene-before-after-reveal-distinct', { scrollSceneId: scene.id, elementId: scene.beforeAfterReveal.beforeElementId }, new Error('beforeAfterReveal elements must differ'));
  }
  var beforeEl = root.querySelector('[data-opencanvas-element="' + scene.beforeAfterReveal.beforeElementId + '"]');
  if (!beforeEl) {
    behaviourFailure('scroll-scene-before-after-reveal-before-missing', { scrollSceneId: scene.id, elementId: scene.beforeAfterReveal.beforeElementId }, new Error('before reveal element not found'));
  }
  var afterEl = root.querySelector('[data-opencanvas-element="' + scene.beforeAfterReveal.afterElementId + '"]');
  if (!afterEl) {
    behaviourFailure('scroll-scene-before-after-reveal-after-missing', { scrollSceneId: scene.id, elementId: scene.beforeAfterReveal.afterElementId }, new Error('after reveal element not found'));
  }
  return { beforeEl: beforeEl, afterEl: afterEl };
}

function behaviourBeforeAfterRevealProgress(scene, progress) {
  var reveal = scene.beforeAfterReveal;
  var axis = reveal.axis || 'x';
  if (axis !== 'x' && axis !== 'y') {
    behaviourFailure('scroll-scene-before-after-reveal-axis', { scrollSceneId: scene.id, axis: reveal.axis }, new Error('beforeAfterReveal.axis must be x or y'));
  }
  var start = reveal.startProgress === undefined ? 0 : Number(reveal.startProgress);
  var end = reveal.endProgress === undefined ? 1 : Number(reveal.endProgress);
  if (!isFinite(start) || start < 0 || start > 1) {
    behaviourFailure('scroll-scene-before-after-reveal-start', { scrollSceneId: scene.id, startProgress: reveal.startProgress }, new Error('beforeAfterReveal.startProgress must be between 0 and 1'));
  }
  if (!isFinite(end) || end < 0 || end > 1 || end <= start) {
    behaviourFailure('scroll-scene-before-after-reveal-end', { scrollSceneId: scene.id, endProgress: reveal.endProgress, startProgress: start }, new Error('beforeAfterReveal.endProgress must be greater than startProgress and <= 1'));
  }
  var effectiveProgress = progress;
  if (behaviourPrefersReducedMotion()) {
    if (reveal.reducedMotion && reveal.reducedMotion !== 'start' && reveal.reducedMotion !== 'end') {
      behaviourFailure('scroll-scene-before-after-reveal-reduced-motion', { scrollSceneId: scene.id, reducedMotion: reveal.reducedMotion }, new Error('beforeAfterReveal.reducedMotion must be start or end'));
    }
    effectiveProgress = reveal.reducedMotion === 'start' ? 0 : 1;
  }
  return Math.max(0, Math.min(1, (effectiveProgress - start) / (end - start)));
}

function behaviourApplyBeforeAfterReveal(revealNodes, scene, progress) {
  var reveal = scene.beforeAfterReveal;
  var axis = reveal.axis || 'x';
  var revealProgress = behaviourBeforeAfterRevealProgress(scene, progress);
  var remaining = Math.max(0, Math.min(100, (1 - revealProgress) * 100));
  var remainingText = String(Math.round(remaining * 1000) / 1000);
  var clip = axis === 'y'
    ? 'inset(0 0 ' + remainingText + '% 0)'
    : 'inset(0 ' + remainingText + '% 0 0)';
  revealNodes.beforeEl.setAttribute('data-opencanvas-scroll-reveal-before', 'true');
  revealNodes.afterEl.setAttribute('data-opencanvas-scroll-reveal-after', 'true');
  revealNodes.afterEl.setAttribute('data-opencanvas-scroll-reveal-progress', revealProgress.toFixed(3));
  revealNodes.afterEl.style.clipPath = clip;
  revealNodes.afterEl.style.willChange = 'clip-path';
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
  var horizontalTrack = behaviourFindHorizontalTrack(scene, root);
  var beforeAfterReveal = behaviourFindBeforeAfterReveal(scene, root);
  var reducedMode = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
  var ticking = false;
  function update() {
    ticking = false;
    var progress = behaviourSceneProgress(scene, section);
    if (beforeAfterReveal) behaviourApplyBeforeAfterReveal(beforeAfterReveal, scene, progress);
    if (reducedMode !== 'skip') {
      behaviourApplyPin(pinEl, scene, section, progress);
      if (horizontalTrack) behaviourApplyHorizontalTrack(horizontalTrack, scene, section, progress);
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
        if (behaviourIsTemplatePreview()) return;
        failed = true;
        behaviourFailure('rich-motion-frame-load', { assetId: asset.id, frameIndex: index, url: url }, err || new Error('frame load failed'));
      };
      img.src = url;
    })(asset.frameUrls[i], i);
  }
}

function behaviourParticlePointSet(asset, canvas) {
  var width = (typeof window !== 'undefined' && window.innerWidth) || canvas.clientWidth || canvas.width || 0;
  var desired = width <= 480 ? 'phone' : width <= 768 ? 'tablet' : 'desktop';
  var sets = asset.pointSets || [];
  for (var i = 0; i < sets.length; i++) {
    if (sets[i].breakpoint === desired) return sets[i];
  }
  for (var j = 0; j < sets.length; j++) {
    if (sets[j].breakpoint === 'desktop') return sets[j];
  }
  if (sets.length > 0) return sets[0];
  behaviourFailure('rich-motion-particle-field-empty', { assetId: asset.id }, new Error('particle field has no point sets'));
}

function behaviourParticlePointerConfig(asset) {
  var pointer = asset.pointer || {};
  return {
    radiusRatio: typeof pointer.radiusRatio === 'number' ? pointer.radiusRatio : 0.2,
    force: typeof pointer.force === 'number' ? pointer.force : 4,
  };
}

function behaviourParticleScatterSpread() {
  return 400;
}

function behaviourBuildParticleParticles(pointSet, width, height, colorRgb, reduced) {
  var particles = [];
  var canvasSize = Number(pointSet.canvasSize) || Math.max(width, height) || 1;
  var spread = reduced ? 0 : behaviourParticleScatterSpread();
  var size = Number(pointSet.canvasSize) || Math.max(width, height);
  var scale = Math.min(width, height) / size;
  var offsetX = (width - size * scale) / 2;
  var offsetY = (height - size * scale) / 2;
  for (var i = 0; i < pointSet.points.length; i++) {
    var point = pointSet.points[i];
    var targetX = offsetX + Number(point.x) * scale;
    var targetY = offsetY + Number(point.y) * scale;
    particles.push({
      targetPointX: Number(point.x),
      targetPointY: Number(point.y),
      x: targetX + (reduced ? 0 : (Math.random() - 0.5) * spread * scale),
      y: targetY + (reduced ? 0 : (Math.random() - 0.5) * spread * scale),
      targetX: targetX,
      targetY: targetY,
      vx: 0,
      vy: 0,
      char: point.char,
      baseAlpha: Number(point.alpha),
      currentAlpha: reduced ? Number(point.alpha) : 0,
      delay: reduced ? 0 : Math.random() * 0.4,
      shimmer: Math.random() * Math.PI * 2,
      rgb: colorRgb
    });
  }
  return particles;
}

function behaviourConfigureParticleCanvas(canvas, ctx) {
  var width = canvas.clientWidth || canvas.width;
  var height = canvas.clientHeight || canvas.height;
  if (!(width > 0) || !(height > 0)) return null;
  var dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  var backingWidth = Math.round(width * dpr);
  var backingHeight = Math.round(height * dpr);
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { width: width, height: height };
}

function behaviourDrawParticleField(canvas, ctx, asset, pointSet, particles, pointer, elapsedSeconds) {
  var canvasSize = behaviourConfigureParticleCanvas(canvas, ctx);
  if (!canvasSize) return false;
  var width = canvasSize.width;
  var height = canvasSize.height;
  var size = Number(pointSet.canvasSize) || Math.max(width, height);
  var scale = Math.min(width, height) / size;
  var offsetX = (width - size * scale) / 2;
  var offsetY = (height - size * scale) / 2;
  var logicalSize = size;
  var baseFontSize = logicalSize <= 280 ? 5 : Number(asset.fontSize || 7);
  var fontSize = baseFontSize * scale;
  ctx.font = String(Math.max(4, fontSize)) + 'px monospace';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  pointer.x += (pointer.targetX - pointer.x) * 0.15;
  pointer.y += (pointer.targetY - pointer.y) * 0.15;
  var pointerConfig = behaviourParticlePointerConfig(asset);
  var pointerRadius = Math.min(width, height) * pointerConfig.radiusRatio;
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    var particleTime = elapsedSeconds - p.delay;
    if (particleTime < 0) continue;
    p.targetX = offsetX + p.targetPointX * scale;
    p.targetY = offsetY + p.targetPointY * scale;
    var fadeProgress = Math.min(particleTime / 1.5, 1);
    var easedFade = 1 - Math.pow(1 - fadeProgress, 2);
    var moveProgress = Math.min(particleTime / 2.5, 1);
    var easedMove = 1 - Math.pow(1 - moveProgress, 3);
    var isActive = pointer.active || particleTime < 3;
    var shimmerVal = isActive ? Math.sin(elapsedSeconds * 2 + p.shimmer) * 0.1 : 0;
    p.currentAlpha = Math.max(0, Math.min(1, p.baseAlpha * easedFade + shimmerVal));
    if (pointer.active) {
      var dx = p.x - pointer.x;
      var dy = p.y - pointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      if (dist < pointerRadius) {
        var push = (1 - dist / pointerRadius) * pointerConfig.force;
        p.vx += (dx / dist) * push;
        p.vy += (dy / dist) * push;
      }
    }
    var pullDx = p.targetX - p.x;
    var pullDy = p.targetY - p.y;
    var pullStrength = 0.01 + easedMove * 0.08;
    p.vx += pullDx * pullStrength;
    p.vy += pullDy * pullStrength;
    if (isActive) {
      var breathX = Math.sin(elapsedSeconds * 0.5 + p.targetPointY * 0.1) * 0.15;
      var breathY = Math.cos(elapsedSeconds * 0.5 + p.targetPointX * 0.1) * 0.15;
      p.vx += breathX;
      p.vy += breathY;
      p.vx *= 0.92;
      p.vy *= 0.92;
    } else {
      p.vx *= 0.85;
      p.vy *= 0.85;
      if (particleTime > 4 && Math.abs(pullDx) < 0.01 && Math.abs(pullDy) < 0.01) {
        p.x = p.targetX;
        p.y = p.targetY;
        p.vx = 0;
        p.vy = 0;
      }
    }
    p.x += p.vx;
    p.y += p.vy;
    ctx.fillStyle = 'rgba(' + p.rgb + ',' + p.currentAlpha.toFixed(3) + ')';
    ctx.fillText(p.char, p.x, p.y);
  }
  return true;
}

function behaviourHexToRgbString(hex) {
  var value = String(hex || '#64ffda').replace('#', '');
  if (value.length === 3) {
    value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2];
  }
  var n = parseInt(value.slice(0, 6), 16);
  if (!isFinite(n)) return '100,255,218';
  return String((n >> 16) & 255) + ',' + String((n >> 8) & 255) + ',' + String(n & 255);
}

function behaviourHydrateParticleField(asset, root) {
  if (asset.kind !== 'particle-field') {
    behaviourFailure('rich-motion-unsupported-kind', { assetId: asset.id, kind: asset.kind }, new Error('unsupported rich motion kind'));
  }
  if (asset.mode !== 'ascii-portrait') {
    behaviourFailure('rich-motion-particle-field-mode', { assetId: asset.id, mode: asset.mode }, new Error('unsupported particle field mode'));
  }
  var nodes = behaviourFindRichMotionNodes(root, asset.id);
  if (!nodes.length) {
    behaviourFailure('rich-motion-node-missing', { assetId: asset.id }, new Error('rich motion element not found'));
  }
  for (var n = 0; n < nodes.length; n++) {
    (function(node) {
      var canvas = behaviourFindRichMotionCanvas(node);
      var ctx = canvas.getContext('2d');
      if (!ctx) behaviourFailure('rich-motion-particle-field-context', { assetId: asset.id }, new Error('canvas 2d context unavailable'));
      var rgb = behaviourHexToRgbString(asset.color);
      var pointSet = behaviourParticlePointSet(asset, canvas);
      var pointSetKey = pointSet.breakpoint + ':' + String(pointSet.points.length);
      var reduced = behaviourPrefersReducedMotion() && asset.reducedMotion === 'settled';
      var particles = behaviourBuildParticleParticles(
        pointSet,
        canvas.clientWidth || pointSet.canvasSize,
        canvas.clientHeight || pointSet.canvasSize,
        rgb,
        reduced,
      );
      var pointer = { active: false, x: -1000, y: -1000, targetX: -1000, targetY: -1000 };
      function updatePointer(event) {
        var rect = canvas.getBoundingClientRect();
        var source = event.touches && event.touches[0] ? event.touches[0] : event;
        var visualWidth = rect.width || canvas.clientWidth || 1;
        var visualHeight = rect.height || canvas.clientHeight || 1;
        pointer.active = true;
        pointer.targetX = ((source.clientX - rect.left) / visualWidth) * canvas.clientWidth;
        pointer.targetY = ((source.clientY - rect.top) / visualHeight) * canvas.clientHeight;
      }
      canvas.addEventListener('pointermove', updatePointer, { passive: true });
      canvas.addEventListener('pointerleave', function(){
        pointer.active = false;
        pointer.targetX = -1000;
        pointer.targetY = -1000;
      }, { passive: true });
      canvas.addEventListener('touchmove', function(event) {
        updatePointer(event);
        if (event.cancelable) event.preventDefault();
      }, { passive: false });
      canvas.addEventListener('touchend', function(){
        pointer.active = false;
        pointer.targetX = -1000;
        pointer.targetY = -1000;
      }, { passive: true });
      var started = Date.now();
      var hydrated = false;
      function frame() {
        pointSet = behaviourParticlePointSet(asset, canvas);
        var nextPointSetKey = pointSet.breakpoint + ':' + String(pointSet.points.length);
        if (nextPointSetKey !== pointSetKey) {
          pointSetKey = nextPointSetKey;
          particles = behaviourBuildParticleParticles(
            pointSet,
            canvas.clientWidth || pointSet.canvasSize,
            canvas.clientHeight || pointSet.canvasSize,
            rgb,
            reduced,
          );
        }
        var elapsedSeconds = reduced ? 10 : (Date.now() - started) / 1000;
        var drew = behaviourDrawParticleField(canvas, ctx, asset, pointSet, particles, pointer, elapsedSeconds);
        if (!hydrated && drew !== false) {
          hydrated = true;
          node.setAttribute('data-opencanvas-rich-motion-hydrated', 'particle-field');
        }
        requestAnimationFrame(frame);
      }
      frame();
    })(nodes[n]);
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
    behaviourApplyLoadHandoff(node, load);
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

function behaviourApplyLoadHandoff(node, load) {
  var handoff = load.handoff;
  node.style.pointerEvents = 'none';
  if (!handoff) {
    node.style.opacity = '0';
    return;
  }
  var effect = node.getAttribute('data-opencanvas-load-handoff-effect');
  if (!effect) {
    behaviourFailure('load-handoff-effect-missing', { loadExperienceId: load.id }, new Error('load handoff effect metadata missing'));
  }
  if (effect !== handoff.effect) {
    behaviourFailure('load-handoff-effect-mismatch', { loadExperienceId: load.id, expected: handoff.effect, actual: effect }, new Error('load handoff effect metadata mismatch'));
  }
  if (effect !== 'fade' && effect !== 'mask-open' && effect !== 'slide-up') {
    behaviourFailure('load-handoff-effect', { loadExperienceId: load.id, effect: effect }, new Error('unsupported load handoff effect'));
  }
  var durationAttr = node.getAttribute('data-opencanvas-load-handoff-duration-ms');
  if (durationAttr === null) {
    behaviourFailure('load-handoff-duration-missing', { loadExperienceId: load.id }, new Error('load handoff duration metadata missing'));
  }
  var duration = Number(durationAttr);
  if (!isFinite(duration) || duration < 0 || duration > 30000) {
    behaviourFailure('load-handoff-duration', { loadExperienceId: load.id, durationMs: durationAttr }, new Error('invalid load handoff duration'));
  }
  var easing = node.getAttribute('data-opencanvas-load-handoff-easing') || handoff.easing || 'ease-out';
  var effectiveDuration = behaviourPrefersReducedMotion() ? 0 : duration;
  node.setAttribute('data-opencanvas-load-handoff-applied', effect);
  node.style.transition = 'opacity ' + String(effectiveDuration) + 'ms ' + easing + ', transform ' + String(effectiveDuration) + 'ms ' + easing + ', clip-path ' + String(effectiveDuration) + 'ms ' + easing;
  if (effect === 'fade') {
    node.style.opacity = '0';
    return;
  }
  if (effect === 'slide-up') {
    node.style.transform = 'translateY(-100%)';
    node.style.opacity = '0';
    return;
  }
  node.style.clipPath = 'circle(0% at 50% 50%)';
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

function behaviourSetLayoutState(transition, source, target, state, reverseTrigger) {
  var sourceActive = state === 'source';
  source.hidden = !sourceActive;
  target.hidden = sourceActive;
  if (reverseTrigger && reverseTrigger !== source && reverseTrigger !== target) {
    reverseTrigger.hidden = sourceActive;
    if (sourceActive) {
      reverseTrigger.setAttribute('aria-hidden', 'true');
      reverseTrigger.removeAttribute('data-opencanvas-layout-transition-state');
    } else {
      reverseTrigger.removeAttribute('aria-hidden');
      reverseTrigger.setAttribute('data-opencanvas-layout-transition-state', 'active');
    }
  }
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
  var reverseTrigger = transition.reverseTriggerElementId
    ? behaviourFindLayoutElement(root, transition, transition.reverseTriggerElementId, 'reverse-trigger')
    : null;
  var source = behaviourFindLayoutElement(root, transition, transition.sourceElementId, 'source');
  var target = behaviourFindLayoutElement(root, transition, transition.targetElementId, 'target');
  if (trigger.getAttribute('data-opencanvas-layout-transition-hydrated') === transition.id) return;
  trigger.setAttribute('data-opencanvas-layout-transition-hydrated', transition.id);
  if (reverseTrigger) reverseTrigger.setAttribute('data-opencanvas-layout-transition-reverse-hydrated', transition.id);
  var currentState = transition.initialState === 'target' ? 'target' : 'source';
  behaviourSetLayoutState(transition, source, target, currentState, reverseTrigger);
  function runLayoutTransition(nextState, event) {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (nextState === currentState) return;
    var reduce = behaviourPrefersReducedMotion() && transition.reducedMotion === 'instant';
    if (reduce) {
      behaviourSetLayoutState(transition, source, target, nextState, reverseTrigger);
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
        behaviourSetLayoutState(transition, source, target, nextState, reverseTrigger);
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
  }
  trigger.addEventListener('click', function(event) {
    runLayoutTransition(currentState === 'source' ? 'target' : 'source', event);
  });
  if (reverseTrigger) {
    reverseTrigger.addEventListener('click', function(event) {
      runLayoutTransition('source', event);
    });
  }
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

function behaviourHydratePlayableWidgets(root) {
  var widgets = root.querySelectorAll('[data-opencanvas-playable-widget]');
  for (var i = 0; i < widgets.length; i++) {
    (function(widget) {
      if (widget.getAttribute('data-opencanvas-playable-hydrated') === 'true') return;
      var kind = widget.getAttribute('data-opencanvas-playable-kind');
      if (kind !== 'collectible-platformer') {
        behaviourFailure('playable-widget-unsupported-kind', { kind: kind }, new Error('unsupported playable widget kind'));
      }
      var toggle = widget.querySelector('[data-opencanvas-playable-toggle]');
      var canvas = widget.querySelector('[data-opencanvas-playable-canvas]');
      var counter = widget.querySelector('[data-opencanvas-playable-counter]');
      if (!toggle || !canvas || !counter) {
        behaviourFailure('playable-widget-mount-missing', {}, new Error('playable widget mount nodes missing'));
      }
      var ctx = canvas.getContext('2d');
      if (!ctx) behaviourFailure('playable-widget-canvas-context', {}, new Error('canvas 2d context unavailable'));
      var active = false;
      var keys = {};
      var score = 0;
      var player = { x: 120, y: 160, vx: 0, vy: 0, grounded: false };
      var collectibles = [];
      for (var c = 0; c < 8; c++) {
        collectibles.push({ x: 180 + c * 140, y: 120 + (c % 3) * 70, taken: false });
      }
      function resize() {
        var width = window.innerWidth || document.documentElement.clientWidth || 1;
        var height = window.innerHeight || document.documentElement.clientHeight || 1;
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
      }
      function draw() {
        resize();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = 'rgba(100,255,218,0.08)';
        ctx.fillRect(0, canvas.height - 74, canvas.width, 2);
        ctx.fillStyle = '#64ffda';
        for (var j = 0; j < collectibles.length; j++) {
          var item = collectibles[j];
          if (item.taken) continue;
          ctx.beginPath();
          ctx.arc(item.x, item.y, 7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#ccd6f6';
        ctx.fillRect(player.x - 10, player.y - 24, 20, 24);
        ctx.fillStyle = '#64ffda';
        ctx.fillRect(player.x - 6, player.y - 18, 4, 4);
        ctx.fillRect(player.x + 4, player.y - 18, 4, 4);
      }
      function step() {
        if (!active) return;
        var left = keys.ArrowLeft || keys.KeyA;
        var right = keys.ArrowRight || keys.KeyD;
        if (left) player.vx -= 0.7;
        if (right) player.vx += 0.7;
        player.vx *= 0.86;
        player.vy += 0.85;
        if ((keys.ArrowUp || keys.KeyW || keys.Space) && player.grounded) {
          player.vy = -15;
          player.grounded = false;
        }
        player.x += player.vx;
        player.y += player.vy;
        var floor = canvas.height - 76;
        if (player.y > floor) {
          player.y = floor;
          player.vy = 0;
          player.grounded = true;
        }
        if (player.x < 20) player.x = 20;
        if (player.x > canvas.width - 20) player.x = canvas.width - 20;
        for (var k = 0; k < collectibles.length; k++) {
          var item = collectibles[k];
          if (item.taken) continue;
          var dx = player.x - item.x;
          var dy = player.y - item.y;
          if (dx * dx + dy * dy < 900) {
            item.taken = true;
            score += 1;
            counter.textContent = String(score);
          }
        }
        draw();
        requestAnimationFrame(step);
      }
      function setActive(next) {
        active = next;
        widget.setAttribute('data-opencanvas-playable-active', String(active));
        toggle.setAttribute('aria-pressed', String(active));
        canvas.style.display = active ? 'block' : 'none';
        counter.style.display = active ? 'block' : 'none';
        if (active) {
          resize();
          requestAnimationFrame(step);
        }
      }
      toggle.addEventListener('click', function(event) {
        event.preventDefault();
        setActive(!active);
      });
      window.addEventListener('keydown', function(event) {
        keys[event.code] = true;
      });
      window.addEventListener('keyup', function(event) {
        keys[event.code] = false;
      });
      window.addEventListener('resize', function() {
        if (active) draw();
      });
      widget.setAttribute('data-opencanvas-playable-hydrated', 'true');
      counter.textContent = '0';
    })(widgets[i]);
  }
}

function hydrateBehaviour(scope, options) {
  behaviourRuntimeOptions = options || {};
  var root = scope || document;
  if (root === document && document.documentElement.getAttribute('data-opencanvas-behaviour-hydrated') === 'true') return;
  behaviourHydratePlayableWidgets(root);
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
        behaviourApplyStepFromStates(sequence, root);
        var reducedLoad = behaviourPrefersReducedMotion() ? (sequence.reducedMotion || 'skip') : null;
        behaviourRunSequence(sequence, root, reducedLoad);
      }
    } else if (sequence.trigger.type === 'section-enter') {
      behaviourSetupSectionEnter(sequence, root);
    } else if (sequence.trigger.type === 'page-enter') {
      behaviourSetupPageEnter(sequence, root);
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
    } else if (assets[a].kind === 'particle-field') {
      behaviourHydrateParticleField(assets[a], root);
    } else if (assets[a].kind === 'video-stream') {
      behaviourHydrateVideoStream(assets[a], root);
    } else {
      behaviourFailure('rich-motion-unsupported-kind', { assetId: assets[a].id, kind: assets[a].kind }, new Error('unsupported rich motion kind'));
    }
  }
  if (root === document) document.documentElement.setAttribute('data-opencanvas-behaviour-hydrated', 'true');
}
`;
