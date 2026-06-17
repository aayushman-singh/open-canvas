// src/interactive/runtime.ts
//
// Top-level interactive runtime. Exports the entry-point JS
// source string that the snapshot-time bundler in `./build.ts` wraps in an
// IIFE alongside the per-element hydration fragments.
//
// The entry-point delegates to `hydrateAccordion` / `hydrateCarousel` (defined
// in the sibling fragments) on every `[data-opencanvas-interactive]` root. The
// dispatch is by the attribute VALUE so adding a third interactive element
// in a future wave costs one `case` arm here + one new fragment file.
//
// DOMContentLoaded guard: the script tag is appended at end-of-body by the
// inject step, but we still wait for DOMContentLoaded so consumers that
// rewrite the document on the fly (live-publish broadcast in
// `src/routes/public.ts`) re-hydrate cleanly.

export const RUNTIME_ENTRY_SRC = String.raw`
function hydrateAll() {
  var roots = document.querySelectorAll('[data-opencanvas-interactive]');
  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    if (root.getAttribute('data-opencanvas-hydrated') === 'true') continue;
    root.setAttribute('data-opencanvas-hydrated', 'true');
    var kind = root.getAttribute('data-opencanvas-interactive');
    if (kind === 'accordion') {
      hydrateAccordion(root);
    } else if (kind === 'carousel') {
      hydrateCarousel(root);
    }
  }
  // ADR 0066 dec 4 — pointer-fx is a document-wide pass keyed on the
  // [data-opencanvas-pointer-fx] attribute, NOT a per-interactive-root dispatch
  // arm (a pointer-fx element need not be an interactive element type). It is
  // idempotent, so running it every hydrateAll (incl. live-publish re-hydrate)
  // is safe.
  hydratePointerFx(document);
  hydrateBehaviour(document);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hydrateAll);
} else {
  hydrateAll();
}
`;
