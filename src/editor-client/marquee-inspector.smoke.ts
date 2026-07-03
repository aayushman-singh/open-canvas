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
const sharedMarqueeSrc = await Bun.file(new URL('../interactive/marquee.ts', import.meta.url)).text();

assert(inspectorSrc.includes('renderMarqueeInspector'), 'element inspector must render marquee controls');
assert(
  inspectorSrc.includes("buildToggleField('Enable marquee'"),
  'Enable marquee must use the shared toggle-pill DOM, not a raw checkbox field',
);
assert(
  inspectorSrc.includes("buildToggleField('Pause on hover'"),
  'Pause on hover must use the shared toggle-pill DOM, not a raw checkbox field',
);
assert(
  inspectorSrc.includes("buildToggleField('Reverse on hover'"),
  'Reverse on hover must use the shared toggle-pill DOM, not a raw checkbox field',
);
assert(
  inspectorSrc.includes("buildToggleField('Edge fade mask'"),
  'Edge fade mask must use the shared toggle-pill DOM, not a raw checkbox field',
);
assert(inspectorSrc.includes('MARQUEE_DIRECTIONS'), 'direction select must use schema directions');
assert(
  inspectorSrc.includes('MARQUEE_REDUCED_MOTION_MODES'),
  'reduced-motion select must use schema modes',
);
assert(inspectorSrc.includes('speedPxPerSecond'), 'inspector must edit marquee speed');
assert(inspectorSrc.includes('Rows'), 'inspector must edit marquee row count');
assert(inspectorSrc.includes('rowOffsetPercent'), 'inspector must edit marquee row offset');
assert(inspectorSrc.includes('Marquee source'), 'inspector must edit marquee source mode');
assert(inspectorSrc.includes('collectionElementId'), 'inspector must edit marquee collection source element');
assert(inspectorSrc.includes('MARQUEE_COLLECTION_FIELDS'), 'inspector must use schema-owned marquee source fields');
assert(inspectorSrc.includes('pauseOnHover'), 'inspector must edit pause-on-hover');
assert(
  wrapperSrc.includes('data-opencanvas-marquee-reduced-motion'),
  'editor wrapper must emit marquee reduced-motion metadata',
);
assert(
  wrapperSrc.includes('data-opencanvas-marquee-rows'),
  'editor wrapper must emit marquee row metadata',
);
assert(
  hydrateSrc.includes("import { hydrateMarquees } from '../interactive/marquee.js';"),
  'editor runtime must import the shared marquee hydrator',
);
assert(
  !hydrateSrc.includes('function hydrateMarquees('),
  'editor runtime must not define a local marquee hydrator',
);
assert(
  sharedMarqueeSrc.includes('data-opencanvas-marquee-lane'),
  'shared marquee adapter must hydrate marquee lanes',
);
assert(
  sharedMarqueeSrc.includes('opencanvas:marquee-failure'),
  'shared marquee adapter must emit named marquee failure event',
);
assert(
  hydrateSrc.indexOf('hydrateBehaviourPreview') < hydrateSrc.indexOf('hydrateMarquees(root, options)'),
  'editor marquee hydration must run after behaviour preview hydration',
);

console.log('[marquee-inspector:smoke] OK');
