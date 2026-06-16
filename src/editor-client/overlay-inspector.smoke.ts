import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import type { Overlay } from '../canvas/overlays.js';
import {
  findOverlayForElement,
  removeOverlayFromElement,
  upsertOverlayForElement,
} from './overlay-inspector.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[overlay-inspector:smoke] ' + message);
}

function actionElement(id: string): CanvasElement {
  return {
    id,
    type: 'action',
    box: { x: 40, y: 80, w: 180, h: 48, z: 2 },
    label: [{ text: 'Open overlay' }],
    href: { type: 'external', url: 'https://example.com' },
    variant: 'solid',
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
    renderAll(): void;
    scheduleSave(): void;
  };
  log: { undo: number; renders: number; saves: number };
} {
  const log = { undo: 0, renders: 0, saves: 0 };
  return {
    ctx: {
      state,
      captureForUndo() {
        log.undo += 1;
      },
      renderAll() {
        log.renders += 1;
      },
      scheduleSave() {
        log.saves += 1;
      },
    },
    log,
  };
}

const trigger = actionElement('open-project');
const secondary = actionElement('open-secondary');
const state = siteWithElements([trigger, secondary]);
const handles = mutationCtx(state);

const created = upsertOverlayForElement(handles.ctx, trigger, { mode: 'modal' });
assert(state.overlays?.length === 1, 'modal upsert must create one overlay');
assert(state.overlaySections?.length === 1, 'modal upsert must create one overlay section');
assert(created.id.length > 0, 'created overlay must have an id');
assert(created.contentSectionId === state.overlaySections[0]?.id, 'overlay must reference section');
assert(created.trigger.type === 'click', 'created overlay must use click trigger');
assert(
  created.trigger.type === 'click' && created.trigger.elementId === trigger.id,
  'created overlay trigger must reference edited element',
);
assert(created.modality === 'modal', 'modal mode must create modal overlay');
assert(created.placement.type === 'center', 'modal mode must use center placement');
assert(created.focus.trap === true, 'modal mode must trap focus');
assert(created.bodyScroll === 'lock', 'modal mode must lock body scroll');
assert(created.dismissal.closeButton === true, 'modal mode must include close button');
assert(created.dismissal.escapeKey === true, 'modal mode must allow Escape dismissal');
assert(created.dismissal.backdropClick === true, 'modal mode must allow backdrop dismissal');
assert(state.overlaySections[0]?.elements.length === 1, 'default overlay section must have content');
assert(handles.log.undo === 1, 'create must capture undo once');
assert(handles.log.renders === 1, 'create must render once');
assert(handles.log.saves === 1, 'create must schedule save once');

const updated = upsertOverlayForElement(handles.ctx, trigger, { mode: 'popover' });
assert(updated.id === created.id, 'upsert for same element must reuse existing overlay');
assert(state.overlays?.length === 1, 'upsert must not duplicate overlays');
assert(state.overlaySections?.length === 1, 'upsert must not duplicate content sections');
assert(updated.modality === 'non-modal', 'popover mode must be non-modal');
assert(updated.bodyScroll === 'allow', 'popover mode must allow body scroll');
assert(updated.focus.trap === false, 'popover mode must not trap focus');
assert(updated.placement.type === 'anchored', 'popover mode must use anchored placement');
assert(
  updated.placement.type === 'anchored' &&
    updated.placement.anchorElementId === trigger.id &&
    updated.placement.side === 'bottom',
  'popover mode must anchor to the edited element',
);

const unrelatedSection = {
  id: 'overlay-section-unrelated',
  recipeId: 'custom' as const,
  name: 'Unrelated overlay',
  height: 260,
  elements: [],
};
const unrelated: Overlay = {
  id: 'unrelated-overlay',
  contentSectionId: unrelatedSection.id,
  trigger: { type: 'load' },
  modality: 'modal',
  placement: { type: 'fullscreen' },
  dismissal: {
    closeButton: true,
    escapeKey: true,
    backdropClick: true,
    routeChange: true,
  },
  focus: {
    initial: { type: 'overlay' },
    returnTo: { type: 'overlay' },
    trap: true,
  },
  bodyScroll: 'lock',
};
state.overlaySections?.push(unrelatedSection);
state.overlays?.push(unrelated);

const found = findOverlayForElement(state, trigger);
assert(found?.id === created.id, 'find must return the click overlay for the element');
removeOverlayFromElement(handles.ctx, trigger);
assert(findOverlayForElement(state, trigger) === undefined, 'remove must clear element overlay');
assert(
  state.overlays?.length === 1 && state.overlays[0]?.id === unrelated.id,
  'remove must preserve unrelated overlays',
);
assert(
  state.overlaySections?.length === 1 && state.overlaySections[0]?.id === unrelatedSection.id,
  'remove must preserve unrelated overlay sections',
);

removeOverlayFromElement(handles.ctx, secondary);
assert(
  state.overlays?.length === 1 && state.overlays[0]?.id === unrelated.id,
  'removing an element without an overlay must be a no-op',
);

console.log('[overlay-inspector:smoke] OK');
