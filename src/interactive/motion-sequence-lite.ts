export const MOTION_SEQUENCE_LITE_RUNTIME_SRC = String.raw`
function motionTarget(root, target) {
  if (target === 'page-container') {
    if (root.matches && root.matches('[data-opencanvas-route-container]')) return root;
    return root.querySelector('[data-opencanvas-route-container]');
  }
  if (target === 'overlay-surface') {
    if (root.matches && root.matches('[data-opencanvas-overlay-surface]')) return root;
    return root.querySelector('[data-opencanvas-overlay-surface]');
  }
  if (target === 'overlay-backdrop') {
    if (root.matches && root.matches('[data-opencanvas-overlay-backdrop]')) return root;
    return root.querySelector('[data-opencanvas-overlay-backdrop]');
  }
  if (target.indexOf('load-screen-part:') === 0) {
    var part = target.split(':')[1];
    if (root.matches && root.matches('[data-opencanvas-load-part="' + part + '"]')) return root;
    return root.querySelector('[data-opencanvas-load-part="' + part + '"]');
  }
  return null;
}
function applyMotionEffect(el, effect, duration, easing, delay) {
  el.style.setProperty('--opencanvas-motion-lite-duration', String(duration) + 'ms');
  el.style.setProperty('--opencanvas-motion-lite-easing', easing);
  el.style.setProperty('--opencanvas-motion-lite-delay', String(delay) + 'ms');
  el.setAttribute('data-opencanvas-motion-effect', effect);
  void el.offsetWidth;
  el.setAttribute('data-opencanvas-motion-running', 'true');
  window.setTimeout(function(){
    el.removeAttribute('data-opencanvas-motion-running');
  }, delay + duration);
}
function runMotionSequenceLite(root, sequenceId) {
  var scope = root || document;
  var steps = scope.querySelectorAll('[data-opencanvas-motion-sequence-lite="' + sequenceId + '"]');
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    var targetName = step.getAttribute('data-opencanvas-motion-target') || '';
    var target = motionTarget(scope, targetName);
    if (!target) return false;
    applyMotionEffect(
      target,
      step.getAttribute('data-opencanvas-motion-effect') || 'fade',
      parseInt(step.getAttribute('data-opencanvas-motion-duration-ms') || '180', 10),
      step.getAttribute('data-opencanvas-motion-easing') || 'ease',
      parseInt(step.getAttribute('data-opencanvas-motion-delay-ms') || '0', 10)
    );
  }
  return true;
}
`;
