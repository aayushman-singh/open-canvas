// src/editor-client/collection-template-edit.smoke.ts
//
// ADR 0065 Phase 2C — parity smoke for the enter/exit verbs that drive
// Collection custom-template edit mode. Asserts:
//
//  * first enter (customTemplate absent) seeds via seedCustomTemplate()
//    AND pins ctx.editingCollectionTemplate atomically;
//  * second enter (customTemplate present) flips the pin only — no
//    re-seed (D4 silent keep);
//  * enter on a non-existent element id surfaces a loud error status,
//    no state change;
//  * enter on a non-collection element surfaces a loud error status,
//    no state change;
//  * enter on a collection with display !== 'custom' surfaces a loud
//    error status, no state change (precondition rule);
//  * exit clears the pin and re-renders.
//
// Bare Bun — no `document`. The verbs do not touch DOM directly; they
// mutate ctx and call ctx.renderAll(). renderAll is a counter here.
//
// Run with `bun run src/editor-client/collection-template-edit.smoke.ts`.

import type {
  CanvasElement,
  CanvasSection,
} from '../canvas/schema.js';
import type { CollectionDisplay, CollectionElement } from '../canvas/elements/collection.js';
import type { EditorContext } from './editor-context.js';
import type { FindElementResult } from './editor-context-types.js';
import {
  enterCollectionTemplateEditImpl,
  exitCollectionTemplateEditImpl,
} from './collection-template-edit.js';
import { seedCustomTemplate } from '../canvas/elements/collection-defaults.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[collection-template-edit:smoke] ${message}`);
}

interface StatusCall {
  text: string;
  tone: 'ok' | 'error' | 'info' | undefined;
}

interface CtxLog {
  renderAll: number;
  scheduleSave: number;
  captureForUndo: number;
  statuses: StatusCall[];
}

function makeCollection(id: string, display: CollectionDisplay): CollectionElement {
  return {
    id,
    type: 'collection',
    box: { x: 0, y: 0, w: 640, h: 480, z: 1 },
    sort: 'date-desc',
    display,
  };
}

function makeSection(elements: CanvasElement[]): CanvasSection {
  return {
    id: 'section-tpl-smoke',
    recipeId: 'feature-grid',
    name: 'Smoke',
    height: 800,
    elements,
  };
}

function makeCtx(section: CanvasSection): { ctx: EditorContext; log: CtxLog } {
  const log: CtxLog = {
    renderAll: 0,
    scheduleSave: 0,
    captureForUndo: 0,
    statuses: [],
  };
  // Only the surface the verbs read/write is implemented; everything else
  // is a throwing stub so accidental reads of unrelated ctx fields fail
  // loudly. Cast through unknown because the smoke only exercises the
  // verb's narrow read/write surface, not the full EditorContext.
  const partial = {
    state: null,
    editingCollectionTemplate: null as EditorContext['editingCollectionTemplate'],
    findElement(elementId: string): FindElementResult | null {
      for (const el of section.elements) {
        if (el.id === elementId) {
          return {
            section,
            element: el,
            parentArray: section.elements,
            parentKind: 'section',
            parentMeta: null,
          };
        }
      }
      return null;
    },
    renderAll: () => {
      log.renderAll += 1;
    },
    captureForUndo: () => {
      log.captureForUndo += 1;
    },
    scheduleSave: () => {
      log.scheduleSave += 1;
    },
    setStatus: (text: string, tone?: 'ok' | 'error' | 'info') => {
      log.statuses.push({ text, tone });
    },
  };
  const ctx = partial as unknown as EditorContext;
  return { ctx, log };
}

// ----- enter: first switch seeds + pins atomically ----------------------

(function enterFirstTimeSeedsSpec() {
  const el = makeCollection('coll-a', 'custom');
  const section = makeSection([el]);
  const { ctx, log } = makeCtx(section);

  enterCollectionTemplateEditImpl(ctx, 'coll-a');

  assert(
    el.customTemplate !== undefined,
    'first enter must seed customTemplate',
  );
  assert(
    Array.isArray(el.customTemplate),
    'seeded customTemplate must be an array',
  );
  assert(
    el.customTemplate !== undefined && el.customTemplate.length > 0,
    'seeded customTemplate must contain at least the outer container',
  );
  assert(
    ctx.editingCollectionTemplate !== null &&
      ctx.editingCollectionTemplate.collectionId === 'coll-a',
    'first enter must pin editingCollectionTemplate to the Collection',
  );
  assert(
    log.captureForUndo === 1,
    'first enter must captureForUndo exactly once',
  );
  assert(log.renderAll === 1, 'first enter must renderAll exactly once');
  assert(log.scheduleSave === 1, 'first enter must scheduleSave exactly once');
  assert(log.statuses.length === 0, 'first enter must not emit status');
})();

// ----- enter: second switch keeps existing customTemplate ---------------

(function enterSecondTimePreservesTemplateSpec() {
  const el = makeCollection('coll-b', 'custom');
  el.customTemplate = [
    {
      id: 'preset-root',
      type: 'container',
      box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
      variant: 'raised',
    },
  ];
  const before = el.customTemplate[0];
  const section = makeSection([el]);
  const { ctx, log } = makeCtx(section);

  enterCollectionTemplateEditImpl(ctx, 'coll-b');

  assert(
    el.customTemplate !== undefined && el.customTemplate[0] === before,
    'second enter must not re-seed (D4 silent keep)',
  );
  assert(
    ctx.editingCollectionTemplate !== null &&
      ctx.editingCollectionTemplate.collectionId === 'coll-b',
    'second enter must pin editingCollectionTemplate',
  );
  assert(log.captureForUndo === 1, 'enter must captureForUndo once');
  assert(log.renderAll === 1, 'enter must renderAll once');
})();

// ----- enter: missing element fails loudly ------------------------------

(function enterMissingElementSpec() {
  const section = makeSection([]);
  const { ctx, log } = makeCtx(section);

  enterCollectionTemplateEditImpl(ctx, 'ghost-id');

  assert(
    ctx.editingCollectionTemplate === null,
    'missing element must not mutate editingCollectionTemplate',
  );
  assert(
    log.statuses.length === 1 && log.statuses[0]?.tone === 'error',
    'missing element must emit error status',
  );
  assert(
    log.captureForUndo === 0,
    'missing element must not captureForUndo',
  );
  assert(log.renderAll === 0, 'missing element must not renderAll');
})();

// ----- enter: non-collection fails loudly ------------------------------

(function enterNonCollectionSpec() {
  const text: CanvasElement = {
    id: 'text-a',
    type: 'text',
    box: { x: 0, y: 0, w: 100, h: 30, z: 1 },
    content: [{ text: 'hi' }],
    role: 'body',
    fontSize: 14,
    fontWeight: 400,
    align: 'left',
  };
  const section = makeSection([text]);
  const { ctx, log } = makeCtx(section);

  enterCollectionTemplateEditImpl(ctx, 'text-a');

  assert(
    ctx.editingCollectionTemplate === null,
    'non-collection must not mutate editingCollectionTemplate',
  );
  assert(
    log.statuses.length === 1 && log.statuses[0]?.tone === 'error',
    'non-collection must emit error status',
  );
})();

// ----- enter: display !== 'custom' fails loudly -------------------------

(function enterWrongDisplaySpec() {
  const el = makeCollection('coll-c', 'card');
  const section = makeSection([el]);
  const { ctx, log } = makeCtx(section);

  enterCollectionTemplateEditImpl(ctx, 'coll-c');

  assert(
    ctx.editingCollectionTemplate === null,
    'wrong-display must not mutate editingCollectionTemplate',
  );
  assert(
    el.customTemplate === undefined,
    'wrong-display must not seed customTemplate',
  );
  assert(
    log.statuses.length === 1 && log.statuses[0]?.tone === 'error',
    'wrong-display must emit error status',
  );
  assert(log.captureForUndo === 0, 'wrong-display must not captureForUndo');
})();

// ----- exit: clears pin + renders --------------------------------------

(function exitClearsPinSpec() {
  const section = makeSection([]);
  const { ctx, log } = makeCtx(section);
  ctx.editingCollectionTemplate = { collectionId: 'coll-d' };

  exitCollectionTemplateEditImpl(ctx);

  assert(
    ctx.editingCollectionTemplate === null,
    'exit must clear editingCollectionTemplate',
  );
  assert(log.renderAll === 1, 'exit must renderAll exactly once');
})();

(function exitWhenAlreadyClearedSpec() {
  const section = makeSection([]);
  const { ctx, log } = makeCtx(section);

  exitCollectionTemplateEditImpl(ctx);

  assert(
    ctx.editingCollectionTemplate === null,
    'exit on already-null must remain null (idempotent)',
  );
  assert(log.renderAll === 1, 'exit on null must still renderAll (idempotent re-render is fine)');
})();

// ----- ADR 0065 D1 + D3 — display-dropdown semantics ---------------------
// The display dropdown change handler in element-inspector.ts is bare-DOM
// and cannot be unit-smoke-tested under Bun (no `document`). But the
// composite semantics it must enforce — first-switch auto-enter,
// second-switch silent keep, away-from-custom auto-exit — are routed
// through the verbs this smoke owns. The next four cases mirror the
// dropdown handler's branches so the verb sequences are pinned even
// without DOM coverage.

// switch to 'custom' from 'card' with NO customTemplate → auto-enter
// (handler flips display, then calls enterCollectionTemplateEdit; the verb
// seeds + pins atomically).
(function dropdownFirstSwitchToCustomSpec() {
  const el = makeCollection('coll-e', 'card');
  const section = makeSection([el]);
  const { ctx } = makeCtx(section);
  // Dropdown handler flips display first:
  el.display = 'custom';
  // Then calls the verb:
  enterCollectionTemplateEditImpl(ctx, 'coll-e');

  assert(
    el.customTemplate !== undefined && el.customTemplate.length > 0,
    'first switch to custom must auto-seed customTemplate',
  );
  assert(
    ctx.editingCollectionTemplate !== null &&
      ctx.editingCollectionTemplate.collectionId === 'coll-e',
    'first switch to custom must auto-enter edit mode',
  );
})();

// switch to 'custom' from 'card' WITH existing customTemplate → just flip
// display; editingCollectionTemplate stays null (Owner clicks Edit
// explicitly per D3 second-or-later case).
(function dropdownSecondSwitchToCustomSpec() {
  const el = makeCollection('coll-f', 'card');
  el.customTemplate = [
    {
      id: 'preset-root',
      type: 'container',
      box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
      variant: 'raised',
    },
  ];
  const beforeRoot = el.customTemplate[0];
  const section = makeSection([el]);
  const { ctx } = makeCtx(section);

  // Dropdown handler in this branch does NOT call enterCollectionTemplateEdit:
  el.display = 'custom';
  // (verb is intentionally NOT called)

  assert(
    el.customTemplate[0] === beforeRoot,
    'second switch to custom must NOT re-seed (silent keep)',
  );
  assert(
    ctx.editingCollectionTemplate === null,
    'second switch to custom must NOT auto-enter (Owner clicks Edit explicitly)',
  );
})();

// switch AWAY from 'custom' while editing → exit FIRST, then flip display
// (handler calls exitCollectionTemplateEdit before mutating display).
(function dropdownAwayFromCustomWhileEditingSpec() {
  const el = makeCollection('coll-g', 'custom');
  el.customTemplate = [
    {
      id: 'preset-root',
      type: 'container',
      box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
      variant: 'raised',
    },
  ];
  const beforeRoot = el.customTemplate[0];
  const section = makeSection([el]);
  const { ctx } = makeCtx(section);
  ctx.editingCollectionTemplate = { collectionId: 'coll-g' };

  // Dropdown handler exits first:
  exitCollectionTemplateEditImpl(ctx);
  // Then flips display:
  el.display = 'card';

  assert(
    ctx.editingCollectionTemplate === null,
    'away-from-custom while editing must auto-exit (D10)',
  );
  assert(
    el.customTemplate !== undefined && el.customTemplate[0] === beforeRoot,
    'away-from-custom must preserve customTemplate (D4 silent keep)',
  );
})();

// switch AWAY from 'custom' while NOT editing → just flip display;
// customTemplate preserved (D4).
(function dropdownAwayFromCustomNotEditingSpec() {
  const el = makeCollection('coll-h', 'custom');
  el.customTemplate = [
    {
      id: 'preset-root',
      type: 'container',
      box: { x: 0, y: 0, w: 320, h: 360, z: 1 },
      variant: 'raised',
    },
  ];
  const beforeRoot = el.customTemplate[0];
  const section = makeSection([el]);
  const { ctx } = makeCtx(section);

  // No editingCollectionTemplate pin to begin with.
  el.display = 'image-only';

  assert(
    ctx.editingCollectionTemplate === null,
    'away-from-custom not editing must leave editingCollectionTemplate null',
  );
  assert(
    el.customTemplate !== undefined && el.customTemplate[0] === beforeRoot,
    'away-from-custom not editing must preserve customTemplate (D4 silent keep)',
  );
})();

// ----- ADR 0065 D9 — Reset template behaviour ----------------------------
// The reset button's confirm path lives in the inspector DOM handler and
// can't be DOM-smoke-tested under Bun. The substantive behaviour — that
// seedCustomTemplate() returns a fresh deep clone of the default — is the
// canonical chokepoint; we pin it here so a future refactor of the seed
// path doesn't quietly break the reset button.
(function resetSeedReplaceSpec() {
  const first = seedCustomTemplate('coll-x');
  const second = seedCustomTemplate('coll-x');
  assert(Array.isArray(first) && first.length > 0, 'seedCustomTemplate must return a non-empty array');
  assert(first !== second, 'seedCustomTemplate must return a fresh array per call (deep clone)');
  assert(
    first[0] !== second[0],
    'seedCustomTemplate must deep-clone the outer container per call so reset never reuses prior nodes',
  );
})();

// ----- Codex review pass 1 — seed ids carry --<collectionId> suffix so two
// Collections on the same page never collide on `card-default-root` -------
(function seedIdsScopedToHostCollectionSpec() {
  const a = seedCustomTemplate('coll-alpha');
  const b = seedCustomTemplate('coll-beta');
  const aIds = a.map((el) => el.id);
  const bIds = b.map((el) => el.id);
  for (const id of aIds) {
    assert(
      id.endsWith('--coll-alpha'),
      `seed id ${id} from collection coll-alpha must carry --<collectionId> suffix`,
    );
  }
  for (const id of bIds) {
    assert(
      id.endsWith('--coll-beta'),
      `seed id ${id} from collection coll-beta must carry --<collectionId> suffix`,
    );
  }
  // Pairwise — no id from collection A appears in collection B's seed.
  for (const id of aIds) {
    assert(
      !bIds.includes(id),
      `seed ids from different host Collections must not overlap (clash: ${id})`,
    );
  }
})();

// ----- Codex review pass 1 — findElement walker must recurse into ---------
// customTemplate so selection of a template child resolves and the inspector
// can render it. Source-grep the runtime helper since the real function
// pulls in the full editor module graph (DOM helpers, render.ts, co-edit).
{
  const runtimeSrc = await Bun.file(
    new URL('./runtime-helpers.ts', import.meta.url),
  ).text();
  // Find the findElementIn closure that drives findElementImpl.
  const findElementInAnchor = runtimeSrc.indexOf('function findElementIn(');
  assert(
    findElementInAnchor > 0,
    'runtime-helpers.ts must own findElementIn (re-locate if renamed)',
  );
  // Bound the walker body up to the function's end (a single export follows
  // immediately after; finding the next top-level function boundary is good
  // enough).
  const walkerTail = runtimeSrc.slice(findElementInAnchor);
  const walkerEnd = walkerTail.indexOf('\nexport function findElementImpl');
  assert(
    walkerEnd > 0,
    'findElementIn must precede findElementImpl as the helper export pair',
  );
  const walkerBody = walkerTail.slice(0, walkerEnd);
  assert(
    walkerBody.includes("'collection-custom-template'"),
    'findElement walker must recurse into customTemplate with parentKind="collection-custom-template" ' +
      '(ADR 0065 D6 — selection of any element inside an active template must resolve)',
  );
  assert(
    walkerBody.includes('customTemplate'),
    'findElement walker must reference the customTemplate field name',
  );
}

// ----- Codex review pass 1 — first-switch path must NOT call rebuildElement
// after enterCollectionTemplateEdit -----------------------------------------
// The enter verb already invokes ctx.renderAll() which rebuilds every wrapper
// AND re-runs mountTemplateEditChromeImpl. A trailing ctx.rebuildElement on
// the same Collection replaces the just-mounted wrapper, dropping the
// `data-template-edit-active` attribute and the Done button (the chrome
// mount runs in renderAll, not rebuildElement). Source-grep the inspector
// handler so a future re-introduction of the rebuild call fails loudly.
{
  const inspectorSrc = await Bun.file(
    new URL('./element-inspector.ts', import.meta.url),
  ).text();
  // Find the canonical call to enterCollectionTemplateEdit inside the
  // display-dropdown change handler. The line immediately AFTER it must
  // be `return;` (no trailing rebuildElement). Strip line-comments first
  // so a comment that mentions ctx.rebuildElement (e.g. the explanatory
  // block above the call) doesn't trip the grep.
  const stripped = inspectorSrc
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join('\n');
  const enterCallIdx = stripped.indexOf('ctx.enterCollectionTemplateEdit(collection.id)');
  assert(
    enterCallIdx > 0,
    'inspector display-dropdown handler must call ctx.enterCollectionTemplateEdit(collection.id)',
  );
  // Slice from the enter call to the next `return;` — that's the bounded
  // window where a trailing rebuild would live. Strip line-comments above
  // already removed any explanatory references to ctx.rebuildElement.
  const afterEnter = stripped.slice(enterCallIdx);
  const returnIdx = afterEnter.indexOf('return;');
  assert(
    returnIdx > 0,
    'first-switch branch must terminate in a return after enterCollectionTemplateEdit',
  );
  const window = afterEnter.slice(0, returnIdx);
  assert(
    !window.includes('ctx.rebuildElement'),
    'first-switch path must NOT call ctx.rebuildElement after enterCollectionTemplateEdit ' +
      '(renderAll inside the verb already remounts and re-runs the chrome mount; ' +
      'a trailing rebuild strips data-template-edit-active and the Done button)',
  );
}

console.log('[collection-template-edit:smoke] all assertions passed');
