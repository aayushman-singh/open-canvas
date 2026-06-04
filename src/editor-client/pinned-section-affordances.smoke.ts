// src/editor-client/pinned-section-affordances.smoke.ts
//
// Site-pinned sections (ADR 0059) — header + footer — live as a single
// canonical model node but render one DOM wrapper per page artboard. On a
// 6-page site the same data-opencanvas-element id surfaces on 6 different
// DOM wrappers. Pre-fix code looked up "the wrapper" via
// `document.querySelector('[data-opencanvas-element="..."]')` which
// always returned the FIRST match in document order, so any affordance
// that anchors via getBoundingClientRect (the rich-text toolbar, the
// inline drag handle, the per-element text-color preview mirror,
// alignment preview) landed on page 1 even when the Owner clicked a
// footer text on page 3.
//
// c70240c fixed selection rings (querySelectorAll loops every instance)
// but left the singular-anchor affordances broken. This smoke locks in
// the follow-up:
//
//   1. selection.ts ships a helper `findElementWrapperInArtboardOf` that
//      scopes the id lookup to the artboard ancestor of a context node.
//   2. beginTextEditImpl accepts a `clickedWrapper` parameter and uses it
//      as the contenteditable + mark-toolbar anchor. The canvas-root
//      click handler passes the wrapper it already resolved via
//      resolveElementWrapperAtPoint, so the editor lights up on the
//      clicked page.
//   3. mark-toolbar.ts's edit-time affordances (align mirror, color
//      mirror, drag handle) read `ctx.markToolbarAnchor` — the wrapper
//      captured at beginTextEdit — rather than re-querying by id. No
//      affordance may regress to `querySelector('[data-opencanvas-
//      element=...]')` from inside the edit flow.
//   4. The selection-propagation fix (c70240c) stays intact —
//      selection.ts still uses querySelectorAll for the four
//      add/remove paths on selectedSection / selectedElement so every
//      instance keeps the data-selected ring.

declare const Bun: {
  file(input: URL): {
    text(): Promise<string>;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[pinned-section-affordances:smoke] ${message}`);
}

async function source(name: string): Promise<string> {
  return Bun.file(new URL(name, import.meta.url)).text();
}

// ---- (1) selection.ts exports the artboard-scoped helper --------------

const selection = await source('./selection.ts');
assert(
  /export function findElementWrapperInArtboardOf\s*\(/.test(selection),
  'selection.ts must export findElementWrapperInArtboardOf — the per-artboard wrapper lookup',
);
assert(
  /closest\(\s*['"]\.opencanvas-artboard['"]\s*\)/.test(selection),
  'findElementWrapperInArtboardOf must walk up to the .opencanvas-artboard ancestor to scope the lookup',
);
assert(
  /artboard\.querySelector\(\s*selector\s*\)/.test(selection),
  'findElementWrapperInArtboardOf must run the scoped lookup INSIDE the artboard, not on ctx.root',
);

// Selection-propagation regression (c70240c) must NOT be undone — the
// four add/remove paths still loop on querySelectorAll, otherwise the
// data-selected ring only paints on page 1's instance again.
assert(
  !/ctx\.root\?\.querySelector\(\s*['"]\[data-opencanvas-(section|element)=/.test(selection),
  'selection.ts must NOT regress to singular querySelector for data-opencanvas-section/element — ' +
    'site-pinned sections need querySelectorAll on the four add/remove branches',
);
assert(
  (
    selection.match(
      /ctx\.root\?\.querySelectorAll\(\s*['"]\[data-opencanvas-(section|element)=/g,
    ) || []
  ).length >= 4,
  'selection.ts must keep all four selectSection/selectElement add+remove querySelectorAll branches',
);

// ---- (2) beginTextEditImpl threads the clicked wrapper ----------------

const textEdit = await source('./text-edit.ts');
assert(
  /export function beginTextEditImpl\s*\(\s*ctx:\s*EditorContext,\s*elementId:\s*string,\s*clickedWrapper\?:/.test(
    textEdit,
  ),
  'beginTextEditImpl signature must accept the clickedWrapper parameter so the canvas-root click ' +
    'handler can pin the edit to the clicked-page instance',
);
assert(
  /import \{ findElementWrapperInArtboardOf \} from '\.\/selection\.js';/.test(textEdit),
  'text-edit.ts must import findElementWrapperInArtboardOf so non-click callers still pick a real instance',
);
// The wrapper-resolution must PREFER the clicked wrapper when connected
// AND fall back to the artboard-scoped helper. No regression to a bare
// querySelector('[data-opencanvas-element=...]') on ctx.root.
assert(
  /clickedWrapper\s+&&\s+clickedWrapper\.isConnected/.test(textEdit),
  'beginTextEditImpl must prefer the clicked wrapper (when still connected) over re-querying by id',
);
assert(
  /findElementWrapperInArtboardOf\(\s*ctx,\s*elementId/.test(textEdit),
  'beginTextEditImpl must fall back to findElementWrapperInArtboardOf when no clicked wrapper is given',
);
assert(
  !/ctx\.root\.querySelector\(\s*\n?\s*['"]\[data-opencanvas-element=/.test(textEdit),
  'text-edit.ts must NOT re-resolve the wrapper via ctx.root.querySelector — it would pick the ' +
    'first DOM match and re-introduce the pinned-section anchor bug',
);

// ---- (3) canvas-root-events passes the resolved wrapper ----------------

const canvasRootEvents = await source('./canvas-root-events.ts');
assert(
  /ctx\.beginTextEdit\(\s*id\s*,\s*elementNode\s*\)/.test(canvasRootEvents),
  'canvas-root-events must pass the click-resolved elementNode through ctx.beginTextEdit so the ' +
    'edit anchors to the correct instance for site-pinned sections',
);

// ---- (4) mark-toolbar uses ctx.markToolbarAnchor, not a fresh query ---

const markToolbar = await source('./mark-toolbar.ts');
assert(
  !/ctx\.root\.querySelector\(\s*\n?\s*['"]\[data-opencanvas-element=/.test(markToolbar),
  'mark-toolbar.ts must NOT use ctx.root.querySelector to find the edit wrapper — that returns the ' +
    'first DOM match and the affordances (align mirror, color mirror, drag handle) anchor to page 1 ' +
    'no matter which page the Owner is editing. Use ctx.markToolbarAnchor instead.',
);
// The three load-bearing affordance functions must source the wrapper
// from ctx.markToolbarAnchor (the wrapper buildMarkToolbarImpl captured
// at edit start). Grep for the assignment pattern to lock it in.
const alignWrapperPattern = /function applyAlignToEditing[\s\S]*?const wrapper = ctx\.markToolbarAnchor;/;
assert(
  alignWrapperPattern.test(markToolbar),
  'applyAlignToEditing must read its wrapper from ctx.markToolbarAnchor so the textAlign mirror ' +
    'lands on the edit instance, not page 1',
);
const colorWrapperPattern = /function applyTextColorToEditing[\s\S]*?const wrapper = ctx\.markToolbarAnchor;/;
assert(
  colorWrapperPattern.test(markToolbar),
  'applyTextColorToEditing must read its wrapper from ctx.markToolbarAnchor so the color mirror ' +
    'lands on the edit instance, not page 1',
);
const dragWrapperPattern = /dragBtn\.addEventListener\(\s*['"]mousedown['"][\s\S]*?const wrapper = ctx\.markToolbarAnchor;/;
assert(
  dragWrapperPattern.test(markToolbar),
  'mark-toolbar drag handle mousedown must beginDrag against ctx.markToolbarAnchor so the drag ' +
    'operates on the edit instance, not page 1',
);

// ---- (5) editor-context type carries the new clickedWrapper field ----

const editorCtx = await source('./editor-context.ts');
assert(
  /beginTextEdit\(elementId: string,\s*clickedWrapper\?:\s*HTMLElement \| null\):\s*void;/.test(
    editorCtx,
  ),
  'EditorContext.beginTextEdit signature must declare the optional clickedWrapper parameter so ' +
    'callers outside the canvas-root click handler can still pin to a specific instance',
);

// ---- (6) element-menu close finds the OWNER wrapper, not first ------

const elementMenu = await source('./element-menu.ts');
assert(
  /function findMenuOwnerWrapper\s*\(/.test(elementMenu),
  'element-menu.ts must expose findMenuOwnerWrapper so closeElementMenuImpl picks the wrapper ' +
    'that actually holds the open menu (not the first DOM match by id) — site-pinned sections ' +
    'render one wrapper per artboard and the menu lives on whichever one the 3-dot was clicked',
);
assert(
  /closeElementMenuImpl[\s\S]*?findMenuOwnerWrapper\(\s*ctx\s*,\s*ctx\.openMenuElementId\s*\)/.test(
    elementMenu,
  ),
  'closeElementMenuImpl must consult findMenuOwnerWrapper to scrub the data-menu-open attribute ' +
    'on the correct trigger — otherwise the menu lingers on page-N while the marker clears on page 1',
);
assert(
  !/ctx\.root\.querySelector\(\s*\n?\s*['"]\[data-opencanvas-element="[^"]*"\s*\]\s*\.element-menu/.test(
    elementMenu,
  ),
  'closeElementMenuImpl must NOT use the singular ctx.root.querySelector pattern that picks the ' +
    'first wrapper by id — that breaks for site-pinned sections',
);

// ---- (7) index.ts wires the second argument through ------------------

const indexSource = await source('./index.ts');
assert(
  /beginTextEdit:\s*\(elementId,\s*clickedWrapper\)\s*=>\s*\n?\s*beginTextEditImpl\(ctx,\s*elementId,\s*clickedWrapper\)/.test(
    indexSource,
  ),
  'index.ts must thread the clickedWrapper argument from the ctx.beginTextEdit method into ' +
    'beginTextEditImpl — otherwise the param is type-correct but always undefined at runtime',
);

console.log('[pinned-section-affordances:smoke] OK');
