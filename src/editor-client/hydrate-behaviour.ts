// src/editor-client/hydrate-behaviour.ts
//
// Editor preview entry for schema-owned behaviour primitives. Reuses the
// visitor `BEHAVIOUR_RUNTIME_SRC` verbatim so preview and publish execute the
// same hydration contract.

import {
  buildBehaviourPayload,
  serializeBehaviourPayload,
  snapshotHasBehaviourPrimitives,
} from '../canvas/behaviour-payload.js';
import type { EditableSite } from '../canvas/schema.js';
import { BEHAVIOUR_RUNTIME_SRC } from '../interactive/behaviour.js';

type BehaviourRunner = (doc: Document) => void;

const runBehaviourRuntime: BehaviourRunner =
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- must execute visitor runtime source verbatim
  new Function(
    'document',
    `${BEHAVIOUR_RUNTIME_SRC}\nhydrateBehaviour(document);`,
  ) as BehaviourRunner;

export function hydrateBehaviourPreview(
  _root: ParentNode,
  state: EditableSite,
  assetBasePath: string,
): void {
  if (!snapshotHasBehaviourPrimitives(state)) return;
  const payload = buildBehaviourPayload(state, assetBasePath);
  if (!payload) return;

  let script = document.querySelector('script[data-opencanvas-behaviour-payload]');
  if (!(script instanceof HTMLScriptElement)) {
    const created = document.createElement('script');
    created.type = 'application/json';
    created.setAttribute('data-opencanvas-behaviour-payload', '');
    document.body.appendChild(created);
    script = created;
  }
  script.textContent = serializeBehaviourPayload(payload);

  document.documentElement.removeAttribute('data-opencanvas-behaviour-hydrated');
  runBehaviourRuntime(document);
}
