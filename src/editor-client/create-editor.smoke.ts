// src/editor-client/create-editor.smoke.ts
//
// ADR 0058 Phase 2q.m — typing smoke for the createEditor wiring.
//
// This file does NOT call `createEditor` — invocation would throw inside
// Bun because the DOM-ref caches assume `document.getElementById` exists.
// What we DO verify is that the function's static type signature accepts
// a real `EditorBoot` payload and that the imported context-shape stays
// consistent with what the wiring expects.
//
// Behavioural parity for the boot sequence itself stays pinned by the
// inline IIFE smokes (canvas-state-gate, host-config, etc.) until Phase 3
// cutover swaps the editor route to serve the bundle.

import type { EditorBoot } from './editor-context.js';
import { createEditor } from './index.js';

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[create-editor:smoke] ${message}`);
}

// ---- Type-only fixture --------------------------------------------------

const boot: EditorBoot = {
  siteId: 'site-smoke',
  apiBase: '/api',
  wsToken: '',
  displayName: 'Smoke',
  userId: 'user-smoke',
  editorMode: 'site',
};

// Pull a reference to createEditor so the import doesn't tree-shake away
// and the signature gets compared against EditorBoot at type-check time.
const create: (boot: EditorBoot) => void = createEditor;
assert(typeof create === 'function', 'createEditor must be exported as a function');
assert(create.length >= 1, 'createEditor must accept a boot argument');

// Touch every field on the boot payload so a future EditorBoot field
// rename (e.g. siteId → projectId) breaks here loudly.
assert(boot.siteId === 'site-smoke', 'siteId fixture round-trips');
assert(boot.apiBase === '/api', 'apiBase fixture round-trips');
assert(boot.wsToken === '', 'wsToken fixture round-trips');
assert(boot.displayName === 'Smoke', 'displayName fixture round-trips');
assert(boot.userId === 'user-smoke', 'userId fixture round-trips');
assert(boot.editorMode === 'site', 'editorMode fixture round-trips');

// Phase 3 cutover guard: createEditor is now the production entrypoint, so
// these ctx members must be live functions. A stub here means normal editor
// boot or a first user action will throw "createEditor wiring pending..." in
// the browser.
const indexSource = await Bun.file(new URL('./index.ts', import.meta.url)).text();

const forbiddenLiveStubs = [
  'findElement',
  'buildPickerThumb',
  'postAssetUpload',
  'setStatus',
  'applyAssetIdToElement',
  'runDeleteAsset',
  'uploadMediaForElement',
  'findSection',
  'preserveInspectorScrollFor',
  'revokePendingPreviews',
  'selectableSectionRoles',
  'currentPage',
  'applyPageMotionAttributes',
  'applyPageStyleProperties',
  'pageRenderWidth',
  'renderInspectorSpec',
  'saveStateNow',
  'buildSectionNode',
  'flushPendingSave',
  'pointerToCanvas',
  'resolveElementWrapperAtPoint',
  'insertElementForSidebarCommand',
  'getPagePosition',
  'uploadGeneratedBlobToElement',
  'forceOpenInspector',
  'renderMathInScope',
  'normalizePastedHtml',
  'plainTextToFragmentHtml',
  'beginDrag',
  'openLinkModal',
  'generateImageForElement',
  'isEditableShortcutTarget',
] as const;

for (const name of forbiddenLiveStubs) {
  assert(
    !indexSource.includes(`${name}: stub('${name}')`),
    `${name} must not remain a Phase 3 createEditor stub`,
  );
}

const requiredBootNeedles = [
  'mountViewportImpl(ctx);',
  'if (window.katex && ctx.root) ctx.renderMathInScope(ctx.root);',
  'attachChromeToggles(ctx);',
  'ctx.localPresence = loadPresenceIdentity(ctx.presenceDisplayName);',
  'wireCoEditPresenceListeners(ctx);',
  'ctx.onMarkToolbarReflow = () => onMarkToolbarReflowImpl(ctx);',
] as const;

for (const needle of requiredBootNeedles) {
  assert(indexSource.includes(needle), `createEditor boot must contain ${needle}`);
}

assert(
  !indexSource.includes('registerKeyboardHandlers(ctx);'),
  'createEditor must not register duplicate global keyboard handlers',
);

console.log('[create-editor:smoke] OK');
