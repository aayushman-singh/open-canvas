// src/routes/api/canvas-agent-apply-validator.smoke.ts
//
// Regression for the live "AI Accept broken" bug fixed by
// `fix(api): canvas-agent apply uses same seed-id fallback as save and read`.
//
// POST `/api/canvas-agent/sites/:siteId/apply` (the AI Accept endpoint) was
// rejecting any editable state that still referenced a bare seed id
// (`seed-project-thumb-neutral`) even when the Owner had the deduped
// `seed-{customerId}-{seedId}` row, because `runOpsPipeline` checked
// `owner_asset.id IN (...)` and the bare id never matched. PR #30 fixed
// the canvas save validator and the read endpoint via a shared helper
// (`loadAssetKindsWithSeedFallback` / `resolveAssetRowForCustomer`) but
// missed this third endpoint, so AI Accept kept 400ing on legacy states:
// proposal → click Accept → 400 "canvas agent references unknown asset
// id(s)" → change not committed → overlay stuck in
// `data-ai-overlay-status="proposed"`.
//
// This smoke pins:
//
//   1. `mapRowsWithSeedFallback` + `findAssetReferenceErrors` end-to-end
//      against an EditableSite whose media element references a bare
//      seed id — the validator must report no errors when the fallback
//      row is present, and must continue to report "missing" when no
//      row resolves the reference. Same contract the save validator
//      already pins; recapped here so a refactor that breaks the
//      apply-side wiring is caught by name.
//
//   2. Route-layer wiring — a source-level grep on
//      `canvas-agent.ts` confirms the apply pipeline imports
//      `loadAssetKindsWithSeedFallback` and that the legacy raw
//      `inArray(ownerAsset.id, ...)` query is gone. Pins both
//      directions so a regression in the canvas-agent edit is loud.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mapRowsWithSeedFallback } from '../../assets/seed-id-fallback.js';
import { findAssetReferenceErrors } from '../../assets/site-assets.js';
import type { EditableSite } from '../../canvas/schema.js';
import { SEED_ASSET_REGISTRY } from '../../canvas/seed-assets.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[canvas-agent-apply-validator:smoke] ${message}`);
}

// ---------------------------------------------------------------------------
// 1) End-to-end validator against the canvas-agent apply pipeline's shape.
//    Mirror of the slice canvas-save-validator.smoke.ts pins, scoped to the
//    apply path so a regression that breaks ONLY the agent wiring fails a
//    smoke named after the broken endpoint.
// ---------------------------------------------------------------------------

const seedId = 'seed-project-thumb-neutral';
const seed = SEED_ASSET_REGISTRY[seedId];
assert(seed !== undefined, 'expected seed-project-thumb-neutral in registry');
const materializedId = `seed-customer-a-${seedId}`;

function makeSiteWithSeedReference(assetId: string): EditableSite {
  return {
    pages: [
      {
        id: 'page-1',
        slug: '/',
        title: 'Home',
        sections: [
          {
            id: 'section-1',
            role: 'body',
            elements: [
              {
                id: 'media-1',
                type: 'media',
                mediaKind: 'image',
                assetId,
                x: 0,
                y: 0,
                width: 480,
                height: 640,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as EditableSite;
}

const stateWithBareSeed = makeSiteWithSeedReference(seedId);

// Positive: legacy state + fallback row present → no errors. This is the
// exact scenario the live bug hit: the Owner has only the materialised
// `seed-{customerId}-{seedId}` row, the editable state still names the
// bare seed id, AI Accept must NOT 400.
const presentRows = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'image', contentHash: seed.contentHash }],
  [seedId],
  'customer-a',
);
const errsAccepted = findAssetReferenceErrors(stateWithBareSeed, presentRows);
assert(
  errsAccepted.length === 0,
  `apply pipeline must accept a bare seed reference when the materialised row exists; got ${JSON.stringify(errsAccepted)}`,
);

// Negative: legacy state but no fallback row → apply must still 400 so
// truly missing assets don't slip through.
const errsRejected = findAssetReferenceErrors(stateWithBareSeed, []);
assert(
  errsRejected.length === 1 && errsRejected[0]?.reason === 'missing',
  'apply pipeline must keep rejecting bare seed refs when no fallback row exists',
);
assert(
  errsRejected[0]?.assetId === seedId,
  'rejection must surface the bare seed id, not a materialised one (so the error message matches what the chat client showed)',
);

// Negative: kind mismatch is preserved — fallback row of the wrong kind
// still trips the kind-mismatch branch even when the id resolves.
const mismatchRows = mapRowsWithSeedFallback(
  [{ id: materializedId, kind: 'video', contentHash: seed.contentHash }],
  [seedId],
  'customer-a',
);
const errsMismatch = findAssetReferenceErrors(stateWithBareSeed, mismatchRows);
assert(
  errsMismatch.length === 1 && errsMismatch[0]?.reason === 'kind-mismatch',
  'kind-mismatch must still fire even when the fallback resolves the id',
);

// ---------------------------------------------------------------------------
// 2) Route-layer wiring — canvas-agent.ts must call the shared helper, not
//    the legacy `inArray(ownerAsset.id, ...)` direct lookup that ALL THREE
//    asset-validator endpoints used pre-PR-#30. PR #30 fixed two of the
//    three; this smoke pins the third.
// ---------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url));
const canvasAgentSource = readFileSync(join(here, 'canvas-agent.ts'), 'utf8');

assert(
  canvasAgentSource.includes("from '../../assets/seed-id-fallback'"),
  'canvas-agent.ts must import the seed-id fallback helper',
);
assert(
  canvasAgentSource.includes('loadAssetKindsWithSeedFallback('),
  'canvas-agent.ts runOpsPipeline must call loadAssetKindsWithSeedFallback before findAssetReferenceErrors',
);
// The pipeline must no longer do the raw inArray lookup the old code used —
// that's how the AI Accept bug went live in the first place. Scoped to
// runOpsPipeline so an unrelated future query elsewhere in the file does
// not falsely trip this guard.
const pipelineStart = canvasAgentSource.indexOf('async function runOpsPipeline');
assert(pipelineStart >= 0, 'expected canvas-agent.ts to define runOpsPipeline');
const pipelineEnd = canvasAgentSource.indexOf('\n}\n', pipelineStart);
assert(pipelineEnd > pipelineStart, 'expected runOpsPipeline body to be closeable');
const pipelineBody = canvasAgentSource.slice(pipelineStart, pipelineEnd);
assert(
  !/\.select\s*\(\s*\{\s*id:\s*ownerAsset\.id/.test(pipelineBody),
  'runOpsPipeline must not run a raw owner_asset SELECT — go through loadAssetKindsWithSeedFallback',
);
assert(
  !/inArray\s*\(\s*ownerAsset\.id/.test(pipelineBody),
  'runOpsPipeline must not use inArray(ownerAsset.id, ...) — that was the pre-#30 pattern',
);

console.log('[canvas-agent-apply-validator:smoke] OK');
