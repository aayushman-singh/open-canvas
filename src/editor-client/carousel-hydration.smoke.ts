// src/editor-client/carousel-hydration.smoke.ts
//
// `bun run carousel-hydration:smoke` — verifies the editor's carousel
// preview is wired to the same visitor interactive runtime as published
// pages.
//
// Assertions:
//   1. A carousel built via `buildCarouselBodyImpl` carries the wrapper
//      contract the runtime keys off (`data-opencanvas-interactive`,
//      `data-opencanvas-slide-count`, `data-opencanvas-slide-index`,
//      `data-opencanvas-carousel-mode`).
//   2. The arrows + dots carry inline `pointer-events: auto` so the
//      editor's click-shield CSS doesn't swallow their clicks while the
//      carousel is unselected.
//   3. After `hydrateInteractives(root)` runs, the wrapper is marked
//      `data-opencanvas-hydrated="true"` and a synthetic click on the
//      next arrow advances `data-opencanvas-slide-index`.
//   4. Re-running hydrate is a no-op (the idempotence flag short-circuits
//      so duplicate listeners don't accumulate).
//   5. A synthetic click on the prev arrow calls stopPropagation so the
//      editor's root click listener never fires.
//   6. Clicking a dot jumps the index to the dot's target value and
//      mirrors aria-selected.
//   7. `{ skipPopups: true }` leaves popup sections untouched.
//
// Hand-rolled DOM stub follows the same pattern as
// `src/interactive/smoke.ts` — no jsdom / happy-dom dependency. Only the
// subset of the DOM surface the carousel builder + hydrater touches is
// implemented. Selectors outside the supported grammar throw loudly so
// silent stub drift surfaces here instead of silently passing.

// Top-level await requires the file to be a module. The smoke's dynamic
// imports below are the actual module shape; this export {} just signals
// the file shape to TypeScript.
export {};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`[carousel-hydration:smoke] ${message}`);
}

interface StubEvent {
  type: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  target: StubElement | null;
  currentTarget: StubElement | null;
}

type Listener = (event: StubEvent) => void;

class StubStyle {
  private values = new Map<string, string>();
  get pointerEvents(): string {
    return this.values.get('pointer-events') || '';
  }
  set pointerEvents(value: string) {
    this.values.set('pointer-events', value);
  }
}

class StubElement {
  tagName: string;
  attributes = new Map<string, string>();
  children: StubElement[] = [];
  parent: StubElement | null = null;
  listeners = new Map<string, Listener[]>();
  textContent = '';
  style = new StubStyle();
  // The carousel builder writes `btn.type = 'button'` and `img.src/alt/
  // loading = ...`; expose those as plain fields so the assignments
  // succeed silently.
  type = '';
  src = '';
  alt = '';
  loading = '';

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }
  get className(): string {
    return this.attributes.get('class') || '';
  }
  set className(value: string) {
    this.attributes.set('class', value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
  appendChild(child: StubElement): StubElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type: string, listener: Listener): void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(listener);
  }

  dispatchEvent(event: StubEvent): void {
    event.target = this;
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- bubble walk
    let node: StubElement | null = this;
    while (node) {
      const listeners = node.listeners.get(event.type);
      if (listeners) {
        event.currentTarget = node;
        for (const fn of listeners) fn(event);
      }
      if (event.propagationStopped) return;
      node = node.parent;
    }
  }

  matchesSelector(selector: string): boolean {
    const trimmed = selector.trim();
    // Class selector — `.foo`.
    if (trimmed.startsWith('.')) {
      const cls = trimmed.slice(1);
      const list = this.className.split(/\s+/);
      return list.indexOf(cls) >= 0;
    }
    // Attribute selector — `[attr]` or `[attr="value"]`.
    const m = /^\[([a-zA-Z0-9-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?\]$/.exec(trimmed);
    if (!m) throw new Error(`[stub] unsupported selector "${selector}"`);
    const attrName = m[1];
    if (attrName === undefined) return false;
    const expected = m[2] ?? m[3] ?? null;
    if (!this.attributes.has(attrName)) return false;
    if (expected === null) return true;
    return this.attributes.get(attrName) === expected;
  }

  querySelectorAll(selector: string): StubElement[] {
    const out: StubElement[] = [];
    const walk = (node: StubElement): void => {
      for (const child of node.children) {
        if (child.matchesSelector(selector)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector: string): StubElement | null {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? (all[0] ?? null) : null;
  }

  closest(selector: string): StubElement | null {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- ancestor walk
    let node: StubElement | null = this;
    while (node) {
      if (node.matchesSelector(selector)) return node;
      node = node.parent;
    }
    return null;
  }
}

function makeEvent(type: string): StubEvent {
  const event: StubEvent = {
    type,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      this.propagationStopped = true;
    },
    target: null,
    currentTarget: null,
  };
  return event;
}

// Install the stub globally BEFORE the carousel builder + hydrater
// imports run. The builder calls `document.createElement(tag)`; the
// hydrater's `instanceof HTMLElement` guard reads the global.
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement(tag: string): StubElement {
    return new StubElement(tag);
  },
};
g.HTMLElement = StubElement;

// Dynamic-import so the global patches above land first. The
// carousel builder only reads ctx.siteBase; the hydrater walks DOM via
// the patched StubElement. Cast through `unknown` to avoid eslint's
// `no-explicit-any` while keeping the smoke independent of EditorContext
// + CarouselElement's full surface.
// Cast through `unknown` so eslint's no-unsafe-argument stays quiet and
// the smoke doesn't pull in EditorContext + CarouselElement just to
// satisfy the original signature. The underlying builder/hydrater run
// against the stub document patched onto globalThis above.
const hydrateMod = (await import('./hydrate-interactives.js')) as unknown as {
  hydrateInteractives: (root: unknown, options?: { skipPopups?: boolean }) => void;
};
const bodyBuildersMod = (await import('./body-builders-data.js')) as unknown as {
  buildCarouselBodyImpl: (ctx: unknown, element: unknown) => StubElement;
};
const { hydrateInteractives } = hydrateMod;
const { buildCarouselBodyImpl } = bodyBuildersMod;

const ctxStub = { siteBase: '/api/canvas/sites/smoke-site' };

const carouselEl = {
  id: 'car-1',
  type: 'carousel' as const,
  box: { x: 0, y: 0, w: 800, h: 500, z: 1 },
  slides: [
    { id: 's1', assetId: 'asset-1', caption: 'First' },
    { id: 's2', assetId: 'asset-2' },
    { id: 's3', assetId: 'asset-3', caption: 'Third' },
  ],
  showArrows: true,
  showDots: true,
};

const wrap = buildCarouselBodyImpl(ctxStub, carouselEl);

// (1) Wrapper contract -------------------------------------------------

assert(
  wrap.getAttribute('data-opencanvas-interactive') === 'carousel',
  'wrapper must carry data-opencanvas-interactive="carousel"',
);
assert(
  wrap.getAttribute('data-opencanvas-slide-count') === '3',
  'wrapper must declare slide count = 3',
);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '0',
  'wrapper must start at slide index 0',
);
assert(
  wrap.getAttribute('data-opencanvas-carousel-mode') === 'paginate',
  'wrapper must declare paginate mode by default (matches visitor renderer)',
);
assert(
  wrap.getAttribute('data-opencanvas-hydrated') === null,
  'wrapper must not be pre-hydrated by the builder',
);

// (2) Pointer-events inline overrides on arrows + dots -----------------

const prevBtn = wrap.querySelector('[data-opencanvas-carousel-prev]');
const nextBtn = wrap.querySelector('[data-opencanvas-carousel-next]');
assert(prevBtn !== null, 'prev arrow must render');
assert(nextBtn !== null, 'next arrow must render');
assert(
  prevBtn.style.pointerEvents === 'auto',
  'prev arrow must inline pointer-events:auto so the click-shield CSS does not consume its clicks',
);
assert(
  nextBtn.style.pointerEvents === 'auto',
  'next arrow must inline pointer-events:auto',
);
const dotsContainer = wrap.querySelector('.opencanvas-carousel-dots');
assert(dotsContainer !== null, 'dots container must render');
assert(
  dotsContainer.style.pointerEvents === 'auto',
  'dots container must inline pointer-events:auto',
);
const allDots = wrap.querySelectorAll('[data-opencanvas-carousel-dot]');
assert(allDots.length === 3, 'three dots must render — one per slide');
for (let i = 0; i < allDots.length; i++) {
  const d = allDots[i];
  if (!d) continue;
  assert(
    d.style.pointerEvents === 'auto',
    'dot index ' + String(i) + ' must inline pointer-events:auto',
  );
}

// (3) Hydration ---------------------------------------------------------

const canvasRoot = new StubElement('div');
canvasRoot.appendChild(wrap);

 
hydrateInteractives(canvasRoot, { skipPopups: true });
assert(
  wrap.getAttribute('data-opencanvas-hydrated') === 'true',
  'wrapper must be marked data-opencanvas-hydrated="true" after hydrateInteractives',
);

function fireClick(target: StubElement): StubEvent {
  const ev = makeEvent('click');
  target.dispatchEvent(ev);
  return ev;
}

const clickEv1 = fireClick(nextBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '1',
  'clicking next must advance slide index to 1',
);
assert(
  clickEv1.defaultPrevented === true,
  'next click handler must preventDefault to suppress the default button activation',
);
fireClick(nextBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '2',
  'clicking next again must advance to 2',
);
fireClick(nextBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '2',
  'clicking next at end must clamp to max index 2 (no wrap-around)',
);

// Prev twice → 1 → 0, then clamp.
fireClick(prevBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '1',
  'clicking prev from end must go back to 1',
);
fireClick(prevBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '0',
  'clicking prev again must return to 0',
);
fireClick(prevBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '0',
  'clicking prev at start must clamp to 0',
);

// (4) Idempotent re-hydration ------------------------------------------

 
hydrateInteractives(canvasRoot, { skipPopups: true });
fireClick(nextBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '1',
  're-hydration must NOT double-bind listeners (one click → one advance)',
);
fireClick(prevBtn);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '0',
  'reset to 0 for propagation test',
);

// (5) stopPropagation — root click listener must NOT fire ---------------

let rootClickCount = 0;
canvasRoot.addEventListener('click', () => {
  rootClickCount += 1;
});
fireClick(nextBtn);
assert(
  rootClickCount === 0,
  'arrow click handler must stopPropagation so root-level click listener stays silent',
);

let rootMousedownCount = 0;
canvasRoot.addEventListener('mousedown', () => {
  rootMousedownCount += 1;
});
const mdEv = makeEvent('mousedown');
nextBtn.dispatchEvent(mdEv);
assert(
  rootMousedownCount === 0,
  'arrow mousedown handler must stopPropagation so the editor drag-start path stays silent',
);
assert(
  mdEv.defaultPrevented === true,
  'arrow mousedown handler must preventDefault to suppress the default button focus',
);

// (6) Dot clicks --------------------------------------------------------

const dot0 = wrap.querySelector('[data-opencanvas-carousel-dot="0"]');
const dot2 = wrap.querySelector('[data-opencanvas-carousel-dot="2"]');
assert(dot0 !== null && dot2 !== null, 'dots index 0 and 2 must exist');
fireClick(dot0);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '0',
  'clicking dot 0 must set index to 0',
);
assert(
  dot0.getAttribute('aria-selected') === 'true',
  'dot 0 aria-selected must be "true" after click',
);
fireClick(dot2);
assert(
  wrap.getAttribute('data-opencanvas-slide-index') === '2',
  'clicking dot 2 must set index to 2',
);
assert(
  dot2.getAttribute('aria-selected') === 'true',
  'dot 2 aria-selected must be "true" after click',
);
assert(
  dot0.getAttribute('aria-selected') === 'false',
  'dot 0 aria-selected must flip to "false" when dot 2 is active',
);

// (7) skipPopups guard --------------------------------------------------

const popupSec = new StubElement('section');
popupSec.setAttribute('data-opencanvas-popup', 'true');
popupSec.setAttribute('data-opencanvas-section', 'sec-1');
popupSec.setAttribute('data-opencanvas-trigger-type', 'delay');
popupSec.setAttribute('data-opencanvas-trigger-value', '60000');
const popupRoot = new StubElement('div');
popupRoot.appendChild(popupSec);
 
hydrateInteractives(popupRoot, { skipPopups: true });
assert(
  popupSec.getAttribute('data-opencanvas-popup-hydrated') === null,
  'skipPopups:true must skip popup hydration in the editor',
);

console.log('[carousel-hydration:smoke] OK');
