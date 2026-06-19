// src/interactive/inject.ts
//
// Snapshot-time `<script>` injection. The public route in
// `src/routes/public.ts` calls `injectInteractiveRuntime(html, snapshot)` AFTER
// `renderCanvasSnapshot`; if the snapshot contains at least one accordion or
// carousel element, this function appends an inline `<script>` carrying the
// IIFE runtime. Otherwise the HTML is returned untouched — a snapshot with no
// interactives pays zero runtime bytes.
//
// The scan walks header/footer/page sections plus nested collection entries and
// tab panels, short-circuiting on the first matching `type`. We never
// instantiate the elements; this is a discriminant-only scan.
//
// Integration shape (main thread):
//
//     import { injectInteractiveRuntime } from '../interactive/inject.js';
//     const snapshotHtml = renderCanvasSnapshot(snapshot, '/assets');
//     const finalHtml = injectInteractiveRuntime(snapshotHtml, snapshot);
//     // ... pass finalHtml into the document envelope ...

import { snapshotHasBehaviourPrimitives } from '../canvas/behaviour-payload.js';
import type {
  CanvasElement,
  CanvasSection,
  ElementType,
  PublishedSnapshot,
} from '../canvas/schema.js';
import { formPointerFx } from '../canvas/elements/form.js';
import { INTERACTIVE_RUNTIME_SRC } from './build.js';

/**
 * Element types that require the interactive runtime. Listed inline (rather
 * than derived) so adding a new interactive element in a future wave is an
 * intentional one-line edit here AND in the runtime's dispatch arm.
 */
const INTERACTIVE_ELEMENT_TYPES: ReadonlySet<ElementType> = new Set<ElementType>([
  'accordion',
  'carousel',
]);

/**
 * ADR 0066 dec 5 — does this element opt into a pointer-fx primitive? Pointer-fx
 * is derived from the chosen variant by the renderer, so the injection scan must
 * mirror that derivation: a pointer-fx element needs the runtime even when it is
 * not an "interactive element type" (e.g. a Form with the `spotlight` variant).
 * Centralised so adding a future pointer-fx-bearing variant is one edit.
 */
function elementHasPointerFx(element: CanvasElement): boolean {
  if (element.pointerFx?.enabled === true) return true;
  if (element.type === 'form') return formPointerFx(element.variant ?? 'classic') !== null;
  return false;
}

/**
 * Walk the snapshot's element tree until an interactive type is found.
 * O(elements) worst case, but most snapshots short-circuit on the first match
 * in their first interactive section.
 */
export function snapshotNeedsInteractiveRuntime(snapshot: PublishedSnapshot): boolean {
  if (snapshot.overlays && snapshot.overlays.length > 0) return true;
  if (
    snapshot.loadExperience &&
    'enabled' in snapshot.loadExperience &&
    snapshot.loadExperience.enabled === true
  ) {
    return true;
  }
  if (snapshot.routeTransition?.enabled === true) return true;
  if (snapshotHasBehaviourPrimitives(snapshot)) return true;
  const sectionNeedsRuntime = (section: CanvasSection): boolean => {
    if (section.trigger) return true;
    return section.elements.some(elementNeedsRuntime);
  };
  const elementNeedsRuntime = (element: CanvasElement): boolean => {
    if (INTERACTIVE_ELEMENT_TYPES.has(element.type)) return true;
    if (element.marquee?.enabled === true) return true;
    if (element.type === 'media' && element.mediaKind === 'video' && element.hoverPlayback?.enabled === true) return true;
    if (elementHasPointerFx(element)) return true; // ADR 0066 dec 5
    if (element.type === 'tabs') {
      return element.tabs.some((tab) => tab.elements.some(elementNeedsRuntime));
    }
    if (element.type === 'collection') {
      if (element.gallery?.mode === 'hover-reveal-detail') return true;
      // ADR 0063 dec 6 — `entries` is the materializer's per-entry output;
      // walked so nested interactive elements (e.g. tabs inside a card)
      // still trigger runtime injection.
      return (element.entries ?? []).some((entry) => entry.some(elementNeedsRuntime));
    }
    if (element.type === 'flow-container') {
      return element.items.some((item) => elementNeedsRuntime(item.element));
    }
    return false;
  };
  if (snapshot.header && sectionNeedsRuntime(snapshot.header)) return true;
  if (snapshot.footer && sectionNeedsRuntime(snapshot.footer)) return true;
  for (const page of snapshot.pages) {
    for (const section of page.sections) {
      if (sectionNeedsRuntime(section)) return true;
    }
  }
  return false;
}

/**
 * If the snapshot contains any interactive element, append an inline
 * `<script>` tag carrying the runtime IIFE to the rendered HTML. Otherwise
 * return the HTML unchanged.
 *
 * The script is appended verbatim — no `defer`/`async` (it is inline, so the
 * browser parses + runs it during HTML parsing), no module-level import. The
 * runtime guards its own `DOMContentLoaded` listener, so the script can sit
 * anywhere in the document body and the hydration still fires after the DOM
 * is parsed.
 */
export function injectInteractiveRuntime(
  snapshotHtml: string,
  snapshot: PublishedSnapshot,
): string {
  if (!snapshotNeedsInteractiveRuntime(snapshot)) return snapshotHtml;
  return `${snapshotHtml}<script data-opencanvas-interactive-runtime>${INTERACTIVE_RUNTIME_SRC}</script>`;
}
