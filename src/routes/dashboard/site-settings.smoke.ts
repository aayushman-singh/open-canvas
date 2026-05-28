import { clientScript } from './site-settings';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[site-settings:smoke] ${message}`);
}

const response = await fetch(new URL('./site-settings.tsx', import.meta.url));
const source = await response.text();

assert(
  source.includes('let configPatchChain = Promise.resolve();'),
  'expected settings script to define a shared config PATCH chain',
);
assert(
  source.includes('function queueConfigPatch'),
  'expected settings script to expose a shared config PATCH queue helper',
);
assert(
  source.includes('queueConfigPatch({ faviconAssetId: assetIdOrNull }'),
  'expected favicon saves to use the shared config PATCH queue',
);
assert(
  /queueConfigPatch\(\s*\{\s*\[key\]: apiValue\s*\}/.test(source),
  'expected config toggles to use the shared config PATCH queue',
);
assert(
  !source.includes('cb.disabled = true') && !source.includes('cb.disabled = false'),
  'config toggles must stay enabled so rapid changes continue to fire change events',
);
assert(
  source.includes("document.querySelector('ul.collab-list')") &&
    source.includes("target.closest('button.remove-btn')") &&
    source.includes("item.getAttribute('data-collab-id')"),
  'expected collaborator removal to be wired through stable class selectors and row data id',
);
assert(
  !source.includes("querySelector('[data-collab-list]')"),
  'collaborator removal must not depend on boolean data-* list selector wiring',
);

type ChangeHandler = () => void;
type QueuedResponse = {
  ok: boolean;
  statusText: string;
  text: () => Promise<string>;
};
type QueuedFetch = {
  body: unknown;
  resolve: (response: QueuedResponse) => void;
};

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const queuedFetches: QueuedFetch[] = [];
const alerts: string[] = [];
const handlers: { change: ChangeHandler | null } = { change: null };
const stateEl = { textContent: 'Off' };
const toggleRow = { querySelector: () => stateEl };
const toggle = {
  checked: false,
  getAttribute(name: string): string | null {
    const attrs: Record<string, string> = {
      'data-config-key': 'darkModeEnabled',
      'data-on-label': 'On',
      'data-off-label': 'Off',
    };
    return attrs[name] ?? null;
  },
  closest(selector: string) {
    return selector === '.toggle-row' ? toggleRow : null;
  },
  addEventListener(type: string, handler: ChangeHandler) {
    if (type === 'change') handlers.change = handler;
  },
};
const fakeDocument = {
  querySelector() {
    return null;
  },
  querySelectorAll(selector: string) {
    return selector === 'input[data-config-key]' ? [toggle] : [];
  },
  addEventListener() {},
};
const fakeFetch = (_url: string, init: { body?: string }) =>
  new Promise<QueuedResponse>((resolve) => {
    queuedFetches.push({
      body: init.body ? JSON.parse(init.body) : null,
      resolve,
    });
  });
function queuedFetchCount(): number {
  return queuedFetches.length;
}
function dispatchToggleChange(checked: boolean): void {
  assert(handlers.change, 'expected client script to register a config-toggle change handler');
  toggle.checked = checked;
  handlers.change();
}

// The settings route emits this browser script as a string; execute it against
// a tiny DOM/fetch harness so rapid queued toggle behavior is tested directly.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runClientScript = new Function(
  'document',
  'fetch',
  'alert',
  'Element',
  'HTMLButtonElement',
  'HTMLSelectElement',
  '__rev01Modal',
  'FormData',
  'location',
  'setTimeout',
  clientScript('site-1'),
) as (...args: unknown[]) => void;
runClientScript(
  fakeDocument,
  fakeFetch,
  (message: string) => alerts.push(message),
  class {},
  class {},
  class {},
  { confirm: () => Promise.resolve(true) },
  class {},
  { reload() {} },
  () => 0,
);
assert(handlers.change, 'expected client script to register a config-toggle change handler');

dispatchToggleChange(true);
await flushMicrotasks();
assert(queuedFetchCount() === 1, 'expected first toggle change to start one PATCH');
assert(
  JSON.stringify(queuedFetches[0]?.body) === JSON.stringify({ darkModeEnabled: true }),
  'expected first queued PATCH to capture checked=true',
);

dispatchToggleChange(false);
await flushMicrotasks();
assert(queuedFetchCount() === 1, 'expected second toggle change to wait behind first PATCH');

dispatchToggleChange(true);
await flushMicrotasks();
assert(queuedFetchCount() === 1, 'expected third toggle change to wait behind first PATCH');

queuedFetches[0]?.resolve({
  ok: false,
  statusText: 'Bad Request',
  text: () => Promise.resolve('first save failed'),
});
await flushMicrotasks();
assert(queuedFetchCount() === 2, 'expected second queued PATCH to start after first failure');
assert(
  JSON.stringify(queuedFetches[1]?.body) === JSON.stringify({ darkModeEnabled: false }),
  'expected second queued PATCH to preserve the later checked=false value',
);
assert(
  toggle.checked === true,
  'stale failure from first queued PATCH must not revert a later repeated checkbox value',
);

queuedFetches[1]?.resolve({
  ok: true,
  statusText: 'OK',
  text: () => Promise.resolve(''),
});
await flushMicrotasks();
assert(queuedFetchCount() === 3, 'expected third queued PATCH to start after second success');
assert(
  JSON.stringify(queuedFetches[2]?.body) === JSON.stringify({ darkModeEnabled: true }),
  'expected third queued PATCH to preserve the repeated checked=true value',
);

queuedFetches[2]?.resolve({
  ok: true,
  statusText: 'OK',
  text: () => Promise.resolve(''),
});
await flushMicrotasks();
assert(toggle.checked === true, 'expected final checkbox value to remain on latest user choice');
assert(stateEl.textContent === 'On', 'expected saved state label to match the latest user choice');
assert(
  alerts.length === 1 && alerts[0]?.includes('first save failed'),
  'expected the failed queued PATCH to remain visible to the user',
);

console.log('[site-settings:smoke] OK');
