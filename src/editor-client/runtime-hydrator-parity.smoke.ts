export {};

import { RUNTIME_HYDRATOR_SURFACES } from '../interactive/runtime-hydrator-surfaces.js';
import { EDITOR_REGISTRY } from './hydrate-interactives.js';
import { RUNTIME_ENTRY_SRC } from '../interactive/runtime.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[runtime-hydrator-parity:smoke] ' + message);
}

function compactSource(value: string): string {
  return value.replace(/\s+/g, '');
}

const editorHydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();
const editorRenderSrc = await Bun.file(new URL('./render.ts', import.meta.url)).text();
const elementMenuSrc = await Bun.file(new URL('./element-menu.ts', import.meta.url)).text();
const publicRouteSrc = await Bun.file(new URL('../routes/public.ts', import.meta.url)).text();
const routeTransitionSrc = await Bun.file(new URL('../interactive/route-transition.ts', import.meta.url)).text();
const packageSrc = await Bun.file(new URL('../../package.json', import.meta.url)).text();

assert(RUNTIME_HYDRATOR_SURFACES.length >= 6, 'Runtime Hydrator surface manifest must list visitor/editor surfaces');

for (const surface of RUNTIME_HYDRATOR_SURFACES) {
  assert(
    surface.id in EDITOR_REGISTRY,
    `editor registry must map surface ${surface.id} in EDITOR_REGISTRY`,
  );
  assert(
    RUNTIME_ENTRY_SRC.includes(surface.visitorCall),
    `visitor runtime must dispatch manifest surface ${surface.id} via ${surface.visitorCall}`,
  );
  assert(
    compactSource(editorHydrateSrc).includes(compactSource(surface.editorCall)),
    `editor hydrator must dispatch manifest surface ${surface.id} via ${surface.editorCall}`,
  );
}

assert(
  RUNTIME_ENTRY_SRC.includes('window.__opencanvasHydrate = hydrateAll'),
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
  elementMenuSrc.includes('runEditorRuntimeHydrator(node') &&
    elementMenuSrc.includes("reason: 'element-rebuild'") &&
    elementMenuSrc.includes('behaviourState: ctx.state') &&
    elementMenuSrc.includes("behaviourAssetBasePath: `${ctx.siteBase}/assets`") &&
    elementMenuSrc.includes('reducedMotion: ctx.reducedMotionPreview'),
  'single-element rebuild must consume the Runtime Hydrator boundary with behaviour payload options',
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
assert(
  packageSrc.includes('"runtime-hydrator-parity:smoke"'),
  'package.json must expose the Runtime Hydrator parity smoke',
);
assert(
  packageSrc.includes('bun run runtime-hydrator-parity:smoke'),
  'ci:smoke must run the Runtime Hydrator parity smoke',
);

console.log('[runtime-hydrator-parity:smoke] OK');
