// src/search/smoke.ts
//
// `bun run search:smoke` — Wave 3 #13. Exercises the search subsystem end-to-
// end without a live Postgres. The strategy follows the password / embed
// pattern: pure functions are tested directly; the DB-touching `rebuild`
// path runs against an in-memory shim that records the rows that would have
// been written; the FTS query path is exercised through an in-memory
// matcher (`inMemoryMatches` / `buildInMemorySnippet`) that mirrors the
// Postgres semantics closely enough for the assertions the brief demands.
//
// Coverage (per the plan):
//   1. Publish fixture site → entries created (count > 0), including the
//      synthetic __page metadata row.
//   2. Query known word → returns expected page + snippet wrapped in <mark>.
//   3. Re-publish with changed text → old text no longer hits, new text does.
//   4. SQL injection query string passes validation (length OK) but the
//      matcher returns no rows. The production path passes the same string
//      to `plainto_tsquery` as a bound parameter so no SQL error fires.
//   5. Empty query rejected by `validateQuery`. >100-char rejected.
//   6. Box recipe factory emits the expected section shape.

import type {
  ActionElement,
  CanvasPage,
  CanvasSiteState,
  PublishedSnapshot,
  TextElement,
} from '../canvas/schema.js';
import type { CodeElement } from '../canvas/elements/code.js';
import type { EmbedElement } from '../canvas/elements/embed.js';
import { siteSearchEntry } from '../db/schema.js';
import { extractSearchEntries, PAGE_METADATA_ELEMENT_ID } from './extract.js';
import { buildSearchRows, rebuildSearchIndex, type IndexerDb } from './indexer.js';
import {
  DEFAULT_QUERY_LIMIT,
  MAX_QUERY_LENGTH,
  validateQuery,
} from './query.js';
import {
  buildInMemoryResults,
  buildInMemorySnippet,
  inMemoryMatches,
  TS_HEADLINE_OPTIONS,
  tokenizeQuery,
} from './snippet.js';
import {
  buildSearchBoxSection,
  SEARCH_BOX_ELEMENT_ID,
  SEARCH_BOX_ENDPOINT,
  SEARCH_BOX_SECTION_NAME,
} from './box-recipe.js';

function ok(label: string): void {
  process.stdout.write(`[search:smoke] OK   ${label}\n`);
}

function fail(label: string, detail?: string): never {
  process.stderr.write(`[search:smoke] FAIL ${label}\n`);
  if (detail) process.stderr.write(`  ${detail}\n`);
  process.exit(1);
}

function assert(condition: unknown, label: string, detail?: string): asserts condition {
  if (condition) {
    ok(label);
    return;
  }
  fail(label, detail);
}

// ---------------------------------------------------------------------------
// Fixture site — exercises every text-bearing element type the extractor
// handles.
// ---------------------------------------------------------------------------

const SITE_ID = 'site-search-smoke';

function makeHeroHeading(): TextElement {
  return {
    id: 'hero-heading',
    type: 'text',
    box: { x: 0, y: 0, w: 600, h: 120, z: 1 },
    content: [
      { text: 'Ship a site that feels ' },
      { text: 'lived-in', marks: [{ type: 'bold' }] },
      { text: '.' },
    ],
    role: 'heading',
    fontSize: 64,
    fontWeight: 700,
    align: 'left',
  };
}

function makeHeroAction(): ActionElement {
  return {
    id: 'hero-cta',
    type: 'action',
    box: { x: 0, y: 200, w: 200, h: 56, z: 1 },
    label: 'Reserve your seat',
    href: '/contact',
    variant: 'solid',
  };
}

function makeHeroEmbed(): EmbedElement {
  return {
    id: 'demo-video',
    type: 'embed',
    box: { x: 700, y: 0, w: 640, h: 360, z: 1 },
    url: 'https://www.youtube.com/watch?v=abc12345',
    title: 'Watch the platform demo walkthrough',
  };
}

function makeHeroCode(): CodeElement {
  return {
    id: 'snippet-bootstrap',
    type: 'code',
    box: { x: 0, y: 300, w: 600, h: 240, z: 1 },
    language: 'typescript',
    source: '\nfunction bootstrap() {\n  return launchApp();\n}\n',
    showLineNumbers: false,
  };
}

function makeFixturePage(): CanvasPage {
  return {
    id: 'page-home',
    slug: 'home',
    title: 'Welcome aboard',
    description: 'A canvas-first publisher with smart search.',
    width: 1440,
    sections: [
      {
        id: 'section-hero',
        recipeId: 'hero-split',
        name: 'Hero',
        height: 760,
        elements: [makeHeroHeading(), makeHeroAction(), makeHeroEmbed(), makeHeroCode()],
      },
    ],
  };
}

function makeFixtureSnapshot(version: number, page: CanvasPage): PublishedSnapshot {
  // Use a fixed timestamp; the field is informational for the smoke and
  // doesn't drive the assertions.
  return {
    version,
    publishedAt: '2026-05-23T00:00:00.000Z',
    styleKit: 'charcoal',
    pages: [page],
  };
}

function makeFixtureSiteState(page: CanvasPage): CanvasSiteState {
  return {
    styleKit: 'charcoal',
    symbols: [],
    pages: [page],
  };
}

// ---------------------------------------------------------------------------
// In-memory IndexerDb shim. Mimics the slice of drizzle the indexer uses:
//   - db.delete(table).where(eq(...))     → drops matching rows
//   - db.insert(table).values(rows)       → appends rows
//   - db.batch([deleteOp, insertOp])      → runs both atomically
//
// Predicates from `eq(siteSearchEntry.siteId, X)` are inspected by walking
// the drizzle SQL chunks; we recognise the exact shape the indexer emits
// and bail loudly on anything else so a future refactor doesn't silently
// drift past the shim.
// ---------------------------------------------------------------------------

interface SimRow {
  id: string;
  siteId: string;
  pageSlug: string;
  elementId: string;
  text: string;
  publishedVersion: number;
}

interface DrizzleSqlLike {
  queryChunks: unknown[];
}

function isSqlLike(v: unknown): v is DrizzleSqlLike {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as { queryChunks?: unknown }).queryChunks)
  );
}

function stringChunkText(chunk: unknown): string | null {
  if (typeof chunk !== 'object' || chunk === null) return null;
  const v = (chunk as { value?: unknown }).value;
  if (!Array.isArray(v)) return null;
  const first: unknown = v[0];
  return typeof first === 'string' ? first : null;
}

function unwrapParam(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as Record<string, unknown>;
  if ('value' in obj && 'encoder' in obj && !('queryChunks' in obj)) {
    return obj.value;
  }
  return value;
}

class ShimDb {
  rows: SimRow[] = [];
  // Counters typed as `number` (not the literal-narrowed defaults) so the
  // smoke can assert progressing values across rebuilds.
  nextId: number = 1;
  deleteCalls: number = 0;
  insertCalls: number = 0;
  batchCalls: number = 0;

  reset(): void {
    this.rows = [];
    this.nextId = 1;
    this.deleteCalls = 0;
    this.insertCalls = 0;
    this.batchCalls = 0;
  }

  private compileSiteIdPredicate(expr: unknown): (row: SimRow) => boolean {
    if (!isSqlLike(expr)) {
      throw new Error(`[search:smoke] shim: where(...) expression was not SQL: ${String(expr)}`);
    }
    const chunks = expr.queryChunks;
    if (chunks.length !== 5) {
      throw new Error(
        `[search:smoke] shim: expected 5-chunk eq() expression, got ${String(chunks.length)}`,
      );
    }
    const col = chunks[1];
    const op = stringChunkText(chunks[2]);
    const raw = chunks[3];
    if (col !== siteSearchEntry.siteId) {
      throw new Error(
        `[search:smoke] shim: expected eq() on siteSearchEntry.siteId, got column ${String(col)}`,
      );
    }
    if (op === null || op.trim() !== '=') {
      throw new Error(`[search:smoke] shim: expected ' = ' operator, got ${String(op)}`);
    }
    const value = unwrapParam(raw);
    if (typeof value !== 'string') {
      throw new Error(`[search:smoke] shim: eq() rhs was not a string`);
    }
    return (row) => row.siteId === value;
  }

  delete(table: unknown): { where: (expr: unknown) => DeferredOp } {
    if (table !== siteSearchEntry) {
      throw new Error('[search:smoke] shim: delete() only supports siteSearchEntry');
    }
    return {
      where: (expr: unknown): DeferredOp => {
        const predicate = this.compileSiteIdPredicate(expr);
        const exec = (): Promise<void> => {
          this.deleteCalls += 1;
          this.rows = this.rows.filter((r) => !predicate(r));
          return Promise.resolve();
        };
        return makeDeferred(exec);
      },
    };
  }

  insert(table: unknown): { values: (rows: unknown) => DeferredOp } {
    if (table !== siteSearchEntry) {
      throw new Error('[search:smoke] shim: insert() only supports siteSearchEntry');
    }
    return {
      values: (input: unknown): DeferredOp => {
        const list = Array.isArray(input) ? input : [input];
        const exec = (): Promise<void> => {
          this.insertCalls += 1;
          for (const v of list) {
            const r = v as Partial<SimRow>;
            this.rows.push({
              id: `row-${String(this.nextId++)}`,
              siteId: String(r.siteId),
              pageSlug: String(r.pageSlug),
              elementId: String(r.elementId),
              text: String(r.text),
              publishedVersion: Number(r.publishedVersion),
            });
          }
          return Promise.resolve();
        };
        return makeDeferred(exec);
      },
    };
  }

  async batch(ops: ReadonlyArray<DeferredOp>): Promise<void> {
    this.batchCalls += 1;
    for (const op of ops) {
      await op.__exec();
    }
  }
}

// DeferredOp is a thenable representing a queued drizzle op. The indexer
// either awaits it directly (one-shot delete on empty rebuild) or hands it
// into `db.batch([...])`. We expose `__exec()` so the batch path runs each
// pending op once, in order.
interface DeferredOp extends PromiseLike<void> {
  __exec: () => Promise<void>;
}

function makeDeferred(exec: () => Promise<void>): DeferredOp {
  let ran: Promise<void> | null = null;
  const op: DeferredOp = {
    __exec: () => {
      if (!ran) ran = exec();
      return ran;
    },
    then(onfulfilled, onrejected) {
      if (!ran) ran = exec();
      return ran.then(onfulfilled, onrejected);
    },
  };
  return op;
}

const shim = new ShimDb();
const indexerDb = shim as unknown as IndexerDb;

// ---------------------------------------------------------------------------
// (1) extractSearchEntries — fixture publish produces rows > 0 and covers
//     every text-bearing element type.
// ---------------------------------------------------------------------------

const page1 = makeFixturePage();
const snapshot1 = makeFixtureSnapshot(1, page1);

const drafts1 = extractSearchEntries(snapshot1);
assert(
  drafts1.length > 0,
  'extractSearchEntries returns at least one row for the fixture',
  `got ${String(drafts1.length)} drafts`,
);

const draftIds = new Set(drafts1.map((d) => d.elementId));
assert(draftIds.has('hero-heading'), 'fixture produces hero-heading entry');
assert(draftIds.has('hero-cta'), 'fixture produces hero-cta (action) entry');
assert(draftIds.has('demo-video'), 'fixture produces demo-video (embed title) entry');
assert(draftIds.has('snippet-bootstrap'), 'fixture produces snippet-bootstrap (code first line) entry');
assert(
  draftIds.has(PAGE_METADATA_ELEMENT_ID),
  'fixture produces synthetic __page metadata entry',
);

// Code first-line rule: leading blank line is skipped, the first non-blank
// line is what lands in the index.
const codeRow = drafts1.find((d) => d.elementId === 'snippet-bootstrap');
assert(
  codeRow !== undefined && codeRow.text === 'function bootstrap() {',
  'code element indexed via the first non-blank line',
  codeRow ? codeRow.text : '<missing>',
);

// Embed without a title contributes no row.
const noTitleSnapshot = makeFixtureSnapshot(99, {
  ...page1,
  sections: [
    {
      ...page1.sections[0]!,
      elements: [
        {
          id: 'embed-no-title',
          type: 'embed',
          box: { x: 0, y: 0, w: 320, h: 240, z: 1 },
          url: 'https://www.youtube.com/watch?v=zzz98765',
        },
      ],
    },
  ],
});
const noTitleDrafts = extractSearchEntries(noTitleSnapshot);
assert(
  !noTitleDrafts.some((d) => d.elementId === 'embed-no-title'),
  'embed without title contributes no row',
);

// ---------------------------------------------------------------------------
// (2) buildSearchRows stamps siteId + publishedVersion onto every row.
// ---------------------------------------------------------------------------

const stamped = buildSearchRows(SITE_ID, snapshot1);
assert(stamped.length === drafts1.length, 'buildSearchRows preserves row count');
assert(
  stamped.every((r) => r.siteId === SITE_ID && r.publishedVersion === 1),
  'buildSearchRows stamps siteId + version on every row',
);

// ---------------------------------------------------------------------------
// (3) rebuildSearchIndex round-trip: writes the rows via batch DELETE+INSERT.
// ---------------------------------------------------------------------------

await rebuildSearchIndex(SITE_ID, snapshot1, indexerDb);
assert(
  shim.rows.length === stamped.length,
  'rebuildSearchIndex inserts every extracted row',
  `expected ${String(stamped.length)}, got ${String(shim.rows.length)}`,
);
{
  // Snapshot the counters into locals so the narrowing the `assert(...)`
  // helper does on its boolean expression doesn't pin shim.batchCalls /
  // shim.deleteCalls / shim.insertCalls to the literal value at this
  // point — the assertions further down expect them to keep climbing.
  const b: number = shim.batchCalls;
  const d: number = shim.deleteCalls;
  const i: number = shim.insertCalls;
  assert(
    b === 1 && d === 1 && i === 1,
    'rebuildSearchIndex issues exactly one delete + one insert inside one batch',
    `batches=${String(b)} deletes=${String(d)} inserts=${String(i)}`,
  );
}

// ---------------------------------------------------------------------------
// (4) Query for a known word → returns expected (page, snippet) row.
//     The in-memory matcher mirrors the Postgres FTS contract enough that a
//     unique word in the fixture surfaces exactly the row that contains it.
// ---------------------------------------------------------------------------

const knownQuery = 'lived-in';
const knownResults = buildInMemoryResults(shim.rows, knownQuery, DEFAULT_QUERY_LIMIT);
assert(
  knownResults.length >= 1,
  `query "${knownQuery}" returns at least one hit`,
  `hits=${String(knownResults.length)}`,
);
const headingHit = knownResults.find((r) => r.elementId === 'hero-heading');
assert(headingHit !== undefined, 'query hits the hero-heading row by content');
assert(
  headingHit !== undefined &&
    headingHit.snippet.includes('<mark>') &&
    headingHit.snippet.includes('</mark>'),
  'snippet wraps the matching token in <mark>',
  headingHit?.snippet,
);
assert(
  headingHit !== undefined && headingHit.pageSlug === 'home',
  'hit row carries the page slug',
);

// Page-level metadata hit: the word "search" is in page.description.
const metaResults = buildInMemoryResults(shim.rows, 'search', DEFAULT_QUERY_LIMIT);
const metaHit = metaResults.find((r) => r.elementId === PAGE_METADATA_ELEMENT_ID);
assert(metaHit !== undefined, 'page metadata is searchable via __page row');

// ---------------------------------------------------------------------------
// (5) Re-publish with changed text → old text no longer hits, new text does.
// ---------------------------------------------------------------------------

const heading2: TextElement = {
  ...makeHeroHeading(),
  content: [{ text: 'A brand-new tagline about flamingos.' }],
};
const page2: CanvasPage = {
  ...page1,
  title: 'Updated welcome',
  description: 'Rev01 lets owners ship a flamingo-coloured site.',
  sections: [
    {
      ...page1.sections[0]!,
      elements: [heading2, makeHeroAction(), makeHeroEmbed(), makeHeroCode()],
    },
  ],
};
const snapshot2 = makeFixtureSnapshot(2, page2);

await rebuildSearchIndex(SITE_ID, snapshot2, indexerDb);
const oldHit = buildInMemoryResults(shim.rows, 'lived-in', DEFAULT_QUERY_LIMIT);
assert(oldHit.length === 0, 'old text no longer hits after re-publish');
const newHit = buildInMemoryResults(shim.rows, 'flamingo', DEFAULT_QUERY_LIMIT);
assert(newHit.length >= 1, 'new text hits after re-publish');
assert(
  shim.rows.every((r) => r.publishedVersion === 2),
  'rebuild stamps the new published version on every row',
  `versions=${String([...new Set(shim.rows.map((r) => r.publishedVersion))].join(','))}`,
);
{
  const b: number = shim.batchCalls;
  assert(b === 2, 'second rebuild issues a second batch', `batchCalls=${String(b)}`);
}

// Idempotency: running rebuild a third time with the same snapshot leaves
// the same set of (pageSlug, elementId, text) tuples.
const beforeSig = shim.rows
  .map((r) => `${r.pageSlug}|${r.elementId}|${r.text}|${String(r.publishedVersion)}`)
  .sort()
  .join('\n');
await rebuildSearchIndex(SITE_ID, snapshot2, indexerDb);
const afterSig = shim.rows
  .map((r) => `${r.pageSlug}|${r.elementId}|${r.text}|${String(r.publishedVersion)}`)
  .sort()
  .join('\n');
assert(beforeSig === afterSig, 'rebuildSearchIndex is idempotent for an unchanged snapshot');

// Empty snapshot path: prune-only branch.
const emptyPage: CanvasPage = {
  id: 'page-empty',
  slug: 'empty',
  title: '',
  width: 1440,
  sections: [],
};
const emptySnapshot = makeFixtureSnapshot(3, emptyPage);
await rebuildSearchIndex(SITE_ID, emptySnapshot, indexerDb);
assert(
  shim.rows.length === 0,
  'rebuildSearchIndex with empty snapshot prunes all rows',
  `rows=${String(shim.rows.length)}`,
);
{
  const d: number = shim.deleteCalls;
  const i: number = shim.insertCalls;
  assert(
    d === 4 && i === 3,
    'prune-only rebuild issues a delete without an insert',
    `deletes=${String(d)} inserts=${String(i)}`,
  );
}

// Reset back to the v2 fixture for the query-validation assertions below.
await rebuildSearchIndex(SITE_ID, snapshot2, indexerDb);

// ---------------------------------------------------------------------------
// (6) Query escaping: SQL-injection-shaped string passes validation
//     (length-wise it's fine) and the matcher returns zero rows. The
//     production path passes the same string to `plainto_tsquery` as a
//     bound parameter, never interpolating it into the SQL string — so the
//     same input that's safe here is safe in production.
// ---------------------------------------------------------------------------

const injection = `'; DROP TABLE site_search_entry; --`;
const validatedInjection = validateQuery(injection);
assert(
  validatedInjection.kind === 'ok',
  'SQL-injection string passes validateQuery (length OK)',
  validatedInjection.kind,
);
const injectionHits = buildInMemoryResults(shim.rows, injection, DEFAULT_QUERY_LIMIT);
assert(
  injectionHits.length === 0,
  'SQL-injection string returns zero matches against the index',
  `hits=${String(injectionHits.length)}`,
);

// ---------------------------------------------------------------------------
// (7) Empty + over-long query validation.
// ---------------------------------------------------------------------------

assert(validateQuery('').kind === 'empty', 'empty string rejected');
assert(validateQuery('   ').kind === 'empty', 'whitespace-only string rejected');
assert(validateQuery(null).kind === 'empty', 'null rejected');
assert(validateQuery(undefined).kind === 'empty', 'undefined rejected');
assert(validateQuery(42).kind === 'empty', 'non-string rejected');

const tooLong = 'a'.repeat(MAX_QUERY_LENGTH + 1);
assert(validateQuery(tooLong).kind === 'too-long', 'query longer than 100 chars rejected');

const justRight = 'a'.repeat(MAX_QUERY_LENGTH);
assert(
  validateQuery(justRight).kind === 'ok',
  `query of exactly ${String(MAX_QUERY_LENGTH)} chars accepted`,
);

// ---------------------------------------------------------------------------
// (8) Snippet helpers — public contract.
// ---------------------------------------------------------------------------

assert(
  TS_HEADLINE_OPTIONS.includes('StartSel=<mark>') &&
    TS_HEADLINE_OPTIONS.includes('StopSel=</mark>'),
  'TS_HEADLINE_OPTIONS uses <mark>/</mark> wrappers',
);
assert(
  TS_HEADLINE_OPTIONS.includes('MaxWords=15') && TS_HEADLINE_OPTIONS.includes('MinWords=5'),
  'TS_HEADLINE_OPTIONS pins MaxWords=15 and MinWords=5',
);

assert(
  tokenizeQuery('Lived-In, Today').join('|') === 'lived|in|today',
  'tokenizeQuery lower-cases and splits on non-word characters',
);
assert(inMemoryMatches('hello world', 'world'), 'inMemoryMatches: single token hit');
assert(inMemoryMatches('hello WORLD', 'world'), 'inMemoryMatches: case-insensitive');
assert(!inMemoryMatches('hello world', 'flamingo'), 'inMemoryMatches: missing token rejected');
const snippetForA = buildInMemorySnippet('Lived-in. Lived-in vibes.', 'lived-in');
assert(
  snippetForA.includes('<mark>'),
  'buildInMemorySnippet wraps the first matched token in <mark>',
);

// HTML escaping inside snippet bodies: a `<script>` substring in the indexed
// text is escaped so the visitor-facing UI can drop the snippet straight in.
const escaped = buildInMemorySnippet('beware <script> injection</script> here lived-in', 'lived-in');
assert(
  !escaped.includes('<script>') && escaped.includes('&lt;script&gt;'),
  'buildInMemorySnippet HTML-escapes raw < and >',
);

// ---------------------------------------------------------------------------
// (9) Box recipe — factory output.
// ---------------------------------------------------------------------------

const recipeSection = buildSearchBoxSection();
assert(
  recipeSection.name === SEARCH_BOX_SECTION_NAME,
  'recipe section name brands it as the search box',
);
assert(recipeSection.recipeId === 'cta-band', 'recipe section uses the cta-band registry slot');
const firstElement = recipeSection.elements[0];
if (recipeSection.elements.length !== 1 || !firstElement || firstElement.type !== 'action') {
  throw new Error('[search:smoke] recipe section should contain exactly one action element');
}
ok('recipe contains exactly one action element');
const actionElement = firstElement;
assert(actionElement.id === SEARCH_BOX_ELEMENT_ID, 'action element uses the namespaced id');
assert(actionElement.href === SEARCH_BOX_ENDPOINT, 'action href points at the search endpoint');
assert(actionElement.variant === 'solid', 'action defaults to the solid variant');

const customised = buildSearchBoxSection({
  label: 'Find on site',
  variant: 'pill',
  height: 120,
  box: { x: 10, y: 10, w: 240, h: 64, z: 5 },
});
assert(
  customised.height === 120 &&
    (customised.elements[0] as ActionElement).label === 'Find on site' &&
    (customised.elements[0] as ActionElement).variant === 'pill' &&
    (customised.elements[0] as ActionElement).box.w === 240,
  'recipe respects override options',
);

// Sanity: the recipe section is structurally compatible with a real page —
// we can drop it into a CanvasSiteState without TS complaining.
const recipeState: CanvasSiteState = makeFixtureSiteState({
  ...page1,
  sections: [recipeSection, ...page1.sections],
});
assert(recipeState.pages[0]!.sections[0]!.id === recipeSection.id, 'recipe section composes into a site');

process.stdout.write('[search:smoke] OK\n');
process.exit(0);
