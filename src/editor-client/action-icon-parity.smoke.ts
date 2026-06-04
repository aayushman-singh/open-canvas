// src/editor-client/action-icon-parity.smoke.ts
//
// Regression smoke for the editor preview ↔ deployed renderer drift that
// shipped twice on the action element:
//
//   1. 2026-06-02 — `label: string → InlineRun[]` migration left
//      buildActionBodyImpl on the string path; editor showed plain text
//      while the deployed site rendered every mark. Caught by prod 500s.
//   2. (this fix) — `iconKind` shipped on the schema but
//      buildActionBodyImpl wrote `node.textContent = labelText` and
//      dropped the icon entirely; the deployed site rendered it.
//
// Both regressions had the same root cause: the editor's body-builder
// duplicates the public renderer and the two drifted silently. This
// smoke pins the contract — for an action with an icon AND a rich-text
// label, the editor builder's innerHTML must match the inner content the
// deployed renderer emits inside the wrapper.
//
// Bare Bun has no DOM, so the smoke stubs the surface
// `buildActionBodyImpl` reaches at globalThis.document and reads the
// resulting `node.innerHTML` back as a plain string.
//
// Run with `bun.cmd run src/editor-client/action-icon-parity.smoke.ts`.

import type { ActionElement } from '../canvas/schema.js';
import { renderAction } from '../canvas/elements/action.js';
import { renderIconSvg } from '../canvas/icons.js';
import { renderInlineRun } from '../canvas/elements/render-utils.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[action-icon-parity:smoke] ${message}`);
}

// ---- Minimal document stub --------------------------------------------
//
// Only the surface buildActionBodyImpl actually touches: createElement,
// setAttribute, addEventListener, mutable className, mutable innerHTML.
// Anything else surfaces as a TypeError so new DOM reach in the builder
// fails loudly here instead of silently.

interface StubElement {
  tagName: string;
  className: string;
  innerHTML: string;
  textContent: string;
  attrs: Map<string, string>;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(_type: string, _fn: unknown): void;
}

function makeStubElement(tag: string): StubElement {
  return {
    tagName: tag.toUpperCase(),
    className: '',
    innerHTML: '',
    textContent: '',
    attrs: new Map<string, string>(),
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
    },
    getAttribute(name: string): string | null {
      return this.attrs.get(name) ?? null;
    },
    addEventListener(): void {
      // no-op — events not exercised here
    },
  };
}

interface GlobalWithDocument {
  document?: { createElement(tag: string): StubElement };
}

const globalRef = globalThis as unknown as GlobalWithDocument;
const savedDocument = globalRef.document;
globalRef.document = {
  createElement(tag: string): StubElement {
    return makeStubElement(tag);
  },
};

// Import after the stub is installed so any top-level DOM reach in the
// import graph (there isn't any today, but be defensive) sees the stub.
const { buildActionBodyImpl } = await import('./body-builders-basic.js');

// ---- Minimal EditorContext --------------------------------------------
//
// buildActionBodyImpl only reaches ctx.state.pages (via the page-href
// branch of resolveActionHrefLocal) and ctx.setActivePage (only on Alt-
// click, never fired in this smoke). External href avoids both.

const ctxStub = {
  state: { pages: [] },
  setActivePage: (): void => {
    throw new Error('setActivePage should not fire in this smoke');
  },
} as unknown as Parameters<typeof buildActionBodyImpl>[0];

// ---- Case 1: icon + rich-text label, external href (anchor variant) ---

{
  const action: ActionElement = {
    id: 'a-1',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'View ' }, { text: 'project', marks: [{ type: 'bold' }] }],
    href: { type: 'external', url: 'https://example.com/p' },
    variant: 'solid',
    iconKind: 'arrow-up-right',
  };

  const node = buildActionBodyImpl(ctxStub, action) as unknown as StubElement;

  const expectedInner =
    renderIconSvg('arrow-up-right') +
    renderInlineRun({ text: 'View ' }) +
    renderInlineRun({ text: 'project', marks: [{ type: 'bold' }] });

  assert(
    node.innerHTML === expectedInner,
    'anchor-variant innerHTML must match deployed renderer.\n' +
      `  editor:   ${node.innerHTML}\n  expected: ${expectedInner}`,
  );

  // Cross-check against the public renderer's full output: the editor's
  // innerHTML must appear verbatim inside the deployed wrapper, so future
  // wrapper changes on either side surface here.
  const deployedHtml = renderAction(action, { pages: [] });
  assert(
    deployedHtml.includes(expectedInner),
    `deployed renderer must emit the same inner HTML.\n  got: ${deployedHtml}`,
  );
  assert(
    node.className === 'opencanvas-action',
    `anchor className mismatch: got "${node.className}"`,
  );
  assert(
    node.getAttribute('href') === 'https://example.com/p',
    'anchor href attribute not propagated',
  );
  assert(node.getAttribute('data-variant') === 'solid', 'anchor data-variant not propagated');
}

// ---- Case 2: copy behaviour (button variant) with icon ----------------

{
  const action: ActionElement = {
    id: 'a-2',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Copy email' }],
    behavior: { type: 'copy', value: 'hi@example.com' },
    variant: 'outline',
    iconKind: 'copy',
  };

  const node = buildActionBodyImpl(ctxStub, action) as unknown as StubElement;

  const expectedInner = renderIconSvg('copy') + renderInlineRun({ text: 'Copy email' });

  assert(
    node.innerHTML === expectedInner,
    'button-variant innerHTML must match deployed renderer.\n' +
      `  editor:   ${node.innerHTML}\n  expected: ${expectedInner}`,
  );
  assert(node.tagName === 'BUTTON', 'copy behaviour must build a <button>');
  assert(
    node.getAttribute('data-opencanvas-copy') === 'hi@example.com',
    'data-opencanvas-copy attribute not propagated',
  );
}

// ---- Case 3: no icon, plain label ------------------------------------

{
  const action: ActionElement = {
    id: 'a-3',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Plain' }],
    href: { type: 'external', url: 'https://example.com/' },
    variant: 'ghost',
  };

  const node = buildActionBodyImpl(ctxStub, action) as unknown as StubElement;
  const expectedInner = renderInlineRun({ text: 'Plain' });
  assert(
    node.innerHTML === expectedInner,
    'no-icon innerHTML must equal the rendered label runs alone',
  );
}

// ---- Teardown ---------------------------------------------------------

if (savedDocument === undefined) {
  delete (globalRef as { document?: unknown }).document;
} else {
  globalRef.document = savedDocument;
}

console.log('[action-icon-parity:smoke] OK');
