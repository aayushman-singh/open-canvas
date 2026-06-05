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
//   6. The form/list client scripts compile and embed the site id verbatim.
//   7. ADR 0063 d7: the folder chip row renders when folders exist, and
//      filtering by chip narrows the visible rows.
//
// The route is otherwise driven by Clerk-auth middleware + Postgres; this
// smoke targets the pure render functions to keep the assertion surface
// honest. The orchestrator's integration step still has to mount the route
// in src/index.ts (the brief forbids that file from being edited here).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  EntriesListView,
  EntryFormView,
  formClientScript,
  listClientScript,
} from './entries';
import type { CollectionEntry } from '../../db/schema';

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
// (6) Client scripts compile and embed the site id verbatim
// ---------------------------------------------------------------------------

{
  const fs = formClientScript(SITE_ID);
  assert(fs.includes(`"${SITE_ID}"`), '(6) form client script embeds the site id');
  assert(fs.includes('PATCH') && fs.includes('POST'), '(6) form client script targets both API verbs');
  assert(fs.includes("'/api/sites/'"), '(6) form client script hits /api/sites/...');
  assert(fs.includes('function kebab'), '(6) form client script ships a kebab() helper');

  const ls = listClientScript(SITE_ID);
  assert(ls.includes('__opencanvasModal'), '(6) list client script uses the shared confirm modal');
  assert(ls.includes("method: 'DELETE'"), '(6) list client script issues DELETE on confirm');

  // ADR 0063 d7 — form client script learns about the folder field. It
  // validates the shape inline (UX) and serialises empty → null before
  // sending so the server only ever sees null or a valid non-empty
  // string.
  assert(fs.includes('validateFolder'), '(6) form client script ships a validateFolder() helper');
  assert(fs.includes('folder: folderRaw.length > 0 ? folderRaw : null'), '(6) form client script serialises empty input → null');
}

// ---------------------------------------------------------------------------
// (7) ADR 0063 d7 — folder chip row + filter narrowing.
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
  assert(allHtml.includes('class="folder-chips"'), '(7-all) folder chip row renders when folders exist');
  assert(allHtml.includes('data-folder-chip="all"'), '(7-all) All chip emitted with stable hook');
  assert(allHtml.includes('data-folder-chip=""'), '(7-all) Ungrouped chip emitted (empty value)');
  assert(allHtml.includes('data-folder-chip="tech"'), '(7-all) tech chip present');
  assert(allHtml.includes('data-folder-chip="design"'), '(7-all) design chip present');
  assert(
    allHtml.includes('Tech post 1') &&
      allHtml.includes('Tech post 2') &&
      allHtml.includes('Design post') &&
      allHtml.includes('Plain entry'),
    '(7-all) all entries visible when activeFolder=undefined',
  );
  // Active chip carries the .on marker class.
  assert(
    /data-folder-chip="all"[^>]*class="on"|class="on"[^>]*data-folder-chip="all"/.test(allHtml),
    '(7-all) All chip is the active one',
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
  assert(ungroupedHtml.includes('Plain entry'), '(7-ungrouped) folder=null row is shown');
  assert(
    !ungroupedHtml.includes('Tech post 1') &&
      !ungroupedHtml.includes('Tech post 2') &&
      !ungroupedHtml.includes('Design post'),
    '(7-ungrouped) foldered rows are filtered out',
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
    '(7-tech) tech rows visible',
  );
  assert(
    !techHtml.includes('Design post') && !techHtml.includes('Plain entry'),
    '(7-tech) non-tech rows filtered out',
  );
  // Folder chip hrefs hit the same /entries route with the right query.
  // Hono escapes `&` to `&amp;` inside HTML attributes — assert against the
  // escaped form (the browser unescapes it on click).
  assert(
    techHtml.includes(`/dashboard/sites/${SITE_ID}/entries?collection=blog&amp;folder=tech`),
    '(7-tech) tech chip href encodes the folder filter',
  );
  assert(
    techHtml.includes(`/dashboard/sites/${SITE_ID}/entries?collection=blog&amp;folder=`),
    '(7-tech) Ungrouped chip href uses empty folder value',
  );
  // The active folder is recorded on the table for client tooling.
  assert(
    techHtml.includes('data-active-folder="tech"'),
    '(7-tech) table records the active folder for downstream tooling',
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
    '(7-empty) per-folder empty-state copy when filter narrows to zero',
  );
}

console.log('[entries:smoke] OK');
