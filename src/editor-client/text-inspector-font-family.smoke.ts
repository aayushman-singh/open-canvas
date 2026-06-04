// src/editor-client/text-inspector-font-family.smoke.ts
//
// Wave 5 #12 — Text inspector font-family picker coverage.
//
// Pins the contract for the picker mount registered as `text-font-family`
// in runtime-helpers.ts. Three branches matter:
//
//   1. Picker appears on a text element with the kit-default + role-token
//      options plus one option per uploaded custom font from
//      `ctx.customFonts`.
//   2. "(Style kit default)" selection clears element.pinnedStyle["font-
//      family"] and removes the pinnedStyle object when no other keys
//      remain.
//   3. A custom-font selection writes the canonical chain
//      `"<name>", system-ui, sans-serif` into pinnedStyle["font-family"]
//      AND the editor's `<style id="opencanvas-editor-custom-fonts">`
//      block carries the matching @font-face declaration once the
//      catalog is refreshed.
//
// The smoke shares the spirit of inspector-actions.smoke.ts: it does NOT
// stand up the full editor — it constructs a minimal EditorContext fake,
// calls the mount directly, and inspects mutations. The @font-face
// branch additionally exercises the refresh path by stubbing
// `document` and `fetch` long enough for refreshCustomFontsImpl to run.
//
// Run with `bun run src/editor-client/text-inspector-font-family.smoke.ts`.

import type { TextElement } from '../canvas/elements/text.js';
import type { EditorContext, EditorCustomFont } from './editor-context.js';
import {
  applyFontFamilySelection,
  buildFontFamilyOptions,
  customFontValue,
  mountTextFontFamily,
  pickerValueForFontFamily,
} from './inspector-font-family.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[text-inspector-font-family:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Pure-helper sanity checks first — these don't need a DOM.
// ---------------------------------------------------------------------------

const sampleFonts: EditorCustomFont[] = [
  {
    id: 'font-a',
    name: 'Display Pro',
    family: 'sans-serif',
    weight: 400,
    style: 'normal',
    contentHash: 'a'.repeat(64),
    byteSize: 1024,
  },
  {
    id: 'font-b',
    name: 'Body Sans',
    family: 'sans-serif',
    weight: 400,
    style: 'normal',
    contentHash: 'b'.repeat(64),
    byteSize: 2048,
  },
];

const opts = buildFontFamilyOptions(sampleFonts);
assert(opts[0]!.label === '(Style kit default)', 'first option must be the kit-default clear');
assert(opts.some((o) => o.label === 'Display kit font'), 'options must include the Display kit token');
assert(opts.some((o) => o.label === 'Body kit font'), 'options must include the Body kit token');
assert(opts.some((o) => o.label === 'Mono kit font'), 'options must include the Mono kit token');
assert(opts.some((o) => o.label === 'Display Pro'), 'options must include uploaded fonts');
assert(opts.some((o) => o.label === 'Body Sans'), 'options must include all uploaded fonts');

assert(
  customFontValue('Display Pro') === '"Display Pro", system-ui, sans-serif',
  'custom font value must be the JSON-quoted name + system-ui/sans-serif fallback chain',
);

// pickerValueForFontFamily round-trips
assert(
  pickerValueForFontFamily(undefined, sampleFonts) === '__kit_default__',
  'missing pinnedStyle["font-family"] must map to kit-default',
);
assert(
  pickerValueForFontFamily('var(--opencanvas-kit-font-display)', sampleFonts) === '__kit_display__',
  'kit display var must reverse-map to Display kit option',
);
assert(
  pickerValueForFontFamily('"Display Pro", system-ui, sans-serif', sampleFonts) ===
    customFontValue('Display Pro'),
  'uploaded font value must reverse-map to its custom option',
);
assert(
  pickerValueForFontFamily('"Unknown", serif', sampleFonts) === '__kit_default__',
  'unknown literal must fall back to kit-default option (the literal stays in pinnedStyle, picker shows default)',
);

// ---------------------------------------------------------------------------
// applyFontFamilySelection — the picker change handler's effect.
// ---------------------------------------------------------------------------

function makeText(): TextElement {
  return {
    id: 'el-text',
    type: 'text',
    box: { x: 0, y: 0, w: 320, h: 60, z: 1 },
    content: [{ text: 'hello' }],
    role: 'body',
    fontSize: 16,
    fontWeight: 400,
    align: 'left',
  };
}

const t1 = makeText();
applyFontFamilySelection(t1, customFontValue('Display Pro'));
assert(
  t1.pinnedStyle?.['font-family'] === '"Display Pro", system-ui, sans-serif',
  'selecting a custom font must write the chain into pinnedStyle["font-family"]',
);

applyFontFamilySelection(t1, '__kit_default__');
assert(
  t1.pinnedStyle === undefined,
  'selecting (Style kit default) must remove pinnedStyle when no other keys remain',
);

const t2 = makeText();
t2.pinnedStyle = { 'backdrop-filter': 'blur(4px)' };
applyFontFamilySelection(t2, '__kit_display__');
assert(
  t2.pinnedStyle?.['font-family'] === 'var(--opencanvas-kit-font-display)',
  'kit-display selection must write the matching CSS variable',
);
applyFontFamilySelection(t2, '__kit_default__');
assert(
  t2.pinnedStyle?.['backdrop-filter'] === 'blur(4px)' &&
    t2.pinnedStyle['font-family'] === undefined,
  'clearing the font-family pin must NOT delete pinnedStyle when other keys remain',
);

// ---------------------------------------------------------------------------
// mountTextFontFamily — DOM-level mount. Skips when document is missing.
// ---------------------------------------------------------------------------

type Listener = (ev?: unknown) => void;

interface FakeNode {
  tagName: string;
  textContent: string;
  className: string;
  children: FakeNode[];
  attrs: Record<string, string>;
  options: Array<{ value: string; textContent: string; selected: boolean }>;
  value: string;
  listeners: Map<string, Listener[]>;
  appendChild(child: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: Listener): void;
  dispatchChange(value: string): void;
}

function makeFakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tagName: tag,
    textContent: '',
    className: '',
    children: [],
    attrs: {},
    options: [],
    value: '',
    listeners: new Map<string, Listener[]>(),
    appendChild(child: FakeNode): FakeNode {
      this.children.push(child);
      // When appending an <option> to a <select> mirror to options[] for the
      // smoke's discoverability.
      if (this.tagName === 'select' && child.tagName === 'option') {
        this.options.push({
          value: child.attrs.value ?? '',
          textContent: child.textContent,
          selected: !!child.attrs.selected,
        });
      }
      return child;
    },
    setAttribute(name: string, value: string): void {
      this.attrs[name] = value;
    },
    addEventListener(type: string, handler: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    dispatchChange(value: string): void {
      this.value = value;
      const handlers = this.listeners.get('change') ?? [];
      for (let i = 0; i < handlers.length; i++) handlers[i]!();
    },
  };
  return node;
}

const fakeDocumentForMount = {
  createElement(tag: string): FakeNode {
    return makeFakeNode(tag);
  },
};

// Stub the global document for the mount duration only. Save + restore so
// we don't leak globals into the rest of the smoke chain.
const realDoc = (globalThis as { document?: unknown }).document;
(globalThis as { document?: unknown }).document = fakeDocumentForMount;

const textEl = makeText();
const ctxFake: Partial<EditorContext> = {
  customFonts: sampleFonts,
  rebuildElement(_id: string): void { /* no-op for smoke */ },
  scheduleSave(): void { /* no-op for smoke */ },
};
const host = makeFakeNode('div');
mountTextFontFamily(ctxFake as EditorContext, textEl, host as unknown as HTMLElement);

// The mount appends a `.field` wrapper containing the picker select.
assert(host.children.length === 1, 'expected mount to append exactly one .field wrapper');
const fieldWrapper = host.children[0]!;
assert(fieldWrapper.className === 'field', 'wrapper must use the .field className');
// label child first (by `field()` builder convention), select child second.
const select = fieldWrapper.children.find((c) => c.tagName === 'select');
assert(select, 'expected the .field wrapper to contain a <select>');
const labels = select.options.map((o) => o.textContent);
assert(labels[0] === '(Style kit default)', 'first option label must be the kit-default');
assert(
  labels.includes('Display Pro') && labels.includes('Body Sans'),
  'select options must include every uploaded font name',
);

// Simulate the Owner picking a custom font. The change handler must write
// the chain into pinnedStyle["font-family"].
select.dispatchChange('Display Pro');
assert(
  textEl.pinnedStyle?.['font-family'] === '"Display Pro", system-ui, sans-serif',
  'change → custom font must update pinnedStyle["font-family"]',
);

// Restore the global document so the rest of the smoke chain isn't poisoned.
if (realDoc === undefined) {
  delete (globalThis as { document?: unknown }).document;
} else {
  (globalThis as { document?: unknown }).document = realDoc;
}

// ---------------------------------------------------------------------------
// @font-face emission — refreshCustomFontsImpl populates ctx.customFonts AND
// installs the editor @font-face <style id="opencanvas-editor-custom-fonts">
// block. We can verify both without booting the full editor by stubbing the
// minimal document + fetch surface refreshCustomFontsImpl reaches.
// ---------------------------------------------------------------------------

import { refreshCustomFontsImpl } from './runtime-helpers.js';

interface StyleStub {
  id: string;
  textContent: string;
}

const styleNodes: StyleStub[] = [];
const headChildren: StyleStub[] = [];

const fontFetchPayload = {
  fonts: [
    {
      id: 'font-x',
      name: 'Refresh One',
      family: 'sans-serif',
      weight: 500,
      style: 'normal',
      contentHash: 'c'.repeat(64),
      byteSize: 4096,
    },
  ],
};

(globalThis as { document?: unknown }).document = {
  head: {
    appendChild(node: StyleStub): StyleStub {
      headChildren.push(node);
      return node;
    },
  },
  getElementById(id: string): StyleStub | null {
    for (let i = 0; i < headChildren.length; i++) {
      if (headChildren[i]!.id === id) return headChildren[i]!;
    }
    return null;
  },
  createElement(tag: string): StyleStub {
    if (tag !== 'style') throw new Error('unexpected createElement tag in refresh smoke');
    const node: StyleStub = { id: '', textContent: '' };
    styleNodes.push(node);
    return node;
  },
};

const refreshCtx: Partial<EditorContext> = {
  apiBase: '/api',
  siteId: 'site-99',
  customFonts: [],
  authFetch(_input: unknown, _init?: unknown): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify(fontFetchPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  },
  setStatus(_msg: string, _tone?: string): void { /* swallow status during smoke */ },
  renderInspector(): void { /* no-op */ },
};

await refreshCustomFontsImpl(refreshCtx as EditorContext);

assert(refreshCtx.customFonts!.length === 1, 'expected refresh to populate ctx.customFonts');
assert(
  refreshCtx.customFonts![0]!.name === 'Refresh One',
  'expected the font name to round-trip from the GET response',
);
assert(
  headChildren.length === 1,
  'expected the <style id="opencanvas-editor-custom-fonts"> block to be appended to head once',
);
assert(
  headChildren[0]!.id === 'opencanvas-editor-custom-fonts',
  'editor font face block must carry the canonical id',
);
const css = headChildren[0]!.textContent;
assert(css.includes('@font-face'), 'editor font face block must contain an @font-face declaration');
assert(
  css.includes('font-family: "Refresh One"'),
  'editor font face must name the uploaded font as the family',
);
assert(
  css.includes("src: url('/fonts/" + 'c'.repeat(64) + "')"),
  'editor font face src must point at the public /fonts/<hash> endpoint',
);
assert(
  css.includes('font-display: swap'),
  'editor font face must use font-display: swap so editing surface mirrors the public renderer',
);

// Restore the global document.
if (realDoc === undefined) {
  delete (globalThis as { document?: unknown }).document;
} else {
  (globalThis as { document?: unknown }).document = realDoc;
}

console.log('[text-inspector-font-family:smoke] OK');
