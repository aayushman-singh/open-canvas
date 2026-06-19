export {};

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error('[shared-route-transition-inspector:smoke] ' + message);
}

const source = await Bun.file(new URL('./interactions-panel.ts', import.meta.url)).text();

assert(source.includes('renderSharedRouteElements'), 'panel must render shared route element controls');
assert(source.includes('SharedRouteElement'), 'panel must use schema-owned shared element mappings');
assert(source.includes('Add shared element'), 'panel must expose add action');
assert(
  source.includes('Select an element before adding a shared route mapping.'),
  'panel must block blank shared mappings',
);
assert(source.includes('sourceElementId: selectedElementId'), 'panel must seed source from selected element');
assert(source.includes('targetElementId: selectedElementId'), 'panel must seed target from selected element');
assert(source.includes('viewTransitionName'), 'panel must expose view transition names');

console.log('[shared-route-transition-inspector:smoke] OK');
