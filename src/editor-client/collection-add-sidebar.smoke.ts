// src/editor-client/collection-add-sidebar.smoke.ts
//
// ADR 0063 dec 9 / dec 11 — pins the Add-panel Components-grid Collection
// button + asserts the Pages-tab "+ New Collection" entry point has been
// removed (creating a Collection now goes through the "+ New Page"
// modal's kind selector — see page-crud.ts createPageImpl).
//
// Coverage:
//   (1) src/editor/route.tsx renders a button carrying the
//       data-canvas-add-collection attribute AND the
//       opencanvas-sidebar-command class so it inherits the standard
//       sidebar-tile treatment.
//   (2) The button is rendered inside the Components grid section
//       (i.e. after the "Components" h2 but before the "Colors"
//       section), matching ADR placement.
//   (3) The button label reads exactly "Collection".
//   (4) src/editor-client/index.ts wires every [data-canvas-add-collection]
//       element to runCollectionScaffoldFlowImpl via
//       attachCollectionScaffoldButtonImpl — no second wiring loop with
//       an id-based exclusion, because the Pages-tab `#canvas-add-collection`
//       has been removed.
//   (5) src/editor/route.tsx no longer renders a `#canvas-add-collection`
//       button (Pages-tab collection entry point has moved into the
//       new-page modal's kind selector).
//   (6) src/editor-client/modals.ts exposes the kind selector
//       (radiogroup) inside the new-page modal so the Owner can pick
//       Regular vs. Collection at creation time.
//
// Run with `bun run collection-add-sidebar:smoke`.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-add-sidebar:smoke] ' + message);
}

const routeSrc = await Bun.file(new URL('../editor/route.tsx', import.meta.url)).text();

// (1) data-canvas-add-collection + opencanvas-sidebar-command class.
const buttonRegex =
  /<button[^>]*\bclass="opencanvas-sidebar-command"[^>]*\bdata-canvas-add-collection\b[^>]*>([\s\S]*?)<\/button>/;
const altRegex =
  /<button[^>]*\bdata-canvas-add-collection\b[^>]*\bclass="opencanvas-sidebar-command"[^>]*>([\s\S]*?)<\/button>/;
const match = routeSrc.match(buttonRegex) ?? routeSrc.match(altRegex);
assert(
  match !== null,
  '(1) route.tsx must render a <button class="opencanvas-sidebar-command" data-canvas-add-collection>',
);

// (3) Label is exactly "Collection" (trimmed).
const label = match[1]!.trim();
assert(
  label === 'Collection',
  '(3) button label must be exactly "Collection" (got: ' + JSON.stringify(label) + ')',
);

// (2) The button lives inside the Components section. Other panels (the
// Pages tab "+ New Collection" and the Add-panel "Collections" group) also
// carry data-canvas-add-collection — we want the position of the
// Components-grid button specifically, which the regex already pinpoints.
const componentsHeader = routeSrc.indexOf('<h2>Components</h2>');
const colorsHeader = routeSrc.indexOf('<h2>Colors</h2>');
const buttonStart = match.index;
assert(componentsHeader > 0, '(2) <h2>Components</h2> marker must exist');
assert(colorsHeader > componentsHeader, '(2) <h2>Colors</h2> must follow Components');
assert(
  buttonStart !== undefined && buttonStart > componentsHeader && buttonStart < colorsHeader,
  '(2) Collection button must live inside the Components grid section (between Components and Colors headers)',
);

// (4) Wiring in index.ts — single attachCollectionScaffoldButtonImpl call
// handles every [data-canvas-add-collection] element (the standalone
// "+ New Collection" tile in the Add tab's Collections group plus this
// Components-grid "Collection" tile). The previous id-exclusion loop is
// gone because the Pages-tab `#canvas-add-collection` button it was
// excluding has been deleted.
const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(
  indexSrc.includes('attachCollectionScaffoldButtonImpl'),
  '(4) index.ts must import attachCollectionScaffoldButtonImpl from collection-scaffold',
);
assert(
  indexSrc.includes('attachCollectionScaffoldButtonImpl(ctx)'),
  '(4) index.ts must call attachCollectionScaffoldButtonImpl(ctx) to wire every [data-canvas-add-collection] element',
);
assert(
  !indexSrc.includes("btn.id !== 'canvas-add-collection'"),
  '(4) index.ts must NOT carry the legacy id-exclusion loop — the Pages-tab #canvas-add-collection button has been removed',
);

// (5) Pages-tab "+ New Collection" button has been removed.
assert(
  !routeSrc.includes('id="canvas-add-collection"'),
  '(5) route.tsx must NOT render a #canvas-add-collection button — Collection creation moved into the new-page modal kind selector',
);
// The Pages tab still has its "+ New Page" button (otherwise we'd have
// removed BOTH entry points — sanity-check the surviving one).
assert(
  routeSrc.includes('id="canvas-add-page"'),
  '(5) route.tsx must still render the #canvas-add-page button (the surviving Pages-tab create entry point)',
);

// (6) modals.ts exposes the kind selector inside the new-page modal.
const modalsSrc = await Bun.file(new URL('./modals.ts', import.meta.url)).text();
assert(
  modalsSrc.includes("kindRegular") && modalsSrc.includes("kindCollection"),
  '(6) modals.ts must define kindRegular + kindCollection buttons for the new-page kind selector',
);
assert(
  modalsSrc.includes("'Regular page'") && modalsSrc.includes("'Collection'"),
  '(6) modals.ts must label the kind options "Regular page" + "Collection"',
);
assert(
  modalsSrc.includes("kind: 'collection'") && modalsSrc.includes("kind: 'regular'"),
  '(6) modals.ts must emit kind: regular | collection in the NewPageModalResult close calls',
);

console.log('[collection-add-sidebar:smoke] OK');
