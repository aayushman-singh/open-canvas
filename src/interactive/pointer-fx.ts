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
function hydratePointerFx(scope) {
  var nodes = (scope || document).querySelectorAll('[data-opencanvas-pointer-fx]');
  for (var i = 0; i < nodes.length; i++) {
    (function (el) {
      if (el.getAttribute('data-opencanvas-pfx-hydrated') === 'true') return;
      el.setAttribute('data-opencanvas-pfx-hydrated', 'true');
      var primitive = el.getAttribute('data-opencanvas-pointer-fx');
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
      } else {
        // Unknown primitive — fail loud, not silent. The renderer only ever
        // emits known primitives, so this means a malformed snapshot or a drift
        // between the render enum and this runtime; surface it instead of
        // marking the node hydrated-but-inert.
        if (typeof console !== 'undefined' && console.error) {
          console.error('[opencanvas pointer-fx] unknown primitive ' + JSON.stringify(primitive));
        }
      }
    })(nodes[i]);
  }
}
`;
