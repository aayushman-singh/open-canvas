export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[pointer-fx-inspector:smoke] ' + message);
}

const inspectorSrc = await Bun.file(new URL('./element-inspector.ts', import.meta.url)).text();
const wrapperSrc = await Bun.file(new URL('./element-menu.ts', import.meta.url)).text();
const hydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();
const bodySrc = await Bun.file(new URL('./body-builders-data.ts', import.meta.url)).text();

assert(inspectorSrc.includes('renderPointerFxInspector'), 'element inspector must render pointer FX controls');
assert(inspectorSrc.includes('POINTER_FX_PRIMITIVES'), 'primitive select must use schema primitives');
assert(
  inspectorSrc.includes('POINTER_FX_REDUCED_MOTION_MODES'),
  'reduced-motion select must use schema modes',
);
assert(
  wrapperSrc.includes('data-opencanvas-pointer-fx-reduced-motion'),
  'editor wrapper must emit pointer-fx reduced-motion metadata',
);
assert(
  hydrateSrc.includes('opencanvas:pointer-fx-failure'),
  'editor runtime must emit named pointer-fx failure event',
);
assert(
  bodySrc.includes("data-opencanvas-pointer-fx-reduced-motion', 'allow'"),
  'form-derived pointer FX must emit explicit reduced-motion metadata in editor preview',
);

console.log('[pointer-fx-inspector:smoke] OK');
