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
  FOLDER_MAX_LENGTH,
  findConflictingSitePage,
  isValidSlug,
  parseCreateEntryBody,
  parseFolder,
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

// -- Folder validation (ADR 0063 dec 7) --------------------------------------
//
// `parseFolder` is the shared rule the create body, the update body, and
// the GET filter all funnel through. Cover the shape rule end to end here
// so the API and dashboard both inherit the same contract.

assert(FOLDER_MAX_LENGTH === 64, 'folder cap is the 64-char limit ADR 0063 d7 names');

const folderNull = parseFolder(null);
assert(folderNull.ok && folderNull.value === null, 'null folder = ungrouped, must parse');

const folderSimple = parseFolder('tech');
assert(folderSimple.ok && folderSimple.value === 'tech', 'simple folder value must parse');

const folderUtf8 = parseFolder('Notes Été');
assert(folderUtf8.ok, 'non-ASCII folder names must be allowed (case-sensitive, free text)');

const folderMaxLen = parseFolder('a'.repeat(64));
assert(folderMaxLen.ok, '64-char folder is the upper boundary and must parse');

const folderEmpty = parseFolder('');
assert(!folderEmpty.ok, 'empty-string folder must reject (null clears, empty is not a synonym)');

const folderTooLong = parseFolder('a'.repeat(65));
assert(!folderTooLong.ok, '65-char folder must reject loudly — no silent truncation');

const folderSlash = parseFolder('a/b');
assert(!folderSlash.ok, 'forward-slash folder must reject (path separator)');

const folderBackslash = parseFolder('a\\b');
assert(!folderBackslash.ok, 'backslash folder must reject (path separator)');

const folderNonString = parseFolder(42);
assert(!folderNonString.ok, 'non-string non-null folder must reject');

const folderUndefined = parseFolder(undefined);
assert(!folderUndefined.ok, 'undefined folder must reject (caller picks null or a string)');

// Create body — folder absent defaults to null (ungrouped).
const createNoFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
});
assert(createNoFolder.ok, 'create without folder must parse');
if (createNoFolder.ok) {
  assert(createNoFolder.value.folder === null, 'absent folder defaults to null on create');
}

// Create body — explicit null folder.
const createNullFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: null,
});
assert(createNullFolder.ok, 'create with explicit null folder must parse');
if (createNullFolder.ok) {
  assert(createNullFolder.value.folder === null, 'explicit null folder preserved on create');
}

// Create body — valid folder string.
const createWithFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: 'tech',
});
assert(createWithFolder.ok, 'create with valid folder string must parse');
if (createWithFolder.ok) {
  assert(createWithFolder.value.folder === 'tech', 'folder string echoed back on create');
}

// Create body — invalid folder rejects the whole body (no partial success).
const createEmptyFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: '',
});
assert(!createEmptyFolder.ok, 'create with empty folder string must reject');

const createSlashFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: 'a/b',
});
assert(!createSlashFolder.ok, 'create with slash in folder must reject');

const createBackslashFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: 'a\\b',
});
assert(!createBackslashFolder.ok, 'create with backslash in folder must reject');

const createLongFolder = parseCreateEntryBody({
  collectionSlug: 'blog',
  slug: 'ok',
  title: 'T',
  publishedDate: '2026-06-04',
  folder: 'a'.repeat(65),
});
assert(!createLongFolder.ok, 'create with overlong folder must reject (no truncation)');

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

// Folder PATCH — presence is meaningful (absent = leave alone, null =
// clear, string = set). ADR 0063 dec 7.
const patchSetFolder = parseUpdateEntryBody({ folder: 'design' });
assert(patchSetFolder.ok, 'patch with folder string must parse');
if (patchSetFolder.ok) {
  assert(patchSetFolder.value.folder === 'design', 'patch echoes the folder string');
}

const patchClearFolder = parseUpdateEntryBody({ folder: null });
assert(patchClearFolder.ok, 'patch with folder=null must parse (clears the folder)');
if (patchClearFolder.ok) {
  assert(patchClearFolder.value.folder === null, 'patch preserves folder=null');
}

const patchEmptyFolder = parseUpdateEntryBody({ folder: '' });
assert(!patchEmptyFolder.ok, 'patch with empty folder string must reject — use null to clear');

const patchSlashFolder = parseUpdateEntryBody({ folder: 'a/b' });
assert(!patchSlashFolder.ok, 'patch with slash folder must reject');

const patchBackslashFolder = parseUpdateEntryBody({ folder: 'a\\b' });
assert(!patchBackslashFolder.ok, 'patch with backslash folder must reject');

const patchLongFolder = parseUpdateEntryBody({ folder: 'a'.repeat(65) });
assert(!patchLongFolder.ok, 'patch with overlong folder must reject');

const patchFolderAbsent = parseUpdateEntryBody({ title: 'just-title' });
assert(patchFolderAbsent.ok, 'patch without folder field must still parse');
if (patchFolderAbsent.ok) {
  assert(
    !('folder' in patchFolderAbsent.value),
    'absent folder must not appear on the patch (preserves DB value)',
  );
}

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
