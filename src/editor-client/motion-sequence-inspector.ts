import type {
  InteractionTrigger,
  MotionProperties,
  MotionSequence,
} from '../canvas/interactions.js';
import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import { field, selectInput } from './dom-builders.js';
import type { EditorContext } from './editor-context.js';
import { uuid } from './ids.js';

type ElementMotionTriggerType = 'load' | 'viewport-enter' | 'click' | 'hover';
type ElementMotionPreset = 'fade-up' | 'fade-in' | 'scale-in' | 'slide-left' | 'blur-in';
type ElementMotionEasing = 'out-cubic' | 'in-cubic' | 'in-out-cubic' | 'linear' | 'ease';

interface ElementMotionConfig {
  triggerType: ElementMotionTriggerType;
  preset: ElementMotionPreset;
  durationMs: number;
  delayMs: number;
  easing: ElementMotionEasing;
}

type MotionSequenceInspectorContext = Pick<
  EditorContext,
  | 'state'
  | 'inspector'
  | 'captureForUndo'
  | 'rebuildElement'
  | 'scheduleSave'
  | 'renderInspector'
  | 'setStatus'
>;

const TRIGGER_OPTIONS: ElementMotionTriggerType[] = ['load', 'viewport-enter', 'click', 'hover'];
const PRESET_OPTIONS: ElementMotionPreset[] = [
  'fade-up',
  'fade-in',
  'scale-in',
  'slide-left',
  'blur-in',
];
const EASING_OPTIONS: ElementMotionEasing[] = [
  'out-cubic',
  'in-cubic',
  'in-out-cubic',
  'linear',
  'ease',
];

export function appendMotionSequenceInspector(
  ctx: MotionSequenceInspectorContext,
  element: CanvasElement,
): void {
  if (!ctx.inspector) return;
  const state = requireState(ctx);
  const sequence = findMotionSequenceForElement(state, element);

  const heading = document.createElement('h3');
  heading.textContent = 'Designer motion';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  const triggerSelect = selectInput(['none', ...TRIGGER_OPTIONS], sequence?.trigger.type ?? 'none');
  triggerSelect.addEventListener('change', () => {
    if (triggerSelect.value === 'none') {
      removeMotionSequenceFromElement(ctx, element);
      ctx.renderInspector();
      return;
    }
    const nextConfig = configFromSequence(sequence);
    nextConfig.triggerType = triggerSelect.value as ElementMotionTriggerType;
    upsertMotionSequenceForElement(ctx, element, nextConfig);
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Sequence trigger', triggerSelect));

  if (sequence === undefined) return;

  const config = configFromSequence(sequence);
  const detectedPreset = detectMotionPreset(sequence.steps[0]?.properties);
  const presetSelect = selectInput([...PRESET_OPTIONS, 'custom'], detectedPreset ?? 'custom');
  presetSelect.addEventListener('change', () => {
    if (presetSelect.value === 'custom') {
      ctx.setStatus('Custom designer motion is preserved but not editable here', 'info');
      return;
    }
    upsertMotionSequenceForElement(ctx, element, {
      ...config,
      preset: presetSelect.value as ElementMotionPreset,
    });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Sequence preset', presetSelect));

  const duration = document.createElement('input');
  duration.type = 'number';
  duration.min = '0';
  duration.max = '5000';
  duration.step = '10';
  duration.value = String(config.durationMs);
  duration.addEventListener('change', () => {
    const next = readNonNegativeNumber(duration.value, 'Duration');
    if (next === null) {
      duration.value = String(config.durationMs);
      ctx.setStatus('Duration must be a non-negative number', 'error');
      return;
    }
    upsertMotionSequenceForElement(ctx, element, { ...config, durationMs: next });
  });
  ctx.inspector.appendChild(field('Duration (ms)', duration));

  const delay = document.createElement('input');
  delay.type = 'number';
  delay.min = '0';
  delay.max = '5000';
  delay.step = '10';
  delay.value = String(config.delayMs);
  delay.addEventListener('change', () => {
    const next = readNonNegativeNumber(delay.value, 'Delay');
    if (next === null) {
      delay.value = String(config.delayMs);
      ctx.setStatus('Delay must be a non-negative number', 'error');
      return;
    }
    upsertMotionSequenceForElement(ctx, element, { ...config, delayMs: next });
  });
  ctx.inspector.appendChild(field('Delay (ms)', delay));

  const easing = selectInput(EASING_OPTIONS, config.easing);
  easing.addEventListener('change', () => {
    upsertMotionSequenceForElement(ctx, element, {
      ...config,
      easing: easing.value as ElementMotionEasing,
    });
  });
  ctx.inspector.appendChild(field('Easing', easing));

  const removeRow = document.createElement('div');
  removeRow.className = 'style-row';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'style-btn-clear';
  remove.textContent = 'Remove sequence';
  remove.addEventListener('click', () => {
    removeMotionSequenceFromElement(ctx, element);
    ctx.renderInspector();
  });
  removeRow.appendChild(remove);
  ctx.inspector.appendChild(field('Remove', removeRow));
}

export function findMotionSequenceForElement(
  state: EditableSite,
  element: CanvasElement,
): MotionSequence | undefined {
  return (state.motionSequences ?? []).find((sequence) =>
    sequence.steps.some(
      (step) => step.target.type === 'element' && step.target.elementId === element.id,
    ),
  );
}

export function upsertMotionSequenceForElement(
  ctx: Pick<
    MotionSequenceInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
  config: ElementMotionConfig,
): MotionSequence {
  validateElementId(element);
  validateConfig(config);
  const state = requireState(ctx);
  ctx.captureForUndo();

  let sequence = findMotionSequenceForElement(state, element);
  if (sequence === undefined) {
    sequence = createMotionSequenceForElement(state, element);
    if (state.motionSequences === undefined) state.motionSequences = [];
    state.motionSequences.push(sequence);
  }

  sequence.trigger = triggerForElement(config.triggerType, element.id);
  sequence.steps = [
    {
      id: sequence.id + '-step-1',
      target: { type: 'element', elementId: element.id },
      properties: propertiesForPreset(config.preset),
      durationMs: config.durationMs,
      easing: config.easing,
      ...(config.delayMs > 0 ? { delayMs: config.delayMs } : {}),
    },
  ];
  commitElementMotionChange(ctx, element);
  return sequence;
}

export function removeMotionSequenceFromElement(
  ctx: Pick<
    MotionSequenceInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
): void {
  const state = requireState(ctx);
  const sequence = findMotionSequenceForElement(state, element);
  if (sequence === undefined) return;

  ctx.captureForUndo();
  const next = (state.motionSequences ?? []).filter((candidate) => candidate.id !== sequence.id);
  if (next.length === 0) delete state.motionSequences;
  else state.motionSequences = next;
  commitElementMotionChange(ctx, element);
}

function requireState(ctx: Pick<MotionSequenceInspectorContext, 'state'>): EditableSite {
  if (ctx.state === null) {
    throw new Error('motion sequence inspector requires a loaded editor state');
  }
  return ctx.state;
}

function validateElementId(element: CanvasElement): void {
  if (element.id.trim().length === 0) {
    throw new Error('upsertMotionSequenceForElement: element id must be non-empty');
  }
}

function validateConfig(config: ElementMotionConfig): void {
  if (!TRIGGER_OPTIONS.includes(config.triggerType)) {
    throw new Error('upsertMotionSequenceForElement: unsupported trigger ' + config.triggerType);
  }
  if (!PRESET_OPTIONS.includes(config.preset)) {
    throw new Error('upsertMotionSequenceForElement: unsupported preset ' + config.preset);
  }
  if (!Number.isFinite(config.durationMs) || config.durationMs < 0) {
    throw new Error('upsertMotionSequenceForElement: durationMs must be non-negative');
  }
  if (!Number.isFinite(config.delayMs) || config.delayMs < 0) {
    throw new Error('upsertMotionSequenceForElement: delayMs must be non-negative');
  }
  if (!EASING_OPTIONS.includes(config.easing)) {
    throw new Error('upsertMotionSequenceForElement: unsupported easing ' + config.easing);
  }
}

function createMotionSequenceForElement(
  state: EditableSite,
  element: CanvasElement,
): MotionSequence {
  const id = nextMotionSequenceId(state);
  return {
    id,
    trigger: { type: 'load' },
    steps: [
      {
        id: id + '-step-1',
        target: { type: 'element', elementId: element.id },
        properties: propertiesForPreset('fade-up'),
        durationMs: 500,
        easing: 'out-cubic',
      },
    ],
  };
}

function nextMotionSequenceId(state: EditableSite): string {
  const existing = new Set((state.motionSequences ?? []).map((sequence) => sequence.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = 'motion-' + uuid();
    if (!existing.has(id)) return id;
  }
  throw new Error('nextMotionSequenceId: failed to generate a unique id after 20 attempts');
}

function triggerForElement(
  triggerType: ElementMotionTriggerType,
  elementId: string,
): InteractionTrigger {
  if (triggerType === 'load') return { type: 'load' };
  if (triggerType === 'viewport-enter') return { type: 'viewport-enter', elementId };
  if (triggerType === 'click') return { type: 'click', elementId };
  return { type: 'hover', elementId };
}

function propertiesForPreset(preset: ElementMotionPreset): MotionProperties {
  if (preset === 'fade-up') return { opacity: [0, 1], y: [24, 0] };
  if (preset === 'fade-in') return { opacity: [0, 1] };
  if (preset === 'scale-in') return { opacity: [0, 1], scale: [0.96, 1] };
  if (preset === 'slide-left') return { opacity: [0, 1], x: [32, 0] };
  return { opacity: [0, 1], blur: [12, 0] };
}

function configFromSequence(sequence: MotionSequence | undefined): ElementMotionConfig {
  if (sequence === undefined) {
    return {
      triggerType: 'viewport-enter',
      preset: 'fade-up',
      durationMs: 500,
      delayMs: 0,
      easing: 'out-cubic',
    };
  }
  const step = sequence.steps[0];
  return {
    triggerType: editableTriggerType(sequence.trigger),
    preset: detectMotionPreset(step?.properties) ?? 'fade-up',
    durationMs: step?.durationMs ?? 500,
    delayMs: step?.delayMs ?? 0,
    easing: editableEasing(step?.easing),
  };
}

function editableTriggerType(trigger: InteractionTrigger): ElementMotionTriggerType {
  if (trigger.type === 'load') return 'load';
  if (trigger.type === 'viewport-enter') return 'viewport-enter';
  if (trigger.type === 'click') return 'click';
  if (trigger.type === 'hover') return 'hover';
  return 'viewport-enter';
}

function editableEasing(easing: string | undefined): ElementMotionEasing {
  if (easing !== undefined && EASING_OPTIONS.includes(easing as ElementMotionEasing)) {
    return easing as ElementMotionEasing;
  }
  return 'out-cubic';
}

function detectMotionPreset(properties: MotionProperties | undefined): ElementMotionPreset | null {
  if (properties === undefined) return null;
  for (const preset of PRESET_OPTIONS) {
    if (sameMotionProperties(properties, propertiesForPreset(preset))) return preset;
  }
  return null;
}

function sameMotionProperties(left: MotionProperties, right: MotionProperties): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  for (let i = 0; i < leftKeys.length; i++) {
    const key = leftKeys[i];
    if (key === undefined || key !== rightKeys[i]) return false;
    const leftRange = left[key as keyof MotionProperties];
    const rightRange = right[key as keyof MotionProperties];
    if (
      leftRange === undefined ||
      rightRange === undefined ||
      leftRange[0] !== rightRange[0] ||
      leftRange[1] !== rightRange[1]
    ) {
      return false;
    }
  }
  return true;
}

function readNonNegativeNumber(value: string, label: string): number | null {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return null;
  if (label.length === 0) throw new Error('readNonNegativeNumber requires a label');
  return next;
}

function commitElementMotionChange(
  ctx: Pick<MotionSequenceInspectorContext, 'rebuildElement' | 'scheduleSave'>,
  element: CanvasElement,
): void {
  ctx.rebuildElement(element.id);
  ctx.scheduleSave();
}
