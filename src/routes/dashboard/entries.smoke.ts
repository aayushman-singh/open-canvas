// src/routes/dashboard/entries.smoke.ts
//
// `bun run src/routes/dashboard/entries.smoke.ts` — render-level smoke for
// the ADR 0060 Stream C Entries dashboard route. Verifies that:
//
//   1. The list view renders the toolbar, the "+ New entry" button, the
//      collection pill row, the table header, one row per entry, status
//      pills, and the delete affordance.
//   2. The list view collapses to an empty-state with the `pageKind` hint
//      when the site has no collections.
//   3. The form view (mode='new') renders all required fields with their
//      types and the create button.
//   4. The form view (mode='edit') prefills inputs from the entry row and
//      shows the "Save changes" button.
//   5. The shell sidebar wiring exposes an 'Entries' nav entry between
//      Forms and Versions.
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
      entries: [],
    }),
  );

  assert(html.includes('No collections yet'), '(2) empty-state copy present');
  assert(html.includes('pageKind'), '(2) empty-state hints at pageKind so the Owner knows what to do');
  assert(
    !html.includes('+ New entry') && !html.includes('class="formsel"'),
    '(2) no CTA / pill row when there are zero collections',
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
}

console.log('[entries:smoke] OK');
