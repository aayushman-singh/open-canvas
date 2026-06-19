export const OVERLAY_RUNTIME_SRC = String.raw`
function overlayFailure(id, phase, extra) {
  var detail = { overlayId: id, phase: phase };
  for (var k in (extra || {})) detail[k] = extra[k];
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('opencanvas:overlay-failed', { detail: detail }));
  console.error('[opencanvas overlay] failed', detail);
}
function hydrateOverlays(scope, options) {
  var root = scope || document;
  var nodes = root.querySelectorAll('[data-opencanvas-overlay]');
  for (var i = 0; i < nodes.length; i++) {
    (function(overlay){
      if (overlay.getAttribute('data-opencanvas-overlay-hydrated') === 'true') return;
      overlay.setAttribute('data-opencanvas-overlay-hydrated', 'true');
      var id = overlay.getAttribute('data-opencanvas-overlay') || '';
      var triggerType = overlay.getAttribute('data-opencanvas-overlay-trigger-type') || 'load';
      var triggerValue = parseFloat(overlay.getAttribute('data-opencanvas-overlay-trigger-value') || '0');
      var triggerTarget = overlay.getAttribute('data-opencanvas-overlay-trigger-target') || '';
      var presentation = overlay.getAttribute('data-opencanvas-overlay-presentation') || 'modal';
      if (presentation !== 'modal' && presentation !== 'fullscreen-menu') {
        overlayFailure(id, 'overlay-presentation', { presentation: presentation });
        return;
      }
      var surface = overlay.querySelector('[data-opencanvas-overlay-surface]');
      var backdrop = overlay.querySelector('[data-opencanvas-overlay-backdrop]');
      var closeButtonEnabled = overlay.getAttribute('data-opencanvas-overlay-close-button') === 'true';
      var escapeEnabled = overlay.getAttribute('data-opencanvas-overlay-escape') === 'true';
      var backdropEnabled = overlay.getAttribute('data-opencanvas-overlay-backdrop-click') === 'true';
      var lockEnabled = overlay.getAttribute('data-opencanvas-overlay-body-scroll-lock') === 'true';
      var trapEnabled = overlay.getAttribute('data-opencanvas-overlay-focus-trap') === 'true';
      var returnFocusEnabled = overlay.getAttribute('data-opencanvas-overlay-return-focus') === 'true';
      var lastFocus = null;
      var fired = false;
      var closeButton = null;
      var previousOverflow = '';

      function focusableNodes() {
        if (!surface) return [];
        return surface.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
      }
      function close() {
        var closeSequence = overlay.getAttribute('data-opencanvas-overlay-close-sequence');
        if (closeSequence && typeof runMotionSequenceLite === 'function') runMotionSequenceLite(overlay, closeSequence);
        overlay.removeAttribute('data-opencanvas-overlay-open');
        overlay.removeAttribute('data-opencanvas-overlay-active-presentation');
        if (document.documentElement.getAttribute('data-opencanvas-overlay-active-presentation') === presentation) {
          document.documentElement.removeAttribute('data-opencanvas-overlay-active-presentation');
        }
        overlay.hidden = true;
        if (lockEnabled) document.body.style.overflow = previousOverflow;
        if (returnFocusEnabled && lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
      }
      function onKeydown(ev) {
        if (ev.key === 'Escape' && escapeEnabled) {
          ev.preventDefault();
          close();
          return;
        }
        if (!trapEnabled || ev.key !== 'Tab') return;
        var nodes = focusableNodes();
        if (!nodes.length) return;
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        if (ev.shiftKey && document.activeElement === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && document.activeElement === last) {
          ev.preventDefault();
          first.focus();
        }
      }
      function open() {
        if (fired) return;
        fired = true;
        lastFocus = document.activeElement;
        previousOverflow = document.body.style.overflow || '';
        overlay.hidden = false;
        overlay.setAttribute('data-opencanvas-overlay-open', 'true');
        overlay.setAttribute('data-opencanvas-overlay-active-presentation', presentation);
        document.documentElement.setAttribute('data-opencanvas-overlay-active-presentation', presentation);
        if (lockEnabled) document.body.style.overflow = 'hidden';
        if (closeButtonEnabled && surface && !closeButton) {
          closeButton = document.createElement('button');
          closeButton.type = 'button';
          closeButton.className = 'opencanvas-overlay-close';
          closeButton.setAttribute('aria-label', presentation === 'fullscreen-menu' ? 'Close menu' : 'Close overlay');
          closeButton.textContent = presentation === 'fullscreen-menu' ? 'Close' : 'x';
          closeButton.addEventListener('click', close);
          surface.appendChild(closeButton);
        }
        var openSequence = overlay.getAttribute('data-opencanvas-overlay-open-sequence');
        if (openSequence && typeof runMotionSequenceLite === 'function') runMotionSequenceLite(overlay, openSequence);
        var nodes = focusableNodes();
        if (nodes.length && typeof nodes[0].focus === 'function') nodes[0].focus();
        else if (surface && typeof surface.focus === 'function') {
          surface.setAttribute('tabindex', '-1');
          surface.focus();
        }
      }
      if (backdrop && backdropEnabled) backdrop.addEventListener('click', close);
      document.addEventListener('keydown', onKeydown);
      if (triggerType === 'load') {
        open();
      } else if (triggerType === 'delay') {
        window.setTimeout(open, Number.isFinite(triggerValue) ? triggerValue : 0);
      } else if (triggerType === 'scroll') {
        window.addEventListener('scroll', function(){
          var max = document.documentElement.scrollHeight - window.innerHeight;
          if (max <= 0) return;
          var pct = window.scrollY / max * 100;
          if (pct >= triggerValue) open();
        });
      } else if (triggerType === 'exit-intent') {
        document.documentElement.addEventListener('mouseleave', function(ev){ if (ev.clientY <= 0) open(); });
      } else if (triggerType === 'element-click') {
        var target = null;
        var candidates = (root.querySelectorAll ? root : document).querySelectorAll('[data-opencanvas-element]');
        for (var c = 0; c < candidates.length; c++) {
          if (candidates[c].getAttribute('data-opencanvas-element') === triggerTarget) {
            target = candidates[c];
            break;
          }
        }
        if (!target) {
          overlayFailure(id, 'bind-trigger', { targetElementId: triggerTarget });
          return;
        }
        target.addEventListener('click', open);
      } else {
        overlayFailure(id, 'bind-trigger', { triggerType: triggerType });
      }
    })(nodes[i]);
  }
}
`;
