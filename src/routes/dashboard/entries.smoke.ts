// src/routes/dashboard/entries.smoke.ts
//
// `bun run src/routes/dashboard/entries.smoke.ts` — render-level smoke for
// the ADR 0060 Stream C Entries dashboard route. Verifies that:
//
//   1. The list view renders the toolbar, the "+ New entry" button, the
//      collection pill row, the table header (incl. ADR 0063 d7's Folder
//      column), one row per entry, status pills, and the delete affordance.
//   2. The list view collapses to an empty-state CTA when the site has no
//      collections.
//   3. The form view (mode='new') renders all required fields with their
//      types and the create button.
//   4. The form view (mode='edit') prefills inputs from the entry row and
//      shows the "Save changes" button.
//   5. The shell sidebar wiring exposes an 'Entries' nav entry between
//      Forms and Versions.
//   6. ADR 0063 d7: the folder chip row renders when folders exist, and
//      filtering by chip narrows the visible rows.
//   7. ADR 0021 migration source-level pins:
//        * route handler emits the boot blob + dashboard bundle <script>,
//          no longer emits inline `formClientScript` / `listClientScript`
//          IIFEs.
//        * mount module (src/dashboard-client/entries.ts) carries the
//          kebab + validateFolder helpers and the
//          empty-string-→-null folder serialisation invariant.
//   8. ADR 0021 runtime — drive a hand-rolled DOM stub (resize-handles +
//      site-settings precedent) through `mountEntries()` to assert the
//      submit pipeline issues the right PATCH/POST URL with the
//      serialised payload (siteId from the boot blob, folder='' → null).
//
// The route is otherwise driven by Clerk-auth middleware + Postgres; the
// view-level checks target the pure render functions so the assertion
// surface stays honest. The orchestrator's integration step still has to
// mount the route in src/index.ts (the brief forbids that file from being
// edited here).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EntriesListView, EntryFormView } from './entries';
import type { CollectionEntry } from '../../db/schema';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[entries:smoke] ${message}`);
}

// hono/jsx returns JSXNode objects whose .toString() walks the tree and emits
// the rendered HTML. The TypeScript surface types them as `JSX.Element` —
// structurally an object — so eslint's no-base-to-string flags the implicit
// String() coercion. Cast through a typed shim so the lint stays honest and
// the smoke does not depend on any internal hono export.
function renderJsx(node: unknown): string {
  return (node as { toString(): string }).toString();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SITE_ID = 'site-1';
const SITE_NAME = 'Acme Notes';

function makeEntry(overrides: Partial<CollectionEntry> = {}): CollectionEntry {
  const now = new Date('2026-06-04T12:00:00.000Z');
  return {
    id: 'entry-1',
    siteId: SITE_ID,
    collectionSlug: 'blog',
    slug: 'shipping-cms',
    title: 'Shipping CMS entries',
    excerpt: 'How we shipped the entries dashboard.',
    body: '# Body\nSome markdown content.',
    publishedDate: '2026-06-01',
    author: 'Alice',
    category: 'engineering',
    tags: ['launch', 'cms'],
    ogImageAssetId: null,
    status: 'published',
    // ADR 0063 dec 7 — `folder` column added; defaults to NULL = ungrouped.
    folder: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// (1) List view — collections present, entries present
// ---------------------------------------------------------------------------

{
  const html = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: ['blog', 'notes'],
      activeCollection: 'blog',
      activeFolder: undefined,
      entries: [
        makeEntry(),
        makeEntry({
          id: 'entry-2',
          slug: 'design-notes',
          title: 'Design notes',
          status: 'draft',
          publishedDate: '2026-05-20',
        }),
      ],
    }),
  );

  assert(html.includes('>Entries<'), '(1) list view renders the Entries heading');
  assert(html.includes('+ New entry') || html.includes('New entry'), '(1) list view renders the New entry CTA');
  // Top-right button must link to the /new path filtered to the active collection.
  assert(
    html.includes(`/dashboard/sites/${SITE_ID}/entries/new?collection=blog`),
    '(1) New entry button links to /entries/new with collection query',
  );
  // Collection pills
  assert(html.includes('class="formsel"'), '(1) collection pill row uses .formsel class');
  assert(html.includes('>blog<') && html.includes('>notes<'), '(1) collection pill renders all derived slugs');
  // Table head + columns
  assert(html.includes('>Title<'), '(1) table head: Title column');
  assert(html.includes('>Slug<'), '(1) table head: Slug column');
  assert(html.includes('>Status<'), '(1) table head: Status column');
  assert(html.includes('>Folder<'), '(1) table head: Folder column (ADR 0063 d7)');
  assert(html.includes('>Published<'), '(1) table head: Published column');
  assert(html.includes('>Updated<'), '(1) table head: Updated column');
  // Rows
  assert(html.includes('Shipping CMS entries'), '(1) first entry title rendered');
  assert(html.includes('blog/shipping-cms'), '(1) slug renders as <collection>/<slug>');
  assert(html.includes('Design notes'), '(1) second entry title rendered');
  // Status pills
  assert(html.includes('class="status-pill published"'), '(1) published status pill emitted');
  assert(html.includes('class="status-pill draft"'), '(1) draft status pill emitted');
  // Delete affordance
  assert(
    html.includes('data-delete-entry="entry-1"') && html.includes('data-delete-entry="entry-2"'),
    '(1) every row gets a delete button keyed by entry id',
  );
  // Each row links to the edit form
  assert(
    html.includes(`href="/dashboard/sites/${SITE_ID}/entries/entry-1"`),
    '(1) row click navigates to /entries/:entryId',
  );
  // ADR 0063 d7 — folder cells render even when both entries are
  // ungrouped: the em-dash placeholder must appear in the per-row cell.
  assert(
    html.includes('class="et-folder is-empty">—<'),
    '(1) ungrouped entries render an em-dash in the Folder column',
  );

  // Print the first 30 lines of rendered HTML so the orchestrator's
  // verification harness can eyeball it.
  console.log('--- LIST VIEW (first 30 lines) ---');
  const lines = html.split('\n').slice(0, 30);
  console.log(lines.join('\n'));
  console.log('----------------------------------');
}

// ---------------------------------------------------------------------------
// (2) Empty-state — no collections derived
// ---------------------------------------------------------------------------

{
  const html = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: [],
      activeCollection: null,
      activeFolder: undefined,
      entries: [],
    }),
  );

  assert(html.includes('No collections yet'), '(2) empty-state copy present');
  // Post-ADR 0060 F3 the zero-collection copy points at the in-route
  // "+ New collection" wizard rather than the editor's pageKind path.
  assert(
    html.includes('New collection'),
    '(2) empty-state surfaces the New collection wizard CTA',
  );
  assert(
    !html.includes('+ New entry') && !html.includes('class="formsel"'),
    '(2) no New entry CTA / collection pill row when there are zero collections',
  );
  // ADR 0063 d7 — folder filter chips never render without entries.
  assert(
    !html.includes('class="folder-chips"'),
    '(2) no folder chip row when there are zero entries',
  );
}

// ---------------------------------------------------------------------------
// (3) Form view — create mode
// ---------------------------------------------------------------------------

{
  const html = renderJsx(
    EntryFormView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      mode: 'new',
      entry: {
        id: null,
        collectionSlug: 'blog',
        slug: '',
        title: '',
        excerpt: '',
        body: '',
        publishedDate: '2026-06-04',
        author: '',
        category: '',
        tags: [],
        status: 'draft',
        folder: null,
      },
    }),
  );

  assert(html.includes('>New entry<'), '(3) new-mode heading');
  assert(html.includes('data-mode="new"'), '(3) form carries data-mode="new"');
  assert(html.includes('data-entry-id=""'), '(3) new form has empty entry id');
  // Required fields
  assert(html.includes('name="title"'), '(3) title input present');
  assert(html.includes('name="slug"'), '(3) slug input present');
  assert(html.includes('name="excerpt"'), '(3) excerpt textarea present');
  assert(html.includes('name="body"'), '(3) body textarea present');
  assert(html.includes('name="publishedDate"') && html.includes('type="date"'), '(3) publishedDate date input present');
  assert(html.includes('name="author"'), '(3) author input present');
  assert(html.includes('name="category"'), '(3) category input present');
  assert(html.includes('name="tags"'), '(3) tags input present');
  // ADR 0063 d7 — folder input present and capped at 64 chars to match the
  // server-side rule. Hook attribute `data-folder-input` lets the client
  // validator find the field without a brittle CSS selector chain.
  assert(html.includes('name="folder"'), '(3) folder input present');
  assert(html.includes('maxlength="64"'), '(3) folder input enforces 64-char cap');
  assert(html.includes('data-folder-input'), '(3) folder input keyed for the client validator hook');
  assert(html.includes('name="status"') && html.includes('<select'), '(3) status select present');
  assert(html.includes('>Draft<') && html.includes('>Published<'), '(3) status options listed');
  // Collection is read-only on the form
  assert(html.includes('name="collectionSlug"') && html.includes('type="hidden"'), '(3) collectionSlug carried in hidden input');
  assert(html.includes('class="ro"'), '(3) collection read-only badge rendered');
  // Submit button + back link
  assert(html.includes('Create entry'), '(3) new mode submit button reads Create entry');
}

// ---------------------------------------------------------------------------
// (4) Form view — edit mode prefills values
// ---------------------------------------------------------------------------

{
  const html = renderJsx(
    EntryFormView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      mode: 'edit',
      entry: {
        id: 'entry-1',
        collectionSlug: 'blog',
        slug: 'shipping-cms',
        title: 'Shipping CMS entries',
        excerpt: 'Short summary.',
        body: '# Body\nsome content',
        publishedDate: '2026-06-01',
        author: 'Alice',
        category: 'engineering',
        tags: ['launch', 'cms'],
        status: 'published',
        folder: 'tech',
      },
    }),
  );

  assert(html.includes('>Edit entry<'), '(4) edit heading');
  assert(html.includes('data-mode="edit"'), '(4) form data-mode="edit"');
  assert(html.includes('data-entry-id="entry-1"'), '(4) form carries the entry id');
  assert(html.includes('value="Shipping CMS entries"'), '(4) title prefilled');
  assert(html.includes('value="shipping-cms"'), '(4) slug prefilled');
  assert(html.includes('value="2026-06-01"'), '(4) publishedDate prefilled');
  assert(html.includes('value="Alice"'), '(4) author prefilled');
  assert(html.includes('value="engineering"'), '(4) category prefilled');
  assert(html.includes('value="launch, cms"'), '(4) tags joined and prefilled');
  // ADR 0063 d7 — folder string round-trips into the input value.
  assert(
    /name="folder"[^>]*value="tech"/.test(html) || html.includes('value="tech"'),
    '(4) folder string prefilled in the form input',
  );
  // The "published" option should be marked selected — hono renders boolean
  // attrs by emitting the bare attribute name when truthy.
  assert(
    /<option[^>]*value="published"[^>]*selected/.test(html),
    '(4) status="published" marks the published option as selected',
  );
  assert(html.includes('Save changes'), '(4) edit mode submit button reads Save changes');
  // Cancel link uses /entries?collection=...
  assert(
    html.includes(`/dashboard/sites/${SITE_ID}/entries?collection=blog`),
    '(4) Back/Cancel link points to the list view filtered to this collection',
  );

  console.log('--- EDIT FORM (first 30 lines) ---');
  const lines = html.split('\n').slice(0, 30);
  console.log(lines.join('\n'));
  console.log('----------------------------------');
}

// ---------------------------------------------------------------------------
// (5) Sidebar wiring — shell.tsx must register Entries between Forms and
// Versions, mapped to the 'entries' URL segment.
// ---------------------------------------------------------------------------

{
  const shellSource = readFileSync(
    join(process.cwd(), 'src', 'routes', 'dashboard', 'shell.tsx'),
    'utf8',
  );
  assert(shellSource.includes("label: 'Entries'"), '(5) shell exposes an Entries nav item');
  assert(shellSource.includes("Entries: 'entries'"), '(5) shell maps Entries → entries URL segment');
  // The Entries item must sit between Forms and Versions in the array.
  const formsIdx = shellSource.indexOf("label: 'Forms'");
  const entriesIdx = shellSource.indexOf("label: 'Entries'");
  const versionsIdx = shellSource.indexOf("label: 'Versions'");
  assert(formsIdx >= 0 && entriesIdx >= 0 && versionsIdx >= 0, '(5) all three labels present');
  assert(formsIdx < entriesIdx && entriesIdx < versionsIdx, '(5) Entries sits between Forms and Versions');
}

// ---------------------------------------------------------------------------
// (6) ADR 0063 d7 — folder chip row + filter narrowing.
//     With a mix of folder values present, the chip row renders [All,
//     Ungrouped, <each distinct folder>]. Selecting a chip narrows the
//     visible rows in the rendered HTML.
// ---------------------------------------------------------------------------

{
  const fixtures = [
    makeEntry({ id: 'e-tech-1', slug: 'tech-post-1', title: 'Tech post 1', folder: 'tech' }),
    makeEntry({ id: 'e-tech-2', slug: 'tech-post-2', title: 'Tech post 2', folder: 'tech' }),
    makeEntry({ id: 'e-design-1', slug: 'design-post-1', title: 'Design post', folder: 'design' }),
    makeEntry({ id: 'e-bare', slug: 'plain', title: 'Plain entry', folder: null }),
  ];

  // "All" — every row visible, every chip rendered.
  const allHtml = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: ['blog'],
      activeCollection: 'blog',
      activeFolder: undefined,
      entries: fixtures,
    }),
  );
  assert(allHtml.includes('class="folder-chips"'), '(6-all) folder chip row renders when folders exist');
  assert(allHtml.includes('data-folder-chip="all"'), '(6-all) All chip emitted with stable hook');
  assert(allHtml.includes('data-folder-chip=""'), '(6-all) Ungrouped chip emitted (empty value)');
  assert(allHtml.includes('data-folder-chip="tech"'), '(6-all) tech chip present');
  assert(allHtml.includes('data-folder-chip="design"'), '(6-all) design chip present');
  assert(
    allHtml.includes('Tech post 1') &&
      allHtml.includes('Tech post 2') &&
      allHtml.includes('Design post') &&
      allHtml.includes('Plain entry'),
    '(6-all) all entries visible when activeFolder=undefined',
  );
  // Active chip carries the .on marker class.
  assert(
    /data-folder-chip="all"[^>]*class="on"|class="on"[^>]*data-folder-chip="all"/.test(allHtml),
    '(6-all) All chip is the active one',
  );

  // "Ungrouped" — only the folder=null row remains.
  const ungroupedHtml = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: ['blog'],
      activeCollection: 'blog',
      activeFolder: null,
      entries: fixtures,
    }),
  );
  assert(ungroupedHtml.includes('Plain entry'), '(6-ungrouped) folder=null row is shown');
  assert(
    !ungroupedHtml.includes('Tech post 1') &&
      !ungroupedHtml.includes('Tech post 2') &&
      !ungroupedHtml.includes('Design post'),
    '(6-ungrouped) foldered rows are filtered out',
  );

  // "tech" — only the two tech rows remain.
  const techHtml = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: ['blog'],
      activeCollection: 'blog',
      activeFolder: 'tech',
      entries: fixtures,
    }),
  );
  assert(
    techHtml.includes('Tech post 1') && techHtml.includes('Tech post 2'),
    '(6-tech) tech rows visible',
  );
  assert(
    !techHtml.includes('Design post') && !techHtml.includes('Plain entry'),
    '(6-tech) non-tech rows filtered out',
  );
  // Folder chip hrefs hit the same /entries route with the right query.
  // Hono escapes `&` to `&amp;` inside HTML attributes — assert against the
  // escaped form (the browser unescapes it on click).
  assert(
    techHtml.includes(`/dashboard/sites/${SITE_ID}/entries?collection=blog&amp;folder=tech`),
    '(6-tech) tech chip href encodes the folder filter',
  );
  assert(
    techHtml.includes(`/dashboard/sites/${SITE_ID}/entries?collection=blog&amp;folder=`),
    '(6-tech) Ungrouped chip href uses empty folder value',
  );
  // The active folder is recorded on the table for client tooling.
  assert(
    techHtml.includes('data-active-folder="tech"'),
    '(6-tech) table records the active folder for downstream tooling',
  );

  // No matches in the active folder → renders the per-folder empty state.
  const noMatchHtml = renderJsx(
    EntriesListView({
      siteId: SITE_ID,
      siteName: SITE_NAME,
      collections: ['blog'],
      activeCollection: 'blog',
      activeFolder: 'ghost',
      entries: fixtures,
    }),
  );
  assert(
    noMatchHtml.includes('No entries in folder'),
    '(6-empty) per-folder empty-state copy when filter narrows to zero',
  );
}

// ---------------------------------------------------------------------------
// (7) ADR 0021 migration — source-level pins.
//
// The three legacy inline `<script>` blocks (formClientScript +
// listClientScript) were collapsed into the dashboard bundle. We grep
// both the route handler (the emission side) and the mount module (the
// runtime side) so a regression that re-inlines the JS — or quietly
// flips the folder serialisation — fails loudly here.
// ---------------------------------------------------------------------------

const routeSource = await Bun.file(
  new URL('./entries.tsx', import.meta.url),
).text();

// Route handler must emit the ADR 0021 boot blob + dashboard bundle script,
// not the legacy inline `formClientScript` / `listClientScript` IIFEs.
assert(
  routeSource.includes('clientBoot(siteId)') &&
    routeSource.includes("JSON.stringify({ route: 'entries', siteId })"),
  '(7-route) route handler must emit the ADR 0021 boot blob calling { route: "entries", siteId }',
);
assert(
  routeSource.includes('EDITOR_CLIENT_MANIFEST.dashboardClientUrl'),
  '(7-route) route handler must reference the dashboard bundle URL from the editor-client manifest',
);
assert(
  !routeSource.includes('export function formClientScript(') &&
    !routeSource.includes('function formClientScript(') &&
    !routeSource.includes('export function listClientScript(') &&
    !routeSource.includes('function listClientScript('),
  '(7-route) legacy formClientScript / listClientScript must be deleted — mountEntries owns the runtime logic now',
);
assert(
  !/<script>\{raw\((?:list|form)ClientScript\(/.test(routeSource),
  '(7-route) route handler must no longer inline raw(formClientScript|listClientScript) — the bundle owns it',
);
// The route emits the three render surfaces (list, new form, edit form);
// each must still render the DashboardShell + EntriesListView/EntryFormView
// the mount module hooks into.
assert(
  routeSource.match(/<EntriesListView\b/g) !== null,
  '(7-route) route handler must still render <EntriesListView>',
);
assert(
  (routeSource.match(/<EntryFormView\b/g) ?? []).length >= 2,
  '(7-route) route handler must still render <EntryFormView> for both new + edit modes',
);

// Mount module — source pins on the runtime surface. The previous
// `formClientScript` IIFE shipped a kebab() helper and a validateFolder()
// helper inline; both must remain inline in the mount module so any
// regression that swaps in a different slug normaliser (or drops the
// folder shape check) shows up here. The empty-string-→-null
// serialisation rule is the most load-bearing invariant — the API write
// boundary rejects `''` loudly, so a regression that posts `''` would
// turn every "ungrouped" submit into a 400.
const mountSource = await Bun.file(
  new URL('../../dashboard-client/entries.ts', import.meta.url),
).text();

assert(
  mountSource.includes('export function mountEntries(): void'),
  '(7-mount) mount module must export mountEntries(): void',
);
assert(
  /function readSiteId\(\)/.test(mountSource) &&
    mountSource.includes("boot.route !== 'entries'") &&
    mountSource.includes('typeof boot.siteId !== \'string\''),
  '(7-mount) mount module must read siteId from the boot blob with loud-throw on missing/wrong route',
);
assert(
  /function kebab\(/.test(mountSource),
  '(7-mount) mount module must ship a kebab() helper inline',
);
assert(
  /function validateFolder\(/.test(mountSource),
  '(7-mount) mount module must ship a validateFolder() helper inline',
);
assert(
  mountSource.includes('folder: folderRaw.length > 0 ? folderRaw : null'),
  '(7-mount) mount module must serialise empty folder input → null at the submit boundary',
);
// Fetch path + verbs the route+API contracts depend on. The two helpers
// concatenate `'/api/sites/'` + encodeURIComponent(siteId) + `'/entries'`,
// so the string `/api/sites/` is the most resilient sentinel.
assert(
  mountSource.includes("'/api/sites/'"),
  '(7-mount) mount module must hit /api/sites/... endpoints',
);
assert(
  /mode === 'edit' \? 'PATCH' : 'POST'/.test(mountSource),
  '(7-mount) mount module must branch PATCH (edit) / POST (new) off form.data-mode',
);
assert(
  mountSource.includes("method: 'DELETE'"),
  '(7-mount) mount module must issue DELETE on per-row delete confirmation',
);
// Delete confirmation must still funnel through the shared
// `window.__opencanvasModal` shell modal, matching the legacy IIFE.
assert(
  mountSource.includes('__opencanvasModal'),
  '(7-mount) mount module must use the shared __opencanvasModal global',
);

// ---------------------------------------------------------------------------
// (8) ADR 0021 runtime — drive `mountEntries()` through a hand-rolled DOM
//     stub (resize-handles / site-settings precedent). We model only the
//     edit-form surface: when the form is submitted with mode='edit', the
//     mount must issue a PATCH to
//     /api/sites/<siteId>/entries/<entryId> with a JSON payload whose
//     `folder` field serialises empty input → null. That's the most
//     load-bearing invariant the old `new Function(formClientScript)`
//     smoke would have asserted; replicating it here gives the migration
//     a runtime-level safety net without a real DOM.
//
// We install globals (document/window/fetch) BEFORE dynamic-importing the
// compiled mount module, set `window.__opencanvasDashboardBoot` so
// `readSiteId()` resolves, and drive `submit` through the registered
// handler. The list-surface hooks (`[data-new-collection]`,
// `[data-delete-entry]`) return null/empty from our stub's
// querySelector(All), so the list-wire helpers early-return cleanly.
// ---------------------------------------------------------------------------

type Handler = (event: { preventDefault(): void }) => void | Promise<void>;
type QueuedResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};
type QueuedFetch = {
  url: string;
  init: { method?: string; body?: string };
  body: unknown;
  resolve: (response: QueuedResponse) => void;
};

const queuedFetches: QueuedFetch[] = [];

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

// Form input stubs — minimal shape for the mount's form.<name>.value reads
// and form.querySelector lookups. The mount also calls
// `form.querySelector('input[name="title"]')` / `'input[name="slug"]'` to
// wire the auto-kebab side effect, so we expose those via querySelector.
function makeInput(value: string): { value: string; addEventListener(): void } {
  return {
    value,
    addEventListener(): void {
      /* noop — we never drive the kebab `input` event in this smoke */
    },
  };
}

const titleInput = makeInput('Migrated title');
const slugInput = makeInput('migrated-title');
const folderInput = makeInput(''); // empty → must serialise to null
const collectionInput = makeInput('blog');
const excerptInput = makeInput('summary');
const bodyInput = makeInput('# body');
const publishedDateInput = makeInput('2026-06-07');
const authorInput = makeInput('Alice');
const categoryInput = makeInput('engineering');
const tagsInput = makeInput('launch, cms');
const statusInput = makeInput('published');

const msgEl = { textContent: '', className: '' };

const formHandlers: { submit: Handler | null } = { submit: null };

const form = {
  // Named accessors the mount reads as `form.title.value` etc. These
  // shadow the form element's standard property accessors and let us
  // assert what the submit handler serialises.
  collectionSlug: collectionInput,
  title: titleInput,
  slug: slugInput,
  excerpt: excerptInput,
  body: bodyInput,
  publishedDate: publishedDateInput,
  author: authorInput,
  category: categoryInput,
  tags: tagsInput,
  status: statusInput,
  folder: folderInput,
  getAttribute(name: string): string | null {
    const attrs: Record<string, string> = {
      'data-mode': 'edit',
      'data-entry-id': 'entry-1',
    };
    return attrs[name] ?? null;
  },
  querySelector(selector: string): unknown {
    if (selector === '[data-form-msg]') return msgEl;
    if (selector === 'input[name="title"]') return titleInput;
    if (selector === 'input[name="slug"]') return slugInput;
    return null;
  },
  addEventListener(type: string, handler: Handler): void {
    if (type === 'submit') formHandlers.submit = handler;
  },
};

const fakeDocument = {
  querySelector(selector: string): unknown {
    if (selector === 'form#entry-form') return form;
    return null;
  },
  // The mount's `wireDeleteEntryButtons` reads
  // `document.querySelectorAll('[data-delete-entry]')` — return an empty
  // NodeList stand-in so the .forEach short-circuits without errors.
  querySelectorAll(): readonly never[] {
    return [];
  },
  addEventListener(): void {
    /* noop */
  },
};

const fakeFetch = (url: string, init: { method?: string; body?: string }) =>
  new Promise<QueuedResponse>((resolve) => {
    queuedFetches.push({
      url,
      init,
      body: init.body ? (JSON.parse(init.body) as unknown) : null,
      resolve,
    });
  });

// Install globals BEFORE dynamic-importing the mount module so the
// module's type guards and references resolve to our stubs.
const g = globalThis as unknown as Record<string, unknown>;
g.document = fakeDocument;
g.window = {
  __opencanvasDashboardBoot: { route: 'entries', siteId: SITE_ID },
  __opencanvasModal: {
    confirm: () => Promise.resolve(true),
    alert: () => Promise.resolve(),
    prompt: () => Promise.resolve(null),
  },
  location: { href: '' },
};
g.fetch = fakeFetch;
g.HTMLElement = class HTMLElement {};
g.HTMLInputElement = class HTMLInputElement {};
g.HTMLButtonElement = class HTMLButtonElement {};
g.HTMLFormElement = class HTMLFormElement {};
g.HTMLTextAreaElement = class HTMLTextAreaElement {};
g.HTMLSelectElement = class HTMLSelectElement {};
g.Element = class Element {};

// We dynamic-import the dashboard-client module to avoid the main
// tsconfig pulling DOM types in transitively (the dashboard-client/
// tsconfig.json owns its own DOM lib; the main project deliberately
// excludes the directory). The cast threads a typed `mountEntries` out
// without dragging the DOM-typed source file into the main project.
const mod = (await import(
  /* @vite-ignore */ '../../dashboard-client/entries.js' as string
)) as { mountEntries: () => void };
const { mountEntries } = mod;

mountEntries();

assert(
  formHandlers.submit !== null,
  '(8) expected mountEntries() to register a submit handler on form#entry-form',
);

// Drive the submit. The mount must:
//   * POST/PATCH to the right URL based on data-mode + data-entry-id
//   * serialise the empty folder input → null
//   * call event.preventDefault() so the browser default submit is skipped
let defaultPrevented = false;
const event = {
  preventDefault(): void {
    defaultPrevented = true;
  },
};
// Fire-and-forget: the submit handler awaits `fetch(...)`, which our
// queue stub never resolves on its own (each queued response is meant
// to be driven manually). We only need to observe the URL + body the
// handler enqueued, not the full response cycle, so we don't await
// the handler's promise — we just give it microtask turns to push
// the fetch through `JSON.stringify` and onto the queue.
void formHandlers.submit!(event);
await flushMicrotasks();

assert(defaultPrevented, '(8) submit handler must call event.preventDefault()');
{
  const firstSubmitFetchCount: number = queuedFetches.length;
  assert(
    firstSubmitFetchCount === 1,
    `(8) expected exactly one fetch after submit; saw ${firstSubmitFetchCount}`,
  );
}
const submitted = queuedFetches[0]!;
assert(
  submitted.url === `/api/sites/${SITE_ID}/entries/entry-1`,
  `(8) edit-mode submit must PATCH /api/sites/<siteId>/entries/<entryId>; got ${submitted.url}`,
);
assert(
  submitted.init.method === 'PATCH',
  `(8) edit-mode submit must use PATCH method; got ${String(submitted.init.method)}`,
);
const payload = submitted.body as Record<string, unknown>;
assert(
  payload.collectionSlug === 'blog' &&
    payload.title === 'Migrated title' &&
    payload.slug === 'migrated-title' &&
    payload.publishedDate === '2026-06-07' &&
    payload.status === 'published',
  '(8) serialised payload must round-trip the form values verbatim',
);
assert(
  payload.folder === null,
  `(8) empty folder input must serialise to null (not ''); got ${JSON.stringify(payload.folder)}`,
);
assert(
  Array.isArray(payload.tags) &&
    (payload.tags as unknown[]).length === 2 &&
    (payload.tags as unknown[])[0] === 'launch' &&
    (payload.tags as unknown[])[1] === 'cms',
  '(8) tags input must split on comma + trim into a string[]',
);

// Sanity: a non-empty folder must round-trip verbatim too. Drive a second
// submit with folder='design' to exercise the truthy branch.
folderInput.value = 'design';
const event2 = {
  preventDefault(): void {
    /* noop — already asserted above */
  },
};
void formHandlers.submit!(event2);
await flushMicrotasks();
{
  const secondSubmitFetchCount: number = queuedFetches.length;
  assert(
    secondSubmitFetchCount === 2,
    `(8) expected exactly two fetches after second submit; saw ${secondSubmitFetchCount}`,
  );
}
const secondPayload = queuedFetches[1]!.body as Record<string, unknown>;
assert(
  secondPayload.folder === 'design',
  `(8) non-empty folder input must round-trip verbatim; got ${JSON.stringify(secondPayload.folder)}`,
);

console.log('[entries:smoke] OK');
