export const EMBED_DRILL_IN_RUNTIME_SRC = String.raw`
function emitEmbedDrillInFailure(root, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    elementId: root && root.getAttribute ? root.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:embed-drill-in-failed', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas embed-drill-in] ' + message, detail);
  }
  throw new Error('[opencanvas embed-drill-in] ' + message);
}
function hydrateEmbedDrillIns(scope) {
  var rootScope = scope || document;
  var nodes = [];
  if (rootScope && rootScope.getAttribute && rootScope.getAttribute('data-opencanvas-embed-drill-in') === 'true') nodes.push(rootScope);
  if (rootScope && rootScope.querySelectorAll) {
    var found = rootScope.querySelectorAll('[data-opencanvas-embed-drill-in="true"]');
    for (var i = 0; i < found.length; i++) nodes.push(found[i]);
  }
  for (var n = 0; n < nodes.length; n++) {
    (function (root) {
      if (root.getAttribute('data-opencanvas-embed-drill-in-hydrated') === 'true') return;
      var src = root.getAttribute('data-opencanvas-embed-drill-in-src') || '';
      var title = root.getAttribute('data-opencanvas-embed-drill-in-title') || '';
      var reducedMotion = root.getAttribute('data-opencanvas-embed-drill-in-reduced-motion') || '';
      if (!src) emitEmbedDrillInFailure(root, 'missing-src', 'Embed drill-in requires a resolved iframe src', src);
      if (!title) emitEmbedDrillInFailure(root, 'missing-title', 'Embed drill-in requires title metadata', title);
      if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
        emitEmbedDrillInFailure(root, 'invalid-reduced-motion', 'Embed drill-in reduced-motion mode must be instant or allow', reducedMotion);
      }
      var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      root.setAttribute('data-opencanvas-embed-drill-in-hydrated', 'true');
      var trigger = root.querySelector('[data-opencanvas-embed-drill-in-trigger]') || root;
      var overlay = null;
      var previousOverflow = '';
      function ensureOverlay() {
        if (overlay) return overlay;
        if (!document.body) emitEmbedDrillInFailure(root, 'missing-body', 'Embed drill-in requires document.body', null);
        overlay = document.createElement('div');
        overlay.className = 'opencanvas-embed-drill-in-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-label', title);
        overlay.setAttribute('data-opencanvas-embed-drill-in-overlay', 'true');
        if (reduce && reducedMotion === 'instant') overlay.setAttribute('data-opencanvas-embed-drill-in-reduced', 'instant');
        overlay.hidden = true;
        var chrome = document.createElement('div');
        chrome.className = 'opencanvas-embed-drill-in-chrome';
        var heading = document.createElement('strong');
        heading.textContent = title;
        var closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'opencanvas-embed-drill-in-close';
        closeButton.textContent = 'Close';
        closeButton.setAttribute('aria-label', 'Close ' + title);
        chrome.appendChild(heading);
        chrome.appendChild(closeButton);
        var frame = document.createElement('iframe');
        frame.className = 'opencanvas-embed-drill-in-frame';
        frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
        frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
        frame.setAttribute('allowfullscreen', '');
        frame.setAttribute('title', title);
        overlay.appendChild(chrome);
        overlay.appendChild(frame);
        document.body.appendChild(overlay);
        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', function (ev) { if (ev.target === overlay) close(); });
        return overlay;
      }
      function open() {
        var shell = ensureOverlay();
        var frame = shell.querySelector('iframe');
        if (!frame) emitEmbedDrillInFailure(root, 'missing-frame', 'Embed drill-in overlay iframe was not created', null);
        frame.setAttribute('src', src);
        previousOverflow = document.body.style.overflow || '';
        document.body.style.overflow = 'hidden';
        shell.hidden = false;
        shell.setAttribute('data-opencanvas-embed-drill-in-open', 'true');
        var closeButton = shell.querySelector('.opencanvas-embed-drill-in-close');
        if (closeButton && typeof closeButton.focus === 'function') closeButton.focus();
      }
      function close() {
        if (!overlay) return;
        overlay.hidden = true;
        overlay.removeAttribute('data-opencanvas-embed-drill-in-open');
        var frame = overlay.querySelector('iframe');
        if (frame) frame.removeAttribute('src');
        document.body.style.overflow = previousOverflow;
        if (trigger && typeof trigger.focus === 'function') trigger.focus();
      }
      trigger.addEventListener('click', function (ev) { ev.preventDefault(); open(); });
      root.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          open();
        }
      });
      document.addEventListener('keydown', function (ev) {
        if (ev.key === 'Escape') close();
      });
    })(nodes[n]);
  }
}
`;
