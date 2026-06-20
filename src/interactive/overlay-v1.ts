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
      if (presentation !== 'modal' && presentation !== 'fullscreen-menu' && presentation !== 'lightbox' && presentation !== 'command-palette' && presentation !== 'product-tour') {
        overlayFailure(id, 'overlay-presentation', { presentation: presentation });
        return;
      }
      var chrome = overlay.getAttribute('data-opencanvas-overlay-chrome') || 'standard';
      if (chrome !== 'standard' && chrome !== 'glass-panel' && chrome !== 'editorial-frame') {
        overlayFailure(id, 'overlay-chrome', { chrome: chrome });
        return;
      }
      var backdropStyle = overlay.getAttribute('data-opencanvas-overlay-backdrop-style') || 'dim';
      if (backdropStyle !== 'dim' && backdropStyle !== 'blur' && backdropStyle !== 'solid') {
        overlayFailure(id, 'overlay-backdrop-style', { backdropStyle: backdropStyle });
        return;
      }
      var closePlacement = overlay.getAttribute('data-opencanvas-overlay-close-placement') || 'top-right';
      if (closePlacement !== 'top-right' && closePlacement !== 'top-left' && closePlacement !== 'inside') {
        overlayFailure(id, 'overlay-close-placement', { closePlacement: closePlacement });
        return;
      }
      var layout = overlay.getAttribute('data-opencanvas-overlay-layout') || 'centered';
      if (layout !== 'centered' && layout !== 'split-rail' && layout !== 'mega-menu-grid') {
        overlayFailure(id, 'overlay-layout', { layout: layout });
        return;
      }
      var choreography = overlay.getAttribute('data-opencanvas-overlay-choreography') || 'none';
      if (choreography !== 'none' && choreography !== 'stagger-rise' && choreography !== 'mask-sweep' && choreography !== 'slide-stack') {
        overlayFailure(id, 'overlay-choreography', { choreography: choreography });
        return;
      }
      var reducedMotion = overlay.getAttribute('data-opencanvas-overlay-reduced-motion') || 'instant';
      if (reducedMotion !== 'instant' && reducedMotion !== 'fade') {
        overlayFailure(id, 'overlay-choreography-reduced-motion', { reducedMotion: reducedMotion });
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
        overlay.removeAttribute('data-opencanvas-overlay-choreography-active');
        overlay.removeAttribute('data-opencanvas-overlay-reduced-motion-active');
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
        overlay.setAttribute('data-opencanvas-overlay-choreography-active', choreography);
        var reduce = false;
        if (typeof window.matchMedia === 'function') {
          reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
        }
        if (reduce && choreography !== 'none') overlay.setAttribute('data-opencanvas-overlay-reduced-motion-active', reducedMotion);
        else overlay.removeAttribute('data-opencanvas-overlay-reduced-motion-active');
        document.documentElement.setAttribute('data-opencanvas-overlay-active-presentation', presentation);
        if (lockEnabled) document.body.style.overflow = 'hidden';
        if (closeButtonEnabled && surface && !closeButton) {
          closeButton = document.createElement('button');
          closeButton.type = 'button';
          closeButton.className = 'opencanvas-overlay-close opencanvas-overlay-close--' + closePlacement;
          closeButton.setAttribute('data-opencanvas-overlay-close-placement', closePlacement);
          closeButton.setAttribute('aria-label', presentation === 'fullscreen-menu' ? 'Close menu' : presentation === 'lightbox' ? 'Close lightbox' : presentation === 'command-palette' ? 'Close command palette' : presentation === 'product-tour' ? 'Close product tour' : 'Close overlay');
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
