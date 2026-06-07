// src/editor-client/collection-template-edit-view.smoke.ts
//
// ADR 0065 Phase 3 — pins the in-place template-edit visual chrome
// (banner, scrim, Done button, viewport pan) and its wiring through
// canvas-root-events (Esc + click-outside + Phase 2D selection inversion
// call-site).
//
// Coverage:
//   (1) Source guard — neither src/canvas/render.ts nor
//       src/interactive/inject.ts (the publish renderers) imports
//       collection-template-edit-view. The chrome is editor-only DOM;
//       a publish-path import would leak banner/scrim to visitors.
//   (2) When ctx.editingCollectionTemplate pins a Collection, the mount
//       writes the banner with the exact ADR D5 text, a Done button,
//       and a scrim onto the viewport.
//   (3) When ctx.editingCollectionTemplate === null, the mount strips
//       any prior chrome and the DOM contains zero banner / Done / scrim
//       nodes.
//   (4) Idempotence — re-running the mount with the same active state
//       leaves exactly one banner, one Done, one scrim (no stacking).
//   (5) Transition active → null restores the pre-enter camera snapshot
//       (zooms/pan back to origin).
//   (6) canvas-root-events.ts threads ctx.editingCollectionTemplate
//       into resolveCollectionAncestorForClick (Phase 2D wiring).
//   (7) canvas-root-events.ts has the Esc handler that calls
//       ctx.exitCollectionTemplateEdit().
//   (8) canvas-root-events.ts has the click-outside handler that calls
//       ctx.exitCollectionTemplateEdit() when the click target lies
//       outside the active wrapper.
//   (9) page-crud.ts setActivePageImpl calls exitCollectionTemplateEdit
//       on page switch (ADR D6 — UI state does not survive page changes).
//
// Bare Bun — no real `document`. The view module touches createElement /
// appendChild / querySelector / setAttribute / style.cssText only, so
// the stub used by collection-preview.smoke.ts is reused here.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-template-edit-view:smoke] ' + message);
}

// ---- 1. Source guard — publish path must NOT import the view ----------

const canvasRender = await Bun.file(new URL('../canvas/render.ts', import.meta.url)).text();
assert(
  !canvasRender.includes('collection-template-edit-view'),
  'src/canvas/render.ts must NOT reference collection-template-edit-view (publish path)',
);

const inject = await Bun.file(new URL('../interactive/inject.ts', import.meta.url)).text();
assert(
  !inject.includes('collection-template-edit-view'),
  'src/interactive/inject.ts must NOT reference collection-template-edit-view (publish path)',
);

// ---- 6. Phase 2D call-site wiring in canvas-root-events.ts -----------

const canvasRootSrc = await Bun.file(
  new URL('./canvas-root-events.ts', import.meta.url),
).text();
assert(
  canvasRootSrc.includes(
    'resolveCollectionAncestorForClick(target, ctx.editingCollectionTemplate)',
  ),
  '(6) canvas-root-events.ts must pass ctx.editingCollectionTemplate into resolveCollectionAncestorForClick',
);

// ---- 7. Esc handler in canvas-root-events.ts -------------------------

assert(
  canvasRootSrc.includes("ev.key !== 'Escape'") ||
    canvasRootSrc.includes("ev.key === 'Escape'"),
  '(7) canvas-root-events.ts must own an Escape keydown handler',
);
assert(
  canvasRootSrc.includes('ctx.editingCollectionTemplate === null') &&
    canvasRootSrc.includes('ctx.exitCollectionTemplateEdit()'),
  '(7) canvas-root-events.ts must gate Esc on editingCollectionTemplate AND call exitCollectionTemplateEdit()',
);
// Modal precedence — Esc handler must short-circuit when a modal is open
// so confirms / selects own the keystroke.
assert(
  canvasRootSrc.includes('ctx.modalOpen'),
  '(7) Esc handler must skip when a modal is open (modal precedence)',
);

// Codex review pass 6 finding 1 — `defaultPrevented` short-circuit MUST
// precede the `exitCollectionTemplateEdit()` call inside the Esc handler.
// Text-edit's onKey is bound to the contenteditable inner element,
// bubbles to document AFTER running `preventDefault()` + clearing
// `editingElementId`. Without the defaultPrevented gate at the top of
// the handler, a single Esc inside inline text-edit would exit BOTH
// text-edit AND template-edit.
//
// We isolate the Esc handler by slicing the source from the
// `keydown` registration that gates on `ev.key !== 'Escape'`. The
// click-outside handler ALSO calls exitCollectionTemplateEdit (when the
// Owner clicks outside the active wrapper) — earlier in the file —
// and would otherwise be the first hit of the verb name.
const escKeyIdx = canvasRootSrc.indexOf("ev.key !== 'Escape'");
assert(
  escKeyIdx !== -1,
  '(7) Esc handler must guard on ev.key !== Escape (anchor for the slice)',
);
const escHandlerSlice = canvasRootSrc.slice(escKeyIdx);
const defaultPreventedIdx = escHandlerSlice.indexOf('ev.defaultPrevented');
const exitCallIdxInSlice = escHandlerSlice.indexOf('ctx.exitCollectionTemplateEdit()');
assert(
  defaultPreventedIdx !== -1,
  '(7) Esc handler must short-circuit on ev.defaultPrevented (pass 6 F1 — text-edit precedence)',
);
assert(
  exitCallIdxInSlice !== -1,
  '(7) Esc handler must call ctx.exitCollectionTemplateEdit() — anchor for ordering check',
);
assert(
  defaultPreventedIdx < exitCallIdxInSlice,
  '(7) ev.defaultPrevented check must appear BEFORE ctx.exitCollectionTemplateEdit() within the Esc handler',
);

// ---- 8. Click-outside handler in canvas-root-events.ts ---------------

assert(
  canvasRootSrc.includes('activeWrapper') &&
    canvasRootSrc.includes('contains(target)'),
  '(8) canvas-root-events.ts must locate the active wrapper and click-outside-test via contains()',
);

// ---- 9. Page-switch auto-exit in page-crud.ts ------------------------

const pageCrudSrc = await Bun.file(new URL('./page-crud.ts', import.meta.url)).text();
assert(
  pageCrudSrc.includes('exitCollectionTemplateEdit'),
  '(9) page-crud.ts setActivePageImpl must call exitCollectionTemplateEdit on page switch (ADR D6)',
);

// ---- DOM stub used by (2)-(5) ----------------------------------------

interface StubEl {
  tagName: string;
  className: string;
  textContent: string;
  attrs: Map<string, string>;
  children: StubEl[];
  parentNode: StubEl | null;
  style: { cssText: string; [k: string]: unknown };
  listeners: Map<string, Array<(ev: unknown) => void>>;
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  contains(other: StubEl): boolean;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): StubEl | null;
  querySelectorAll(selector: string): StubEl[];
  addEventListener(name: string, handler: (ev: unknown) => void): void;
  dispatchEvent(name: string, ev: unknown): void;
}

function makeStubEl(tagName: string): StubEl {
  const el: StubEl = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    attrs: new Map<string, string>(),
    children: [],
    parentNode: null,
    style: new Proxy<{ cssText: string; [k: string]: unknown }>(
      { cssText: '' },
      {
        set(target, prop, value): boolean {
          (target as Record<string, unknown>)[prop as string] = value;
          return true;
        },
        get(target, prop): unknown {
          if (prop === 'removeProperty') {
            return (name: string): void => {
              delete (target as Record<string, unknown>)[name];
            };
          }
          if (prop === 'setProperty') {
            return (name: string, value: string): void => {
              (target as Record<string, unknown>)[name] = value;
            };
          }
          return (target as Record<string, unknown>)[prop as string];
        },
      },
    ),
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
    contains(other: StubEl): boolean {
      if (other === this) return true;
      for (const child of this.children) {
        if (child.contains(other)) return true;
      }
      return false;
    },
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
      if (name === 'class') this.className = value;
    },
    removeAttribute(name: string): void {
      this.attrs.delete(name);
      if (name === 'class') this.className = '';
    },
    getAttribute(name: string): string | null {
      if (name === 'class') return this.className || null;
      return this.attrs.has(name) ? this.attrs.get(name)! : null;
    },
    querySelector(selector: string): StubEl | null {
      return querySelectorImpl(this, selector, true)[0] ?? null;
    },
    querySelectorAll(selector: string): StubEl[] {
      return querySelectorImpl(this, selector, false);
    },
    listeners: new Map<string, Array<(ev: unknown) => void>>(),
    addEventListener(name: string, handler: (ev: unknown) => void): void {
      const list = this.listeners.get(name) ?? [];
      list.push(handler);
      this.listeners.set(name, list);
    },
    dispatchEvent(name: string, ev: unknown): void {
      const list = this.listeners.get(name) ?? [];
      for (const h of list) h(ev);
    },
  };
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

function querySelectorImpl(root: StubEl, selector: string, firstOnly: boolean): StubEl[] {
  const matches = parseSelector(selector);
  const out: StubEl[] = [];
  walk(root);
  return out;
  function walk(node: StubEl): void {
    for (const child of node.children) {
      if (matchesAll(child, matches)) {
        out.push(child);
        if (firstOnly && out.length > 0) return;
      }
      walk(child);
      if (firstOnly && out.length > 0) return;
    }
  }
}

interface SelectorMatcher {
  className?: string;
  attr?: { name: string; value?: string };
}

function parseSelector(pattern: string): SelectorMatcher[] {
  const out: SelectorMatcher[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < pattern.length && /[A-Za-z0-9_-]/.test(pattern[j]!)) j++;
      out.push({ className: pattern.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) throw new Error('selector parse error: ' + pattern);
      const body = pattern.slice(i + 1, end);
      const eq = body.indexOf('=');
      if (eq < 0) {
        out.push({ attr: { name: body } });
      } else {
        const name = body.slice(0, eq);
        let value = body.slice(eq + 1);
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        out.push({ attr: { name, value } });
      }
      i = end + 1;
      continue;
    }
    throw new Error('unsupported selector char: ' + ch);
  }
  return out;
}

function matchesAll(node: StubEl, matchers: SelectorMatcher[]): boolean {
  for (const m of matchers) {
    if (m.className !== undefined) {
      const cls = node.className.split(/\s+/);
      if (!cls.includes(m.className)) return false;
    } else if (m.attr) {
      if (!node.attrs.has(m.attr.name)) return false;
      if (m.attr.value !== undefined && node.attrs.get(m.attr.name) !== m.attr.value) return false;
    }
  }
  return true;
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement(tag: string): StubEl {
    return makeStubEl(tag);
  },
  querySelectorAll(selector: string): StubEl[] {
    // Module-level scrim cleanup query — return empty here since the
    // smoke owns the doc-roots it cares about and they're walked
    // explicitly. The module's strip path walks document.querySelectorAll
    // to scoop up any scrim that drifted from the viewport — in the
    // smoke there is no global document; returning [] is correct.
    void selector;
    return [];
  },
  addEventListener(): void {
    // The view module does not addEventListener at document level —
    // the click-outside + Esc handlers live in canvas-root-events.ts,
    // not in collection-template-edit-view.ts. This stub is here only
    // so any future addition that touches `document.addEventListener`
    // surfaces as a no-op rather than a thrown ReferenceError.
  },
};
g.HTMLElement = class HTMLElement {
  constructor() {
    throw new Error('stub HTMLElement is never instantiated');
  }
};
Object.defineProperty(g.HTMLElement, Symbol.hasInstance, {
  value: (instance: unknown): boolean => {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      'tagName' in (instance as Record<string, unknown>) &&
      'attrs' in (instance as Record<string, unknown>)
    );
  },
});

// CSS.escape stub — the view module uses cssEscape which probes for
// `typeof CSS !== 'undefined'`. Without this stub the fallback regex
// kicks in (fine), but providing the stub matches production behaviour
// where the browser ships CSS.escape natively.
g.CSS = {
  escape(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  },
};

// applyCameraTransform mutates style on ctx.root; the view module imports
// it lazily through `./render.js`. Stub the named import at module load
// time by short-circuiting render via Bun's loader is overkill — instead
// we let the real applyCameraTransform run; since it reads ctx.root and
// the stub root has a style proxy, it just writes through. zoomReadout
// is null; the function is null-safe there.

const { mountTemplateEditChromeImpl } = await import('./collection-template-edit-view.js');

interface MockElement {
  id: string;
  type: 'collection';
  display: 'custom' | 'card' | 'image-only';
  customTemplate?: unknown[];
}

interface MockCtx {
  root: StubEl | null;
  viewport: StubEl | null;
  zoomReadout: StubEl | null;
  state: { pages: unknown[]; header: null; footer: null } | null;
  pagePositions: Array<{ pageId: string; x: number; y: number; width: number; height: number }>;
  activePageId: string | null;
  camera: { x: number; y: number; zoom: number };
  editingCollectionTemplate: { collectionId: string } | null;
  exitCalls: number;
  /** Codex review pass 6 finding 2 — chrome mount reads the element via
   *  ctx.findElement to apply the same display+customTemplate precondition
   *  the body builder uses. The smoke registers elements here and the
   *  mock findElement looks them up by id. */
  elementsById: Map<string, MockElement>;
  exitCollectionTemplateEdit(): void;
  findElement(id: string): { element: MockElement } | null;
  currentPage(): null;
  repaintRemoteCursors(): void;
  onMarkToolbarReflow(): void;
}

function buildCtx(): MockCtx {
  const root = makeStubEl('div');
  const viewport = makeStubEl('div');
  // viewport.getBoundingClientRect — applyCameraTransform inside
  // panToElementImpl reads it. Stub via property since `ctx.viewport`
  // is typed loosely in our cast.
  (viewport as unknown as { getBoundingClientRect: () => DOMRect }).getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 1024,
    bottom: 768,
    width: 1024,
    height: 768,
    x: 0,
    y: 0,
    toJSON(): unknown {
      return {};
    },
  });
  const ctx: MockCtx = {
    root,
    viewport,
    zoomReadout: null,
    state: null,
    pagePositions: [],
    activePageId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    editingCollectionTemplate: null,
    exitCalls: 0,
    elementsById: new Map<string, MockElement>(),
    exitCollectionTemplateEdit(): void {
      this.exitCalls += 1;
      this.editingCollectionTemplate = null;
    },
    findElement(id: string): { element: MockElement } | null {
      const element = this.elementsById.get(id);
      return element ? { element } : null;
    },
    currentPage(): null {
      return null;
    },
    repaintRemoteCursors(): void {},
    onMarkToolbarReflow(): void {},
  };
  return ctx;
}

/** Register an element with a default `display: 'custom'` + non-empty
 *  customTemplate so the chrome mount's pass-6 precondition passes. The
 *  customTemplate child is a placeholder — the mount path never reads its
 *  shape, only `Array.isArray() && length > 0`. */
function registerCustomCollection(ctx: MockCtx, id: string): MockElement {
  const el: MockElement = {
    id,
    type: 'collection',
    display: 'custom',
    customTemplate: [{ id: id + '-tpl-child', type: 'container' }],
  };
  ctx.elementsById.set(id, el);
  return el;
}

function buildWrapper(root: StubEl, id: string): StubEl {
  const wrapper = makeStubEl('div');
  wrapper.setAttribute('data-element-type', 'collection');
  wrapper.setAttribute('data-opencanvas-element', id);
  root.appendChild(wrapper);
  return wrapper;
}

function countByClass(root: StubEl, className: string): number {
  return root.querySelectorAll('.' + className).length;
}

const BANNER_CLASS = 'opencanvas-collection-template-edit-chrome-banner';
const DONE_CLASS = 'opencanvas-collection-template-edit-chrome-done';
// Codex review pass 2 finding 3 — scrim DOM element is gone; per-wrapper
// dimming via `data-template-edit-dimmed` replaces it. We still pin the
// SCRIM_CLASS string so a future re-introduction of a scrim mount also
// fails the contract that "no scrim element exists on the viewport".
const SCRIM_CLASS = 'opencanvas-collection-template-edit-chrome-scrim';
const DIMMED_ATTR = 'data-template-edit-dimmed';

// ---- (2) Mount with active collectionId -------------------------------
{
  const ctx = buildCtx();
  // Sibling wrapper that must end up dimmed — sits next to the active
  // wrapper at the same depth. Without per-wrapper dimming this would
  // paint at full brightness alongside the template the Owner is editing.
  const sibling = buildWrapper(ctx.root!, 'coll-sibling');
  const wrapper = buildWrapper(ctx.root!, 'coll-active');
  ctx.editingCollectionTemplate = { collectionId: 'coll-active' };
  // Codex review pass 6 finding 2 — chrome mount requires display: 'custom'
  // AND non-empty customTemplate. Register the active Collection so the
  // precondition passes and the mount proceeds.
  registerCustomCollection(ctx, 'coll-active');

  mountTemplateEditChromeImpl(ctx as never);

  assert(countByClass(wrapper, BANNER_CLASS) === 1, '(2) one banner mounted');
  assert(countByClass(wrapper, DONE_CLASS) === 1, '(2) one Done button mounted');
  assert(
    countByClass(ctx.viewport!, SCRIM_CLASS) === 0,
    '(2) no scrim element (codex pass 2 finding 3 — replaced by per-wrapper dimming)',
  );

  // Codex review pass 2 finding 3 — active wrapper must NOT carry the
  // dim marker; sibling wrapper MUST. This is the new DOM-attribute
  // shape the dim-replaces-scrim fix produces.
  assert(
    wrapper.getAttribute(DIMMED_ATTR) === null,
    '(2) active wrapper must NOT carry data-template-edit-dimmed',
  );
  assert(
    sibling.getAttribute(DIMMED_ATTR) === 'true',
    '(2) sibling wrapper must carry data-template-edit-dimmed="true"',
  );

  // Banner carries the exact ADR D5 text.
  const banner = wrapper.querySelector('.' + BANNER_CLASS);
  assert(banner !== null, '(2) banner queryable');
  assert(
    banner.textContent === 'Editing template — substitutions apply at publish',
    '(2) banner text exactly matches ADR D5: ' + banner.textContent,
  );

  // Editor-only marker for the publish-path source guard.
  assert(
    banner.getAttribute('data-editor-only') === 'true',
    '(2) banner has data-editor-only="true"',
  );

  const doneBtn = wrapper.querySelector('.' + DONE_CLASS);
  assert(doneBtn !== null, '(2) done button queryable');
  assert(
    doneBtn.getAttribute('data-editor-only') === 'true',
    '(2) done button has data-editor-only="true"',
  );
  assert(doneBtn.textContent === 'Done', '(2) Done button text is "Done"');

  // Wrapper carries the active marker for chrome / CSS to query.
  assert(
    wrapper.getAttribute('data-template-edit-active') === 'true',
    '(2) wrapper marked data-template-edit-active="true"',
  );
}

// ---- (3) No chrome when editingCollectionTemplate === null ------------
{
  const ctx = buildCtx();
  const wrapper = buildWrapper(ctx.root!, 'coll-idle');
  const sibling = buildWrapper(ctx.root!, 'coll-idle-sibling');
  ctx.editingCollectionTemplate = null;

  mountTemplateEditChromeImpl(ctx as never);

  assert(countByClass(wrapper, BANNER_CLASS) === 0, '(3) no banner when null');
  assert(countByClass(wrapper, DONE_CLASS) === 0, '(3) no Done button when null');
  assert(countByClass(ctx.viewport!, SCRIM_CLASS) === 0, '(3) no scrim when null');
  assert(
    sibling.getAttribute(DIMMED_ATTR) === null,
    '(3) no wrapper carries data-template-edit-dimmed when null',
  );
}

// ---- (4) Idempotence — re-mount with same active state does not stack -
{
  const ctx = buildCtx();
  const sibling = buildWrapper(ctx.root!, 'coll-idem-sibling');
  const wrapper = buildWrapper(ctx.root!, 'coll-idem');
  ctx.editingCollectionTemplate = { collectionId: 'coll-idem' };
  registerCustomCollection(ctx, 'coll-idem');

  mountTemplateEditChromeImpl(ctx as never);
  mountTemplateEditChromeImpl(ctx as never);
  mountTemplateEditChromeImpl(ctx as never);

  assert(countByClass(wrapper, BANNER_CLASS) === 1, '(4) idempotent: exactly one banner');
  assert(countByClass(wrapper, DONE_CLASS) === 1, '(4) idempotent: exactly one Done');
  assert(
    countByClass(ctx.viewport!, SCRIM_CLASS) === 0,
    '(4) idempotent: no scrim across re-mounts (per-wrapper dimming replaces scrim)',
  );
  // Sibling stays dimmed (one marker, not stacked) and the active
  // wrapper stays bright across repeated mounts.
  assert(
    sibling.getAttribute(DIMMED_ATTR) === 'true',
    '(4) idempotent: sibling carries exactly one dim marker',
  );
  assert(
    wrapper.getAttribute(DIMMED_ATTR) === null,
    '(4) idempotent: active wrapper remains undimmed across re-mounts',
  );
}

// ---- (5) Transition active → null restores camera snapshot ------------
// Important: the view module's camera snapshot is module-private and
// leaks across mount calls within the same test process. We reset to a
// known clean state first (mount with editing=null clears any stale
// snapshot from earlier test blocks), then run the enter → mutate →
// exit sequence in isolation.
{
  const ctx = buildCtx();
  buildWrapper(ctx.root!, 'coll-restore');
  registerCustomCollection(ctx, 'coll-restore');
  // Step 0: clean slate — mount with null clears any inherited snapshot.
  ctx.editingCollectionTemplate = null;
  mountTemplateEditChromeImpl(ctx as never);

  // Step 1: enter edit mode with camera at known origin coords. The
  // mount captures this into its private snapshot.
  ctx.camera.x = 100;
  ctx.camera.y = 200;
  ctx.camera.zoom = 1;
  ctx.editingCollectionTemplate = { collectionId: 'coll-restore' };
  mountTemplateEditChromeImpl(ctx as never);

  // Step 2: simulate user-driven pan/zoom while in edit mode (the verb's
  // pan is a no-op here because findElement stub returns null).
  ctx.camera.x = 999;
  ctx.camera.y = 999;
  ctx.camera.zoom = 0.5;

  // Step 3: exit edit mode. The mount must restore the snapshot.
  ctx.editingCollectionTemplate = null;
  mountTemplateEditChromeImpl(ctx as never);

  assert(ctx.camera.x === 100, '(5) camera.x restored to snapshot: ' + ctx.camera.x);
  assert(ctx.camera.y === 200, '(5) camera.y restored to snapshot: ' + ctx.camera.y);
  assert(ctx.camera.zoom === 1, '(5) camera.zoom restored to snapshot: ' + ctx.camera.zoom);
}

// ---- (10a) Codex review pass 6 finding 2 — pin stale after undo of -----
// the atomic display+customTemplate switch. The Collection's display is
// back to 'card' but `editingCollectionTemplate.collectionId` still
// targets it. Mount must:
//   * strip any prior chrome unconditionally;
//   * NOT mount banner / Done / per-wrapper dimming;
//   * leave the wrapper without `data-template-edit-active`.
//
// Mirrors the buildCollectionBodyImpl pass 4 F1 fall-through: the body
// renders the normal grid; chrome would lie about the body's state.
{
  const ctx = buildCtx();
  // Step 1: prime a valid mount so prior chrome / dim markers exist.
  // Sibling wrapper proves the strip path runs (it must lose its dim
  // marker even though the mount is then skipped).
  const sibling = buildWrapper(ctx.root!, 'coll-undo-sibling');
  const wrapper = buildWrapper(ctx.root!, 'coll-undo');
  registerCustomCollection(ctx, 'coll-undo');
  ctx.editingCollectionTemplate = { collectionId: 'coll-undo' };
  mountTemplateEditChromeImpl(ctx as never);
  assert(
    countByClass(wrapper, BANNER_CLASS) === 1,
    '(10a) prior valid mount stamped chrome',
  );
  assert(
    sibling.getAttribute(DIMMED_ATTR) === 'true',
    '(10a) prior valid mount dimmed sibling',
  );

  // Step 2: simulate Ctrl+Z on the atomic first-switch — display reverts
  // to 'card', customTemplate is undefined. The pin is stale (UI state
  // is not on the undo stack per ADR 0065 D6).
  const reverted = ctx.elementsById.get('coll-undo')!;
  reverted.display = 'card';
  delete reverted.customTemplate;

  // Step 3: re-mount. Strip must run unconditionally; mount must skip.
  mountTemplateEditChromeImpl(ctx as never);

  assert(
    countByClass(wrapper, BANNER_CLASS) === 0,
    '(10a) banner stripped + not remounted after display reverted to card',
  );
  assert(
    countByClass(wrapper, DONE_CLASS) === 0,
    '(10a) Done button stripped + not remounted after display reverted to card',
  );
  assert(
    wrapper.getAttribute('data-template-edit-active') === null,
    '(10a) wrapper no longer carries data-template-edit-active after revert',
  );
  assert(
    sibling.getAttribute(DIMMED_ATTR) === null,
    '(10a) sibling dim marker stripped (strip runs unconditionally before guard)',
  );
}

// ---- (10b) Codex review pass 6 finding 2 — display: 'custom' but ------
// customTemplate is empty (Owner deleted every template child while in
// edit mode). Same outcome as (10a): strip runs, mount skips.
{
  const ctx = buildCtx();
  const sibling = buildWrapper(ctx.root!, 'coll-empty-sibling');
  const wrapper = buildWrapper(ctx.root!, 'coll-empty');
  registerCustomCollection(ctx, 'coll-empty');
  ctx.editingCollectionTemplate = { collectionId: 'coll-empty' };
  mountTemplateEditChromeImpl(ctx as never);
  // Prior mount stamps chrome. Sanity-check before we mutate.
  assert(countByClass(wrapper, BANNER_CLASS) === 1, '(10b) prior valid mount banner present');

  // Drain the template — `display` stays 'custom', `customTemplate = []`.
  ctx.elementsById.get('coll-empty')!.customTemplate = [];

  mountTemplateEditChromeImpl(ctx as never);

  assert(
    countByClass(wrapper, BANNER_CLASS) === 0,
    '(10b) banner stripped + not remounted when customTemplate emptied',
  );
  assert(
    countByClass(wrapper, DONE_CLASS) === 0,
    '(10b) Done button stripped + not remounted when customTemplate emptied',
  );
  assert(
    wrapper.getAttribute('data-template-edit-active') === null,
    '(10b) wrapper no longer carries data-template-edit-active when template emptied',
  );
  assert(
    sibling.getAttribute(DIMMED_ATTR) === null,
    '(10b) sibling dim marker stripped (strip runs unconditionally before guard)',
  );
}

// ---- (2b) Done button click handler calls exit verb -------------------
// The button's click handler is wired to ctx.exitCollectionTemplateEdit.
// Bun's stub has no event dispatch system, but we can verify the handler
// invocation indirectly by inspecting the click handler the button was
// constructed with — pseudo-fired via direct invocation.
// Simpler: re-mount with active, then null the field manually and assert
// the click would trigger the verb via the module's wiring contract. We
// already source-grep canvas-root-events for the call; for the Done
// button itself, source-grep the view module.
const viewSrc = await Bun.file(
  new URL('./collection-template-edit-view.ts', import.meta.url),
).text();
assert(
  viewSrc.includes('ctx.exitCollectionTemplateEdit()'),
  '(2b) Done button must invoke ctx.exitCollectionTemplateEdit()',
);

console.log('[collection-template-edit-view:smoke] OK');
