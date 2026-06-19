// src/editor-client/inspector-component-style.smoke.ts
//
// ADR 0067 editor smoke for the generic Component Style inspector mount.
// Run with `bun run inspector-component-style:smoke`.

import type { ActionElement, TabsElement } from '../canvas/schema.js';
import { actionInspectorSpec } from '../canvas/elements/action.js';
import { accordionInspectorSpec } from '../canvas/elements/accordion.js';
import { carouselInspectorSpec } from '../canvas/elements/carousel.js';
import { formInspectorSpec } from '../canvas/elements/form.js';
import { tabsInspectorSpec } from '../canvas/elements/tabs.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[inspector-component-style:smoke] ${message}`);
}

interface StubListener {
  type: string;
  fn: (event: { type: string; preventDefault(): void }) => void;
}

interface StubNode {
  tagName: string;
  type: string;
  value: string;
  checked: boolean;
  selected: boolean;
  disabled: boolean;
  hidden: boolean;
  min: string;
  max: string;
  step: string;
  placeholder: string;
  textContent: string;
  className: string;
  title: string;
  style: Record<string, string>;
  attrs: Map<string, string>;
  children: StubNode[];
  listeners: StubListener[];
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: (event: { type: string; preventDefault(): void }) => void): void;
  appendChild(child: StubNode): StubNode;
  replaceChildren(...children: StubNode[]): void;
  dispatchEvent(type: string): void;
  querySelector(selector: string): StubNode | null;
}

function matchesSelector(node: StubNode, selector: string): boolean {
  if (selector.startsWith('[') && selector.endsWith(']')) {
    const body = selector.slice(1, -1);
    const eq = body.indexOf('=');
    if (eq < 0) return node.attrs.has(body);
    const name = body.slice(0, eq);
    const value = body.slice(eq + 1).replace(/^"|"$/g, '');
    return node.attrs.get(name) === value;
  }
  return node.tagName === selector.toUpperCase();
}

function querySelector(node: StubNode, selector: string): StubNode | null {
  if (matchesSelector(node, selector)) return node;
  for (const child of node.children) {
    const found = querySelector(child, selector);
    if (found !== null) return found;
  }
  return null;
}

function makeStubNode(tag: string): StubNode {
  return {
    tagName: tag.toUpperCase(),
    type: '',
    value: '',
    checked: false,
    selected: false,
    disabled: false,
    hidden: false,
    min: '',
    max: '',
    step: '',
    placeholder: '',
    textContent: '',
    className: '',
    title: '',
    style: {},
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
    replaceChildren(...children) {
      this.children = children;
    },
    dispatchEvent(type) {
      for (const listener of this.listeners) {
        if (listener.type === type) {
          listener.fn({ type, preventDefault() {} });
        }
      }
    },
    querySelector(selector) {
      return querySelector(this, selector);
    },
  };
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

function hasComponentStyleMount(fields: readonly { kind: string; name?: string }[]): boolean {
  return fields.some((field) => field.kind === 'custom-mount' && field.name === 'component-style');
}

assert(
  hasComponentStyleMount(actionInspectorSpec.fields),
  'action inspector spec must expose Component Style',
);
assert(
  hasComponentStyleMount(formInspectorSpec.fields),
  'form inspector spec must use the generic component-style mount',
);
assert(
  hasComponentStyleMount(accordionInspectorSpec.fields),
  'accordion inspector spec must expose Component Style',
);
assert(
  hasComponentStyleMount(carouselInspectorSpec.fields),
  'carousel inspector spec must expose Component Style',
);
assert(
  hasComponentStyleMount(tabsInspectorSpec.fields),
  'tabs inspector spec must expose Component Style',
);

const { mountComponentStyle } = await import('./inspector-component-style.js');

interface RebuildLog {
  rebuildCalls: string[];
  saveCalls: number;
}

function makeCtx(): { ctx: Parameters<typeof mountComponentStyle>[0]; log: RebuildLog } {
  const log: RebuildLog = { rebuildCalls: [], saveCalls: 0 };
  const ctx = {
    rebuildElement: (id: string) => {
      log.rebuildCalls.push(id);
    },
    scheduleSave: () => {
      log.saveCalls += 1;
    },
  } as unknown as Parameters<typeof mountComponentStyle>[0];
  return { ctx, log };
}

function makeAction(overrides: Partial<ActionElement> = {}): ActionElement {
  return {
    id: 'action-1',
    type: 'action',
    box: { x: 0, y: 0, w: 220, h: 64, z: 1 },
    label: [{ text: 'Race' }],
    variant: 'solid',
    href: { type: 'external', url: '#' },
    ...overrides,
  } as ActionElement;
}
function makeTabs(overrides: Partial<TabsElement> = {}): TabsElement {
  return {
    id: 'tabs-1',
    type: 'tabs',
    box: { x: 0, y: 0, w: 960, h: 400, z: 1 },
    tabs: [
      {
        id: 'one',
        label: [{ text: 'One' }],
        elements: [
          {
            id: 'text-1',
            type: 'text',
            box: { x: 0, y: 0, w: 200, h: 40, z: 1 },
            content: [{ text: 'Panel' }],
            role: 'body',
            fontSize: 16,
            fontWeight: 400,
            align: 'left',
          },
        ],
      },
      { id: 'two', label: [{ text: 'Two' }], elements: [] },
    ],
    activeTabId: 'one',
    ...overrides,
  };
}

function control(host: StubNode, key: string): StubNode {
  const found = host.querySelector(`[data-component-style-input="${key}"]`);
  assert(found !== null, `mount must render control for ${key}`);
  return found!;
}

{
  const action = makeAction({
    pinnedStyle: { '--opencanvas-action-bg': '#000000' },
  });
  const host = makeStubNode('div');
  const { ctx, log } = makeCtx();
  mountComponentStyle(ctx, action, host as unknown as HTMLElement);

  const input = control(host, 'backgroundColor');
  input.value = '#ff5a1f';
  input.dispatchEvent('input');

  assert(
    action.actionStyle?.backgroundColor === '#ff5a1f',
    'typing a color must set actionStyle.backgroundColor',
  );
  assert(
    action.pinnedStyle?.['--opencanvas-action-bg'] === undefined,
    'setting a modeled action field must remove the conflicting pinnedStyle key',
  );
  assert(log.rebuildCalls.join(',') === 'action-1', 'setting an action field must rebuild the element');
  assert(log.saveCalls === 1, 'setting an action field must schedule one save');
}
{
  const tabs = makeTabs({
    pinnedStyle: { '--opencanvas-tabs-active-tab-bg': '#000000' },
  });
  const host = makeStubNode('div');
  const { ctx, log } = makeCtx();
  mountComponentStyle(ctx, tabs, host as unknown as HTMLElement);

  const input = control(host, 'activeTabBackgroundColor');
  input.value = '#ffffff';
  input.dispatchEvent('input');

  assert(
    tabs.tabsStyle?.activeTabBackgroundColor === '#ffffff',
    'typing a color must set tabsStyle.activeTabBackgroundColor',
  );
  assert(
    tabs.pinnedStyle?.['--opencanvas-tabs-active-tab-bg'] === undefined,
    'setting a modeled field must remove the conflicting pinnedStyle key',
  );
  assert(log.rebuildCalls.join(',') === 'tabs-1', 'setting a field must rebuild the element');
  assert(log.saveCalls === 1, 'setting a field must schedule one save');
}

{
  const tabs = makeTabs({ tabsStyle: { activeTabFontWeight: 'bold' } });
  const host = makeStubNode('div');
  const { ctx } = makeCtx();
  mountComponentStyle(ctx, tabs, host as unknown as HTMLElement);

  const select = control(host, 'activeTabFontWeight');
  select.value = '';
  select.dispatchEvent('change');

  assert(tabs.tabsStyle === undefined, 'clearing the last style field must delete tabsStyle');
}

{
  const tabs = makeTabs();
  const host = makeStubNode('div');
  const { ctx } = makeCtx();
  mountComponentStyle(ctx, tabs, host as unknown as HTMLElement);

  const input = control(host, 'tabPaddingX');
  input.value = '18';
  input.dispatchEvent('change');

  assert(tabs.tabsStyle?.tabPaddingX === 18, 'number controls must store finite numbers');
}

if (savedDocument === undefined) {
  delete globalRef.document;
} else {
  globalRef.document = savedDocument;
}

console.log('[inspector-component-style:smoke] OK');
