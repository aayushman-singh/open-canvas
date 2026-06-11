// src/editor-client/collection-empty-preview.smoke.ts
//
// Regression coverage for the Collection body builder's empty preview.
// The editor's draft state normally does NOT carry materialized `entries`;
// publish populates that field later. The canvas placeholder must therefore
// distinguish three states:
//   1. unbound source -> prompt the Owner to pick a source
//   2. bound source with entries absent -> source-aware preview, no fake count
//   3. bound source with entries: [] -> known empty state, show 0 entries

import type { CollectionElement } from '../canvas/elements/collection.js';
import { buildCollectionBodyImpl } from './body-builders-data.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-empty-preview:smoke] ' + message);
}

interface StubEl {
  tagName: string;
  className: string;
  textContent: string;
  attrs: Map<string, string>;
  children: StubEl[];
  parentNode: StubEl | null;
  style: { cssText: string; [k: string]: unknown };
  appendChild(c: StubEl): StubEl;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
}

function makeStubEl(tagName: string): StubEl {
  const el: StubEl = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    attrs: new Map<string, string>(),
    children: [],
    parentNode: null,
    style: new Proxy<{ cssText: string; [k: string]: unknown }>(
      { cssText: '' },
      {
        set(target, prop, value): boolean {
          (target as Record<string, unknown>)[prop as string] = value;
          return true;
        },
        get(target, prop): unknown {
          return (target as Record<string, unknown>)[prop as string];
        },
      },
    ),
    appendChild(c: StubEl): StubEl {
      this.children.push(c);
      c.parentNode = this;
      return c;
    },
    setAttribute(name: string, value: string): void {
      this.attrs.set(name, value);
      if (name === 'class') this.className = value;
    },
    getAttribute(name: string): string | null {
      if (name === 'class') return this.className || null;
      return this.attrs.has(name) ? this.attrs.get(name)! : null;
    },
  };
  Object.defineProperty(el, 'className', {
    get(): string {
      return el.attrs.get('class') || '';
    },
    set(value: string): void {
      el.attrs.set('class', value);
    },
    configurable: true,
  });
  return el;
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement(tag: string): StubEl {
    return makeStubEl(tag);
  },
};

function collection(overrides: Partial<CollectionElement> = {}): CollectionElement {
  return {
    id: 'coll-smoke',
    type: 'collection',
    box: { x: 0, y: 0, w: 640, h: 360, z: 1 },
    display: 'card',
    sort: 'date-desc',
    ...overrides,
  };
}

function renderText(el: CollectionElement): string {
  const node = buildCollectionBodyImpl(
    {
      editingCollectionTemplate: null,
      buildElementNode: () => makeStubEl('div') as never,
    },
    el,
  ) as unknown as StubEl;
  return textOf(node).replace(/\s+/g, ' ').trim();
}

function textOf(node: StubEl): string {
  let out = node.textContent || '';
  for (const child of node.children) out += ' ' + textOf(child);
  return out;
}

{
  const text = renderText(collection());
  assert(
    text.includes('Pick a source to bind this collection.'),
    'unbound Collection must prompt for a source, got: ' + text,
  );
  assert(!text.includes('0 entries'), 'unbound Collection must not claim a zero-entry count');
}

{
  const text = renderText(collection({ collectionSlug: 'blog' }));
  assert(
    text.includes('Collection preview - blog'),
    'bound Collection with absent entries must show a source-aware preview, got: ' + text,
  );
  assert(
    !text.includes('0 entries'),
    'bound Collection with absent entries must not claim a zero-entry count',
  );
}

{
  const text = renderText(collection({ collectionSlug: 'blog', entries: [] }));
  assert(
    text.includes('Collection grid - 0 entries'),
    'bound Collection with explicit empty entries must show the known empty count, got: ' + text,
  );
}

console.log('[collection-empty-preview:smoke] OK');
