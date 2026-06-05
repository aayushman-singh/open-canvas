// src/editor-client/collection-add-sidebar.smoke.ts
//
// ADR 0063 dec 9 — pins the Add-panel Components-grid Collection button.
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
//   (4) src/editor-client/index.ts wires clicks on
//       [data-canvas-add-collection] elements to runCollectionScaffoldFlowImpl,
//       avoiding double-binding the existing Pages-tab #canvas-add-collection
//       button by id.
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

// (4) Wiring in index.ts.
const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(
  indexSrc.includes(
    'import {\n  attachCollectionScaffoldButtonImpl,\n  runCollectionScaffoldFlowImpl,\n}',
  ) || indexSrc.includes('runCollectionScaffoldFlowImpl'),
  '(4) index.ts must import runCollectionScaffoldFlowImpl from collection-scaffold',
);
assert(
  indexSrc.includes("document.querySelectorAll('[data-canvas-add-collection]')"),
  '(4) index.ts must querySelectorAll [data-canvas-add-collection] to wire the Components-grid button',
);
assert(
  indexSrc.includes("btn.id !== 'canvas-add-collection'"),
  '(4) index.ts must exclude the Pages-tab #canvas-add-collection button by id to avoid double-binding the existing scaffold-button wiring',
);
assert(
  indexSrc.includes('runCollectionScaffoldFlowImpl(ctx)'),
  '(4) index.ts must call runCollectionScaffoldFlowImpl(ctx) from the new button click handler',
);

console.log('[collection-add-sidebar:smoke] OK');
