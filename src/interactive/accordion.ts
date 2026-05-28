// src/interactive/accordion.ts
//
// Accordion runtime fragment. This module exports a JS source
// string (`ACCORDION_RUNTIME_SRC`) that the snapshot-time bundler in
// `./build.ts` concatenates into the single interactive runtime IIFE.
//
// Why a string and not a directly-imported function? The runtime ships to the
// VISITOR's browser inline in a `<script>` tag — it is never executed in the
// Worker/Bun process. The smoke tests evaluate the same string via
// `new Function('document', SRC)` against a hand-rolled DOM stub, so the
// runtime is single-source-of-truth: same characters in production and test.
//
// Contract (DOM markers emitted by `src/canvas/elements/accordion.ts`):
//   - Outer wrapper: `[data-rev01-interactive="accordion"]`
//                     `[data-rev01-allow-multi-open="true"|"false"]`
//   - Each item:    `[data-rev01-acc-item="<id>"]`
//                     toggled via `data-rev01-acc-open="true"`
//   - Header button: `[data-rev01-acc-toggle="<id>"]` (the `<button>`)
//                     aria-expanded mirrors open state
//   - Body region:  `[data-rev01-acc-body="<id>"]` with `hidden` attr when closed

/**
 * The JS body of the accordion hydration helper. Plain ES2017 — no optional
 * chaining (cheaper bytes), no const-of-iterable to keep IE-safe shape (we
 * never target IE, but terse vanilla JS is the constraint anyway).
 *
 * Exposed as a single function declaration so `build.ts` can wrap the runtime
 * collection in one IIFE. The helper is invoked once per accordion root.
 */
export const ACCORDION_RUNTIME_SRC = String.raw`
function hydrateAccordion(root) {
  var multi = root.getAttribute('data-rev01-allow-multi-open') === 'true';
  function setItemOpen(item, open) {
    if (open) {
      item.setAttribute('data-rev01-acc-open', 'true');
    } else {
      item.removeAttribute('data-rev01-acc-open');
    }
    var toggles = item.querySelectorAll('[data-rev01-acc-toggle]');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    var bodies = item.querySelectorAll('[data-rev01-acc-body]');
    for (var j = 0; j < bodies.length; j++) {
      if (open) {
        bodies[j].removeAttribute('hidden');
      } else {
        bodies[j].setAttribute('hidden', '');
      }
    }
  }
  function toggleItem(item) {
    var currentlyOpen = item.getAttribute('data-rev01-acc-open') === 'true';
    var willOpen = !currentlyOpen;
    if (willOpen && !multi) {
      var siblings = root.querySelectorAll('[data-rev01-acc-item]');
      for (var i = 0; i < siblings.length; i++) {
        if (siblings[i] !== item) {
          setItemOpen(siblings[i], false);
        }
      }
    }
    setItemOpen(item, willOpen);
  }
  var toggles = root.querySelectorAll('[data-rev01-acc-toggle]');
  for (var k = 0; k < toggles.length; k++) {
    (function (toggle) {
      var item = toggle.closest('[data-rev01-acc-item]');
      if (!item) return;
      toggle.addEventListener('click', function (event) {
        event.preventDefault();
        toggleItem(item);
      });
      toggle.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
          event.preventDefault();
          toggleItem(item);
        }
      });
    })(toggles[k]);
  }
}
`;
