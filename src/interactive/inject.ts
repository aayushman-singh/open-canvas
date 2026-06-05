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

import type {
  CanvasElement,
  CanvasSection,
  ElementType,
  PublishedSnapshot,
} from '../canvas/schema.js';
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
 * Walk the snapshot's element tree until an interactive type is found.
 * O(elements) worst case, but most snapshots short-circuit on the first match
 * in their first interactive section.
 */
export function snapshotNeedsInteractiveRuntime(snapshot: PublishedSnapshot): boolean {
  const sectionNeedsRuntime = (section: CanvasSection): boolean => {
    if (section.trigger) return true;
    return section.elements.some(elementNeedsRuntime);
  };
  const elementNeedsRuntime = (element: CanvasElement): boolean => {
    if (INTERACTIVE_ELEMENT_TYPES.has(element.type)) return true;
    if (element.type === 'tabs') {
      return element.tabs.some((tab) => tab.elements.some(elementNeedsRuntime));
    }
    if (element.type === 'collection') {
      // ADR 0063 — legacy CollectionElement child arrays are optional during
      // the transition; check what's present, skip what's absent.
      if ((element.entryTemplate ?? []).some(elementNeedsRuntime)) return true;
      if ((element.entries ?? []).some((entry) => entry.some(elementNeedsRuntime))) return true;
      return element.cardTemplate?.some(elementNeedsRuntime) === true;
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
