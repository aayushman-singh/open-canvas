// src/routes/dashboard/site-settings.smoke.ts
//
// ADR 0021 — the inline `clientScript(siteId)` block migrated into
// `src/dashboard-client/site-settings.ts` (mountSiteSettings). This
// smoke pins the rapid-toggle PATCH ordering invariants that were the
// historical reason the previous `new Function(clientScript)` smoke
// existed:
//   1. Multiple config-toggle change events serialize through a single
//      Promise chain (one in-flight PATCH at a time).
//   2. A stale failure from an earlier queued PATCH does not revert the
//      latest user choice; the visible state stays on whatever the
//      Owner most recently selected.
//   3. The route handler still emits the DOM hooks (`form.pw`,
//      `ul.collab-list`, `.remove-btn`, etc.) the mount module reads.
//   4. The collaborator-list query in the route handler proves owner
//      access before reading collaborator emails.
//
// Approach — same hand-rolled DOM stub posture as
// `src/editor-client/resize-handles.smoke.ts`:
//   - Define a tiny stub document with the surface mountSiteSettings
//     touches (querySelector / querySelectorAll / addEventListener) for
//     the rapid-toggle path. We deliberately scope the stub to ONLY the
//     config-controls IIFE; the other five (password form, collaborators,
//     favicon picker, delete modal) early-return on missing DOM hooks,
//     so they coexist cleanly with a minimal fixture.
//   - Set `window.__opencanvasDashboardBoot = { route: 'site-settings',
//     siteId: 'site-1' }` so `readSiteId()` resolves.
//   - Replace `globalThis.fetch` with a queue-recording stub that lets
//     the test resolve each queued PATCH manually.
//   - Replace `globalThis.alert` with an array sink so the failure
//     surface is observable.
//   - Dynamic import `../../dashboard-client/site-settings.js` (the
//     same path the dispatcher uses).
//   - Drive change events through the registered handler and assert
//     the same invariants the previous `new Function()` smoke did.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[site-settings:smoke] ${message}`);
}

// ---- Source-level pins on the route handler ------------------------------
//
// These keep us honest that the route handler still emits the DOM hooks
// the mount module reads and that the collaborator-list query proves
// owner access. They're file-level grep assertions; same posture as the
// other route-level smokes.

const routeSource = await Bun.file(
  new URL('./site-settings.tsx', import.meta.url),
).text();

assert(
  routeSource.includes("document.querySelector('ul.collab-list')") === false,
  'route handler should no longer hand-roll inline JS that reads ul.collab-list — that moved into mountSiteSettings',
);
assert(
  routeSource.includes('ul class="collab-list"'),
  'route handler must still render the ul.collab-list container the mount module reads',
);
assert(
  routeSource.includes('form class="collab-form"'),
  'route handler must still render form.collab-form',
);
assert(
  routeSource.includes('data-config-key='),
  'route handler must still emit input[data-config-key] hooks the mount module wires',
);
assert(
  routeSource.includes("data-config-key=\"siteNoIndex\"") &&
    routeSource.includes("data-invert=\"true\"") &&
    routeSource.includes("data-on-label=\"Visible in search\"") &&
    routeSource.includes("data-off-label=\"Hidden from search\""),
  'route handler must keep the inverted siteNoIndex checkbox + on/off labels intact',
);
assert(
  routeSource.includes('clientBoot(siteId)') &&
    routeSource.includes(
      "JSON.stringify({ route: 'site-settings', siteId })",
    ),
  'route handler must emit the ADR 0021 boot blob calling { route: "site-settings", siteId }',
);
assert(
  routeSource.includes(
    "EDITOR_CLIENT_MANIFEST.dashboardClientUrl",
  ),
  'route handler must reference the dashboard bundle URL from the editor-client manifest',
);
assert(
  !routeSource.includes('export function clientScript') &&
    !routeSource.includes('function clientScript('),
  'legacy clientScript() must be deleted — mountSiteSettings owns the runtime logic now',
);
{
  const collabListStart = routeSource.indexOf('id: siteCollaborator.id');
  const collabListQuery = routeSource.slice(
    collabListStart,
    routeSource.indexOf(']),', collabListStart),
  );
  assert(
    collabListStart >= 0 &&
      collabListQuery.includes('.innerJoin(site, eq(site.id, siteCollaborator.siteId))') &&
      collabListQuery.includes('eq(site.customerId, customerId)'),
    'settings collaborator list query must prove owner access before reading collaborator emails',
  );
}

// ---- Source-level pin on the mount module --------------------------------
//
// The previous smoke pinned `let configPatchChain = Promise.resolve();`
// inside the inline IIFE. The same Promise.resolve() seed must still
// anchor the mount module's queue closure. We grep the mount module so
// a regression that swaps in a per-call new chain (each fetch in flight
// concurrently) fails loudly here.

const mountSource = await Bun.file(
  new URL('../../dashboard-client/site-settings.ts', import.meta.url),
).text();

assert(
  mountSource.includes('let configPatchChain: Promise<void> = Promise.resolve();'),
  'mountSiteSettings must define a single Promise.resolve()-seeded config PATCH chain',
);
assert(
  mountSource.includes('queueConfigPatch(') &&
    mountSource.includes("'/api/canvas/sites/' + encodeURIComponent(siteId) + '/config'"),
  'mountSiteSettings must serialize PATCHes to /api/canvas/sites/:siteId/config through queueConfigPatch',
);
assert(
  mountSource.includes("queueConfigPatch(\n        { faviconAssetId: assetIdOrNull }") ||
    mountSource.includes('queueConfigPatch({ faviconAssetId: assetIdOrNull }') ||
    mountSource.includes('{ faviconAssetId: assetIdOrNull }'),
  'mountSiteSettings must route favicon saves through the shared queueConfigPatch closure',
);
assert(
  /queueConfigPatch\(\s*\{\s*\[key\]: apiValue\s*\}/.test(mountSource),
  'mountSiteSettings must route checkbox toggles through queueConfigPatch with the dynamic key',
);
assert(
  !/cb\.disabled\s*=\s*(true|false)/.test(mountSource),
  'config toggles must stay enabled so rapid changes continue to fire change events',
);

// ---- Runtime drive of mountSiteSettings against a fake DOM ---------------
//
// The site-settings inline script's IIFE for the config toggles was the
// only thing pinning the rapid-toggle ordering invariants. We drive it
// directly via mountSiteSettings(): set up enough document/window/fetch
// surface for the IIFE to execute, then drive change events.
//
// All other IIFEs (password, collaborators, favicon picker, delete-site
// modal) early-return when their DOM hooks aren't present in our stub
// fixture — they all check `if (!form)` / `if (!collabList)` / `if
// (!picker)` / `if (!trigger || !modal)` first.

type ChangeHandler = () => void;
type QueuedResponse = {
  ok: boolean;
  statusText: string;
  text: () => Promise<string>;
};
type QueuedFetch = {
  url: string;
  init: { method?: string; body?: unknown };
  body: unknown;
  resolve: (response: QueuedResponse) => void;
};

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

const queuedFetches: QueuedFetch[] = [];
const alerts: string[] = [];

// The single toggle element the IIFE wires. Mirrors the rendered
// `<input type="checkbox" data-config-key="siteNoIndex" data-invert="true"
// data-on-label="On" data-off-label="Off">` for the siteNoIndex toggle.
const handlers: { change: ChangeHandler | null } = { change: null };
const stateEl = { textContent: 'Off' };
const toggleRow = {
  querySelector(selector: string): typeof stateEl | null {
    return selector === '[data-toggle-state]' ? stateEl : null;
  },
};
const toggle = {
  checked: false,
  type: 'checkbox',
  name: '',
  getAttribute(name: string): string | null {
    const attrs: Record<string, string> = {
      'data-config-key': 'siteNoIndex',
      'data-invert': 'true',
      'data-on-label': 'On',
      'data-off-label': 'Off',
    };
    return attrs[name] ?? null;
  },
  closest(selector: string): typeof toggleRow | null {
    return selector === '.toggle-row' ? toggleRow : null;
  },
  addEventListener(type: string, handler: ChangeHandler): void {
    if (type === 'change') handlers.change = handler;
  },
};

const fakeDocument = {
  // The mount module reaches for many querySelector / querySelectorAll
  // hooks across its six IIFE-equivalents. Returning null / [] for the
  // ones our stub doesn't model lets the unrelated IIFEs early-return
  // cleanly — that's the same posture the prior new Function() smoke had.
  querySelector(): null {
    return null;
  },
  querySelectorAll(selector: string): readonly typeof toggle[] {
    return selector === 'input[data-config-key]' ? [toggle] : [];
  },
  addEventListener(): void {
    /* noop — keydown listeners from favicon picker + delete modal */
  },
  createElement(): Record<string, unknown> {
    return {
      type: '',
      className: '',
      style: {},
      title: '',
      addEventListener(): void {},
      appendChild(): void {},
      setAttribute(): void {},
    };
  },
};

const fakeFetch = (url: string, init: { method?: string; body?: string }) =>
  new Promise<QueuedResponse>((resolve) => {
    queuedFetches.push({
      url,
      init,
      body: init.body ? JSON.parse(init.body) : null,
      resolve,
    });
  });

function queuedFetchCount(): number {
  return queuedFetches.length;
}
function dispatchToggleChange(checked: boolean): void {
  assert(
    handlers.change,
    'expected mountSiteSettings to register a config-toggle change handler',
  );
  toggle.checked = checked;
  handlers.change();
}

// Install the stubs on globalThis BEFORE importing the mount module so
// the module's top-level type guards (which read `window.__opencanvas...`
// only inside mountSiteSettings(), not at module load) and its
// addEventListener / querySelector references resolve to our stubs.
const g = globalThis as unknown as Record<string, unknown>;
g.document = fakeDocument;
g.window = {
  __opencanvasDashboardBoot: { route: 'site-settings', siteId: 'site-1' },
  __opencanvasModal: { confirm: () => Promise.resolve(true), alert: () => Promise.resolve() },
  location: { reload(): void {}, href: '' },
};
g.fetch = fakeFetch;
g.alert = (message: string): void => {
  alerts.push(message);
};
g.FormData = class FormData {};
// Element / HTMLButtonElement / HTMLSelectElement just need to exist as
// class symbols so `instanceof` checks in the collaborator-list IIFE
// compile and short-circuit (our stub document never returns elements
// that pass these instanceof checks, so the collaborator IIFE stays
// silent — same posture as the prior smoke).
g.Element = class Element {};
g.HTMLButtonElement = class HTMLButtonElement {};
g.HTMLSelectElement = class HTMLSelectElement {};
g.HTMLElement = class HTMLElement {};
g.HTMLInputElement = class HTMLInputElement {};
g.HTMLFormElement = class HTMLFormElement {};
g.setTimeout = (): number => 0;

// We dynamic-import the dashboard-client module to avoid the main
// tsconfig pulling DOM types in transitively (the dashboard-client/
// tsconfig.json owns its own DOM lib; the main project deliberately
// excludes the directory). Keep the import specifier behind a string
// variable so TypeScript does not statically resolve the DOM-only source.
const siteSettingsClientPath = '../../dashboard-client/site-settings.js';
const mod = (await import(
  /* @vite-ignore */ siteSettingsClientPath
)) as { mountSiteSettings: () => void };
const { mountSiteSettings } = mod;

mountSiteSettings();

assert(
  handlers.change,
  'expected mountSiteSettings to register a config-toggle change handler',
);

// ---- (1) Multiple queued toggles serialize through the chain ------------

dispatchToggleChange(true);
await flushMicrotasks();
assert(queuedFetchCount() === 1, 'expected first toggle change to start one PATCH');
assert(
  JSON.stringify(queuedFetches[0]?.body) === JSON.stringify({ siteNoIndex: false }),
  'expected first queued PATCH to capture checked=true with data-invert=true → siteNoIndex=false',
);
assert(
  queuedFetches[0]?.url === '/api/canvas/sites/site-1/config',
  'expected first queued PATCH to hit the canvas config endpoint with the boot blob siteId',
);

dispatchToggleChange(false);
await flushMicrotasks();
assert(
  queuedFetchCount() === 1,
  'expected second toggle change to wait behind first PATCH in the chain',
);

dispatchToggleChange(true);
await flushMicrotasks();
assert(
  queuedFetchCount() === 1,
  'expected third toggle change to wait behind first PATCH in the chain',
);

// ---- (2) Stale failure must not revert the latest user choice ------------

queuedFetches[0]?.resolve({
  ok: false,
  statusText: 'Bad Request',
  text: () => Promise.resolve('first save failed'),
});
await flushMicrotasks();
assert(
  queuedFetchCount() === 2,
  'expected second queued PATCH to start after first failure',
);
assert(
  JSON.stringify(queuedFetches[1]?.body) === JSON.stringify({ siteNoIndex: true }),
  'expected second queued PATCH to preserve the later checked=false value (inverted → siteNoIndex=true)',
);
assert(
  toggle.checked === true,
  'stale failure from first queued PATCH must not revert a later repeated checkbox value',
);

// ---- (3) Subsequent successes preserve the latest user choice ------------

queuedFetches[1]?.resolve({
  ok: true,
  statusText: 'OK',
  text: () => Promise.resolve(''),
});
await flushMicrotasks();
assert(
  queuedFetchCount() === 3,
  'expected third queued PATCH to start after second success',
);
assert(
  JSON.stringify(queuedFetches[2]?.body) === JSON.stringify({ siteNoIndex: false }),
  'expected third queued PATCH to preserve the repeated checked=true value',
);

queuedFetches[2]?.resolve({
  ok: true,
  statusText: 'OK',
  text: () => Promise.resolve(''),
});
await flushMicrotasks();
assert(
  toggle.checked === true,
  'expected final checkbox value to remain on latest user choice',
);
assert(
  stateEl.textContent === 'On',
  'expected saved state label to match the latest user choice (data-on-label="On")',
);
assert(
  alerts.length === 1 && alerts[0]?.includes('first save failed'),
  'expected the failed queued PATCH to remain visible to the user via alert()',
);

console.log('[site-settings:smoke] OK');
