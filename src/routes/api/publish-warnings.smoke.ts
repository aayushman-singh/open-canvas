// src/routes/api/publish-warnings.smoke.ts
//
// ADR 0063 F-publish-warnings — pins that the publish route surfaces
// collection materializer warnings to the JSON response and that the
// editor-client publish handler consumes them.
//
// The publish route itself requires Cloudflare bindings (DB, R2,
// Durable Objects, Clerk env) so it cannot be exercised in-process by a
// bun smoke. We instead:
//
//   1. Re-run the materializer with a publish-shaped fixture (a
//      Collection bound to a non-existent slug) and pin the exact
//      warning string the route now surfaces verbatim — the contract
//      across the wire.
//   2. Source-level guard that `src/routes/api/publish.ts` imports
//      `materializeCollectionsWithReport` (not the discard alias), runs
//      the report with the `materializerWarnings` name we promise in
//      the response, and stamps that array onto the success response
//      JSON.
//   3. Source-level guard that `src/editor-client/publish.ts` reads the
//      `warnings` field off the response body, surfaces a count suffix
//      on the success status line, and console.warns every line so
//      Owners can lift the strings out of devtools.
//
// Run with `bun run publish-warnings:smoke`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  materializeCollectionsWithReport,
  type MaterializerEntry,
} from '../../canvas/elements/collection-materializer.js';
import type { CollectionElement } from '../../canvas/elements/collection.js';
import type { CanvasPage, EditableSite } from '../../canvas/schema.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[publish-warnings:smoke] ' + message);
}

// ---------------------------------------------------------------------------
// (1) Materializer warning verbatim — the contract across the wire.
// ---------------------------------------------------------------------------

const collection: CollectionElement = {
  id: 'coll-empty-slug',
  type: 'collection',
  box: { x: 0, y: 0, w: 800, h: 600, z: 1 },
  collectionSlug: 'ghost-slug',
  sort: 'date-desc',
  display: 'card',
};
const page: CanvasPage = {
  id: 'page-home',
  slug: 'home',
  title: 'Home',
  width: 1440,
  sections: [
    {
      id: 'sec',
      recipeId: 'custom',
      name: 'sec',
      height: 600,
      elements: [collection],
    },
  ],
};
const site: EditableSite = {
  styleKit: 'charcoal',
  pages: [page],
};
const entries: MaterializerEntry[] = []; // no rows for any slug

const report = materializeCollectionsWithReport(site, entries);
assert(report.warnings.length === 1, '(1) one warning emitted for unbound slug');
const expectedWarning =
  'Collection element coll-empty-slug on page home matched 0 entries (source=ghost-slug, folder=unset).';
assert(
  report.warnings[0] === expectedWarning,
  '(1) warning matches the verbatim shape the publish response surfaces: ' +
    'expected ' +
    JSON.stringify(expectedWarning) +
    ' but got ' +
    JSON.stringify(report.warnings[0]),
);

// ---------------------------------------------------------------------------
// (2) publish.ts source — must use the report-returning materializer and
// stamp `warnings` onto the success response.
// ---------------------------------------------------------------------------

const thisDir = dirname(fileURLToPath(import.meta.url));
const publishSrc = readFileSync(join(thisDir, 'publish.ts'), 'utf8');

assert(
  publishSrc.includes("materializeCollectionsWithReport"),
  '(2) publish.ts must import materializeCollectionsWithReport (not the discard alias)',
);
assert(
  !/\bmaterializeCollections\s*\(/.test(publishSrc),
  '(2) publish.ts must not call the legacy materializeCollections alias — ' +
    'use materializeCollectionsWithReport so warnings reach the response',
);
assert(
  publishSrc.includes('materializerWarnings'),
  '(2) publish.ts must capture warnings under the materializerWarnings name',
);
// The success-path response object literal must include `warnings:
// materializerWarnings`. This is the load-bearing contract the
// editor-client and any future API consumer reads.
assert(
  publishSrc.includes('warnings: materializerWarnings'),
  '(2) publish.ts success response must stamp warnings: materializerWarnings',
);

// ---------------------------------------------------------------------------
// (3) editor-client/publish.ts — must read body.warnings and surface them.
// ---------------------------------------------------------------------------

const editorPublishSrc = readFileSync(
  join(thisDir, '..', '..', 'editor-client', 'publish.ts'),
  'utf8',
);

assert(
  editorPublishSrc.includes('warnings?: string[]'),
  '(3) editor-client/publish.ts must type the response body warnings field as string[]',
);
assert(
  editorPublishSrc.includes('body.warnings'),
  '(3) editor-client/publish.ts must read body.warnings off the response',
);
assert(
  editorPublishSrc.includes("'[publish:warning]'"),
  '(3) editor-client/publish.ts must console.warn each warning under [publish:warning]',
);
// Status suffix must surface count visibly. We match the substring
// "warning" appearing in the suffix-building branch.
assert(
  editorPublishSrc.includes("' warning'"),
  '(3) editor-client/publish.ts must compose a "(N warning[s])" suffix on the status line',
);

console.log('[publish-warnings:smoke] OK');
