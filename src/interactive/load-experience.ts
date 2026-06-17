export const LOAD_EXPERIENCE_RUNTIME_SRC = String.raw`
function loadExperienceFailure(id, phase, extra) {
  var detail = { loadExperienceId: id, phase: phase };
  for (var k in (extra || {})) detail[k] = extra[k];
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('opencanvas:load-experience-failed', { detail: detail }));
  console.error('[opencanvas load-experience] failed', detail);
}
function hydrateLoadExperience(scope, options) {
  var root = scope || document;
  var node = root.querySelector
    ? root.querySelector('[data-opencanvas-load-experience]')
    : (root.querySelectorAll ? root.querySelectorAll('[data-opencanvas-load-experience]')[0] : null);
  if (!node) return;
  if (node.getAttribute('data-opencanvas-load-hydrated') === 'true') return;
  node.setAttribute('data-opencanvas-load-hydrated', 'true');
  var id = node.getAttribute('data-opencanvas-load-experience') || 'load-main';
  var policy = node.getAttribute('data-opencanvas-load-run-policy') || 'every-visit';
  var timeoutMs = parseInt(node.getAttribute('data-opencanvas-load-timeout-ms') || '4000', 10);
  var gates = (node.getAttribute('data-opencanvas-load-gates') || 'document-ready').split(/\s+/).filter(Boolean);
  var seenKey = 'opencanvas-load-seen-' + id;
  function hide() {
    var seq = node.getAttribute('data-opencanvas-load-handoff-sequence');
    if (seq && typeof runMotionSequenceLite === 'function') runMotionSequenceLite(node, seq);
    node.setAttribute('data-opencanvas-load-hidden', 'true');
    window.setTimeout(function(){ if (node.parentNode) node.parentNode.removeChild(node); }, 220);
  }
  function fail(phase, extra) {
    node.setAttribute('data-opencanvas-load-failed', 'true');
    var err = node.querySelector ? node.querySelector('[data-opencanvas-load-part="error"]') : null;
    if (err) err.hidden = false;
    loadExperienceFailure(id, phase, extra || {});
  }
  if (policy === 'once-per-session') {
    try {
      if (window.sessionStorage.getItem(seenKey) === 'true') {
        hide();
        return;
      }
    } catch (err) {
      fail('session-storage', { error: String(err && err.message ? err.message : err) });
      return;
    }
  }
  function documentReadyGate() {
    return new Promise(function(resolve) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      } else {
        resolve();
      }
    });
  }
  function fontsReadyGate() {
    return new Promise(function(resolve, reject) {
      if (!document.fonts || !document.fonts.ready) {
        reject(new Error('document.fonts.ready unavailable'));
        return;
      }
      document.fonts.ready.then(resolve, reject);
    });
  }
  function heroMediaReadyGate() {
    return new Promise(function(resolve, reject) {
      var container = document.querySelector('[data-opencanvas-route-container]');
      var media = container ? container.querySelector('img,video') : null;
      if (!media) {
        resolve();
        return;
      }
      if (media.tagName && media.tagName.toLowerCase() === 'img') {
        if (media.complete) {
          resolve();
          return;
        }
        media.addEventListener('load', resolve, { once: true });
        media.addEventListener('error', function(){ reject(new Error('hero image failed')); }, { once: true });
        return;
      }
      if (media.readyState >= 2) {
        resolve();
        return;
      }
      media.addEventListener('loadeddata', resolve, { once: true });
      media.addEventListener('error', function(){ reject(new Error('hero video failed')); }, { once: true });
    });
  }
  var promises = gates.map(function(gate) {
    if (gate === 'document-ready') return documentReadyGate();
    if (gate === 'fonts-ready') return fontsReadyGate();
    if (gate === 'hero-media-ready') return heroMediaReadyGate();
    return Promise.reject(new Error('unknown gate ' + gate));
  });
  var timeout = new Promise(function(_, reject) {
    window.setTimeout(function(){ reject(new Error('timeout after ' + String(timeoutMs) + 'ms')); }, timeoutMs);
  });
  Promise.race([Promise.all(promises), timeout]).then(function(){
    if (policy === 'once-per-session') {
      try {
        window.sessionStorage.setItem(seenKey, 'true');
      } catch (err) {
        fail('session-storage', { error: String(err && err.message ? err.message : err) });
        return;
      }
    }
    hide();
  }).catch(function(err){
    fail('gate', { error: String(err && err.message ? err.message : err) });
  });
}
`;
