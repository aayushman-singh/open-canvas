export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[premium-interactions-preview:smoke] ' + message);
}

const hydrateSrc = await Bun.file(new URL('./hydrate-interactives.ts', import.meta.url)).text();
assert(hydrateSrc.includes('export function previewOverlayInEditor'), 'overlay preview export');
assert(hydrateSrc.includes('export function previewLoadExperienceInEditor'), 'load preview export');
assert(hydrateSrc.includes('export function previewRouteTransitionInEditor'), 'route preview export');
assert(hydrateSrc.includes('data-opencanvas-overlay'), 'overlay DOM contract');
assert(hydrateSrc.includes('data-opencanvas-load-experience'), 'load DOM contract');
assert(hydrateSrc.includes('data-opencanvas-route-container'), 'route DOM contract');
assert(hydrateSrc.includes('console.error'), 'preview helpers must fail loudly');

const indexSrc = await Bun.file(new URL('./index.ts', import.meta.url)).text();
assert(indexSrc.includes('previewOverlayInEditor(document, overlayId)'), 'overlay preview binding');
assert(indexSrc.includes('previewLoadExperienceInEditor(document)'), 'load preview binding');
assert(indexSrc.includes('previewRouteTransitionInEditor(ctx.root)'), 'route preview binding');
assert(indexSrc.includes('useSelectedElementAsOverlayTrigger'), 'selected element trigger binding');
assert(indexSrc.includes("overlay.trigger = { type: 'element-click'"), 'element-click mutation');

const sidebarSrc = await Bun.file(new URL('./sidebar.ts', import.meta.url)).text();
assert(sidebarSrc.includes("tabName === 'interactions'"), 'sidebar interactions branch');
assert(sidebarSrc.includes('ctx.renderInteractionsPanel()'), 'sidebar renders interactions panel');

const editorRouteSrc = await Bun.file(new URL('../editor/route.tsx', import.meta.url)).text();
assert(editorRouteSrc.includes('data-sidebar-tab="interactions"'), 'route tab markup');
assert(editorRouteSrc.includes('id="opencanvas-interactions-panel"'), 'route panel host markup');

const stylesCssSrc = await Bun.file(new URL('./styles.css', import.meta.url)).text();
const stylesBuildSrc = await Bun.file(new URL('./styles-build.ts', import.meta.url)).text();
for (const src of [stylesCssSrc, stylesBuildSrc]) {
  assert(src.includes('.opencanvas-interactions-panel'), 'panel styles');
  assert(src.includes('[data-opencanvas-editor-preview-layer]'), 'preview layer styles');
  assert(src.includes('.opencanvas-overlay[data-opencanvas-overlay-open]'), 'overlay preview styles');
  assert(src.includes('.opencanvas-load-experience'), 'load preview styles');
}

console.log('[premium-interactions-preview:smoke] OK');
