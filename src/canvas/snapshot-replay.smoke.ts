// src/canvas/snapshot-replay.smoke.ts
//
// Historical-snapshot replay regression gate. Born from the 2026-06-02
// action-shape incident: a PR flipped `action.label` from `string` to
// `InlineRun[]` without migrating existing rows, the writer-validate-gate
// accepted the new shape but the renderer 500'd on the old data, and every
// production site that had a button broke for visitors.
//
// The lesson: schema breaks need a deploy-time replay smoke that runs every
// historical fixture through both validators (editable + published). If a
// PR changes a schema field in a way that invalidates existing canvas JSON,
// CI fails BEFORE the deploy reaches production.
//
// The fixtures here are the same ones `yjs-projection:smoke` uses for
// round-trip coverage. They were curated to span the live canvas shapes
// (small + enterprise scale + portfolio-shaped + apogee fixture). Any new
// fixture added to `src/canvas/fixtures/*.json` will automatically join
// this smoke by virtue of the glob, so contributors do not need to
// remember to register them.
//
// Run with `bun run snapshot-replay:smoke`.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLISH_ONLY_REQUIRED_FIELDS,
  validateEditableSite,
  validatePublishedSnapshot,
} from './validate.js';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[snapshot-replay:smoke] ${message}`);
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(thisDir, 'fixtures');

const fixtureFiles = fs
  .readdirSync(fixturesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

assert(
  fixtureFiles.length > 0,
  `expected at least one fixture in ${fixturesDir}; found none`,
);

let editablePassed = 0;
let publishedPassed = 0;

for (const fixtureFile of fixtureFiles) {
  const filePath = path.join(fixturesDir, fixtureFile);
  const raw = fs.readFileSync(filePath, 'utf-8');
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`[snapshot-replay:smoke] fixture ${fixtureFile} is not valid JSON: ${message}`);
  }

  // 1. Replay through validateEditableSite. Every fixture in src/canvas/
  //    fixtures/ is an EditableSite shape; if any rejects, a schema break
  //    has invalidated historical canvas data.
  const editable = validateEditableSite(state);
  if (!editable.valid) {
    const errors = editable.errors.join('\n  - ');
    throw new Error(
      `[snapshot-replay:smoke] fixture ${fixtureFile} fails validateEditableSite:\n  - ${errors}\n` +
        '  Action: either migrate the fixture forward to the new schema, or ' +
        'add a migration step that converts historical rows before the new ' +
        'schema ships. Do NOT just delete the fixture.',
    );
  }
  editablePassed += 1;

  // 2. Synthesise a PublishedSnapshot from the EditableSite by adding the
  //    publish-only required fields. The fields list is the canonical
  //    enumeration from ADR 0012 dec 5 — adding a new publish-only field
  //    here requires updating PUBLISH_ONLY_REQUIRED_FIELDS in validate.ts
  //    first (and the validate-parity smoke pins that contract).
  const stateRecord = state as Record<string, unknown>;
  const snapshot = {
    ...stateRecord,
    version: 1,
    publishedAt: '2026-06-01T00:00:00.000Z',
  };

  // The `media.assetId-non-empty` publish-only constraint requires every
  // media element to carry a non-empty assetId. Empty assetIds are
  // editor-only ("media slot not filled yet"); they fail publish. The
  // fixtures may carry empty assetIds, so we mark them with a sentinel
  // to flag for the operator that they cannot be published as-is. We do
  // NOT mutate the fixture's media on disk.
  const hasEmptyMediaAssetId = JSON.stringify(snapshot).includes('"assetId":""');
  if (hasEmptyMediaAssetId) {
    // Fixture cannot satisfy the publish-only assetId-non-empty rule; the
    // editable validate above is the load-bearing check for it. Skip the
    // published replay rather than papering over with a fake assetId,
    // which would defeat the purpose of the smoke.
    process.stdout.write(
      `[snapshot-replay:smoke] ${fixtureFile}: editable OK; published replay skipped (fixture has empty media assetId, expected for editor-time fixtures)\n`,
    );
    continue;
  }

  const published = validatePublishedSnapshot(snapshot);
  if (!published.valid) {
    const errors = published.errors.join('\n  - ');
    throw new Error(
      `[snapshot-replay:smoke] fixture ${fixtureFile} fails validatePublishedSnapshot:\n  - ${errors}\n` +
        '  Action: this is a publish-path schema break. Migrate fixtures + ' +
        'historical snapshots before merging, or document why the new ' +
        'shape is unreachable from any prod publish.',
    );
  }
  publishedPassed += 1;
  process.stdout.write(`[snapshot-replay:smoke] ${fixtureFile}: editable + published OK\n`);
}

// Defence against an empty PUBLISH_ONLY_REQUIRED_FIELDS regressing the
// smoke into a no-op for the published path. If publish-only fields are
// removed entirely the smoke still asserts at least one publish-replay
// succeeded (otherwise this gate is meaningless).
assert(
  PUBLISH_ONLY_REQUIRED_FIELDS.length >= 1,
  'PUBLISH_ONLY_REQUIRED_FIELDS empty — the publish gate has no required fields, ' +
    'which contradicts ADR 0012 dec 5. Either restore the constraint or supersede the ADR.',
);
assert(
  publishedPassed >= 1,
  'expected at least one fixture to replay through validatePublishedSnapshot; ' +
    'all fixtures were skipped due to empty media assetIds, so the published gate is not exercised',
);

process.stdout.write(
  `[snapshot-replay:smoke] OK — ${String(editablePassed)} editable replays, ` +
    `${String(publishedPassed)} published replays, ${String(fixtureFiles.length)} fixtures\n`,
);
