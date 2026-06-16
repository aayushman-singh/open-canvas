import type { MotionSequence } from '../canvas/interactions.js';
import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import {
  listRouteFocusTargets,
  removeLoadExperience,
  removeRouteTransition,
  upsertLoadExperience,
  upsertRouteTransition,
} from './load-route-transition-inspector.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[load-route-transition-inspector:smoke] ' + message);
}

function assertThrowsWithField(description: string, action: () => void, field: string): void {
  try {
    action();
  } catch (error) {
    assert(error instanceof Error, description + ': expected Error instance');
    assert(
      error.message.includes(field),
      description + ': expected error to include "' + field + '", got "' + error.message + '"',
    );
    return;
  }
  throw new Error(
    '[load-route-transition-inspector:smoke] ' + description + ': expected action to throw',
  );
}

function textElement(id: string): CanvasElement {
  return {
    id,
    type: 'text',
    box: { x: 0, y: 0, w: 420, h: 90, z: 1 },
    content: [{ text: 'Motion target' }],
    role: 'heading',
    fontSize: 48,
    fontWeight: 700,
    align: 'left',
  };
}

function sequence(id: string, elementId: string): MotionSequence {
  return {
    id,
    trigger: { type: 'load' },
    steps: [
      {
        id: id + '-step',
        target: { type: 'element', elementId },
        properties: { opacity: [0, 1] },
        durationMs: 240,
        easing: 'out-cubic',
      },
    ],
  };
}

function site(): EditableSite {
  const hero = textElement('hero-title');
  const next = textElement('route-next-title');
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 600,
            elements: [hero],
          },
        ],
      },
      {
        id: 'page-next',
        slug: 'next',
        title: 'Next',
        width: 1440,
        sections: [
          {
            id: 'section-next',
            recipeId: 'custom',
            name: 'Next',
            height: 600,
            elements: [next],
          },
        ],
      },
    ],
    motionSequences: [
      sequence('load-intro', hero.id),
      sequence('load-exit', hero.id),
      sequence('route-out', hero.id),
      sequence('route-in', next.id),
    ],
  };
}

function mutationCtx(state: EditableSite): {
  ctx: {
    state: EditableSite;
    captureForUndo(): void;
    scheduleSave(): void;
  };
  log: { undo: number; saves: number };
} {
  const log = { undo: 0, saves: 0 };
  return {
    ctx: {
      state,
      captureForUndo() {
        log.undo += 1;
      },
      scheduleSave() {
        log.saves += 1;
      },
    },
    log,
  };
}

const state = site();
const handles = mutationCtx(state);

const createdLoad = upsertLoadExperience(handles.ctx, {
  run: 'once-per-session',
  gates: [{ type: 'document-ready' }],
  timeoutMs: 2500,
  introSequenceId: 'load-intro',
  exitSequenceId: 'load-exit',
});

assert(state.loadExperience === createdLoad, 'load upsert must store the site-level contract');
assert(createdLoad.id.length > 0, 'created load experience must have an id');
assert(createdLoad.run === 'once-per-session', 'created load experience must store run policy');
assert(createdLoad.gates[0]?.type === 'document-ready', 'created load must store readiness gate');
assert(createdLoad.timeoutMs === 2500, 'created load must store timeout');
assert(createdLoad.introSequenceId === 'load-intro', 'created load must store intro sequence');
assert(createdLoad.exitSequenceId === 'load-exit', 'created load must store exit sequence');
assert(
  createdLoad.failureEvent === 'load-experience-failed',
  'created load must carry default failure event',
);
assert(handles.log.undo === 1, 'load create must capture undo once');
assert(handles.log.saves === 1, 'load create must schedule save once');

const updatedLoad = upsertLoadExperience(handles.ctx, {
  run: 'every-visit',
  gates: [{ type: 'fonts-ready' }],
  timeoutMs: 4000,
  introSequenceId: 'load-intro',
});

assert(updatedLoad.id === createdLoad.id, 'load update must preserve id');
assert(updatedLoad.run === 'every-visit', 'load update must change run policy');
assert(updatedLoad.gates[0]?.type === 'fonts-ready', 'load update must replace gate set');
assert(updatedLoad.exitSequenceId === undefined, 'load update must clear omitted exit sequence');

const beforeInvalidLoadUndo = handles.log.undo;
assertThrowsWithField(
  'missing intro sequence',
  () =>
    upsertLoadExperience(handles.ctx, {
      run: 'once-per-session',
      gates: [{ type: 'document-ready' }],
      timeoutMs: 2500,
      introSequenceId: 'missing-sequence',
    }),
  'introSequenceId',
);
assert(handles.log.undo === beforeInvalidLoadUndo, 'invalid load edit must not capture undo');

assertThrowsWithField(
  'empty load gates',
  () =>
    upsertLoadExperience(handles.ctx, {
      run: 'once-per-session',
      gates: [],
      timeoutMs: 2500,
    }),
  'gates',
);

const createdRoute = upsertRouteTransition(handles.ctx, {
  outgoingSequenceId: 'route-out',
  incomingSequenceId: 'route-in',
  swapAt: 'after-outgoing',
  scrollRestoration: 'top',
  focusTarget: { type: 'page' },
});

assert(state.routeTransition === createdRoute, 'route upsert must store the site-level contract');
assert(createdRoute.id.length > 0, 'created route transition must have an id');
assert(
  createdRoute.trigger.type === 'same-site-navigation',
  'route transition must use same-site navigation trigger',
);
assert(createdRoute.outgoingSequenceId === 'route-out', 'route must store outgoing sequence');
assert(createdRoute.incomingSequenceId === 'route-in', 'route must store incoming sequence');
assert(createdRoute.swapAt === 'after-outgoing', 'route must store swap timing');
assert(createdRoute.scrollRestoration === 'top', 'route must store scroll restoration');
assert(createdRoute.focusTarget?.type === 'page', 'route must store page focus target');
assert(createdRoute.hydrate === true, 'route transition must always require hydration');
assert(
  createdRoute.failureEvent === 'route-transition-failed',
  'created route must carry default failure event',
);

const updatedRoute = upsertRouteTransition(handles.ctx, {
  outgoingSequenceId: 'route-out',
  incomingSequenceId: 'route-in',
  swapAt: 'with-outgoing',
  scrollRestoration: 'preserve',
  focusTarget: { type: 'element', elementId: 'route-next-title' },
});

assert(updatedRoute.id === createdRoute.id, 'route update must preserve id');
assert(updatedRoute.swapAt === 'with-outgoing', 'route update must change swap timing');
assert(updatedRoute.scrollRestoration === 'preserve', 'route update must change scroll mode');
assert(
  updatedRoute.focusTarget?.type === 'element' &&
    updatedRoute.focusTarget.elementId === 'route-next-title',
  'route update must store element focus target',
);

assertThrowsWithField(
  'missing outgoing sequence',
  () =>
    upsertRouteTransition(handles.ctx, {
      outgoingSequenceId: 'missing-route-sequence',
      incomingSequenceId: 'route-in',
      swapAt: 'after-outgoing',
      scrollRestoration: 'top',
    }),
  'outgoingSequenceId',
);

assertThrowsWithField(
  'missing focus element',
  () =>
    upsertRouteTransition(handles.ctx, {
      outgoingSequenceId: 'route-out',
      incomingSequenceId: 'route-in',
      swapAt: 'after-outgoing',
      scrollRestoration: 'top',
      focusTarget: { type: 'element', elementId: 'missing-element' },
    }),
  'focusTarget.elementId',
);

const focusTargets = listRouteFocusTargets(state);
assert(
  focusTargets.some((target) => target.value === 'element:route-next-title'),
  'focus target list must expose known element targets',
);

removeLoadExperience(handles.ctx);
assert(state.loadExperience === undefined, 'remove load must clear only loadExperience');
assert(state.routeTransition !== undefined, 'remove load must preserve routeTransition');

removeRouteTransition(handles.ctx);
assert(state.routeTransition === undefined, 'remove route must clear only routeTransition');
assert(state.motionSequences?.length === 4, 'route/load edits must preserve motion sequences');

console.log('[load-route-transition-inspector:smoke] OK');
