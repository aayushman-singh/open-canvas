export const ROUTE_TRANSITION_RUNTIME_SRC = String.raw`
function routeFailure(id, phase, extra) {
  var detail = { transitionId: id, phase: phase };
  for (var k in (extra || {})) detail[k] = extra[k];
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('opencanvas:route-transition-failed', { detail: detail }));
  console.error('[opencanvas route-transition] failed', detail);
}
function hydrateRouteTransition(scope, options) {
  var root = scope || document;
  var container = root.querySelector
    ? root.querySelector('[data-opencanvas-route-container]')
    : (root.querySelectorAll ? root.querySelectorAll('[data-opencanvas-route-container]')[0] : null);
  if (!container) return;
  if (container.getAttribute('data-opencanvas-route-hydrated') === 'true') return;
  container.setAttribute('data-opencanvas-route-hydrated', 'true');
  var id = container.getAttribute('data-opencanvas-route-transition');
  if (!id) return;
  var duration = parseInt(container.getAttribute('data-opencanvas-route-duration-ms') || '220', 10);
  var easing = container.getAttribute('data-opencanvas-route-easing') || 'ease';
  var busy = false;
  function sameSiteAnchor(anchor) {
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return null;
    var href = anchor.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return null;
    var url;
    try {
      url = new URL(href, window.location.href);
    } catch (err) {
      return null;
    }
    if (url.origin !== window.location.origin) return null;
    if (url.href === window.location.href) return null;
    return url;
  }
  function wait(ms) {
    return new Promise(function(resolve){ window.setTimeout(resolve, ms); });
  }
  function readSharedElements() {
    var raw = container.getAttribute('data-opencanvas-route-shared-elements');
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('shared elements payload is not an array');
      return parsed;
    } catch (err) {
      routeFailure(id, 'shared-elements-parse', { error: String(err && err.message ? err.message : err) });
      throw err;
    }
  }
  function attrValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }
  function findRouteElement(rootNode, elementId) {
    return rootNode.querySelector('[data-opencanvas-element="' + attrValue(elementId) + '"]');
  }
  function applySharedElements(shared, next) {
    var applied = [];
    for (var i = 0; i < shared.length; i++) {
      var mapping = shared[i];
      var source = findRouteElement(container, mapping.sourceElementId);
      var target = findRouteElement(next, mapping.targetElementId);
      if (!source || !target) {
        routeFailure(id, 'shared-elements-resolve', {
          mappingId: mapping.id,
          sourceElementId: mapping.sourceElementId,
          targetElementId: mapping.targetElementId
        });
        for (var c = 0; c < applied.length; c++) applied[c].style.viewTransitionName = '';
        var resolveErr = new Error('shared route element mapping could not be resolved');
        resolveErr.phase = 'shared-elements-resolve';
        resolveErr.reported = true;
        throw resolveErr;
      }
      source.style.viewTransitionName = mapping.viewTransitionName;
      target.style.viewTransitionName = mapping.viewTransitionName;
      applied.push(source);
    }
    return applied;
  }
  function copyRouteAttrs(next) {
    var attrs = ['data-opencanvas-route-transition','data-opencanvas-route-mode','data-opencanvas-route-duration-ms','data-opencanvas-route-easing','data-opencanvas-route-shared-elements','data-opencanvas-route-outgoing-sequence','data-opencanvas-route-incoming-sequence'];
    for (var i = 0; i < attrs.length; i++) {
      var value = next.getAttribute(attrs[i]);
      if (value === null) container.removeAttribute(attrs[i]);
      else container.setAttribute(attrs[i], value);
    }
  }
  function swapContainerTo(next, url, historyMode) {
    container.innerHTML = next.innerHTML;
    copyRouteAttrs(next);
    if (historyMode === 'replace') history.replaceState({}, '', url.href);
    else history.pushState({}, '', url.href);
    container.removeAttribute('data-opencanvas-route-state');
    container.setAttribute('tabindex', '-1');
    if (typeof container.focus === 'function') container.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (typeof window.__opencanvasHydrate === 'function') {
      window.__opencanvasHydrate(container, { reason: 'route-transition' });
    } else {
      throw new Error('Runtime Hydrator missing');
    }
    var incomingSequence = container.getAttribute('data-opencanvas-route-incoming-sequence');
    if (incomingSequence && typeof runMotionSequenceLite === 'function') runMotionSequenceLite(container, incomingSequence);
  }
  function swapTo(url, historyMode) {
    if (busy) return;
    busy = true;
    var shared;
    try {
      shared = readSharedElements();
    } catch (err) {
      busy = false;
      return;
    }
    var routeAttrs = ['data-opencanvas-route-transition','data-opencanvas-route-mode','data-opencanvas-route-duration-ms','data-opencanvas-route-easing','data-opencanvas-route-shared-elements','data-opencanvas-route-outgoing-sequence','data-opencanvas-route-incoming-sequence'];
    var outgoingSequence = container.getAttribute('data-opencanvas-route-outgoing-sequence');
    var swapped = false;
    var prevHtml = '';
    var prevAttrs = {};
    function captureSwapState() {
      prevHtml = container.innerHTML;
      for (var i = 0; i < routeAttrs.length; i++) {
        prevAttrs[routeAttrs[i]] = container.getAttribute(routeAttrs[i]);
      }
    }
    function restoreSwap() {
      if (!swapped) return;
      container.innerHTML = prevHtml;
      for (var j = 0; j < routeAttrs.length; j++) {
        var attrName = routeAttrs[j];
        var attrValue = prevAttrs[attrName];
        if (attrValue === null) container.removeAttribute(attrName);
        else container.setAttribute(attrName, attrValue);
      }
      swapped = false;
    }
    function failTransition(phase, err) {
      restoreSwap();
      container.removeAttribute('data-opencanvas-route-state');
      busy = false;
      if (!err || err.reported !== true) {
        routeFailure(id, phase, { href: url.href, error: String(err && err.message ? err.message : err) });
      }
    }
    function applyNext(next) {
      captureSwapState();
      try {
        container.innerHTML = next.innerHTML;
        copyRouteAttrs(next);
      } catch (swapErr) {
        var taggedSwapErr = swapErr || new Error('swap failed');
        if (!taggedSwapErr.phase) taggedSwapErr.phase = 'swap';
        throw taggedSwapErr;
      }
      swapped = true;
      try {
        if (typeof window.__opencanvasHydrate === 'function') {
          window.__opencanvasHydrate(container, { reason: 'route-transition' });
        } else {
          throw new Error('Runtime Hydrator missing');
        }
      } catch (hydrateRuntimeErr) {
        var taggedHydrateErr = hydrateRuntimeErr || new Error('hydrate failed');
        if (!taggedHydrateErr.phase) taggedHydrateErr.phase = 'hydrate';
        throw taggedHydrateErr;
      }
      var incomingSequence = container.getAttribute('data-opencanvas-route-incoming-sequence');
      if (incomingSequence && typeof runMotionSequenceLite === 'function') {
        try {
          runMotionSequenceLite(container, incomingSequence);
        } catch (animErr) {
          var taggedAnimErr = animErr || new Error('animate failed');
          if (!taggedAnimErr.phase) taggedAnimErr.phase = 'animate';
          throw taggedAnimErr;
        }
      }
      if (historyMode === 'replace') history.replaceState({}, '', url.href);
      else history.pushState({}, '', url.href);
      container.removeAttribute('data-opencanvas-route-state');
      container.setAttribute('tabindex', '-1');
      if (typeof container.focus === 'function') container.focus({ preventScroll: true });
      window.scrollTo(0, 0);
      swapped = false;
    }
    if (!shared.length) {
      if (outgoingSequence && typeof runMotionSequenceLite === 'function') {
        try {
          runMotionSequenceLite(container, outgoingSequence);
        } catch (animErr) {
          failTransition('animate', animErr);
          return;
        }
      }
      container.style.transition = 'opacity ' + duration + 'ms ' + easing + ', transform ' + duration + 'ms ' + easing + ', clip-path ' + duration + 'ms ' + easing;
      container.setAttribute('data-opencanvas-route-state', 'outgoing');
    }
    (shared.length ? Promise.resolve() : wait(duration)).then(function(){
      return fetch(url.href, { credentials: 'same-origin' });
    }).then(function(resp){
      if (!resp.ok) {
        var fetchErr = new Error('fetch failed ' + String(resp.status));
        fetchErr.phase = 'fetch';
        throw fetchErr;
      }
      return resp.text();
    }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var next = doc.querySelector('[data-opencanvas-route-container]');
      if (!next) {
        var parseErr = new Error('next route container missing');
        parseErr.phase = 'parse';
        throw parseErr;
      }
      if (shared.length) {
        if (!document.startViewTransition) {
          var apiErr = new Error('View Transition API unavailable for shared route elements');
          apiErr.phase = 'shared-elements-api';
          throw apiErr;
        }
        var applied = applySharedElements(shared, next);
        var transition = document.startViewTransition(function(){ applyNext(next); });
        return transition.finished.then(function(){ busy = false; }).catch(function(err){ throw err; }).finally(function(){
          for (var a = 0; a < applied.length; a++) applied[a].style.viewTransitionName = '';
        });
      }
      applyNext(next);
      busy = false;
    }).catch(function(err){
      failTransition(err && err.phase ? err.phase : 'navigate', err);
    });
  }
  document.addEventListener('click', function(ev) {
    if (container.isConnected === false) return;
    var target = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    var url = sameSiteAnchor(target);
    if (!url) return;
    ev.preventDefault();
    swapTo(url, 'push');
  });
  window.addEventListener('popstate', function() {
    if (container.isConnected === false) return;
    swapTo(new URL(window.location.href), 'replace');
  });
}
`;
