// src/editor-client/reel-drag.smoke.ts
//
// Smoke for the film-reel drag-and-drop reorder + insert-button
// suppression. Pins three contracts in one pass:
//
//   1. `moveSectionToIndex` reorders body sections by their index in
//      `page.sections`. With pinned header/footer present the DOM tile
//      array contains 6 nodes (header + 4 body + footer) but the function
//      reads/writes the 4-item body array — the index space is `page.sections`,
//      never DOM tiles. Pre-fix the reel-drag handler queried
//      `[data-reel-section]` (which catches header/footer) and passed a
//      tile-space insertAt into `moveSectionToIndex`, scrambling the
//      order. The fix queries `[data-reel-index]` (body-only) and is
//      witnessed here through the model-mutation invariant.
//
//   2. `setReelDragging(true)` marks the `.reel-body` with
//      `data-dragging="true"` so the CSS rule
//      `.reel-body[data-dragging="true"] .reel-insert-btn { display: none }`
//      hides the "+" buttons during the gesture. `setReelDragging(false)`
//      clears the attribute. The CSS rule itself is verified via a
//      source-string check on the styles bundle (the smoke has no
//      stylesheet engine).
//
//   3. Header and footer pinned slots stay untouched by `moveSectionToIndex`
//      — they live on `state.header` / `state.footer`, not in `page.sections`,
//      so the function physically cannot reach them. The smoke asserts the
//      IDs are unchanged after each reorder.
//
// Run with `bun run reel-drag:smoke`.

import type { CanvasPage, CanvasSection, EditableSite } from '../canvas/schema.js';
import type { EditorContext } from './editor-context.js';
import { moveSectionToIndex } from './reel.js';
import { setReelDragging } from './section-drag.js';
import { canvasEditorStyles } from './styles-build.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[reel-drag:smoke] ${message}`);
}

function sec(id: string, name: string): CanvasSection {
  return { id, recipeId: 'feature-grid', name, height: 640, elements: [] };
}

interface Fixture {
  ctx: EditorContext;
  page: CanvasPage;
  state: EditableSite;
}

function buildFixture(): Fixture {
  const header = sec('header-pinned', 'Header');
  const footer = sec('footer-pinned', 'Footer');
  const body0 = sec('body-0', 'Body 0');
  const body1 = sec('body-1', 'Body 1');
  const body2 = sec('body-2', 'Body 2');
  const body3 = sec('body-3', 'Body 3');

  const page = {
    id: 'page-1',
    slug: 'home',
    title: 'Home',
    width: 1440,
    sections: [body0, body1, body2, body3],
  } as unknown as CanvasPage;

  const state = {
    header,
    footer,
    pages: [page],
  } as unknown as EditableSite;

  const ctx = {
    state,
    currentPage: () => page,
    renderAll: () => {},
    scheduleSave: () => {},
    setStatus: () => {},
  } as unknown as EditorContext;

  return { ctx, page, state };
}

// ---------------------------------------------------------------------------
// Test 1 — reorder moves a body section by `page.sections` index, NOT by DOM
// tile position. Drag body[2] ("body-2") to position 3 (between body[2] and
// body[3]). insertAt=3 in body space ⇒ adjustedTo=2 (toIdx > fromIdx so -1)
// ⇒ section spliced from 2, re-inserted at 2 → array unchanged. The next
// meaningful move is insertAt=4 (after body[3]); that puts body-2 at the
// end. We exercise BOTH branches.

{
  const fix = buildFixture();
  // Drag body-2 (idx 2) to insertAt=4 (after body-3). Expectation: order
  // becomes [body-0, body-1, body-3, body-2].
  moveSectionToIndex(fix.ctx, 2, 4);
  const ids = fix.page.sections.map((s) => s.id);
  assert(
    ids.join(',') === 'body-0,body-1,body-3,body-2',
    `expected body-2 to land at end, got ${ids.join(',')}`,
  );
  // Header + footer pinned slots are not in page.sections — verify the
  // state-level pins are still where we left them.
  assert(fix.state.header?.id === 'header-pinned', 'header pin must survive reorder');
  assert(fix.state.footer?.id === 'footer-pinned', 'footer pin must survive reorder');
}

// ---------------------------------------------------------------------------
// Test 2 — drag from body[0] to insertAt=2 (between body[1] and body[2]).
// Pre-fix, the live handler computed `insertAt` against `[data-reel-section]`
// which INCLUDES the header tile. With the header pinned at DOM tile index 0,
// the user's "between body[1] and body[2]" pointer position maps to tile
// index 3, so the handler called `moveSectionToIndex(0, 3)` — moving body-0
// past body-2 instead of just past body-1. The fix's `[data-reel-index]`
// query yields `insertAt=2` in body space, producing the user's intent.
//
// Here we drive `moveSectionToIndex` with the BODY-SPACE insertAt the fixed
// query produces, and assert the result matches user intent:
// [body-1, body-0, body-2, body-3].

{
  const fix = buildFixture();
  moveSectionToIndex(fix.ctx, 0, 2);
  const ids = fix.page.sections.map((s) => s.id);
  assert(
    ids.join(',') === 'body-1,body-0,body-2,body-3',
    `expected body-0 to land between body-1 and body-2, got ${ids.join(',')}`,
  );
}

// ---------------------------------------------------------------------------
// Test 3 — no-op guards. Dropping back into the same slot, the slot right
// after, or off-array indices leaves the order untouched and skips the
// renderAll/scheduleSave path. This guards against spurious autosave traffic
// when the user drags and releases without crossing a tile boundary.

{
  const fix = buildFixture();
  const before = fix.page.sections.map((s) => s.id).join(',');
  moveSectionToIndex(fix.ctx, 1, 1); // same position
  moveSectionToIndex(fix.ctx, 1, 2); // fromIdx+1 — semantically same slot
  moveSectionToIndex(fix.ctx, -1, 0); // off-array
  moveSectionToIndex(fix.ctx, 99, 0); // off-array
  const after = fix.page.sections.map((s) => s.id).join(',');
  assert(before === after, `no-op moves must leave order untouched: ${before} → ${after}`);
}

// ---------------------------------------------------------------------------
// Test 4 — `setReelDragging` mark/clear cycle. With a stub document that
// resolves `#canvas-reel` to a node carrying a `.reel-body` child, calling
// `setReelDragging(true)` MUST set `data-dragging="true"` on the body and
// `setReelDragging(false)` MUST remove it. Pre-fix the helper did not
// exist; the reel-insert-btn was permanently visible during drag.

{
  interface StubAttrs {
    attrs: Map<string, string>;
    setAttribute(name: string, value: string): void;
    removeAttribute(name: string): void;
    getAttribute(name: string): string | null;
    hidden: boolean;
    querySelector(_sel: string): StubAttrs | null;
  }

  function makeStub(): StubAttrs {
    const attrs = new Map<string, string>();
    return {
      attrs,
      hidden: false,
      setAttribute(name: string, value: string): void { attrs.set(name, value); },
      removeAttribute(name: string): void { attrs.delete(name); },
      getAttribute(name: string): string | null { return attrs.has(name) ? attrs.get(name)! : null; },
      querySelector(_sel: string): StubAttrs | null { return null; },
    };
  }

  const reelEl = makeStub();
  const bodyEl = makeStub();
  reelEl.querySelector = (sel: string) => (sel === '.reel-body' ? bodyEl : null);

  const g = globalThis as unknown as { document: { getElementById: (id: string) => StubAttrs | null } };
  const prev = g.document;
  g.document = {
    getElementById(id: string): StubAttrs | null {
      return id === 'canvas-reel' ? reelEl : null;
    },
  };

  try {
    setReelDragging(true);
    assert(
      bodyEl.getAttribute('data-dragging') === 'true',
      'setReelDragging(true) must mark .reel-body with data-dragging="true"',
    );

    setReelDragging(false);
    assert(
      bodyEl.getAttribute('data-dragging') === null,
      'setReelDragging(false) must clear the data-dragging attribute',
    );

    // Defensive — when no reel exists in the DOM the helper is a no-op
    // (boot-time or post-close states must not throw).
    g.document = { getElementById: (_id: string) => null };
    setReelDragging(true);
    setReelDragging(false);
  } finally {
    g.document = prev;
  }
}

// ---------------------------------------------------------------------------
// Test 5 — CSS contract. The stylesheet bundle MUST carry the
// `.reel-body[data-dragging="true"] .reel-insert-btn { display: none }`
// rule. The smoke can't run a stylesheet engine, so we pin the literal
// selector + declaration on the bundled style string — this is the
// source-of-truth for both the editor build and the inline canvas-client.
{
  const css = canvasEditorStyles;
  assert(
    css.includes('.reel-body[data-dragging="true"] .reel-insert-btn'),
    'styles bundle must carry the drag-hide selector for .reel-insert-btn',
  );
  // The display: none lives in the same rule block — verify by slicing
  // from the selector to the next closing brace and asserting the
  // declaration is inside.
  const start = css.indexOf('.reel-body[data-dragging="true"] .reel-insert-btn');
  const end = css.indexOf('}', start);
  assert(start > 0 && end > start, 'selector block must be findable in the styles bundle');
  const block = css.slice(start, end + 1);
  assert(
    block.includes('display: none') || block.includes('display:none'),
    `drag-hide rule must declare display:none — got block: ${block}`,
  );
}

console.log('[reel-drag:smoke] OK');
