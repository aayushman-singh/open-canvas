// src/editor-client/interactions-panel.ts
//
// Editor surface for site-level interaction behaviour: Load Experience,
// Route Transition, Overlays, and Motion Sequence Lite. This module owns
// only the Owner controls; the schema and visitor runtime remain the
// source of truth for valid values and published behaviour.

import type {
  InteractionTrigger,
  BehaviourLoadExperience,
  PremiumLoadExperience,
  LoadExperienceGate,
  LoadExperiencePreset,
  LoadExperienceRunPolicy,
  MotionSequenceLite,
  MotionSequenceLiteEffect,
  MotionSequenceLiteStep,
  MotionSequenceLiteTarget,
  MotionSequenceLiteTargetType,
  Overlay,
  OverlayDismissal,
  OverlayScope,
  OverlayTriggerType,
  RouteTransition,
  RouteTransitionMode,
  SharedRouteElement,
  EditableSite,
} from '../canvas/schema.js';
import type {
  BehaviourTarget,
  MotionSequence,
  MotionSequenceStep,
  ScrollScene,
} from '../canvas/behaviour-primitives.js';
import {
  MOTION_SEQUENCE_TRIGGER_TYPES,
  TEXT_SPLIT_UNITS,
} from '../canvas/behaviour-primitives.js';
import { isPremiumLoadExperience } from '../canvas/schema.js';
import {
  LOAD_EXPERIENCE_GATES,
  LOAD_EXPERIENCE_PRESETS,
  LOAD_EXPERIENCE_RUN_POLICIES,
  MOTION_SEQUENCE_LITE_EFFECTS,
  MOTION_SEQUENCE_LITE_TARGET_TYPES,
  OVERLAY_TRIGGER_TYPES,
  ROUTE_TRANSITION_MODES,
} from '../canvas/schema.js';
import type {
  EditorContext,
  PersistContext,
  RenderContext,
  StateContext,
  StatusEmitterContext,
} from './editor-context.js';
import { field, selectInput } from './dom-builders.js';

export type InteractionsPanelContext = StateContext &
  PersistContext &
  RenderContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    | 'sidebar'
    | 'selectedElementId'
    | 'activePageId'
    | 'root'
    | 'previewOverlay'
    | 'previewLoadExperience'
    | 'previewRouteTransition'
    | 'useSelectedElementAsOverlayTrigger'
  >;

type SequenceSlot =
  | 'load-handoff'
  | 'route-outgoing'
  | 'route-incoming'
  | 'overlay-open'
  | 'overlay-close';

const DEFAULT_EASING = 'ease-in-out';

export function defaultOverlay(id: string, name: string, pageId: string): Overlay {
  return {
    id,
    name,
    scope: { type: 'pages', pageIds: [pageId] },
    trigger: { type: 'load' },
    content: {
      id: id + '-content',
      recipeId: 'custom',
      name: name + ' content',
      height: 420,
      elements: [],
    },
    dismissal: defaultDismissal(),
  };
}

export function defaultLoadExperience(): PremiumLoadExperience {
  return {
    id: 'load-main',
    enabled: false,
    preset: 'fade',
    runPolicy: 'every-visit',
    gates: ['document-ready'],
    timeoutMs: 4000,
  };
}

export function defaultRouteTransition(): RouteTransition {
  return {
    id: 'route-main',
    enabled: false,
    mode: 'fade',
    durationMs: 220,
    easing: DEFAULT_EASING,
  };
}

export function renderInteractionsPanel(ctx: InteractionsPanelContext): void {
  const host = document.getElementById('opencanvas-interactions-panel');
  if (!host || !ctx.state) return;
  host.replaceChildren();
  host.className = 'opencanvas-interactions-panel';
  renderScrollSceneControls(ctx, host);
  renderMotionSequenceControls(ctx, host);
  renderLoadControls(ctx, host);
  renderRouteControls(ctx, host);
  renderOverlayControls(ctx, host);
}

function defaultDismissal(): OverlayDismissal {
  return {
    closeButton: true,
    escape: true,
    backdropClick: true,
    bodyScrollLock: true,
    focusTrap: true,
    returnFocus: true,
  };
}

function mutate(ctx: InteractionsPanelContext, fn: () => void): void {
  if (!ctx.state) return;
  ctx.captureForUndo();
  fn();
  ctx.renderAll();
  renderInteractionsPanel(ctx);
  ctx.scheduleSave();
}

function section(title: string): HTMLElement {
  const wrap = document.createElement('section');
  wrap.className = 'opencanvas-sidebar-group opencanvas-interactions-section';
  const heading = document.createElement('h2');
  heading.textContent = title;
  wrap.appendChild(heading);
  return wrap;
}

function row(className = 'style-row'): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  return el;
}

function actionButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'opencanvas-sidebar-action opencanvas-interactions-action';
  button.textContent = label;
  button.title = title;
  return button;
}

function compactButton(label: string, title: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'style-btn';
  button.textContent = label;
  button.title = title;
  return button;
}

function checkbox(
  checked: boolean,
  labelText: string,
  onChange: (checked: boolean) => void,
): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'opencanvas-interactions-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  label.appendChild(input);
  const text = document.createElement('span');
  text.textContent = labelText;
  label.appendChild(text);
  return label;
}

function numberInput(value: number, min: number, max: number, step = 1): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return input;
}

function textInput(value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.spellcheck = false;
  return input;
}

function validNumber(input: HTMLInputElement, min: number, max: number): number | null {
  const next = Number(input.value);
  if (!Number.isFinite(next) || next < min || next > max) return null;
  return next;
}

function activePageId(ctx: InteractionsPanelContext): string | null {
  if (!ctx.state || ctx.state.pages.length === 0) return null;
  return ctx.activePageId || ctx.state.pages[0]!.id;
}

function currentPremiumLoadExperience(state: EditableSite): PremiumLoadExperience {
  const load = state.loadExperience;
  return isPremiumLoadExperience(load) ? load : defaultLoadExperience();
}

function isBehaviourLoadExperience(
  value: EditableSite['loadExperience'],
): value is BehaviourLoadExperience {
  return !!value && typeof value === 'object' && 'label' in value;
}

function loadEnterSequences(ctx: InteractionsPanelContext): MotionSequence[] {
  return (ctx.state?.motionSequences ?? []).filter((sequence) => sequence.trigger.type === 'load-enter');
}

function defaultBehaviourLoadExperience(ctx: InteractionsPanelContext): BehaviourLoadExperience {
  const existing = loadEnterSequences(ctx)[0];
  return {
    id: 'load-enter-main',
    label: 'Enter',
    enterLabel: 'Enter site',
    background: '#050505',
    foreground: '#ffffff',
    sequenceId: existing?.id ?? 'load-enter-sequence',
  };
}

function ensureLoadEnterSequence(ctx: InteractionsPanelContext, sequenceId: string): void {
  if (!ctx.state) return;
  if ((ctx.state.motionSequences ?? []).some((sequence) => sequence.id === sequenceId)) return;
  ctx.state.motionSequences = [
    ...(ctx.state.motionSequences ?? []),
    {
      id: sequenceId,
      trigger: { type: 'load-enter' },
      reducedMotion: 'final-state',
      steps: [
        {
          id: sequenceId + '-site-in',
          target: { type: 'site' },
          from: { opacity: 0 },
          to: { opacity: 1 },
          durationMs: 260,
          delayMs: 0,
          easing: DEFAULT_EASING,
        },
      ],
    },
  ];
}

export function defaultScrollScene(
  id: string,
  sectionId: string,
  selectedElementId?: string | null,
): { scene: ScrollScene; sequence: MotionSequence } {
  const sequenceId = id + '-sequence';
  const target: BehaviourTarget =
    selectedElementId && selectedElementId.length > 0
      ? { type: 'element', elementId: selectedElementId }
      : { type: 'section', sectionId };
  return {
    scene: {
      id,
      sectionId,
      sequenceId,
      pinTarget: { type: 'section', sectionId },
      startOffsetPx: 0,
      endOffsetPx: 720,
    },
    sequence: {
      id: sequenceId,
      trigger: { type: 'scroll-scene', scrollSceneId: id },
      reducedMotion: 'final-state',
      steps: [
        {
          id: id + '-step-1',
          target,
          from: { opacity: 0, translateY: 48 },
          to: { opacity: 1, translateY: 0 },
          durationMs: 720,
          delayMs: 0,
          easing: DEFAULT_EASING,
        },
      ],
    },
  };
}

function activePage(ctx: InteractionsPanelContext) {
  if (!ctx.state) return null;
  const pageId = activePageId(ctx);
  return ctx.state.pages.find((page) => page.id === pageId) ?? ctx.state.pages[0] ?? null;
}

function activePageSections(ctx: InteractionsPanelContext) {
  return activePage(ctx)?.sections ?? [];
}

function sectionLabel(ctx: InteractionsPanelContext, sectionId: string): string {
  const found = activePageSections(ctx).find((sectionItem) => sectionItem.id === sectionId);
  return found ? found.name + ' (' + found.id + ')' : sectionId;
}

function elementIdsForActivePage(ctx: InteractionsPanelContext): string[] {
  const ids: string[] = [];
  for (const sectionItem of activePageSections(ctx)) {
    for (const element of sectionItem.elements) ids.push(element.id);
  }
  return ids;
}

function renderScrollSceneControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Scroll Scenes');
  const scenes = ctx.state.scrollScenes ?? [];
  const sections = activePageSections(ctx);

  const add = actionButton('Add scroll scene', 'Create a pinned scroll scene for the active page');
  add.disabled = sections.length === 0;
  add.addEventListener('click', () => {
    const firstSection = sections[0];
    if (!firstSection) {
      ctx.setStatus('Add a section before creating a scroll scene', 'error');
      return;
    }
    mutate(ctx, () => {
      const id = 'scroll-scene-' + Date.now();
      const created = defaultScrollScene(id, firstSection.id, ctx.selectedElementId);
      ctx.state!.scrollScenes = [...(ctx.state!.scrollScenes ?? []), created.scene];
      ctx.state!.motionSequences = [...(ctx.state!.motionSequences ?? []), created.sequence];
    });
    ctx.setStatus('Scroll scene added', 'ok');
  });
  wrap.appendChild(add);

  if (sections.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'Add a section before creating scroll scenes.';
    wrap.appendChild(empty);
    host.appendChild(wrap);
    return;
  }

  if (scenes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No scroll scenes yet.';
    wrap.appendChild(empty);
  }

  for (let i = 0; i < scenes.length; i++) {
    renderScrollSceneCard(ctx, wrap, scenes[i]!, i);
  }

  host.appendChild(wrap);
}

function renderScrollSceneCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  scene: ScrollScene,
  index: number,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card';

  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = sectionLabel(ctx, scene.sectionId);
  header.appendChild(title);
  const remove = compactButton('Delete', 'Delete this scroll scene and its linked motion sequence');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      ctx.state!.scrollScenes = (ctx.state!.scrollScenes ?? []).filter((item) => item.id !== scene.id);
      ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).filter(
        (sequence) => sequence.id !== scene.sequenceId,
      );
    });
    ctx.setStatus('Scroll scene deleted', 'ok');
  });
  header.appendChild(remove);
  card.appendChild(header);

  const sections = activePageSections(ctx);
  const sectionIds = sections.map((sectionItem) => sectionItem.id);
  const sectionInput = selectInput(sectionIds, sectionIds.includes(scene.sectionId) ? scene.sectionId : sectionIds[0]!);
  sectionInput.addEventListener('change', () => {
    mutate(ctx, () => {
      const scenes = ctx.state!.scrollScenes ?? [];
      const next = sectionInput.value;
      scenes[index] = {
        ...scene,
        sectionId: next,
        pinTarget: scene.pinTarget.type === 'section' ? { type: 'section', sectionId: next } : scene.pinTarget,
      };
    });
  });
  card.appendChild(field('Trigger section', sectionInput));

  const pinType = selectInput(['section', 'element'], scene.pinTarget.type);
  pinType.addEventListener('change', () => {
    mutate(ctx, () => {
      const elementId = ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '';
      const scenes = ctx.state!.scrollScenes ?? [];
      scenes[index] = {
        ...scene,
        pinTarget:
          pinType.value === 'element'
            ? { type: 'element', elementId }
            : { type: 'section', sectionId: scene.sectionId },
      };
    });
  });
  card.appendChild(field('Pin target type', pinType));

  if (scene.pinTarget.type === 'element') {
    const pinElement = textInput(scene.pinTarget.elementId, 'Element id to pin');
    pinElement.addEventListener('change', () => {
      const value = pinElement.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Scroll scene pin element cannot be empty', 'error');
        pinElement.value = scene.pinTarget.type === 'element' ? scene.pinTarget.elementId : '';
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, pinTarget: { type: 'element', elementId: value } };
      });
    });
    card.appendChild(field('Pin element id', pinElement));
  }

  const start = numberInput(scene.startOffsetPx, 0, 20000, 10);
  start.addEventListener('change', () => updateScrollSceneNumber(ctx, scene, index, 'startOffsetPx', start));
  card.appendChild(field('Start offset (px)', start));

  const end = numberInput(scene.endOffsetPx, 1, 20000, 10);
  end.addEventListener('change', () => updateScrollSceneNumber(ctx, scene, index, 'endOffsetPx', end));
  card.appendChild(field('End offset (px)', end));

  renderScrollSequenceControls(ctx, card, scene);

  host.appendChild(card);
}

function updateScrollSceneNumber(
  ctx: InteractionsPanelContext,
  scene: ScrollScene,
  index: number,
  key: 'startOffsetPx' | 'endOffsetPx',
  input: HTMLInputElement,
): void {
  const next = validNumber(input, key === 'startOffsetPx' ? 0 : 1, 20000);
  if (next === null) {
    ctx.setStatus('Scroll scene ' + key + ' must be within range', 'error');
    input.value = String(scene[key]);
    return;
  }
  mutate(ctx, () => {
    const scenes = ctx.state!.scrollScenes ?? [];
    scenes[index] = { ...scene, [key]: next };
  });
}

function renderScrollSequenceControls(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  scene: ScrollScene,
): void {
  const sequence = (ctx.state?.motionSequences ?? []).find((item) => item.id === scene.sequenceId);
  if (!sequence) {
    const missing = document.createElement('p');
    missing.className = 'opencanvas-section-picker-empty';
    missing.textContent = 'Linked Motion Sequence is missing. Validation blocks publish until it is restored.';
    card.appendChild(missing);
    return;
  }

  const reduced = selectInput(['final-state', 'skip'], sequence.reducedMotion ?? 'final-state');
  reduced.addEventListener('change', () => {
    mutate(ctx, () => {
      updateScrollSequence(ctx, sequence.id, { reducedMotion: reduced.value as 'final-state' | 'skip' });
    });
  });
  card.appendChild(field('Reduced motion', reduced));

  const firstStep = sequence.steps[0];
  if (!firstStep) return;

  const targetType = selectInput(['section', 'element', 'text-split'], firstStep.target.type);
  targetType.addEventListener('change', () => {
    mutate(ctx, () => {
      updateScrollSequenceStep(ctx, sequence.id, firstStep.id, {
        target: defaultScrollStepTarget(ctx, scene, targetType.value),
      });
    });
  });
  card.appendChild(field('Step target type', targetType));

  if (firstStep.target.type === 'element' || firstStep.target.type === 'text-split') {
    const currentTarget = firstStep.target;
    const elementId = textInput(firstStep.target.elementId, 'Element id');
    elementId.addEventListener('change', () => {
      const value = elementId.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Scroll scene target element cannot be empty', 'error');
        elementId.value = currentTarget.elementId;
        return;
      }
      mutate(ctx, () => {
        const target: BehaviourTarget =
          currentTarget.type === 'text-split'
            ? { ...currentTarget, elementId: value }
            : { type: 'element' as const, elementId: value };
        updateScrollSequenceStep(ctx, sequence.id, firstStep.id, { target });
      });
    });
    card.appendChild(field('Step target element', elementId));
  }
}

function defaultScrollStepTarget(
  ctx: InteractionsPanelContext,
  scene: ScrollScene,
  type: string,
): BehaviourTarget {
  if (type === 'text-split') {
    return { type: 'text-split', elementId: ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '', unit: 'word' };
  }
  if (type === 'element') {
    return { type: 'element', elementId: ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '' };
  }
  return { type: 'section', sectionId: scene.sectionId };
}

function updateScrollSequence(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  patch: Partial<MotionSequence>,
): void {
  ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) =>
    sequence.id === sequenceId ? { ...sequence, ...patch } : sequence,
  );
}

function updateScrollSequenceStep(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  stepId: string,
  patch: Partial<MotionSequenceStep>,
): void {
  ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) => {
    if (sequence.id !== sequenceId) return sequence;
    return {
      ...sequence,
      steps: sequence.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    };
  });
}

type EditableMotionNumber = 'opacity' | 'translateX' | 'translateY' | 'scale' | 'rotate';
type MotionPropertySide = 'from' | 'to';

const MOTION_TARGET_TYPES = ['site', 'page', 'section', 'element', 'text-split'] as const;
const MOTION_NUMBER_FIELDS: Array<{
  key: EditableMotionNumber;
  label: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: 'opacity', label: 'Opacity', min: 0, max: 1, step: 0.05 },
  { key: 'translateX', label: 'Translate X', min: -5000, max: 5000, step: 1 },
  { key: 'translateY', label: 'Translate Y', min: -5000, max: 5000, step: 1 },
  { key: 'scale', label: 'Scale', min: 0, max: 10, step: 0.05 },
  { key: 'rotate', label: 'Rotate', min: -1080, max: 1080, step: 1 },
];

function renderMotionSequenceControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Motion Sequences');
  const add = actionButton('Add motion sequence', 'Create a full Motion Sequence for this site');
  add.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = uniqueMotionSequenceId(ctx, 'motion-sequence-' + Date.now());
      ctx.state!.motionSequences = [
        ...(ctx.state!.motionSequences ?? []),
        {
          id,
          trigger: defaultMotionSequenceTrigger(ctx, 'section-enter'),
          reducedMotion: 'final-state',
          steps: [defaultMotionSequenceStep(ctx, id, 0)],
        },
      ];
    });
    ctx.setStatus('Motion Sequence added', 'ok');
  });
  wrap.appendChild(add);

  const sequences = ctx.state.motionSequences ?? [];
  if (sequences.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No Motion Sequences yet.';
    wrap.appendChild(empty);
  }

  for (const sequence of sequences) {
    renderMotionSequenceCard(ctx, wrap, sequence);
  }

  host.appendChild(wrap);
}

function renderMotionSequenceCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  sequence: MotionSequence,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card';

  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = sequence.id;
  header.appendChild(title);
  const remove = compactButton('Delete', 'Delete this Motion Sequence');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).filter((item) => item.id !== sequence.id);
      ctx.state!.scrollScenes = (ctx.state!.scrollScenes ?? []).filter((scene) => scene.sequenceId !== sequence.id);
    });
    ctx.setStatus('Motion Sequence deleted', 'ok');
  });
  header.appendChild(remove);
  card.appendChild(header);

  const trigger = selectInput([...MOTION_SEQUENCE_TRIGGER_TYPES], sequence.trigger.type);
  trigger.addEventListener('change', () => {
    mutate(ctx, () => {
      updateMotionSequence(ctx, sequence.id, {
        trigger: defaultMotionSequenceTrigger(ctx, trigger.value),
      });
    });
  });
  card.appendChild(field('Trigger', trigger));
  renderMotionSequenceTriggerDetail(ctx, card, sequence);

  const reduced = selectInput(['final-state', 'skip'], sequence.reducedMotion ?? 'final-state');
  reduced.addEventListener('change', () => {
    mutate(ctx, () => {
      updateMotionSequence(ctx, sequence.id, { reducedMotion: reduced.value as 'final-state' | 'skip' });
    });
  });
  card.appendChild(field('Reduced motion', reduced));

  const addStep = compactButton('Add step', 'Add a Motion Sequence step');
  addStep.addEventListener('click', () => {
    mutate(ctx, () => {
      updateMotionSequence(ctx, sequence.id, {
        steps: [...sequence.steps, defaultMotionSequenceStep(ctx, sequence.id, sequence.steps.length)],
      });
    });
  });
  card.appendChild(addStep);

  for (let i = 0; i < sequence.steps.length; i++) {
    renderFullMotionSequenceStep(ctx, card, sequence, sequence.steps[i]!, i);
  }

  host.appendChild(card);
}

function renderMotionSequenceTriggerDetail(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  sequence: MotionSequence,
): void {
  const trigger = sequence.trigger;
  if (trigger.type === 'section-enter') {
    const sectionIds = activePageSections(ctx).map((sectionItem) => sectionItem.id);
    const sectionInput = selectInput(
      sectionIds,
      sectionIds.includes(trigger.sectionId) ? trigger.sectionId : sectionIds[0] ?? trigger.sectionId,
    );
    sectionInput.addEventListener('change', () => {
      mutate(ctx, () => {
        updateMotionSequence(ctx, sequence.id, {
          trigger: { type: 'section-enter', sectionId: sectionInput.value },
        });
      });
    });
    card.appendChild(field('Section', sectionInput));
  }
  if (trigger.type === 'scroll-scene') {
    const sceneIds = (ctx.state?.scrollScenes ?? []).map((scene) => scene.id);
    if (sceneIds.length > 0) {
      const sceneInput = selectInput(
        sceneIds,
        sceneIds.includes(trigger.scrollSceneId) ? trigger.scrollSceneId : sceneIds[0]!,
      );
      sceneInput.addEventListener('change', () => {
        mutate(ctx, () => {
          updateMotionSequence(ctx, sequence.id, {
            trigger: { type: 'scroll-scene', scrollSceneId: sceneInput.value },
          });
        });
      });
      card.appendChild(field('Scroll scene', sceneInput));
    } else {
      const missing = document.createElement('p');
      missing.className = 'opencanvas-section-picker-empty';
      missing.textContent = 'Create a Scroll Scene before binding this trigger.';
      card.appendChild(missing);
    }
  }
}

function renderFullMotionSequenceStep(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  sequence: MotionSequence,
  step: MotionSequenceStep,
  index: number,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-step';

  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = 'Motion Sequence step ' + String(index + 1);
  header.appendChild(title);
  const remove = compactButton('Remove', 'Remove this Motion Sequence step');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      updateMotionSequence(ctx, sequence.id, {
        steps: sequence.steps.filter((candidate) => candidate.id !== step.id),
      });
    });
  });
  header.appendChild(remove);
  card.appendChild(header);

  const targetType = selectInput([...MOTION_TARGET_TYPES], step.target.type);
  targetType.addEventListener('change', () => {
    mutate(ctx, () => {
      updateScrollSequenceStep(ctx, sequence.id, step.id, {
        target: defaultMotionTargetForType(ctx, targetType.value),
      });
    });
  });
  card.appendChild(field('Target type', targetType));
  renderMotionTargetDetail(ctx, card, sequence, step);

  renderMotionPropertyGroup(ctx, card, sequence, step, 'from');
  renderMotionPropertyGroup(ctx, card, sequence, step, 'to');

  const delay = numberInput(step.delayMs ?? 0, 0, 10000, 10);
  delay.addEventListener('change', () => updateMotionStepFinite(ctx, sequence.id, step, 'delayMs', delay, 0, 10000));
  card.appendChild(field('Delay (ms)', delay));

  const duration = numberInput(step.durationMs, 0, 10000, 10);
  duration.addEventListener('change', () =>
    updateMotionStepFinite(ctx, sequence.id, step, 'durationMs', duration, 0, 10000),
  );
  card.appendChild(field('Duration (ms)', duration));

  const stagger = numberInput(step.staggerMs ?? 0, 0, 10000, 10);
  stagger.addEventListener('change', () =>
    updateMotionStepFinite(ctx, sequence.id, step, 'staggerMs', stagger, 0, 10000),
  );
  card.appendChild(field('Stagger (ms)', stagger));

  const easing = textInput(step.easing ?? DEFAULT_EASING, DEFAULT_EASING);
  easing.addEventListener('change', () => {
    const value = easing.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Motion Sequence easing cannot be empty', 'error');
      easing.value = step.easing ?? DEFAULT_EASING;
      return;
    }
    mutate(ctx, () => updateScrollSequenceStep(ctx, sequence.id, step.id, { easing: value }));
  });
  card.appendChild(field('Easing', easing));

  host.appendChild(card);
}

function renderMotionTargetDetail(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  sequence: MotionSequence,
  step: MotionSequenceStep,
): void {
  if (step.target.type === 'site') return;
  if (step.target.type === 'page') {
    const pageIds = ctx.state?.pages.map((page) => page.id) ?? [];
    const page = selectInput(pageIds, pageIds.includes(step.target.pageId) ? step.target.pageId : pageIds[0] ?? step.target.pageId);
    page.addEventListener('change', () => {
      mutate(ctx, () => updateScrollSequenceStep(ctx, sequence.id, step.id, { target: { type: 'page', pageId: page.value } }));
    });
    card.appendChild(field('Target page', page));
    return;
  }
  if (step.target.type === 'section') {
    const sectionIds = activePageSections(ctx).map((sectionItem) => sectionItem.id);
    const sectionInput = selectInput(
      sectionIds,
      sectionIds.includes(step.target.sectionId) ? step.target.sectionId : sectionIds[0] ?? step.target.sectionId,
    );
    sectionInput.addEventListener('change', () => {
      mutate(ctx, () =>
        updateScrollSequenceStep(ctx, sequence.id, step.id, { target: { type: 'section', sectionId: sectionInput.value } }),
      );
    });
    card.appendChild(field('Target section', sectionInput));
    return;
  }
  if (step.target.type === 'element' || step.target.type === 'text-split') {
    const target = step.target;
    const elementId = textInput(target.elementId, 'Element id');
    elementId.addEventListener('change', () => {
      const value = elementId.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Motion Sequence target element cannot be empty', 'error');
        elementId.value = target.elementId;
        return;
      }
      mutate(ctx, () => {
        updateScrollSequenceStep(ctx, sequence.id, step.id, {
          target:
            target.type === 'text-split'
              ? { ...target, elementId: value }
              : { type: 'element', elementId: value },
        });
      });
    });
    card.appendChild(field('Target element', elementId));
    if (target.type === 'text-split') {
      const unit = selectInput([...TEXT_SPLIT_UNITS], target.unit);
      unit.addEventListener('change', () => {
        mutate(ctx, () =>
          updateScrollSequenceStep(ctx, sequence.id, step.id, {
            target: { ...target, unit: unit.value as (typeof TEXT_SPLIT_UNITS)[number] },
          }),
        );
      });
      card.appendChild(field('Split unit', unit));
    }
  }
}

function renderMotionPropertyGroup(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  sequence: MotionSequence,
  step: MotionSequenceStep,
  side: MotionPropertySide,
): void {
  for (const spec of MOTION_NUMBER_FIELDS) {
    const input = optionalNumberInput(motionNumberValue(step[side], spec.key), spec.min, spec.max, spec.step);
    input.addEventListener('change', () =>
      updateMotionStepProperty(ctx, sequence.id, step, side, spec.key, input, spec.min, spec.max),
    );
    card.appendChild(field((side === 'from' ? 'From ' : 'To ') + spec.label, input));
  }
}

function optionalNumberInput(
  value: number | undefined,
  min: number,
  max: number,
  step: number,
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = value === undefined ? '' : String(value);
  return input;
}

function motionNumberValue(
  props: MotionSequenceStep['from'] | MotionSequenceStep['to'] | undefined,
  key: EditableMotionNumber,
): number | undefined {
  const value = props?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function updateMotionStepProperty(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  step: MotionSequenceStep,
  side: MotionPropertySide,
  key: EditableMotionNumber,
  input: HTMLInputElement,
  min: number,
  max: number,
): void {
  const value = input.value.trim();
  const current = { ...(step[side] ?? {}) };
  if (value.length === 0) {
    delete current[key];
    if (side === 'to' && Object.keys(current).length === 0) {
      ctx.setStatus('Motion Sequence "to" properties need at least one value', 'error');
      input.value = String(motionNumberValue(step[side], key) ?? '');
      return;
    }
    mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [side]: current }));
    return;
  }
  const next = Number(value);
  if (!Number.isFinite(next) || next < min || next > max) {
    ctx.setStatus('Motion Sequence ' + key + ' must be ' + String(min) + '-' + String(max), 'error');
    input.value = String(motionNumberValue(step[side], key) ?? '');
    return;
  }
  current[key] = next;
  mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [side]: current }));
}

function updateMotionStepFinite(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  step: MotionSequenceStep,
  key: 'delayMs' | 'durationMs' | 'staggerMs',
  input: HTMLInputElement,
  min: number,
  max: number,
): void {
  const next = validNumber(input, min, max);
  if (next === null) {
    ctx.setStatus('Motion Sequence ' + key + ' must be ' + String(min) + '-' + String(max), 'error');
    input.value = String(step[key] ?? 0);
    return;
  }
  mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [key]: next }));
}

function updateMotionSequence(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  patch: Partial<MotionSequence>,
): void {
  ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) =>
    sequence.id === sequenceId ? { ...sequence, ...patch } : sequence,
  );
}

function defaultMotionSequenceTrigger(ctx: InteractionsPanelContext, type: string): MotionSequence['trigger'] {
  if (type === 'load-enter') return { type: 'load-enter' };
  if (type === 'scroll-scene') return { type: 'scroll-scene', scrollSceneId: ctx.state?.scrollScenes?.[0]?.id ?? '' };
  return { type: 'section-enter', sectionId: activePageSections(ctx)[0]?.id ?? '' };
}

function defaultMotionTargetForType(ctx: InteractionsPanelContext, type: string): BehaviourTarget {
  if (type === 'page') return { type: 'page', pageId: activePageId(ctx) ?? ctx.state?.pages[0]?.id ?? '' };
  if (type === 'section') return { type: 'section', sectionId: activePageSections(ctx)[0]?.id ?? '' };
  if (type === 'element') return { type: 'element', elementId: ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '' };
  if (type === 'text-split') return { type: 'text-split', elementId: ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '', unit: 'word' };
  return { type: 'site' };
}

function defaultMotionSequenceStep(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  index: number,
): MotionSequenceStep {
  return {
    id: sequenceId + '-step-' + String(index + 1),
    target: defaultMotionTargetForType(ctx, ctx.selectedElementId ? 'element' : 'section'),
    from: { opacity: 0, translateY: 24 },
    to: { opacity: 1, translateY: 0 },
    durationMs: 420,
    delayMs: 0,
    staggerMs: 0,
    easing: DEFAULT_EASING,
  };
}

function uniqueMotionSequenceId(ctx: InteractionsPanelContext, base: string): string {
  const ids = new Set((ctx.state?.motionSequences ?? []).map((sequence) => sequence.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(base + '-' + String(index))) index += 1;
  return base + '-' + String(index);
}

function renderLoadControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Load Experience');
  if (isBehaviourLoadExperience(ctx.state.loadExperience)) {
    renderBehaviourLoadControls(ctx, wrap, ctx.state.loadExperience);
    host.appendChild(wrap);
    return;
  }
  const load = isPremiumLoadExperience(ctx.state.loadExperience) ? ctx.state.loadExperience : undefined;

  const designerMode = actionButton(
    'Use designer enter moment',
    'Switch to the behaviour Load Experience used by premium designer templates',
  );
  designerMode.addEventListener('click', () => {
    mutate(ctx, () => {
      const next = defaultBehaviourLoadExperience(ctx);
      ensureLoadEnterSequence(ctx, next.sequenceId);
      ctx.state!.loadExperience = next;
    });
    ctx.setStatus('Designer enter moment enabled', 'ok');
  });
  wrap.appendChild(designerMode);

  wrap.appendChild(
    checkbox(!!load?.enabled, 'Enable load screen', (checked) => {
      mutate(ctx, () => {
        const current = currentPremiumLoadExperience(ctx.state!);
        ctx.state!.loadExperience = { ...current, enabled: checked };
      });
      ctx.setStatus(checked ? 'Load experience enabled' : 'Load experience disabled', 'ok');
    }),
  );

  const model = load ?? defaultLoadExperience();
  const preset = selectInput(LOAD_EXPERIENCE_PRESETS, model.preset);
  preset.addEventListener('change', () => {
    mutate(ctx, () => {
      const current = currentPremiumLoadExperience(ctx.state!);
      ctx.state!.loadExperience = {
        ...current,
        preset: preset.value as LoadExperiencePreset,
      };
    });
  });
  wrap.appendChild(field('Preset', preset));

  const runPolicy = selectInput(LOAD_EXPERIENCE_RUN_POLICIES, model.runPolicy);
  runPolicy.addEventListener('change', () => {
    mutate(ctx, () => {
      const current = currentPremiumLoadExperience(ctx.state!);
      ctx.state!.loadExperience = {
        ...current,
        runPolicy: runPolicy.value as LoadExperienceRunPolicy,
      };
    });
  });
  wrap.appendChild(field('Run policy', runPolicy));

  const gatesHost = document.createElement('div');
  gatesHost.className = 'opencanvas-interactions-check-list';
  for (const gate of LOAD_EXPERIENCE_GATES) {
    gatesHost.appendChild(
      checkbox(model.gates.includes(gate), gate, (checked) => {
        mutate(ctx, () => {
          const current = currentPremiumLoadExperience(ctx.state!);
          const gateSet = new Set<LoadExperienceGate>(current.gates);
          if (checked) {
            gateSet.add(gate);
          } else {
            gateSet.delete(gate);
          }
          ctx.state!.loadExperience = {
            ...current,
            gates: Array.from(gateSet),
          };
        });
      }),
    );
  }
  wrap.appendChild(field('Gates', gatesHost));

  const timeout = numberInput(model.timeoutMs, 0, 30000, 100);
  timeout.addEventListener('change', () => {
    const next = validNumber(timeout, 0, 30000);
    if (next === null) {
      ctx.setStatus('Load timeout must be 0-30000ms', 'error');
      timeout.value = String(currentPremiumLoadExperience(ctx.state!).timeoutMs);
      return;
    }
    mutate(ctx, () => {
      const current = currentPremiumLoadExperience(ctx.state!);
      ctx.state!.loadExperience = { ...current, timeoutMs: next };
    });
  });
  wrap.appendChild(field('Timeout (ms)', timeout));

  const preview = actionButton('Preview load screen', 'Show the load screen in the editor');
  preview.addEventListener('click', () => ctx.previewLoadExperience());
  wrap.appendChild(preview);

  renderSequenceLiteEditor(ctx, wrap, 'Handoff sequence', 'load-handoff', () => {
    return currentPremiumLoadExperience(ctx.state!).handoffSequence;
  });

  host.appendChild(wrap);
}

function renderBehaviourLoadControls(
  ctx: InteractionsPanelContext,
  wrap: HTMLElement,
  load: BehaviourLoadExperience,
): void {
  const premiumMode = actionButton(
    'Use preset load screen',
    'Switch back to Load Experience v1 presets',
  );
  premiumMode.addEventListener('click', () => {
    mutate(ctx, () => {
      ctx.state!.loadExperience = defaultLoadExperience();
    });
    ctx.setStatus('Preset load screen enabled', 'ok');
  });
  wrap.appendChild(premiumMode);

  const label = textInput(load.label, 'Brand or preloader label');
  label.addEventListener('change', () => updateBehaviourLoadText(ctx, load, 'label', label));
  wrap.appendChild(field('Label', label));

  const enterLabel = textInput(load.enterLabel, 'Enter button label');
  enterLabel.addEventListener('change', () =>
    updateBehaviourLoadText(ctx, load, 'enterLabel', enterLabel),
  );
  wrap.appendChild(field('Enter label', enterLabel));

  const background = textInput(load.background, '#050505');
  background.addEventListener('change', () =>
    updateBehaviourLoadText(ctx, load, 'background', background),
  );
  wrap.appendChild(field('Background', background));

  const foreground = textInput(load.foreground, '#ffffff');
  foreground.addEventListener('change', () =>
    updateBehaviourLoadText(ctx, load, 'foreground', foreground),
  );
  wrap.appendChild(field('Foreground', foreground));

  const sequences = loadEnterSequences(ctx);
  const sequenceIds = sequences.map((sequence) => sequence.id);
  if (sequenceIds.length > 0) {
    const sequence = selectInput(sequenceIds, sequenceIds.includes(load.sequenceId) ? load.sequenceId : sequenceIds[0]!);
    sequence.addEventListener('change', () => {
      mutate(ctx, () => {
        ctx.state!.loadExperience = { ...load, sequenceId: sequence.value };
      });
    });
    wrap.appendChild(field('Enter sequence', sequence));
  }

  if (!sequenceIds.includes(load.sequenceId)) {
    const missing = document.createElement('p');
    missing.className = 'opencanvas-section-picker-empty';
    missing.textContent = 'Linked load-enter Motion Sequence is missing. Validation blocks publish until it is restored.';
    wrap.appendChild(missing);
    const restore = compactButton('Create linked sequence', 'Create the missing load-enter sequence');
    restore.addEventListener('click', () => {
      mutate(ctx, () => ensureLoadEnterSequence(ctx, load.sequenceId));
      ctx.setStatus('Load enter sequence created', 'ok');
    });
    wrap.appendChild(restore);
  }

  const preview = actionButton('Preview enter moment', 'Show the behaviour load experience in the editor');
  preview.addEventListener('click', () => ctx.previewLoadExperience());
  wrap.appendChild(preview);
}

function updateBehaviourLoadText(
  ctx: InteractionsPanelContext,
  load: BehaviourLoadExperience,
  key: 'label' | 'enterLabel' | 'background' | 'foreground',
  input: HTMLInputElement,
): void {
  const value = input.value.trim();
  if (value.length === 0) {
    ctx.setStatus('Load Experience ' + key + ' cannot be empty', 'error');
    input.value = load[key];
    return;
  }
  mutate(ctx, () => {
    ctx.state!.loadExperience = { ...load, [key]: value };
  });
}

function renderRouteControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Route Transition');
  const route = ctx.state.routeTransition;
  const model = route ?? defaultRouteTransition();

  wrap.appendChild(
    checkbox(!!route?.enabled, 'Enable page transitions', (checked) => {
      mutate(ctx, () => {
        const current = ctx.state!.routeTransition ?? defaultRouteTransition();
        ctx.state!.routeTransition = { ...current, enabled: checked };
      });
      ctx.setStatus(checked ? 'Route transition enabled' : 'Route transition disabled', 'ok');
    }),
  );

  const mode = selectInput(ROUTE_TRANSITION_MODES, model.mode);
  mode.addEventListener('change', () => {
    mutate(ctx, () => {
      const current = ctx.state!.routeTransition ?? defaultRouteTransition();
      ctx.state!.routeTransition = { ...current, mode: mode.value as RouteTransitionMode };
    });
  });
  wrap.appendChild(field('Mode', mode));

  const duration = numberInput(model.durationMs, 1, 5000, 10);
  duration.addEventListener('change', () => {
    const next = validNumber(duration, 1, 5000);
    if (next === null) {
      ctx.setStatus('Route duration must be 1-5000ms', 'error');
      duration.value = String((ctx.state?.routeTransition ?? defaultRouteTransition()).durationMs);
      return;
    }
    mutate(ctx, () => {
      const current = ctx.state!.routeTransition ?? defaultRouteTransition();
      ctx.state!.routeTransition = { ...current, durationMs: next };
    });
  });
  wrap.appendChild(field('Duration (ms)', duration));

  const easing = textInput(model.easing, DEFAULT_EASING);
  easing.addEventListener('change', () => {
    const value = easing.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Route easing cannot be empty', 'error');
      easing.value = (ctx.state?.routeTransition ?? defaultRouteTransition()).easing;
      return;
    }
    mutate(ctx, () => {
      const current = ctx.state!.routeTransition ?? defaultRouteTransition();
      ctx.state!.routeTransition = { ...current, easing: value };
    });
  });
  wrap.appendChild(field('Easing', easing));

  const preview = actionButton('Preview route transition', 'Run the route transition state in the editor');
  preview.addEventListener('click', () => ctx.previewRouteTransition());
  wrap.appendChild(preview);
  renderSharedRouteElements(ctx, wrap, model);

  renderSequenceLiteEditor(ctx, wrap, 'Outgoing sequence', 'route-outgoing', () => {
    return (ctx.state?.routeTransition ?? defaultRouteTransition()).outgoingSequence;
  });
  renderSequenceLiteEditor(ctx, wrap, 'Incoming sequence', 'route-incoming', () => {
    return (ctx.state?.routeTransition ?? defaultRouteTransition()).incomingSequence;
  });

  host.appendChild(wrap);
}

function renderSharedRouteElements(
  ctx: InteractionsPanelContext,
  wrap: HTMLElement,
  route: RouteTransition,
): void {
  const heading = document.createElement('h4');
  heading.textContent = 'Shared elements';
  wrap.appendChild(heading);
  const add = compactButton('Add shared element', 'Map an outgoing element to an incoming element');
  add.addEventListener('click', () => {
    if (!ctx.selectedElementId) {
      ctx.setStatus('Select an element before adding a shared route mapping.', 'error');
      return;
    }
    const selectedElementId = ctx.selectedElementId;
    mutate(ctx, () => {
      const current = ctx.state!.routeTransition ?? defaultRouteTransition();
      const next = [...(current.sharedElements ?? [])];
      const index = next.length + 1;
      next.push({
        id: 'shared-route-' + String(Date.now()),
        sourceElementId: selectedElementId,
        targetElementId: selectedElementId,
        viewTransitionName: 'sharedRoute' + String(index),
      });
      ctx.state!.routeTransition = { ...current, sharedElements: next };
    });
  });
  wrap.appendChild(add);
  for (const mapping of route.sharedElements ?? []) {
    renderSharedRouteElement(ctx, wrap, route, mapping);
  }
}

function renderSharedRouteElement(
  ctx: InteractionsPanelContext,
  wrap: HTMLElement,
  route: RouteTransition,
  mapping: SharedRouteElement,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-step';
  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = mapping.id;
  header.appendChild(title);
  const remove = compactButton('Remove', 'Remove this shared element mapping');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      const current = ctx.state!.routeTransition ?? defaultRouteTransition();
      ctx.state!.routeTransition = {
        ...current,
        sharedElements: (current.sharedElements ?? []).filter((item) => item.id !== mapping.id),
      };
    });
  });
  header.appendChild(remove);
  card.appendChild(header);

  const source = textInput(mapping.sourceElementId, 'Outgoing element id');
  source.addEventListener('change', () =>
    updateSharedRouteElement(ctx, mapping.id, { sourceElementId: source.value.trim() }),
  );
  card.appendChild(field('Outgoing element', source));

  const target = textInput(mapping.targetElementId, 'Incoming element id');
  target.addEventListener('change', () =>
    updateSharedRouteElement(ctx, mapping.id, { targetElementId: target.value.trim() }),
  );
  card.appendChild(field('Incoming element', target));

  const name = textInput(mapping.viewTransitionName, 'sharedName');
  name.addEventListener('change', () =>
    updateSharedRouteElement(ctx, mapping.id, { viewTransitionName: name.value.trim() }),
  );
  card.appendChild(field('View transition name', name));
  void route;
  wrap.appendChild(card);
}

function updateSharedRouteElement(
  ctx: InteractionsPanelContext,
  mappingId: string,
  patch: Partial<SharedRouteElement>,
): void {
  if (Object.values(patch).some((value) => typeof value === 'string' && value.length === 0)) {
    ctx.setStatus('Shared route element fields cannot be empty', 'error');
    renderInteractionsPanel(ctx);
    return;
  }
  mutate(ctx, () => {
    const current = ctx.state!.routeTransition ?? defaultRouteTransition();
    ctx.state!.routeTransition = {
      ...current,
      sharedElements: (current.sharedElements ?? []).map((mapping) =>
        mapping.id === mappingId ? { ...mapping, ...patch } : mapping,
      ),
    };
  });
}

function renderOverlayControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Overlays');
  const overlays = ctx.state.overlays ?? [];

  const add = actionButton('Add overlay', 'Create a first-class overlay for this site');
  add.addEventListener('click', () => {
    const pageId = activePageId(ctx);
    if (!pageId) {
      ctx.setStatus('Add a page before creating an overlay', 'error');
      return;
    }
    mutate(ctx, () => {
      const next = [...(ctx.state!.overlays ?? [])];
      const index = next.length + 1;
      next.push(defaultOverlay('overlay-' + Date.now(), 'Overlay ' + index, pageId));
      ctx.state!.overlays = next;
    });
    ctx.setStatus('Overlay added', 'ok');
  });
  wrap.appendChild(add);

  if (overlays.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No overlays yet.';
    wrap.appendChild(empty);
  }

  for (let i = 0; i < overlays.length; i++) {
    renderOverlayCard(ctx, wrap, overlays[i]!, i);
  }

  host.appendChild(wrap);
}

function renderOverlayCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  overlay: Overlay,
  index: number,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card';

  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = overlay.name || 'Overlay';
  header.appendChild(title);
  const preview = compactButton('Preview', 'Open this overlay in the editor');
  preview.addEventListener('click', () => ctx.previewOverlay(overlay.id));
  header.appendChild(preview);
  const remove = compactButton('Delete', 'Delete this overlay');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      const current = ctx.state!.overlays ?? [];
      ctx.state!.overlays = current.filter((item) => item.id !== overlay.id);
    });
    ctx.setStatus('Overlay deleted', 'ok');
  });
  header.appendChild(remove);
  card.appendChild(header);

  const name = textInput(overlay.name, 'Overlay name');
  name.addEventListener('change', () => {
    const value = name.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Overlay name cannot be empty', 'error');
      name.value = overlay.name;
      return;
    }
    mutate(ctx, () => {
      ctx.state!.overlays![index] = { ...overlay, name: value };
    });
  });
  card.appendChild(field('Name', name));

  const scopeValue = overlay.scope.type === 'site' ? 'site' : 'current-page';
  const scope = selectInput(['site', 'current-page'], scopeValue);
  scope.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = { ...overlay, scope: nextOverlayScope(ctx, scope.value) };
    });
  });
  card.appendChild(field('Scope', scope));

  const triggerType = selectInput(OVERLAY_TRIGGER_TYPES, overlay.trigger.type);
  triggerType.addEventListener('change', () => {
    if (triggerType.value === 'element-click' && !ctx.selectedElementId) {
      ctx.setStatus('Select an element before choosing element-click trigger', 'error');
      triggerType.value = overlay.trigger.type;
      return;
    }
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        trigger: defaultTrigger(triggerType.value as OverlayTriggerType, ctx.selectedElementId),
      };
    });
  });
  card.appendChild(field('Trigger', triggerType));
  renderTriggerDetail(ctx, card, overlay, index);

  const dismissalHost = document.createElement('div');
  dismissalHost.className = 'opencanvas-interactions-check-list';
  for (const key of Object.keys(overlay.dismissal) as Array<keyof OverlayDismissal>) {
    dismissalHost.appendChild(
      checkbox(overlay.dismissal[key], dismissalLabel(key), (checked) => {
        mutate(ctx, () => {
          ctx.state!.overlays![index] = {
            ...overlay,
            dismissal: { ...overlay.dismissal, [key]: checked },
          };
        });
      }),
    );
  }
  card.appendChild(field('Dismissal', dismissalHost));

  const selectedTrigger = compactButton('Use selected element', 'Use the selected element as this overlay trigger');
  selectedTrigger.disabled = !ctx.selectedElementId;
  selectedTrigger.addEventListener('click', () => ctx.useSelectedElementAsOverlayTrigger(overlay.id));
  card.appendChild(selectedTrigger);

  renderSequenceLiteEditor(ctx, card, 'Open sequence', 'overlay-open', () => overlay.openSequence, overlay.id);
  renderSequenceLiteEditor(ctx, card, 'Close sequence', 'overlay-close', () => overlay.closeSequence, overlay.id);

  host.appendChild(card);
}

function dismissalLabel(key: keyof OverlayDismissal): string {
  if (key === 'closeButton') return 'Close button';
  if (key === 'backdropClick') return 'Backdrop click';
  if (key === 'bodyScrollLock') return 'Body scroll lock';
  if (key === 'focusTrap') return 'Focus trap';
  if (key === 'returnFocus') return 'Return focus';
  return 'Escape';
}

function nextOverlayScope(ctx: InteractionsPanelContext, value: string): OverlayScope {
  if (value === 'site') return { type: 'site' };
  const pageId = activePageId(ctx);
  if (!pageId) return { type: 'pages', pageIds: [] };
  return { type: 'pages', pageIds: [pageId] };
}

function defaultTrigger(type: OverlayTriggerType, selectedElementId: string | null): InteractionTrigger {
  if (type === 'delay') return { type: 'delay', value: 3000 };
  if (type === 'scroll') return { type: 'scroll', value: 50 };
  if (type === 'element-click') {
    return { type: 'element-click', targetElementId: selectedElementId || '' };
  }
  if (type === 'exit-intent') return { type: 'exit-intent' };
  return { type: 'load' };
}

function renderTriggerDetail(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  overlay: Overlay,
  index: number,
): void {
  const trigger = overlay.trigger;
  if (trigger.type === 'delay' || trigger.type === 'scroll') {
    const value = numberInput(trigger.value, 0, trigger.type === 'delay' ? 60000 : 100, 100);
    value.addEventListener('change', () => {
      const next = validNumber(value, 0, trigger.type === 'delay' ? 60000 : 100);
      if (next === null) {
        ctx.setStatus(
          trigger.type === 'delay'
            ? 'Overlay delay must be 0-60000ms'
            : 'Overlay scroll trigger must be 0-100%',
          'error',
        );
        value.value = String(trigger.value);
        return;
      }
      mutate(ctx, () => {
        ctx.state!.overlays![index] = {
          ...overlay,
          trigger: { type: trigger.type, value: next },
        };
      });
    });
    card.appendChild(field(trigger.type === 'delay' ? 'Delay (ms)' : 'Scroll %', value));
    return;
  }

  if (trigger.type === 'element-click') {
    const target = textInput(trigger.targetElementId, 'Element id');
    target.addEventListener('change', () => {
      const value = target.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Element-click overlay trigger needs an element id', 'error');
        target.value = trigger.targetElementId;
        return;
      }
      mutate(ctx, () => {
        ctx.state!.overlays![index] = {
          ...overlay,
          trigger: { type: 'element-click', targetElementId: value },
        };
      });
    });
    card.appendChild(field('Target element', target));
  }
}

function renderSequenceLiteEditor(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  label: string,
  slot: SequenceSlot,
  getSequence: () => MotionSequenceLite | undefined,
  overlayId?: string,
): void {
  const details = document.createElement('details');
  details.className = 'opencanvas-interactions-sequence';
  const summary = document.createElement('summary');
  const sequence = getSequence();
  summary.textContent = label + ' (' + String(sequence?.steps.length ?? 0) + ')';
  details.appendChild(summary);

  const toolbar = row('opencanvas-interactions-sequence-toolbar');
  const add = compactButton('Add step', 'Add a Motion Sequence Lite step');
  add.addEventListener('click', () => {
    mutate(ctx, () => {
      const current = sequenceForSlot(ctx, slot, overlayId);
      const next = current ?? defaultSequence(sequenceIdForSlot(slot, overlayId));
      next.steps.push(defaultSequenceStep(next.steps.length, defaultTargetForSlot(slot)));
      setSequenceForSlot(ctx, slot, next, overlayId);
    });
  });
  toolbar.appendChild(add);

  if (sequence) {
    const clear = compactButton('Clear', 'Remove every step in this sequence');
    clear.addEventListener('click', () => {
      mutate(ctx, () => {
        setSequenceForSlot(ctx, slot, undefined, overlayId);
      });
    });
    toolbar.appendChild(clear);
  }
  details.appendChild(toolbar);

  if (!sequence || sequence.steps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No steps.';
    details.appendChild(empty);
    host.appendChild(details);
    return;
  }

  for (let i = 0; i < sequence.steps.length; i++) {
    renderSequenceStep(ctx, details, slot, sequence.steps[i]!, i, overlayId);
  }

  host.appendChild(details);
}

function renderSequenceStep(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  slot: SequenceSlot,
  step: MotionSequenceLiteStep,
  index: number,
  overlayId?: string,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-step';

  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = 'Step ' + String(index + 1);
  header.appendChild(title);
  const remove = compactButton('Remove', 'Remove this motion step');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      const sequence = sequenceForSlot(ctx, slot, overlayId);
      if (!sequence) return;
      sequence.steps = sequence.steps.filter((candidate) => candidate.id !== step.id);
      setSequenceForSlot(ctx, slot, sequence.steps.length > 0 ? sequence : undefined, overlayId);
    });
  });
  header.appendChild(remove);
  card.appendChild(header);

  const target = selectInput(MOTION_SEQUENCE_LITE_TARGET_TYPES, step.target.type);
  target.addEventListener('change', () => {
    mutate(ctx, () => {
      updateStep(ctx, slot, step.id, overlayId, {
        target: targetForType(target.value as MotionSequenceLiteTargetType, step.target),
      });
    });
  });
  card.appendChild(field('Target', target));

  if (step.target.type === 'load-screen-part') {
    const part = selectInput(['shell', 'brand', 'progress'], step.target.part);
    part.addEventListener('change', () => {
      mutate(ctx, () => {
        updateStep(ctx, slot, step.id, overlayId, {
          target: { type: 'load-screen-part', part: part.value as 'shell' | 'brand' | 'progress' },
        });
      });
    });
    card.appendChild(field('Part', part));
  }

  const effect = selectInput(MOTION_SEQUENCE_LITE_EFFECTS, step.effect);
  effect.addEventListener('change', () => {
    mutate(ctx, () => {
      updateStep(ctx, slot, step.id, overlayId, {
        effect: effect.value as MotionSequenceLiteEffect,
      });
    });
  });
  card.appendChild(field('Effect', effect));

  const delay = numberInput(step.delayMs, 0, 10000, 10);
  delay.addEventListener('change', () => updateStepNumber(ctx, slot, step, overlayId, 'delayMs', delay, 0, 10000));
  card.appendChild(field('Delay (ms)', delay));

  const duration = numberInput(step.durationMs, 1, 10000, 10);
  duration.addEventListener('change', () =>
    updateStepNumber(ctx, slot, step, overlayId, 'durationMs', duration, 1, 10000),
  );
  card.appendChild(field('Duration (ms)', duration));

  const easing = textInput(step.easing, DEFAULT_EASING);
  easing.addEventListener('change', () => {
    const value = easing.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Motion easing cannot be empty', 'error');
      easing.value = step.easing;
      return;
    }
    mutate(ctx, () => {
      updateStep(ctx, slot, step.id, overlayId, { easing: value });
    });
  });
  card.appendChild(field('Easing', easing));

  host.appendChild(card);
}

function updateStepNumber(
  ctx: InteractionsPanelContext,
  slot: SequenceSlot,
  step: MotionSequenceLiteStep,
  overlayId: string | undefined,
  key: 'delayMs' | 'durationMs',
  input: HTMLInputElement,
  min: number,
  max: number,
): void {
  const next = validNumber(input, min, max);
  if (next === null) {
    ctx.setStatus('Motion ' + key + ' must be ' + String(min) + '-' + String(max), 'error');
    input.value = String(step[key]);
    return;
  }
  mutate(ctx, () => {
    updateStep(ctx, slot, step.id, overlayId, { [key]: next });
  });
}

function defaultSequence(id: string): MotionSequenceLite {
  return { id, steps: [] };
}

function defaultSequenceStep(index: number, target: MotionSequenceLiteTarget): MotionSequenceLiteStep {
  return {
    id: 'step-' + String(Date.now()) + '-' + String(index + 1),
    target,
    effect: 'fade',
    delayMs: 0,
    durationMs: 220,
    easing: DEFAULT_EASING,
  };
}

function sequenceIdForSlot(slot: SequenceSlot, overlayId?: string): string {
  if (slot === 'load-handoff') return 'seq-load-handoff';
  if (slot === 'route-outgoing') return 'seq-route-outgoing';
  if (slot === 'route-incoming') return 'seq-route-incoming';
  return 'seq-' + String(overlayId || 'overlay') + '-' + (slot === 'overlay-open' ? 'open' : 'close');
}

function defaultTargetForSlot(slot: SequenceSlot): MotionSequenceLiteTarget {
  if (slot === 'load-handoff') return { type: 'load-screen-part', part: 'shell' };
  if (slot === 'route-outgoing' || slot === 'route-incoming') return { type: 'page-container' };
  return { type: 'overlay-surface' };
}

function targetForType(
  type: MotionSequenceLiteTargetType,
  previous: MotionSequenceLiteTarget,
): MotionSequenceLiteTarget {
  if (type === 'load-screen-part') {
    return {
      type: 'load-screen-part',
      part: previous.type === 'load-screen-part' ? previous.part : 'shell',
    };
  }
  return { type };
}

function sequenceForSlot(
  ctx: InteractionsPanelContext,
  slot: SequenceSlot,
  overlayId?: string,
): MotionSequenceLite | undefined {
  if (!ctx.state) return undefined;
  if (slot === 'load-handoff') {
    const load = ctx.state.loadExperience;
    return isPremiumLoadExperience(load) ? load.handoffSequence : undefined;
  }
  if (slot === 'route-outgoing') return ctx.state.routeTransition?.outgoingSequence;
  if (slot === 'route-incoming') return ctx.state.routeTransition?.incomingSequence;
  const overlay = (ctx.state.overlays ?? []).find((item) => item.id === overlayId);
  return slot === 'overlay-open' ? overlay?.openSequence : overlay?.closeSequence;
}

function setSequenceForSlot(
  ctx: InteractionsPanelContext,
  slot: SequenceSlot,
  sequence: MotionSequenceLite | undefined,
  overlayId?: string,
): void {
  if (!ctx.state) return;
  if (slot === 'load-handoff') {
    const current = currentPremiumLoadExperience(ctx.state);
    const next: PremiumLoadExperience = { ...current };
    if (sequence === undefined) {
      delete next.handoffSequence;
    } else {
      next.handoffSequence = sequence;
    }
    ctx.state.loadExperience = next;
    return;
  }
  if (slot === 'route-outgoing' || slot === 'route-incoming') {
    const current = ctx.state.routeTransition ?? defaultRouteTransition();
    const next: RouteTransition = { ...current };
    if (slot === 'route-outgoing') {
      if (sequence === undefined) {
        delete next.outgoingSequence;
      } else {
        next.outgoingSequence = sequence;
      }
    } else {
      if (sequence === undefined) {
        delete next.incomingSequence;
      } else {
        next.incomingSequence = sequence;
      }
    }
    ctx.state.routeTransition = next;
    return;
  }
  const overlays = ctx.state.overlays ?? [];
  const overlay = overlays.find((item) => item.id === overlayId);
  if (!overlay) return;
  if (slot === 'overlay-open') {
    if (sequence === undefined) {
      delete overlay.openSequence;
    } else {
      overlay.openSequence = sequence;
    }
  } else {
    if (sequence === undefined) {
      delete overlay.closeSequence;
    } else {
      overlay.closeSequence = sequence;
    }
  }
}

function updateStep(
  ctx: InteractionsPanelContext,
  slot: SequenceSlot,
  stepId: string,
  overlayId: string | undefined,
  patch: Partial<Omit<MotionSequenceLiteStep, 'id'>>,
): void {
  const sequence = sequenceForSlot(ctx, slot, overlayId);
  if (!sequence) return;
  sequence.steps = sequence.steps.map((step) => {
    if (step.id !== stepId) return step;
    return { ...step, ...patch };
  });
  setSequenceForSlot(ctx, slot, sequence, overlayId);
}
