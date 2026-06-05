// src/editor-client/collection-preview.smoke.ts
//
// ADR 0063 dec 5 — pins the editor-only placeholder-card chrome that
// collection-preview.ts mounts on Collection wrappers.
//
// Coverage:
//   (1) Source guard — neither src/canvas/render.ts nor
//       src/interactive/inject.ts (the publish renderers) imports
//       collection-preview. Placeholders are editor-only DOM; a publish-
//       path import would leak them to visitors.
//   (2) Unbound Collection (no data-collection-slug attribute on the
//       inner frame) → 3 placeholder cards + banner reading
//       "Source: unset" appear after augmentation.
//   (3) Bound Collection without a matched-count attribute (the editor
//       doesn't run the materializer; absence == 0 matches) → 3 cards +
//       banner reading "Source: <slug>".
//   (4) Bound Collection with `data-collection-matched-count="2"` → no
//       preview chrome (real cards live where the materializer puts
//       them; placeholders must NOT shadow them).
//   (5) Idempotence — running augmentCollectionPreviewsImpl twice on
//       the same DOM leaves exactly one preview block (not two).
//
// Run with `bun run collection-preview:smoke`.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[collection-preview:smoke] ' + message);
}

// ---- 1. Source guard — publish path must NOT import collection-preview --

const canvasRender = await Bun.file(new URL('../canvas/render.ts', import.meta.url)).text();
assert(
  !canvasRender.includes("from './editor-client/collection-preview"),
  'src/canvas/render.ts must NOT import collection-preview (publish path)',
);
assert(
  !canvasRender.includes('collection-preview'),
  'src/canvas/render.ts must NOT reference collection-preview at all',
);

const inject = await Bun.file(new URL('../interactive/inject.ts', import.meta.url)).text();
assert(
  !inject.includes("from './editor-client/collection-preview"),
  'src/interactive/inject.ts must NOT import collection-preview (publish path)',
);
assert(
  !inject.includes('collection-preview'),
  'src/interactive/inject.ts must NOT reference collection-preview at all',
);

// ---- 2-5. DOM-level behaviour ------------------------------------------
//
// Mirror the resize-handles.smoke pattern: hand-roll a minimal DOM stub
// that supports the surface collection-preview actually uses
// (createElement, appendChild, removeChild, querySelector,
// querySelectorAll, setAttribute, getAttribute, style.cssText,
// classList... etc.). No happy-dom dep — the project ships without one.

interface StubEl {
  tagName: string;
  className: string;
  textContent: string;
  attrs: Map<string, string>;
  children: StubEl[];
  parentNode: StubEl | null;
  style: { cssText: string; [k: string]: unknown };
  appendChild(c: StubEl): StubEl;
  removeChild(c: StubEl): StubEl;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(selector: string): StubEl | null;
  querySelectorAll(selector: string): StubEl[];
}

function makeStubEl(tagName: string): StubEl {
  const el: StubEl = {
    tagName: tagName.toUpperCase(),
    className: '',
    textContent: '',
    attrs: new Map<string, string>(),
    children: [],
    parentNode: null,
    // style proxy that swallows .property writes (cssText is the only
    // thing collection-preview reads). The individual property writes
    // happen on the banner icon — they all funnel through style.x = ...
    // which we accept and ignore.
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
    removeChild(c: StubEl): StubEl {
      const idx = this.children.indexOf(c);
      if (idx >= 0) this.children.splice(idx, 1);
      c.parentNode = null;
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
    querySelector(selector: string): StubEl | null {
      return querySelectorImpl(this, selector, true)[0] ?? null;
    },
    querySelectorAll(selector: string): StubEl[] {
      return querySelectorImpl(this, selector, false);
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

/** Minimal selector implementation supporting the patterns
 *  collection-preview uses:
 *    - '.opencanvas-collection'
 *    - ':scope > .opencanvas-collection-preview'
 *    - '[data-element-type="collection"]'
 *    - '[data-opencanvas-element="<id>"][data-element-type="collection"]'
 *  Recurses by default; `:scope >` restricts to direct children. */
function querySelectorImpl(root: StubEl, selector: string, firstOnly: boolean): StubEl[] {
  const directOnly = selector.startsWith(':scope > ');
  const pattern = directOnly ? selector.slice(':scope > '.length) : selector;
  const matches = parseSelector(pattern);
  const out: StubEl[] = [];
  if (directOnly) {
    for (const child of root.children) {
      if (matchesAll(child, matches) && out.push(child) > 0 && firstOnly) return out;
    }
    return out;
  }
  walk(root);
  return out;
  function walk(node: StubEl): void {
    for (const child of node.children) {
      if (matchesAll(child, matches)) {
        out.push(child);
        if (firstOnly && out.length > 0) return;
      }
      walk(child);
      if (firstOnly && out.length > 0) return;
    }
  }
}

interface SelectorMatcher {
  className?: string;
  attr?: { name: string; value?: string };
}

function parseSelector(pattern: string): SelectorMatcher[] {
  // Support: .className, [attr], [attr="value"], chained like
  // [a="x"][b="y"]. Hand-rolled because the smoke shouldn't need a
  // full selector engine.
  const out: SelectorMatcher[] = [];
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '.') {
      let j = i + 1;
      while (j < pattern.length && /[A-Za-z0-9_-]/.test(pattern[j]!)) j++;
      out.push({ className: pattern.slice(i + 1, j) });
      i = j;
      continue;
    }
    if (ch === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end < 0) throw new Error('selector parse error at index ' + i + ': ' + pattern);
      const body = pattern.slice(i + 1, end);
      const eq = body.indexOf('=');
      if (eq < 0) {
        out.push({ attr: { name: body } });
      } else {
        const name = body.slice(0, eq);
        let value = body.slice(eq + 1);
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        out.push({ attr: { name, value } });
      }
      i = end + 1;
      continue;
    }
    throw new Error('unsupported selector char at ' + i + ': ' + pattern);
  }
  return out;
}

function matchesAll(node: StubEl, matchers: SelectorMatcher[]): boolean {
  for (const m of matchers) {
    if (m.className !== undefined) {
      const cls = node.className.split(/\s+/);
      if (!cls.includes(m.className)) return false;
    } else if (m.attr) {
      if (!node.attrs.has(m.attr.name)) return false;
      if (m.attr.value !== undefined && node.attrs.get(m.attr.name) !== m.attr.value) return false;
    }
  }
  return true;
}

// Install the document + HTMLElement globals before importing
// collection-preview (the module touches `document.createElement` at
// build-time only via the helpers).
const g = globalThis as unknown as Record<string, unknown>;
g.document = {
  createElement(tag: string): StubEl {
    return makeStubEl(tag);
  },
};
g.HTMLElement = class HTMLElement {
  constructor() {
    throw new Error('stub HTMLElement is never instantiated');
  }
};
// instanceof HTMLElement: every StubEl should match. We can't directly
// override prototype; instead the smoke uses augmentOneCollection
// indirectly via augmentCollectionPreviewsImpl which calls
// `wrapper instanceof HTMLElement`. Override the well-known
// Symbol.hasInstance to make every StubEl satisfy `instanceof`.
Object.defineProperty(g.HTMLElement, Symbol.hasInstance, {
  value: (instance: unknown): boolean => {
    return (
      typeof instance === 'object' &&
      instance !== null &&
      'tagName' in (instance as Record<string, unknown>) &&
      'attrs' in (instance as Record<string, unknown>)
    );
  },
});

const { augmentCollectionPreviewsImpl, augmentCollectionPreviewForElementImpl } =
  await import('./collection-preview.js');

// Build a fake ctx: only `root` is needed. The augmenter never reads
// state / scheduleSave / etc.
function buildCtx(root: StubEl): { root: StubEl } {
  return { root };
}

// Build a Collection wrapper that mirrors the real DOM shape:
//   <div data-element-type="collection" data-opencanvas-element="id">
//     <div class="opencanvas-collection" data-collection-slug="" ...>
//     </div>
//   </div>
function buildCollectionWrapper(
  id: string,
  slugAttr: string | null,
  matchedCount: string | null,
): StubEl {
  const wrapper = makeStubEl('div');
  wrapper.setAttribute('class', 'opencanvas-element');
  wrapper.setAttribute('data-element-type', 'collection');
  wrapper.setAttribute('data-opencanvas-element', id);
  const frame = makeStubEl('div');
  frame.setAttribute('class', 'opencanvas-collection');
  if (slugAttr !== null) frame.setAttribute('data-collection-slug', slugAttr);
  if (matchedCount !== null) frame.setAttribute('data-collection-matched-count', matchedCount);
  wrapper.appendChild(frame);
  return wrapper;
}

function countPreviewBlocks(wrapper: StubEl): number {
  return wrapper.querySelectorAll(':scope > .opencanvas-collection-preview').length;
}

function countPreviewCards(wrapper: StubEl): number {
  const root = wrapper.querySelector(':scope > .opencanvas-collection-preview');
  if (!root) return 0;
  return root.querySelectorAll('.opencanvas-collection-preview-card').length;
}

function bannerText(wrapper: StubEl): string | null {
  const root = wrapper.querySelector(':scope > .opencanvas-collection-preview');
  if (!root) return null;
  const banner = root.querySelector('.opencanvas-collection-preview-banner');
  if (!banner) return null;
  // Walk children to find the text-content span (the second child).
  let text = '';
  for (const child of banner.children) {
    if (child.textContent && child.textContent.startsWith('Placeholder cards')) {
      text = child.textContent;
      break;
    }
  }
  return text;
}

// (2) Unbound — no data-collection-slug attribute means "unset".
{
  const root = makeStubEl('div');
  const wrapper = buildCollectionWrapper('coll-1', null, null);
  root.appendChild(wrapper);
  augmentCollectionPreviewsImpl(buildCtx(root) as never);
  assert(countPreviewBlocks(wrapper) === 1, '(2) unbound: must mount exactly one preview block');
  assert(countPreviewCards(wrapper) === 3, '(2) unbound: must render 3 placeholder cards');
  const text = bannerText(wrapper);
  assert(text !== null, '(2) unbound: banner text must be present');
  assert(
    text.includes('Source: unset'),
    '(2) unbound: banner must read "Source: unset" but got: ' + text,
  );
}

// (3) Bound with no matched count → still placeholders.
{
  const root = makeStubEl('div');
  const wrapper = buildCollectionWrapper('coll-2', 'blog', null);
  root.appendChild(wrapper);
  augmentCollectionPreviewsImpl(buildCtx(root) as never);
  assert(
    countPreviewBlocks(wrapper) === 1,
    '(3) bound with no matched-count: must mount placeholder block',
  );
  assert(countPreviewCards(wrapper) === 3, '(3) bound with no matched-count: must render 3 cards');
  const text = bannerText(wrapper);
  assert(
    text !== null && text.includes('Source: blog'),
    '(3) bound: banner must read "Source: blog" but got: ' + text,
  );
}

// (4) Bound with matched-count >= 1 → no placeholders.
{
  const root = makeStubEl('div');
  const wrapper = buildCollectionWrapper('coll-3', 'blog', '2');
  root.appendChild(wrapper);
  augmentCollectionPreviewsImpl(buildCtx(root) as never);
  assert(
    countPreviewBlocks(wrapper) === 0,
    '(4) bound with 2 matches: placeholders MUST be absent',
  );
}

// (5) Idempotence — running twice still leaves exactly one preview.
{
  const root = makeStubEl('div');
  const wrapper = buildCollectionWrapper('coll-4', null, null);
  root.appendChild(wrapper);
  augmentCollectionPreviewsImpl(buildCtx(root) as never);
  augmentCollectionPreviewsImpl(buildCtx(root) as never);
  assert(
    countPreviewBlocks(wrapper) === 1,
    '(5) re-running augmentCollectionPreviewsImpl must not stack preview blocks',
  );
}

// (6) Single-element augmenter clears placeholders when binding flips.
{
  const root = makeStubEl('div');
  const wrapper = buildCollectionWrapper('coll-5', null, null);
  root.appendChild(wrapper);
  augmentCollectionPreviewForElementImpl(buildCtx(root) as never, 'coll-5');
  assert(
    countPreviewBlocks(wrapper) === 1,
    '(6) single-element augmenter: must mount when unbound',
  );
  // Flip to bound + matched-count 3 by mutating the inner frame.
  const frame = wrapper.querySelector('.opencanvas-collection');
  assert(frame !== null, '(6) frame lookup must succeed');
  frame.setAttribute('data-collection-slug', 'blog');
  frame.setAttribute('data-collection-matched-count', '3');
  augmentCollectionPreviewForElementImpl(buildCtx(root) as never, 'coll-5');
  assert(
    countPreviewBlocks(wrapper) === 0,
    '(6) single-element augmenter: must clear when entries land',
  );
}

console.log('[collection-preview:smoke] OK');
