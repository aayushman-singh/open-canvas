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
function emitCollectionSearchFailure(root, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    collectionId: root && root.getAttribute ? root.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:collection-search-failed', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas collection-search] ' + message, detail);
  }
  throw new Error('[opencanvas collection-search] ' + message);
}
function emitCollectionFilterFailure(root, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    collectionId: root && root.getAttribute ? root.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:collection-filter-failed', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas collection-filter] ' + message, detail);
  }
  throw new Error('[opencanvas collection-filter] ' + message);
}
function emitCollectionViewFailure(root, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    collectionId: root && root.getAttribute ? root.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:collection-view-failed', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas collection-view] ' + message, detail);
  }
  throw new Error('[opencanvas collection-view] ' + message);
}
function normaliseCollectionSearchText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}
function updateCollectionQueryVisibility(collectionRoot, entries, empty) {
  var visible = 0;
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var searchMatch = entry.getAttribute('data-opencanvas-collection-entry-search-match') !== 'false';
    var filterMatch = entry.getAttribute('data-opencanvas-collection-entry-filter-match') !== 'false';
    var matched = searchMatch && filterMatch;
    entry.hidden = !matched;
    if (matched) visible += 1;
  }
  collectionRoot.setAttribute('data-opencanvas-collection-visible-count', String(visible));
  if (empty) empty.hidden = visible !== 0;
}
function wireCollectionSearch(collectionRoot) {
  var reducedMotion = collectionRoot.getAttribute('data-opencanvas-collection-search-reduced-motion');
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionSearchFailure(collectionRoot, 'invalid-reduced-motion', 'Collection search reduced-motion mode must be instant or allow', reducedMotion);
  }
  var input = collectionRoot.querySelector('[data-opencanvas-collection-search-input]');
  if (!input) {
    emitCollectionSearchFailure(collectionRoot, 'missing-search-input', 'Collection search requires a rendered search input', null);
  }
  var entries = collectionRoot.querySelectorAll('[data-opencanvas-collection-entry]');
  var empty = collectionRoot.querySelector('[data-opencanvas-collection-search-empty]');
  var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && reducedMotion === 'instant') collectionRoot.setAttribute('data-opencanvas-collection-search-reduced', 'instant');
  function applySearch() {
    var query = normaliseCollectionSearchText(input.value);
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var text = normaliseCollectionSearchText(entry.textContent);
      var matched = query.length === 0 || text.indexOf(query) !== -1;
      entry.setAttribute('data-opencanvas-collection-entry-search-match', matched ? 'true' : 'false');
    }
    collectionRoot.setAttribute('data-opencanvas-collection-search-query', query);
    updateCollectionQueryVisibility(collectionRoot, entries, empty);
  }
  input.addEventListener('input', applySearch);
  applySearch();
}
function collectionEntryMatchesFilter(collectionRoot, entry, field, value) {
  if (value === '__all__') return true;
  if (field === 'folder') {
    return entry.getAttribute('data-opencanvas-collection-entry-folder') === value;
  }
  if (field === 'category') {
    return entry.getAttribute('data-opencanvas-collection-entry-category') === value;
  }
  if (field === 'tag') {
    var rawTags = entry.getAttribute('data-opencanvas-collection-entry-tags') || '[]';
    try {
      var parsed = JSON.parse(rawTags);
      if (!parsed || typeof parsed.length !== 'number') return false;
      for (var i = 0; i < parsed.length; i++) {
        if (parsed[i] === value) return true;
      }
      return false;
    } catch (err) {
      emitCollectionFilterFailure(collectionRoot, 'invalid-filter-tags', 'Collection filter tag metadata must be valid JSON', err);
    }
  }
  return false;
}
function wireCollectionFilter(collectionRoot) {
  var field = collectionRoot.getAttribute('data-opencanvas-collection-filter');
  var reducedMotion = collectionRoot.getAttribute('data-opencanvas-collection-filter-reduced-motion');
  if (field !== 'folder' && field !== 'category' && field !== 'tag') {
    emitCollectionFilterFailure(collectionRoot, 'invalid-filter-field', 'Collection filter field must be folder, category, or tag', field);
  }
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionFilterFailure(collectionRoot, 'invalid-filter-reduced-motion', 'Collection filter reduced-motion mode must be instant or allow', reducedMotion);
  }
  var entries = collectionRoot.querySelectorAll('[data-opencanvas-collection-entry]');
  var buttons = collectionRoot.querySelectorAll('[data-opencanvas-collection-filter-option]');
  if (!buttons || buttons.length === 0) {
    emitCollectionFilterFailure(collectionRoot, 'missing-filter-options', 'Collection filter requires rendered option buttons', null);
  }
  var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && reducedMotion === 'instant') collectionRoot.setAttribute('data-opencanvas-collection-filter-reduced', 'instant');
  function setActive(value) {
    var matchedButton = false;
    for (var b = 0; b < buttons.length; b++) {
      var buttonValue = buttons[b].getAttribute('data-opencanvas-collection-filter-option') || '__all__';
      var active = buttonValue === value;
      buttons[b].setAttribute('data-opencanvas-collection-filter-active', active ? 'true' : 'false');
      buttons[b].setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) matchedButton = true;
    }
    if (!matchedButton) {
      emitCollectionFilterFailure(collectionRoot, 'missing-default-filter', 'Collection filter default must match a rendered option', value);
    }
    for (var i = 0; i < entries.length; i++) {
      var matched = collectionEntryMatchesFilter(collectionRoot, entries[i], field, value);
      entries[i].setAttribute('data-opencanvas-collection-entry-filter-match', matched ? 'true' : 'false');
    }
    collectionRoot.setAttribute('data-opencanvas-collection-filter-active-value', value);
    updateCollectionQueryVisibility(collectionRoot, entries, null);
  }
  for (var c = 0; c < buttons.length; c++) {
    (function (button) {
      button.addEventListener('click', function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        setActive(button.getAttribute('data-opencanvas-collection-filter-option') || '__all__');
      });
    })(buttons[c]);
  }
  setActive(collectionRoot.getAttribute('data-opencanvas-collection-filter-default') || '__all__');
}
function wireCollectionViewToggle(collectionRoot) {
  var defaultMode = collectionRoot.getAttribute('data-opencanvas-collection-view-default') || 'grid';
  var reducedMotion = collectionRoot.getAttribute('data-opencanvas-collection-view-reduced-motion');
  if (defaultMode !== 'grid' && defaultMode !== 'list') {
    emitCollectionViewFailure(collectionRoot, 'invalid-view-default', 'Collection view default must be grid or list', defaultMode);
  }
  if (reducedMotion !== 'instant' && reducedMotion !== 'allow') {
    emitCollectionViewFailure(collectionRoot, 'invalid-view-reduced-motion', 'Collection view reduced-motion mode must be instant or allow', reducedMotion);
  }
  var buttons = collectionRoot.querySelectorAll('[data-opencanvas-collection-view-option]');
  if (!buttons || buttons.length === 0) {
    emitCollectionViewFailure(collectionRoot, 'missing-view-options', 'Collection view toggle requires rendered option buttons', null);
  }
  var reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce && reducedMotion === 'instant') collectionRoot.setAttribute('data-opencanvas-collection-view-reduced', 'instant');
  function setView(mode) {
    if (mode !== 'grid' && mode !== 'list') {
      emitCollectionViewFailure(collectionRoot, 'invalid-view-option', 'Collection view option must be grid or list', mode);
    }
    var matchedButton = false;
    for (var i = 0; i < buttons.length; i++) {
      var buttonMode = buttons[i].getAttribute('data-opencanvas-collection-view-option');
      var active = buttonMode === mode;
      buttons[i].setAttribute('data-opencanvas-collection-view-active', active ? 'true' : 'false');
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
      if (active) matchedButton = true;
    }
    if (!matchedButton) {
      emitCollectionViewFailure(collectionRoot, 'missing-default-view', 'Collection view default must match a rendered option', mode);
    }
    collectionRoot.setAttribute('data-opencanvas-collection-view-active', mode);
  }
  for (var b = 0; b < buttons.length; b++) {
    (function (button) {
      button.addEventListener('click', function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        setView(button.getAttribute('data-opencanvas-collection-view-option') || 'grid');
      });
    })(buttons[b]);
  }
  setView(defaultMode);
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
function wireCollectionGalleryDragSlider(galleryRoot, entries, progressDots, axis, inertiaEnabled, activate) {
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
  function moveToIndex(index) {
    var clamped = Math.max(0, Math.min(entries.length - 1, Number(index) || 0));
    setOffset(-span * clamped);
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
  galleryRoot.addEventListener('keydown', function (ev) {
    if (!ev) return;
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowDown' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowUp') return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    var current = Number(galleryRoot.getAttribute('data-opencanvas-collection-active-entry') || '0');
    var delta = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : -1;
    moveToIndex(current + delta);
  });
  for (var i = 0; i < progressDots.length; i++) {
    (function (dot) {
      dot.addEventListener('click', function (ev) {
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        moveToIndex(Number(dot.getAttribute('data-opencanvas-collection-gallery-progress-dot') || '0'));
      });
    })(progressDots[i]);
  }
}
function hydrateCollectionGalleries(scope) {
  var root = scope || document;
  var nodes = [];
  if (
    root &&
    root.getAttribute &&
    (root.getAttribute('data-opencanvas-collection-gallery') ||
      root.getAttribute('data-opencanvas-collection-search') === 'true' ||
      root.getAttribute('data-opencanvas-collection-filter') !== null ||
      root.getAttribute('data-opencanvas-collection-view-toggle') === 'true')
  ) nodes.push(root);
  if (root && root.querySelectorAll) {
    var found = root.querySelectorAll('[data-opencanvas-collection-gallery],[data-opencanvas-collection-search="true"],[data-opencanvas-collection-filter],[data-opencanvas-collection-view-toggle="true"]');
    for (var i = 0; i < found.length; i++) nodes.push(found[i]);
  }
  for (var n = 0; n < nodes.length; n++) {
    (function (galleryRoot) {
      var hasGallery = galleryRoot.getAttribute('data-opencanvas-collection-gallery') !== null;
      var hasSearch = galleryRoot.getAttribute('data-opencanvas-collection-search') === 'true';
      var hasFilter = galleryRoot.getAttribute('data-opencanvas-collection-filter') !== null;
      var hasViewToggle = galleryRoot.getAttribute('data-opencanvas-collection-view-toggle') === 'true';
      if (hasSearch && galleryRoot.getAttribute('data-opencanvas-collection-search-hydrated') !== 'true') {
        wireCollectionSearch(galleryRoot);
        galleryRoot.setAttribute('data-opencanvas-collection-search-hydrated', 'true');
      }
      if (hasFilter && galleryRoot.getAttribute('data-opencanvas-collection-filter-hydrated') !== 'true') {
        wireCollectionFilter(galleryRoot);
        galleryRoot.setAttribute('data-opencanvas-collection-filter-hydrated', 'true');
      }
      if (hasViewToggle && galleryRoot.getAttribute('data-opencanvas-collection-view-hydrated') !== 'true') {
        wireCollectionViewToggle(galleryRoot);
        galleryRoot.setAttribute('data-opencanvas-collection-view-hydrated', 'true');
      }
      if (!hasGallery) return;
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
        wireCollectionGalleryDragSlider(galleryRoot, entries, progressDots, sliderAxis, sliderInertia === 'true' && !(reduce && reducedMotion === 'instant'), activate);
      }
    })(nodes[n]);
  }
}
`;
