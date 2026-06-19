export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[pointer-fx-inspector:smoke] ' + message);
}

const inspectorSrc = await Bun.file(new URL('./element-inspector.ts', import.meta.url)).text();

assert(inspectorSrc.includes('Pointer FX'), 'element inspector must expose Pointer FX controls');
assert(inspectorSrc.includes('POINTER_FX_PRIMITIVES'), 'primitive select must use schema primitives');
assert(inspectorSrc.includes('image-follow'), 'inspector must branch for image-follow primitive');
assert(inspectorSrc.includes('Preview asset id'), 'inspector must expose image-follow preview asset control');
assert(inspectorSrc.includes('previewAssetId'), 'inspector must save image-follow preview asset id');
assert(inspectorSrc.includes('Touch activation'), 'inspector must expose touch activation control');
assert(inspectorSrc.includes('touchActivation'), 'inspector must persist pointer-fx touch activation');
assert(inspectorSrc.includes('drag-inertia'), 'inspector must expose drag-inertia primitive');
assert(inspectorSrc.includes('Drag axis'), 'inspector must expose drag axis control');
assert(inspectorSrc.includes('dragAxis'), 'inspector must persist pointer-fx drag axis');
assert(inspectorSrc.includes('Inertia'), 'inspector must expose inertia control');
assert(inspectorSrc.includes('inertia'), 'inspector must persist pointer-fx inertia');

console.log('[pointer-fx-inspector:smoke] OK');
