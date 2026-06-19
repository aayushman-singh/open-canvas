// src/interactive/pointer-fx.smoke.ts
//
// ADR 0066 dec 4 + dec 5 — pointer-fx runtime + injection. `bun run pointer-fx:smoke`.
//
// Asserts:
//   1. INJECTION (dec 5): a snapshot whose ONLY element is a Form with the
//      `spotlight` variant — no accordion/carousel — still trips
//      `snapshotNeedsInteractiveRuntime`, so the runtime hydrates. A Form with
//      the `classic` variant (no pointer-fx) does not trip it on its own.
//   2. PUBLISH: evaluating `POINTER_FX_RUNTIME_SRC` and firing a synthetic
//      `pointermove` publishes the expected `--opencanvas-ptr-*` (spotlight),
//      `--opencanvas-tilt-*` (tilt), and `--opencanvas-magnetic-*` (magnetic)
//      custom properties; `pointerleave` recentres them (the authored static
//      base, dec 6).
//   3. IDEMPOTENCE: re-running the pass does not double-wire listeners.
//
// No jsdom — a minimal hand-rolled element/scope stub exposes exactly the DOM
// surface the fragment touches.

import type { CanvasElement, PublishedSnapshot } from '../canvas/schema.js';
import type { FormElement } from '../canvas/elements/index.js';
import { snapshotNeedsInteractiveRuntime } from './inject.js';
import { POINTER_FX_RUNTIME_SRC } from './pointer-fx.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[pointer-fx:smoke] ${message}`);
}

function form(variant: FormElement['variant']): FormElement {
  return {
    id: 'el-form',
    type: 'form',
    box: { x: 0, y: 0, w: 600, h: 400, z: 1 },
    fields: [{ id: 'name', label: 'Name', kind: 'text', required: true }],
    submitLabel: 'Send',
    successMessage: 'Thanks',
    ...(variant !== undefined ? { variant } : {}),
  };
}

function snapshotWith(elements: CanvasElement[]): PublishedSnapshot {
  return {
    version: 1,
    publishedAt: '2026-06-02T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-smoke',
        slug: 'index',
        title: 'pfx',
        width: 1440,
        sections: [
          { id: 'sec', recipeId: 'feature-grid', name: 'S', height: 800, elements },
        ],
      },
    ],
  };
}

// -- 1. injection trips on pointer-fx with no interactive element type --------
{
  assert(
    snapshotNeedsInteractiveRuntime(snapshotWith([form('spotlight')])) === true,
    'a lone spotlight Form must trip the interactive runtime (dec 5)',
  );
  assert(
    snapshotNeedsInteractiveRuntime(snapshotWith([form('classic')])) === false,
    'a lone classic Form must NOT trip the interactive runtime',
  );
  assert(
    snapshotNeedsInteractiveRuntime(snapshotWith([form(undefined)])) === false,
    'a lone Form with no variant (defaults classic) must NOT trip the runtime',
  );
}

// -- Minimal DOM stub for the runtime publish test ---------------------------
interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}
type Listener = (ev: { clientX: number; clientY: number }) => void;

function makeStub(primitive: string, rect: Rect) {
  const attrs: Record<string, string> = {
    'data-opencanvas-pointer-fx': primitive,
    'data-opencanvas-pointer-fx-reduced-motion': 'allow',
  };
  const props: Record<string, string> = {};
  const listeners: Record<string, Listener[]> = {};
  const children: Array<{
    attrs: Record<string, string>;
    className: string;
    removed: boolean;
    style: Record<string, string>;
    remove(): void;
    setAttribute(k: string, v: string): void;
  }> = [];
  const ownerDocument = {
    createElement(): (typeof children)[number] {
      const child = {
        attrs: {} as Record<string, string>,
        className: '',
        removed: false,
        style: {} as Record<string, string>,
        remove(): void {
          child.removed = true;
        },
        setAttribute(k: string, v: string): void {
          child.attrs[k] = v;
        },
      };
      return child;
    },
  };
  const el = {
    attrs,
    children,
    ownerDocument,
    props,
    listeners,
    getAttribute(k: string): string | null {
      return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k]! : null;
    },
    setAttribute(k: string, v: string): void {
      attrs[k] = v;
    },
    addEventListener(t: string, fn: Listener): void {
      (listeners[t] ||= []).push(fn);
    },
    getBoundingClientRect(): Rect {
      return rect;
    },
    appendChild(child: (typeof children)[number]): (typeof children)[number] {
      children.push(child);
      return child;
    },
    style: {
      setProperty(k: string, v: string): void {
        props[k] = v;
      },
    },
  };
  return el;
}

// Evaluate the fragment string exactly as the visitor would, then hand back the
// `hydratePointerFx` function it defines. The constructor result is cast to a
// concrete call signature so invoking it is type-safe (not an unsafe call).
type HydratePointerFx = (scope: { querySelectorAll(sel: string): unknown[] }) => void;
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const makeHydratePointerFx = new Function(
  `${POINTER_FX_RUNTIME_SRC}\nreturn hydratePointerFx;`,
) as () => HydratePointerFx;
const hydratePointerFx = makeHydratePointerFx();

// -- 2a. spotlight publishes --opencanvas-ptr-x/y ----------------------------
{
  const el = makeStub('spotlight', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  assert((el.listeners['pointermove']?.length ?? 0) === 1, 'spotlight must wire pointermove');
  el.listeners['pointermove']![0]!({ clientX: 100, clientY: 50 }); // centre
  assert(el.props['--opencanvas-ptr-x'] === '50.00%', `ptr-x should be 50%; got ${el.props['--opencanvas-ptr-x']}`);
  assert(el.props['--opencanvas-ptr-y'] === '50.00%', `ptr-y should be 50%; got ${el.props['--opencanvas-ptr-y']}`);
  el.listeners['pointermove']![0]!({ clientX: 200, clientY: 100 }); // bottom-right
  assert(el.props['--opencanvas-ptr-x'] === '100.00%', `ptr-x should be 100%; got ${el.props['--opencanvas-ptr-x']}`);
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-ptr-x'] === '50%', 'pointerleave recentres ptr-x to the static base');
}

// -- 2b. tilt publishes --opencanvas-tilt-x/y --------------------------------
{
  const el = makeStub('tilt', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 100, clientY: 50 }); // centre → 0deg
  assert(el.props['--opencanvas-tilt-x'] === '0.00deg', `tilt-x centre should be 0deg; got ${el.props['--opencanvas-tilt-x']}`);
  el.listeners['pointermove']![0]!({ clientX: 200, clientY: 50 }); // right edge → +6deg
  assert(el.props['--opencanvas-tilt-x'] === '6.00deg', `tilt-x right edge should be 6deg; got ${el.props['--opencanvas-tilt-x']}`);
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-tilt-x'] === '0deg', 'pointerleave recentres tilt-x to 0deg');
}

// -- 2c. magnetic publishes --opencanvas-magnetic-x/y -------------------------
{
  const el = makeStub('magnetic', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 200, clientY: 100 }); // bottom-right
  assert(
    el.props['--opencanvas-magnetic-x'] === '12.00px',
    `magnetic-x right edge should be 12px; got ${el.props['--opencanvas-magnetic-x']}`,
  );
  assert(
    el.props['--opencanvas-magnetic-y'] === '12.00px',
    `magnetic-y bottom edge should be 12px; got ${el.props['--opencanvas-magnetic-y']}`,
  );
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-magnetic-x'] === '0px', 'pointerleave recentres magnetic-x to 0px');
  assert(el.props['--opencanvas-magnetic-y'] === '0px', 'pointerleave recentres magnetic-y to 0px');
}

// -- 2d. cursor-follow publishes --opencanvas-cursor-follow-x/y ---------------
{
  const el = makeStub('cursor-follow', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 200, clientY: 100 }); // bottom-right
  assert(
    el.props['--opencanvas-cursor-follow-x'] === '48.00px',
    `cursor-follow-x right edge should be 48px; got ${el.props['--opencanvas-cursor-follow-x']}`,
  );
  assert(
    el.props['--opencanvas-cursor-follow-y'] === '48.00px',
    `cursor-follow-y bottom edge should be 48px; got ${el.props['--opencanvas-cursor-follow-y']}`,
  );
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-cursor-follow-x'] === '0px', 'pointerleave recentres cursor-follow-x to 0px');
  assert(el.props['--opencanvas-cursor-follow-y'] === '0px', 'pointerleave recentres cursor-follow-y to 0px');
}

// -- 2e. reveal-mask publishes --opencanvas-reveal-x/y ------------------------
{
  const el = makeStub('reveal-mask', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 40, clientY: 75 });
  assert(
    el.props['--opencanvas-reveal-x'] === '20.00%',
    `reveal-mask x should be 20%; got ${el.props['--opencanvas-reveal-x']}`,
  );
  assert(
    el.props['--opencanvas-reveal-y'] === '75.00%',
    `reveal-mask y should be 75%; got ${el.props['--opencanvas-reveal-y']}`,
  );
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-reveal-x'] === '50%', 'pointerleave recentres reveal-mask x to 50%');
  assert(el.props['--opencanvas-reveal-y'] === '50%', 'pointerleave recentres reveal-mask y to 50%');
}

// -- 2f. pointer-parallax publishes --opencanvas-parallax-x/y -----------------
{
  const el = makeStub('pointer-parallax', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 200, clientY: 100 }); // bottom-right
  assert(
    el.props['--opencanvas-parallax-x'] === '-9.00px',
    `parallax-x right edge should be -9px; got ${el.props['--opencanvas-parallax-x']}`,
  );
  assert(
    el.props['--opencanvas-parallax-y'] === '-9.00px',
    `parallax-y bottom edge should be -9px; got ${el.props['--opencanvas-parallax-y']}`,
  );
  el.listeners['pointerleave']![0]!({ clientX: 0, clientY: 0 });
  assert(el.props['--opencanvas-parallax-x'] === '0px', 'pointerleave recentres parallax-x to 0px');
  assert(el.props['--opencanvas-parallax-y'] === '0px', 'pointerleave recentres parallax-y to 0px');
}

// -- 2g. cursor-trail appends trail nodes at pointer position -----------------
{
  const el = makeStub('cursor-trail', { left: 0, top: 0, width: 200, height: 100 });
  hydratePointerFx({ querySelectorAll: () => [el] });
  el.listeners['pointermove']![0]!({ clientX: 50, clientY: 25 });
  assert(el.children.length === 1, 'cursor-trail pointermove must append one trail node');
  assert(
    el.children[0]!.className === 'opencanvas-pointer-trail',
    `cursor-trail node class drifted: ${el.children[0]!.className}`,
  );
  assert(el.children[0]!.style.left === '25.00%', `trail left should be 25%; got ${el.children[0]!.style.left}`);
  assert(el.children[0]!.style.top === '25.00%', `trail top should be 25%; got ${el.children[0]!.style.top}`);
}

// -- 3. idempotence: re-run does not double-wire -----------------------------
{
  const el = makeStub('spotlight', { left: 0, top: 0, width: 200, height: 100 });
  const scope = { querySelectorAll: () => [el] };
  hydratePointerFx(scope);
  hydratePointerFx(scope);
  assert(
    (el.listeners['pointermove']?.length ?? 0) === 1,
    'second hydratePointerFx must be a no-op (idempotence guard)',
  );
  assert(el.getAttribute('data-opencanvas-pfx-hydrated') === 'true', 'hydrated marker must be set');
}

// -- 4. named failure event is present in the visitor source -----------------
{
  assert(
    POINTER_FX_RUNTIME_SRC.includes('opencanvas:pointer-fx-failure'),
    'pointer-fx runtime must emit a named failure event',
  );
  assert(
    POINTER_FX_RUNTIME_SRC.includes('data-opencanvas-pointer-fx-reduced-motion'),
    'pointer-fx runtime must read explicit reduced-motion metadata',
  );
}

console.log('[pointer-fx:smoke] OK');
