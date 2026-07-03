export {};

import {
  defaultImageSequenceRichMotionAsset,
  defaultLoadExperience,
  defaultLottieRichMotionAsset,
  defaultLayoutTransition,
  defaultModel3DRichMotionAsset,
  defaultOverlay,
  defaultRiveInputBinding,
  defaultRiveRichMotionAsset,
  defaultRouteTransition,
  defaultScrollScene,
  defaultShaderSceneRichMotionAsset,
  defaultVideoStreamRichMotionAsset,
} from './interactions-panel.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[interactions-panel:smoke] ' + message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      '[interactions-panel:smoke] ' +
        message +
        ' expected=' +
        String(expected) +
        ' actual=' +
        String(actual),
    );
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      '[interactions-panel:smoke] ' +
        message +
        ' expected=' +
        expectedJson +
        ' actual=' +
        actualJson,
    );
  }
}

const overlay = defaultOverlay('overlay-a', 'Overlay A', 'page-home');
equal(overlay.id, 'overlay-a', 'overlay id');
equal(overlay.name, 'Overlay A', 'overlay name');
equal(overlay.trigger.type, 'load', 'overlay default trigger');
equal(overlay.dismissal.closeButton, true, 'overlay close button');
equal(overlay.dismissal.escape, true, 'overlay escape');
equal(overlay.dismissal.backdropClick, true, 'overlay backdrop click');
equal(overlay.dismissal.bodyScrollLock, true, 'overlay body scroll lock');
equal(overlay.dismissal.focusTrap, true, 'overlay focus trap');
equal(overlay.dismissal.returnFocus, true, 'overlay return focus');
equal(overlay.scope.type, 'pages', 'overlay scope');
deepEqual(
  overlay.scope.type === 'pages' ? overlay.scope.pageIds : [],
  ['page-home'],
  'overlay page scope',
);
equal(overlay.content.id, 'overlay-a-content', 'overlay content id');
equal(overlay.content.recipeId, 'custom', 'overlay recipe id');

const load = defaultLoadExperience();
equal(load.id, 'load-main', 'load id');
equal(load.enabled, false, 'load enabled default');
equal(load.preset, 'fade', 'load preset');
equal(load.runPolicy, 'every-visit', 'load run policy');
deepEqual(load.gates, ['document-ready'], 'load gates');
equal(load.timeoutMs, 4000, 'load timeout');

const route = defaultRouteTransition();
equal(route.id, 'route-main', 'route id');
equal(route.enabled, false, 'route enabled default');
equal(route.mode, 'fade', 'route mode');
equal(route.durationMs, 220, 'route duration');
equal(route.easing, 'ease-in-out', 'route easing');

const layout = defaultLayoutTransition('layout-a', 'Layout A', 'card-a', 'detail-a');
equal(layout.id, 'layout-a', 'layout id');
equal(layout.name, 'Layout A', 'layout name');
equal(layout.triggerElementId, 'card-a', 'layout trigger');
equal(layout.sourceElementId, 'card-a', 'layout source');
equal(layout.targetElementId, 'detail-a', 'layout target');
equal(layout.initialState, 'source', 'layout initial state');
equal(layout.reducedMotion, 'instant', 'layout reduced motion');

const scroll = defaultScrollScene('scene-a', 'section-a', 'element-a');
equal(scroll.scene.id, 'scene-a', 'scroll scene id');
equal(scroll.scene.sectionId, 'section-a', 'scroll scene section id');
equal(scroll.scene.sequenceId, 'scene-a-sequence', 'scroll scene sequence id');
equal(scroll.scene.pinTarget.type, 'section', 'scroll scene pin defaults to section');
equal(scroll.scene.startOffsetPx, 0, 'scroll scene start');
equal(scroll.scene.endOffsetPx, 720, 'scroll scene end');
equal(scroll.sequence.id, 'scene-a-sequence', 'scroll sequence id');
equal(scroll.sequence.trigger.type, 'scroll-scene', 'scroll sequence trigger type');
equal(
  scroll.sequence.trigger.type === 'scroll-scene' ? scroll.sequence.trigger.scrollSceneId : '',
  'scene-a',
  'scroll sequence trigger scene id',
);
equal(scroll.sequence.reducedMotion, 'final-state', 'scroll sequence reduced motion default');
equal(scroll.sequence.steps[0]?.target.type, 'element', 'selected element becomes first target');

const riveAsset = defaultRiveRichMotionAsset('rive-a');
equal(riveAsset.id, 'rive-a', 'rive asset id');
equal(riveAsset.kind, 'rive', 'rive asset kind');
equal(riveAsset.assetId, 'rive-a.riv', 'rive asset id default');
equal(riveAsset.stateMachine, 'State Machine 1', 'rive default state machine');
equal(riveAsset.reducedMotion, 'pause', 'rive default reduced motion');
deepEqual(riveAsset.inputs, [], 'rive default inputs');

const riveInput = defaultRiveInputBinding('input-a');
equal(riveInput.id, 'input-a', 'rive input id');
equal(riveInput.inputName, 'isHovered', 'rive input name');
equal(riveInput.inputType, 'boolean', 'rive input type');
equal(riveInput.event, 'pointer-enter', 'rive input event');
equal(riveInput.inputType === 'boolean' ? riveInput.value : false, true, 'rive input boolean value');

const videoStreamAsset = defaultVideoStreamRichMotionAsset('stream-a');
equal(videoStreamAsset.id, 'stream-a', 'video stream asset id');
equal(videoStreamAsset.kind, 'video-stream', 'video stream asset kind');
equal(videoStreamAsset.assetId, 'stream-a.mp4', 'video stream asset id default');
equal(videoStreamAsset.posterAssetId ?? '', 'stream-a-poster.webp', 'video stream poster default');
equal(videoStreamAsset.muted, true, 'video stream muted default');
equal(videoStreamAsset.playback.trigger, 'hover-focus', 'video stream trigger default');
equal(videoStreamAsset.playback.resetOnExit ?? false, true, 'video stream reset default');
equal(videoStreamAsset.reducedMotion, 'poster', 'video stream reduced-motion default');

const imageSequenceAsset = defaultImageSequenceRichMotionAsset('sequence-a');
equal(imageSequenceAsset.id, 'sequence-a', 'image sequence asset id');
equal(imageSequenceAsset.kind, 'image-sequence', 'image sequence asset kind');
deepEqual(
  imageSequenceAsset.frameAssetIds,
  ['sequence-a-frame-001.webp', 'sequence-a-frame-002.webp'],
  'image sequence frame defaults',
);
equal(imageSequenceAsset.posterAssetId, 'sequence-a-poster.webp', 'image sequence poster default');
equal(imageSequenceAsset.alt, 'Image sequence', 'image sequence alt default');
equal(imageSequenceAsset.playback.driver, 'load', 'image sequence driver default');
equal(imageSequenceAsset.playback.fps ?? 0, 24, 'image sequence fps default');
equal(imageSequenceAsset.playback.loop ?? true, false, 'image sequence loop default');

const lottieAsset = defaultLottieRichMotionAsset('lottie-a');
equal(lottieAsset.id, 'lottie-a', 'lottie asset id');
equal(lottieAsset.kind, 'lottie', 'lottie asset kind');
equal(lottieAsset.assetId, 'lottie-a.json', 'lottie asset id default');
equal(lottieAsset.renderer, 'svg', 'lottie renderer default');
equal(lottieAsset.reducedMotion, 'pause', 'lottie reduced-motion default');

const modelAsset = defaultModel3DRichMotionAsset('model-a');
equal(modelAsset.id, 'model-a', 'model asset id');
equal(modelAsset.kind, 'model-3d', 'model asset kind');
equal(modelAsset.assetId, 'model-a.glb', 'model asset id default');
equal(modelAsset.posterAssetId ?? '', 'model-a-poster.webp', 'model poster default');
equal(modelAsset.cameraControls, true, 'model camera controls default');
equal(modelAsset.reducedMotion, 'static', 'model reduced-motion default');

const shaderAsset = defaultShaderSceneRichMotionAsset('shader-a');
equal(shaderAsset.id, 'shader-a', 'shader asset id');
equal(shaderAsset.kind, 'shader-scene', 'shader asset kind');
equal(shaderAsset.preset, 'racing-lines', 'shader preset default');
equal(shaderAsset.colorA, '#C8FF1A', 'shader colorA default');
equal(shaderAsset.reducedMotion, 'static', 'shader reduced-motion default');

const panelSrc = await Bun.file(new URL('./interactions-panel.ts', import.meta.url)).text();
const behaviourPrimitivesSrc = await Bun.file(
  new URL('../canvas/behaviour-primitives.ts', import.meta.url),
).text();
assert(panelSrc.includes('BehaviourLoadExperience'), 'panel must import behaviour load experience');
assert(panelSrc.includes('Use designer enter moment'), 'panel must expose designer load mode');
assert(panelSrc.includes('LOAD_PROGRESS_DISPLAY_MODES'), 'panel must use load progress display modes');
assert(panelSrc.includes('Progress display'), 'panel must expose load progress display control');
assert(panelSrc.includes('Behaviour run policy'), 'panel must expose behaviour load run policy');
assert(panelSrc.includes('Media readiness assets'), 'panel must expose behaviour load media readiness assets');
assert(panelSrc.includes('Logo draw text'), 'panel must expose behaviour load logo draw controls');
assert(panelSrc.includes('LOAD_HANDOFF_EFFECTS'), 'panel must use schema load handoff effect values');
assert(panelSrc.includes('Handoff effect'), 'panel must expose behaviour load handoff effect');
assert(panelSrc.includes('Handoff duration'), 'panel must expose behaviour load handoff duration');
assert(panelSrc.includes('Handoff easing'), 'panel must expose behaviour load handoff easing');
assert(panelSrc.includes('Create linked sequence'), 'panel must restore missing load-enter sequence');
assert(panelSrc.includes('Linked load-enter Motion Sequence is missing'), 'panel must fail loudly for missing behaviour load sequence');
assert(panelSrc.includes('renderScrollSceneControls'), 'panel must render scroll scene controls');
assert(panelSrc.includes('ctx.state!.scrollScenes'), 'panel must mutate scroll scenes');
assert(panelSrc.includes('ctx.state!.motionSequences'), 'panel must mutate linked motion sequences');
assert(panelSrc.includes('Validation blocks publish'), 'panel must fail loudly for missing linked sequence');
assert(panelSrc.includes('Horizontal track'), 'panel must expose Scroll Scene horizontal track controls');
assert(panelSrc.includes('horizontalTrack'), 'panel must mutate Scroll Scene horizontal track state');
assert(panelSrc.includes('Before/after reveal'), 'panel must expose Scroll Scene before-after reveal controls');
assert(panelSrc.includes('beforeAfterReveal'), 'panel must mutate Scroll Scene before-after reveal state');
assert(panelSrc.includes('Reveal before element id'), 'panel must expose before reveal element binding');
assert(panelSrc.includes('Reveal after element id'), 'panel must expose after reveal element binding');
assert(panelSrc.includes('Reveal reduced motion'), 'panel must expose explicit before-after reduced-motion policy');
assert(panelSrc.includes('Reverse trigger element id'), 'panel must expose layout transition reverse trigger control');
assert(panelSrc.includes('renderMotionSequenceControls'), 'panel must render full Motion Sequence controls');
assert(panelSrc.includes('renderRichMotionAssetControls'), 'panel must render animation source controls');
assert(panelSrc.includes('Animation sources'), 'panel must label rich motion assets as animation sources');
assert(panelSrc.includes('Add frame animation'), 'panel must create image-sequence animation sources');
assert(panelSrc.includes('Add Rive animation'), 'panel must create Rive animation sources');
assert(panelSrc.includes('Add Lottie animation'), 'panel must create Lottie animation sources');
assert(panelSrc.includes('Add 3D animation'), 'panel must create model-3d animation sources');
assert(panelSrc.includes('Add shader animation'), 'panel must create shader-scene animation sources');
assert(panelSrc.includes('Add video animation'), 'panel must create video stream animation sources');
assert(panelSrc.includes('renderImageSequenceAssetFields'), 'panel must render image-sequence asset fields');
assert(panelSrc.includes('Image sequence playback'), 'panel must expose image sequence playback driver control');
assert(panelSrc.includes('Frame asset ids'), 'panel must expose image sequence frame controls');
assert(panelSrc.includes('Scroll scene'), 'panel must bind image sequence scrub playback to Scroll Scenes');
assert(panelSrc.includes('renderLottieAssetFields'), 'panel must render Lottie asset fields');
assert(panelSrc.includes('renderModel3DAssetFields'), 'panel must render model-3d asset fields');
assert(panelSrc.includes('renderShaderSceneAssetFields'), 'panel must render shader-scene asset fields');
assert(panelSrc.includes('renderVideoStreamAssetFields'), 'panel must render video stream asset fields');
assert(panelSrc.includes('SHADER_SCENE_PRESETS'), 'panel must use schema shader-scene preset values');
assert(
  panelSrc.includes('SHADER_SCENE_REDUCED_MOTION_MODES'),
  'panel must use schema shader-scene reduced-motion values',
);
assert(panelSrc.includes('VIDEO_STREAM_TRIGGERS'), 'panel must use schema video stream trigger values');
assert(
  panelSrc.includes('VIDEO_STREAM_REDUCED_MOTION_MODES'),
  'panel must use schema video stream reduced-motion values',
);
assert(panelSrc.includes('Rive input bindings'), 'panel must edit Rive input bindings');
assert(panelSrc.includes('RIVE_INPUT_EVENTS'), 'panel must use schema Rive input event values');
assert(panelSrc.includes('RIVE_INPUT_TYPES'), 'panel must use schema Rive input type values');
assert(panelSrc.includes('Add motion sequence'), 'panel must create full Motion Sequences');
assert(panelSrc.includes('Motion Sequence step'), 'panel must render editable Motion Sequence steps');
assert(panelSrc.includes('renderMotionSequenceTimeline'), 'panel must render a Motion Sequence timeline overview');
assert(panelSrc.includes('Timeline overview'), 'panel must label the Motion Sequence timeline overview');
assert(panelSrc.includes('opencanvas-motion-timeline'), 'panel must use timeline-specific DOM classes');
assert(panelSrc.includes('opencanvas-motion-timeline-lane'), 'panel must render timeline lanes');
assert(panelSrc.includes('opencanvas-motion-timeline-snap'), 'panel must render timeline snap handles');
assert(panelSrc.includes('renderMotionSequenceScrubPreview'), 'panel must render Motion Sequence scrub preview controls');
assert(panelSrc.includes('Scrub preview'), 'panel must label Motion Sequence scrub preview controls');
assert(
  panelSrc.includes('renderMotionSequenceTimelinePropertyEditor'),
  'panel must render timeline-adjacent Motion Sequence property controls',
);
assert(
  panelSrc.includes('Timeline quick properties'),
  'panel must label timeline quick property controls',
);
assert(
  panelSrc.includes('data-opencanvas-motion-timeline-property-editor'),
  'panel must expose timeline property editor metadata',
);
assert(panelSrc.includes('Quick playback direction'), 'panel must edit playback direction from the timeline');
assert(panelSrc.includes('Quick repeat count'), 'panel must edit repeat count from the timeline');
assert(panelSrc.includes('Quick repeat mode'), 'panel must edit repeat mode from the timeline');
assert(panelSrc.includes('Quick target type'), 'panel must edit target type from the timeline');
assert(panelSrc.includes('Quick target page'), 'panel must edit target page from the timeline');
assert(panelSrc.includes('Quick target section'), 'panel must edit target section from the timeline');
assert(panelSrc.includes('Quick target element'), 'panel must edit target element from the timeline');
assert(panelSrc.includes('Quick split unit'), 'panel must edit split unit from the timeline');
assert(panelSrc.includes('Quick from opacity'), 'panel must edit from opacity from the timeline');
assert(panelSrc.includes('Quick to filter'), 'panel must edit to filter from the timeline');
assert(panelSrc.includes('Quick from clip path'), 'panel must edit from clip path from the timeline');
assert(panelSrc.includes('Quick to variable font weight'), 'panel must edit variable font weight from the timeline');
assert(panelSrc.includes('Quick from stroke dash array'), 'panel must edit stroke dash array from the timeline');
assert(panelSrc.includes('Quick to stroke dash offset'), 'panel must edit stroke dash offset from the timeline');
assert(panelSrc.includes('Quick duration (ms)'), 'panel must edit duration beside the timeline');
assert(panelSrc.includes('Quick start at (ms)'), 'panel must edit start time beside the timeline');
assert(panelSrc.includes('Quick delay (ms)'), 'panel must edit delay beside the timeline');
assert(panelSrc.includes('Quick wait after (ms)'), 'panel must edit wait-after timing beside the timeline');
assert(panelSrc.includes('Quick stagger (ms)'), 'panel must edit stagger beside the timeline');
assert(panelSrc.includes('Quick easing'), 'panel must edit easing beside the timeline');
assert(
  panelSrc.includes('data-opencanvas-motion-preview-progress'),
  'panel must publish Motion Sequence preview progress metadata',
);
assert(panelSrc.includes('wireMotionSequenceTimelineDrag'), 'panel must wire draggable Motion Sequence timeline bars');
assert(panelSrc.includes('wireMotionSequenceTimelineResize'), 'panel must wire resizable Motion Sequence timeline bars');
assert(
  panelSrc.includes('opencanvas-motion-timeline-bar--draggable'),
  'panel must mark draggable Motion Sequence timeline bars',
);
assert(
  panelSrc.includes('opencanvas-motion-timeline-bar--resizable'),
  'panel must mark resizable Motion Sequence timeline bars',
);
assert(
  panelSrc.includes('Drag timeline bars'),
  'panel must describe timeline drag editing affordances',
);
assert(panelSrc.includes('renderLayoutTransitionControls'), 'panel must render layout transition controls');
assert(panelSrc.includes('renderSmoothScrollControls'), 'panel must render Smooth Scroll controls');
assert(panelSrc.includes('Smooth Scroll'), 'panel must label Smooth Scroll controls');
assert(panelSrc.includes('SCROLL_BEHAVIOR_MODES'), 'panel must use Smooth Scroll mode schema values');
assert(
  panelSrc.includes('SCROLL_BEHAVIOR_REDUCED_MOTION_MODES'),
  'panel must use Smooth Scroll reduced-motion schema values',
);
assert(panelSrc.includes('Add layout transition'), 'panel must create layout transitions');
assert(
  panelSrc.includes('Select a trigger/source element before adding a layout transition.'),
  'panel must block layout transitions without a selected element',
);
assert(
  panelSrc.includes('Add another element on the active page before adding a layout transition.'),
  'panel must block layout transitions without a target element',
);
assert(panelSrc.includes('MOTION_SEQUENCE_TRIGGER_TYPES'), 'panel must use schema trigger types');
assert(panelSrc.includes("type: 'page-enter', pageId"), 'panel must default page-enter triggers to a page id');
assert(panelSrc.includes("trigger.type === 'page-enter'"), 'panel must render page-enter trigger detail');
assert(panelSrc.includes('MOTION_SEQUENCE_TEXT_EFFECTS'), 'panel must use schema text effect types');
assert(
  behaviourPrimitivesSrc.includes("'mask-reveal'"),
  'schema text effect catalog must include mask-reveal for the panel select',
);
assert(panelSrc.includes('Text effect'), 'panel must expose text effect controls');
assert(
  panelSrc.includes('LAYOUT_TRANSITION_INITIAL_STATES'),
  'panel must use layout transition initial state schema values',
);
assert(
  panelSrc.includes('LAYOUT_TRANSITION_REDUCED_MOTION_MODES'),
  'panel must use layout transition reduced-motion schema values',
);
assert(panelSrc.includes('TEXT_SPLIT_UNITS'), 'panel must edit text split units');
assert(panelSrc.includes('LOAD_EXPERIENCE_PRESETS'), 'panel must use load presets');
assert(panelSrc.includes('ROUTE_TRANSITION_MODES'), 'panel must use route modes');
assert(panelSrc.includes('OVERLAY_TRIGGER_TYPES'), 'panel must use overlay trigger types');
assert(panelSrc.includes('MOTION_SEQUENCE_LITE_EFFECTS'), 'panel must use motion effects');
assert(panelSrc.includes('MOTION_SEQUENCE_LITE_TARGET_TYPES'), 'panel must use motion targets');
assert(panelSrc.includes('renderSequenceLiteEditor'), 'panel must render sequence editor');
assert(panelSrc.includes('Snap points'), 'panel must expose Scroll Scene snap point controls');
assert(panelSrc.includes('renderParticleFieldAssetFields'), 'panel must render particle-field asset controls');
assert(panelSrc.includes('Upload portrait'), 'panel must expose ASCII portrait upload');
assert(panelSrc.includes('uploadParticleFieldPortrait'), 'panel must use shared portrait upload helper');
assert(panelSrc.includes('findParticleFieldAsset'), 'panel must read live particle-field assets before regenerate');

const stylesCssSrc = await Bun.file(new URL('./styles.css', import.meta.url)).text();
const stylesBuildSrc = await Bun.file(new URL('./styles-build.ts', import.meta.url)).text();
for (const [label, src] of [
  ['styles.css', stylesCssSrc],
  ['styles-build.ts', stylesBuildSrc],
] as const) {
  assert(src.includes('.opencanvas-motion-timeline'), label + ' must style the Motion Sequence timeline overview');
  assert(src.includes('.opencanvas-motion-timeline-bar'), label + ' must style Motion Sequence timeline bars');
  assert(src.includes('.opencanvas-motion-timeline-lane'), label + ' must style Motion Sequence timeline lanes');
  assert(src.includes('.opencanvas-motion-timeline-snap'), label + ' must style Motion Sequence timeline snap handles');
  assert(src.includes('.opencanvas-motion-timeline-scrub'), label + ' must style Motion Sequence scrub preview controls');
  assert(src.includes('.opencanvas-motion-timeline-playhead'), label + ' must style Motion Sequence scrub playhead');
  assert(src.includes('.opencanvas-motion-timeline-bar--draggable'), label + ' must style draggable Motion Sequence timeline bars');
  assert(src.includes('.opencanvas-motion-timeline-bar--resizable'), label + ' must style resizable Motion Sequence timeline bars');
  assert(src.includes('.opencanvas-motion-timeline-bar-handle'), label + ' must style Motion Sequence timeline bar handles');
  assert(
    src.includes('.opencanvas-motion-timeline-property-editor'),
    label + ' must style Motion Sequence timeline property editor',
  );
  assert(
    src.includes('.opencanvas-motion-timeline-property-grid'),
    label + ' must style Motion Sequence timeline property editor grid',
  );
}

console.log('[interactions-panel:smoke] OK');
