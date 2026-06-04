// src/editor-client/set-active-page-pan.smoke.ts
//
// Pins the user-visible contract for setActivePage: flipping the active
// page must bring the new page into the viewport. Pre-fix, link-popover's
// "Go to {pageName}" button only flipped data-active on the new artboard
// without panning the camera, so the user saw "nothing happened" until
// they manually zoomed out and discovered the active page sitting hundreds
// of pixels off-screen.
//
// Repro shape (from the original bug report):
//   - 6 pages laid out as a horizontal strip (page.width=1440 + gap=120 →
//     each artboard 1560px apart in world-space).
//   - Camera at { x: 0, y: 0, zoom: 1 }, showing page 0 at viewport-left.
//   - User clicks an action with href {type: 'page', pageId: page-1}.
//   - link-popover.ts calls ctx.setActivePage(page-1).
//   - Expected: camera.x moves so page-1's left edge lands in the
//     viewport (with a 64px breathing-room inset).
//   - Pre-fix actual: camera unchanged, page-1 sits ~1500px off the right
//     edge of the viewport.
//
// Run with `bun.cmd run src/editor-client/set-active-page-pan.smoke.ts`.

import type { EditorContext } from './editor-context.js';
import { setActivePageImpl } from './page-crud.js';
import { panToPage } from './render.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[set-active-page-pan:smoke] ${message}`);
}

// ---- Minimal viewport/root DOM stubs ----------------------------------
//
// setActivePageImpl reaches:
//   - ctx.activePageId (write)
//   - ctx.selectElement / ctx.selectSection (stubbed)
//   - ctx.renderInspector / ctx.renderReel / ctx.updatePageSidebar (stubbed)
//   - ctx.root.querySelectorAll('.opencanvas-artboard') + setAttribute
//   - refreshPageCrumbImpl → document.querySelector('[data-page-crumb-label]')
//   - panToPage → ctx.viewport.getBoundingClientRect, ctx.camera,
//     ctx.pagePositions, applyCameraTransform → ctx.root.style.transform
//
// The stubs implement just that surface; anything else surfaces as a
// TypeError so future reach in setActivePage fails loudly here.

interface StubElement {
  tagName: string;
  attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  style: Record<string, string>;
  textContent: string;
}

function makeStubArtboard(pageId: string): StubElement {
  const attrs = new Map<string, string>([
    ['data-page-id', pageId],
    ['data-active', pageId === 'page-0' ? 'true' : 'false'],
  ]);
  return {
    tagName: 'DIV',
    attrs,
    setAttribute(name, value) {
      this.attrs.set(name, value);
    },
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    },
    style: {},
    textContent: '',
  };
}

const artboards: StubElement[] = [
  makeStubArtboard('page-0'),
  makeStubArtboard('page-1'),
];

const rootStub: StubElement & {
  querySelectorAll(sel: string): StubElement[];
} = {
  tagName: 'DIV',
  attrs: new Map(),
  setAttribute(name, value) {
    this.attrs.set(name, value);
  },
  getAttribute(name) {
    return this.attrs.get(name) ?? null;
  },
  style: {},
  textContent: '',
  querySelectorAll(sel: string): StubElement[] {
    if (sel === '.opencanvas-artboard') return artboards;
    return [];
  },
};

const VIEWPORT_LEFT = 340; // sidebar-offset, matches the reported repro
const VIEWPORT_TOP = 80;
const VIEWPORT_WIDTH = 1535;
const VIEWPORT_HEIGHT = 900;

const viewportStub: { getBoundingClientRect(): DOMRect } = {
  getBoundingClientRect(): DOMRect {
    return {
      left: VIEWPORT_LEFT,
      top: VIEWPORT_TOP,
      right: VIEWPORT_LEFT + VIEWPORT_WIDTH,
      bottom: VIEWPORT_TOP + VIEWPORT_HEIGHT,
      width: VIEWPORT_WIDTH,
      height: VIEWPORT_HEIGHT,
      x: VIEWPORT_LEFT,
      y: VIEWPORT_TOP,
      toJSON() {
        return {};
      },
    };
  },
};

// ---- Minimal document stub (refreshPageCrumbImpl reads document) -----

interface GlobalWithDocument {
  document?: { querySelector(sel: string): StubElement | null };
}

const globalRef = globalThis as unknown as GlobalWithDocument;
const savedDocument = globalRef.document;
globalRef.document = {
  querySelector(_sel: string): StubElement | null {
    return null; // refreshPageCrumbImpl no-ops cleanly when null
  },
};

try {
  // ---- Ctx fixture ---------------------------------------------------
  //
  // 2-page horizontal-strip layout, identity-matrix camera. Matches the
  // bug report's geometry — page-1's left edge sits 1560px to the right
  // of page-0 (page-width 1440 + PAGE_GAP 120).

  let renderInspectorCalls = 0;
  let renderReelCalls = 0;
  let updatePageSidebarCalls = 0;
  const selectElementCalls: Array<string | null> = [];
  const selectSectionCalls: Array<string | null> = [];

  interface PageFixture {
    id: string;
    slug: string;
    title: string;
  }
  const pageFixtures: PageFixture[] = [
    { id: 'page-0', slug: 'home', title: 'Home' },
    { id: 'page-1', slug: 'blog', title: 'Blog' },
  ];

  const ctxConcrete = {
    activePageId: 'page-0' as string | null,
    state: { pages: pageFixtures },
    root: rootStub as unknown,
    viewport: viewportStub as unknown,
    camera: { x: 0, y: 0, zoom: 1 },
    pagePositions: [
      { pageId: 'page-0', x: 0, y: 40, width: 1440, height: 800 },
      { pageId: 'page-1', x: 1560, y: 40, width: 1440, height: 800 },
    ],
    selectElement(id: string | null): void {
      selectElementCalls.push(id);
    },
    selectSection(id: string | null): void {
      selectSectionCalls.push(id);
    },
    renderInspector(): void {
      renderInspectorCalls++;
    },
    renderReel(): void {
      renderReelCalls++;
    },
    updatePageSidebar(): void {
      updatePageSidebarCalls++;
    },
    currentPage(): PageFixture | null {
      const id = ctxConcrete.activePageId;
      const found = pageFixtures.find((p) => p.id === id);
      return found ?? null;
    },
    zoomReadout: null,
  };
  const ctx = ctxConcrete as unknown as EditorContext;

  // ---- Case 1: pan-only (page fits at current zoom) ------------------

  setActivePageImpl(ctx, 'page-1');

  // Selection cleared on every page switch.
  assert(
    selectElementCalls.length === 1 && selectElementCalls[0] === null,
    'setActivePage must clear element selection on switch',
  );
  assert(
    selectSectionCalls.length === 1 && selectSectionCalls[0] === null,
    'setActivePage must clear section selection on switch',
  );

  // DOM data-active flipped.
  assert(
    artboards[0]?.getAttribute('data-active') === 'false',
    'previously active page must lose data-active="true"',
  );
  assert(
    artboards[1]?.getAttribute('data-active') === 'true',
    'newly active page must gain data-active="true"',
  );

  // Camera panned. Page-1 world.x=1560, zoom=1, PAD=64 →
  // camera.x = 64 - 1560 = -1496. This places page-1's left edge at
  // screen.x = 1560 * 1 + (-1496) + 340 (rect.left) = 404, which is
  // 64px inside the viewport's left edge (340) — the breathing-room
  // inset we promised.
  assert(
    ctx.camera.x === 64 - 1560,
    `camera.x must pan to 64 - 1560 = -1496 (got ${ctx.camera.x})`,
  );
  assert(
    ctx.camera.y === 64 - 40,
    `camera.y must pan to 64 - 40 = 24 (got ${ctx.camera.y})`,
  );
  assert(ctx.camera.zoom === 1, `zoom must be preserved (got ${ctx.camera.zoom})`);

  // Page-1's left edge after panning, in screen coords:
  //   screen.x = world.x * zoom + camera.x + viewport.left
  //   = 1560 + (-1496) + 340 = 404
  // viewport.left = 340, viewport.right = 1875. 404 is inside.
  const page1ScreenLeft = 1560 * ctx.camera.zoom + ctx.camera.x + VIEWPORT_LEFT;
  assert(
    page1ScreenLeft >= VIEWPORT_LEFT && page1ScreenLeft < VIEWPORT_LEFT + VIEWPORT_WIDTH,
    `page-1 left edge (${page1ScreenLeft}) must land inside viewport ` +
      `[${VIEWPORT_LEFT}, ${VIEWPORT_LEFT + VIEWPORT_WIDTH})`,
  );

  // applyCameraTransform was called → root.style.transform reflects the
  // camera.
  const transform = rootStub.style.transform;
  assert(
    typeof transform === 'string' && transform.includes('translate(-1496px, 24px)'),
    `root.style.transform must reflect the new camera (got ${transform})`,
  );

  assert(renderInspectorCalls === 1, 'inspector must re-render once per page switch');
  assert(renderReelCalls === 1, 'reel must re-render once per page switch');
  assert(updatePageSidebarCalls === 1, 'page sidebar must re-render once per page switch');

  // ---- Case 2: page-width > viewport-width at current zoom -----------
  //
  // panToPage must fall through to fitToPage when the page can't fit at
  // the current zoom. Set a viewport narrower than the page and call
  // panToPage directly to exercise the branch.

  const narrowViewport: { getBoundingClientRect(): DOMRect } = {
    getBoundingClientRect(): DOMRect {
      return {
        left: 0,
        top: 0,
        right: 800,
        bottom: 600,
        width: 800,
        height: 600,
        x: 0,
        y: 0,
        toJSON() {
          return {};
        },
      };
    },
  };

  const narrowPage: PageFixture = { id: 'page-0', slug: 'home', title: 'Home' };
  const narrowCtx = {
    activePageId: 'page-0' as string | null,
    state: { pages: [narrowPage] },
    root: rootStub as unknown,
    viewport: narrowViewport as unknown,
    camera: { x: 0, y: 0, zoom: 1 },
    pagePositions: [{ pageId: 'page-0', x: 0, y: 40, width: 1440, height: 800 }],
    currentPage(): PageFixture | null {
      return narrowPage;
    },
    zoomReadout: null,
  } as unknown as EditorContext;

  panToPage(narrowCtx, 'page-0');

  // fitToPage clamps zoom to ZOOM_MAX_FIT (1.0) and Math.min(scaleX, scaleY).
  // availW = 800 - 128 = 672; scaleX = 672/1440 ≈ 0.47; availH = 600-128 = 472;
  // scaleY = 472/800 = 0.59. min = 0.47, clampZoom snaps to one-decimal = 0.5.
  // So zoom should drop from 1 to ~0.5 — definitely less than 1.
  assert(
    narrowCtx.camera.zoom < 1,
    `narrow viewport must trigger zoom-out (got zoom=${narrowCtx.camera.zoom})`,
  );

  console.log('[set-active-page-pan:smoke] OK');
} finally {
  if (savedDocument === undefined) {
    delete globalRef.document;
  } else {
    globalRef.document = savedDocument;
  }
}
