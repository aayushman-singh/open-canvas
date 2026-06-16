export const INTERACTION_TRIGGER_TYPES = [
  'load',
  'viewport-enter',
  'scroll-progress',
  'hover',
  'pointer-move',
  'click',
  'route-navigation',
  'media-ready',
] as const;

export type InteractionTriggerType = (typeof INTERACTION_TRIGGER_TYPES)[number];

export type InteractionTrigger =
  | { type: 'load' }
  | { type: 'viewport-enter'; sectionId?: string; elementId?: string }
  | { type: 'scroll-progress'; sectionId?: string; elementId?: string }
  | { type: 'hover'; elementId: string }
  | { type: 'pointer-move'; elementId?: string }
  | { type: 'click'; elementId: string }
  | { type: 'route-navigation'; fromPageId?: string; toPageId?: string }
  | { type: 'media-ready'; assetId: string };

export const INTERACTION_TARGET_TYPES = [
  'page',
  'section',
  'element',
  'component-part',
  'text-split',
  'overlay',
] as const;

export type InteractionTargetType = (typeof INTERACTION_TARGET_TYPES)[number];
export type TextSplitMode = 'character' | 'word' | 'line';

export type InteractionTarget =
  | { type: 'page'; pageId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'element'; elementId: string }
  | { type: 'component-part'; elementId: string; part: string }
  | { type: 'text-split'; elementId: string; split: TextSplitMode }
  | { type: 'overlay'; overlayId: string };

export const MOTION_PROPERTY_NAMES = [
  'opacity',
  'x',
  'y',
  'scale',
  'scaleX',
  'scaleY',
  'rotate',
  'blur',
  'clipPath',
  'filter',
  'backgroundColor',
  'color',
  'strokeDashoffset',
] as const;

export type MotionPropertyName = (typeof MOTION_PROPERTY_NAMES)[number];
export type MotionPropertyValue = number | string;
export type MotionPropertyRange = [MotionPropertyValue, MotionPropertyValue];
export type MotionProperties = Partial<Record<MotionPropertyName, MotionPropertyRange>>;

export interface MotionStep {
  id: string;
  target: InteractionTarget;
  properties: MotionProperties;
  durationMs: number;
  easing?: string;
  delayMs?: number;
  staggerMs?: number;
}

export interface MotionSequence {
  id: string;
  trigger: InteractionTrigger;
  steps: MotionStep[];
}

export interface ScrollScene {
  id: string;
  trigger: Extract<InteractionTrigger, { type: 'scroll-progress' }>;
  start: string;
  end: string;
  axis: 'x' | 'y';
  scrub: boolean;
  pin?: boolean;
  sequence: MotionSequence;
  snapPoints?: number[];
}

const INTERACTION_TRIGGER_TYPE_SET = new Set<string>(INTERACTION_TRIGGER_TYPES);
const INTERACTION_TARGET_TYPE_SET = new Set<string>(INTERACTION_TARGET_TYPES);
const MOTION_PROPERTY_NAME_SET = new Set<string>(MOTION_PROPERTY_NAMES);
const TEXT_SPLIT_SET = new Set<string>(['character', 'word', 'line']);

function fail(message: string): never {
  throw new Error(`[interactions] ${message}`);
}

function requireObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function requireNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function requireFiniteNonNegativeNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} must be a finite non-negative number`);
  }
}

function isMotionPropertyValue(value: unknown): value is MotionPropertyValue {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

function validateOptionalId(value: unknown, label: string): void {
  if (value !== undefined) requireNonEmptyString(value, label);
}

export function validateInteractionTrigger(trigger: InteractionTrigger, label = 'trigger'): void {
  requireObject(trigger, label);
  requireNonEmptyString(trigger.type, `${label}.type`);
  if (!INTERACTION_TRIGGER_TYPE_SET.has(trigger.type)) {
    fail(`${label}.type must be one of ${INTERACTION_TRIGGER_TYPES.join(', ')}`);
  }

  switch (trigger.type) {
    case 'load':
      return;
    case 'viewport-enter':
    case 'scroll-progress':
      validateOptionalId(trigger.sectionId, `${label}.sectionId`);
      validateOptionalId(trigger.elementId, `${label}.elementId`);
      return;
    case 'hover':
    case 'click':
      requireNonEmptyString(trigger.elementId, `${label}.elementId`);
      return;
    case 'pointer-move':
      validateOptionalId(trigger.elementId, `${label}.elementId`);
      return;
    case 'route-navigation':
      validateOptionalId(trigger.fromPageId, `${label}.fromPageId`);
      validateOptionalId(trigger.toPageId, `${label}.toPageId`);
      return;
    case 'media-ready':
      requireNonEmptyString(trigger.assetId, `${label}.assetId`);
      return;
  }
}

function validateTarget(target: InteractionTarget, label: string): void {
  requireObject(target, label);
  requireNonEmptyString(target.type, `${label}.type`);
  if (!INTERACTION_TARGET_TYPE_SET.has(target.type)) {
    fail(`${label}.type must be one of ${INTERACTION_TARGET_TYPES.join(', ')}`);
  }

  switch (target.type) {
    case 'page':
      requireNonEmptyString(target.pageId, `${label}.pageId`);
      return;
    case 'section':
      requireNonEmptyString(target.sectionId, `${label}.sectionId`);
      return;
    case 'element':
      requireNonEmptyString(target.elementId, `${label}.elementId`);
      return;
    case 'component-part':
      requireNonEmptyString(target.elementId, `${label}.elementId`);
      requireNonEmptyString(target.part, `${label}.part`);
      return;
    case 'text-split':
      requireNonEmptyString(target.elementId, `${label}.elementId`);
      requireNonEmptyString(target.split, `${label}.split`);
      if (!TEXT_SPLIT_SET.has(target.split)) {
        fail(`${label}.split must be character, word, or line`);
      }
      return;
    case 'overlay':
      requireNonEmptyString(target.overlayId, `${label}.overlayId`);
      return;
  }
}

function validateProperties(properties: MotionProperties, label: string): void {
  requireObject(properties, label);

  const keys = Object.keys(properties);
  if (keys.length === 0) {
    fail(`${label} must contain at least one property`);
  }

  for (const key of keys) {
    if (!MOTION_PROPERTY_NAME_SET.has(key)) {
      fail(`${label} contains unknown properties key "${key}"`);
    }

    const range = properties[key as MotionPropertyName];
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !isMotionPropertyValue(range[0]) ||
      !isMotionPropertyValue(range[1])
    ) {
      fail(`${label}.${key} must be a 2-item properties range`);
    }
  }
}

function validateMotionStep(step: MotionStep, index: number): void {
  const label = `steps[${String(index)}]`;
  requireObject(step, label);
  requireNonEmptyString(step.id, `${label}.id`);
  validateTarget(step.target, `${label}.target`);
  validateProperties(step.properties, `${label}.properties`);
  requireFiniteNonNegativeNumber(step.durationMs, `${label}.durationMs`);
  validateOptionalId(step.easing, `${label}.easing`);
  if (step.delayMs !== undefined) {
    requireFiniteNonNegativeNumber(step.delayMs, `${label}.delayMs`);
  }
  if (step.staggerMs !== undefined) {
    requireFiniteNonNegativeNumber(step.staggerMs, `${label}.staggerMs`);
  }
}

export function validateMotionSequence(sequence: MotionSequence): void {
  requireObject(sequence, 'sequence');
  requireNonEmptyString(sequence.id, 'sequence.id');
  validateInteractionTrigger(sequence.trigger, 'sequence.trigger');
  if (!Array.isArray(sequence.steps) || sequence.steps.length === 0) {
    fail('sequence.steps must contain at least one step');
  }

  sequence.steps.forEach((step, index) => validateMotionStep(step, index));
}

export function validateScrollScene(scene: ScrollScene): void {
  requireObject(scene, 'scene');
  requireNonEmptyString(scene.id, 'scene.id');
  validateInteractionTrigger(scene.trigger, 'scene.trigger');
  if (scene.trigger.type !== 'scroll-progress') {
    fail('scene.trigger.type must be scroll-progress');
  }
  requireNonEmptyString(scene.start, 'scene.start');
  requireNonEmptyString(scene.end, 'scene.end');
  if (scene.axis !== 'x' && scene.axis !== 'y') {
    fail('scene.axis must be x or y');
  }
  if (typeof scene.scrub !== 'boolean') {
    fail('scene.scrub must be a boolean');
  }
  if (scene.pin !== undefined && typeof scene.pin !== 'boolean') {
    fail('scene.pin must be a boolean');
  }
  validateMotionSequence(scene.sequence);

  if (scene.snapPoints !== undefined) {
    if (!Array.isArray(scene.snapPoints)) {
      fail('scene.snapPoints must be an array');
    }
    scene.snapPoints.forEach((snapPoint, index) => {
      if (
        typeof snapPoint !== 'number' ||
        !Number.isFinite(snapPoint) ||
        snapPoint < 0 ||
        snapPoint > 1
      ) {
        fail(`scene.snapPoints[${String(index)}] must be a finite number in [0, 1]`);
      }
    });
  }
}
