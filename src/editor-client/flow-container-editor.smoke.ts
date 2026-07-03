// src/editor-client/flow-container-editor.smoke.ts
//
// Editor-side Flow Container regressions:
//   1. Rebuilding a Flow-hosted child must keep the placement-neutral hosted
//      wrapper instead of converting it back into a section-positioned wrapper.
//   2. The legacy element menu must not offer Duplicate for a top-level Flow
//      Container until nested Flow Item id remapping has a real contract.
//
// Run with `bun run src/editor-client/flow-container-editor.smoke.ts`.

import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  TextElement,
} from '../canvas/schema.js';
import { validateEditableSite } from '../canvas/validate.js';
import type { FindElementResult } from './editor-context-types.js';
import {
  buildElementMenuImpl,
  buildHostedElementNodeImpl,
  rebuildElementImpl,
} from './element-menu.js';
import { autoGrowTextElements } from './render.js';
import { handleSectionActionImpl } from './section-toolbar.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[flow-container-editor:smoke] ${message}`);
}

class StubStyle {
  position = '';
  width = '';
  height = '';
  boxSizing = '';
  left = '';
  top = '';
  private props = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.props.set(name, value);
  }

  removeProperty(name: string): string {
    const current = this.props.get(name) ?? '';
    this.props.delete(name);
    return current;
  }
}

class StubElement {
  tagName: string;
  className = '';
  textContent = '';
  parentNode: StubElement | null = null;
  parentElement: StubElement | null = null;
  readonly attrs = new Map<string, string>();
  readonly children: StubElement[] = [];
  readonly style = new StubStyle();
  readonly listeners = new Map<string, Array<(ev: unknown) => void>>();
  isConnected = true;
  scrollHeight = 0;
  readonly classList = {
    contains: (name: string): boolean => this.className.split(/\s+/).includes(name),
  };

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  appendChild(child: StubElement): StubElement {
    this.children.push(child);
    child.parentNode = this;
    child.parentElement = this;
    return child;
  }

  replaceChild(newChild: StubElement, oldChild: StubElement): StubElement {
    const idx = this.children.indexOf(oldChild);
    if (idx < 0) throw new Error('replaceChild: old child not found');
    this.children[idx] = newChild;
    newChild.parentNode = this;
    newChild.parentElement = this;
    oldChild.parentNode = null;
    oldChild.parentElement = null;
    return oldChild;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }

  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }

  addEventListener(type: string, listener: (ev: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  querySelector(selector: string): StubElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): StubElement[] {
    const directOnly = selector.startsWith(':scope > ');
    const normalized = directOnly ? selector.slice(':scope > '.length) : selector;
    const out: StubElement[] = [];
    const visit = (node: StubElement): void => {
      const candidates = directOnly ? node.children : node.children;
      for (const child of candidates) {
        if (matchesSelector(child, normalized)) out.push(child);
        if (!directOnly) visit(child);
      }
    };
    visit(this);
    return out;
  }
}

function matchesSelector(node: StubElement, selector: string): boolean {
  if (selector === '[data-opencanvas-interactive]') {
    return node.attrs.has('data-opencanvas-interactive');
  }
  if (selector === '[data-opencanvas-pointer-fx]') {
    return node.attrs.has('data-opencanvas-pointer-fx');
  }
  if (selector === '[data-resize-handle]') {
    return node.attrs.has('data-resize-handle');
  }
  if (selector === '.element-menu-trigger') {
    return node.classList.contains('element-menu-trigger');
  }
  if (selector === '.opencanvas-text') {
    return node.classList.contains('opencanvas-text');
  }
  const elementMatch = selector.match(/^\[data-opencanvas-element="([^"]+)"\]$/);
  if (elementMatch) return node.getAttribute('data-opencanvas-element') === elementMatch[1];
  const typeMatch = selector.match(/^\[data-element-type="([^"]+)"\]$/);
  if (typeMatch) return node.getAttribute('data-element-type') === typeMatch[1];
  return false;
}

const globals = globalThis as unknown as Record<string, unknown>;
globals.document = {
  createElement(tagName: string): StubElement {
    return new StubElement(tagName);
  },
};
globals.HTMLElement = class HTMLElement {
  constructor() {
    throw new Error('stub HTMLElement is never constructed directly');
  }
};
globals.Element = globals.HTMLElement;
Object.defineProperty(globals.HTMLElement, Symbol.hasInstance, {
  value(instance: unknown): boolean {
    return instance instanceof StubElement;
  },
});

function textElement(id: string): TextElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 0, h: 0, z: 0 },
    content: [{ text: id }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

function buildWrapper(id: string, hosted: boolean): StubElement {
  const wrapper = new StubElement('div');
  wrapper.className = hosted ? 'opencanvas-element opencanvas-flow-content' : 'opencanvas-element';
  wrapper.setAttribute('data-opencanvas-element', id);
  wrapper.style.position = hosted ? 'relative' : 'absolute';
  if (!hosted) {
    wrapper.style.left = '10px';
    wrapper.style.top = '20px';
    const trigger = new StubElement('button');
    trigger.className = 'element-menu-trigger';
    wrapper.appendChild(trigger);
  }
  return wrapper;
}

{
  const hosted = textElement('flow-copy');
  const flow = {
    id: 'flow',
    type: 'flow-container',
    box: { x: 40, y: 40, w: 640, h: 240, z: 1 },
    layout: {
      mode: 'grid',
      columns: 2,
      gap: { row: 16, column: 16 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
    },
    items: [{ id: 'copy', element: hosted }],
  } as unknown as CanvasElement;
  const section: CanvasSection = {
    id: 'section-flow',
    recipeId: 'custom',
    name: 'Flow',
    height: 640,
    elements: [flow],
  };
  const parent = new StubElement('div');
  parent.appendChild(buildWrapper(hosted.id, true));
  const root = new StubElement('div');
  root.appendChild(parent);
  let normalBuilds = 0;
  let hostedBuilds = 0;
  const ctx = {
    selectedElementId: hosted.id,
    editingElementId: null,
    activeEditFinish: null,
    root,
    findElement(elementId: string): FindElementResult | null {
      if (elementId !== hosted.id) return null;
      return {
        section,
        element: hosted,
        parentArray: null,
        parentKind: 'flow-item',
        parentMeta: { flowContainerElement: flow, itemId: 'copy' },
      };
    },
    buildElementNode(element: CanvasElement): StubElement {
      normalBuilds += 1;
      return buildWrapper(element.id, false);
    },
    buildHostedElementNode(element: CanvasElement): StubElement {
      hostedBuilds += 1;
      return buildHostedElementNodeImpl(this as never, element) as unknown as StubElement;
    },
    applyElementStyle(): void {},
    applyPinnedStyle(): void {},
    buildElementBody(): StubElement {
      const body = new StubElement('div');
      body.className = 'opencanvas-text';
      body.scrollHeight = 120;
      return body;
    },
    renderAll(): void {
      throw new Error('rebuildElement should replace the live hosted wrapper directly');
    },
    setBoxStyle(): void {},
    setStatus(): void {},
  };

  rebuildElementImpl(ctx as never, hosted.id);

  const replacement = parent.children[0];
  assert(hostedBuilds === 1, 'Flow-hosted rebuild must use buildHostedElementNode');
  assert(normalBuilds === 0, 'Flow-hosted rebuild must not use buildElementNode');
  assert(
    replacement?.classList.contains('opencanvas-flow-content'),
    'replacement must stay hosted',
  );
  assert(replacement?.style.position === 'relative', 'hosted replacement must stay relative');
  assert(replacement?.style.left === '', 'hosted replacement must not carry absolute left');
  assert(replacement?.style.top === '', 'hosted replacement must not carry absolute top');
  assert(
    replacement?.getAttribute('data-selected') === 'true',
    'hosted replacement must preserve selected visual state',
  );
  assert(
    replacement?.querySelector('.element-menu-trigger') === null,
    'hosted replacement must not gain the legacy element menu trigger',
  );
  assert(
    replacement?.querySelectorAll(':scope > [data-resize-handle]').length === 0,
    'hosted replacement must not gain resize handles',
  );
  assert(
    hosted.box.h === 0,
    `Flow-hosted rebuild must not persist measured text height into sentinel box.h (got ${String(hosted.box.h)})`,
  );
}

{
  const hostedText = textElement('hosted-grow');
  const normalText = textElement('normal-grow');
  normalText.box = { x: 20, y: 20, w: 280, h: 12, z: 1 };
  const section: CanvasSection = {
    id: 'section-grow',
    recipeId: 'custom',
    name: 'Grow',
    height: 640,
    elements: [normalText],
  };
  const hostedWrapper = buildWrapper(hostedText.id, true);
  hostedWrapper.setAttribute('data-element-type', 'text');
  const hostedInner = new StubElement('div');
  hostedInner.className = 'opencanvas-text';
  hostedInner.scrollHeight = 80;
  hostedWrapper.appendChild(hostedInner);
  const normalWrapper = buildWrapper(normalText.id, false);
  normalWrapper.setAttribute('data-element-type', 'text');
  const normalInner = new StubElement('div');
  normalInner.className = 'opencanvas-text';
  normalInner.scrollHeight = 90;
  normalWrapper.appendChild(normalInner);
  const root = new StubElement('div');
  root.appendChild(hostedWrapper);
  root.appendChild(normalWrapper);
  const setBoxStyleCalls: string[] = [];
  const ctx = {
    root,
    findElement(elementId: string): FindElementResult | null {
      if (elementId === hostedText.id) {
        return {
          section,
          element: hostedText,
          parentArray: null,
          parentKind: 'flow-item',
          parentMeta: { flowContainerElement: section.elements[0]!, itemId: 'hosted' },
        };
      }
      if (elementId === normalText.id) {
        return {
          section,
          element: normalText,
          parentArray: section.elements,
          parentKind: 'section',
          parentMeta: null,
        };
      }
      return null;
    },
    setBoxStyle(wrapper: StubElement, box: { h: number }): void {
      setBoxStyleCalls.push(wrapper.getAttribute('data-opencanvas-element') ?? '<missing>');
      wrapper.style.position = 'absolute';
      wrapper.style.height = String(box.h) + 'px';
    },
  };

  autoGrowTextElements(ctx as never);

  assert(hostedText.box.h === 0, 'hosted auto-grow must not mutate sentinel box.h');
  assert(
    hostedWrapper.style.position === 'relative',
    'hosted auto-grow must not write absolute positioning',
  );
  assert(normalText.box.h === 90, 'normal text auto-grow must still update model height');
  assert(
    setBoxStyleCalls.length === 1 && setBoxStyleCalls[0] === normalText.id,
    `auto-grow must call setBoxStyle only for normal wrappers (got ${JSON.stringify(setBoxStyleCalls)})`,
  );
}

{
  const hosted = textElement('flow-copy');
  const flow = {
    id: 'flow-menu',
    type: 'flow-container',
    box: { x: 40, y: 40, w: 640, h: 240, z: 1 },
    layout: {
      mode: 'grid',
      columns: 2,
      gap: { row: 16, column: 16 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
    },
    items: [{ id: 'copy', element: hosted }],
  } as unknown as CanvasElement;
  const section: CanvasSection = {
    id: 'section-flow',
    recipeId: 'custom',
    name: 'Flow',
    height: 640,
    elements: [flow],
  };
  const ctx = {
    findElement: () => ({
      section,
      element: flow,
      parentArray: section.elements,
      parentKind: 'section',
      parentMeta: null,
    }),
    currentPage: () => ({
      id: 'page',
      slug: 'page',
      title: 'Page',
      width: 1200,
      sections: [section],
    }),
    closeElementMenu(): void {},
    renderAll(): void {},
    renderInspector(): void {},
    scheduleSave(): void {},
    selectElement(): void {},
    selectedElementId: null,
    captureForUndo(): void {},
  };
  const menu = buildElementMenuImpl(ctx as never, flow, section, new StubElement('div') as never);
  const labels = (menu as unknown as StubElement).children.map((child) => child.textContent);
  assert(labels.includes('Delete'), 'Flow Container menu should still expose Delete');
  assert(!labels.includes('Duplicate'), 'Flow Container menu must not expose Duplicate in v1');
}

{
  const hosted = textElement('flow-duplicate-child');
  const flow = {
    id: 'flow-section-duplicate',
    type: 'flow-container',
    box: { x: 40, y: 40, w: 640, h: 240, z: 1 },
    layout: {
      mode: 'grid',
      columns: 1,
      gap: { row: 16, column: 16 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      align: 'stretch',
      justify: 'start',
    },
    items: [{ id: 'copy', element: hosted }],
  } as unknown as CanvasElement;
  const section: CanvasSection = {
    id: 'section-duplicate-source',
    recipeId: 'custom',
    name: 'Flow duplicate source',
    height: 640,
    elements: [flow],
  };
  const page: CanvasPage = {
    id: 'page-duplicate',
    slug: 'duplicate',
    title: 'Duplicate',
    width: 1200,
    sections: [section],
  };
  const state: EditableSite = { styleKit: 'charcoal', pages: [page] };
  const ctx = {
    state,
    SIDEBAR_COMMANDS: {},
    currentPage: () => page,
    insertElementForSidebarCommand(): void {},
    renderAll(): void {},
    selectSection(): void {},
    scheduleSave(): void {},
    setStatus(): void {},
    captureForUndo(): void {},
    selectedSectionId: null,
    selectedElementId: null,
  };

  handleSectionActionImpl(ctx as never, 'duplicate-section', section.id);

  const validation = validateEditableSite(state);
  assert(
    validation.valid,
    validation.valid
      ? ''
      : `editor duplicate-section must remap Flow-hosted child ids: ${validation.errors.join('; ')}`,
  );
  const originalFlow = page.sections[0]?.elements[0];
  const clonedFlow = page.sections[1]?.elements[0];
  assert(
    originalFlow?.type === 'flow-container' &&
      clonedFlow?.type === 'flow-container' &&
      originalFlow.items[0]?.element.id !== clonedFlow.items[0]?.element.id,
    'editor duplicate-section clone must not preserve Flow-hosted element ids',
  );
}

console.log('[flow-container-editor:smoke] OK');
