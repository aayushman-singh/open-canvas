// src/editor-client/inspector-action-label.smoke.ts
//
// Behavioural smoke for the action element Label inspector field
// (mountActionLabel in inspector-action-label.ts). Pins:
//
//   1. Mounting against an action with `label: [{text:'Action'}]` renders
//      an <input> bound to the existing label text.
//   2. Typing into the input rewrites `element.label[0].text` (preserving
//      run 0 marks) and fires `ctx.rebuildElement` so the canvas reflects
//      the new label.
//   3. The Clear button collapses the label to `[{text:''}]` (icon-only
//      contract) and fires both rebuildElement + scheduleSave.
//   4. The mount is wired into actionInspectorSpec at position 0 so the
//      field shows up BEFORE Variant.
//
// Bare Bun has no DOM, so this smoke installs a minimal `document` stub
// (matching the action-icon-parity:smoke approach) before importing the
// mount.
//
// Run with `bun.cmd run inspector-action-label:smoke`.

import type { ActionElement } from '../canvas/schema.js';
import { actionInspectorSpec } from '../canvas/elements/action.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[inspector-action-label:smoke] ${message}`);
}

// ---- DOM stub: enough surface for mountActionLabel ---------------------
//
// mountActionLabel reaches:
//   document.createElement('div' | 'input' | 'button' | 'label')
//   node.appendChild
//   input.addEventListener('input' | 'change', fn)
//   button.addEventListener('click', fn)
//   button.setAttribute('data-action-label-clear', ...)
//   input.value (get + set)
//   input.placeholder, input.type
//   input.dispatchEvent for the smoke to fire the events
// The stub mirrors only that surface.

interface StubListener {
  type: string;
  fn: (event: { type: string }) => void;
}

interface StubNode {
  tagName: string;
  type: string;
  value: string;
  placeholder: string;
  textContent: string;
  className: string;
  style: { marginTop: string };
  attrs: Map<string, string>;
  children: StubNode[];
  listeners: StubListener[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: (event: { type: string }) => void): void;
  appendChild(child: StubNode): StubNode;
  dispatchEvent(type: string): void;
  querySelector(selector: string): StubNode | null;
  findByTag(tag: string): StubNode | null;
}

function makeStubNode(tag: string): StubNode {
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    type: '',
    value: '',
    placeholder: '',
    textContent: '',
    className: '',
    style: { marginTop: '' },
    attrs: new Map(),
    children: [],
    listeners: [],
    setAttribute(name, value) {
      this.attrs.set(name, value);
    },
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    },
    addEventListener(type, fn) {
      this.listeners.push({ type, fn });
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    dispatchEvent(type) {
      for (const lst of this.listeners) {
        if (lst.type === type) lst.fn({ type });
      }
    },
    querySelector(_selector) {
      throw new Error('querySelector not implemented in stub');
    },
    findByTag(tag) {
      const upper = tag.toUpperCase();
      if (this.tagName === upper) return this;
      for (const child of this.children) {
        const found = child.findByTag(tag);
        if (found) return found;
      }
      return null;
    },
  };
  return node;
}

interface GlobalWithDocument {
  document?: { createElement(tag: string): StubNode };
}
const globalRef = globalThis as unknown as GlobalWithDocument;
const savedDocument = globalRef.document;
globalRef.document = {
  createElement(tag) {
    return makeStubNode(tag);
  },
};

// Import the mount AFTER the stub is installed so any top-level DOM
// reach in the import graph (none today) sees the stub.
const { mountActionLabel } = await import('./inspector-action-label.js');

// ---- Minimal EditorContext stub ----------------------------------------

interface RebuildLog {
  rebuildCalls: string[];
  saveCalls: number;
  statusCalls: { message: string; tone: string | undefined }[];
}

function makeCtx(): { ctx: Parameters<typeof mountActionLabel>[0]; log: RebuildLog } {
  const log: RebuildLog = { rebuildCalls: [], saveCalls: 0, statusCalls: [] };
  const ctx = {
    rebuildElement: (id: string) => {
      log.rebuildCalls.push(id);
    },
    scheduleSave: () => {
      log.saveCalls += 1;
    },
    setStatus: (message: string, tone?: string) => {
      log.statusCalls.push({ message, tone });
    },
  } as unknown as Parameters<typeof mountActionLabel>[0];
  return { ctx, log };
}

// ---- Contract 1: spec puts Label BEFORE Variant ------------------------
//
// The Variant select / Icon picker / Link Type are useful but secondary;
// the first thing the user wants to do after selecting an action is to
// rename it. Pin the spec order so a future refactor that shuffles the
// fields doesn't silently bury the label editor.

{
  const fields = actionInspectorSpec.fields;
  const labelIdx = fields.findIndex(
    (f) => f.kind === 'custom-mount' && f.name === 'action-label',
  );
  const variantIdx = fields.findIndex(
    (f) => 'path' in f && f.path === 'variant',
  );
  assert(labelIdx >= 0, 'actionInspectorSpec must include the action-label custom-mount field');
  assert(variantIdx >= 0, 'actionInspectorSpec must include the variant field');
  assert(
    labelIdx < variantIdx,
    `Label must come BEFORE Variant in the inspector (got labelIdx=${labelIdx}, variantIdx=${variantIdx})`,
  );
  assert(labelIdx === 0, `Label must be the first inspector field (got idx ${labelIdx})`);
}

// ---- Contract 2: input renders with the existing label text -----------

{
  const action: ActionElement = {
    id: 'a-label-1',
    type: 'action',
    box: { x: 0, y: 0, w: 120, h: 40, z: 1 },
    label: [{ text: 'Sign up' }],
    href: { type: 'external', url: 'https://example.com' },
    variant: 'solid',
  };
  const host = makeStubNode('div');
  const { ctx } = makeCtx();

  mountActionLabel(ctx, action, host as unknown as HTMLElement);

  const input = host.findByTag('input');
  assert(input !== null, 'mount must create an <input> for the label text');
  const ti = input!;
  assert(ti.type === 'text', `input.type must be "text" (got "${ti.type}")`);
  assert(
    ti.value === 'Sign up',
    `input must seed with the existing label text "Sign up" (got "${ti.value}")`,
  );
  assert(
    ti.placeholder.length > 0,
    `input must carry a placeholder hint (got "${ti.placeholder}")`,
  );
}

// ---- Contract 3: typing rewrites label[0].text + rebuilds -------------
//
// The mount registers an 'input' handler that fires on every keystroke
// so the canvas preview tracks what the user is typing. We simulate the
// keystroke by setting input.value and dispatching 'input'.

{
  const action: ActionElement = {
    id: 'a-label-2',
    type: 'action',
    box: { x: 0, y: 0, w: 120, h: 40, z: 1 },
    label: [{ text: 'Old', marks: [{ type: 'bold' }] }],
    href: { type: 'external', url: 'https://example.com' },
    variant: 'solid',
  };
  const host = makeStubNode('div');
  const { ctx, log } = makeCtx();

  mountActionLabel(ctx, action, host as unknown as HTMLElement);

  const input = host.findByTag('input')!;
  input.value = 'New label';
  input.dispatchEvent('input');

  assert(
    action.label[0]!.text === 'New label',
    `typing must rewrite label[0].text (got "${action.label[0]!.text}")`,
  );
  // run 0 was bold before — typing only edits .text so the bold mark must
  // survive (otherwise marks set via the agent tool get clobbered on
  // every keystroke).
  const marks = action.label[0]!.marks;
  assert(
    Array.isArray(marks) && marks.length === 1 && marks[0]!.type === 'bold',
    'typing must preserve existing marks on run 0 (got ' + JSON.stringify(marks) + ')',
  );
  assert(
    log.rebuildCalls.length === 1 && log.rebuildCalls[0] === 'a-label-2',
    'typing must call rebuildElement(id) exactly once per keystroke (got ' +
      JSON.stringify(log.rebuildCalls) +
      ')',
  );

  // scheduleSave is deferred until the change event (blur / Enter) so
  // we don't fan out a save per keystroke. Fire 'change' to verify.
  input.dispatchEvent('change');
  assert(
    log.saveCalls === 1,
    `change event must scheduleSave exactly once (got ${log.saveCalls})`,
  );
}

// ---- Contract 4: Clear button collapses to icon-only ------------------

{
  const action: ActionElement = {
    id: 'a-label-3',
    type: 'action',
    box: { x: 0, y: 0, w: 48, h: 48, z: 1 },
    label: [{ text: 'Verbose label', marks: [{ type: 'italic' }] }],
    href: { type: 'external', url: 'https://example.com' },
    variant: 'solid',
    iconKind: 'arrow-up-right',
  };
  const host = makeStubNode('div');
  const { ctx, log } = makeCtx();

  mountActionLabel(ctx, action, host as unknown as HTMLElement);

  const clearBtn = host.findByTag('button');
  assert(clearBtn !== null, 'mount must include a Clear button');
  const cb = clearBtn!;
  assert(
    (cb.attrs.get('data-action-label-clear') ?? '') === 'a-label-3',
    'Clear button must carry data-action-label-clear=<id> for editor smokes / e2e selectors',
  );

  cb.dispatchEvent('click');

  assert(
    action.label.length === 1 && action.label[0]!.text === '',
    `Clear must collapse label to [{text:''}] (got ${JSON.stringify(action.label)})`,
  );
  // Clearing drops marks — an icon-only button has no visible run to
  // carry bold/italic, and a stale mark on an empty run is dead state.
  assert(
    action.label[0]!.marks === undefined,
    `Clear must drop run-0 marks (got ${JSON.stringify(action.label[0]!.marks)})`,
  );
  const input = host.findByTag('input')!;
  assert(input.value === '', `Clear must blank the input (got "${input.value}")`);
  assert(
    log.rebuildCalls.includes('a-label-3'),
    'Clear must rebuildElement to refresh the canvas preview',
  );
  assert(log.saveCalls >= 1, 'Clear must scheduleSave so the new shape persists');
}

// ---- Contract 4b: Clear refuses when no iconKind is set ---------------
//
// Icon-only is a legitimate authoring state ONLY when there IS an icon to
// carry the visible content. Clear without an iconKind would leave the
// action with nothing visible — the validator coerces that back to a
// "Button" label, but the editor should not produce the state to begin
// with. Pin the refusal so a future refactor can't quietly drop it.

{
  const action: ActionElement = {
    id: 'a-label-no-icon',
    type: 'action',
    box: { x: 0, y: 0, w: 200, h: 48, z: 1 },
    label: [{ text: 'Sign up' }],
    href: { type: 'external', url: 'https://example.com' },
    variant: 'solid',
  };
  const host = makeStubNode('div');
  const { ctx, log } = makeCtx();

  mountActionLabel(ctx, action, host as unknown as HTMLElement);

  const clearBtn = host.findByTag('button')!;
  clearBtn.dispatchEvent('click');

  // Label must NOT have been collapsed — the original text stays put.
  assert(
    action.label.length === 1 && action.label[0]!.text === 'Sign up',
    `Clear without iconKind must leave the label intact (got ${JSON.stringify(action.label)})`,
  );
  // No persistence side-effects fired.
  assert(
    log.rebuildCalls.length === 0,
    `Refused Clear must NOT rebuildElement (got ${JSON.stringify(log.rebuildCalls)})`,
  );
  assert(
    log.saveCalls === 0,
    `Refused Clear must NOT scheduleSave (got ${String(log.saveCalls)})`,
  );
  // A status was surfaced naming the missing icon as the reason.
  assert(
    log.statusCalls.length === 1 && log.statusCalls[0]!.tone === 'error',
    `Refused Clear must surface an error status (got ${JSON.stringify(log.statusCalls)})`,
  );
  assert(
    log.statusCalls[0]!.message.toLowerCase().includes('icon'),
    `Refused Clear status must name the icon as the reason (got "${log.statusCalls[0]!.message}")`,
  );
}

// ---- Contract 5: invalid label state fails loudly ---------------------
//
// The validator rejects an empty array at-rest. If one reaches the custom
// mount, the editor must surface that validation-gate breach instead of
// silently repairing it into a valid-looking empty run.

{
  const action = {
    id: 'a-label-4',
    type: 'action' as const,
    box: { x: 0, y: 0, w: 48, h: 48, z: 1 },
    label: [] as ActionElement['label'],
    href: { type: 'external' as const, url: 'https://example.com' },
    variant: 'solid' as const,
  } as ActionElement;
  const host = makeStubNode('div');
  const { ctx } = makeCtx();

  let message = '';
  try {
    mountActionLabel(ctx, action, host as unknown as HTMLElement);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }

  assert(
    message.includes('a-label-4') && message.includes('label'),
    'mount must throw with element id + label context when label is invalid (got "' +
      message +
      '")',
  );
  assert(action.label.length === 0, 'mount must not mutate invalid label arrays while throwing');
}

// ---- Teardown ---------------------------------------------------------

if (savedDocument === undefined) {
  delete (globalRef as { document?: unknown }).document;
} else {
  globalRef.document = savedDocument;
}

console.log('[inspector-action-label:smoke] OK');
