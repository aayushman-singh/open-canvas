import type { MotionSequence, MotionSequenceStep } from './behaviour-primitives.js';
import type {
  CanvasElement,
  CanvasPage,
  CanvasSection,
  EditableSite,
  MotionPreset,
  MotionPresetTokens,
  PublishedSnapshot,
  StyleKitPreset,
} from './schema.js';
import { getStyleKitPreset, resolveStyleKitWithCustom } from './style-kits.js';

type CompileSnapshot = EditableSite | PublishedSnapshot;

export class MotionPresetCompileError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly preset: MotionPreset,
  ) {
    super(message);
    this.name = 'MotionPresetCompileError';
  }
}

export function motionPresetSequenceUnsupportedReason(preset: MotionPreset): string | null {
  if (preset === 'bounce-in') return 'multi-stop overshoot keyframes are outside V1 sequence steps';
  if (preset === 'slow-drift') return 'continuous loop playback is not a one-shot sequence';
  if (preset === 'flip-in') return 'perspective and rotateY are outside the transform whitelist';
  return null;
}

type MotionProps = NonNullable<MotionSequenceStep['from']>;

type TriggerKey =
  | { kind: 'load-enter'; pageId: string }
  | { kind: 'page-enter'; pageId: string }
  | { kind: 'section-enter'; sectionId: string };

function triggerKeyString(key: TriggerKey): string {
  if (key.kind === 'load-enter') return `load-enter:${key.pageId}`;
  if (key.kind === 'page-enter') return `page-enter:${key.pageId}`;
  return `section-enter:${key.sectionId}`;
}

function sequenceIdForTrigger(key: TriggerKey): string {
  if (key.kind === 'load-enter') return `preset-compiled-load-enter-${key.pageId}`;
  if (key.kind === 'page-enter') return `preset-compiled-page-enter-${key.pageId}`;
  return `preset-compiled-section-enter-${key.sectionId}`;
}

function stepIdForTarget(key: TriggerKey, stepIndex: number, suffix: string): string {
  return `${sequenceIdForTrigger(key)}-step-${String(stepIndex)}-${suffix}`;
}

function resolveKitPreset(snapshot: CompileSnapshot): StyleKitPreset {
  return snapshot.styleKit === 'custom'
    ? resolveStyleKitWithCustom(snapshot)
    : getStyleKitPreset(snapshot.styleKit);
}

function assertRepresentablePreset(
  preset: MotionPreset,
  path: string,
): asserts preset is Exclude<MotionPreset, 'none' | 'bounce-in' | 'slow-drift' | 'flip-in'> {
  const unsupportedReason = motionPresetSequenceUnsupportedReason(preset);
  if (unsupportedReason !== null) {
    throw new MotionPresetCompileError(
      `Motion preset "${preset}" cannot be represented as a Motion Sequence step: ${unsupportedReason}`,
      path,
      preset,
    );
  }
}

function parseTransformString(transform: string, path: string, preset: MotionPreset): MotionProps {
  if (/perspective|rotate[XYZ]|rotate3d|matrix3d|skew/.test(transform)) {
    throw new MotionPresetCompileError(
      `Motion preset "${preset}" transform "${transform}" uses properties outside the Motion Sequence whitelist`,
      path,
      preset,
    );
  }
  const out: MotionProps = {};
  const translateX = transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
  if (translateX) out.translateX = Number(translateX[1]);
  const translateY = transform.match(/translateY\((-?\d+(?:\.\d+)?)px\)/);
  if (translateY) out.translateY = Number(translateY[1]);
  const scaleMatch = transform.match(/scale\((-?\d+(?:\.\d+)?)\)/);
  if (scaleMatch) out.scale = Number(scaleMatch[1]);
  const rotateMatch = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  if (rotateMatch) out.rotate = Number(rotateMatch[1]);
  return out;
}

function restingPropsFromFromState(from: MotionProps): MotionProps {
  const to: MotionProps = {};
  if (from.opacity !== undefined) to.opacity = 1;
  if (from.translateX !== undefined) to.translateX = 0;
  if (from.translateY !== undefined) to.translateY = 0;
  if (from.scale !== undefined) to.scale = 1;
  if (from.rotate !== undefined) to.rotate = 0;
  if (from.filter !== undefined) to.filter = 'blur(0px)';
  return to;
}

function fromPropsFromPreset(
  preset: MotionPreset,
  tokens: MotionPresetTokens,
  path: string,
): MotionProps {
  assertRepresentablePreset(preset, path);
  if (preset === 'stagger-children') {
    return { translateY: 8, opacity: 0 };
  }
  const from: MotionProps = {};
  if (tokens.opacity !== undefined) from.opacity = tokens.opacity;
  if (tokens.transform !== undefined) {
    Object.assign(from, parseTransformString(tokens.transform, path, preset));
  }
  if (preset === 'blur-in') from.filter = 'blur(8px)';
  return from;
}

function buildPresetStep(
  triggerKey: TriggerKey,
  stepIndex: number,
  suffix: string,
  target: MotionSequenceStep['target'],
  preset: MotionPreset,
  kit: StyleKitPreset,
  path: string,
  delayMs?: number,
  staggerMs?: number,
): MotionSequenceStep {
  assertRepresentablePreset(preset, path);
  const tokens = kit.motionPresets[preset];
  const from = fromPropsFromPreset(preset, tokens, path);
  const to = restingPropsFromFromState(from);
  return {
    id: stepIdForTarget(triggerKey, stepIndex, suffix),
    target,
    from,
    to,
    durationMs: kit.motionDurationMs,
    easing: kit.motionEasing,
    ...(delayMs !== undefined && delayMs > 0 ? { delayMs } : {}),
    ...(staggerMs !== undefined && staggerMs > 0 ? { staggerMs } : {}),
  };
}

function walkSectionElements(section: CanvasSection, visit: (element: CanvasElement) => void): void {
  const stack = [...section.elements];
  while (stack.length > 0) {
    const element = stack.pop();
    if (!element) continue;
    visit(element);
    if (element.type === 'tabs') {
      for (const tab of element.tabs) stack.push(...tab.elements);
    } else if (element.type === 'collection') {
      for (const entry of element.entries ?? []) stack.push(...entry);
    } else if (element.type === 'flow-container') {
      for (const item of element.items) stack.push(item.element);
    }
  }
}

function collectSectionSteps(
  section: CanvasSection,
  kit: StyleKitPreset,
  triggerKey: TriggerKey,
  steps: MotionSequenceStep[],
  stepIndex: { value: number },
): void {
  const entrance = section.entrance ?? 'none';
  if (entrance !== 'none') {
    const path = `sections[${section.id}].entrance`;
    if (entrance === 'stagger-children') {
      const staggerMs = kit.motionPresets['stagger-children'].delayMs ?? 60;
      let childIndex = 0;
      for (const element of section.elements) {
        steps.push(
          buildPresetStep(
            triggerKey,
            stepIndex.value++,
            `element-${element.id}`,
            { type: 'element', elementId: element.id },
            'stagger-children',
            kit,
            path,
            childIndex * staggerMs,
          ),
        );
        childIndex += 1;
      }
    } else {
      steps.push(
        buildPresetStep(
          triggerKey,
          stepIndex.value++,
          `section-${section.id}`,
          { type: 'section', sectionId: section.id },
          entrance,
          kit,
          path,
        ),
      );
    }
  }

  walkSectionElements(section, (element) => {
    if (element.motion === undefined || element.motion.preset === 'none') return;
    const path = `elements[${element.id}].motion.preset`;
    steps.push(
      buildPresetStep(
        triggerKey,
        stepIndex.value++,
        `element-${element.id}`,
        { type: 'element', elementId: element.id },
        element.motion.preset,
        kit,
        path,
        element.motion.delayMs,
      ),
    );
  });
}

function collectPageSteps(
  page: CanvasPage,
  kit: StyleKitPreset,
  triggerKey: TriggerKey,
  steps: MotionSequenceStep[],
  stepIndex: { value: number },
): void {
  const entrance = page.entranceAnimation;
  if (entrance === undefined || entrance === 'none') return;
  const path = `pages[${page.id}].entranceAnimation`;
  steps.push(
    buildPresetStep(
      triggerKey,
      stepIndex.value++,
      `page-${page.id}`,
      { type: 'page', pageId: page.id },
      entrance,
      kit,
      path,
    ),
  );
}

export function snapshotHasMotionPresetFields(snapshot: CompileSnapshot): boolean {
  for (const page of snapshot.pages) {
    if (page.entranceAnimation !== undefined && page.entranceAnimation !== 'none') return true;
    for (const section of page.sections) {
      if (section.entrance !== undefined && section.entrance !== 'none') return true;
      let found = false;
      walkSectionElements(section, (element) => {
        if (element.motion !== undefined && element.motion.preset !== 'none') found = true;
      });
      if (found) return true;
    }
  }
  if (snapshot.header) {
    if (snapshot.header.entrance !== undefined && snapshot.header.entrance !== 'none') return true;
    let found = false;
    walkSectionElements(snapshot.header, (element) => {
      if (element.motion !== undefined && element.motion.preset !== 'none') found = true;
    });
    if (found) return true;
  }
  if (snapshot.footer) {
    if (snapshot.footer.entrance !== undefined && snapshot.footer.entrance !== 'none') return true;
    let found = false;
    walkSectionElements(snapshot.footer, (element) => {
      if (element.motion !== undefined && element.motion.preset !== 'none') found = true;
    });
    if (found) return true;
  }
  return false;
}

export function compileMotionPresetSequences(snapshot: CompileSnapshot): MotionSequence[] {
  if (!snapshotHasMotionPresetFields(snapshot)) return [];
  const kit = resolveKitPreset(snapshot);
  const grouped = new Map<string, { key: TriggerKey; steps: MotionSequenceStep[] }>();

  const ensureGroup = (key: TriggerKey): { key: TriggerKey; steps: MotionSequenceStep[] } => {
    const id = triggerKeyString(key);
    const existing = grouped.get(id);
    if (existing) return existing;
    const created = { key, steps: [] as MotionSequenceStep[] };
    grouped.set(id, created);
    return created;
  };

  const compileSection = (section: CanvasSection): void => {
    const sectionHasEntrance = (section.entrance ?? 'none') !== 'none';
    let sectionHasElementMotion = false;
    walkSectionElements(section, (element) => {
      if (element.motion !== undefined && element.motion.preset !== 'none') {
        sectionHasElementMotion = true;
      }
    });
    if (!sectionHasEntrance && !sectionHasElementMotion) return;

    const triggerKey: TriggerKey = { kind: 'section-enter', sectionId: section.id };
    const group = ensureGroup(triggerKey);
    collectSectionSteps(section, kit, triggerKey, group.steps, { value: 0 });
  };

  const compilePage = (page: CanvasPage): void => {
    if (page.entranceAnimation === undefined || page.entranceAnimation === 'none') return;
    const triggerMode = page.scrollTriggerMode ?? 'on-load';
    const triggerKey: TriggerKey =
      triggerMode === 'on-scroll'
        ? { kind: 'page-enter', pageId: page.id }
        : { kind: 'load-enter', pageId: page.id };
    const group = ensureGroup(triggerKey);
    collectPageSteps(page, kit, triggerKey, group.steps, { value: 0 });
  };

  for (const page of snapshot.pages) {
    compilePage(page);
    for (const section of page.sections) compileSection(section);
  }
  if (snapshot.header) compileSection(snapshot.header);
  if (snapshot.footer) compileSection(snapshot.footer);

  const authoredIds = new Set((snapshot.motionSequences ?? []).map((sequence) => sequence.id));
  const sequences: MotionSequence[] = [];
  for (const { key, steps } of grouped.values()) {
    if (steps.length === 0) continue;
    const id = sequenceIdForTrigger(key);
    if (authoredIds.has(id)) {
      throw new MotionPresetCompileError(
        `Compiled Motion Sequence id "${id}" collides with an authored motionSequences entry`,
        id,
        'none',
      );
    }
    sequences.push({
      id,
      trigger:
        key.kind === 'load-enter'
          ? { type: 'load-enter' }
          : key.kind === 'page-enter'
            ? { type: 'page-enter', pageId: key.pageId }
            : { type: 'section-enter', sectionId: key.sectionId },
      steps,
      reducedMotion: 'final-state',
    });
  }
  sequences.sort((a, b) => a.id.localeCompare(b.id));
  return sequences;
}

export function snapshotUsesCompiledMotionPresets(snapshot: CompileSnapshot): boolean {
  return compileMotionPresetSequences(snapshot).length > 0;
}
