// src/editor-client/hydrate-behaviour.ts
//
// Editor preview entry for schema-owned behaviour primitives. Reuses the
// visitor `BEHAVIOUR_RUNTIME_SRC` verbatim so preview and publish execute the
// same hydration contract.

import {
  type BehaviourPayload,
  buildBehaviourPayload,
  serializeBehaviourPayload,
  snapshotHasBehaviourPrimitives,
} from '../canvas/behaviour-payload.js';
import type { EditableSite } from '../canvas/schema.js';
import { BEHAVIOUR_RUNTIME_SRC } from '../interactive/behaviour.js';

type BehaviourRunner = (
  doc: Document,
  reducedMotion?: 'no-preference' | 'reduce',
) => void;

// Lazily materialised on first preview. This MUST NOT run at module load:
// `new Function` is `eval`, which the editor's Content-Security-Policy gates
// behind `'unsafe-eval'`. Building it at top level threw an EvalError during
// the editor-client bundle's evaluation, aborting the whole module before
// `createEditor` ran — the editor shell rendered but the canvas never mounted
// (blank canvas, no visible error). Deferring construction to the first
// `hydrateBehaviourPreview` call keeps module evaluation eval-free so the
// canvas always boots; the eval only happens when an Owner actually previews
// a behaviour primitive (and the editor CSP now allows `'unsafe-eval'`).
let runBehaviourRuntime: BehaviourRunner | null = null;

function getBehaviourRuntime(): BehaviourRunner {
  if (runBehaviourRuntime === null) {
    runBehaviourRuntime =
      // eslint-disable-next-line @typescript-eslint/no-implied-eval -- must execute visitor runtime source verbatim
      new Function(
        'document',
        'reducedMotion',
        `${BEHAVIOUR_RUNTIME_SRC}\nhydrateBehaviour(document, { reducedMotion });`,
      ) as BehaviourRunner;
  }
  return runBehaviourRuntime;
}

function omitLoadExperienceForCanvasPreview(payload: BehaviourPayload): BehaviourPayload {
  // Published pages render a matching `[data-opencanvas-load-experience]`
  // shell before hydrating the visitor behaviour runtime. The editor's normal
  // canvas render does not: load experience preview is an explicit toolbar /
  // interactions-panel action that creates a temporary shell first. If the
  // boot-time canvas payload includes loadExperience, the visitor runtime
  // throws "load experience node not found" during renderAll(), leaving the
  // canvas visible but inert because root/sidebar click handlers attach only
  // after renderAll returns.
  if (payload.loadExperience === undefined) return payload;
  const { loadExperience: _loadExperience, ...withoutLoadExperience } = payload;
  return withoutLoadExperience;
}

export function hydrateBehaviourPreview(
  _root: ParentNode,
  state: EditableSite,
  assetBasePath: string,
  reducedMotion?: 'no-preference' | 'reduce',
): void {
  if (!snapshotHasBehaviourPrimitives(state)) return;
  const payload = buildBehaviourPayload(state, assetBasePath);
  if (!payload) return;
  const canvasPayload = omitLoadExperienceForCanvasPreview(payload);

  let script = document.querySelector('script[data-opencanvas-behaviour-payload]');
  if (!(script instanceof HTMLScriptElement)) {
    const created = document.createElement('script');
    created.type = 'application/json';
    created.setAttribute('data-opencanvas-behaviour-payload', '');
    document.body.appendChild(created);
    script = created;
  }
  script.textContent = serializeBehaviourPayload(canvasPayload);

  document.documentElement.removeAttribute('data-opencanvas-behaviour-hydrated');
  getBehaviourRuntime()(document, reducedMotion);
}
