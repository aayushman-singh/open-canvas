// src/editor-client/inspector-element-state-guards.smoke.ts
//
// Behavioural smoke for the editor-side guards that keep ActionElement and
// ShapeElement states valid before the validator's coercion safety net has
// to fire. Pins three contracts that the inspector wires up:
//
//   1. Shape variant select flips to 'icon' → iconKind auto-defaults to
//      'arrow-up-right' (renderInspectorSpecImpl select branch).
//   2. Icon picker "None" tile on a Shape with variant='icon' → flips
//      variant to 'rect' AND drops iconKind together (inspector-icon-picker
//      None handler, shape branch).
//   3. Icon picker "None" tile on an Action with empty label → refused with
//      a status, no mutation, no save fired (inspector-icon-picker None
//      handler, action branch).
//
// All three live behind the editor UI surface; the smoke installs a minimal
// `document` stub and exercises the modules directly. Run with
// `bun.cmd run inspector-element-state-guards:smoke`.

import type { ActionElement, ShapeElement } from '../canvas/schema.js';
import { shapeInspectorSpec } from '../canvas/elements/shape.js';
import type { IconField } from '../canvas/elements/inspector-spec.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[inspector-element-state-guards:smoke] ${message}`);
}

// ---- DOM stub (mirrors inspector-action-label.smoke shape) -------------

interface StubListener {
  type: string;
  fn: (event: { type: string }) => void;
}

interface StubNode {
  tagName: string;
  type: string;
  value: string;
  textContent: string;
  className: string;
  innerHTML: string;
  title: string;
  style: { cssText: string; marginTop: string; background: string; color: string; borderColor: string };
  attrs: Map<string, string>;
  children: StubNode[];
  listeners: StubListener[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: (event: { type: string }) => void): void;
  appendChild(child: StubNode): StubNode;
  dispatchEvent(type: string): void;
}

function makeStubNode(tag: string): StubNode {
  const node: StubNode = {
    tagName: tag.toUpperCase(),
    type: '',
    value: '',
    textContent: '',
    className: '',
    innerHTML: '',
    title: '',
    style: { cssText: '', marginTop: '', background: '', color: '', borderColor: '' },
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
  };
  return node;
}

interface GlobalWithDocument {
  document?: { createElement(tag: string): StubNode };
  HTMLButtonElement?: unknown;
}
const globalRef = globalThis as unknown as GlobalWithDocument;
const savedDocument = globalRef.document;
const savedHTMLButtonElement = globalRef.HTMLButtonElement;
globalRef.document = {
  createElement(tag) {
    return makeStubNode(tag);
  },
};
// inspector-icon-picker calls `child instanceof HTMLButtonElement` in its
// paint() to skip the (label, none-divider) wrapper children. Stub the
// global so any StubNode with tagName === 'BUTTON' passes the check; the
// other stub nodes (DIV, etc.) fall through.
class StubHTMLButtonElement {
  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as { tagName?: string }).tagName === 'BUTTON'
    );
  }
}
globalRef.HTMLButtonElement = StubHTMLButtonElement;

// ---- Imports after stub installs ---------------------------------------

const { renderIconField } = await import('./inspector-icon-picker.js');

// ---- Minimal EditorContext stub ----------------------------------------

interface CtxLog {
  rebuildCalls: string[];
  saveCalls: number;
  inspectorRenders: number;
  statusCalls: { message: string; tone: string | undefined }[];
}

interface CtxFake {
  inspector: StubNode;
  ICON_SVG_MAP: Record<string, string>;
  rebuildElement: (id: string) => void;
  scheduleSave: () => void;
  renderInspector: () => void;
  setStatus: (message: string, tone?: string) => void;
}

function makeCtx(): { ctx: CtxFake; log: CtxLog } {
  const log: CtxLog = {
    rebuildCalls: [],
    saveCalls: 0,
    inspectorRenders: 0,
    statusCalls: [],
  };
  // A couple of stub SVGs is enough — the smoke clicks the "None" tile,
  // never one of the registered slugs, so the picker's grid just needs to
  // render without throwing.
  const ICON_SVG_MAP: Record<string, string> = {
    'arrow-up-right': '<svg data-slug="arrow-up-right"></svg>',
    check: '<svg data-slug="check"></svg>',
    copy: '<svg data-slug="copy"></svg>',
  };
  const ctx: CtxFake = {
    inspector: makeStubNode('div'),
    ICON_SVG_MAP,
    rebuildElement: (id: string) => {
      log.rebuildCalls.push(id);
    },
    scheduleSave: () => {
      log.saveCalls += 1;
    },
    renderInspector: () => {
      log.inspectorRenders += 1;
    },
    setStatus: (message: string, tone?: string) => {
      log.statusCalls.push({ message, tone });
    },
  };
  return { ctx, log };
}

// The IconField the picker is mounted with. Shape spec carries the
// showWhen guard, action spec does not.
const ICON_FIELD_FOR_SHAPE: IconField = {
  kind: 'icon',
  label: 'Icon',
  path: 'iconKind',
  showWhen: { path: 'variant', equals: 'icon' },
};
const ICON_FIELD_FOR_ACTION: IconField = {
  kind: 'icon',
  label: 'Icon',
  path: 'iconKind',
};

// Walk the inspector tree to find the "None" tile by aria-label.
function findNoneTile(node: StubNode): StubNode | null {
  if (node.getAttribute('aria-label') === 'No icon') return node;
  for (const child of node.children) {
    const found = findNoneTile(child);
    if (found) return found;
  }
  return null;
}

// ---- Contract 1: shape variant flip → iconKind auto-defaults ----------
//
// `renderInspectorSpecImpl` is the editor's generic spec interpreter. We
// don't have the full editor harness here, so instead we replicate the
// observable behaviour with a thin wrapper that mirrors the select-change
// handler the interpreter installs. This pins the *contract* without the
// full editor pull-in: anyone refactoring runtime-helpers.ts must keep the
// shape-variant-icon auto-default path intact.

{
  // Sanity: the shape spec declares iconKind as IconField with showWhen
  // pointing at variant === 'icon'. The auto-default exists precisely to
  // satisfy this conditional contract.
  const iconField = shapeInspectorSpec.fields.find(
    (f): f is IconField => f.kind === 'icon' && f.path === 'iconKind',
  );
  assert(iconField !== undefined, 'shapeInspectorSpec must declare an icon field for iconKind');
  assert(
    iconField!.showWhen?.path === 'variant' && iconField!.showWhen?.equals === 'icon',
    'shape iconKind field must showWhen variant==="icon"',
  );

  // Drive the actual interpreter through a stub document. We construct a
  // minimal shape + run the renderInspectorSpec entry point on it, then
  // simulate the variant <select>'s change event by walking the inspector
  // children for the select node.
  const shape: ShapeElement = {
    id: 'sh-flip',
    type: 'shape',
    box: { x: 0, y: 0, w: 80, h: 80, z: 1 },
    variant: 'rect',
  };
  const { ctx, log } = makeCtx();
  const { renderInspectorSpecImpl } = await import('./runtime-helpers.js');

  renderInspectorSpecImpl(
    ctx as unknown as Parameters<typeof renderInspectorSpecImpl>[0],
    shapeInspectorSpec,
    shape,
  );

  // Find the variant <select> the interpreter mounted into the inspector.
  function findSelect(node: StubNode): StubNode | null {
    if (node.tagName === 'SELECT') return node;
    for (const child of node.children) {
      const found = findSelect(child);
      if (found) return found;
    }
    return null;
  }
  const sel = findSelect(ctx.inspector);
  assert(sel !== null, 'spec interpreter must mount a <select> for the variant field');

  sel!.value = 'icon';
  sel!.dispatchEvent('change');

  assert(
    shape.variant === 'icon',
    `variant must be written through (got "${shape.variant}")`,
  );
  assert(
    shape.iconKind === 'arrow-up-right',
    `variant→'icon' must auto-default iconKind to 'arrow-up-right' (got ${String(shape.iconKind)})`,
  );
  // Auto-default flips state the inspector cares about (showWhen guard
  // now satisfies the icon-picker mount), so re-render must fire.
  assert(
    log.inspectorRenders === 1,
    `variant→'icon' must re-render the inspector once (got ${String(log.inspectorRenders)})`,
  );
  assert(
    log.rebuildCalls.length === 1 && log.rebuildCalls[0] === 'sh-flip',
    `variant change must rebuildElement once (got ${JSON.stringify(log.rebuildCalls)})`,
  );
  assert(log.saveCalls === 1, `variant change must scheduleSave once (got ${String(log.saveCalls)})`);
}

// ---- Contract 2: icon "None" on shape → flip variant + drop iconKind --

{
  const shape: ShapeElement = {
    id: 'sh-none',
    type: 'shape',
    box: { x: 0, y: 0, w: 80, h: 80, z: 1 },
    variant: 'icon',
    iconKind: 'check',
  };
  const { ctx, log } = makeCtx();

  renderIconField(
    ctx as unknown as Parameters<typeof renderIconField>[0],
    ICON_FIELD_FOR_SHAPE,
    shape,
  );

  const noneTile = findNoneTile(ctx.inspector);
  assert(noneTile !== null, 'icon picker must render a "No icon" tile');
  noneTile!.dispatchEvent('click');

  assert(
    shape.variant === 'rect',
    `shape "None" must flip variant to 'rect' (got "${shape.variant}")`,
  );
  assert(
    shape.iconKind === undefined,
    `shape "None" must drop iconKind (got ${String(shape.iconKind)})`,
  );
  assert(
    log.inspectorRenders === 1,
    `shape "None" must re-render the inspector once (got ${String(log.inspectorRenders)})`,
  );
  assert(
    log.saveCalls === 1,
    `shape "None" must scheduleSave once (got ${String(log.saveCalls)})`,
  );
}

// ---- Contract 3: icon "None" on action with empty label → refused -----

{
  const action: ActionElement = {
    id: 'a-icon-only',
    type: 'action',
    box: { x: 0, y: 0, w: 48, h: 48, z: 1 },
    label: [{ text: '' }],
    iconKind: 'copy',
    href: { type: 'external', url: '/x' },
    variant: 'solid',
  };
  const { ctx, log } = makeCtx();

  renderIconField(
    ctx as unknown as Parameters<typeof renderIconField>[0],
    ICON_FIELD_FOR_ACTION,
    action,
  );

  const noneTile = findNoneTile(ctx.inspector);
  assert(noneTile !== null, 'icon picker must render a "No icon" tile');
  noneTile!.dispatchEvent('click');

  assert(
    action.iconKind === 'copy',
    `action "None" with empty label must NOT drop iconKind (got ${String(action.iconKind)})`,
  );
  assert(
    log.saveCalls === 0,
    `refused "None" must NOT scheduleSave (got ${String(log.saveCalls)})`,
  );
  assert(
    log.statusCalls.length === 1 && log.statusCalls[0]!.tone === 'error',
    `refused "None" must surface an error status (got ${JSON.stringify(log.statusCalls)})`,
  );
  assert(
    log.statusCalls[0]!.message.toLowerCase().includes('label'),
    `refused "None" status must name the missing label as the reason (got "${log.statusCalls[0]!.message}")`,
  );
}

// ---- Contract 3b: icon "None" on action WITH label → allowed -----------

{
  const action: ActionElement = {
    id: 'a-icon-with-label',
    type: 'action',
    box: { x: 0, y: 0, w: 160, h: 48, z: 1 },
    label: [{ text: 'Download' }],
    iconKind: 'download',
    href: { type: 'external', url: '/x' },
    variant: 'solid',
  };
  const { ctx, log } = makeCtx();

  renderIconField(
    ctx as unknown as Parameters<typeof renderIconField>[0],
    ICON_FIELD_FOR_ACTION,
    action,
  );

  const noneTile = findNoneTile(ctx.inspector);
  assert(noneTile !== null, 'icon picker must render a "No icon" tile');
  noneTile!.dispatchEvent('click');

  assert(
    action.iconKind === undefined,
    `action "None" with label must drop iconKind (got ${String(action.iconKind)})`,
  );
  assert(
    log.saveCalls === 1,
    `action "None" with label must scheduleSave once (got ${String(log.saveCalls)})`,
  );
  assert(log.statusCalls.length === 0, 'action "None" with label must NOT surface a status');
}

// ---- Teardown ---------------------------------------------------------

if (savedDocument === undefined) {
  delete (globalRef as { document?: unknown }).document;
} else {
  globalRef.document = savedDocument;
}
if (savedHTMLButtonElement === undefined) {
  delete (globalRef as { HTMLButtonElement?: unknown }).HTMLButtonElement;
} else {
  globalRef.HTMLButtonElement = savedHTMLButtonElement;
}

console.log('[inspector-element-state-guards:smoke] OK');
