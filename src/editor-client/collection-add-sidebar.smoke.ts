// src/editor-client/collection-add-sidebar.smoke.ts
//
// Combined regression guard covering two related cleanups that
// converged in the 2026-06-07 UI/UX integration pass:
//
//   * refactor/pages-tab-collection-into-new-page-modal (#15) moved the
//     Pages-tab "+ New Collection" entry into the "+ New Page" modal as
//     a Regular / Collection kind selector. The id="canvas-add-collection"
//     button is gone; the surviving Pages-tab create button is "+ New Page".
//   * chore/editor-remove-duplicate-collection-tile (#16) removed the
//     duplicate Collection tile from the Add-panel Components grid.
//     Collection creation now goes through the standalone
//     "+ New Collection" button in the dedicated Collections group, which
//     sits above the Components grid.
//
// Coverage:
//   (1) Pages-tab `id="canvas-add-collection"` button is absent. (#15)
//   (2) Components-grid `<button class="opencanvas-sidebar-command"
//       data-canvas-add-collection>` tile is absent. (#16)
//   (3) Standalone `<button class="opencanvas-sidebar-action"
//       data-canvas-add-collection>+ New Collection</button>` is present.
//   (4) Collections group sits ABOVE Components group in markup order. (#16)
//   (5) `+ New Page` button (`id="canvas-add-page"`) still rendered on
//       the Pages tab — the surviving Pages-tab create entry point. (#15)
//   (6) `src/editor-client/index.ts` wires every [data-canvas-add-collection]
//       click via `attachCollectionScaffoldButtonImpl(ctx)`. The previous
//       id-exclusion loop is gone because the Pages-tab
//       `#canvas-add-collection` button it was excluding has been deleted. (#15)
//   (7) `src/editor-client/modals.ts` exposes the kind selector
//       (radiogroup) inside the new-page modal — `kindRegular` +
//       `kindCollection` buttons, labels "Regular page" + "Collection",
//       and a `kind: 'regular' | 'collection'` discriminator emitted on
//       the NewPageModalResult close calls. (#15)
//
// Run with `bun run collection-add-sidebar:smoke`.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-add-sidebar:smoke] ' + message);
}

const routeSrc = await Bun.file(new URL('../editor/route.tsx', import.meta.url)).text();

// (1) Pages-tab "+ New Collection" button (#canvas-add-collection) removed.
assert(
  !routeSrc.includes('id="canvas-add-collection"'),
  '(1) route.tsx must NOT render a #canvas-add-collection button — Collection creation moved into the new-page modal kind selector',
);

// (2) Components-grid duplicate tile absent — no sidebar-command-class
//     button carries data-canvas-add-collection.
const tileForward =
  /<button[^>]*\bclass="opencanvas-sidebar-command"[^>]*\bdata-canvas-add-collection\b/;
const tileReverse =
  /<button[^>]*\bdata-canvas-add-collection\b[^>]*\bclass="opencanvas-sidebar-command"/;
assert(
  !tileForward.test(routeSrc) && !tileReverse.test(routeSrc),
  '(2) duplicate <button class="opencanvas-sidebar-command" data-canvas-add-collection> tile must NOT exist — it was removed in favor of the standalone Collections group',
);

// (3) Standalone button present with sidebar-action class + "+ New Collection" label.
const actionForward =
  /<button[^>]*\bclass="opencanvas-sidebar-action"[^>]*\bdata-canvas-add-collection\b[^>]*>([\s\S]*?)<\/button>/;
const actionReverse =
  /<button[^>]*\bdata-canvas-add-collection\b[^>]*\bclass="opencanvas-sidebar-action"[^>]*>([\s\S]*?)<\/button>/;
const actionMatch = routeSrc.match(actionForward) ?? routeSrc.match(actionReverse);
assert(
  actionMatch !== null,
  '(3) standalone <button class="opencanvas-sidebar-action" data-canvas-add-collection> must still exist',
);
const actionLabel = actionMatch[1]!.trim();
assert(
  actionLabel === '+ New Collection',
  '(3) standalone button label must read "+ New Collection" (got: ' + JSON.stringify(actionLabel) + ')',
);

// (4) Collections group sits above the Components grid.
const collectionsHeader = routeSrc.indexOf('<h2>Collections</h2>');
const componentsHeader = routeSrc.indexOf('<h2>Components</h2>');
assert(collectionsHeader > 0, '(4) <h2>Collections</h2> marker must exist');
assert(componentsHeader > 0, '(4) <h2>Components</h2> marker must exist');
assert(
  collectionsHeader < componentsHeader,
  '(4) Collections group must precede Components grid in markup order',
);

// (5) Pages tab still has its "+ New Page" button — the surviving create entry point.
assert(
  routeSrc.includes('id="canvas-add-page"'),
  '(5) route.tsx must still render the #canvas-add-page button (the surviving Pages-tab create entry point)',
);

// (6) Wiring in index.ts — single attachCollectionScaffoldButtonImpl call
// handles every [data-canvas-add-collection] element. The previous
// id-exclusion loop is gone because the Pages-tab `#canvas-add-collection`
// button it was excluding has been deleted.
const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(
  indexSrc.includes('attachCollectionScaffoldButtonImpl'),
  '(6) index.ts must import attachCollectionScaffoldButtonImpl from collection-scaffold',
);
assert(
  indexSrc.includes('attachCollectionScaffoldButtonImpl(ctx)'),
  '(6) index.ts must call attachCollectionScaffoldButtonImpl(ctx) to wire every [data-canvas-add-collection] element',
);
assert(
  !indexSrc.includes("btn.id !== 'canvas-add-collection'"),
  '(6) index.ts must NOT carry the legacy id-exclusion loop — the Pages-tab #canvas-add-collection button has been removed',
);

// (7) modals.ts exposes the kind selector inside the new-page modal.
const modalsSrc = await Bun.file(new URL('./modals.ts', import.meta.url)).text();
assert(
  modalsSrc.includes('kindRegular') && modalsSrc.includes('kindCollection'),
  '(7) modals.ts must define kindRegular + kindCollection buttons for the new-page kind selector',
);
assert(
  modalsSrc.includes("'Regular page'") && modalsSrc.includes("'Collection'"),
  '(7) modals.ts must label the kind options "Regular page" + "Collection"',
);
assert(
  modalsSrc.includes("kind: 'collection'") && modalsSrc.includes("kind: 'regular'"),
  '(7) modals.ts must emit kind: regular | collection in the NewPageModalResult close calls',
);

console.log('[collection-add-sidebar:smoke] OK');
