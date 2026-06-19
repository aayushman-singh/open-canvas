export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[marquee-inspector:smoke] ' + message);
}

const inspectorSrc = await Bun.file(new URL('./element-inspector.ts', import.meta.url)).text();
const wrapperSrc = await Bun.file(new URL('./element-menu.ts', import.meta.url)).text();
const hydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();

assert(inspectorSrc.includes('renderMarqueeInspector'), 'element inspector must render marquee controls');
assert(inspectorSrc.includes('MARQUEE_DIRECTIONS'), 'direction select must use schema directions');
assert(
  inspectorSrc.includes('MARQUEE_REDUCED_MOTION_MODES'),
  'reduced-motion select must use schema modes',
);
assert(inspectorSrc.includes('speedPxPerSecond'), 'inspector must edit marquee speed');
assert(inspectorSrc.includes('pauseOnHover'), 'inspector must edit pause-on-hover');
assert(
  wrapperSrc.includes('data-opencanvas-marquee-reduced-motion'),
  'editor wrapper must emit marquee reduced-motion metadata',
);
assert(hydrateSrc.includes('function hydrateMarquees'), 'editor runtime must hydrate marquees');
assert(
  hydrateSrc.includes('opencanvas:marquee-failure'),
  'editor runtime must emit named marquee failure event',
);
assert(
  hydrateSrc.indexOf('hydrateBehaviourPreview') < hydrateSrc.indexOf('hydrateMarquees(root)'),
  'editor marquee hydration must run after behaviour preview hydration',
);

console.log('[marquee-inspector:smoke] OK');
