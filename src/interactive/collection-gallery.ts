export const COLLECTION_GALLERY_RUNTIME_SRC = String.raw`
function emitCollectionGalleryFailure(root, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    collectionId: root && root.getAttribute ? root.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:collection-gallery-failed', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas collection-gallery] ' + message, detail);
  }
  throw new Error('[opencanvas collection-gallery] ' + message);
}
function hydrateCollectionGalleries(scope) {
  var root = scope || document;
  var nodes = [];
  if (root && root.getAttribute && root.getAttribute('data-opencanvas-collection-gallery')) nodes.push(root);
  if (root && root.querySelectorAll) {
    var found = root.querySelectorAll('[data-opencanvas-collection-gallery]');
    for (var i = 0; i < found.length; i++) nodes.push(found[i]);
  }
  for (var n = 0; n < nodes.length; n++) {
    (function (galleryRoot) {
      if (galleryRoot.getAttribute('data-opencanvas-collection-gallery-hydrated') === 'true') return;
      var mode = galleryRoot.getAttribute('data-opencanvas-collection-gallery');
      var detailMode = galleryRoot.getAttribute('data-opencanvas-collection-gallery-detail');
      var reducedMotion = galleryRoot.getAttribute('data-opencanvas-collection-gallery-reduced-motion');
      if (mode !== 'hover-reveal-detail') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-mode', 'Collection gallery mode must be hover-reveal-detail', mode);
      }
      if (detailMode !== 'inline-panel') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-detail-mode', 'Collection gallery detail mode must be inline-panel', detailMode);
      }
      if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-reduced-motion', 'Collection gallery reduced-motion mode must be instant or allow', reducedMotion);
      }
      var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce && reducedMotion === 'instant') galleryRoot.setAttribute('data-opencanvas-collection-gallery-reduced', 'instant');
      galleryRoot.setAttribute('data-opencanvas-collection-gallery-hydrated', 'true');
      var entries = galleryRoot.querySelectorAll('[data-opencanvas-collection-entry]');
      function activate(entry) {
        var activeIndex = entry.getAttribute('data-opencanvas-collection-entry') || '0';
        for (var i = 0; i < entries.length; i++) {
          var isActive = entries[i] === entry;
          entries[i].setAttribute('data-opencanvas-collection-entry-active', isActive ? 'true' : 'false');
          entries[i].setAttribute('aria-expanded', isActive ? 'true' : 'false');
        }
        galleryRoot.setAttribute('data-opencanvas-collection-active-entry', activeIndex);
      }
      if (entries.length > 0) {
        var initial = entries[0];
        for (var j = 0; j < entries.length; j++) {
          if (entries[j].getAttribute('data-opencanvas-collection-entry-active') === 'true') {
            initial = entries[j];
            break;
          }
        }
        activate(initial);
      }
      for (var e = 0; e < entries.length; e++) {
        (function (entry) {
          entry.addEventListener('pointerenter', function () { activate(entry); });
          entry.addEventListener('focus', function () { activate(entry); });
          entry.addEventListener('click', function () { activate(entry); });
          entry.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault();
              activate(entry);
            }
          });
        })(entries[e]);
      }
    })(nodes[n]);
  }
}
`;
