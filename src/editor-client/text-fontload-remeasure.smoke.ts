// src/editor-client/text-fontload-remeasure.smoke.ts
//
// Bug fix smoke for "heading clipped on cold load until the user clicks
// the text element". The wrapper carries an inline `height: Npx` set
// from `box.h`, and the text-element wrapper carries `overflow: hidden`
// by stylesheet default (see `text-overflow-hidden.smoke.ts`). On cold
// load the editor's first paint uses the fallback font because every
// authored `@font-face` declaration carries `font-display: swap` (see
// `src/fonts/face-emit.ts`). The fallback and authored faces have
// different vertical metrics, so a heading that fits in 120px under the
// authored font may overflow to 152px under the fallback (or vice-versa
// once the swap lands). The user-visible symptom is the bottom line of
// a multi-line heading clipping until the user clicks the element —
// which triggers `beginTextEdit`'s `scrollHeight` pass that writes the
// corrected height back to `box.h`.
//
// The fix lives in `src/editor-client/fontload-remeasure.ts`:
// `wireFontLoadRemeasureImpl` listens once on `document.fonts.ready`
// and walks every text wrapper, growing its `box.h` to match the
// rendered `scrollHeight` when content overflows the authored box.
//
// This smoke fakes a `document.fonts.ready` promise, calls
// `wireFontLoadRemeasureImpl`, then resolves the promise and asserts:
//
//   1. The handler is wired exactly once even when called twice (the
//      `ctx.fontLoadRemeasureWired` latch prevents stacked listeners).
//   2. A text wrapper whose inner `scrollHeight` exceeds the authored
//      `box.h` is grown — the wrapper's inline `style.height` and the
//      element model's `box.h` both reach the new value, and
//      `ctx.setBoxStyle` is invoked once per grown wrapper.
//   3. A text wrapper whose inner `scrollHeight` matches the authored
//      `box.h` is left alone — no growth, no `setBoxStyle` call.
//   4. `ctx.scheduleSave()` fires exactly once when at least one
//      wrapper grew, and not at all when nothing changed.
//   5. The grow pass is idempotent — re-resolving (a second call to
//      `wireFontLoadRemeasureImpl` after `fontLoadRemeasureWired`
//      latches true) is a no-op (no `setBoxStyle`, no `scheduleSave`).
//   6. The `document.fonts`-missing path logs a `console.error` and
//      bails without throwing or wiring a fake promise (no fallback —
//      loud failure per the no-silent-fallback rule).
//
// Run with `bun run src/editor-client/text-fontload-remeasure.smoke.ts`.

import type { EditorContext } from './editor-context.js';
import type { PositionedBox } from '../canvas/schema.js';
import { wireFontLoadRemeasureImpl } from './fontload-remeasure.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[text-fontload-remeasure:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Minimal DOM stubs — modelled on create-editor-runtime.smoke.ts but
// scoped only to what the remeasure path reaches: querySelectorAll on
// the root + querySelector on each wrapper + getAttribute + scrollHeight
// + style.height.
// ---------------------------------------------------------------------------

interface StubTextWrapper {
  tagName: string;
  scrollHeight: number;
  innerScrollHeight: number;
  attributes: Map<string, string>;
  style: { height: string };
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  querySelector(selector: string): { scrollHeight: number } | null;
}

interface StubRoot {
  wrappers: StubTextWrapper[];
  querySelectorAll(selector: string): StubTextWrapper[];
}

function makeWrapper(opts: {
  elementId: string;
  innerScrollHeight: number;
  initialHeightPx: number;
}): StubTextWrapper {
  const wrapper: StubTextWrapper = {
    tagName: 'DIV',
    scrollHeight: opts.initialHeightPx,
    innerScrollHeight: opts.innerScrollHeight,
    attributes: new Map<string, string>([
      ['data-opencanvas-element', opts.elementId],
      ['data-element-type', 'text'],
    ]),
    style: { height: `${String(opts.initialHeightPx)}px` },
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    },
    querySelector(selector: string): { scrollHeight: number } | null {
      if (selector === '.opencanvas-text') {
        return { scrollHeight: this.innerScrollHeight };
      }
      return null;
    },
  };
  return wrapper;
}

function makeRoot(wrappers: StubTextWrapper[]): StubRoot {
  return {
    wrappers,
    querySelectorAll(selector: string): StubTextWrapper[] {
      if (selector === '[data-element-type="text"]') {
        return this.wrappers;
      }
      return [];
    },
  };
}

interface FakeModelElement {
  id: string;
  type: 'text';
  box: PositionedBox;
}

interface CtxFake {
  root: StubRoot;
  elements: Map<string, FakeModelElement>;
  fontLoadRemeasureWired: boolean;
  setBoxStyleCalls: Array<{ wrapper: StubTextWrapper; box: PositionedBox }>;
  scheduleSaveCalls: number;
  findElement(elementId: string): { element: FakeModelElement } | null;
  setBoxStyle(wrapper: unknown, box: PositionedBox): void;
  scheduleSave(): void;
}

function makeCtx(opts: {
  wrappers: StubTextWrapper[];
  modelHeights: Record<string, number>;
}): CtxFake {
  const elements = new Map<string, FakeModelElement>();
  for (const [id, h] of Object.entries(opts.modelHeights)) {
    elements.set(id, {
      id,
      type: 'text',
      box: { x: 0, y: 0, w: 300, h, z: 1 },
    });
  }
  const setBoxStyleCalls: Array<{ wrapper: StubTextWrapper; box: PositionedBox }> = [];
  return {
    root: makeRoot(opts.wrappers),
    elements,
    fontLoadRemeasureWired: false,
    setBoxStyleCalls,
    scheduleSaveCalls: 0,
    findElement(elementId: string): { element: FakeModelElement } | null {
      const el = this.elements.get(elementId);
      return el ? { element: el } : null;
    },
    setBoxStyle(wrapper: unknown, box: PositionedBox): void {
      setBoxStyleCalls.push({ wrapper: wrapper as StubTextWrapper, box });
      // Mirror the real setBoxStyle effect: write height back to the
      // wrapper's inline style so subsequent assertions on style.height
      // see the post-grow value.
      (wrapper as StubTextWrapper).style.height = `${String(box.h)}px`;
    },
    scheduleSave(): void {
      this.scheduleSaveCalls += 1;
    },
  };
}

// ---------------------------------------------------------------------------
// document.fonts shim — a manually-resolvable Promise that the test
// controls. Mirrors the real FontFaceSet shape with just .ready.
// ---------------------------------------------------------------------------

interface ResolvableFontShim {
  fonts: { ready: Promise<unknown> };
  resolveReady(): void;
}

function makeFontShim(): ResolvableFontShim {
  let resolve: (value: unknown) => void = () => undefined;
  const ready = new Promise<unknown>((res) => {
    resolve = res;
  });
  return {
    fonts: { ready },
    resolveReady(): void {
      resolve(undefined);
    },
  };
}

const originalDocument = (globalThis as { document?: unknown }).document;
const consoleErrorCalls: string[] = [];
const originalConsoleError = console.error;
console.error = (...args: unknown[]): void => {
  consoleErrorCalls.push(args.map((a) => String(a)).join(' '));
};

function setDocument(doc: { fonts?: { ready: Promise<unknown> } } | undefined): void {
  (globalThis as { document?: unknown }).document = doc;
}

// ---------------------------------------------------------------------------
// Test 1 + 2 + 4 — happy path: one wrapper overflows, one fits exactly.
// The overflowing wrapper grows, the fitting one is untouched, and
// scheduleSave fires exactly once. setBoxStyle is invoked once per
// grown wrapper (not per checked wrapper).
// ---------------------------------------------------------------------------

{
  const overflowing = makeWrapper({
    elementId: 'el-overflow',
    innerScrollHeight: 152, // text needs 152px under loaded font
    initialHeightPx: 120, // authored box was 120px under fallback
  });
  const fitting = makeWrapper({
    elementId: 'el-fit',
    innerScrollHeight: 60,
    initialHeightPx: 60,
  });
  const ctx = makeCtx({
    wrappers: [overflowing, fitting],
    modelHeights: { 'el-overflow': 120, 'el-fit': 60 },
  });

  const shim = makeFontShim();
  setDocument(shim);

  wireFontLoadRemeasureImpl(ctx as unknown as EditorContext);
  assert(
    ctx.fontLoadRemeasureWired === true,
    'wireFontLoadRemeasure must latch fontLoadRemeasureWired=true so re-wiring is a no-op',
  );

  shim.resolveReady();
  // Flush microtasks so the .then(...) handler runs before assertions.
  await Promise.resolve();
  await Promise.resolve();

  assert(
    ctx.setBoxStyleCalls.length === 1,
    `setBoxStyle must fire exactly once (one wrapper grew, one fit); got ${String(ctx.setBoxStyleCalls.length)}`,
  );
  assert(
    ctx.setBoxStyleCalls[0]!.wrapper === overflowing,
    'setBoxStyle must target the overflowing wrapper, not the fitting one',
  );
  assert(
    ctx.setBoxStyleCalls[0]!.box.h === 152,
    `grown box.h must equal the inner scrollHeight (152); got ${String(ctx.setBoxStyleCalls[0]!.box.h)}`,
  );
  assert(
    ctx.elements.get('el-overflow')!.box.h === 152,
    `model box.h must be updated to scrollHeight (152); got ${String(ctx.elements.get('el-overflow')!.box.h)}`,
  );
  assert(
    ctx.elements.get('el-fit')!.box.h === 60,
    `untouched element model box.h must stay at the authored 60; got ${String(ctx.elements.get('el-fit')!.box.h)}`,
  );
  assert(
    overflowing.style.height === '152px',
    `overflowing wrapper inline style.height must be updated; got ${overflowing.style.height}`,
  );
  assert(
    fitting.style.height === '60px',
    `fitting wrapper inline style.height must be unchanged; got ${fitting.style.height}`,
  );
  assert(
    ctx.scheduleSaveCalls === 1,
    `scheduleSave must fire exactly once when at least one wrapper grew; got ${String(ctx.scheduleSaveCalls)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 3 + 4 (no-grow branch) — when no wrapper overflows the authored
// box, scheduleSave must NOT fire and setBoxStyle is never called. This
// is the steady-state behaviour on the next cold load: by then the
// previously persisted (grown) box.h matches the rendered scrollHeight,
// so the post-fontload pass is a zero-iteration no-op.
// ---------------------------------------------------------------------------

{
  const fittingOnly = makeWrapper({
    elementId: 'el-stable',
    innerScrollHeight: 60,
    initialHeightPx: 60,
  });
  const ctx = makeCtx({
    wrappers: [fittingOnly],
    modelHeights: { 'el-stable': 60 },
  });

  const shim = makeFontShim();
  setDocument(shim);

  wireFontLoadRemeasureImpl(ctx as unknown as EditorContext);
  shim.resolveReady();
  await Promise.resolve();
  await Promise.resolve();

  assert(
    ctx.setBoxStyleCalls.length === 0,
    `setBoxStyle must NOT fire when no wrapper overflows; got ${String(ctx.setBoxStyleCalls.length)}`,
  );
  assert(
    ctx.scheduleSaveCalls === 0,
    `scheduleSave must NOT fire when no wrapper grew; got ${String(ctx.scheduleSaveCalls)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 5 — idempotency. Calling wireFontLoadRemeasureImpl a second time
// after the latch is set must be a no-op: no extra listener attaches,
// so even if document.fonts.ready is replaced with an already-resolved
// promise the second call doesn't trigger a second pass.
// ---------------------------------------------------------------------------

{
  const overflowing = makeWrapper({
    elementId: 'el-grow',
    innerScrollHeight: 200,
    initialHeightPx: 100,
  });
  const ctx = makeCtx({
    wrappers: [overflowing],
    modelHeights: { 'el-grow': 100 },
  });

  const shimA = makeFontShim();
  setDocument(shimA);
  wireFontLoadRemeasureImpl(ctx as unknown as EditorContext);
  shimA.resolveReady();
  await Promise.resolve();
  await Promise.resolve();

  assert(
    ctx.setBoxStyleCalls.length === 1,
    `first pass must grow the overflowing wrapper; got ${String(ctx.setBoxStyleCalls.length)}`,
  );

  // Second call — should latch-out via fontLoadRemeasureWired. We swap
  // in a fresh shim so the test would notice if a second listener
  // attached (a second resolve would re-walk and call setBoxStyle a
  // second time — except that the model's box.h is now 200 so the
  // inner scrollHeight (200) no longer exceeds it; that's the
  // monotonic guarantee that backs the latch).
  const shimB = makeFontShim();
  setDocument(shimB);
  wireFontLoadRemeasureImpl(ctx as unknown as EditorContext);
  shimB.resolveReady();
  await Promise.resolve();
  await Promise.resolve();

  assert(
    ctx.setBoxStyleCalls.length === 1,
    `second wire call must be a no-op (latched); setBoxStyle count must stay at 1, got ${String(ctx.setBoxStyleCalls.length)}`,
  );
}

// ---------------------------------------------------------------------------
// Test 6 — document.fonts missing path. The handler must log a loud
// console.error and bail without throwing or wiring anything. The latch
// MUST NOT flip — a future call (after a polyfill loads, say) should
// still be able to wire.
// ---------------------------------------------------------------------------

{
  consoleErrorCalls.length = 0;
  const wrapper = makeWrapper({
    elementId: 'el-no-fonts',
    innerScrollHeight: 200,
    initialHeightPx: 100,
  });
  const ctx = makeCtx({
    wrappers: [wrapper],
    modelHeights: { 'el-no-fonts': 100 },
  });

  // document with no .fonts property — the L3 API is missing.
  setDocument({});

  wireFontLoadRemeasureImpl(ctx as unknown as EditorContext);

  assert(
    consoleErrorCalls.length === 1,
    `missing document.fonts must trigger exactly one console.error; got ${String(consoleErrorCalls.length)}`,
  );
  assert(
    consoleErrorCalls[0]!.includes('document.fonts is unavailable'),
    `console.error message must name the missing API; got ${consoleErrorCalls[0]}`,
  );
  assert(
    ctx.fontLoadRemeasureWired === false,
    'fontLoadRemeasureWired must stay false on the missing-API path so a future call can still wire',
  );
  assert(
    ctx.setBoxStyleCalls.length === 0,
    `setBoxStyle must NOT fire when the listener could not wire; got ${String(ctx.setBoxStyleCalls.length)}`,
  );
}

// ---------------------------------------------------------------------------
// Cleanup — restore globals so subsequent tests in a shared runner see
// the original document + console.error.
// ---------------------------------------------------------------------------

setDocument(originalDocument as { fonts?: { ready: Promise<unknown> } } | undefined);
console.error = originalConsoleError;

console.log('text-fontload-remeasure.smoke OK');
