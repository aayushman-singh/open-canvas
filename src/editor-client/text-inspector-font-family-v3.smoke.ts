// src/editor-client/text-inspector-font-family-v3.smoke.ts
//
// v3 — Text-inspector font-family picker coverage.
//
// Pins the contract for the picker mount registered as
// `text-font-family` in runtime-helpers.ts. The picker writes into
// `pinnedStyle["font-family"]` (NOT a structured ElementStyle field):
//
//   1. Dropdown mount: the mount appends a .field wrapper containing
//      the picker select to the inspector host, with at least the
//      "(Style kit default)" sentinel + the preset list + the
//      "+ Upload custom font…" sentinel as options.
//   2. Selecting "(Style kit default)" clears
//      element.pinnedStyle["font-family"] (and removes the pinnedStyle
//      object when no other keys remain).
//   3. Selecting a preset writes the preset's cssFamily chain (e.g.
//      `"Inter", system-ui, sans-serif`) into
//      pinnedStyle["font-family"].
//   4. Selecting a custom font writes its canonical chain
//      `"<name>", system-ui, sans-serif` into
//      pinnedStyle["font-family"]; the editor's
//      <style id="opencanvas-editor-custom-fonts"> block carries the
//      matching @font-face declaration once the catalog is refreshed.
//   5. Upload POSTs multipart with the file, derived `name`, and the
//      required `family` field.
//   6. Delete requires the __opencanvasModal.confirm gate before
//      sending DELETE.
//
// The smoke does NOT stand up the full editor — it constructs a
// minimal EditorContext fake, calls the mount directly, and inspects
// mutations. The @font-face branch additionally exercises the refresh
// path by stubbing `document` + `fetch` long enough for
// refreshCustomFontsImpl to run.
//
// Run with `bun run src/editor-client/text-inspector-font-family-v3.smoke.ts`.

import type { TextElement } from '../canvas/elements/text.js';
import { FONT_PRESETS, fontPresetGoogleFontsLink } from '../fonts/preset-catalog.js';
import type { EditorContext, EditorCustomFont } from './editor-context.js';
import {
  CLIENT_FILE_SIZE_CAP_BYTES,
  EDITOR_FONT_FACE_STYLE_TAG_ID,
  KIT_DEFAULT_VALUE,
  UPLOAD_TRIGGER_VALUE,
  applyFontFamilySelection,
  buildFontOptions,
  customFontFamilyValue,
  deriveDisplayName,
  mountTextFontFamily,
  refreshCustomFontsImpl,
  refreshEditorFontFaceStyleTag,
} from './inspector-text-font-family.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[text-inspector-font-family-v3:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// Preset catalog — pin the exact list called out in the brief so a future
// trim or reorder lands as a smoke failure, not a silent UI drift.
// ---------------------------------------------------------------------------

const EXPECTED_PRESET_LABELS = [
  'Inter',
  'Manrope',
  'IBM Plex Sans',
  'Outfit',
  'Space Grotesk',
  'Bricolage Grotesque',
  'Fraunces',
  'Playfair Display',
  'IBM Plex Serif',
  'JetBrains Mono',
  'IBM Plex Mono',
];
assert(
  FONT_PRESETS.length === EXPECTED_PRESET_LABELS.length,
  `FONT_PRESETS must carry exactly ${String(EXPECTED_PRESET_LABELS.length)} entries (got ${String(FONT_PRESETS.length)})`,
);
for (let i = 0; i < EXPECTED_PRESET_LABELS.length; i++) {
  assert(
    FONT_PRESETS[i]!.label === EXPECTED_PRESET_LABELS[i],
    `FONT_PRESETS[${String(i)}] must be ${JSON.stringify(EXPECTED_PRESET_LABELS[i])} (got ${JSON.stringify(FONT_PRESETS[i]!.label)})`,
  );
}

// Preset cssFamily values must use double-quoted family names so they
// round-trip through JSON.stringify-style quoting identically to the
// custom-font chain.
for (const preset of FONT_PRESETS) {
  assert(
    preset.cssFamily.startsWith(`"${preset.label}"`),
    `FONT_PRESETS entry for ${preset.label} must quote the family name with double-quotes (got ${JSON.stringify(preset.cssFamily)})`,
  );
  assert(
    !preset.cssFamily.includes(';') &&
      !preset.cssFamily.includes('{') &&
      !preset.cssFamily.includes('}'),
    `FONT_PRESETS entry for ${preset.label} value must pass pinnedStyleValueIssue (no ; { })`,
  );
}

// Google Fonts <link> must include every preset family name (URL-encoded
// with `+` for spaces).
const googleLink = fontPresetGoogleFontsLink();
for (const preset of FONT_PRESETS) {
  const encoded = encodeURIComponent(preset.label).replace(/%20/g, '+');
  assert(
    googleLink.includes('family=' + encoded),
    `fontPresetGoogleFontsLink() must request ${preset.label} (encoded as ${encoded})`,
  );
}
assert(
  googleLink.includes('display=swap'),
  'fontPresetGoogleFontsLink() must request display=swap so the system fallback shows during the block period',
);

// ---------------------------------------------------------------------------
// applyFontFamilySelection — the picker change handler's effect on the
// element's pinnedStyle["font-family"] slot.
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

// Selecting a preset writes the cssFamily into pinnedStyle["font-family"].
const tPreset = makeText();
applyFontFamilySelection(tPreset, FONT_PRESETS[0]!.cssFamily);
assert(
  tPreset.pinnedStyle?.['font-family'] === '"Inter", system-ui, sans-serif',
  `preset selection must write the cssFamily into pinnedStyle["font-family"] (got ${JSON.stringify(tPreset.pinnedStyle?.['font-family'])})`,
);

// Selecting "(Style kit default)" deletes the pin and removes the
// pinnedStyle object when no other keys remain.
applyFontFamilySelection(tPreset, KIT_DEFAULT_VALUE);
assert(
  tPreset.pinnedStyle === undefined,
  'kit-default selection must remove the pinnedStyle object when no other keys remain',
);

// kit-default selection preserves other pinnedStyle keys.
const tMixed = makeText();
tMixed.pinnedStyle = { 'backdrop-filter': 'blur(4px)', 'font-family': '"Manrope", sans-serif' };
applyFontFamilySelection(tMixed, KIT_DEFAULT_VALUE);
assert(
  tMixed.pinnedStyle?.['backdrop-filter'] === 'blur(4px)' &&
    tMixed.pinnedStyle['font-family'] === undefined,
  'kit-default selection must NOT drop pinnedStyle when other keys remain',
);

// Custom-font chain selection.
const tCustom = makeText();
applyFontFamilySelection(tCustom, customFontFamilyValue('Display Pro'));
assert(
  tCustom.pinnedStyle?.['font-family'] === '"Display Pro", system-ui, sans-serif',
  `custom-font selection must write the canonical chain (got ${JSON.stringify(tCustom.pinnedStyle?.['font-family'])})`,
);

// ---------------------------------------------------------------------------
// deriveDisplayName — filename → display name derivation.
// ---------------------------------------------------------------------------

assert(deriveDisplayName('inter-bold.woff2') === 'Inter Bold', 'hyphen + extension strip');
assert(deriveDisplayName('My_Display_Font.woff2') === 'My Display Font', 'underscore strip');
assert(deriveDisplayName('font.woff2') === 'Font', 'single-token title-case');

// ---------------------------------------------------------------------------
// buildFontOptions / mountTextFontFamily — DOM-level assertions with a
// hand-rolled fake document.
// ---------------------------------------------------------------------------

type Listener = (ev?: unknown) => void;

interface FakeOptionEntry {
  value: string;
  textContent: string;
  selected: boolean;
}

interface FakeNode {
  tagName: string;
  textContent: string;
  className: string;
  id: string;
  children: FakeNode[];
  attrs: Record<string, string>;
  options: FakeOptionEntry[];
  value: string;
  listeners: Map<string, Listener[]>;
  style: Record<string, string>;
  files: { length: number; 0?: { size: number; name: string } } | null;
  type: string;
  accept: string;
  appendChild(child: FakeNode): FakeNode;
  insertBefore(newNode: FakeNode, ref: FakeNode | null): FakeNode;
  replaceChildren(): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, handler: Listener): void;
  click(): void;
  dispatchChange(value: string): void;
  dispatchClick(): void;
}

function makeFakeNode(tag: string): FakeNode {
  const node: FakeNode = {
    tagName: tag.toLowerCase(),
    textContent: '',
    className: '',
    id: '',
    children: [],
    attrs: {},
    options: [],
    value: '',
    listeners: new Map<string, Listener[]>(),
    style: {},
    files: null,
    type: '',
    accept: '',
    appendChild(child: FakeNode): FakeNode {
      this.children.push(child);
      // Mirror <option>s into the select's options[] array so the smoke
      // can read them back without walking children. `value` is set via
      // a property assignment (`opt.value = ...`) by the builder, so we
      // prefer the live `value` field over the attribute mirror.
      if (this.tagName === 'select' && child.tagName === 'option') {
        this.options.push({
          value: child.value || (child.attrs.value ?? ''),
          textContent: child.textContent,
          selected: child.attrs.selected === 'true',
        });
      } else if (this.tagName === 'select' && child.tagName === 'optgroup') {
        // Walk option children of the group so the smoke sees a flat
        // option list regardless of grouping.
        for (let i = 0; i < child.children.length; i++) {
          const inner = child.children[i]!;
          if (inner.tagName === 'option') {
            this.options.push({
              value: inner.value || (inner.attrs.value ?? ''),
              textContent: inner.textContent,
              selected: inner.attrs.selected === 'true',
            });
          }
        }
      }
      return child;
    },
    insertBefore(newNode: FakeNode, _ref: FakeNode | null): FakeNode {
      this.children.unshift(newNode);
      if (this.tagName === 'select' && newNode.tagName === 'option') {
        this.options.unshift({
          value: newNode.value || (newNode.attrs.value ?? ''),
          textContent: newNode.textContent,
          selected: newNode.attrs.selected === 'true',
        });
      }
      return newNode;
    },
    replaceChildren(): void {
      this.children = [];
      if (this.tagName === 'select') this.options = [];
    },
    setAttribute(name: string, value: string): void {
      this.attrs[name] = value;
      if (name === 'value' && this.tagName === 'option') {
        this.attrs.value = value;
      }
    },
    addEventListener(type: string, handler: Listener): void {
      const list = this.listeners.get(type) ?? [];
      list.push(handler);
      this.listeners.set(type, list);
    },
    click(): void {
      this.dispatchClick();
    },
    dispatchChange(value: string): void {
      this.value = value;
      const handlers = this.listeners.get('change') ?? [];
      for (let i = 0; i < handlers.length; i++) handlers[i]!();
    },
    dispatchClick(): void {
      const handlers = this.listeners.get('click') ?? [];
      for (let i = 0; i < handlers.length; i++) handlers[i]!();
    },
  };
  return node;
}

function installFakeDocument(): void {
  (globalThis as { document?: unknown }).document = {
    createElement(tag: string): FakeNode {
      return makeFakeNode(tag);
    },
  };
}

function uninstallFakeDocument(): void {
  delete (globalThis as { document?: unknown }).document;
}

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

installFakeDocument();
try {
  // buildFontOptions — verify ordering + the upload sentinel as last.
  const select = makeFakeNode('select');
  buildFontOptions(
    select as unknown as HTMLSelectElement,
    FONT_PRESETS,
    sampleFonts,
    undefined,
  );
  assert(select.options[0]!.value === KIT_DEFAULT_VALUE, 'first option must be the kit-default sentinel');
  assert(
    select.options[select.options.length - 1]!.value === UPLOAD_TRIGGER_VALUE,
    'last option must be the upload sentinel',
  );
  const labelSet = select.options.map((o) => o.textContent);
  for (const preset of FONT_PRESETS) {
    assert(
      labelSet.includes(preset.label),
      `dropdown must include preset ${preset.label}`,
    );
  }
  assert(
    labelSet.includes('Display Pro (custom)') && labelSet.includes('Body Sans (custom)'),
    'dropdown must include uploaded fonts with " (custom)" suffix',
  );

  // mountTextFontFamily — full mount on a text element.
  const text = makeText();
  type LogShape = { capture: number; rebuild: string[]; save: number; status: string[] };
  const log: LogShape = { capture: 0, rebuild: [], save: 0, status: [] };
  const ctxFake: Partial<EditorContext> = {
    customFonts: sampleFonts,
    captureForUndo(): void { log.capture++; },
    rebuildElement(id: string): void { log.rebuild.push(id); },
    scheduleSave(): void { log.save++; },
    setStatus(msg: string): void { log.status.push(msg); },
  };
  const host = makeFakeNode('div');
  mountTextFontFamily(ctxFake as EditorContext, text, host as unknown as HTMLElement);
  assert(host.children.length === 1, 'mount must append exactly one .field wrapper');
  const fieldWrapper = host.children[0]!;
  assert(fieldWrapper.className === 'field', 'wrapper must use the .field className');
  // field() builds: label + the inner host. The inner is a <div> containing
  // the select, the custom rows host, and the hidden file input.
  const innerWrapper = fieldWrapper.children.find((c) => c.tagName === 'div');
  assert(innerWrapper, 'wrapper must contain the inner picker div');
  const mountedSelect = innerWrapper.children.find((c) => c.tagName === 'select');
  assert(mountedSelect, 'mount must contain a <select>');
  const fileInput = innerWrapper.children.find((c) => c.tagName === 'input');
  assert(fileInput, 'mount must contain a hidden <input type=file>');
  assert(fileInput.type === 'file', 'file input must be type=file');
  assert(
    fileInput.accept === '.woff2',
    'file input accept must be .woff2 (server-side validator rejects anything else)',
  );

  // Selecting a preset writes the cssFamily into pinnedStyle["font-family"].
  mountedSelect.dispatchChange('"Inter", system-ui, sans-serif');
  assert(
    text.pinnedStyle?.['font-family'] === '"Inter", system-ui, sans-serif',
    'change → preset must update pinnedStyle["font-family"]',
  );
  assert(log.capture === 1 && log.save === 1 && log.rebuild.length === 1, 'change must capture undo, save, and rebuild once');

  // Selecting (Style kit default) clears the pin.
  mountedSelect.dispatchChange(KIT_DEFAULT_VALUE);
  assert(
    text.pinnedStyle === undefined,
    'kit-default change must drop pinnedStyle when no other keys remain',
  );

  // Selecting a custom font writes the canonical chain.
  mountedSelect.dispatchChange(customFontFamilyValue('Display Pro'));
  assert(
    text.pinnedStyle?.['font-family'] === '"Display Pro", system-ui, sans-serif',
    'change → custom font must write the canonical chain',
  );

  // Upload sentinel triggers the file picker click.
  let pickerClicked = 0;
  (fileInput).click = () => { pickerClicked++; };
  mountedSelect.dispatchChange(UPLOAD_TRIGGER_VALUE);
  assert(pickerClicked === 1, 'upload sentinel must call fileInput.click()');

  // The client-side size cap must mirror the server validator (1 MB).
  assert(
    CLIENT_FILE_SIZE_CAP_BYTES === 1_048_576,
    'CLIENT_FILE_SIZE_CAP_BYTES must mirror src/fonts/validate.ts:MAX_FONT_BYTES (1 MB)',
  );
} finally {
  uninstallFakeDocument();
}

// ---------------------------------------------------------------------------
// refreshEditorFontFaceStyleTag — no-op when document.head is absent.
// ---------------------------------------------------------------------------

interface HeadStub {
  textContent: string;
  id: string;
}

const headSlot: HeadStub[] = [];
(globalThis as { document?: unknown }).document = {
  head: {
    appendChild(node: HeadStub): HeadStub {
      headSlot.push(node);
      return node;
    },
  },
  getElementById(id: string): HeadStub | null {
    for (let i = 0; i < headSlot.length; i++) {
      if (headSlot[i]!.id === id) return headSlot[i]!;
    }
    return null;
  },
  createElement(tag: string): HeadStub {
    if (tag !== 'style') throw new Error(`unexpected createElement(${tag}) in refresh smoke`);
    const node: HeadStub = { textContent: '', id: '' };
    return node;
  },
};

refreshEditorFontFaceStyleTag(sampleFonts);
assert(headSlot.length === 1, 'refresh must append exactly one style node on first call');
assert(
  headSlot[0]!.id === EDITOR_FONT_FACE_STYLE_TAG_ID,
  'editor font face block must carry the canonical id',
);
const editorCss = headSlot[0]!.textContent;
assert(editorCss.includes('@font-face'), 'editor font face block must contain an @font-face declaration');
assert(
  editorCss.includes('font-family: "Display Pro"'),
  'editor font face must name the uploaded font as the family',
);
assert(
  editorCss.includes("src: url('/fonts/" + 'a'.repeat(64) + "')"),
  'editor font face src must point at the public /fonts/<hash> endpoint',
);
assert(
  editorCss.includes('font-display: swap'),
  'editor font face must use font-display: swap',
);

// Refresh is idempotent — calling again with the same fonts replaces the
// textContent (no duplicate appendChild).
refreshEditorFontFaceStyleTag(sampleFonts);
assert(
  headSlot.length === 1,
  'refresh must NOT append a second style node — re-use the existing tag',
);

uninstallFakeDocument();

// ---------------------------------------------------------------------------
// refreshCustomFontsImpl — happy path against a mocked authFetch.
// ---------------------------------------------------------------------------

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

const refreshHeadSlot: HeadStub[] = [];
(globalThis as { document?: unknown }).document = {
  head: {
    appendChild(node: HeadStub): HeadStub {
      refreshHeadSlot.push(node);
      return node;
    },
  },
  getElementById(id: string): HeadStub | null {
    for (let i = 0; i < refreshHeadSlot.length; i++) {
      if (refreshHeadSlot[i]!.id === id) return refreshHeadSlot[i]!;
    }
    return null;
  },
  createElement(tag: string): HeadStub {
    if (tag !== 'style') throw new Error(`unexpected createElement(${tag}) in refresh smoke`);
    return { textContent: '', id: '' };
  },
};

const refreshCtx: Partial<EditorContext> = {
  apiBase: '/api',
  siteId: 'site-99',
  customFonts: [],
  authFetch(_input: RequestInfo, _init?: RequestInit): Promise<Response> {
    return Promise.resolve(
      new Response(JSON.stringify(fontFetchPayload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  },
  setStatus(): void {
    /* swallow status during smoke */
  },
  renderInspector(): void {
    /* no-op */
  },
};

await refreshCustomFontsImpl(refreshCtx as EditorContext);
assert(
  (refreshCtx.customFonts ?? []).length === 1,
  'refresh must populate ctx.customFonts from the GET response',
);
assert(
  refreshCtx.customFonts![0]!.name === 'Refresh One',
  'refreshed font name must round-trip from the GET response',
);
assert(
  refreshHeadSlot.length === 1 && refreshHeadSlot[0]!.id === EDITOR_FONT_FACE_STYLE_TAG_ID,
  'refresh must install the editor @font-face block',
);

uninstallFakeDocument();

// ---------------------------------------------------------------------------
// Upload + delete — exercise the request shape via mocked authFetch.
// ---------------------------------------------------------------------------

installFakeDocument();
try {
  interface UploadCall {
    url: string;
    method: string;
    body: unknown;
  }
  const calls: UploadCall[] = [];
  const text = makeText();
  const ctxUpload: Partial<EditorContext> = {
    apiBase: '/api',
    siteId: 'site-upload',
    customFonts: [],
    captureForUndo(): void {},
    rebuildElement(): void {},
    scheduleSave(): void {},
    setStatus(): void {},
    authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
      calls.push({
        url: typeof input === 'string' ? input : (input).url,
        method: init?.method ?? 'GET',
        body: init?.body ?? null,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'font-new',
            name: 'Inter Bold',
            family: 'sans-serif',
            weight: 400,
            style: 'normal',
            contentHash: 'd'.repeat(64),
            byteSize: 2048,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );
    },
  };
  const hostU = makeFakeNode('div');
  mountTextFontFamily(ctxUpload as EditorContext, text, hostU as unknown as HTMLElement);
  const innerU = hostU.children[0]!.children.find((c) => c.tagName === 'div')!;
  const fileU = innerU.children.find((c) => c.tagName === 'input')!;
  // Simulate the change handler with one valid file. The handler reads
  // fileInput.files; we wire it directly.
  const fakeFile = {
    size: 1024,
    name: 'inter-bold.woff2',
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  };
  (fileU).files = { length: 1, 0: fakeFile };
  // The handler fires after the dispatchChange wired by the mount; trigger
  // the change listener directly.
  const changeListeners = fileU.listeners.get('change') ?? [];
  assert(changeListeners.length === 1, 'mount must register one change listener on the file input');
  await Promise.resolve(changeListeners[0]!());
  // Allow the upload microtask chain to settle.
  await new Promise((r) => setTimeout(r, 0));
  assert(calls.length >= 1, 'upload must send at least one fetch');
  const uploadCall = calls.find((c) => c.method === 'POST');
  assert(uploadCall, 'upload must use POST');
  assert(
    uploadCall.url === '/api/sites/site-upload/fonts',
    `upload URL must target the site's fonts collection (got ${uploadCall.url})`,
  );
  const fd = uploadCall.body as FormData;
  assert(fd instanceof FormData, 'upload body must be FormData (multipart)');
  assert(fd.get('file') !== null, 'upload FormData must carry the file field');
  assert(
    typeof fd.get('name') === 'string' && (fd.get('name') as string).length > 0,
    'upload FormData must carry a non-empty name field',
  );
  assert(
    typeof fd.get('family') === 'string' && (fd.get('family') as string).length > 0,
    'upload FormData must carry a non-empty family field (server requires it)',
  );

  // Delete — confirm gate.
  let confirmCalls = 0;
  let deleteCalls = 0;
  (globalThis as { window?: unknown }).window = {
    __opencanvasModal: {
      confirm: (): Promise<boolean> => {
        confirmCalls++;
        return Promise.resolve(false); // user cancels
      },
    },
  };
  const ctxDel: Partial<EditorContext> = {
    apiBase: '/api',
    siteId: 'site-del',
    customFonts: [{ ...sampleFonts[0]! }],
    captureForUndo(): void {},
    rebuildElement(): void {},
    scheduleSave(): void {},
    setStatus(): void {},
    authFetch(_input: RequestInfo, init?: RequestInit): Promise<Response> {
      if (init?.method === 'DELETE') {
        deleteCalls++;
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    },
  };
  const textD = makeText();
  const hostD = makeFakeNode('div');
  mountTextFontFamily(ctxDel as EditorContext, textD, hostD as unknown as HTMLElement);
  const innerD = hostD.children[0]!.children.find((c) => c.tagName === 'div')!;
  const customListD = innerD.children.find(
    (c) => c.attrs['data-text-font-family-custom-list'] === 'true',
  );
  assert(customListD, 'mount must include the custom-list host');
  // Find the delete button.
  let delBtn: FakeNode | null = null;
  for (const child of customListD.children) {
    for (const inner of child.children) {
      if (inner.attrs['data-text-font-family-delete'] === 'font-a') {
        delBtn = inner;
        break;
      }
    }
    if (delBtn) break;
  }
  assert(delBtn, 'mount must render a per-row delete button for the custom font');
  delBtn.dispatchClick();
  await new Promise((r) => setTimeout(r, 0));
  assert(confirmCalls === 1, 'delete must route through window.__opencanvasModal.confirm');
  assert(deleteCalls === 0, 'delete must NOT issue the DELETE when the confirm is dismissed');

  delete (globalThis as { window?: unknown }).window;
} finally {
  uninstallFakeDocument();
}

console.log('[text-inspector-font-family-v3:smoke] OK');
