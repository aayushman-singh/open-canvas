// src/interactive/pointer-fx.ts
//
// ADR 0066 dec 4 — pointer-reactive runtime fragment. ONE fragment inside the
// existing interactive IIFE (not a new <script>, not a per-component script).
// It reads the declarative `data-opencanvas-pointer-fx="<primitive>"` attribute
// and PUBLISHES pointer state as CSS custom properties on the element; the
// variant CSS in `public-styles.ts` consumes those properties and does all the
// painting. The fragment never paints.
//
// Primitives:
//   - `spotlight` — publishes `--opencanvas-ptr-x` / `--opencanvas-ptr-y` as
//     percentages of the element box from `pointermove` (used by the Form
//     `spotlight` variant's radial glow). On `pointerleave` it recentres to
//     50%/50% so the authored static base (centred glow) is restored.
//   - `tilt` — publishes `--opencanvas-tilt-x` / `--opencanvas-tilt-y` as small
//     `deg` rotations from the pointer's offset from centre. Recentres to 0deg
//     on leave. (Implemented + smoke-tested; available for a future catalog
//     arm — no shipped variant uses it yet, see DECISIONS_V4 D5.)
//   - `magnetic` — publishes `--opencanvas-magnetic-x` /
//     `--opencanvas-magnetic-y` as small px translations from centre. CSS owns
//     the transform; the runtime only publishes pointer state.
//   - `cursor-follow` — publishes `--opencanvas-cursor-follow-x` /
//     `--opencanvas-cursor-follow-y` as stronger bounded px translations from
//     centre. CSS owns the transform; the runtime only publishes pointer state.
//   - `reveal-mask` — publishes `--opencanvas-reveal-x` /
//     `--opencanvas-reveal-y` as percentages of the element box. CSS owns the
//     clip-path reveal; the runtime only publishes pointer state.
//   - `pointer-parallax` — publishes `--opencanvas-parallax-x` /
//     `--opencanvas-parallax-y` as small inverse px translations from centre.
//     CSS owns the transform; the runtime only publishes pointer state.
//   - `cursor-trail` — appends short-lived `opencanvas-pointer-trail` spans at
//     pointer coordinates. CSS owns trail rendering and lifetime animation.
//   - `image-follow` — appends one preview image from schema-owned asset
//     metadata and positions it at pointer coordinates.
//   - `drag-inertia` — publishes bounded drag offsets as CSS variables and can
//     keep moving briefly after release when inertia is enabled.
//
// Scroll / entrance motion is deliberately NOT here — that stays with the
// existing `motion.preset` + `data-scroll-trigger` system (ADR dec 4).
//
// Contract notes:
//   - Document-wide pass (not a `data-opencanvas-interactive` dispatch arm):
//     a pointer-fx element need not be an interactive element type (e.g. a
//     button with spotlight), so the entry point runs this once over the whole
//     document rather than per interactive root.
//   - Idempotent: each element is marked `data-opencanvas-pfx-hydrated="true"`
//     so a re-hydrate (live-publish DOM swap) does not double-wire listeners.

export const POINTER_FX_RUNTIME_SRC = String.raw`
function emitPointerFxFailure(el, code, message, cause) {
  var detail = {
    code: code,
    message: message,
    elementId: el && el.getAttribute ? el.getAttribute('data-opencanvas-element') : null,
    cause: cause === null ? null : String(cause)
  };
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
    window.dispatchEvent(new CustomEvent('opencanvas:pointer-fx-failure', { detail: detail }));
  }
  if (typeof console !== 'undefined' && console.error) {
    console.error('[opencanvas pointer-fx] ' + message, detail);
  }
  throw new Error('[opencanvas pointer-fx] ' + message);
}
function pointerFxPrefersReducedMotion(options) {
  if (options && options.reducedMotion === 'reduce') return true;
  if (options && options.reducedMotion === 'no-preference') return false;
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function appendPointerTrail(el, ev) {
  var r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  var px = ((ev.clientX - r.left) / r.width) * 100;
  var py = ((ev.clientY - r.top) / r.height) * 100;
  var doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function' || typeof el.appendChild !== 'function') {
    emitPointerFxFailure(el, 'trail-dom-missing', 'Pointer FX cursor-trail requires DOM append support', null);
  }
  var trail = doc.createElement('span');
  trail.className = 'opencanvas-pointer-trail';
  trail.setAttribute('aria-hidden', 'true');
  trail.style.left = px.toFixed(2) + '%';
  trail.style.top = py.toFixed(2) + '%';
  el.appendChild(trail);
  setTimeout(function () {
    if (trail && typeof trail.remove === 'function') trail.remove();
    else if (trail && trail.parentNode && typeof trail.parentNode.removeChild === 'function') trail.parentNode.removeChild(trail);
  }, 560);
}
function appendPointerImageFollow(el, previewSrc) {
  if (!previewSrc) {
    emitPointerFxFailure(el, 'image-follow-src-missing', 'Pointer FX image-follow requires preview asset metadata', previewSrc);
  }
  var doc = el.ownerDocument || (typeof document !== 'undefined' ? document : null);
  if (!doc || typeof doc.createElement !== 'function' || typeof el.appendChild !== 'function') {
    emitPointerFxFailure(el, 'image-follow-dom-missing', 'Pointer FX image-follow requires DOM append support', null);
  }
  var img = doc.createElement('img');
  img.className = 'opencanvas-pointer-image-follow';
  img.setAttribute('src', previewSrc);
  img.setAttribute('alt', '');
  img.setAttribute('aria-hidden', 'true');
  el.appendChild(img);
  return img;
}
function positionPointerImageFollow(el, img, ev) {
  var r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  var px = ((ev.clientX - r.left) / r.width) * 100;
  var py = ((ev.clientY - r.top) / r.height) * 100;
  img.style.left = px.toFixed(2) + '%';
  img.style.top = py.toFixed(2) + '%';
  img.setAttribute('data-opencanvas-pointer-image-follow-active', 'true');
}
function applyPointerFxTouchState(el, primitive, ev, img) {
  var r = el.getBoundingClientRect();
  if (!(r.width > 0) || !(r.height > 0)) return;
  var px = ((ev.clientX - r.left) / r.width) * 100;
  var py = ((ev.clientY - r.top) / r.height) * 100;
  var nx = (ev.clientX - r.left) / r.width - 0.5;
  var ny = (ev.clientY - r.top) / r.height - 0.5;
  if (primitive === 'spotlight') {
    el.style.setProperty('--opencanvas-ptr-x', px.toFixed(2) + '%');
    el.style.setProperty('--opencanvas-ptr-y', py.toFixed(2) + '%');
  } else if (primitive === 'reveal-mask') {
    el.style.setProperty('--opencanvas-reveal-x', px.toFixed(2) + '%');
    el.style.setProperty('--opencanvas-reveal-y', py.toFixed(2) + '%');
  } else if (primitive === 'tilt') {
    el.style.setProperty('--opencanvas-tilt-x', (nx * 12).toFixed(2) + 'deg');
    el.style.setProperty('--opencanvas-tilt-y', (-ny * 12).toFixed(2) + 'deg');
  } else if (primitive === 'magnetic') {
    el.style.setProperty('--opencanvas-magnetic-x', (nx * 24).toFixed(2) + 'px');
    el.style.setProperty('--opencanvas-magnetic-y', (ny * 24).toFixed(2) + 'px');
  } else if (primitive === 'cursor-follow') {
    el.style.setProperty('--opencanvas-cursor-follow-x', (nx * 96).toFixed(2) + 'px');
    el.style.setProperty('--opencanvas-cursor-follow-y', (ny * 96).toFixed(2) + 'px');
  } else if (primitive === 'pointer-parallax') {
    el.style.setProperty('--opencanvas-parallax-x', (nx * -18).toFixed(2) + 'px');
    el.style.setProperty('--opencanvas-parallax-y', (ny * -18).toFixed(2) + 'px');
  } else if (primitive === 'cursor-trail') {
    appendPointerTrail(el, ev);
  } else if (primitive === 'image-follow') {
    positionPointerImageFollow(el, img, ev);
  } else {
    emitPointerFxFailure(el, 'invalid-primitive', 'Pointer FX primitive cannot be touch-activated', primitive);
  }
  el.setAttribute('data-opencanvas-pointer-fx-touch-active', 'true');
}
function resetPointerFxTouchState(el, primitive, img) {
  if (primitive === 'spotlight') {
    el.style.setProperty('--opencanvas-ptr-x', '50%');
    el.style.setProperty('--opencanvas-ptr-y', '50%');
  } else if (primitive === 'reveal-mask') {
    el.style.setProperty('--opencanvas-reveal-x', '50%');
    el.style.setProperty('--opencanvas-reveal-y', '50%');
  } else if (primitive === 'tilt') {
    el.style.setProperty('--opencanvas-tilt-x', '0deg');
    el.style.setProperty('--opencanvas-tilt-y', '0deg');
  } else if (primitive === 'magnetic') {
    el.style.setProperty('--opencanvas-magnetic-x', '0px');
    el.style.setProperty('--opencanvas-magnetic-y', '0px');
  } else if (primitive === 'cursor-follow') {
    el.style.setProperty('--opencanvas-cursor-follow-x', '0px');
    el.style.setProperty('--opencanvas-cursor-follow-y', '0px');
  } else if (primitive === 'pointer-parallax') {
    el.style.setProperty('--opencanvas-parallax-x', '0px');
    el.style.setProperty('--opencanvas-parallax-y', '0px');
  } else if (primitive === 'image-follow' && img) {
    img.setAttribute('data-opencanvas-pointer-image-follow-active', 'false');
  }
  el.setAttribute('data-opencanvas-pointer-fx-touch-active', 'false');
}
function wirePointerFxTouch(el, primitive, touchActivation, img) {
  if (touchActivation === 'none') return;
  var touchActive = false;
  el.addEventListener('pointerdown', function (ev) {
    if (!ev || ev.pointerType !== 'touch') return;
    if (touchActivation === 'toggle' && touchActive) {
      resetPointerFxTouchState(el, primitive, img);
      touchActive = false;
      return;
    }
    applyPointerFxTouchState(el, primitive, ev, img);
    touchActive = true;
    if (touchActivation === 'tap') {
      setTimeout(function () {
        resetPointerFxTouchState(el, primitive, img);
        touchActive = false;
      }, 700);
    }
  });
}
function schedulePointerFxDragFrame(callback) {
  if (typeof window !== 'undefined' && window.requestAnimationFrame) {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16);
}
function cancelPointerFxDragFrame(frameId) {
  if (frameId === null || frameId === undefined) return;
  if (typeof window !== 'undefined' && window.cancelAnimationFrame) {
    window.cancelAnimationFrame(frameId);
    return;
  }
  clearTimeout(frameId);
}
function wirePointerFxDragInertia(el, axis, inertiaEnabled) {
  var dragging = false;
  var lastX = 0;
  var lastY = 0;
  var currentX = 0;
  var currentY = 0;
  var velocityX = 0;
  var velocityY = 0;
  var frameId = null;
  function setDrag(x, y) {
    if (axis === 'x') y = 0;
    if (axis === 'y') x = 0;
    currentX = x;
    currentY = y;
    el.style.setProperty('--opencanvas-drag-x', currentX.toFixed(2) + 'px');
    el.style.setProperty('--opencanvas-drag-y', currentY.toFixed(2) + 'px');
  }
  function stopInertia() {
    cancelPointerFxDragFrame(frameId);
    frameId = null;
  }
  function inertiaFrame() {
    velocityX *= 0.92;
    velocityY *= 0.92;
    if (Math.abs(velocityX) < 0.1 && Math.abs(velocityY) < 0.1) {
      frameId = null;
      return;
    }
    setDrag(currentX + velocityX, currentY + velocityY);
    frameId = schedulePointerFxDragFrame(inertiaFrame);
  }
  el.addEventListener('pointerdown', function (ev) {
    if (!ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    stopInertia();
    dragging = true;
    lastX = ev.clientX;
    lastY = ev.clientY;
    velocityX = 0;
    velocityY = 0;
    el.setAttribute('data-opencanvas-pointer-fx-dragging', 'true');
    if (typeof el.setPointerCapture === 'function' && ev.pointerId !== undefined) {
      el.setPointerCapture(ev.pointerId);
    }
  });
  el.addEventListener('pointermove', function (ev) {
    if (!dragging || !ev) return;
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
    var dx = ev.clientX - lastX;
    var dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    velocityX = axis === 'y' ? 0 : dx;
    velocityY = axis === 'x' ? 0 : dy;
    setDrag(currentX + dx, currentY + dy);
  });
  function endDrag(ev) {
    if (!dragging) return;
    dragging = false;
    el.setAttribute('data-opencanvas-pointer-fx-dragging', 'false');
    if (ev && typeof el.releasePointerCapture === 'function' && ev.pointerId !== undefined) {
      el.releasePointerCapture(ev.pointerId);
    }
    if (inertiaEnabled) {
      stopInertia();
      frameId = schedulePointerFxDragFrame(inertiaFrame);
    }
  }
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
}
function hydratePointerFx(scope, options) {
  var nodes = (scope || document).querySelectorAll('[data-opencanvas-pointer-fx]');
  for (var i = 0; i < nodes.length; i++) {
    (function (el) {
      if (el.getAttribute('data-opencanvas-pfx-hydrated') === 'true') return;
      var primitive = el.getAttribute('data-opencanvas-pointer-fx');
      var reducedMotion = el.getAttribute('data-opencanvas-pointer-fx-reduced-motion');
      var touchActivation = el.getAttribute('data-opencanvas-pointer-fx-touch') || 'none';
      var rawDragAxis = el.getAttribute('data-opencanvas-pointer-fx-drag-axis');
      var rawDragInertia = el.getAttribute('data-opencanvas-pointer-fx-inertia');
      var dragAxis = rawDragAxis || 'both';
      var dragInertia = rawDragInertia === null ? 'true' : rawDragInertia;
      if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
        emitPointerFxFailure(el, 'invalid-reduced-motion', 'Pointer FX reduced-motion mode must be disabled or allow', reducedMotion);
      }
      if (touchActivation !== 'none' && touchActivation !== 'tap' && touchActivation !== 'toggle') {
        emitPointerFxFailure(el, 'invalid-touch-activation', 'Pointer FX touch activation must be none, tap, or toggle', touchActivation);
      }
      if (rawDragAxis !== null && rawDragAxis !== 'x' && rawDragAxis !== 'y' && rawDragAxis !== 'both') {
        emitPointerFxFailure(el, 'invalid-drag-axis', 'Pointer FX drag axis must be x, y, or both', rawDragAxis);
      }
      if (rawDragInertia !== null && rawDragInertia !== 'true' && rawDragInertia !== 'false') {
        emitPointerFxFailure(el, 'invalid-drag-inertia', 'Pointer FX inertia must be true or false', rawDragInertia);
      }
      if (primitive !== 'drag-inertia' && (rawDragAxis !== null || rawDragInertia !== null)) {
        emitPointerFxFailure(el, 'unsupported-drag-relation', 'Pointer FX drag metadata is only supported for drag-inertia', primitive);
      }
      if (primitive === 'drag-inertia' && touchActivation !== 'none') {
        emitPointerFxFailure(el, 'unsupported-drag-touch-relation', 'Pointer FX drag-inertia owns touch directly; touch activation must be none', touchActivation);
      }
      var reduce = pointerFxPrefersReducedMotion(options);
      if (reduce && reducedMotion === 'disabled') {
        el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
        el.setAttribute('data-opencanvas-pointer-fx-reduced', 'disabled');
        return;
      }
      el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
      var imageFollowNode = null;
      if (primitive === 'spotlight') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var px = ((ev.clientX - r.left) / r.width) * 100;
          var py = ((ev.clientY - r.top) / r.height) * 100;
          el.style.setProperty('--opencanvas-ptr-x', px.toFixed(2) + '%');
          el.style.setProperty('--opencanvas-ptr-y', py.toFixed(2) + '%');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-ptr-x', '50%');
          el.style.setProperty('--opencanvas-ptr-y', '50%');
        });
      } else if (primitive === 'reveal-mask') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var px = ((ev.clientX - r.left) / r.width) * 100;
          var py = ((ev.clientY - r.top) / r.height) * 100;
          el.style.setProperty('--opencanvas-reveal-x', px.toFixed(2) + '%');
          el.style.setProperty('--opencanvas-reveal-y', py.toFixed(2) + '%');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-reveal-x', '50%');
          el.style.setProperty('--opencanvas-reveal-y', '50%');
        });
      } else if (primitive === 'tilt') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var nx = (ev.clientX - r.left) / r.width - 0.5;
          var ny = (ev.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--opencanvas-tilt-x', (nx * 12).toFixed(2) + 'deg');
          el.style.setProperty('--opencanvas-tilt-y', (-ny * 12).toFixed(2) + 'deg');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-tilt-x', '0deg');
          el.style.setProperty('--opencanvas-tilt-y', '0deg');
        });
      } else if (primitive === 'magnetic') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var nx = (ev.clientX - r.left) / r.width - 0.5;
          var ny = (ev.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--opencanvas-magnetic-x', (nx * 24).toFixed(2) + 'px');
          el.style.setProperty('--opencanvas-magnetic-y', (ny * 24).toFixed(2) + 'px');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-magnetic-x', '0px');
          el.style.setProperty('--opencanvas-magnetic-y', '0px');
        });
      } else if (primitive === 'cursor-follow') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var nx = (ev.clientX - r.left) / r.width - 0.5;
          var ny = (ev.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--opencanvas-cursor-follow-x', (nx * 96).toFixed(2) + 'px');
          el.style.setProperty('--opencanvas-cursor-follow-y', (ny * 96).toFixed(2) + 'px');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-cursor-follow-x', '0px');
          el.style.setProperty('--opencanvas-cursor-follow-y', '0px');
        });
      } else if (primitive === 'pointer-parallax') {
        el.addEventListener('pointermove', function (ev) {
          var r = el.getBoundingClientRect();
          if (!(r.width > 0) || !(r.height > 0)) return;
          var nx = (ev.clientX - r.left) / r.width - 0.5;
          var ny = (ev.clientY - r.top) / r.height - 0.5;
          el.style.setProperty('--opencanvas-parallax-x', (nx * -18).toFixed(2) + 'px');
          el.style.setProperty('--opencanvas-parallax-y', (ny * -18).toFixed(2) + 'px');
        });
        el.addEventListener('pointerleave', function () {
          el.style.setProperty('--opencanvas-parallax-x', '0px');
          el.style.setProperty('--opencanvas-parallax-y', '0px');
        });
      } else if (primitive === 'cursor-trail') {
        el.addEventListener('pointermove', function (ev) {
          appendPointerTrail(el, ev);
        });
      } else if (primitive === 'image-follow') {
        var img = appendPointerImageFollow(el, el.getAttribute('data-opencanvas-pointer-fx-preview-src'));
        imageFollowNode = img;
        el.addEventListener('pointermove', function (ev) {
          positionPointerImageFollow(el, img, ev);
        });
        el.addEventListener('pointerleave', function () {
          img.setAttribute('data-opencanvas-pointer-image-follow-active', 'false');
        });
      } else if (primitive === 'drag-inertia') {
        wirePointerFxDragInertia(el, dragAxis, dragInertia === 'true');
      } else {
        emitPointerFxFailure(el, 'invalid-primitive', 'Pointer FX primitive must be spotlight, tilt, magnetic, cursor-follow, reveal-mask, pointer-parallax, cursor-trail, image-follow, or drag-inertia', primitive);
      }
      wirePointerFxTouch(el, primitive, touchActivation, imageFollowNode);
    })(nodes[i]);
  }
}
`;
