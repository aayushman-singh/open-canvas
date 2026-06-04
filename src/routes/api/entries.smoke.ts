// ADR 0060 Stream A — smoke for the entries REST API.
//
// Pure-function coverage of the body validators and slug rule. The route
// handlers themselves require a live Hono context + Neon DB connection, so
// the create/list/get/update/delete round-trip is verified at the validator
// layer here: every endpoint funnels mutations through `parseCreateEntryBody`
// or `parseUpdateEntryBody`, so exercising those covers every entry/exit
// shape the API accepts and rejects.

import type { CanvasPage } from '../../canvas/schema.js';
import {
  ENTRY_SLUG_RE,
  findConflictingSitePage,
  isValidSlug,
  parseCreateEntryBody,
  parseUpdateEntryBody,
} from './entries.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[entries:smoke] ${message}`);
}

// -- Slug rule ---------------------------------------------------------------

assert(isValidSlug('hello-world'), 'lowercase dashed slug must validate');
assert(isValidSlug('a'), 'single char slug must validate');
assert(isValidSlug('a1'), 'alphanumeric short slug must validate');
assert(isValidSlug('a'.repeat(80)), '80-char slug must validate');
assert(!isValidSlug(''), 'empty slug must reject');
assert(!isValidSlug('a'.repeat(81)), '81-char slug must reject');
assert(!isValidSlug('Hello'), 'uppercase slug must reject');
assert(!isValidSlug('hello world'), 'spaces must reject');
assert(!isValidSlug('-leading'), 'leading dash must reject');
assert(!isValidSlug('trailing-'), 'trailing dash must reject');
assert(!isValidSlug('under_score'), 'underscore must reject');
assert(!isValidSlug(42), 'non-string must reject');
assert(!isValidSlug(null), 'null must reject');
assert(ENTRY_SLUG_RE.test('valid-slug-42'), 'regex exports for reuse');

// -- Create body validation --------------------------------------------------

const createOk = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'hello-world',
  title: 'Hello World',
  excerpt: 'A first post.',
  body: '# Hello\n\nWorld.',
  publishedDate: '2026-06-04',
  author: 'Aayushman',
  category: 'general',
  tags: ['intro', 'meta'],
  status: 'published',
});
assert(createOk.ok, 'minimal valid create body must parse');
if (createOk.ok) {
  assert(createOk.value.collectionSlug === 'blog', 'create echoes collectionSlug');
  assert(createOk.value.slug === 'hello-world', 'create echoes slug');
  assert(createOk.value.status === 'published', 'create echoes status');
  assert(createOk.value.ogImageAssetId === null, 'create defaults ogImageAssetId to null');
  assert(createOk.value.tags.length === 2, 'create preserves tags');
}

const createDefaults = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'a',
  title: 'A',
  publishedDate: '2026-06-04',
});
assert(createDefaults.ok, 'create with only required fields must parse');
if (createDefaults.ok) {
  assert(createDefaults.value.excerpt === '', 'excerpt defaults to empty string');
  assert(createDefaults.value.body === '', 'body defaults to empty string');
  assert(createDefaults.value.author === '', 'author defaults to empty string');
  assert(createDefaults.value.category === '', 'category defaults to empty string');
  assert(createDefaults.value.tags.length === 0, 'tags defaults to []');
  assert(createDefaults.value.status === 'draft', 'status defaults to draft');
  assert(createDefaults.value.ogImageAssetId === null, 'ogImageAssetId defaults to null');
}

const createBadCollection = parseCreateEntryBody({
  collectionSlug: 'Blog!',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
});
assert(!createBadCollection.ok, 'invalid collectionSlug must reject');

const createBadSlug = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'NOT OK',
  title: 'T',
  publishedDate: '2026-06-04',
});
assert(!createBadSlug.ok, 'invalid slug must reject');

const createBlankTitle = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: '   ',
  publishedDate: '2026-06-04',
});
assert(!createBlankTitle.ok, 'whitespace-only title must reject');

const createBadDate = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: 'not-a-date',
});
assert(!createBadDate.ok, 'invalid publishedDate must reject');

const createBadTags = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  tags: ['ok', 42],
});
assert(!createBadTags.ok, 'non-string tag entry must reject');

const createBadStatus = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  status: 'archived',
});
assert(!createBadStatus.ok, 'unknown status must reject');

const createNonObject = parseCreateEntryBody('not a body');
assert(!createNonObject.ok, 'non-object body must reject');

// -- Update body validation --------------------------------------------------

const updateOk = parseUpdateEntryBody({ title: 'Updated' });
assert(updateOk.ok, 'partial update with one field must parse');
if (updateOk.ok) {
  assert(updateOk.value.title === 'Updated', 'patch echoes title');
  assert(updateOk.value.slug === undefined, 'patch leaves untouched fields absent');
}

const updateSlugOk = parseUpdateEntryBody({ slug: 'new-slug' });
assert(updateSlugOk.ok, 'slug-only patch must parse');

const updateStatusOk = parseUpdateEntryBody({ status: 'published' });
assert(updateStatusOk.ok, 'status-only patch must parse');

const updateClearOg = parseUpdateEntryBody({ ogImageAssetId: null });
assert(updateClearOg.ok, 'ogImageAssetId=null must be allowed (clear)');
if (updateClearOg.ok) {
  assert(updateClearOg.value.ogImageAssetId === null, 'patch preserves ogImageAssetId=null');
}

const updateSetOg = parseUpdateEntryBody({ ogImageAssetId: 'asset-123' });
assert(updateSetOg.ok, 'ogImageAssetId=string must be allowed');

const updateEmpty = parseUpdateEntryBody({});
assert(!updateEmpty.ok, 'empty patch must reject');

const updateCollectionSlug = parseUpdateEntryBody({ collectionSlug: 'notes' });
assert(!updateCollectionSlug.ok, 'patching collectionSlug must reject (immutable)');

const updateBadSlug = parseUpdateEntryBody({ slug: 'NOT OK' });
assert(!updateBadSlug.ok, 'invalid slug in patch must reject');

const updateBadDate = parseUpdateEntryBody({ publishedDate: 'nope' });
assert(!updateBadDate.ok, 'invalid publishedDate in patch must reject');

const updateBadTags = parseUpdateEntryBody({ tags: 'one,two' });
assert(!updateBadTags.ok, 'string tags must reject (array required)');

const updateBadStatus = parseUpdateEntryBody({ status: 'archived' });
assert(!updateBadStatus.ok, 'unknown status in patch must reject');

const updateBadOg = parseUpdateEntryBody({ ogImageAssetId: '' });
assert(!updateBadOg.ok, 'empty-string ogImageAssetId must reject');

const updateNonObject = parseUpdateEntryBody(42);
assert(!updateNonObject.ok, 'non-object patch body must reject');

// -- Slug-collision pre-check (ADR 0060 Pass 3) ------------------------------
//
// `findConflictingSitePage` is the pure helper the POST/PATCH handlers run
// before insert/update so the Owner finds out at write time, not at publish.
// Exercise the three meaningful shapes here.

function makePage(overrides: Partial<CanvasPage>): CanvasPage {
  return {
    id: overrides.id ?? 'pg-test',
    slug: overrides.slug ?? 'about',
    title: overrides.title ?? 'About',
    width: overrides.width ?? 1440,
    sections: overrides.sections ?? [],
    ...overrides,
  };
}

// Static page at the materialized slug must be flagged.
const staticAbout = makePage({
  id: 'pg-blog-about-static',
  slug: 'blog/about',
  title: 'About Our Blog',
});
const conflict = findConflictingSitePage([staticAbout], 'blog', 'about');
assert(conflict !== null, 'static page at blog/about must collide with entry blog/about');
assert(
  conflict?.title === 'About Our Blog',
  'returned conflict must be the colliding page (for error body)',
);
assert(
  conflict?.slug === 'blog/about',
  'returned conflict slug must echo the materialized slug',
);

// A `collection-item-template` page for the SAME collection is the template
// the materializer expands — not a static page. Must NOT be flagged even
// though its slug shape can coincide.
const templateAbout = makePage({
  id: 'pg-blog-template',
  slug: 'blog/about',
  title: 'Blog Entry Template',
  pageKind: 'collection-item-template',
  collectionSlug: 'blog',
});
const templateConflict = findConflictingSitePage([templateAbout], 'blog', 'about');
assert(
  templateConflict === null,
  'template page for the same collection must NOT count as a collision',
);

// A `collection-item-template` page for a DIFFERENT collection at the same
// slug shape would still be a real conflict — the materializer would not own
// that path.
const templateOtherCollection = makePage({
  id: 'pg-notes-template',
  slug: 'blog/about',
  title: 'Notes Template',
  pageKind: 'collection-item-template',
  collectionSlug: 'notes',
});
const crossCollectionConflict = findConflictingSitePage(
  [templateOtherCollection],
  'blog',
  'about',
);
assert(
  crossCollectionConflict !== null,
  'template page for a different collection must still collide',
);

// Unrelated pages must pass through with no collision.
const unrelated = makePage({ id: 'pg-home', slug: 'home', title: 'Home' });
const otherEntry = makePage({ id: 'pg-blog-intro', slug: 'blog/intro', title: 'Intro' });
const noConflict = findConflictingSitePage([unrelated, otherEntry], 'blog', 'about');
assert(noConflict === null, 'no matching slug must report no collision');

// Empty page list trivially does not collide.
const emptyConflict = findConflictingSitePage([], 'blog', 'about');
assert(emptyConflict === null, 'empty pages must not collide');

console.log('[entries:smoke] OK');
