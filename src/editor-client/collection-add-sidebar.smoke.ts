// src/editor-client/collection-add-sidebar.smoke.ts
//
// Regression guard: the duplicate "Collection" tile that used to sit
// inside the Add-panel Components grid (alongside Text / Image / Video / …)
// is gone. Collection creation is reached via the standalone
// "+ New Collection" button in the dedicated Collections group, which sits
// above the Components grid. The two-entry-points UX was confusing.
//
// Coverage:
//   (1) src/editor/route.tsx contains NO <button class="opencanvas-sidebar-command"
//       data-canvas-add-collection> — i.e. no duplicate tile in the
//       Components grid.
//   (2) The standalone "+ New Collection" button is still rendered with
//       class="opencanvas-sidebar-action" and data-canvas-add-collection,
//       and its label reads "+ New Collection".
//   (3) The Collections group sits ABOVE the Components grid (visual
//       precedence reflects the "promoted, not buried" decision).
//   (4) src/editor-client/index.ts still wires
//       [data-canvas-add-collection] clicks to runCollectionScaffoldFlowImpl
//       so the surviving standalone button still works.
//
// Run with `bun run collection-add-sidebar:smoke`.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-add-sidebar:smoke] ' + message);
}

const routeSrc = await Bun.file(new URL('../editor/route.tsx', import.meta.url)).text();

// (1) Tile absent — no sidebar-command-class button carries data-canvas-add-collection.
const tileForward =
  /<button[^>]*\bclass="opencanvas-sidebar-command"[^>]*\bdata-canvas-add-collection\b/;
const tileReverse =
  /<button[^>]*\bdata-canvas-add-collection\b[^>]*\bclass="opencanvas-sidebar-command"/;
assert(
  !tileForward.test(routeSrc) && !tileReverse.test(routeSrc),
  '(1) duplicate <button class="opencanvas-sidebar-command" data-canvas-add-collection> tile must NOT exist — it was removed in favor of the standalone Collections group',
);

// (2) Standalone button present with sidebar-action class + "+ New Collection" label.
const actionForward =
  /<button[^>]*\bclass="opencanvas-sidebar-action"[^>]*\bdata-canvas-add-collection\b[^>]*>([\s\S]*?)<\/button>/;
const actionReverse =
  /<button[^>]*\bdata-canvas-add-collection\b[^>]*\bclass="opencanvas-sidebar-action"[^>]*>([\s\S]*?)<\/button>/;
const actionMatch = routeSrc.match(actionForward) ?? routeSrc.match(actionReverse);
assert(
  actionMatch !== null,
  '(2) standalone <button class="opencanvas-sidebar-action" data-canvas-add-collection> must still exist',
);
const actionLabel = actionMatch[1]!.trim();
assert(
  actionLabel === '+ New Collection',
  '(2) standalone button label must read "+ New Collection" (got: ' + JSON.stringify(actionLabel) + ')',
);

// (3) Collections group sits above the Components grid.
const collectionsHeader = routeSrc.indexOf('<h2>Collections</h2>');
const componentsHeader = routeSrc.indexOf('<h2>Components</h2>');
assert(collectionsHeader > 0, '(3) <h2>Collections</h2> marker must exist');
assert(componentsHeader > 0, '(3) <h2>Components</h2> marker must exist');
assert(
  collectionsHeader < componentsHeader,
  '(3) Collections group must precede Components grid in markup order',
);

// (4) Wiring in index.ts — surviving standalone button still calls the scaffold flow.
const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(
  indexSrc.includes('runCollectionScaffoldFlowImpl'),
  '(4) index.ts must import + call runCollectionScaffoldFlowImpl so the standalone button still works',
);
assert(
  indexSrc.includes("document.querySelectorAll('[data-canvas-add-collection]')"),
  '(4) index.ts must querySelectorAll [data-canvas-add-collection] to wire the standalone button',
);

console.log('[collection-add-sidebar:smoke] OK');
