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
  OverlayChoreographyPreset,
  OverlayChoreographyReducedMotionMode,
  LoadExperienceGate,
  LoadExperiencePreset,
  LoadExperienceRunPolicy,
  MotionSequenceLite,
  MotionSequenceLiteEffect,
  MotionSequenceLiteStep,
  MotionSequenceLiteTarget,
  MotionSequenceLiteTargetType,
  Overlay,
  OverlayBackdropStyle,
  OverlayChromePreset,
  OverlayClosePlacement,
  OverlayDismissal,
  OverlayLayoutPreset,
  OverlayPresentationMode,
  OverlayScope,
  OverlayTriggerType,
  RouteTransition,
  RouteTransitionMode,
  ScrollBehaviorMode,
  ScrollBehaviorReducedMotionMode,
  SharedRouteElement,
  EditableSite,
} from '../canvas/schema.js';
import type {
  BehaviourTarget,
  ImageSequenceRichMotionAsset,
  LayoutTransition,
  LottieRichMotionAsset,
  Model3DRichMotionAsset,
  MotionSequence,
  MotionSequenceStep,
  RichMotionAsset,
  RiveInputBinding,
  RiveRichMotionAsset,
  ScrollScene,
  ShaderSceneRichMotionAsset,
  VideoStreamRichMotionAsset,
} from '../canvas/behaviour-primitives.js';
import {
  BEHAVIOUR_TARGET_TYPES,
  LAYOUT_TRANSITION_INITIAL_STATES,
  LAYOUT_TRANSITION_REDUCED_MOTION_MODES,
  BEHAVIOUR_LOAD_RUN_POLICIES,
  LOAD_HANDOFF_EFFECTS,
  LOAD_PROGRESS_DISPLAY_MODES,
  MOTION_SEQUENCE_PLAYBACK_DIRECTIONS,
  MOTION_SEQUENCE_REPEAT_MODES,
  MOTION_SEQUENCE_TEXT_EFFECTS,
  MOTION_SEQUENCE_TRIGGER_TYPES,
  RIVE_INPUT_EVENTS,
  RIVE_INPUT_TYPES,
  SHADER_SCENE_PRESETS,
  SHADER_SCENE_REDUCED_MOTION_MODES,
  TEXT_SPLIT_UNITS,
  VIDEO_STREAM_REDUCED_MOTION_MODES,
  VIDEO_STREAM_TRIGGERS,
} from '../canvas/behaviour-primitives.js';
import { isPremiumLoadExperience } from '../canvas/schema.js';
import {
  LOAD_EXPERIENCE_GATES,
  LOAD_EXPERIENCE_PRESETS,
  LOAD_EXPERIENCE_RUN_POLICIES,
  OVERLAY_CHOREOGRAPHY_PRESETS,
  OVERLAY_CHOREOGRAPHY_REDUCED_MOTION_MODES,
  MOTION_SEQUENCE_LITE_EFFECTS,
  MOTION_SEQUENCE_LITE_TARGET_TYPES,
  OVERLAY_BACKDROP_STYLES,
  OVERLAY_CHROME_PRESETS,
  OVERLAY_CLOSE_PLACEMENTS,
  OVERLAY_LAYOUT_PRESETS,
  OVERLAY_PRESENTATION_MODES,
  OVERLAY_TRIGGER_TYPES,
  ROUTE_TRANSITION_MODES,
  SCROLL_BEHAVIOR_MODES,
  SCROLL_BEHAVIOR_REDUCED_MOTION_MODES,
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
type RiveInputType = (typeof RIVE_INPUT_TYPES)[number];
type RiveInputEvent = (typeof RIVE_INPUT_EVENTS)[number];
type MotionSequenceRepeatMode = (typeof MOTION_SEQUENCE_REPEAT_MODES)[number];
type MotionSequencePlaybackDirection = (typeof MOTION_SEQUENCE_PLAYBACK_DIRECTIONS)[number];
type MotionSequenceTextEffect = (typeof MOTION_SEQUENCE_TEXT_EFFECTS)[number];
type BehaviourLoadRunPolicy = (typeof BEHAVIOUR_LOAD_RUN_POLICIES)[number];
type LoadProgressDisplayMode = (typeof LOAD_PROGRESS_DISPLAY_MODES)[number];
type ShaderScenePreset = (typeof SHADER_SCENE_PRESETS)[number];
type ShaderSceneReducedMotionMode = (typeof SHADER_SCENE_REDUCED_MOTION_MODES)[number];
type VideoStreamTrigger = (typeof VIDEO_STREAM_TRIGGERS)[number];
type VideoStreamReducedMotionMode = (typeof VIDEO_STREAM_REDUCED_MOTION_MODES)[number];
type MotionSequencePatch = Partial<Omit<MotionSequence, 'repeat' | 'playbackDirection'>> & {
  repeat?: MotionSequence['repeat'] | undefined;
  playbackDirection?: MotionSequence['playbackDirection'] | undefined;
};

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
    presentation: {
      mode: 'modal',
      chrome: 'standard',
      backdrop: 'dim',
      closePlacement: 'top-right',
      layout: 'centered',
      choreography: 'none',
      reducedMotion: 'instant',
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

export function defaultLayoutTransition(
  id: string,
  name: string,
  triggerElementId: string,
  targetElementId: string,
): LayoutTransition {
  return {
    id,
    name,
    triggerElementId,
    sourceElementId: triggerElementId,
    targetElementId,
    viewTransitionName: 'layout' + String(Date.now()),
    initialState: 'source',
    reducedMotion: 'instant',
  };
}

export function defaultRiveRichMotionAsset(id: string): RiveRichMotionAsset {
  return {
    id,
    kind: 'rive',
    assetId: id + '.riv',
    alt: 'Rive animation',
    stateMachine: 'State Machine 1',
    autoplay: true,
    reducedMotion: 'pause',
    inputs: [],
  };
}

export function defaultRiveInputBinding(id: string): RiveInputBinding {
  return {
    id,
    inputName: 'isHovered',
    inputType: 'boolean',
    event: 'pointer-enter',
    value: true,
  };
}

export function defaultLottieRichMotionAsset(id: string): LottieRichMotionAsset {
  return {
    id,
    kind: 'lottie',
    assetId: id + '.json',
    alt: 'Lottie animation',
    renderer: 'svg',
    loop: true,
    autoplay: true,
    reducedMotion: 'pause',
  };
}

export function defaultModel3DRichMotionAsset(id: string): Model3DRichMotionAsset {
  return {
    id,
    kind: 'model-3d',
    assetId: id + '.glb',
    posterAssetId: id + '-poster.webp',
    alt: '3D model',
    cameraControls: true,
    autoRotate: false,
    reducedMotion: 'static',
  };
}

export function defaultShaderSceneRichMotionAsset(id: string): ShaderSceneRichMotionAsset {
  return {
    id,
    kind: 'shader-scene',
    preset: 'racing-lines',
    alt: 'Shader scene',
    colorA: '#C8FF1A',
    colorB: '#111112',
    speed: 0.8,
    density: 0.7,
    reducedMotion: 'static',
  };
}

export function defaultImageSequenceRichMotionAsset(id: string): ImageSequenceRichMotionAsset {
  return {
    id,
    kind: 'image-sequence',
    frameAssetIds: [id + '-frame-001.webp', id + '-frame-002.webp'],
    posterAssetId: id + '-poster.webp',
    alt: 'Image sequence',
    playback: { driver: 'load', fps: 24, loop: false },
  };
}

export function defaultVideoStreamRichMotionAsset(id: string): VideoStreamRichMotionAsset {
  return {
    id,
    kind: 'video-stream',
    assetId: id + '.mp4',
    posterAssetId: id + '-poster.webp',
    alt: 'Hover video stream',
    muted: true,
    loop: true,
    controls: false,
    playback: { trigger: 'hover-focus', resetOnExit: true },
    reducedMotion: 'poster',
  };
}

export function renderInteractionsPanel(ctx: InteractionsPanelContext): void {
  const host = document.getElementById('opencanvas-interactions-panel');
  if (!host || !ctx.state) return;
  host.replaceChildren();
  host.className = 'opencanvas-interactions-panel';
  renderScrollSceneControls(ctx, host);
  renderMotionSequenceControls(ctx, host);
  renderRichMotionAssetControls(ctx, host);
  renderLayoutTransitionControls(ctx, host);
  renderSmoothScrollControls(ctx, host);
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
    runPolicy: 'once-per-session',
    progress: {
      display: 'bar-number',
      durationMs: 1200,
      label: 'Loading',
    },
    handoff: {
      effect: 'mask-open',
      durationMs: 420,
      easing: 'cubic-bezier(.76,0,.24,1)',
    },
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

function isRiveAsset(asset: RichMotionAsset): asset is RiveRichMotionAsset {
  return asset.kind === 'rive';
}

function isImageSequenceAsset(asset: RichMotionAsset): asset is ImageSequenceRichMotionAsset {
  return asset.kind === 'image-sequence';
}

function isLottieAsset(asset: RichMotionAsset): asset is LottieRichMotionAsset {
  return asset.kind === 'lottie';
}

function isModel3DAsset(asset: RichMotionAsset): asset is Model3DRichMotionAsset {
  return asset.kind === 'model-3d';
}

function isShaderSceneAsset(asset: RichMotionAsset): asset is ShaderSceneRichMotionAsset {
  return asset.kind === 'shader-scene';
}

function isVideoStreamAsset(asset: RichMotionAsset): asset is VideoStreamRichMotionAsset {
  return asset.kind === 'video-stream';
}

function replaceRichMotionAsset(
  ctx: InteractionsPanelContext,
  assetId: string,
  update: (asset: RichMotionAsset) => RichMotionAsset,
): void {
  mutate(ctx, () => {
    const assets = ctx.state!.richMotionAssets ?? [];
    ctx.state!.richMotionAssets = assets.map((asset) => (asset.id === assetId ? update(asset) : asset));
  });
}

function replaceRiveInputBinding(
  ctx: InteractionsPanelContext,
  asset: RiveRichMotionAsset,
  bindingId: string,
  update: (binding: RiveInputBinding) => RiveInputBinding,
): void {
  replaceRichMotionAsset(ctx, asset.id, (current) => {
    if (!isRiveAsset(current)) return current;
    return {
      ...current,
      inputs: (current.inputs ?? []).map((binding) =>
        binding.id === bindingId ? update(binding) : binding,
      ),
    };
  });
}

function coerceRiveBinding(
  binding: RiveInputBinding,
  inputType: RiveInputType,
  event: RiveInputEvent,
  ctx: InteractionsPanelContext,
): RiveInputBinding {
  const inputName = binding.inputName || 'input';
  if (event === 'scroll-progress') {
    const existing =
      binding.event === 'scroll-progress' ? binding.scrollSceneId : ctx.state?.scrollScenes?.[0]?.id;
    return {
      id: binding.id,
      inputName,
      inputType: 'number',
      event: 'scroll-progress',
      scrollSceneId: existing ?? '',
    };
  }
  if (inputType === 'trigger') {
    return { id: binding.id, inputName, inputType: 'trigger', event };
  }
  if (inputType === 'number') {
    return {
      id: binding.id,
      inputName,
      inputType: 'number',
      event,
      value: binding.inputType === 'number' && binding.event !== 'scroll-progress' ? binding.value : 0,
    };
  }
  return {
    id: binding.id,
    inputName,
    inputType: 'boolean',
    event,
    value: binding.inputType === 'boolean' ? binding.value : true,
  };
}

function renderRichMotionAssetControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Rich Motion Assets');
  const addImageSequence = actionButton(
    'Add image sequence asset',
    'Create schema-owned image-sequence rich motion metadata',
  );
  addImageSequence.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'image-sequence-' + Date.now();
      ctx.state!.richMotionAssets = [
        ...(ctx.state!.richMotionAssets ?? []),
        defaultImageSequenceRichMotionAsset(id),
      ];
    });
    ctx.setStatus('Image sequence asset metadata added', 'ok');
  });
  wrap.appendChild(addImageSequence);

  const addRive = actionButton('Add Rive asset', 'Create schema-owned Rive rich motion metadata');
  addRive.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'rive-asset-' + Date.now();
      ctx.state!.richMotionAssets = [...(ctx.state!.richMotionAssets ?? []), defaultRiveRichMotionAsset(id)];
    });
    ctx.setStatus('Rive asset metadata added', 'ok');
  });
  wrap.appendChild(addRive);

  const addLottie = actionButton('Add Lottie asset', 'Create schema-owned Lottie rich motion metadata');
  addLottie.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'lottie-asset-' + Date.now();
      ctx.state!.richMotionAssets = [
        ...(ctx.state!.richMotionAssets ?? []),
        defaultLottieRichMotionAsset(id),
      ];
    });
    ctx.setStatus('Lottie asset metadata added', 'ok');
  });
  wrap.appendChild(addLottie);

  const addModel = actionButton('Add model-3d asset', 'Create schema-owned bounded 3D model metadata');
  addModel.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'model-3d-' + Date.now();
      ctx.state!.richMotionAssets = [
        ...(ctx.state!.richMotionAssets ?? []),
        defaultModel3DRichMotionAsset(id),
      ];
    });
    ctx.setStatus('Model-3D asset metadata added', 'ok');
  });
  wrap.appendChild(addModel);

  const addShader = actionButton('Add shader scene asset', 'Create schema-owned bounded shader scene metadata');
  addShader.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'shader-scene-' + Date.now();
      ctx.state!.richMotionAssets = [
        ...(ctx.state!.richMotionAssets ?? []),
        defaultShaderSceneRichMotionAsset(id),
      ];
    });
    ctx.setStatus('Shader scene asset metadata added', 'ok');
  });
  wrap.appendChild(addShader);

  const addVideo = actionButton('Add video stream asset', 'Create schema-owned hover/focus video stream metadata');
  addVideo.addEventListener('click', () => {
    mutate(ctx, () => {
      const id = 'video-stream-' + Date.now();
      ctx.state!.richMotionAssets = [
        ...(ctx.state!.richMotionAssets ?? []),
        defaultVideoStreamRichMotionAsset(id),
      ];
    });
    ctx.setStatus('Video stream asset metadata added', 'ok');
  });
  wrap.appendChild(addVideo);

  const assets = ctx.state.richMotionAssets ?? [];
  if (assets.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No rich motion assets yet.';
    wrap.appendChild(empty);
  }

  for (const asset of assets) {
    renderRichMotionAssetCard(ctx, wrap, asset);
  }

  host.appendChild(wrap);
}

function renderRichMotionAssetCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  asset: RichMotionAsset,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card';
  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = asset.id + ' (' + asset.kind + ')';
  header.appendChild(title);
  const remove = compactButton('Delete', 'Delete this rich motion asset metadata');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      ctx.state!.richMotionAssets = (ctx.state!.richMotionAssets ?? []).filter((item) => item.id !== asset.id);
    });
    ctx.setStatus('Rich motion asset deleted', 'ok');
  });
  header.appendChild(remove);
  card.appendChild(header);

  if (isImageSequenceAsset(asset)) {
    renderImageSequenceAssetFields(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  if (isRiveAsset(asset)) {
    renderRiveAssetFields(ctx, card, asset);
    renderRiveInputBindings(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  if (isLottieAsset(asset)) {
    renderLottieAssetFields(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  if (isModel3DAsset(asset)) {
    renderModel3DAssetFields(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  if (isShaderSceneAsset(asset)) {
    renderShaderSceneAssetFields(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  if (isVideoStreamAsset(asset)) {
    renderVideoStreamAssetFields(ctx, card, asset);
    host.appendChild(card);
    return;
  }

  {
    const note = document.createElement('p');
    note.className = 'opencanvas-section-picker-empty';
    note.textContent =
      'This editor slice exposes image-sequence, Rive, Lottie, model-3d, shader-scene, and video stream asset controls. Other rich motion kinds remain schema-owned.';
    card.appendChild(note);
    host.appendChild(card);
    return;
  }
}

function renderImageSequenceAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: ImageSequenceRichMotionAsset,
): void {
  const frames = textInput(asset.frameAssetIds.join(', '), 'frame-001.webp, frame-002.webp');
  frames.addEventListener('change', () => {
    const frameAssetIds = frames.value
      .split(',')
      .map((frame) => frame.trim())
      .filter(Boolean);
    if (frameAssetIds.length === 0) {
      frames.value = asset.frameAssetIds.join(', ');
      ctx.setStatus('Image sequence requires at least one frame asset id', 'error');
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isImageSequenceAsset(current) ? { ...current, frameAssetIds } : current,
    );
  });
  card.appendChild(field('Frame asset ids', frames));

  const poster = textInput(asset.posterAssetId, 'sequence-poster.webp');
  poster.addEventListener('change', () => {
    const next = poster.value.trim();
    if (!next) {
      poster.value = asset.posterAssetId;
      ctx.setStatus('Image sequence poster asset id is required', 'error');
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isImageSequenceAsset(current) ? { ...current, posterAssetId: next } : current,
    );
  });
  card.appendChild(field('Poster asset id', poster));

  const alt = textInput(asset.alt, 'Accessible image sequence label');
  alt.addEventListener('change', () => {
    const next = alt.value.trim();
    if (!next) {
      alt.value = asset.alt;
      ctx.setStatus('Image sequence alt text is required', 'error');
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isImageSequenceAsset(current) ? { ...current, alt: next } : current,
    );
  });
  card.appendChild(field('Alt text', alt));

  const driver = selectInput(['load', 'scroll-scene'], asset.playback.driver);
  driver.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isImageSequenceAsset(current)) return current;
      if (driver.value === 'scroll-scene') {
        const sceneIds = (ctx.state?.scrollScenes ?? []).map((scene) => scene.id);
        const scrollSceneId = current.playback.scrollSceneId ?? sceneIds[0] ?? '';
        if (!scrollSceneId) {
          ctx.setStatus(
            'Create a Scroll Scene before binding image-sequence scrub playback. Validation blocks publish until it is restored.',
            'error',
          );
        }
        return { ...current, playback: { driver: 'scroll-scene', scrollSceneId } };
      }
      return {
        ...current,
        playback: {
          driver: 'load',
          fps: current.playback.fps ?? 24,
          loop: current.playback.loop ?? false,
        },
      };
    }),
  );
  card.appendChild(field('Image sequence playback', driver));

  if (asset.playback.driver === 'scroll-scene') {
    const sceneIds = (ctx.state?.scrollScenes ?? []).map((scene) => scene.id);
    const currentSceneId = asset.playback.scrollSceneId ?? '';
    const sceneOptions =
      currentSceneId && !sceneIds.includes(currentSceneId)
        ? [currentSceneId, ...sceneIds]
        : sceneIds.length > 0
          ? sceneIds
          : [''];
    const scene = selectInput(sceneOptions, currentSceneId);
    scene.addEventListener('change', () =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isImageSequenceAsset(current)
          ? { ...current, playback: { driver: 'scroll-scene', scrollSceneId: scene.value } }
          : current,
      ),
    );
    card.appendChild(field('Scroll scene', scene));

    if (sceneIds.length === 0) {
      const note = document.createElement('p');
      note.className = 'opencanvas-section-picker-empty';
      note.textContent =
        'Create a Scroll Scene before binding image-sequence scrub playback. Validation blocks publish until it is restored.';
      card.appendChild(note);
    } else if (currentSceneId && !sceneIds.includes(currentSceneId)) {
      const note = document.createElement('p');
      note.className = 'opencanvas-section-picker-empty';
      note.textContent =
        'Linked Scroll Scene is missing. Validation blocks publish until the image-sequence scrub binding is restored.';
      card.appendChild(note);
    }
    return;
  }

  const fps = numberInput(asset.playback.fps ?? 24, 1, 60, 1);
  fps.addEventListener('change', () => {
    const next = validNumber(fps, 1, 60);
    if (next === null) {
      fps.value = String(asset.playback.fps ?? 24);
      ctx.setStatus('Image sequence fps must be between 1 and 60', 'error');
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isImageSequenceAsset(current)
        ? {
            ...current,
            playback: {
              driver: 'load',
              fps: next,
              loop: current.playback.loop ?? false,
            },
          }
        : current,
    );
  });
  card.appendChild(field('FPS', fps));

  card.appendChild(
    checkbox(asset.playback.loop === true, 'Loop', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isImageSequenceAsset(current)
          ? {
              ...current,
              playback: {
                driver: 'load',
                fps: current.playback.fps ?? 24,
                loop: checked,
              },
            }
          : current,
      ),
    ),
  );
}

function renderRiveAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: RiveRichMotionAsset,
): void {
  const assetId = textInput(asset.assetId, 'hero.riv');
  assetId.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isRiveAsset(current) ? { ...current, assetId: assetId.value.trim() } : current,
    ),
  );
  card.appendChild(field('Asset id', assetId));

  const alt = textInput(asset.alt, 'Accessible animation label');
  alt.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isRiveAsset(current) ? { ...current, alt: alt.value.trim() } : current,
    ),
  );
  card.appendChild(field('Alt text', alt));

  const artboard = textInput(asset.artboard ?? '', 'Optional artboard');
  artboard.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isRiveAsset(current)) return current;
      const next = artboard.value.trim();
      if (next) return { ...current, artboard: next };
      const nextAsset = { ...current };
      delete nextAsset.artboard;
      return nextAsset;
    }),
  );
  card.appendChild(field('Artboard', artboard));

  const stateMachine = textInput(asset.stateMachine ?? '', 'State machine name');
  stateMachine.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isRiveAsset(current)) return current;
      const next = stateMachine.value.trim();
      if (next) return { ...current, stateMachine: next };
      const nextAsset = { ...current };
      delete nextAsset.stateMachine;
      return nextAsset;
    }),
  );
  card.appendChild(field('State machine', stateMachine));

  card.appendChild(
    checkbox(asset.autoplay !== false, 'Autoplay', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isRiveAsset(current) ? { ...current, autoplay: checked } : current,
      ),
    ),
  );

  const reduced = selectInput(['pause', 'play'], asset.reducedMotion);
  reduced.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isRiveAsset(current)
        ? { ...current, reducedMotion: reduced.value === 'play' ? 'play' : 'pause' }
        : current,
    ),
  );
  card.appendChild(field('Reduced motion', reduced));
}

function renderLottieAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: LottieRichMotionAsset,
): void {
  const assetId = textInput(asset.assetId, 'hero.json');
  assetId.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isLottieAsset(current) ? { ...current, assetId: assetId.value.trim() } : current,
    ),
  );
  card.appendChild(field('Asset id', assetId));

  const alt = textInput(asset.alt, 'Accessible animation label');
  alt.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isLottieAsset(current) ? { ...current, alt: alt.value.trim() } : current,
    ),
  );
  card.appendChild(field('Alt text', alt));

  const renderer = selectInput(['svg', 'canvas'], asset.renderer);
  renderer.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isLottieAsset(current)
        ? { ...current, renderer: renderer.value === 'canvas' ? 'canvas' : 'svg' }
        : current,
    ),
  );
  card.appendChild(field('Renderer', renderer));

  card.appendChild(
    checkbox(asset.loop === true, 'Loop', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isLottieAsset(current) ? { ...current, loop: checked } : current,
      ),
    ),
  );

  card.appendChild(
    checkbox(asset.autoplay !== false, 'Autoplay', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isLottieAsset(current) ? { ...current, autoplay: checked } : current,
      ),
    ),
  );

  const reduced = selectInput(['pause', 'play'], asset.reducedMotion);
  reduced.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isLottieAsset(current)
        ? { ...current, reducedMotion: reduced.value === 'play' ? 'play' : 'pause' }
        : current,
    ),
  );
  card.appendChild(field('Reduced motion', reduced));
}

function renderModel3DAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: Model3DRichMotionAsset,
): void {
  const assetId = textInput(asset.assetId, 'helmet.glb');
  assetId.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isModel3DAsset(current) ? { ...current, assetId: assetId.value.trim() } : current,
    ),
  );
  card.appendChild(field('Model asset id', assetId));

  const poster = textInput(asset.posterAssetId ?? '', 'helmet-poster.webp');
  poster.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isModel3DAsset(current)) return current;
      const next = poster.value.trim();
      if (next) return { ...current, posterAssetId: next };
      const nextAsset = { ...current };
      delete nextAsset.posterAssetId;
      return nextAsset;
    }),
  );
  card.appendChild(field('Poster asset id', poster));

  const alt = textInput(asset.alt, 'Accessible model label');
  alt.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isModel3DAsset(current) ? { ...current, alt: alt.value.trim() } : current,
    ),
  );
  card.appendChild(field('Alt text', alt));

  card.appendChild(
    checkbox(asset.cameraControls, 'Camera controls', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isModel3DAsset(current) ? { ...current, cameraControls: checked } : current,
      ),
    ),
  );

  card.appendChild(
    checkbox(asset.autoRotate === true, 'Auto rotate', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isModel3DAsset(current) ? { ...current, autoRotate: checked } : current,
      ),
    ),
  );

  const reduced = selectInput(['static', 'allow'], asset.reducedMotion);
  reduced.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isModel3DAsset(current)
        ? { ...current, reducedMotion: reduced.value === 'allow' ? 'allow' : 'static' }
        : current,
    ),
  );
  card.appendChild(field('Reduced motion', reduced));
}

function renderShaderSceneAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: ShaderSceneRichMotionAsset,
): void {
  const preset = selectInput([...SHADER_SCENE_PRESETS], asset.preset);
  preset.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current)
        ? { ...current, preset: preset.value as ShaderScenePreset }
        : current,
    ),
  );
  card.appendChild(field('Preset', preset));

  const alt = textInput(asset.alt, 'Accessible shader scene label');
  alt.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current) ? { ...current, alt: alt.value.trim() } : current,
    ),
  );
  card.appendChild(field('Alt text', alt));

  const colorA = textInput(asset.colorA, '#C8FF1A');
  colorA.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current) ? { ...current, colorA: colorA.value.trim() } : current,
    ),
  );
  card.appendChild(field('Color A', colorA));

  const colorB = textInput(asset.colorB, '#111112');
  colorB.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current) ? { ...current, colorB: colorB.value.trim() } : current,
    ),
  );
  card.appendChild(field('Color B', colorB));

  const speed = numberInput(asset.speed ?? 0.8, 0, 4, 0.1);
  speed.addEventListener('change', () => {
    const next = validNumber(speed, 0, 4);
    if (next === null) {
      ctx.setStatus('Shader scene speed must be between 0 and 4', 'error');
      speed.value = String(asset.speed ?? 0.8);
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current) ? { ...current, speed: next } : current,
    );
  });
  card.appendChild(field('Speed', speed));

  const density = numberInput(asset.density ?? 0.7, 0, 1, 0.05);
  density.addEventListener('change', () => {
    const next = validNumber(density, 0, 1);
    if (next === null) {
      ctx.setStatus('Shader scene density must be between 0 and 1', 'error');
      density.value = String(asset.density ?? 0.7);
      return;
    }
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current) ? { ...current, density: next } : current,
    );
  });
  card.appendChild(field('Density', density));

  const reduced = selectInput([...SHADER_SCENE_REDUCED_MOTION_MODES], asset.reducedMotion);
  reduced.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isShaderSceneAsset(current)
        ? { ...current, reducedMotion: reduced.value as ShaderSceneReducedMotionMode }
        : current,
    ),
  );
  card.appendChild(field('Reduced motion', reduced));
}

function renderVideoStreamAssetFields(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: VideoStreamRichMotionAsset,
): void {
  const assetId = textInput(asset.assetId, 'hover-stream.mp4');
  assetId.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isVideoStreamAsset(current) ? { ...current, assetId: assetId.value.trim() } : current,
    ),
  );
  card.appendChild(field('Video asset id', assetId));

  const poster = textInput(asset.posterAssetId ?? '', 'hover-poster.webp');
  poster.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isVideoStreamAsset(current)) return current;
      const next = poster.value.trim();
      if (next) return { ...current, posterAssetId: next };
      const nextAsset = { ...current };
      delete nextAsset.posterAssetId;
      return nextAsset;
    }),
  );
  card.appendChild(field('Poster asset id', poster));

  const alt = textInput(asset.alt, 'Accessible video stream label');
  alt.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isVideoStreamAsset(current) ? { ...current, alt: alt.value.trim() } : current,
    ),
  );
  card.appendChild(field('Alt text', alt));

  const trigger = selectInput([...VIDEO_STREAM_TRIGGERS], asset.playback.trigger);
  trigger.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isVideoStreamAsset(current)) return current;
      const nextTrigger = trigger.value as VideoStreamTrigger;
      return {
        ...current,
        muted:
          nextTrigger === 'hover-focus' || nextTrigger === 'load'
            ? true
            : current.muted,
        playback: {
          ...current.playback,
          trigger: nextTrigger,
        },
      };
    }),
  );
  card.appendChild(field('Playback trigger', trigger));

  card.appendChild(
    checkbox(asset.playback.resetOnExit === true, 'Reset on exit', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isVideoStreamAsset(current)
          ? { ...current, playback: { ...current.playback, resetOnExit: checked } }
          : current,
      ),
    ),
  );

  card.appendChild(
    checkbox(asset.muted, 'Muted', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) => {
        if (!isVideoStreamAsset(current)) return current;
        if (
          !checked &&
          (current.playback.trigger === 'hover-focus' || current.playback.trigger === 'load')
        ) {
          ctx.setStatus('Hover/focus and load video streams must stay muted', 'error');
          return current;
        }
        return { ...current, muted: checked };
      }),
    ),
  );

  card.appendChild(
    checkbox(asset.loop === true, 'Loop', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isVideoStreamAsset(current) ? { ...current, loop: checked } : current,
      ),
    ),
  );

  card.appendChild(
    checkbox(asset.controls === true, 'Controls', (checked) =>
      replaceRichMotionAsset(ctx, asset.id, (current) =>
        isVideoStreamAsset(current) ? { ...current, controls: checked } : current,
      ),
    ),
  );

  const reduced = selectInput([...VIDEO_STREAM_REDUCED_MOTION_MODES], asset.reducedMotion);
  reduced.addEventListener('change', () =>
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isVideoStreamAsset(current)
        ? {
            ...current,
            reducedMotion: reduced.value as VideoStreamReducedMotionMode,
          }
        : current,
    ),
  );
  card.appendChild(field('Reduced motion', reduced));
}

function renderRiveInputBindings(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  asset: RiveRichMotionAsset,
): void {
  const header = row('opencanvas-interactions-card-header');
  const label = document.createElement('strong');
  label.textContent = 'Rive input bindings';
  header.appendChild(label);
  const add = compactButton('Add input', 'Bind a Rive state-machine input to an Open Canvas event');
  add.addEventListener('click', () => {
    replaceRichMotionAsset(ctx, asset.id, (current) => {
      if (!isRiveAsset(current)) return current;
      const id = 'rive-input-' + Date.now();
      return { ...current, inputs: [...(current.inputs ?? []), defaultRiveInputBinding(id)] };
    });
    ctx.setStatus('Rive input binding added', 'ok');
  });
  header.appendChild(add);
  card.appendChild(header);

  const bindings = asset.inputs ?? [];
  if (bindings.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No Rive input bindings yet.';
    card.appendChild(empty);
    return;
  }
  for (const binding of bindings) {
    renderRiveInputBindingCard(ctx, card, asset, binding);
  }
}

function renderRiveInputBindingCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  asset: RiveRichMotionAsset,
  binding: RiveInputBinding,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card opencanvas-interactions-nested-card';
  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = binding.id;
  header.appendChild(title);
  const remove = compactButton('Delete', 'Delete this Rive input binding');
  remove.addEventListener('click', () => {
    replaceRichMotionAsset(ctx, asset.id, (current) =>
      isRiveAsset(current)
        ? { ...current, inputs: (current.inputs ?? []).filter((item) => item.id !== binding.id) }
        : current,
    );
    ctx.setStatus('Rive input binding deleted', 'ok');
  });
  header.appendChild(remove);
  card.appendChild(header);

  const inputName = textInput(binding.inputName, 'Rive input name');
  inputName.addEventListener('change', () =>
    replaceRiveInputBinding(ctx, asset, binding.id, (current) => ({
      ...current,
      inputName: inputName.value.trim(),
    })),
  );
  card.appendChild(field('Input name', inputName));

  const event = selectInput([...RIVE_INPUT_EVENTS], binding.event);
  event.addEventListener('change', () =>
    replaceRiveInputBinding(ctx, asset, binding.id, (current) =>
      coerceRiveBinding(current, current.inputType, event.value as RiveInputEvent, ctx),
    ),
  );
  card.appendChild(field('Event', event));

  const inputType = selectInput([...RIVE_INPUT_TYPES], binding.inputType);
  inputType.disabled = binding.event === 'scroll-progress';
  inputType.addEventListener('change', () =>
    replaceRiveInputBinding(ctx, asset, binding.id, (current) =>
      coerceRiveBinding(current, inputType.value as RiveInputType, current.event, ctx),
    ),
  );
  card.appendChild(field('Input type', inputType));

  if (binding.event === 'scroll-progress') {
    const sceneIds = (ctx.state?.scrollScenes ?? []).map((scene) => scene.id);
    const scene = selectInput(sceneIds.length > 0 ? sceneIds : [''], binding.scrollSceneId);
    scene.addEventListener('change', () =>
      replaceRiveInputBinding(ctx, asset, binding.id, (current) =>
        current.event === 'scroll-progress' ? { ...current, scrollSceneId: scene.value } : current,
      ),
    );
    card.appendChild(field('Scroll scene', scene));
  } else if (binding.inputType === 'boolean') {
    card.appendChild(
      checkbox(binding.value, 'Set true on event', (checked) =>
        replaceRiveInputBinding(ctx, asset, binding.id, (current) =>
          current.inputType === 'boolean' ? { ...current, value: checked } : current,
        ),
      ),
    );
  } else if (binding.inputType === 'number') {
    const value = numberInput(binding.value, -100000, 100000, 0.01);
    value.addEventListener('change', () => {
      const next = validNumber(value, -100000, 100000);
      if (next === null) {
        ctx.setStatus('Rive number input value must be finite', 'error');
        return;
      }
      replaceRiveInputBinding(ctx, asset, binding.id, (current) =>
        current.inputType === 'number' && current.event !== 'scroll-progress'
          ? { ...current, value: next }
          : current,
      );
    });
    card.appendChild(field('Value', value));
  } else {
    const note = document.createElement('p');
    note.className = 'opencanvas-section-picker-empty';
    note.textContent = 'Trigger inputs fire when the event occurs.';
    card.appendChild(note);
  }

  host.appendChild(card);
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

  const horizontal = scene.horizontalTrack;
  const horizontalEnabled = document.createElement('input');
  horizontalEnabled.type = 'checkbox';
  horizontalEnabled.checked = horizontal !== undefined;
  horizontalEnabled.addEventListener('change', () => {
    mutate(ctx, () => {
      const scenes = ctx.state!.scrollScenes ?? [];
      if (horizontalEnabled.checked) {
        const elementId = ctx.selectedElementId ?? elementIdsForActivePage(ctx)[0] ?? '';
        if (elementId.length === 0) {
          ctx.setStatus('Select an element before enabling a Scroll Scene horizontal track', 'error');
          horizontalEnabled.checked = false;
          return;
        }
        scenes[index] = { ...scene, horizontalTrack: { elementId } };
      } else {
        const next = { ...scene };
        delete next.horizontalTrack;
        scenes[index] = next;
      }
    });
  });
  card.appendChild(field('Horizontal track', horizontalEnabled));

  if (horizontal) {
    const horizontalElement = textInput(horizontal.elementId, 'Element id to translate');
    horizontalElement.addEventListener('change', () => {
      const value = horizontalElement.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Scroll Scene horizontal track element cannot be empty', 'error');
        horizontalElement.value = horizontal.elementId;
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, horizontalTrack: { ...horizontal, elementId: value } };
      });
    });
    card.appendChild(field('Horizontal element id', horizontalElement));

    const distance = optionalNumberInput(horizontal.distancePx, 1, 50000, 10);
    distance.addEventListener('change', () => {
      const value = distance.value.trim();
      if (value.length === 0) {
        mutate(ctx, () => {
          const scenes = ctx.state!.scrollScenes ?? [];
          const nextTrack = { ...horizontal };
          delete nextTrack.distancePx;
          scenes[index] = { ...scene, horizontalTrack: nextTrack };
        });
        return;
      }
      const next = validNumber(distance, 1, 50000);
      if (next === null) {
        ctx.setStatus('Scroll Scene horizontal track distance must be 1-50000px', 'error');
        distance.value = String(horizontal.distancePx ?? '');
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, horizontalTrack: { ...horizontal, distancePx: next } };
      });
    });
    card.appendChild(field('Horizontal distance (px)', distance));
  }

  const reveal = scene.beforeAfterReveal;
  const revealEnabled = document.createElement('input');
  revealEnabled.type = 'checkbox';
  revealEnabled.checked = reveal !== undefined;
  revealEnabled.addEventListener('change', () => {
    mutate(ctx, () => {
      const scenes = ctx.state!.scrollScenes ?? [];
      if (revealEnabled.checked) {
        const elementIds = elementIdsForActivePage(ctx);
        const beforeElementId = ctx.selectedElementId ?? elementIds[0] ?? '';
        const afterElementId = elementIds.find((elementId) => elementId !== beforeElementId) ?? '';
        if (!beforeElementId || !afterElementId) {
          ctx.setStatus('Add at least two elements before enabling a Scroll Scene before/after reveal', 'error');
          revealEnabled.checked = false;
          return;
        }
        scenes[index] = {
          ...scene,
          beforeAfterReveal: {
            beforeElementId,
            afterElementId,
            axis: 'x',
            startProgress: 0,
            endProgress: 1,
            reducedMotion: 'end',
          },
        };
      } else {
        const next = { ...scene };
        delete next.beforeAfterReveal;
        scenes[index] = next;
      }
    });
  });
  card.appendChild(field('Before/after reveal', revealEnabled));

  if (reveal) {
    const beforeElement = textInput(reveal.beforeElementId, 'Element id shown first');
    beforeElement.addEventListener('change', () => {
      const value = beforeElement.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Scroll Scene reveal before element cannot be empty', 'error');
        beforeElement.value = reveal.beforeElementId;
        return;
      }
      if (value === reveal.afterElementId) {
        ctx.setStatus('Scroll Scene reveal before and after elements must differ', 'error');
        beforeElement.value = reveal.beforeElementId;
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, beforeAfterReveal: { ...reveal, beforeElementId: value } };
      });
    });
    card.appendChild(field('Reveal before element id', beforeElement));

    const afterElement = textInput(reveal.afterElementId, 'Element id revealed by scroll');
    afterElement.addEventListener('change', () => {
      const value = afterElement.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Scroll Scene reveal after element cannot be empty', 'error');
        afterElement.value = reveal.afterElementId;
        return;
      }
      if (value === reveal.beforeElementId) {
        ctx.setStatus('Scroll Scene reveal before and after elements must differ', 'error');
        afterElement.value = reveal.afterElementId;
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, beforeAfterReveal: { ...reveal, afterElementId: value } };
      });
    });
    card.appendChild(field('Reveal after element id', afterElement));

    const axis = selectInput(['x', 'y'], reveal.axis ?? 'x');
    axis.addEventListener('change', () => {
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = {
          ...scene,
          beforeAfterReveal: { ...reveal, axis: axis.value === 'y' ? 'y' : 'x' },
        };
      });
    });
    card.appendChild(field('Reveal axis', axis));

    const startProgress = numberInput(reveal.startProgress ?? 0, 0, 1, 0.01);
    startProgress.addEventListener('change', () => {
      const next = validNumber(startProgress, 0, 1);
      const endProgress = reveal.endProgress ?? 1;
      if (next === null || next >= endProgress) {
        ctx.setStatus('Scroll Scene reveal start progress must be 0-1 and below end progress', 'error');
        startProgress.value = String(reveal.startProgress ?? 0);
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, beforeAfterReveal: { ...reveal, startProgress: next } };
      });
    });
    card.appendChild(field('Reveal start progress', startProgress));

    const endProgressInput = numberInput(reveal.endProgress ?? 1, 0, 1, 0.01);
    endProgressInput.addEventListener('change', () => {
      const next = validNumber(endProgressInput, 0, 1);
      const currentStart = reveal.startProgress ?? 0;
      if (next === null || next <= currentStart) {
        ctx.setStatus('Scroll Scene reveal end progress must be 0-1 and above start progress', 'error');
        endProgressInput.value = String(reveal.endProgress ?? 1);
        return;
      }
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = { ...scene, beforeAfterReveal: { ...reveal, endProgress: next } };
      });
    });
    card.appendChild(field('Reveal end progress', endProgressInput));

    const reducedMotion = selectInput(['start', 'end'], reveal.reducedMotion ?? 'end');
    reducedMotion.addEventListener('change', () => {
      mutate(ctx, () => {
        const scenes = ctx.state!.scrollScenes ?? [];
        scenes[index] = {
          ...scene,
          beforeAfterReveal: {
            ...reveal,
            reducedMotion: reducedMotion.value === 'start' ? 'start' : 'end',
          },
        };
      });
    });
    card.appendChild(field('Reveal reduced motion', reducedMotion));
  }

  const start = numberInput(scene.startOffsetPx, 0, 20000, 10);
  start.addEventListener('change', () => updateScrollSceneNumber(ctx, scene, index, 'startOffsetPx', start));
  card.appendChild(field('Start offset (px)', start));

  const end = numberInput(scene.endOffsetPx, 1, 20000, 10);
  end.addEventListener('change', () => updateScrollSceneNumber(ctx, scene, index, 'endOffsetPx', end));
  card.appendChild(field('End offset (px)', end));

  const snapPoints = textInput((scene.snapPoints ?? []).join(', '), '0, 0.5, 1');
  snapPoints.addEventListener('change', () => updateScrollSceneSnapPoints(ctx, scene, index, snapPoints));
  card.appendChild(field('Snap points', snapPoints));

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

function updateScrollSceneSnapPoints(
  ctx: InteractionsPanelContext,
  scene: ScrollScene,
  index: number,
  input: HTMLInputElement,
): void {
  const raw = input.value.trim();
  if (raw.length === 0) {
    mutate(ctx, () => {
      const scenes = ctx.state!.scrollScenes ?? [];
      const next = { ...scene };
      delete next.snapPoints;
      scenes[index] = next;
    });
    return;
  }
  const points = raw.split(',').map((part) => Number(part.trim()));
  let previous = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point) || point < 0 || point > 1 || point <= previous) {
      ctx.setStatus('Scroll scene snap points must be increasing numbers from 0 to 1', 'error');
      input.value = (scene.snapPoints ?? []).join(', ');
      return;
    }
    previous = point;
  }
  mutate(ctx, () => {
    const scenes = ctx.state!.scrollScenes ?? [];
    scenes[index] = { ...scene, snapPoints: points };
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

function updateMotionStepTextEffect(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  stepId: string,
  textEffect: MotionSequenceTextEffect,
): void {
  ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) => {
    if (sequence.id !== sequenceId) return sequence;
    return {
      ...sequence,
      steps: sequence.steps.map((step) => {
        if (step.id !== stepId) return step;
        const next = { ...step };
        if (textEffect === 'none') {
          delete next.textEffect;
        } else {
          next.textEffect = textEffect;
        }
        return next;
      }),
    };
  });
}

type EditableMotionNumber =
  | 'opacity'
  | 'translateX'
  | 'translateY'
  | 'scale'
  | 'rotate'
  | 'strokeDasharray'
  | 'strokeDashoffset'
  | 'fontVariationWeight'
  | 'fontVariationWidth'
  | 'fontVariationSlant';
type EditableMotionText = 'clipPath' | 'filter';
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
  { key: 'strokeDasharray', label: 'Stroke dash array', min: 0, max: 10000, step: 1 },
  { key: 'strokeDashoffset', label: 'Stroke dash offset', min: -10000, max: 10000, step: 1 },
  { key: 'fontVariationWeight', label: 'Variable font weight', min: 1, max: 1000, step: 1 },
  { key: 'fontVariationWidth', label: 'Variable font width', min: 25, max: 200, step: 1 },
  { key: 'fontVariationSlant', label: 'Variable font slant', min: -15, max: 15, step: 0.5 },
];
const MOTION_TEXT_FIELDS: Array<{
  key: EditableMotionText;
  label: string;
  placeholder: string;
}> = [
  { key: 'clipPath', label: 'Clip path', placeholder: 'inset(0 0 0 0)' },
  { key: 'filter', label: 'Filter', placeholder: 'blur(0px) contrast(1)' },
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
      const patch: MotionSequencePatch = {
        trigger: defaultMotionSequenceTrigger(ctx, trigger.value),
      };
      if (trigger.value === 'scroll-scene') {
        patch.repeat = undefined;
        patch.playbackDirection = undefined;
      }
      updateMotionSequence(ctx, sequence.id, patch);
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

  const directionDisabled = sequence.trigger.type === 'scroll-scene';
  const playbackDirection = selectInput(
    [...MOTION_SEQUENCE_PLAYBACK_DIRECTIONS],
    sequence.playbackDirection ?? 'normal',
  );
  playbackDirection.disabled = directionDisabled;
  playbackDirection.addEventListener('change', () => {
    mutate(ctx, () => {
      const next = playbackDirection.value as MotionSequencePlaybackDirection;
      updateMotionSequence(ctx, sequence.id, {
        playbackDirection: next === 'normal' ? undefined : next,
      });
    });
  });
  card.appendChild(field('Playback direction', playbackDirection));

  const repeatDisabled = sequence.trigger.type === 'scroll-scene';
  const repeatCount = numberInput(sequence.repeat?.count ?? 0, 0, 20, 1);
  repeatCount.disabled = repeatDisabled;
  repeatCount.addEventListener('change', () => {
    const next = validNumber(repeatCount, 0, 20);
    if (next === null || !Number.isInteger(next)) {
      ctx.setStatus('Motion Sequence repeat count must be an integer from 0-20', 'error');
      repeatCount.value = String(sequence.repeat?.count ?? 0);
      return;
    }
    mutate(ctx, () => {
      if (next === 0) {
        updateMotionSequence(ctx, sequence.id, { repeat: undefined });
        return;
      }
      updateMotionSequence(ctx, sequence.id, {
        repeat: { count: next, mode: sequence.repeat?.mode ?? 'restart' },
      });
    });
  });
  card.appendChild(field('Repeat count', repeatCount));

  const repeatMode = selectInput([...MOTION_SEQUENCE_REPEAT_MODES], sequence.repeat?.mode ?? 'restart');
  repeatMode.disabled = repeatDisabled;
  repeatMode.addEventListener('change', () => {
    mutate(ctx, () => {
      updateMotionSequence(ctx, sequence.id, {
        repeat: {
          count: sequence.repeat?.count ?? 1,
          mode: repeatMode.value as MotionSequenceRepeatMode,
        },
      });
    });
  });
  card.appendChild(field('Repeat mode', repeatMode));

  if (repeatDisabled) {
    const note = document.createElement('p');
    note.className = 'opencanvas-section-picker-empty';
    note.textContent = 'Repeat is disabled for scroll-scene sequences because scroll progress owns replay.';
    card.appendChild(note);
  }

  renderMotionSequenceTimeline(ctx, card, sequence);

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

function renderMotionSequenceTimeline(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  sequence: MotionSequence,
): void {
  const wrap = document.createElement('div');
  wrap.className = 'opencanvas-motion-timeline';
  wrap.setAttribute('data-opencanvas-motion-preview-progress', '0');
  const label = document.createElement('div');
  label.className = 'opencanvas-motion-timeline-label';
  label.textContent = 'Timeline overview';
  wrap.appendChild(label);

  const track = document.createElement('div');
  track.className = 'opencanvas-motion-timeline-track';
  const scheduled = motionSequenceTimelineItems(sequence);
  const playhead = document.createElement('span');
  playhead.className = 'opencanvas-motion-timeline-playhead';
  playhead.style.left = '0%';
  playhead.setAttribute('aria-hidden', 'true');
  track.appendChild(playhead);
  for (const snapPercent of [0, 25, 50, 75, 100]) {
    const snap = document.createElement('span');
    snap.className = 'opencanvas-motion-timeline-snap';
    snap.style.left = String(snapPercent) + '%';
    snap.title = 'Snap ' + String(snapPercent) + '%';
    snap.setAttribute('aria-hidden', 'true');
    track.appendChild(snap);
  }
  const laneOrder: string[] = [];
  const laneItems = new Map<string, MotionSequenceTimelineItem[]>();
  for (const item of scheduled) {
    if (!laneItems.has(item.laneKey)) {
      laneOrder.push(item.laneKey);
      laneItems.set(item.laneKey, []);
    }
    laneItems.get(item.laneKey)!.push(item);
  }
  for (const laneKey of laneOrder) {
    const items = laneItems.get(laneKey) ?? [];
    const lane = document.createElement('div');
    lane.className = 'opencanvas-motion-timeline-lane';
    lane.dataset.opencanvasMotionTimelineLane = laneKey;
    const laneLabel = document.createElement('span');
    laneLabel.className = 'opencanvas-motion-timeline-lane-label';
    laneLabel.textContent = items[0]?.laneLabel ?? laneKey;
    lane.appendChild(laneLabel);
    for (const item of items) {
      const bar = document.createElement('div');
      bar.className = 'opencanvas-motion-timeline-bar';
      bar.dataset.opencanvasMotionTimelineStep = item.step.id;
      bar.style.left = item.leftPercent.toFixed(2) + '%';
      bar.style.width = item.widthPercent.toFixed(2) + '%';
      bar.title = item.title;
      const barLabel = document.createElement('span');
      barLabel.textContent = item.label;
      bar.appendChild(barLabel);
      const handle = document.createElement('span');
      handle.className = 'opencanvas-motion-timeline-bar-handle';
      handle.setAttribute('aria-hidden', 'true');
      bar.appendChild(handle);
      if (sequence.trigger.type === 'scroll-scene') {
        bar.setAttribute('aria-disabled', 'true');
        bar.title = item.title + ' · Drag timeline bars is disabled because scroll progress owns this sequence.';
      } else {
        bar.classList.add('opencanvas-motion-timeline-bar--draggable');
        bar.classList.add('opencanvas-motion-timeline-bar--resizable');
        bar.tabIndex = 0;
        bar.title = item.title + ' · Drag timeline bars to edit start time; drag handle to resize duration.';
        wireMotionSequenceTimelineDrag(ctx, sequence, item, bar, track);
        wireMotionSequenceTimelineResize(ctx, sequence, item, handle, bar, track);
      }
      lane.appendChild(bar);
    }
    track.appendChild(lane);
  }
  wrap.appendChild(track);
  renderMotionSequenceScrubPreview(ctx, wrap, sequence, playhead);
  renderMotionSequenceTimelinePropertyEditor(ctx, wrap, sequence);
  card.appendChild(wrap);
}

interface MotionSequenceTimelineItem {
  step: MotionSequenceStep;
  startMs: number;
  durationMs: number;
  endMs: number;
  leftPercent: number;
  widthPercent: number;
  label: string;
  title: string;
  laneKey: string;
  laneLabel: string;
}

function motionSequenceTimelineItems(
  sequence: MotionSequence,
): MotionSequenceTimelineItem[] {
  let cursorMs = 0;
  const raw = sequence.steps.map((step, index) => {
    const base = sequence.trigger.type === 'scroll-scene' ? cursorMs : step.startAtMs ?? cursorMs;
    const start = base + (step.delayMs ?? 0);
    const duration = Math.max(1, step.durationMs ?? 0);
    const end = start + duration;
    const cursorEnd = end + (step.staggerMs ?? 0) + (step.waitAfterMs ?? 0);
    cursorMs = Math.max(cursorMs, cursorEnd);
    return {
      start,
      duration,
      end,
      step,
      label: String(index + 1),
      laneKey: motionSequenceTimelineLaneKey(step),
      laneLabel: motionSequenceTimelineLaneLabel(step),
      title:
        'Step ' +
        String(index + 1) +
        ' · ' +
        step.target.type +
        ' · start ' +
        String(start) +
        'ms · duration ' +
        String(duration) +
        'ms',
    };
  });
  const total = Math.max(
    1,
    ...raw.map((item) => item.start + item.duration),
  );
  return raw.map((item) => ({
    step: item.step,
    startMs: item.start,
    durationMs: item.duration,
    endMs: item.end,
    leftPercent: Math.max(0, Math.min(100, (item.start / total) * 100)),
    widthPercent: Math.max(2, Math.min(100, (item.duration / total) * 100)),
    label: item.label,
    title: item.title,
    laneKey: item.laneKey,
    laneLabel: item.laneLabel,
  }));
}

function renderMotionSequenceScrubPreview(
  ctx: InteractionsPanelContext,
  wrap: HTMLElement,
  sequence: MotionSequence,
  playhead: HTMLElement,
): void {
  const controls = row('opencanvas-motion-timeline-scrub');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '100';
  input.step = '1';
  input.value = '0';
  input.setAttribute('aria-label', 'Scrub preview');
  const value = document.createElement('span');
  value.className = 'opencanvas-motion-timeline-scrub-value';
  value.textContent = '0%';
  const clear = compactButton('Clear preview', 'Remove Motion Sequence scrub preview styles from the editor canvas');

  const update = (percent: number, applyPreview: boolean) => {
    const clamped = Math.max(0, Math.min(100, percent));
    wrap.setAttribute('data-opencanvas-motion-preview-progress', String(clamped));
    playhead.style.left = String(clamped) + '%';
    value.textContent = String(clamped) + '%';
    if (applyPreview) {
      previewMotionSequenceAtProgress(ctx, sequence, clamped / 100);
    }
  };

  input.addEventListener('input', () => {
    const next = Number(input.value);
    if (!Number.isFinite(next)) {
      ctx.setStatus('Motion Sequence preview progress must be 0-100', 'error');
      input.value = wrap.getAttribute('data-opencanvas-motion-preview-progress') ?? '0';
      return;
    }
    update(Math.round(next), true);
  });
  clear.addEventListener('click', () => {
    input.value = '0';
    update(0, false);
    clearMotionSequencePreview(ctx, sequence);
    ctx.setStatus('Motion Sequence preview cleared', 'ok');
  });

  controls.appendChild(input);
  controls.appendChild(value);
  controls.appendChild(clear);
  wrap.appendChild(field('Scrub preview', controls));
}

function renderMotionSequenceTimelinePropertyEditor(
  ctx: InteractionsPanelContext,
  wrap: HTMLElement,
  sequence: MotionSequence,
): void {
  const panel = document.createElement('div');
  panel.className = 'opencanvas-motion-timeline-property-editor';
  panel.setAttribute('data-opencanvas-motion-timeline-property-editor', sequence.id);
  const title = document.createElement('div');
  title.className = 'opencanvas-motion-timeline-label';
  title.textContent = 'Timeline quick properties';
  panel.appendChild(title);
  renderMotionSequenceTimelinePlaybackEditor(ctx, panel, sequence);
  const quickNumberLabels: Partial<Record<EditableMotionNumber, { from: string; to: string }>> = {
    fontVariationWeight: {
      from: 'Quick from variable font weight',
      to: 'Quick to variable font weight',
    },
    fontVariationWidth: {
      from: 'Quick from variable font width',
      to: 'Quick to variable font width',
    },
    fontVariationSlant: {
      from: 'Quick from variable font slant',
      to: 'Quick to variable font slant',
    },
    strokeDasharray: {
      from: 'Quick from stroke dash array',
      to: 'Quick to stroke dash array',
    },
    strokeDashoffset: {
      from: 'Quick from stroke dash offset',
      to: 'Quick to stroke dash offset',
    },
  };

  for (let index = 0; index < sequence.steps.length; index++) {
    const step = sequence.steps[index]!;
    const stepPanel = document.createElement('div');
    stepPanel.className = 'opencanvas-motion-timeline-property-step';
    stepPanel.dataset.opencanvasMotionTimelinePropertyStep = step.id;
    const stepTitle = document.createElement('strong');
    stepTitle.textContent = 'Step ' + String(index + 1) + ' · ' + motionSequenceTimelineLaneLabel(step);
    stepPanel.appendChild(stepTitle);

    const grid = document.createElement('div');
    grid.className = 'opencanvas-motion-timeline-property-grid';

    renderMotionSequenceTimelineTargetEditor(ctx, grid, sequence, step);

    const quickDuration = numberInput(step.durationMs, 0, 10000, 10);
    quickDuration.addEventListener('change', () =>
      updateMotionStepFinite(ctx, sequence.id, step, 'durationMs', quickDuration, 0, 10000),
    );
    grid.appendChild(field('Quick duration (ms)', quickDuration));

    const quickDelay = numberInput(step.delayMs ?? 0, 0, 10000, 10);
    quickDelay.addEventListener('change', () =>
      updateMotionStepFinite(ctx, sequence.id, step, 'delayMs', quickDelay, 0, 10000),
    );
    grid.appendChild(field('Quick delay (ms)', quickDelay));

    const quickStagger = numberInput(step.staggerMs ?? 0, 0, 10000, 10);
    quickStagger.addEventListener('change', () =>
      updateMotionStepFinite(ctx, sequence.id, step, 'staggerMs', quickStagger, 0, 10000),
    );
    grid.appendChild(field('Quick stagger (ms)', quickStagger));

    const quickEasing = textInput(step.easing ?? DEFAULT_EASING, DEFAULT_EASING);
    quickEasing.addEventListener('change', () => {
      const value = quickEasing.value.trim();
      if (value.length === 0) {
        ctx.setStatus('Motion Sequence easing cannot be empty', 'error');
        quickEasing.value = step.easing ?? DEFAULT_EASING;
        return;
      }
      mutate(ctx, () => updateScrollSequenceStep(ctx, sequence.id, step.id, { easing: value }));
    });
    grid.appendChild(field('Quick easing', quickEasing));

    const fromOpacity = optionalNumberInput(motionNumberValue(step.from, 'opacity'), 0, 1, 0.05);
    fromOpacity.addEventListener('change', () =>
      updateMotionStepProperty(ctx, sequence.id, step, 'from', 'opacity', fromOpacity, 0, 1),
    );
    grid.appendChild(field('Quick from opacity', fromOpacity));

    const toOpacity = optionalNumberInput(motionNumberValue(step.to, 'opacity'), 0, 1, 0.05);
    toOpacity.addEventListener('change', () =>
      updateMotionStepProperty(ctx, sequence.id, step, 'to', 'opacity', toOpacity, 0, 1),
    );
    grid.appendChild(field('Quick to opacity', toOpacity));

    for (const key of [
      'translateX',
      'translateY',
      'scale',
      'rotate',
      'fontVariationWeight',
      'fontVariationWidth',
      'fontVariationSlant',
      'strokeDasharray',
      'strokeDashoffset',
    ] as const) {
      const spec = MOTION_NUMBER_FIELDS.find((item) => item.key === key);
      if (!spec) throw new Error('Motion Sequence number field spec missing for ' + key);
      const fromInput = optionalNumberInput(motionNumberValue(step.from, key), spec.min, spec.max, spec.step);
      fromInput.addEventListener('change', () =>
        updateMotionStepProperty(ctx, sequence.id, step, 'from', key, fromInput, spec.min, spec.max),
      );
      grid.appendChild(field(quickNumberLabels[key]?.from ?? 'Quick from ' + spec.label.toLowerCase(), fromInput));

      const toInput = optionalNumberInput(motionNumberValue(step.to, key), spec.min, spec.max, spec.step);
      toInput.addEventListener('change', () =>
        updateMotionStepProperty(ctx, sequence.id, step, 'to', key, toInput, spec.min, spec.max),
      );
      grid.appendChild(field(quickNumberLabels[key]?.to ?? 'Quick to ' + spec.label.toLowerCase(), toInput));
    }

    const fromClipPath = optionalMotionTextInput(motionTextValue(step.from, 'clipPath'), 'inset(100% 0 0 0)');
    fromClipPath.addEventListener('change', () =>
      updateMotionStepTextProperty(ctx, sequence.id, step, 'from', 'clipPath', fromClipPath),
    );
    grid.appendChild(field('Quick from clip path', fromClipPath));

    const toClipPath = optionalMotionTextInput(motionTextValue(step.to, 'clipPath'), 'inset(0 0 0 0)');
    toClipPath.addEventListener('change', () =>
      updateMotionStepTextProperty(ctx, sequence.id, step, 'to', 'clipPath', toClipPath),
    );
    grid.appendChild(field('Quick to clip path', toClipPath));

    const fromFilter = optionalMotionTextInput(motionTextValue(step.from, 'filter'), 'blur(8px)');
    fromFilter.addEventListener('change', () =>
      updateMotionStepTextProperty(ctx, sequence.id, step, 'from', 'filter', fromFilter),
    );
    grid.appendChild(field('Quick from filter', fromFilter));

    const toFilter = optionalMotionTextInput(motionTextValue(step.to, 'filter'), 'blur(0px)');
    toFilter.addEventListener('change', () =>
      updateMotionStepTextProperty(ctx, sequence.id, step, 'to', 'filter', toFilter),
    );
    grid.appendChild(field('Quick to filter', toFilter));

    stepPanel.appendChild(grid);
    panel.appendChild(stepPanel);
  }

  wrap.appendChild(panel);
}

function renderMotionSequenceTimelinePlaybackEditor(
  ctx: InteractionsPanelContext,
  panel: HTMLElement,
  sequence: MotionSequence,
): void {
  const grid = document.createElement('div');
  grid.className = 'opencanvas-motion-timeline-property-grid';
  const disabled = sequence.trigger.type === 'scroll-scene';

  const playbackDirection = selectInput(
    [...MOTION_SEQUENCE_PLAYBACK_DIRECTIONS],
    sequence.playbackDirection ?? 'normal',
  );
  playbackDirection.disabled = disabled;
  playbackDirection.addEventListener('change', () => {
    mutate(ctx, () => {
      const next = playbackDirection.value as MotionSequencePlaybackDirection;
      updateMotionSequence(ctx, sequence.id, {
        playbackDirection: next === 'normal' ? undefined : next,
      });
    });
  });
  grid.appendChild(field('Quick playback direction', playbackDirection));

  const repeatCount = numberInput(sequence.repeat?.count ?? 0, 0, 20, 1);
  repeatCount.disabled = disabled;
  repeatCount.addEventListener('change', () => {
    const next = validNumber(repeatCount, 0, 20);
    if (next === null || !Number.isInteger(next)) {
      ctx.setStatus('Motion Sequence repeat count must be an integer from 0-20', 'error');
      repeatCount.value = String(sequence.repeat?.count ?? 0);
      return;
    }
    mutate(ctx, () => {
      if (next === 0) {
        updateMotionSequence(ctx, sequence.id, { repeat: undefined });
        return;
      }
      updateMotionSequence(ctx, sequence.id, {
        repeat: { count: next, mode: sequence.repeat?.mode ?? 'restart' },
      });
    });
  });
  grid.appendChild(field('Quick repeat count', repeatCount));

  const repeatMode = selectInput([...MOTION_SEQUENCE_REPEAT_MODES], sequence.repeat?.mode ?? 'restart');
  repeatMode.disabled = disabled;
  repeatMode.addEventListener('change', () => {
    mutate(ctx, () =>
      updateMotionSequence(ctx, sequence.id, {
        repeat: {
          count: sequence.repeat?.count ?? 1,
          mode: repeatMode.value as MotionSequenceRepeatMode,
        },
      }),
    );
  });
  grid.appendChild(field('Quick repeat mode', repeatMode));

  panel.appendChild(grid);
}

function renderMotionSequenceTimelineTargetEditor(
  ctx: InteractionsPanelContext,
  grid: HTMLElement,
  sequence: MotionSequence,
  step: MotionSequenceStep,
): void {
  const targetType = selectInput([...BEHAVIOUR_TARGET_TYPES], step.target.type);
  targetType.addEventListener('change', () => {
    mutate(ctx, () =>
      updateScrollSequenceStep(ctx, sequence.id, step.id, {
        target: defaultMotionTargetForType(ctx, targetType.value),
      }),
    );
  });
  grid.appendChild(field('Quick target type', targetType));

  if (step.target.type === 'page') {
    const pageIds = ctx.state?.pages.map((page) => page.id) ?? [];
    const page = selectInput(
      pageIds,
      pageIds.includes(step.target.pageId) ? step.target.pageId : pageIds[0] ?? step.target.pageId,
    );
    page.addEventListener('change', () => {
      mutate(ctx, () =>
        updateScrollSequenceStep(ctx, sequence.id, step.id, {
          target: { type: 'page', pageId: page.value },
        }),
      );
    });
    grid.appendChild(field('Quick target page', page));
    return;
  }

  if (step.target.type === 'section') {
    const sectionIds = activePageSections(ctx).map((sectionItem) => sectionItem.id);
    const section = selectInput(
      sectionIds,
      sectionIds.includes(step.target.sectionId) ? step.target.sectionId : sectionIds[0] ?? step.target.sectionId,
    );
    section.addEventListener('change', () => {
      mutate(ctx, () =>
        updateScrollSequenceStep(ctx, sequence.id, step.id, {
          target: { type: 'section', sectionId: section.value },
        }),
      );
    });
    grid.appendChild(field('Quick target section', section));
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
      mutate(ctx, () =>
        updateScrollSequenceStep(ctx, sequence.id, step.id, {
          target:
            target.type === 'text-split'
              ? { ...target, elementId: value }
              : { type: 'element', elementId: value },
        }),
      );
    });
    grid.appendChild(field('Quick target element', elementId));

    if (target.type === 'text-split') {
      const unit = selectInput([...TEXT_SPLIT_UNITS], target.unit);
      unit.addEventListener('change', () => {
        mutate(ctx, () =>
          updateScrollSequenceStep(ctx, sequence.id, step.id, {
            target: { ...target, unit: unit.value as (typeof TEXT_SPLIT_UNITS)[number] },
          }),
        );
      });
      grid.appendChild(field('Quick split unit', unit));
    }
  }
}

function wireMotionSequenceTimelineDrag(
  ctx: InteractionsPanelContext,
  sequence: MotionSequence,
  item: MotionSequenceTimelineItem,
  bar: HTMLElement,
  track: HTMLElement,
): void {
  bar.addEventListener('pointerdown', (event) => {
    if (sequence.trigger.type === 'scroll-scene') {
      ctx.setStatus('Drag timeline bars is disabled for scroll-scene sequences', 'error');
      return;
    }
    const totalMs = Math.max(1, ...motionSequenceTimelineItems(sequence).map((entry) => entry.endMs));
    const rect = track.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      ctx.setStatus('Motion Sequence timeline width is invalid', 'error');
      return;
    }
    event.preventDefault();
    bar.setPointerCapture(event.pointerId);
    bar.setAttribute('data-opencanvas-motion-timeline-dragging', 'true');
    const startX = event.clientX;
    const originalStart = item.startMs;
    const applyDrag = (clientX: number, commit: boolean) => {
      const deltaPercent = ((clientX - startX) / rect.width) * 100;
      const nextStart = Math.max(0, Math.round(originalStart + (deltaPercent / 100) * totalMs));
      const nextLeftPercent = Math.max(0, Math.min(100, (nextStart / totalMs) * 100));
      bar.style.left = nextLeftPercent.toFixed(2) + '%';
      bar.title = 'Step ' + item.label + ' · start ' + String(nextStart) + 'ms · duration ' + String(item.durationMs) + 'ms';
      if (commit) {
        mutate(ctx, () => {
          updateScrollSequenceStep(ctx, sequence.id, item.step.id, { startAtMs: nextStart });
        });
        ctx.setStatus('Motion Sequence step start updated to ' + String(nextStart) + 'ms', 'ok');
      }
    };
    const move = (moveEvent: PointerEvent) => applyDrag(moveEvent.clientX, false);
    const finish = (upEvent: PointerEvent) => {
      bar.releasePointerCapture(upEvent.pointerId);
      bar.removeAttribute('data-opencanvas-motion-timeline-dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', finish);
      bar.removeEventListener('pointercancel', cancel);
      applyDrag(upEvent.clientX, true);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      bar.releasePointerCapture(cancelEvent.pointerId);
      bar.removeAttribute('data-opencanvas-motion-timeline-dragging');
      bar.style.left = item.leftPercent.toFixed(2) + '%';
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', finish);
      bar.removeEventListener('pointercancel', cancel);
      ctx.setStatus('Motion Sequence timeline drag cancelled', 'error');
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', finish);
    bar.addEventListener('pointercancel', cancel);
  });
}

function wireMotionSequenceTimelineResize(
  ctx: InteractionsPanelContext,
  sequence: MotionSequence,
  item: MotionSequenceTimelineItem,
  handle: HTMLElement,
  bar: HTMLElement,
  track: HTMLElement,
): void {
  handle.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
    if (sequence.trigger.type === 'scroll-scene') {
      ctx.setStatus('Timeline resize is disabled for scroll-scene sequences', 'error');
      return;
    }
    const totalMs = Math.max(1, ...motionSequenceTimelineItems(sequence).map((entry) => entry.endMs));
    const rect = track.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || rect.width <= 0) {
      ctx.setStatus('Motion Sequence timeline width is invalid', 'error');
      return;
    }
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    bar.setAttribute('data-opencanvas-motion-timeline-resizing', 'true');
    const startX = event.clientX;
    const originalDuration = item.durationMs;
    const applyResize = (clientX: number, commit: boolean) => {
      const deltaPercent = ((clientX - startX) / rect.width) * 100;
      const nextDuration = Math.max(1, Math.min(10000, Math.round(originalDuration + (deltaPercent / 100) * totalMs)));
      const nextWidthPercent = Math.max(2, Math.min(100, (nextDuration / totalMs) * 100));
      bar.style.width = nextWidthPercent.toFixed(2) + '%';
      bar.title = 'Step ' + item.label + ' · start ' + String(item.startMs) + 'ms · duration ' + String(nextDuration) + 'ms';
      if (commit) {
        mutate(ctx, () => {
          updateScrollSequenceStep(ctx, sequence.id, item.step.id, { durationMs: nextDuration });
        });
        ctx.setStatus('Motion Sequence step duration updated to ' + String(nextDuration) + 'ms', 'ok');
      }
    };
    const move = (moveEvent: PointerEvent) => applyResize(moveEvent.clientX, false);
    const finish = (upEvent: PointerEvent) => {
      handle.releasePointerCapture(upEvent.pointerId);
      bar.removeAttribute('data-opencanvas-motion-timeline-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel);
      applyResize(upEvent.clientX, true);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      handle.releasePointerCapture(cancelEvent.pointerId);
      bar.removeAttribute('data-opencanvas-motion-timeline-resizing');
      bar.style.width = item.widthPercent.toFixed(2) + '%';
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', cancel);
      ctx.setStatus('Motion Sequence timeline resize cancelled', 'error');
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', cancel);
  });
}

const MOTION_PREVIEW_STYLE_PROPS = [
  'opacity',
  'transform',
  'filter',
  'clip-path',
  'font-variation-settings',
  'stroke-dasharray',
  'stroke-dashoffset',
] as const;

function clearMotionSequencePreview(ctx: InteractionsPanelContext, sequence: MotionSequence): void {
  const seen = new Set<HTMLElement>();
  for (const step of sequence.steps) {
    for (const node of resolveMotionPreviewTargets(ctx, step.target, false)) {
      if (seen.has(node)) continue;
      seen.add(node);
      for (const prop of MOTION_PREVIEW_STYLE_PROPS) {
        node.style.removeProperty(prop);
      }
      node.removeAttribute('data-opencanvas-motion-previewing');
    }
  }
}

function previewMotionSequenceAtProgress(
  ctx: InteractionsPanelContext,
  sequence: MotionSequence,
  progress: number,
): void {
  clearMotionSequencePreview(ctx, sequence);
  const scheduled = motionSequenceTimelineItems(sequence);
  const totalMs = Math.max(1, ...scheduled.map((item) => item.endMs));
  const currentMs = Math.max(0, Math.min(1, progress)) * totalMs;
  for (const item of scheduled) {
    if (currentMs < item.startMs) continue;
    const localProgress = Math.max(0, Math.min(1, (currentMs - item.startMs) / item.durationMs));
    const targets = resolveMotionPreviewTargets(ctx, item.step.target, true);
    if (targets.length === 0) return;
    for (const target of targets) {
      applyMotionPreviewStep(target, item.step, localProgress);
    }
  }
}

function resolveMotionPreviewTargets(
  ctx: InteractionsPanelContext,
  target: MotionSequenceStep['target'],
  reportMissing: boolean,
): HTMLElement[] {
  const root = ctx.root;
  if (!root) {
    if (reportMissing) ctx.setStatus('Motion Sequence preview root is missing', 'error');
    return [];
  }
  const query = (selector: string) => Array.from(root.querySelectorAll<HTMLElement>(selector));
  let nodes: HTMLElement[] = [];
  if (target.type === 'site') {
    nodes = [root];
  } else if (target.type === 'page') {
    nodes = query('[data-opencanvas-page="' + cssAttrEscape(target.pageId) + '"]');
  } else if (target.type === 'section') {
    nodes = query('[data-opencanvas-section="' + cssAttrEscape(target.sectionId) + '"]');
  } else if (target.type === 'element') {
    nodes = query('[data-opencanvas-element="' + cssAttrEscape(target.elementId) + '"]');
  } else if (target.type === 'text-split') {
    nodes = query(
      '[data-opencanvas-element="' + cssAttrEscape(target.elementId) + '"] .opencanvas-text-split',
    );
  }
  if (nodes.length === 0 && reportMissing) {
    ctx.setStatus('Motion Sequence preview target missing: ' + motionPreviewTargetLabel(target), 'error');
  }
  return nodes;
}

function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function motionPreviewTargetLabel(target: MotionSequenceStep['target']): string {
  if (target.type === 'site') return 'site';
  if (target.type === 'page') return 'page ' + target.pageId;
  if (target.type === 'section') return 'section ' + target.sectionId;
  if (target.type === 'element') return 'element ' + target.elementId;
  if (target.type === 'text-split') return 'text split ' + target.elementId + ' (' + target.unit + ')';
  return (target as { type: string }).type;
}

function applyMotionPreviewStep(
  node: HTMLElement,
  step: MotionSequenceStep,
  progress: number,
): void {
  node.setAttribute('data-opencanvas-motion-previewing', 'true');
  const opacity = motionPreviewNumber(step, 'opacity', 1, progress);
  if (opacity !== null) node.style.opacity = opacity.toFixed(3);
  const transform = motionPreviewTransform(step, progress);
  if (transform !== '') node.style.transform = transform;
  const filter = motionPreviewText(step, 'filter', progress);
  if (filter !== null) node.style.filter = filter;
  const clipPath = motionPreviewText(step, 'clipPath', progress);
  if (clipPath !== null) node.style.clipPath = clipPath;
  const fontVariation = motionPreviewFontVariation(step, progress);
  if (fontVariation !== '') node.style.fontVariationSettings = fontVariation;
  const strokeDasharray = motionPreviewNumber(step, 'strokeDasharray', 0, progress);
  if (strokeDasharray !== null) node.style.strokeDasharray = strokeDasharray.toFixed(2);
  const strokeDashoffset = motionPreviewNumber(step, 'strokeDashoffset', 0, progress);
  if (strokeDashoffset !== null) node.style.strokeDashoffset = strokeDashoffset.toFixed(2);
}

function motionPreviewNumber(
  step: MotionSequenceStep,
  key: EditableMotionNumber,
  defaultValue: number,
  progress: number,
): number | null {
  const from = step.from?.[key];
  const to = step.to?.[key];
  if (from === undefined && to === undefined) return null;
  const start = typeof from === 'number' ? from : defaultValue;
  const end = typeof to === 'number' ? to : start;
  return start + (end - start) * progress;
}

function motionPreviewText(
  step: MotionSequenceStep,
  key: EditableMotionText,
  progress: number,
): string | null {
  const from = step.from?.[key];
  const to = step.to?.[key];
  if (from === undefined && to === undefined) return null;
  if (progress >= 1 && typeof to === 'string') return to;
  if (typeof from === 'string') return from;
  return typeof to === 'string' ? to : null;
}

function motionPreviewTransform(step: MotionSequenceStep, progress: number): string {
  const translateX = motionPreviewNumber(step, 'translateX', 0, progress);
  const translateY = motionPreviewNumber(step, 'translateY', 0, progress);
  const scale = motionPreviewNumber(step, 'scale', 1, progress);
  const rotate = motionPreviewNumber(step, 'rotate', 0, progress);
  const parts: string[] = [];
  if (translateX !== null || translateY !== null) {
    parts.push('translate(' + String(translateX ?? 0) + 'px,' + String(translateY ?? 0) + 'px)');
  }
  if (scale !== null) parts.push('scale(' + scale.toFixed(4) + ')');
  if (rotate !== null) parts.push('rotate(' + rotate.toFixed(3) + 'deg)');
  return parts.join(' ');
}

function motionPreviewFontVariation(step: MotionSequenceStep, progress: number): string {
  const weight = motionPreviewNumber(step, 'fontVariationWeight', 400, progress);
  const width = motionPreviewNumber(step, 'fontVariationWidth', 100, progress);
  const slant = motionPreviewNumber(step, 'fontVariationSlant', 0, progress);
  const parts: string[] = [];
  if (weight !== null) parts.push('"wght" ' + weight.toFixed(2));
  if (width !== null) parts.push('"wdth" ' + width.toFixed(2));
  if (slant !== null) parts.push('"slnt" ' + slant.toFixed(2));
  return parts.join(', ');
}

function motionSequenceTimelineLaneKey(step: MotionSequenceStep): string {
  const target = step.target;
  if (target.type === 'site') return 'site';
  if (target.type === 'page') return 'page:' + target.pageId;
  if (target.type === 'section') return 'section:' + target.sectionId;
  if (target.type === 'element') return 'element:' + target.elementId;
  if (target.type === 'text-split') return 'text-split:' + target.elementId + ':' + target.unit;
  return (target as { type: string }).type;
}

function motionSequenceTimelineLaneLabel(step: MotionSequenceStep): string {
  const target = step.target;
  if (target.type === 'site') return 'site';
  if (target.type === 'page') return 'page ' + target.pageId;
  if (target.type === 'section') return 'section ' + target.sectionId;
  if (target.type === 'element') return 'element ' + target.elementId;
  if (target.type === 'text-split') return 'text ' + target.unit + ' ' + target.elementId;
  return (target as { type: string }).type;
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
  renderMotionTextEffectControl(ctx, card, sequence, step);

  renderMotionPropertyGroup(ctx, card, sequence, step, 'from');
  renderMotionPropertyGroup(ctx, card, sequence, step, 'to');

  const startAt = optionalNumberInput(step.startAtMs, 0, 60000, 10);
  startAt.disabled = sequence.trigger.type === 'scroll-scene';
  startAt.addEventListener('change', () =>
    updateMotionStepOptionalFinite(ctx, sequence.id, step, 'startAtMs', startAt, 0, 60000),
  );
  card.appendChild(field('Start at (ms)', startAt));

  const delay = numberInput(step.delayMs ?? 0, 0, 10000, 10);
  delay.addEventListener('change', () => updateMotionStepFinite(ctx, sequence.id, step, 'delayMs', delay, 0, 10000));
  card.appendChild(field('Delay (ms)', delay));

  const waitAfter = numberInput(step.waitAfterMs ?? 0, 0, 10000, 10);
  waitAfter.disabled = sequence.trigger.type === 'scroll-scene';
  waitAfter.addEventListener('change', () =>
    updateMotionStepFinite(ctx, sequence.id, step, 'waitAfterMs', waitAfter, 0, 10000),
  );
  card.appendChild(field('Wait after (ms)', waitAfter));

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

function renderMotionTextEffectControl(
  ctx: InteractionsPanelContext,
  card: HTMLElement,
  sequence: MotionSequence,
  step: MotionSequenceStep,
): void {
  if (step.target.type !== 'text-split') return;
  const effect = selectInput([...MOTION_SEQUENCE_TEXT_EFFECTS], step.textEffect ?? 'none');
  effect.addEventListener('change', () => {
    const next = effect.value as MotionSequenceTextEffect;
    mutate(ctx, () => updateMotionStepTextEffect(ctx, sequence.id, step.id, next));
  });
  card.appendChild(field('Text effect', effect));
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
  for (const spec of MOTION_TEXT_FIELDS) {
    const input = optionalMotionTextInput(motionTextValue(step[side], spec.key), spec.placeholder);
    input.addEventListener('change', () => updateMotionStepTextProperty(ctx, sequence.id, step, side, spec.key, input));
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

function optionalMotionTextInput(value: string | undefined, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  input.value = value ?? '';
  return input;
}

function motionTextValue(
  props: MotionSequenceStep['from'] | MotionSequenceStep['to'] | undefined,
  key: EditableMotionText,
): string | undefined {
  const value = props?.[key];
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
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

function updateMotionStepTextProperty(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  step: MotionSequenceStep,
  side: MotionPropertySide,
  key: EditableMotionText,
  input: HTMLInputElement,
): void {
  const value = input.value.trim();
  const current = { ...(step[side] ?? {}) };
  if (value.length === 0) {
    delete current[key];
    if (side === 'to' && Object.keys(current).length === 0) {
      ctx.setStatus('Motion Sequence "to" properties need at least one value', 'error');
      input.value = motionTextValue(step[side], key) ?? '';
      return;
    }
    mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [side]: current }));
    return;
  }
  current[key] = value;
  mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [side]: current }));
}

function updateMotionStepFinite(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  step: MotionSequenceStep,
  key: 'delayMs' | 'durationMs' | 'waitAfterMs' | 'staggerMs',
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

function updateMotionStepOptionalFinite(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  step: MotionSequenceStep,
  key: 'startAtMs',
  input: HTMLInputElement,
  min: number,
  max: number,
): void {
  const value = input.value.trim();
  if (value.length === 0) {
    mutate(ctx, () => {
      ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) => {
        if (sequence.id !== sequenceId) return sequence;
        return {
          ...sequence,
          steps: sequence.steps.map((candidate) => {
            if (candidate.id !== step.id) return candidate;
            const next = { ...candidate };
            delete next[key];
            return next;
          }),
        };
      });
    });
    return;
  }
  const next = Number(value);
  if (!Number.isFinite(next) || next < min || next > max) {
    ctx.setStatus('Motion Sequence ' + key + ' must be ' + String(min) + '-' + String(max), 'error');
    input.value = String(step[key] ?? '');
    return;
  }
  mutate(ctx, () => updateScrollSequenceStep(ctx, sequenceId, step.id, { [key]: next }));
}

function updateMotionSequence(
  ctx: InteractionsPanelContext,
  sequenceId: string,
  patch: MotionSequencePatch,
): void {
  ctx.state!.motionSequences = (ctx.state!.motionSequences ?? []).map((sequence) =>
    sequence.id === sequenceId ? motionSequenceWithPatch(sequence, patch) : sequence,
  );
}

function motionSequenceWithPatch(sequence: MotionSequence, patch: MotionSequencePatch): MotionSequence {
  const { repeat, playbackDirection, ...rest } = patch;
  const next: MotionSequence = { ...sequence, ...rest };
  if ('repeat' in patch) {
    if (repeat === undefined) {
      delete next.repeat;
    } else {
      next.repeat = repeat;
    }
  }
  if ('playbackDirection' in patch) {
    if (playbackDirection === undefined) {
      delete next.playbackDirection;
    } else {
      next.playbackDirection = playbackDirection;
    }
  }
  return next;
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

  const runPolicy = selectInput([...BEHAVIOUR_LOAD_RUN_POLICIES], load.runPolicy ?? 'every-visit');
  runPolicy.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.loadExperience = {
        ...load,
        runPolicy: runPolicy.value as BehaviourLoadRunPolicy,
      };
    });
  });
  wrap.appendChild(field('Behaviour run policy', runPolicy));

  const progressDisplay = selectInput(
    [...LOAD_PROGRESS_DISPLAY_MODES],
    load.progress?.display ?? 'hidden',
  );
  progressDisplay.addEventListener('change', () => {
    const display = progressDisplay.value as LoadProgressDisplayMode;
    updateBehaviourLoadProgress(
      ctx,
      display === 'hidden'
        ? undefined
        : {
            display,
            durationMs: load.progress?.durationMs ?? 1200,
            label: load.progress?.label ?? 'Loading',
          },
    );
  });
  wrap.appendChild(field('Progress display', progressDisplay));

  const progressDuration = numberInput(load.progress?.durationMs ?? 1200, 0, 30000, 100);
  progressDuration.disabled = !load.progress || load.progress.display === 'hidden';
  progressDuration.addEventListener('change', () => {
    const value = Number(progressDuration.value);
    if (!Number.isFinite(value) || value < 0 || value > 30000) {
      ctx.setStatus('Load progress duration must be 0-30000ms', 'error');
      progressDuration.value = String(load.progress?.durationMs ?? 1200);
      return;
    }
    updateBehaviourLoadProgress(ctx, {
      display: load.progress?.display ?? 'bar-number',
      durationMs: value,
      label: load.progress?.label ?? 'Loading',
    });
  });
  wrap.appendChild(field('Progress duration', progressDuration));

  const progressLabel = textInput(load.progress?.label ?? 'Loading', 'Loading');
  progressLabel.disabled = !load.progress || load.progress.display === 'hidden';
  progressLabel.addEventListener('change', () => {
    const value = progressLabel.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Load progress label cannot be empty', 'error');
      progressLabel.value = load.progress?.label ?? 'Loading';
      return;
    }
    updateBehaviourLoadProgress(ctx, {
      display: load.progress?.display ?? 'bar-number',
      durationMs: load.progress?.durationMs ?? 1200,
      label: value,
    });
  });
  wrap.appendChild(field('Progress label', progressLabel));

  const readinessAssets = textInput(
    load.mediaReadiness?.assetIds.join(', ') ?? '',
    'asset-id, poster-id',
  );
  readinessAssets.addEventListener('change', () => {
    const raw = readinessAssets.value.trim();
    if (raw.length === 0) {
      updateBehaviourLoadReadiness(ctx, undefined);
      return;
    }
    const assetIds = raw.split(',').map((assetId) => assetId.trim());
    const invalid = assetIds.find((assetId) => assetId.length === 0 || /\s/.test(assetId));
    if (invalid !== undefined) {
      ctx.setStatus('Media readiness asset ids cannot be empty or contain whitespace', 'error');
      readinessAssets.value = load.mediaReadiness?.assetIds.join(', ') ?? '';
      return;
    }
    updateBehaviourLoadReadiness(ctx, {
      assetIds,
      timeoutMs: load.mediaReadiness?.timeoutMs ?? 8000,
    });
  });
  wrap.appendChild(field('Media readiness assets', readinessAssets));

  const readinessTimeout = numberInput(load.mediaReadiness?.timeoutMs ?? 8000, 0, 30000, 100);
  readinessTimeout.disabled = !load.mediaReadiness;
  readinessTimeout.addEventListener('change', () => {
    const value = Number(readinessTimeout.value);
    if (!Number.isFinite(value) || value < 0 || value > 30000) {
      ctx.setStatus('Media readiness timeout must be 0-30000ms', 'error');
      readinessTimeout.value = String(load.mediaReadiness?.timeoutMs ?? 8000);
      return;
    }
    updateBehaviourLoadReadiness(ctx, {
      assetIds: load.mediaReadiness?.assetIds ?? [],
      timeoutMs: value,
    });
  });
  wrap.appendChild(field('Media readiness timeout', readinessTimeout));

  const logoDrawText = textInput(load.logoDraw?.text ?? '', 'Wordmark text');
  logoDrawText.addEventListener('change', () => {
    const value = logoDrawText.value.trim();
    if (value.length === 0) {
      updateBehaviourLoadLogoDraw(ctx, undefined);
      return;
    }
    updateBehaviourLoadLogoDraw(ctx, {
      text: value,
      durationMs: load.logoDraw?.durationMs ?? 1200,
      strokeWidth: load.logoDraw?.strokeWidth ?? 2,
    });
  });
  wrap.appendChild(field('Logo draw text', logoDrawText));

  const logoDrawDuration = numberInput(load.logoDraw?.durationMs ?? 1200, 0, 30000, 100);
  logoDrawDuration.disabled = !load.logoDraw;
  logoDrawDuration.addEventListener('change', () => {
    const value = Number(logoDrawDuration.value);
    if (!Number.isFinite(value) || value < 0 || value > 30000) {
      ctx.setStatus('Logo draw duration must be 0-30000ms', 'error');
      logoDrawDuration.value = String(load.logoDraw?.durationMs ?? 1200);
      return;
    }
    updateBehaviourLoadLogoDraw(ctx, {
      text: load.logoDraw?.text ?? load.label,
      durationMs: value,
      strokeWidth: load.logoDraw?.strokeWidth ?? 2,
    });
  });
  wrap.appendChild(field('Logo draw duration', logoDrawDuration));

  const logoDrawStroke = numberInput(load.logoDraw?.strokeWidth ?? 2, 0.1, 20, 0.1);
  logoDrawStroke.disabled = !load.logoDraw;
  logoDrawStroke.addEventListener('change', () => {
    const value = Number(logoDrawStroke.value);
    if (!Number.isFinite(value) || value <= 0 || value > 20) {
      ctx.setStatus('Logo draw stroke width must be >0 and <=20', 'error');
      logoDrawStroke.value = String(load.logoDraw?.strokeWidth ?? 2);
      return;
    }
    updateBehaviourLoadLogoDraw(ctx, {
      text: load.logoDraw?.text ?? load.label,
      durationMs: load.logoDraw?.durationMs ?? 1200,
      strokeWidth: value,
    });
  });
  wrap.appendChild(field('Logo draw stroke', logoDrawStroke));

  const handoffEffect = selectInput([...LOAD_HANDOFF_EFFECTS], load.handoff?.effect ?? 'mask-open');
  handoffEffect.addEventListener('change', () => {
    updateBehaviourLoadHandoff(ctx, {
      effect: handoffEffect.value as NonNullable<BehaviourLoadExperience['handoff']>['effect'],
      durationMs: load.handoff?.durationMs ?? 420,
      easing: load.handoff?.easing ?? 'cubic-bezier(.76,0,.24,1)',
    });
  });
  wrap.appendChild(field('Handoff effect', handoffEffect));

  const handoffDuration = numberInput(load.handoff?.durationMs ?? 420, 0, 30000, 20);
  handoffDuration.addEventListener('change', () => {
    const value = Number(handoffDuration.value);
    if (!Number.isFinite(value) || value < 0 || value > 30000) {
      ctx.setStatus('Load handoff duration must be 0-30000ms', 'error');
      handoffDuration.value = String(load.handoff?.durationMs ?? 420);
      return;
    }
    updateBehaviourLoadHandoff(ctx, {
      effect: load.handoff?.effect ?? 'mask-open',
      durationMs: value,
      easing: load.handoff?.easing ?? 'cubic-bezier(.76,0,.24,1)',
    });
  });
  wrap.appendChild(field('Handoff duration', handoffDuration));

  const handoffEasing = textInput(load.handoff?.easing ?? 'cubic-bezier(.76,0,.24,1)', 'ease-out');
  handoffEasing.addEventListener('change', () => {
    const value = handoffEasing.value.trim();
    if (value.length === 0) {
      ctx.setStatus('Load handoff easing cannot be empty', 'error');
      handoffEasing.value = load.handoff?.easing ?? 'cubic-bezier(.76,0,.24,1)';
      return;
    }
    updateBehaviourLoadHandoff(ctx, {
      effect: load.handoff?.effect ?? 'mask-open',
      durationMs: load.handoff?.durationMs ?? 420,
      easing: value,
    });
  });
  wrap.appendChild(field('Handoff easing', handoffEasing));

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

function updateBehaviourLoadProgress(
  ctx: InteractionsPanelContext,
  progress: BehaviourLoadExperience['progress'] | undefined,
): void {
  mutate(ctx, () => {
    const current = ctx.state!.loadExperience;
    if (!isBehaviourLoadExperience(current)) return;
    const next: BehaviourLoadExperience = { ...current };
    if (progress === undefined) {
      delete next.progress;
    } else {
      next.progress = progress;
    }
    ctx.state!.loadExperience = next;
  });
}

function updateBehaviourLoadReadiness(
  ctx: InteractionsPanelContext,
  mediaReadiness: BehaviourLoadExperience['mediaReadiness'] | undefined,
): void {
  mutate(ctx, () => {
    const current = ctx.state!.loadExperience;
    if (!isBehaviourLoadExperience(current)) return;
    const next: BehaviourLoadExperience = { ...current };
    if (mediaReadiness === undefined) {
      delete next.mediaReadiness;
    } else {
      next.mediaReadiness = mediaReadiness;
    }
    ctx.state!.loadExperience = next;
  });
}

function updateBehaviourLoadLogoDraw(
  ctx: InteractionsPanelContext,
  logoDraw: BehaviourLoadExperience['logoDraw'] | undefined,
): void {
  mutate(ctx, () => {
    const current = ctx.state!.loadExperience;
    if (!isBehaviourLoadExperience(current)) return;
    const next: BehaviourLoadExperience = { ...current };
    if (logoDraw === undefined) {
      delete next.logoDraw;
    } else {
      next.logoDraw = logoDraw;
    }
    ctx.state!.loadExperience = next;
  });
}

function updateBehaviourLoadHandoff(
  ctx: InteractionsPanelContext,
  handoff: NonNullable<BehaviourLoadExperience['handoff']>,
): void {
  mutate(ctx, () => {
    const current = ctx.state!.loadExperience;
    if (!isBehaviourLoadExperience(current)) return;
    ctx.state!.loadExperience = { ...current, handoff };
  });
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

function activePageElementIds(ctx: InteractionsPanelContext): string[] {
  const ids: string[] = [];
  for (const section of activePageSections(ctx)) {
    for (const element of section.elements) {
      ids.push(element.id);
    }
  }
  return ids;
}

function renderLayoutTransitionControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Layout Transitions');
  const transitions = ctx.state.layoutTransitions ?? [];
  const add = actionButton(
    'Add layout transition',
    'Morph one same-page element state into another through the Runtime Hydrator',
  );
  add.addEventListener('click', () => {
    if (!ctx.selectedElementId) {
      ctx.setStatus('Select a trigger/source element before adding a layout transition.', 'error');
      return;
    }
    const elementIds = activePageElementIds(ctx);
    const targetElementId = elementIds.find((id) => id !== ctx.selectedElementId);
    if (!targetElementId) {
      ctx.setStatus('Add another element on the active page before adding a layout transition.', 'error');
      return;
    }
    const triggerElementId = ctx.selectedElementId;
    mutate(ctx, () => {
      const next = [...(ctx.state!.layoutTransitions ?? [])];
      const index = next.length + 1;
      next.push(
        defaultLayoutTransition(
          'layout-transition-' + String(Date.now()),
          'Layout transition ' + String(index),
          triggerElementId,
          targetElementId,
        ),
      );
      ctx.state!.layoutTransitions = next;
    });
    ctx.setStatus('Layout transition added', 'ok');
  });
  wrap.appendChild(add);
  if (transitions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'opencanvas-section-picker-empty';
    empty.textContent = 'No layout transitions yet.';
    wrap.appendChild(empty);
  }
  for (const transition of transitions) {
    renderLayoutTransitionCard(ctx, wrap, transition);
  }
  host.appendChild(wrap);
}

function renderLayoutTransitionCard(
  ctx: InteractionsPanelContext,
  host: HTMLElement,
  transition: LayoutTransition,
): void {
  const card = document.createElement('div');
  card.className = 'opencanvas-interactions-card';
  const header = row('opencanvas-interactions-card-header');
  const title = document.createElement('strong');
  title.textContent = transition.name;
  header.appendChild(title);
  const remove = compactButton('Remove', 'Remove this layout transition');
  remove.addEventListener('click', () => {
    mutate(ctx, () => {
      ctx.state!.layoutTransitions = (ctx.state!.layoutTransitions ?? []).filter(
        (item) => item.id !== transition.id,
      );
    });
  });
  header.appendChild(remove);
  card.appendChild(header);

  const name = textInput(transition.name, 'Card detail');
  name.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, { name: name.value.trim() }),
  );
  card.appendChild(field('Name', name));

  const trigger = textInput(transition.triggerElementId, 'Trigger element id');
  trigger.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, { triggerElementId: trigger.value.trim() }),
  );
  card.appendChild(field('Trigger element', trigger));

  const reverseTrigger = textInput(transition.reverseTriggerElementId ?? '', 'Close trigger element id');
  reverseTrigger.addEventListener('change', () => {
    const value = reverseTrigger.value.trim();
    if (value.length > 0) {
      updateLayoutTransition(ctx, transition.id, { reverseTriggerElementId: value });
      return;
    }
    clearLayoutTransitionReverseTrigger(ctx, transition.id);
  });
  card.appendChild(field('Reverse trigger element id', reverseTrigger));

  const source = textInput(transition.sourceElementId, 'Source element id');
  source.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, { sourceElementId: source.value.trim() }),
  );
  card.appendChild(field('Source element', source));

  const target = textInput(transition.targetElementId, 'Target element id');
  target.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, { targetElementId: target.value.trim() }),
  );
  card.appendChild(field('Target element', target));

  const viewName = textInput(transition.viewTransitionName, 'cardDetail');
  viewName.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, { viewTransitionName: viewName.value.trim() }),
  );
  card.appendChild(field('View transition name', viewName));

  const initialState = selectInput(LAYOUT_TRANSITION_INITIAL_STATES, transition.initialState);
  initialState.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, {
      initialState: initialState.value as LayoutTransition['initialState'],
    }),
  );
  card.appendChild(field('Initial state', initialState));

  const reducedMotion = selectInput(
    LAYOUT_TRANSITION_REDUCED_MOTION_MODES,
    transition.reducedMotion,
  );
  reducedMotion.addEventListener('change', () =>
    updateLayoutTransition(ctx, transition.id, {
      reducedMotion: reducedMotion.value as LayoutTransition['reducedMotion'],
    }),
  );
  card.appendChild(field('Reduced motion', reducedMotion));

  host.appendChild(card);
}

function updateLayoutTransition(
  ctx: InteractionsPanelContext,
  transitionId: string,
  patch: Partial<LayoutTransition>,
): void {
  if (Object.values(patch).some((value) => typeof value === 'string' && value.length === 0)) {
    ctx.setStatus('Layout transition fields cannot be empty', 'error');
    renderInteractionsPanel(ctx);
    return;
  }
  mutate(ctx, () => {
    const transitions = ctx.state!.layoutTransitions ?? [];
    ctx.state!.layoutTransitions = transitions.map((transition) => {
      if (transition.id !== transitionId) return transition;
      const next = { ...transition, ...patch };
      if (next.sourceElementId === next.targetElementId) {
        ctx.setStatus('Layout transition source and target must be different elements', 'error');
        return transition;
      }
      return next;
    });
  });
}

function clearLayoutTransitionReverseTrigger(ctx: InteractionsPanelContext, transitionId: string): void {
  if (!ctx.state) return;
  mutate(ctx, () => {
    const transitions = ctx.state!.layoutTransitions ?? [];
    ctx.state!.layoutTransitions = transitions.map((transition) => {
      if (transition.id !== transitionId) return transition;
      const next = { ...transition };
      delete next.reverseTriggerElementId;
      return next;
    });
  });
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

function renderSmoothScrollControls(ctx: InteractionsPanelContext, host: HTMLElement): void {
  if (!ctx.state) return;
  const wrap = section('Smooth Scroll');
  const current = ctx.state.scrollBehavior ?? {};
  const modeValue = current.mode ?? (current.smooth === true ? 'native' : 'off');
  const mode = selectInput(['off', ...SCROLL_BEHAVIOR_MODES], modeValue);

  mode.addEventListener('change', () => {
    const value = mode.value as ScrollBehaviorMode | 'off';
    if (value === 'off') {
      updateSmoothScroll(ctx, {
        smooth: undefined,
        mode: undefined,
        durationMs: undefined,
        reducedMotion: undefined,
      });
      return;
    }
    if (value === 'native') {
      updateSmoothScroll(ctx, {
        smooth: true,
        mode: 'native',
        durationMs: undefined,
        reducedMotion: undefined,
      });
      return;
    }
    updateSmoothScroll(ctx, {
      smooth: undefined,
      mode: 'inertial',
      durationMs: current.durationMs ?? 900,
      reducedMotion: current.reducedMotion ?? 'native',
    });
  });
  wrap.appendChild(field('Mode', mode));

  const duration = document.createElement('input');
  duration.type = 'number';
  duration.min = '100';
  duration.max = '5000';
  duration.step = '50';
  duration.value = String(current.durationMs ?? 900);
  duration.disabled = modeValue !== 'inertial';
  duration.addEventListener('change', () => {
    const next = Number(duration.value);
    if (!Number.isFinite(next) || next < 100 || next > 5000) {
      ctx.setStatus('Smooth Scroll duration must be between 100 and 5000ms', 'error');
      renderInteractionsPanel(ctx);
      return;
    }
    updateSmoothScroll(ctx, { mode: 'inertial', durationMs: next });
  });
  wrap.appendChild(field('Duration (ms)', duration));

  const reducedMotion = selectInput(
    [...SCROLL_BEHAVIOR_REDUCED_MOTION_MODES],
    current.reducedMotion ?? 'native',
  );
  reducedMotion.disabled = modeValue !== 'inertial';
  reducedMotion.addEventListener('change', () =>
    updateSmoothScroll(ctx, {
      mode: 'inertial',
      reducedMotion: reducedMotion.value as ScrollBehaviorReducedMotionMode,
    }),
  );
  wrap.appendChild(field('Reduced motion', reducedMotion));

  const padding = document.createElement('input');
  padding.type = 'number';
  padding.min = '0';
  padding.step = '1';
  padding.value = String(current.paddingTop ?? 0);
  padding.addEventListener('change', () => {
    const next = Number(padding.value);
    if (!Number.isFinite(next) || next < 0) {
      ctx.setStatus('Smooth Scroll padding must be 0 or greater', 'error');
      renderInteractionsPanel(ctx);
      return;
    }
    updateSmoothScroll(ctx, { paddingTop: next });
  });
  wrap.appendChild(field('Scroll padding top', padding));

  const hint = document.createElement('p');
  hint.className = 'opencanvas-section-picker-empty';
  hint.textContent =
    'Inertial mode is a schema-owned Runtime Hydrator primitive; unsupported browser APIs emit opencanvas:behaviour-failure.';
  wrap.appendChild(hint);
  host.appendChild(wrap);
}

type SmoothScrollPatch = {
  [K in keyof NonNullable<EditableSite['scrollBehavior']>]?:
    | NonNullable<EditableSite['scrollBehavior']>[K]
    | undefined;
};

function updateSmoothScroll(ctx: InteractionsPanelContext, patch: SmoothScrollPatch): void {
  mutate(ctx, () => {
    const next: SmoothScrollPatch = {
      ...(ctx.state!.scrollBehavior ?? {}),
      ...patch,
    };
    for (const key of Object.keys(next) as Array<keyof typeof next>) {
      if (next[key] === undefined) delete next[key];
    }
    if (Object.keys(next).length === 0) {
      delete ctx.state!.scrollBehavior;
    } else {
      ctx.state!.scrollBehavior = next as NonNullable<EditableSite['scrollBehavior']>;
    }
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

  const presentation = selectInput(OVERLAY_PRESENTATION_MODES, overlay.presentation?.mode ?? 'modal');
  presentation.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: presentation.value as OverlayPresentationMode,
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Presentation', presentation));

  const chrome = selectInput(OVERLAY_CHROME_PRESETS, overlay.presentation?.chrome ?? 'standard');
  chrome.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: chrome.value as OverlayChromePreset,
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Chrome preset', chrome));

  const backdrop = selectInput(OVERLAY_BACKDROP_STYLES, overlay.presentation?.backdrop ?? 'dim');
  backdrop.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: backdrop.value as OverlayBackdropStyle,
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Backdrop style', backdrop));

  const closePlacement = selectInput(
    OVERLAY_CLOSE_PLACEMENTS,
    overlay.presentation?.closePlacement ?? 'top-right',
  );
  closePlacement.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: closePlacement.value as OverlayClosePlacement,
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Close placement', closePlacement));

  const layout = selectInput(OVERLAY_LAYOUT_PRESETS, overlay.presentation?.layout ?? 'centered');
  layout.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: layout.value as OverlayLayoutPreset,
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Layout preset', layout));

  const choreography = selectInput(
    OVERLAY_CHOREOGRAPHY_PRESETS,
    overlay.presentation?.choreography ?? 'none',
  );
  choreography.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: choreography.value as OverlayChoreographyPreset,
          reducedMotion: overlay.presentation?.reducedMotion ?? 'instant',
        },
      };
    });
  });
  card.appendChild(field('Choreography', choreography));

  const reducedMotion = selectInput(
    OVERLAY_CHOREOGRAPHY_REDUCED_MOTION_MODES,
    overlay.presentation?.reducedMotion ?? 'instant',
  );
  reducedMotion.addEventListener('change', () => {
    mutate(ctx, () => {
      ctx.state!.overlays![index] = {
        ...overlay,
        presentation: {
          mode: overlay.presentation?.mode ?? 'modal',
          chrome: overlay.presentation?.chrome ?? 'standard',
          backdrop: overlay.presentation?.backdrop ?? 'dim',
          closePlacement: overlay.presentation?.closePlacement ?? 'top-right',
          layout: overlay.presentation?.layout ?? 'centered',
          choreography: overlay.presentation?.choreography ?? 'none',
          reducedMotion: reducedMotion.value as OverlayChoreographyReducedMotionMode,
        },
      };
    });
  });
  card.appendChild(field('Choreography reduced motion', reducedMotion));

  const contentCanvas = compactButton(
    'Edit content canvas',
    'Preview this overlay and edit its authored Canvas Section content',
  );
  contentCanvas.addEventListener('click', () => {
    ctx.previewOverlay(overlay.id);
    ctx.setStatus('Overlay content canvas selected: ' + overlay.content.id, 'ok');
  });
  card.appendChild(contentCanvas);

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
