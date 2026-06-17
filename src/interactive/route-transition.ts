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
  function swapTo(url) {
    if (busy) return;
    busy = true;
    var outgoingSequence = container.getAttribute('data-opencanvas-route-outgoing-sequence');
    if (outgoingSequence && typeof runMotionSequenceLite === 'function') runMotionSequenceLite(container, outgoingSequence);
    container.style.transition = 'opacity ' + duration + 'ms ' + easing + ', transform ' + duration + 'ms ' + easing + ', clip-path ' + duration + 'ms ' + easing;
    container.setAttribute('data-opencanvas-route-state', 'outgoing');
    wait(duration).then(function(){
      return fetch(url.href, { credentials: 'same-origin' });
    }).then(function(resp){
      if (!resp.ok) throw new Error('fetch failed ' + String(resp.status));
      return resp.text();
    }).then(function(html){
      var doc = new DOMParser().parseFromString(html, 'text/html');
      var next = doc.querySelector('[data-opencanvas-route-container]');
      if (!next) throw new Error('next route container missing');
      container.innerHTML = next.innerHTML;
      var attrs = ['data-opencanvas-route-transition','data-opencanvas-route-mode','data-opencanvas-route-duration-ms','data-opencanvas-route-easing','data-opencanvas-route-outgoing-sequence','data-opencanvas-route-incoming-sequence'];
      for (var i = 0; i < attrs.length; i++) {
        var value = next.getAttribute(attrs[i]);
        if (value === null) container.removeAttribute(attrs[i]);
        else container.setAttribute(attrs[i], value);
      }
      history.pushState({}, '', url.href);
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
      busy = false;
    }).catch(function(err){
      container.removeAttribute('data-opencanvas-route-state');
      busy = false;
      routeFailure(id, 'navigate', { href: url.href, error: String(err && err.message ? err.message : err) });
    });
  }
  document.addEventListener('click', function(ev) {
    if (container.isConnected === false) return;
    var target = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
    var url = sameSiteAnchor(target);
    if (!url) return;
    ev.preventDefault();
    swapTo(url);
  });
  window.addEventListener('popstate', function() {
    if (container.isConnected === false) return;
    swapTo(new URL(window.location.href));
  });
}
`;
