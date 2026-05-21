// Local smoke for the rev01 <-> StarterKit <-> Yjs bridge.
// Run: `bun run src/multiplayer/_smoke.ts`.
// Not a test runner — just prints PASS/FAIL on each roundtrip.

import * as Y from 'yjs';
import { applyUpdate, encodeStateAsUpdate } from 'yjs';
import home from '../templates/seeds/maple-coffee/pages/home.json';
import type { DocumentJSON } from '../document/schema';
import { hydrateYDoc, rev01ToStarterKit, serializeYDoc, starterKitToRev01 } from './snapshot';

let failed = false;
function ok(label: string, condition: boolean): void {
  const tag = condition ? 'PASS' : 'FAIL';
  console.log(`${tag}  ${label}`);
  if (!condition) failed = true;
}

const seed = home as DocumentJSON;

const pm = rev01ToStarterKit(seed);
ok('rev01 -> starterkit -> doc root is "doc"', pm.type === 'doc');
ok('rev01 -> starterkit -> has children', (pm.content?.length ?? 0) > 0);

const ydoc = hydrateYDoc(seed);
const snapshot = serializeYDoc(ydoc);
ok('snapshot.type === "doc"', snapshot.type === 'doc');
ok('snapshot has one section.custom', snapshot.content[0]?.attrs?.kind === 'custom');
ok('snapshot section has content', (snapshot.content[0]?.content?.length ?? 0) > 0);

// Reverse path: an in-memory PM doc should survive serialize/deserialize.
const back = starterKitToRev01(pm);
ok('starterkit -> rev01 -> type === "doc"', back.type === 'doc');

// Yjs binary update roundtrip — two clients converge to identical XML.
const updateBlob = encodeStateAsUpdate(ydoc);
const ydoc2 = new Y.Doc();
applyUpdate(ydoc2, updateBlob);
const snap2 = serializeYDoc(ydoc2);
ok(
  'binary state roundtrip converges',
  JSON.stringify(snap2) === JSON.stringify(serializeYDoc(ydoc)),
);

console.log(failed ? 'smoke FAILED' : 'smoke complete');
if (failed) throw new Error('multiplayer smoke failed');
