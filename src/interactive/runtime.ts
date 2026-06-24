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

import {
  RUNTIME_HYDRATOR_SURFACES,
  type RuntimeHydratorSurfaceId,
} from './runtime-hydrator-surfaces.js';

function requireSurface(id: RuntimeHydratorSurfaceId): string {
  const surface = RUNTIME_HYDRATOR_SURFACES.find((s) => s.id === id);
  if (!surface) {
    throw new Error(
      `[runtime.ts] Required hydration surface "${id}" is missing from RUNTIME_HYDRATOR_SURFACES manifest.`,
    );
  }
  return surface.visitorCall;
}

const interactives = RUNTIME_HYDRATOR_SURFACES.filter((s) => s.id.startsWith('interactive:'));
const nonInteractives = RUNTIME_HYDRATOR_SURFACES.filter(
  (s) => !s.id.startsWith('interactive:') && s.id !== 'document:pointer-fx',
);

const visitorInteractiveDispatch = interactives
  .map((s, idx) => {
    const kind = s.id.replace('interactive:', '');
    const cond = idx === 0 ? 'if' : 'else if';
    return `    ${cond} (kind === '${kind}') {
      ${s.visitorCall};
    }`;
  })
  .join('\n');

const visitorNonInteractiveDispatch = nonInteractives
  .map((s) => {
    return `  ${s.visitorCall};`;
  })
  .join('\n');

export const RUNTIME_ENTRY_SRC = `
function readRuntimeOptions(baseOptions) {
  var winOptions = typeof window !== 'undefined' && window.__opencanvasRuntimeOptions && typeof window.__opencanvasRuntimeOptions === 'object'
    ? window.__opencanvasRuntimeOptions
    : null;
  if (!winOptions) return baseOptions || {};
  var merged = {};
  var sourceBase = baseOptions || {};
  for (var key in sourceBase) merged[key] = sourceBase[key];
  for (var winKey in winOptions) merged[winKey] = winOptions[winKey];
  return merged;
}
function hydratePremiumInteractions(scope, options) {
  var root = scope || document;
  ${requireSurface('document:pointer-fx')};
  if (typeof window === 'undefined') return;
  if (typeof hydrateOverlays === 'function') hydrateOverlays(root, options || {});
  if (typeof hydrateLoadExperience === 'function') hydrateLoadExperience(root, options || {});
  if (typeof hydrateRouteTransition === 'function') hydrateRouteTransition(root, options || {});
}
function hydrateAll(scope, options) {
  var rootScope = scope || document;
  var runtimeOptions = readRuntimeOptions(options);
  var roots = rootScope.querySelectorAll('[data-opencanvas-interactive]');
  for (var i = 0; i < roots.length; i++) {
    var root = roots[i];
    if (root.getAttribute('data-opencanvas-hydrated') === 'true') continue;
    root.setAttribute('data-opencanvas-hydrated', 'true');
    var kind = root.getAttribute('data-opencanvas-interactive');
${visitorInteractiveDispatch}
  }
  // ADR 0066 dec 4 — pointer-fx is a document-wide pass keyed on the
  // [data-opencanvas-pointer-fx] attribute, NOT a per-interactive-root dispatch
  // arm (a pointer-fx element need not be an interactive element type). It is
  // idempotent, so running it every hydrateAll (incl. live-publish re-hydrate)
  // is safe.
  hydratePremiumInteractions(rootScope, runtimeOptions);
  hydrateCollectionGalleries(rootScope);
  hydrateEmbedDrillIns(rootScope);
${visitorNonInteractiveDispatch}
}
if (typeof window !== 'undefined') window.__opencanvasHydrate = hydrateAll;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ hydrateAll(document, { reason: 'initial-load' }); });
} else {
  hydrateAll(document, { reason: 'initial-load' });
}
`;
