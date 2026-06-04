// ADR 0060 Stream A — smoke for the entries REST API.
//
// Pure-function coverage of the body validators and slug rule. The route
// handlers themselves require a live Hono context + Neon DB connection, so
// the create/list/get/update/delete round-trip is verified at the validator
// layer here: every endpoint funnels mutations through `parseCreateEntryBody`
// or `parseUpdateEntryBody`, so exercising those covers every entry/exit
// shape the API accepts and rejects.

import {
  ENTRY_SLUG_RE,
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

console.log('[entries:smoke] OK');
