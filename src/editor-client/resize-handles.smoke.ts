// src/editor-client/resize-handles.smoke.ts
//
// Regression smoke for the resize-handles emission contract.
//
// Bug: prior to this commit, `buildElementNodeImpl` (element-menu.ts)
// appended 8 resize-handle divs to EVERY element wrapper unconditionally,
// and the editor stylesheet hid them via
//   `.opencanvas-element[data-selected="true"] .resize-handle { display: block; }`
// The descendant combinator surfaced every nested child's handles too —
// selecting a container element revealed the cumulative quad on every
// element inside it. Live repro on 2026-06-04 measured 2112 handles in
// the DOM (264 nested elements × 8 handles each) with only one element
// flagged data-selected.
//
// Fix: emit resize handles ONLY into the selected element's wrapper.
// `mountResizeHandles` / `unmountResizeHandles` (element-menu.ts) manage
// the handle quad; `selectElement` (selection.ts) calls them on every
// selection transition; `buildElementNodeImpl` mounts at build time when
// the element being built is already the selected one (renderAll /
// rebuildElement code paths).
//
// This smoke runs three checks:
//   1. Source-level: `buildElementNodeImpl` must only call
//      `mountResizeHandles` inside the `selectedElementId === element.id`
//      guard, and `selectElement` must mount/unmount on selection change.
//   2. DOM-level: against a minimal element stub, mounting+unmounting
//      idempotently leaves exactly 0 or 8 handles on the wrapper.
//   3. End-to-end count: simulate the bug's three-element repro and
//      assert handle count stays at exactly 8 after a single select, 0
//      after deselect.
//
// Wired into ci:smoke (package.json: resize-handles:smoke).

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[resize-handles:smoke] ${message}`);
}

// ---- 1. Source-level guards --------------------------------------------

const elementMenuSrc = await Bun.file(new URL('./element-menu.ts', import.meta.url)).text();

assert(
  elementMenuSrc.includes('export function mountResizeHandles(wrapper: HTMLElement): void {'),
  'element-menu.ts must export mountResizeHandles(wrapper)',
);
assert(
  elementMenuSrc.includes('export function unmountResizeHandles(wrapper: HTMLElement): void {'),
  'element-menu.ts must export unmountResizeHandles(wrapper)',
);

// buildElementNodeImpl must gate handle emission on selection. Find the
// function body and assert the only mountResizeHandles call inside it sits
// behind the selection-id guard. We slice from the function signature to
// the next `export function ` keyword (rebuildElementImpl).
const buildStart = elementMenuSrc.indexOf('export function buildElementNodeImpl(');
assert(buildStart >= 0, 'buildElementNodeImpl signature not found in element-menu.ts');
const rebuildStart = elementMenuSrc.indexOf('export function rebuildElementImpl(', buildStart);
assert(rebuildStart > buildStart, 'rebuildElementImpl signature must follow buildElementNodeImpl');
const buildBody = elementMenuSrc.slice(buildStart, rebuildStart);

const mountCallIndex = buildBody.indexOf('mountResizeHandles(wrapper)');
assert(
  mountCallIndex >= 0,
  'buildElementNodeImpl must call mountResizeHandles(wrapper) for the selected element',
);

// The mount call must be inside an `if (ctx.selectedElementId === element.id)` block.
// The simplest source-level check: the guard precedes the call within the body.
const guardIndex = buildBody.indexOf('if (ctx.selectedElementId === element.id) {');
assert(
  guardIndex >= 0 && guardIndex < mountCallIndex,
  'buildElementNodeImpl must guard the mountResizeHandles call behind ctx.selectedElementId === element.id',
);

// The pre-fix unconditional 8-direction loop must be gone.
assert(
  !buildBody.includes("const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']"),
  'buildElementNodeImpl must not declare an unconditional 8-direction loop — handles live in mountResizeHandles only',
);
assert(
  !buildBody.includes(".setAttribute('data-resize-handle', 'true')"),
  'buildElementNodeImpl must not append handles directly — that lives in mountResizeHandles',
);

const selectionSrc = await Bun.file(new URL('./selection.ts', import.meta.url)).text();

assert(
  selectionSrc.includes(
    "import { mountResizeHandles, unmountResizeHandles } from './element-menu.js';",
  ),
  'selection.ts must import mountResizeHandles + unmountResizeHandles from element-menu.js',
);
assert(
  selectionSrc.includes('unmountResizeHandles(prevEl);'),
  'selection.ts must call unmountResizeHandles on the previously-selected wrapper',
);
assert(
  selectionSrc.includes('mountResizeHandles(nextEl);'),
  'selection.ts must call mountResizeHandles on the newly-selected wrapper',
);

const editorStylesSrc = await Bun.file(new URL('./styles-build.ts', import.meta.url)).text();
assert(
  editorStylesSrc.includes('.opencanvas-element[data-selected="true"] {\n  overflow: visible !important;'),
  'selected element wrappers must force overflow visible so resize handles and the element menu are not clipped by text/default/elementStyle overflow',
);
assert(
  editorStylesSrc.includes(
    '.opencanvas-element[data-element-type="text"]:not([data-editing="true"]):not([data-selected="true"])',
  ),
  'text overflow clipping must not apply while selected because selection chrome lives inside the wrapper',
);
assert(
  editorStylesSrc.includes('.opencanvas-element:hover > .element-menu-trigger,'),
  'element menu trigger must become visible on hover so owners can open it without selecting twice',
);
assert(
  editorStylesSrc.includes('.opencanvas-element > .element-menu-trigger'),
  'element menu trigger visibility must target direct children only so nested selected elements do not reveal ancestor triggers',
);

// ---- 2. Minimal element stub for DOM-level checks ----------------------
//
// mountResizeHandles only touches:
//   document.createElement
//   element.appendChild
//   element.setAttribute
//   element.querySelector(':scope > [data-resize-handle]')
//
// unmountResizeHandles touches:
//   element.querySelectorAll(':scope > [data-resize-handle]')
//   element.removeChild
//   child.parentNode
//
// We hand-roll just those surfaces. No happy-dom dep — the project ships
// without one, and the runtime smoke (create-editor-runtime.smoke.ts)
// already established the pattern.

interface StubEl {
  tagName: string;
  className: string;
  attrs: Map<string, string>;
  children: StubEl[];
  parentNode: StubEl | null;
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): StubEl | null;
  querySelectorAll(selector: string): StubEl[];
}

function makeStubEl(tagName: string): StubEl {
  const el: StubEl = {
    tagName: tagName.toUpperCase(),
    className: '',
    attrs: new Map(),
    children: [],
    parentNode: null,
    appendChild(c: StubEl): StubEl {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    removeChild(c: StubEl): StubEl {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
      c.parentNode = null;
      return c;
    },
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
      if (name === 'class') this.className = value;
    },
    getAttribute(name: string): string | null {
      if (name === 'class') return this.className || null;
      return this.attrs.has(name) ? this.attrs.get(name)! : null;
    },
    querySelector(selector: string): StubEl | null {
      // Support only ':scope > [data-resize-handle]' — that's all
      // mountResizeHandles uses.
      if (selector !== ':scope > [data-resize-handle]') {
        throw new Error(
          '[resize-handles:smoke] stub querySelector got unsupported selector: ' + selector,
        );
      }
      for (const c of this.children) {
        if (c.attrs.has('data-resize-handle')) return c;
      }
      return null;
    },
    querySelectorAll(selector: string): StubEl[] {
      if (selector !== ':scope > [data-resize-handle]') {
        throw new Error(
          '[resize-handles:smoke] stub querySelectorAll got unsupported selector: ' + selector,
        );
      }
      const out: StubEl[] = [];
      for (const c of this.children) {
        if (c.attrs.has('data-resize-handle')) out.push(c);
      }
      return out;
    },
  };
  // className must mirror setAttribute('class', ...) — minimal accessor
  Object.defineProperty(el, 'className', {
    get(): string {
      return el.attrs.get('class') || '';
    },
    set(value: string): void {
      el.attrs.set('class', value);
    },
    configurable: true,
  });
  return el;
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement(tag: string): StubEl {
    return makeStubEl(tag);
  },
};
// HTMLElement just needs to exist as a class symbol so TS sees a type;
// the implementation never instantiates it.
g.HTMLElement = class HTMLElement {};

const { mountResizeHandles, unmountResizeHandles } = await import('./element-menu.js');

// Count helper — walks all descendants recursively, like
// document.querySelectorAll('.resize-handle').length would.
function countResizeHandles(root: StubEl): number {
  let count = 0;
  if (root.attrs.has('data-resize-handle')) count++;
  for (const c of root.children) count += countResizeHandles(c);
  return count;
}

// ---- DOM-level idempotence checks --------------------------------------

const wrapper = makeStubEl('div');
wrapper.setAttribute('class', 'opencanvas-element');

mountResizeHandles(wrapper as unknown as HTMLElement);
assert(
  countResizeHandles(wrapper) === 8,
  'mountResizeHandles must add exactly 8 handles to a wrapper — got ' +
    String(countResizeHandles(wrapper)),
);

// Idempotence: double-mount must not double the count.
mountResizeHandles(wrapper as unknown as HTMLElement);
assert(
  countResizeHandles(wrapper) === 8,
  'mountResizeHandles must be idempotent — got ' +
    String(countResizeHandles(wrapper)) +
    ' after second call',
);

unmountResizeHandles(wrapper as unknown as HTMLElement);
assert(
  countResizeHandles(wrapper) === 0,
  'unmountResizeHandles must remove every handle — got ' + String(countResizeHandles(wrapper)),
);

// Idempotence on empty: must not throw.
unmountResizeHandles(wrapper as unknown as HTMLElement);
assert(
  countResizeHandles(wrapper) === 0,
  'unmountResizeHandles on empty wrapper must stay at 0 — got ' +
    String(countResizeHandles(wrapper)),
);

// ---- End-to-end count check --------------------------------------------
//
// Simulate the live bug repro: three wrappers, only one "selected" at a
// time. Repeatedly call mount/unmount as selectElement would. The whole
// DOM tree's resize-handle count must follow the selection.

const rootStub = makeStubEl('div');
const wrapA = makeStubEl('div');
const wrapB = makeStubEl('div');
const wrapC = makeStubEl('div');
wrapA.setAttribute('class', 'opencanvas-element');
wrapB.setAttribute('class', 'opencanvas-element');
wrapC.setAttribute('class', 'opencanvas-element');
rootStub.appendChild(wrapA);
rootStub.appendChild(wrapB);
rootStub.appendChild(wrapC);

// Nothing selected → no handles anywhere.
assert(
  countResizeHandles(rootStub) === 0,
  'Initial DOM must carry 0 handles — got ' + String(countResizeHandles(rootStub)),
);

// Select A.
mountResizeHandles(wrapA as unknown as HTMLElement);
assert(
  countResizeHandles(rootStub) === 8,
  'After selecting A, DOM must carry exactly 8 handles — got ' +
    String(countResizeHandles(rootStub)),
);

// Select B (selection.ts unmounts prior, mounts next).
unmountResizeHandles(wrapA as unknown as HTMLElement);
mountResizeHandles(wrapB as unknown as HTMLElement);
assert(
  countResizeHandles(rootStub) === 8,
  'After switching from A to B, DOM must carry exactly 8 handles — got ' +
    String(countResizeHandles(rootStub)),
);
const aHandles = wrapA.children.filter((c) => c.attrs.has('data-resize-handle')).length;
assert(
  aHandles === 0,
  "Switching selection away from A must strip A's handles — got " + String(aHandles) + ' on A',
);

// Select C.
unmountResizeHandles(wrapB as unknown as HTMLElement);
mountResizeHandles(wrapC as unknown as HTMLElement);
assert(
  countResizeHandles(rootStub) === 8,
  'After switching to C, DOM must carry exactly 8 handles — got ' +
    String(countResizeHandles(rootStub)),
);

// Deselect (click empty canvas).
unmountResizeHandles(wrapC as unknown as HTMLElement);
assert(
  countResizeHandles(rootStub) === 0,
  'After deselect, DOM must carry 0 handles — got ' + String(countResizeHandles(rootStub)),
);

// ---- Cascade-bug regression --------------------------------------------
//
// The live bug surfaced because a container's handles "cascaded" through
// the CSS descendant selector to every nested element's handles. Verify
// that even with deeply-nested wrappers, mounting on the OUTER wrapper
// only adds handles to that wrapper — the inner wrappers stay handle-
// free. This mirrors the editor's tabs/collection/container topology.

const container = makeStubEl('div');
container.setAttribute('class', 'opencanvas-element');
const body = makeStubEl('div');
container.appendChild(body);
for (let i = 0; i < 10; i++) {
  const nested = makeStubEl('div');
  nested.setAttribute('class', 'opencanvas-element');
  body.appendChild(nested);
}

mountResizeHandles(container as unknown as HTMLElement);
assert(
  countResizeHandles(container) === 8,
  'Mounting on a container with 10 nested element wrappers must leave count at 8 — got ' +
    String(countResizeHandles(container)) +
    ' (descendant-cascade regression)',
);
// The pre-fix DOM would have carried 88 handles here (11 wrappers × 8
// handles per wrapper). 88 / 8 === 11. Assert we are nowhere near that.
assert(
  countResizeHandles(container) < 16,
  'Container handle count must stay under 16 — got ' + String(countResizeHandles(container)),
);

// ---- Codex review pass 3 finding 5 — drag-resize frame resolver must -----
// recognise `.opencanvas-collection-template-edit` as a nested-frame ancestor.
//
// ADR 0065 D5 mounts an active custom-template inside an
// `.opencanvas-collection-template-edit` wrapper (body-builders-data.ts:596).
// Children inside that wrapper carry boxes in PANEL-LOCAL coords — not
// section coords. drag-resize.ts's `beginDragImpl` and `beginResizeImpl`
// resolve the nearest positioned ancestor via `.closest(...)`. Before this
// fix the selector list was `'.opencanvas-tab-panel, .opencanvas-section'`,
// so the resolver fell back to the parent section and clamped against
// section bounds — letting the dragged element land outside the template
// card frame and corrupt the published layout.
//
// Source-grep covers both call sites (beginDrag + beginResize). The smoke
// can't simulate a mouse-down/-move/-up sequence under Bun (no JSDOM-level
// event simulation in this project), so the source pin is the contract.
{
  const dragResizeSrc = await Bun.file(new URL('./drag-resize.ts', import.meta.url)).text();
  const occurrences = dragResizeSrc.split('.opencanvas-collection-template-edit,').length - 1;
  assert(
    occurrences >= 2,
    `drag-resize.ts must list '.opencanvas-collection-template-edit' in BOTH frame ` +
      'selectors (beginDragImpl + beginResizeImpl) so the resolver clamps a dragged ' +
      'template child to the template-edit frame instead of the parent section. ' +
      'Got ' +
      String(occurrences) +
      ' occurrence(s).',
  );
  // Both `beginDragImpl` and `beginResizeImpl` must contain the selector
  // INSIDE their bodies (not in a stray comment). Bound each function and
  // re-check.
  function bodyOf(name: string): string {
    const sigIdx = dragResizeSrc.indexOf('export function ' + name);
    assert(sigIdx >= 0, name + ' signature must exist in drag-resize.ts');
    const tailIdx = dragResizeSrc.indexOf('\nexport function ', sigIdx + 1);
    return dragResizeSrc.slice(sigIdx, tailIdx > 0 ? tailIdx : dragResizeSrc.length);
  }
  const dragBody = bodyOf('beginDragImpl');
  const resizeBody = bodyOf('beginResizeImpl');
  assert(
    dragBody.includes('.opencanvas-collection-template-edit'),
    "beginDragImpl must include '.opencanvas-collection-template-edit' in its frame resolver",
  );
  assert(
    resizeBody.includes('.opencanvas-collection-template-edit'),
    "beginResizeImpl must include '.opencanvas-collection-template-edit' in its frame resolver",
  );
  // The body-builders-data.ts wrapper class must match — verify the producer
  // ships the exact selector the resolver looks for, so a future rename of
  // the wrapper class fails loudly in BOTH files at once.
  const bodyBuildersSrc = await Bun.file(
    new URL('./body-builders-data.ts', import.meta.url),
  ).text();
  assert(
    bodyBuildersSrc.includes("'opencanvas-collection-template-edit'"),
    'body-builders-data.ts must mount the active template wrapper with class ' +
      "'opencanvas-collection-template-edit' (the selector drag-resize.ts looks for)",
  );
}

console.log('[resize-handles:smoke] OK');
