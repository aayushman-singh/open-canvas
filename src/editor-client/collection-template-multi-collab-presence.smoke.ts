// src/editor-client/collection-template-multi-collab-presence.smoke.ts
//
// ADR 0065 F1-multi-collab-presence — smoke for
// `computeCollectionTemplateEditors`, the pure reducer that turns an
// awareness peer map into `<collectionId, [peerName, …]>` groups. The
// inspector reads this map at render time to surface a small "<N>
// other(s) editing: <names>" indicator below the Collection's template
// controls when ≥1 OTHER peer is in template-edit mode for the same
// Collection.
//
// Cases pinned here:
//   * local + 1 peer both editing Collection A → map has A:[name1].
//     Inspector for Collection A renders "1 other editing: name1".
//   * local + 0 peers (peer not in template-edit mode, just on the
//     site) → map empty. No indicator.
//   * local editing Collection A, peer editing Collection B → map has
//     only B:[…]; Collection A's inspector shows nothing (per-Collection
//     scoping via map key lookup).
//   * peer drops → next computeCollectionTemplateEditors call without
//     that peer returns the map without their name; the inspector's
//     next render drops the indicator.
//   * peer carrying same userId as the local Owner (second tab) is
//     skipped — "1 other editing: <me>" would be confusing nonsense.
//   * `collectionTemplateEditorsEqual` returns true on same shape,
//     false on any membership change — so the onRemotePresence loop
//     only re-renders the inspector when the editor set actually
//     shifted.
//
// Bare Bun — no `document`. The reducer is a pure function over an
// awareness-shaped Map. Run with
// `bun run src/editor-client/collection-template-multi-collab-presence.smoke.ts`.

import {
  computeCollectionTemplateEditors,
  collectionTemplateEditorsEqual,
} from './co-edit.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[collection-template-multi-collab-presence:smoke] ${message}`);
}

interface AwarenessPeer {
  name: string;
  userId?: string;
  editingCollectionTemplateId?: string | null;
}

function peersFromList(list: Array<{ clientId: number } & AwarenessPeer>): Map<number, AwarenessPeer> {
  const out = new Map<number, AwarenessPeer>();
  for (const { clientId, ...peer } of list) {
    out.set(clientId, peer);
  }
  return out;
}

// ----- Case 1: local + 1 peer both editing Collection A ----------------

(function oneOtherSameCollectionSpec() {
  const peers = peersFromList([
    { clientId: 11, name: 'Alice', editingCollectionTemplateId: 'coll-a' },
  ]);
  const editors = computeCollectionTemplateEditors(peers, null);
  assert(editors.size === 1, 'one peer editing → map has one entry');
  const names = editors.get('coll-a');
  assert(
    names !== undefined && names.length === 1 && names[0] === 'Alice',
    'Collection A has one other editor: Alice',
  );
})();

// ----- Case 2: local + 0 peers in template-edit mode --------------------

(function noOthersInTemplateEditSpec() {
  const peers = peersFromList([
    // Peer is connected but NOT in template-edit mode (null pin).
    { clientId: 11, name: 'Alice', editingCollectionTemplateId: null },
    { clientId: 12, name: 'Bob' /* field absent */ },
  ]);
  const editors = computeCollectionTemplateEditors(peers, null);
  assert(editors.size === 0, 'no peer in template-edit → empty map');
})();

// ----- Case 3: per-Collection scoping (A vs B) --------------------------

(function perCollectionScopingSpec() {
  const peers = peersFromList([
    { clientId: 11, name: 'Alice', editingCollectionTemplateId: 'coll-b' },
  ]);
  const editors = computeCollectionTemplateEditors(peers, null);
  assert(
    editors.get('coll-a') === undefined,
    'Collection A inspector reads undefined → no indicator',
  );
  const namesB = editors.get('coll-b');
  assert(
    namesB !== undefined && namesB[0] === 'Alice',
    'Collection B has Alice as the other editor',
  );
})();

// ----- Case 4: peer drops → map drops them ------------------------------

(function peerDropSpec() {
  const beforePeers = peersFromList([
    { clientId: 11, name: 'Alice', editingCollectionTemplateId: 'coll-a' },
  ]);
  const beforeMap = computeCollectionTemplateEditors(beforePeers, null);
  assert(beforeMap.get('coll-a')?.length === 1, 'pre-drop: 1 editor');

  // Simulate peer departure — awareness map no longer carries that
  // clientID (the same shape the existing webSocketClose tombstone
  // produces via removeAwarenessClientIds + the local Awareness map's
  // onChange).
  const afterPeers = peersFromList([]);
  const afterMap = computeCollectionTemplateEditors(afterPeers, null);
  assert(afterMap.size === 0, 'post-drop: no editors');
  assert(
    !collectionTemplateEditorsEqual(beforeMap, afterMap),
    'editor maps differ across the drop — inspector must re-render',
  );
})();

// ----- Case 5: same-userId second tab is skipped ------------------------

(function selfSecondTabSpec() {
  // The local Owner's userId is 'user-owner'. A "peer" carrying the same
  // userId is the Owner's second tab — not a distinct collaborator. The
  // reducer must skip it so the indicator does not surface "1 other
  // editing: <my own name>".
  const peers = peersFromList([
    { clientId: 99, name: 'Owner (tab 2)', userId: 'user-owner', editingCollectionTemplateId: 'coll-a' },
  ]);
  const editors = computeCollectionTemplateEditors(peers, 'user-owner');
  assert(editors.size === 0, 'same-userId tab must be deduped');
})();

// ----- Case 6: missing name falls back to "Another collaborator" -------

(function missingNameFallbackSpec() {
  const peers = peersFromList([
    { clientId: 11, name: '', editingCollectionTemplateId: 'coll-a' },
  ]);
  const editors = computeCollectionTemplateEditors(peers, null);
  const names = editors.get('coll-a');
  assert(
    names !== undefined && names[0] === 'Another collaborator',
    'empty name falls back to "Another collaborator" — peer-name resolution failure surfaces, not silently dropped',
  );
})();

// ----- Case 7: two peers editing the same Collection -------------------

(function twoPeersSameCollectionSpec() {
  const peers = peersFromList([
    { clientId: 11, name: 'Alice', editingCollectionTemplateId: 'coll-a' },
    { clientId: 12, name: 'Bob', editingCollectionTemplateId: 'coll-a' },
  ]);
  const editors = computeCollectionTemplateEditors(peers, null);
  const names = editors.get('coll-a');
  assert(
    names !== undefined && names.length === 2,
    'two peers on the same Collection → both surface',
  );
  assert(
    names && names.includes('Alice') && names.includes('Bob'),
    'both peer names captured',
  );
})();

// ----- Case 8: collectionTemplateEditorsEqual variants -----------------

(function equalityProbeSpec() {
  const a = new Map<string, string[]>([['coll-a', ['Alice']]]);
  const b = new Map<string, string[]>([['coll-a', ['Alice']]]);
  assert(
    collectionTemplateEditorsEqual(a, b),
    'same shape → equal (inspector skip re-render)',
  );

  const c = new Map<string, string[]>([['coll-a', ['Alice', 'Bob']]]);
  assert(
    !collectionTemplateEditorsEqual(a, c),
    'different list length → not equal',
  );

  const d = new Map<string, string[]>([['coll-a', ['Bob']]]);
  assert(
    !collectionTemplateEditorsEqual(a, d),
    'different name at same index → not equal',
  );

  const e = new Map<string, string[]>([['coll-b', ['Alice']]]);
  assert(
    !collectionTemplateEditorsEqual(a, e),
    'different Collection key → not equal',
  );

  const empty1 = new Map<string, string[]>();
  const empty2 = new Map<string, string[]>();
  assert(
    collectionTemplateEditorsEqual(empty1, empty2),
    'two empties → equal',
  );
})();

console.log('[collection-template-multi-collab-presence:smoke] OK');
