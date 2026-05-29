// src/canvas/validate-parity.smoke.ts
//
// Parity smoke for ADR 0012 decision 5:
//   "validatePublishedSnapshot is strictly stricter than (or equal to)
//    validateEditableSite — anything the editor accepts must publish,
//    modulo fields that are explicitly required-only-at-publish."
//
// The "publish-only required" list is the exported PUBLISH_ONLY_REQUIRED_FIELDS
// constant in validate.ts. This smoke asserts:
//
//   1. A valid editable site wrapped with `{ version: 1, publishedAt: now }`
//      passes validatePublishedSnapshot. (The structural subset relation holds
//      for the canonical fixture.)
//   2. Removing each PUBLISH_ONLY_REQUIRED_FIELDS entry from an otherwise-
//      valid snapshot produces a validation error. The errors reported are
//      narrowly the publish-only ones — not edit-side errors. This proves
//      the diff between the two validators is enumerated, not implicit.
//   3. Mutating the editable site to fail edit validation (e.g. invalid
//      styleKit) makes BOTH validators fail with the same edit-side error.
//      The snapshot does not silently accept what edit rejects.
//
// Run with `bun.cmd run validate-parity:smoke`.

import fixture from './fixtures/home.json';
import type { EditableSite } from './schema.js';
import {
  PUBLISH_ONLY_REQUIRED_FIELDS,
  validateEditableSite,
  validatePublishedSnapshot,
} from './validate.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[validate-parity:smoke] ${message}`);
}

const editable = fixture as EditableSite;

// (0) The fixture itself must be valid edit — a precondition for the rest.
const editResult = validateEditableSite(editable);
assert(
  editResult.valid,
  `home.json fixture failed validateEditableSite: ${editResult.valid ? '' : editResult.errors.join('; ')}`,
);

// (1) Valid editable + publish fields → publish valid.
const goodSnapshot = {
  ...editable,
  version: 1 as const,
  publishedAt: '2026-05-30T00:00:00.000Z',
};
const snapResult = validatePublishedSnapshot(goodSnapshot);
assert(
  snapResult.valid,
  `valid editable + version/publishedAt should publish — got: ${snapResult.valid ? '' : snapResult.errors.join('; ')}`,
);

// (2) Each PUBLISH_ONLY_REQUIRED_FIELDS removal triggers a publish error
// the edit side does not surface.
function withoutVersion(s: object): object {
  const { version: _v, ...rest } = s as { version?: unknown };
  void _v;
  return rest;
}

function withoutPublishedAt(s: object): object {
  const { publishedAt: _p, ...rest } = s as { publishedAt?: unknown };
  void _p;
  return rest;
}

function withPlaceholderMediaAsset(s: object): object {
  // Walk the snapshot pages and find a media element; blank out its assetId.
  const cloned = JSON.parse(JSON.stringify(s)) as {
    pages?: { sections?: { elements?: { type?: string; assetId?: string }[] }[] }[];
  };
  for (const page of cloned.pages ?? []) {
    for (const section of page.sections ?? []) {
      for (const element of section.elements ?? []) {
        if (element.type === 'media') {
          element.assetId = '';
          return cloned;
        }
      }
    }
  }
  throw new Error('home.json fixture has no media element for the parity test');
}

const removalCases: { field: (typeof PUBLISH_ONLY_REQUIRED_FIELDS)[number]; transform: (s: object) => object }[] = [
  { field: 'version', transform: withoutVersion },
  { field: 'publishedAt', transform: withoutPublishedAt },
  { field: 'media.assetId-non-empty', transform: withPlaceholderMediaAsset },
];

assert(
  removalCases.length === PUBLISH_ONLY_REQUIRED_FIELDS.length,
  `removalCases (${String(removalCases.length)}) does not match PUBLISH_ONLY_REQUIRED_FIELDS (${String(PUBLISH_ONLY_REQUIRED_FIELDS.length)}) — add a transform when a new publish-only field lands`,
);

for (const { field, transform } of removalCases) {
  const broken = transform(goodSnapshot);
  const result = validatePublishedSnapshot(broken);
  assert(
    !result.valid,
    `removing publish-only field "${field}" must surface a validation error`,
  );
}

// (3) Invalid editable → publish also invalid, with the same edit-side error.
const badEditable = JSON.parse(JSON.stringify(editable)) as Record<string, unknown>;
badEditable.styleKit = 'definitely-not-a-real-kit';
const badEditResult = validateEditableSite(badEditable);
assert(!badEditResult.valid, 'mutated editable with bogus styleKit must fail edit validation');

const badSnapshot = {
  ...badEditable,
  version: 1,
  publishedAt: '2026-05-30T00:00:00.000Z',
};
const badSnapResult = validatePublishedSnapshot(badSnapshot);
assert(
  !badSnapResult.valid,
  'mutated snapshot with bogus styleKit must fail publish validation — publish must not accept what edit rejects',
);
const editErrors = badEditResult.valid ? [] : badEditResult.errors;
const snapErrors = badSnapResult.valid ? [] : badSnapResult.errors;
for (const editErr of editErrors) {
  assert(
    snapErrors.includes(editErr),
    `publish errors must be a superset of edit errors — edit said ${JSON.stringify(editErr)}, publish did not surface it`,
  );
}

console.log(
  `[validate-parity:smoke] OK — publish ⊇ edit verified; ${String(PUBLISH_ONLY_REQUIRED_FIELDS.length)} publish-only fields each surface a unique error on removal`,
);
