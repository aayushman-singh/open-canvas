// Local smoke for the rev01 <-> ProseMirror <-> Yjs round-trip.
// Run: `bun run src/multiplayer/_smoke.ts`.
// Not a test runner — prints PASS/FAIL per assertion and exits non-zero on
// any failure.
//
// Round-trip gate: for each seed,
//   serializeYDoc(hydrateYDoc(seed)) deep-equals seed
// is the canonical test that the editor speaks the same document vocabulary
// as the rest of the system.

import * as Y from 'yjs';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import mapleCoffee from '../templates/seeds/maple-coffee/pages/home.json';
import foundryType from '../templates/seeds/foundry-type/pages/home.json';
import lighthouseLaunch from '../templates/seeds/lighthouse-launch/pages/home.json';
import type { DocumentJSON } from '../document/schema';
import { validateDocument } from '../document/validate';
import { hydrateYDoc, serializeYDoc } from './snapshot';

declare const process: { exit: (code: number) => never };

let failed = false;
function ok(label: string, condition: boolean, detail?: string): void {
  const tag = condition ? 'PASS' : 'FAIL';
  if (condition) {
    console.log(`${tag}  ${label}`);
  } else {
    console.error(`${tag}  ${label}${detail ? ` -> ${detail}` : ''}`);
    failed = true;
  }
}

const seeds: { name: string; doc: DocumentJSON }[] = [
  { name: 'maple-coffee', doc: mapleCoffee as DocumentJSON },
  { name: 'foundry-type', doc: foundryType as DocumentJSON },
  { name: 'lighthouse-launch', doc: lighthouseLaunch as DocumentJSON },
];

for (const seed of seeds) {
  console.log(`--- seed: ${seed.name} ---`);

  // Sanity: the seed itself must be valid against the schema.
  const seedValidation = validateDocument(seed.doc);
  ok(
    `${seed.name}: seed validates`,
    seedValidation.valid,
    seedValidation.valid ? undefined : seedValidation.errors.join('; '),
  );

  // Hydrate -> serialize round-trip.
  const ydoc = hydrateYDoc(seed.doc);
  const snapshot = serializeYDoc(ydoc);

  const snapshotValidation = validateDocument(snapshot);
  ok(
    `${seed.name}: snapshot validates`,
    snapshotValidation.valid,
    snapshotValidation.valid ? undefined : snapshotValidation.errors.join('; '),
  );

  const seedStr = JSON.stringify(seed.doc);
  const snapStr = JSON.stringify(snapshot);
  ok(
    `${seed.name}: round-trip is lossless`,
    seedStr === snapStr,
    seedStr === snapStr ? undefined : firstDiff(seedStr, snapStr),
  );

  // Binary Yjs update path: two clients with the same state converge.
  const updateBlob = encodeStateAsUpdate(ydoc);
  const ydoc2 = new Y.Doc();
  applyUpdate(ydoc2, updateBlob);
  const snap2 = serializeYDoc(ydoc2);
  ok(`${seed.name}: binary state replays identically`, JSON.stringify(snap2) === snapStr);
}

function firstDiff(a: string, b: string): string {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      const start = Math.max(0, i - 30);
      const end = Math.min(len, i + 30);
      return `at index ${i}: ...${a.slice(start, end)}... vs ...${b.slice(start, end)}...`;
    }
  }
  return `lengths differ: ${a.length} vs ${b.length}`;
}

if (failed) {
  console.error('multiplayer smoke FAILED');
  process.exit(1);
} else {
  console.log('multiplayer smoke PASSED');
}
