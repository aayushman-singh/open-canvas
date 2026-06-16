import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import type { MotionSequence } from '../canvas/interactions.js';
import {
  findMotionSequenceForElement,
  removeMotionSequenceFromElement,
  upsertMotionSequenceForElement,
} from './motion-sequence-inspector.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[motion-sequence-inspector:smoke] ' + message);
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

function siteWithElements(elements: CanvasElement[]): EditableSite {
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
            elements,
          },
        ],
      },
    ],
  };
}

function mutationCtx(state: EditableSite): {
  ctx: {
    state: EditableSite;
    captureForUndo(): void;
    rebuildElement(id: string): void;
    scheduleSave(): void;
  };
  log: { undo: number; rebuilds: string[]; saves: number };
} {
  const log = { undo: 0, rebuilds: [] as string[], saves: 0 };
  return {
    ctx: {
      state,
      captureForUndo() {
        log.undo += 1;
      },
      rebuildElement(id: string) {
        log.rebuilds.push(id);
      },
      scheduleSave() {
        log.saves += 1;
      },
    },
    log,
  };
}

const hero = textElement('hero-title');
const secondary = textElement('secondary-title');
const state = siteWithElements([hero, secondary]);
const handles = mutationCtx(state);

const created = upsertMotionSequenceForElement(handles.ctx, hero, {
  triggerType: 'viewport-enter',
  preset: 'fade-up',
  durationMs: 640,
  delayMs: 80,
  easing: 'out-cubic',
});

assert(state.motionSequences?.length === 1, 'upsert must create one site-level sequence');
assert(created.id.length > 0, 'created sequence must have an id');
assert(created.trigger.type === 'viewport-enter', 'created sequence must use requested trigger');
assert(
  created.trigger.type === 'viewport-enter' && created.trigger.elementId === hero.id,
  'viewport trigger must reference the edited element',
);
assert(created.steps.length === 1, 'created sequence must have one editable step');
const createdStep = created.steps[0]!;
assert(
  createdStep.target.type === 'element' && createdStep.target.elementId === hero.id,
  'created step must target the edited element',
);
assert(createdStep.properties.opacity?.[0] === 0, 'fade-up must start transparent');
assert(createdStep.properties.opacity?.[1] === 1, 'fade-up must end opaque');
assert(createdStep.properties.y?.[0] === 24, 'fade-up must start below final position');
assert(createdStep.properties.y?.[1] === 0, 'fade-up must end at final y');
assert(createdStep.durationMs === 640, 'created sequence must store requested duration');
assert(createdStep.delayMs === 80, 'created sequence must store requested delay');
assert(createdStep.easing === 'out-cubic', 'created sequence must store requested easing');
assert(handles.log.undo === 1, 'create must capture undo once');
assert(handles.log.rebuilds.includes(hero.id), 'create must rebuild the edited element');
assert(handles.log.saves === 1, 'create must schedule save once');

const updated = upsertMotionSequenceForElement(handles.ctx, hero, {
  triggerType: 'click',
  preset: 'scale-in',
  durationMs: 220,
  delayMs: 0,
  easing: 'in-out-cubic',
});

assert(updated.id === created.id, 'upsert for same element must reuse the existing sequence');
assert(state.motionSequences?.length === 1, 'upsert must not duplicate the sequence');
assert(updated.trigger.type === 'click', 'updated sequence must change trigger');
assert(
  updated.trigger.type === 'click' && updated.trigger.elementId === hero.id,
  'click trigger must reference the edited element',
);
const updatedStep = updated.steps[0]!;
assert(updatedStep.properties.scale?.[0] === 0.96, 'scale-in must start slightly smaller');
assert(updatedStep.properties.scale?.[1] === 1, 'scale-in must end at natural scale');
assert(updatedStep.properties.opacity?.[0] === 0, 'scale-in must preserve opacity reveal');
assert(updatedStep.properties.y === undefined, 'scale-in must replace the prior y motion');
assert(updatedStep.durationMs === 220, 'updated sequence must store new duration');
assert(updatedStep.delayMs === undefined, 'zero delay must be omitted');
assert(updatedStep.easing === 'in-out-cubic', 'updated sequence must store new easing');

const unrelated: MotionSequence = {
  id: 'unrelated-overlay-open',
  trigger: { type: 'load' },
  steps: [
    {
      id: 'unrelated-step',
      target: { type: 'overlay', overlayId: 'project-overlay' },
      properties: { opacity: [0, 1] },
      durationMs: 180,
    },
  ],
};
state.motionSequences?.push(unrelated);

const found = findMotionSequenceForElement(state, hero);
assert(found?.id === created.id, 'find must return the element-targeted sequence');
removeMotionSequenceFromElement(handles.ctx, hero);
assert(
  findMotionSequenceForElement(state, hero) === undefined,
  'remove must clear the element-targeted sequence',
);
assert(
  state.motionSequences?.length === 1 && state.motionSequences[0]?.id === unrelated.id,
  'remove must preserve unrelated motion sequences',
);

removeMotionSequenceFromElement(handles.ctx, secondary);
assert(
  state.motionSequences?.length === 1 && state.motionSequences[0]?.id === unrelated.id,
  'removing an element without sequence must be a no-op',
);

console.log('[motion-sequence-inspector:smoke] OK');
