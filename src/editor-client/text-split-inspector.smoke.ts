export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[text-split-inspector:smoke] ' + message);
}

const inspectorSrc = await Bun.file(new URL('./element-inspector.ts', import.meta.url)).text();

assert(inspectorSrc.includes('renderTextSplitInspector'), 'element inspector must render text split controls');
assert(inspectorSrc.includes('TEXT_SPLIT_UNITS'), 'text split controls must use schema units');
assert(inspectorSrc.includes("target: { type: 'text-split'"), 'inspector must write text-split targets');
assert(inspectorSrc.includes("trigger: { type: 'section-enter'"), 'inspector must create section-enter sequence');
assert(inspectorSrc.includes("reducedMotion: 'final-state'"), 'inspector must set explicit reduced-motion behaviour');
assert(inspectorSrc.includes('aria-hidden'), 'inspector note must document generated span accessibility');

console.log('[text-split-inspector:smoke] OK');
