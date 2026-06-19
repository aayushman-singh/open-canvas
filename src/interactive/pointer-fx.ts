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
function hydratePointerFx(scope, options) {
  var nodes = (scope || document).querySelectorAll('[data-opencanvas-pointer-fx]');
  for (var i = 0; i < nodes.length; i++) {
    (function (el) {
      if (el.getAttribute('data-opencanvas-pfx-hydrated') === 'true') return;
      var primitive = el.getAttribute('data-opencanvas-pointer-fx');
      var reducedMotion = el.getAttribute('data-opencanvas-pointer-fx-reduced-motion');
      if (reducedMotion !== 'disabled' && reducedMotion !== 'allow') {
        emitPointerFxFailure(el, 'invalid-reduced-motion', 'Pointer FX reduced-motion mode must be disabled or allow', reducedMotion);
      }
      var reduce = pointerFxPrefersReducedMotion(options);
      if (reduce && reducedMotion === 'disabled') {
        el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
        el.setAttribute('data-opencanvas-pointer-fx-reduced', 'disabled');
        return;
      }
      el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
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
      } else {
        emitPointerFxFailure(el, 'invalid-primitive', 'Pointer FX primitive must be spotlight, tilt, magnetic, cursor-follow, or reveal-mask', primitive);
      }
    })(nodes[i]);
  }
}
`;
