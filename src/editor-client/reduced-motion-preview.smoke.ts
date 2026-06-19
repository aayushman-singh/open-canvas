// src/editor-client/reduced-motion-preview.smoke.ts
//
// Editor reduced-motion authoring preview contract. The owner-facing toggle must
// flow through the single Runtime Hydrator option path used by editor preview and
// visitor rehydrate calls; it must not fake window.matchMedia or silently drift
// from published runtime semantics.

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[reduced-motion-preview:smoke] ${message}`);
}

const editorContext = await Bun.file(new URL('./editor-context.ts', import.meta.url)).text();
const indexSource = await Bun.file(new URL('./index.ts', import.meta.url)).text();
const runtimeHelpers = await Bun.file(new URL('./runtime-helpers.ts', import.meta.url)).text();
const renderSource = await Bun.file(new URL('./render.ts', import.meta.url)).text();
const editorHydrator = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();
const behaviourPreview = await Bun.file(new URL('./hydrate-behaviour.ts', import.meta.url)).text();
const visitorRuntime = await Bun.file(new URL('../interactive/runtime.ts', import.meta.url)).text();
const visitorBehaviour = await Bun.file(new URL('../interactive/behaviour.ts', import.meta.url)).text();
const visitorMarquee = await Bun.file(new URL('../interactive/marquee.ts', import.meta.url)).text();
const visitorPointerFx = await Bun.file(new URL('../interactive/pointer-fx.ts', import.meta.url)).text();
const visitorVideoHover = await Bun.file(new URL('../interactive/video-hover.ts', import.meta.url)).text();
const packageJson = await Bun.file(new URL('../../package.json', import.meta.url)).text();

assert(
  editorContext.includes("reducedMotionPreview: 'no-preference' | 'reduce';"),
  'EditorContext must own the reduced-motion preview mode',
);
assert(
  indexSource.includes("reducedMotionPreview: 'no-preference'"),
  'createEditor must initialize reduced-motion preview to no-preference',
);
assert(
  runtimeHelpers.includes('data-opencanvas-reduced-motion-preview'),
  'viewport toolbar must expose a reduced-motion preview command',
);
assert(
  runtimeHelpers.includes('ctx.reducedMotionPreview =') && runtimeHelpers.includes('ctx.renderAll();'),
  'reduced-motion preview command must update ctx and rebuild preview',
);
assert(
  renderSource.includes("ctx.root!.setAttribute('data-opencanvas-reduced-motion-preview', ctx.reducedMotionPreview);") &&
    renderSource.includes('reducedMotion: ctx.reducedMotionPreview'),
  'renderAll must stamp preview metadata and pass reducedMotion to Runtime Hydrator',
);
assert(
  editorHydrator.includes("reducedMotion?: 'no-preference' | 'reduce';") &&
    editorHydrator.includes('hydratePointerFx(root, options)') &&
    editorHydrator.includes('hydrateMarquees(root, options)') &&
    editorHydrator.includes('hydrateVideoHoverStreams(root, options)') &&
    editorHydrator.includes('hydrateBehaviourPreview(root, options.behaviourState, options.behaviourAssetBasePath, options.reducedMotion)'),
  'editor Runtime Hydrator must route reducedMotion to every reduced-motion-aware preview runtime',
);
assert(
  behaviourPreview.includes('reducedMotion?:') && behaviourPreview.includes('hydrateBehaviour(document, { reducedMotion })'),
  'behaviour preview must execute the visitor behaviour runtime with the editor reduced-motion option',
);
assert(
  visitorRuntime.includes('hydratePointerFx(root, options || {})') &&
    visitorRuntime.includes('hydrateBehaviour(rootScope, options || {})') &&
    visitorRuntime.includes('hydrateMarquees(rootScope, options || {})') &&
    visitorRuntime.includes('hydrateVideoHoverStreams(rootScope, options || {})'),
  'visitor Runtime Hydrator must pass options through parity hydration paths',
);
assert(
  visitorBehaviour.includes('var behaviourRuntimeOptions = {};') &&
    visitorBehaviour.includes("behaviourRuntimeOptions.reducedMotion === 'reduce'") &&
    visitorBehaviour.includes('function hydrateBehaviour(scope, options)'),
  'behaviour runtime must honor explicit Runtime Hydrator reducedMotion options',
);
for (const [name, source] of [
  ['marquee', visitorMarquee],
  ['pointer-fx', visitorPointerFx],
  ['video-hover', visitorVideoHover],
] as const) {
  assert(
    source.includes("options && options.reducedMotion === 'reduce'") &&
      source.includes("options && options.reducedMotion === 'no-preference'"),
    `${name} runtime must honor explicit Runtime Hydrator reducedMotion options`,
  );
}
assert(
  packageJson.includes('"reduced-motion-preview:smoke"') &&
    packageJson.includes('bun run reduced-motion-preview:smoke'),
  'package scripts and ci:smoke must include reduced-motion-preview smoke',
);

console.log('[reduced-motion-preview:smoke] OK');
