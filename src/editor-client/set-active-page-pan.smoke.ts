// src/editor-client/set-active-page-pan.smoke.ts
//
// Pins the user-visible contract for setActivePage: flipping the active
// page must NOT move the camera. The earlier contract panned the camera
// to inset the new page at viewport-left+64px, which was jarring on every
// element click that crossed an inactive artboard (the click handler
// activates the page as a side effect of selecting the element). The
// pan is now opt-in via direct panToPage() calls — setActivePage stays
// camera-pure.
//
// panToPage itself still exists as a primitive and its fit-to-page
// fallback contract (case 2 below) is still pinned for explicit callers.
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
    // ADR 0065 D6 — setActivePageImpl exits any active template-edit on
    // page switch. Stub the field + verb so the call is a no-op here.
    editingCollectionTemplate: null as { collectionId: string } | null,
    exitCollectionTemplateEdit(): void {
      ctxConcrete.editingCollectionTemplate = null;
    },
  };
  const ctx = ctxConcrete as unknown as EditorContext;

  // ---- Case 1: setActivePage is camera-pure --------------------------

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

  // Camera untouched — setActivePage no longer pans.
  assert(ctx.camera.x === 0, `camera.x must stay at 0 (got ${ctx.camera.x})`);
  assert(ctx.camera.y === 0, `camera.y must stay at 0 (got ${ctx.camera.y})`);
  assert(ctx.camera.zoom === 1, `zoom must stay at 1 (got ${ctx.camera.zoom})`);

  // applyCameraTransform was never called → root.style.transform is unset.
  assert(
    rootStub.style.transform === undefined,
    `root.style.transform must remain unset (got ${rootStub.style.transform})`,
  );

  assert(renderInspectorCalls === 1, 'inspector must re-render once per page switch');
  assert(renderReelCalls === 1, 'reel must re-render once per page switch');
  assert(updatePageSidebarCalls === 1, 'page sidebar must re-render once per page switch');

  // ---- Case 2: panToPage centers + preserves zoom (even when oversized)
  //
  // panToPage must center the target page in the viewport at the current
  // zoom and never touch camera.zoom — even when the page is wider than
  // the viewport at that zoom (the user can manually zoom out). Pre-fix,
  // panToPage fell through to fitToPage in that case and silently
  // shrank the whole canvas, which surprised callers expecting a pan.

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

  assert(
    narrowCtx.camera.zoom === 1,
    `panToPage must preserve zoom even when page is wider than viewport (got zoom=${narrowCtx.camera.zoom})`,
  );
  // Centering: camera.x = (800 - 1440*1)/2 - 0*1 = -320
  //            camera.y = (600 - 800*1)/2  - 40*1 = -140
  assert(
    narrowCtx.camera.x === (800 - 1440) / 2,
    `camera.x must center the page (got ${narrowCtx.camera.x}, want ${(800 - 1440) / 2})`,
  );
  assert(
    narrowCtx.camera.y === (600 - 800) / 2 - 40,
    `camera.y must center the page (got ${narrowCtx.camera.y}, want ${(600 - 800) / 2 - 40})`,
  );

  // ---- Case 3: panToPage centers a page that DOES fit ----------------
  //
  // The common case: page narrower than the viewport at the current zoom.
  // Re-use the original viewportStub (1535 wide) and panToPage page-1.
  // Page-1 is at world.x = 1560, width = 1440. At zoom 1:
  //   camera.x = (1535 - 1440)/2 - 1560*1 = 47.5 - 1560 = -1512.5
  //   camera.y = (900 - 800)/2 - 40 = 50 - 40 = 10
  panToPage(ctx, 'page-1');
  assert(
    ctx.camera.x === (VIEWPORT_WIDTH - 1440) / 2 - 1560,
    `camera.x must center page-1 (got ${ctx.camera.x})`,
  );
  assert(
    ctx.camera.y === (VIEWPORT_HEIGHT - 800) / 2 - 40,
    `camera.y must center page-1 vertically (got ${ctx.camera.y})`,
  );
  assert(ctx.camera.zoom === 1, `zoom preserved on centering pan (got ${ctx.camera.zoom})`);

  console.log('[set-active-page-pan:smoke] OK');
} finally {
  if (savedDocument === undefined) {
    delete globalRef.document;
  } else {
    globalRef.document = savedDocument;
  }
}
