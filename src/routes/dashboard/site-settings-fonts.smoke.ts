// src/routes/dashboard/site-settings-fonts.smoke.ts
//
// Wave 5 #12 — Custom fonts panel coverage on /dashboard/sites/:id/settings.
//
// Pins the contract for:
//   1. DOM render — the route emits a `#custom-fonts` section with the file
//      input + display-name input + Upload button + font list. Verified by
//      a substring scan of the source so a future template refactor that
//      drops the picker hooks fails the smoke.
//   2. Upload flow — the inline client script POSTs to
//      /api/sites/:siteId/fonts with the right multipart shape (file + name
//      + family) when the Owner clicks Upload, then re-fetches the list.
//   3. List refresh after upload — after a successful POST, the script
//      issues a GET /api/sites/:siteId/fonts and re-renders the list from
//      the response.
//   4. Delete flow — the script DELETEs to /api/sites/:siteId/fonts/:id and
//      only proceeds after the modal confirm resolves true; rejecting the
//      modal must skip the network call.
//
// Run with `bun run src/routes/dashboard/site-settings-fonts.smoke.ts`.

import { clientScript } from './site-settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[site-settings-fonts:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// (1) Source-level DOM render contract — the JSX must emit the picker.
// ---------------------------------------------------------------------------

const response = await fetch(new URL('./site-settings.tsx', import.meta.url));
const source = await response.text();

const REQUIRED_MARKERS = [
  'id="custom-fonts"',
  'data-font-picker',
  'data-font-file',
  'data-font-name',
  'data-font-upload',
  'data-font-list',
  'data-font-delete',
  'data-font-status',
  'data-font-err',
];
for (const marker of REQUIRED_MARKERS) {
  assert(
    source.includes(marker),
    `expected site-settings JSX to expose "${marker}" — the inline client script + this smoke depend on the hook`,
  );
}

// ---------------------------------------------------------------------------
// (2-4) Behavioural smoke — execute the emitted client script against a
// hand-rolled DOM stub and verify the network shape.
// ---------------------------------------------------------------------------

// Inputs / buttons / list collected here so the test can introspect after
// the script wires its listeners.
let fileChangeCount = 0;
const fileInput: {
  files: Array<{ name: string; size: number }>;
  value: string;
} = { files: [], value: '' };
const nameInput: { value: string } = { value: '' };
const uploadBtn: { handler: (() => void) | null; disabled: boolean; textContent: string } = {
  handler: null,
  disabled: false,
  textContent: 'Upload',
};
const listClickHandlers: Array<(ev: { target: unknown }) => void> = [];
const okSpan: { textContent: string } = { textContent: '' };
const errSpan: { textContent: string } = { textContent: '' };
const renderedNodes: Array<{
  tagName: string;
  className: string;
  textContent: string;
  attrs: Record<string, string>;
}> = [];
const listEl: {
  innerHTML: string;
  appendChild(node: unknown): void;
  addEventListener(type: string, handler: (ev: { target: unknown }) => void): void;
  querySelector(selector: string): { textContent: string } | null;
} = {
  innerHTML: '',
  appendChild(node: unknown): void {
    renderedNodes.push(node as (typeof renderedNodes)[number]);
  },
  addEventListener(type: string, handler: (ev: { target: unknown }) => void): void {
    if (type === 'click') listClickHandlers.push(handler);
  },
  querySelector(): null { return null; },
};

const picker = {
  querySelector(selector: string): unknown {
    if (selector === '[data-font-file]') return fileWrapper;
    if (selector === '[data-font-name]') return nameInputWrapper;
    if (selector === '[data-font-upload]') return uploadBtnWrapper;
    return null;
  },
};

const fileWrapper = {
  get files() { return fileInput.files; },
  set files(_: typeof fileInput.files) { /* no-op */ },
  get value() { return fileInput.value; },
  set value(v: string) {
    fileInput.value = v;
    fileChangeCount += 1;
  },
};
const nameInputWrapper = {
  get value() { return nameInput.value; },
  set value(v: string) { nameInput.value = v; },
};
const uploadBtnWrapper = {
  addEventListener(type: string, handler: () => void): void {
    if (type === 'click') uploadBtn.handler = handler;
  },
  get disabled() { return uploadBtn.disabled; },
  set disabled(v: boolean) { uploadBtn.disabled = v; },
  get textContent() { return uploadBtn.textContent; },
  set textContent(v: string) { uploadBtn.textContent = v; },
};

const fakeDocument = {
  querySelector(selector: string): unknown {
    if (selector === '[data-font-picker]') return picker;
    if (selector === '[data-font-list]') return listEl;
    if (selector === '[data-font-status]') return okSpan;
    if (selector === '[data-font-err]') return errSpan;
    return null;
  },
  querySelectorAll(): unknown[] { return []; },
  addEventListener(): void { /* no-op */ },
  createElement(tag: string): {
    tagName: string;
    className: string;
    textContent: string;
    setAttribute(name: string, value: string): void;
    appendChild(child: unknown): void;
    addEventListener(): void;
  } {
    const node = {
      tagName: tag,
      className: '',
      textContent: '',
      attrs: {} as Record<string, string>,
      setAttribute(name: string, value: string): void {
        this.attrs[name] = value;
      },
      appendChild(_child: unknown): void { /* no-op */ },
      addEventListener(): void { /* no-op */ },
    };
    return node;
  },
};

interface QueuedFetch {
  url: string;
  init: Record<string, unknown>;
  resolve: (resp: { ok: boolean; status: number; statusText: string; json(): Promise<unknown> }) => void;
  reject: (err: unknown) => void;
}
const fetches: QueuedFetch[] = [];

function fakeFetch(url: string, init?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    fetches.push({ url, init: init ?? {}, resolve, reject });
  });
}

let modalConfirmAnswer = true;
const modalCalls: Array<{ message: string; opts: unknown }> = [];
const fakeModal = {
  confirm(message: string, opts: unknown): Promise<boolean> {
    modalCalls.push({ message, opts });
    return Promise.resolve(modalConfirmAnswer);
  },
};

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

// `fetches.length` would be narrowed by TypeScript control-flow analysis
// from the previous assertion's literal value (e.g. "fetches.length === 1"
// pins length=1 for the rest of the block). Reading the count through this
// helper hides the narrowing so the next equality check compiles. eslint's
// auto-fixer strips `as number` casts on the literal, so the helper is the
// stable workaround.
function fetchCount(): number {
  return fetches.length;
}

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runClientScript = new Function(
  'document',
  'fetch',
  'alert',
  'Element',
  'HTMLButtonElement',
  'HTMLSelectElement',
  '__opencanvasModal',
  'FormData',
  'location',
  'setTimeout',
  clientScript('site-77'),
) as (...args: unknown[]) => void;

// Minimal FormData shim — captures appended fields so the smoke can verify
// the upload contract without relying on the host's global FormData.
class FormDataShim {
  entries: Array<[string, unknown]> = [];
  append(key: string, value: unknown): void {
    this.entries.push([key, value]);
  }
}

// HTMLButtonElement / Element stand-ins so the `instanceof` guards in the
// delete handler accept the test's stub buttons. instanceof checks against
// these constructors will be true for any plain object the smoke passes
// — that's enough to exercise the branch we care about.
class StubElement {}
class StubButton extends StubElement {
  delegate: { getAttribute(name: string): string | null; disabled: boolean; closest(_: string): unknown };
  constructor(d: { getAttribute(name: string): string | null; disabled: boolean; closest(_: string): unknown }) {
    super();
    this.delegate = d;
  }
  closest(selector: string): unknown {
    if (selector === 'button.font-delete') return this;
    return this.delegate.closest(selector);
  }
  getAttribute(name: string): string | null {
    return this.delegate.getAttribute(name);
  }
  get disabled(): boolean { return this.delegate.disabled; }
  set disabled(v: boolean) { this.delegate.disabled = v; }
}

runClientScript(
  fakeDocument,
  fakeFetch,
  () => undefined,
  StubElement,
  StubButton,
  class {},
  fakeModal,
  FormDataShim,
  { reload(): void {} },
  (cb: () => void) => { void cb; return 0; },
);

assert(uploadBtn.handler, 'expected client script to wire a click handler on the Upload button');
assert(listClickHandlers.length === 1, 'expected client script to wire one click handler on the font list');
void fileChangeCount; // referenced to keep the setter live; assertion below is more meaningful

// -- Upload flow --------------------------------------------------------------
fileInput.files = [{ name: 'display.woff2', size: 100_000 }];
nameInput.value = 'Display Pro';

// Kick the handler without awaiting — it awaits its own fetches, which
// the test resolves below. Awaiting here would deadlock because the
// inner await never resolves until the test stub answers.
void uploadBtn.handler();
await flush();

assert(fetchCount() === 1, 'expected upload to issue exactly one fetch');
const uploadFetch = fetches[0]!;
assert(
  uploadFetch.url === '/api/sites/site-77/fonts',
  `expected upload to POST /api/sites/site-77/fonts, got ${uploadFetch.url}`,
);
assert(uploadFetch.init.method === 'POST', 'expected upload to use POST');
const body = uploadFetch.init.body as FormDataShim;
assert(body instanceof FormDataShim, 'expected upload body to be a FormData instance');
const entries = body.entries;
assert(
  entries.some(([k, v]) => k === 'file' && (v as { name: string }).name === 'display.woff2'),
  'expected multipart body to include the file field',
);
assert(
  entries.some(([k, v]) => k === 'name' && v === 'Display Pro'),
  'expected multipart body to include the display name',
);
assert(
  entries.some(([k, v]) => k === 'family' && typeof v === 'string'),
  'expected multipart body to include a family field (server requires it)',
);

// Resolve the upload with success; the script then GETs the list to refresh.
uploadFetch.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: () => Promise.resolve({ id: 'font-1', name: 'Display Pro' }),
});
await flush();

assert(fetchCount() === 2, 'expected upload success to trigger a list-refresh GET');
const listFetch = fetches[1]!;
assert(
  listFetch.url === '/api/sites/site-77/fonts',
  `expected list refresh to GET /api/sites/site-77/fonts, got ${listFetch.url}`,
);
assert(
  listFetch.init.method === undefined || listFetch.init.method === 'GET',
  'expected list refresh to use GET',
);

// Resolve the list refresh — the script should render the row count.
listFetch.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: () => Promise.resolve({ fonts: [{ id: 'font-1', name: 'Display Pro', byteSize: 100_000 }] }),
});
await flush();

assert(
  renderedNodes.length >= 1,
  'expected list-refresh to render at least one row after a successful upload',
);
assert(
  okSpan.textContent.includes('Display Pro'),
  `expected upload success toast to name the font; got "${okSpan.textContent}"`,
);
assert(
  uploadBtn.disabled === false,
  'expected Upload button to re-enable after the upload settles',
);

// -- Delete flow (rejected) ---------------------------------------------------
fetches.length = 0;
modalConfirmAnswer = false;
const deleteBtn = new StubButton({
  getAttribute(name: string): string | null {
    if (name === 'data-font-delete') return 'font-1';
    return null;
  },
  disabled: false,
  closest(selector: string): unknown {
    if (selector === '.font-row') return {
      querySelector(sel: string): unknown {
        if (sel === '.font-name') return { textContent: 'Display Pro' };
        return null;
      },
    };
    return null;
  },
});
listClickHandlers[0]!({ target: deleteBtn });
await flush();

assert(
  modalCalls.length === 1,
  'expected delete click to ask the confirm modal',
);
assert(
  fetchCount() === 0,
  'expected a rejected confirm to skip the DELETE call',
);

// -- Delete flow (accepted) --------------------------------------------------
modalConfirmAnswer = true;
modalCalls.length = 0;
// Same non-await pattern — the handler awaits its own fetches.
listClickHandlers[0]!({ target: deleteBtn });
await flush();

assert(modalCalls.length === 1, 'expected accepted delete to still ask the confirm modal');
assert(fetchCount() === 1, 'expected accepted delete to issue one fetch');
const deleteFetch = fetches[0]!;
assert(
  deleteFetch.url === '/api/sites/site-77/fonts/font-1',
  `expected DELETE to hit /api/sites/site-77/fonts/font-1, got ${deleteFetch.url}`,
);
assert(deleteFetch.init.method === 'DELETE', 'expected delete to use DELETE');

deleteFetch.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  json: () => Promise.resolve({ ok: true }),
});
await flush();

assert(fetchCount() === 2, 'expected successful delete to trigger a list-refresh GET');

console.log('[site-settings-fonts:smoke] OK');
