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
function scheduleCollectionGalleryFrame(callback) {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16);
}
function cancelCollectionGalleryFrame(frameId) {
  if (frameId === null || frameId === undefined) return;
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frameId);
    return;
  }
  clearTimeout(frameId);
}
function wireCollectionGalleryDragSlider(galleryRoot, entries, axis, inertiaEnabled, activate) {
  if (!entries || entries.length === 0) return;
  var firstRect = entries[0].getBoundingClientRect();
  var span = axis === 'y' ? firstRect.height : firstRect.width;
  if (!(span > 0)) {
    emitCollectionGalleryFailure(galleryRoot, 'invalid-slider-span', 'Collection gallery drag-slider requires measurable entry bounds', span);
  }
  var maxOffset = span * Math.max(0, entries.length - 1);
  var offset = 0;
  var velocity = 0;
  var dragging = false;
  var lastPoint = 0;
  var frameId = null;
  function setOffset(nextOffset) {
    offset = Math.max(-maxOffset, Math.min(0, nextOffset));
    var x = axis === 'x' ? offset : 0;
    var y = axis === 'y' ? offset : 0;
    galleryRoot.style.setProperty('--opencanvas-collection-slider-x', x.toFixed(2) + 'px');
    galleryRoot.style.setProperty('--opencanvas-collection-slider-y', y.toFixed(2) + 'px');
    var index = Math.max(0, Math.min(entries.length - 1, Math.round(Math.abs(offset) / span)));
    activate(entries[index]);
  }
  function stopInertia() {
    cancelCollectionGalleryFrame(frameId);
    frameId = null;
  }
  function inertiaFrame() {
    velocity *= 0.92;
    if (Math.abs(velocity) < 0.1) {
      frameId = null;
      return;
    }
    setOffset(offset + velocity);
    frameId = scheduleCollectionGalleryFrame(inertiaFrame);
  }
  galleryRoot.addEventListener('pointerdown', function (ev) {
    if (!ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    stopInertia();
    dragging = true;
    velocity = 0;
    lastPoint = axis === 'y' ? ev.clientY : ev.clientX;
    galleryRoot.setAttribute('data-opencanvas-collection-gallery-dragging', 'true');
  });
  galleryRoot.addEventListener('pointermove', function (ev) {
    if (!dragging || !ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    var point = axis === 'y' ? ev.clientY : ev.clientX;
    var delta = point - lastPoint;
    lastPoint = point;
    velocity = delta;
    setOffset(offset + delta);
  });
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    galleryRoot.setAttribute('data-opencanvas-collection-gallery-dragging', 'false');
    if (inertiaEnabled) {
      stopInertia();
      frameId = scheduleCollectionGalleryFrame(inertiaFrame);
    }
  }
  galleryRoot.addEventListener('pointerup', endDrag);
  galleryRoot.addEventListener('pointercancel', endDrag);
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
      var sliderAxis = galleryRoot.getAttribute('data-opencanvas-collection-gallery-slider-axis') || 'x';
      var sliderInertia = galleryRoot.getAttribute('data-opencanvas-collection-gallery-slider-inertia') || 'true';
      var progressAttr = galleryRoot.getAttribute('data-opencanvas-collection-gallery-progress');
      if (mode !== 'hover-reveal-detail' && mode !== 'drag-slider') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-mode', 'Collection gallery mode must be hover-reveal-detail or drag-slider', mode);
      }
      if (detailMode !== 'inline-panel') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-detail-mode', 'Collection gallery detail mode must be inline-panel', detailMode);
      }
      if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-reduced-motion', 'Collection gallery reduced-motion mode must be instant or allow', reducedMotion);
      }
      if (mode === 'drag-slider') {
        if (sliderAxis !== 'x' && sliderAxis !== 'y') {
          emitCollectionGalleryFailure(galleryRoot, 'invalid-slider-axis', 'Collection gallery slider axis must be x or y', sliderAxis);
        }
        if (sliderInertia !== 'true' && sliderInertia !== 'false') {
          emitCollectionGalleryFailure(galleryRoot, 'invalid-slider-inertia', 'Collection gallery slider inertia must be true or false', sliderInertia);
        }
        if (progressAttr !== null && progressAttr !== 'true') {
          emitCollectionGalleryFailure(galleryRoot, 'invalid-progress', 'Collection gallery progress metadata must be true when present', progressAttr);
        }
      } else if (
        galleryRoot.getAttribute('data-opencanvas-collection-gallery-slider-axis') !== null ||
        galleryRoot.getAttribute('data-opencanvas-collection-gallery-slider-inertia') !== null ||
        progressAttr !== null
      ) {
        emitCollectionGalleryFailure(galleryRoot, 'unsupported-slider-relation', 'Collection gallery slider metadata is only supported for drag-slider', mode);
      }
      var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce && reducedMotion === 'instant') galleryRoot.setAttribute('data-opencanvas-collection-gallery-reduced', 'instant');
      galleryRoot.setAttribute('data-opencanvas-collection-gallery-hydrated', 'true');
      var entries = galleryRoot.querySelectorAll('[data-opencanvas-collection-entry]');
      var progressDots = galleryRoot.querySelectorAll('[data-opencanvas-collection-gallery-progress-dot]');
      if (progressAttr === 'true' && entries.length > 1 && progressDots.length !== entries.length) {
        emitCollectionGalleryFailure(galleryRoot, 'invalid-progress-dot-count', 'Collection gallery progress dots must match entry count', progressDots.length);
      }
      function activate(entry) {
        var activeIndex = entry.getAttribute('data-opencanvas-collection-entry') || '0';
        for (var i = 0; i < entries.length; i++) {
          var isActive = entries[i] === entry;
          entries[i].setAttribute('data-opencanvas-collection-entry-active', isActive ? 'true' : 'false');
          entries[i].setAttribute('aria-expanded', isActive ? 'true' : 'false');
        }
        for (var d = 0; d < progressDots.length; d++) {
          var dotActive = progressDots[d].getAttribute('data-opencanvas-collection-gallery-progress-dot') === activeIndex;
          progressDots[d].setAttribute('data-opencanvas-collection-gallery-progress-active', dotActive ? 'true' : 'false');
          progressDots[d].setAttribute('aria-current', dotActive ? 'true' : 'false');
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
      if (mode === 'drag-slider') {
        wireCollectionGalleryDragSlider(galleryRoot, entries, sliderAxis, sliderInertia === 'true' && !(reduce && reducedMotion === 'instant'), activate);
      }
    })(nodes[n]);
  }
}
`;
