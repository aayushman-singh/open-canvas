const editorRouteSource = await Bun.file('src/editor/route.tsx').text();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

assert(editorRouteSource.includes("editorMode?: 'site' | 'template'"), 'editor route options must expose template mode');
assert(editorRouteSource.includes("canvas-publish"), 'template mode keeps canonical publish button id');
assert(editorRouteSource.includes('Publish template'), 'template mode publish button must say Publish template');
assert(editorRouteSource.includes("canvas-save-template"), 'site mode still emits save-as-template control');
assert(editorRouteSource.includes('/admin/templates/:templateId/edit'), 'editor route must mount template edit path');
assert(
  editorRouteSource.includes('ensureCuratedTemplateDraft'),
  'template edit route must lazily create a draft for existing curated templates',
);

const contextSource = await Bun.file('src/editor-client/editor-context.ts').text();
assert(contextSource.includes("editorMode: 'site' | 'template'"), 'EditorBoot/Context must carry editorMode');
assert(contextSource.includes('assetLibrarySiteId'), 'EditorBoot/Context must carry assetLibrarySiteId');

const publishSource = await Bun.file('src/editor-client/publish.ts').text();
assert(publishSource.includes('publishTemplate'), 'publish module must branch to template publish');
assert(publishSource.includes('/admin/custom-templates/'), 'template publish must use admin custom-template API');

const runtimeSource = await Bun.file('src/editor-client/runtime-helpers.ts').text();
assert(runtimeSource.includes('ownerAssetsPath'), 'asset helpers must use mode-aware owner asset path');

console.log('[template-mode:smoke] OK');
