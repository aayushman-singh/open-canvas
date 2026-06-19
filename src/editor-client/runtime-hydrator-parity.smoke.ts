export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[runtime-hydrator-parity:smoke] ' + message);
}

const editorHydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();
const editorRenderSrc = await Bun.file(new URL('./render.ts', import.meta.url)).text();
const visitorRuntimeSrc = await Bun.file(new URL('../interactive/runtime.ts', import.meta.url)).text();
const publicRouteSrc = await Bun.file(new URL('../routes/public.ts', import.meta.url)).text();
const routeTransitionSrc = await Bun.file(new URL('../interactive/route-transition.ts', import.meta.url)).text();

assert(
  visitorRuntimeSrc.includes('window.__opencanvasHydrate = hydrateAll'),
  'visitor runtime must expose the named Runtime Hydrator',
);
assert(
  editorHydrateSrc.includes('export function installEditorRuntimeHydrator'),
  'editor must install a named Runtime Hydrator',
);
assert(
  editorHydrateSrc.includes('window.__opencanvasHydrate ='),
  'editor hydrator must write window.__opencanvasHydrate',
);
assert(
  editorHydrateSrc.includes('throw new Error') && editorHydrateSrc.includes('Runtime Hydrator missing'),
  'editor must fail loudly when the Runtime Hydrator boundary is missing',
);
assert(
  editorRenderSrc.includes('runEditorRuntimeHydrator(ctx.root') &&
    editorRenderSrc.includes("reason: 'editor-render'"),
  'editor render must consume the Runtime Hydrator boundary',
);
assert(
  publicRouteSrc.includes("hydrate(root, { reason: 'live-publish' })"),
  'live publish swaps must consume the Runtime Hydrator boundary',
);
assert(
  routeTransitionSrc.includes('window.__opencanvasHydrate') &&
    routeTransitionSrc.includes("reason: 'route-transition'"),
  'route transitions must consume the Runtime Hydrator boundary',
);

console.log('[runtime-hydrator-parity:smoke] OK');
