// src/interactive/build.ts
//
// Build-time assembly of the interactive runtime. Concatenates
// the per-element fragments + the entry point into a single IIFE string ready
// to be inlined into a `<script>` tag by `./inject.ts`.
//
// The assembled IIFE shape:
//
//   (function () {
//     function hydrateAccordion(root) { ... }
//     function hydrateCarousel(root) { ... }
//     function hydrateAll() { ... }
//     if (document.readyState === 'loading') {
//       document.addEventListener('DOMContentLoaded', hydrateAll);
//     } else {
//       hydrateAll();
//     }
//   })();
//
// Source is deliberately UNMINIFIED — the brief budgets ~3KB of terse vanilla
// JS authored by hand, not a minifier output. Inlining keeps the visitor
// payload to a single network fetch (the document itself) and dodges a
// preflight on the script origin.

import { ACCORDION_RUNTIME_SRC } from './accordion.js';
import { CAROUSEL_RUNTIME_SRC } from './carousel.js';
import { POPUP_RUNTIME_SRC } from './popup.js';
import { RUNTIME_ENTRY_SRC } from './runtime.js';

/**
 * The full interactive runtime as an IIFE string. Stable across builds — same
 * input fragments produce byte-identical output, which lets the smoke and any
 * future cache layer hash this once and reuse.
 */
export const INTERACTIVE_RUNTIME_SRC: string = [
  '(function(){',
  ACCORDION_RUNTIME_SRC,
  CAROUSEL_RUNTIME_SRC,
  POPUP_RUNTIME_SRC,
  RUNTIME_ENTRY_SRC,
  '})();',
].join('\n');

/** Size of the runtime IIFE in characters (the source-level proxy for byte size). */
export const INTERACTIVE_RUNTIME_SRC_CHARS: number = INTERACTIVE_RUNTIME_SRC.length;
