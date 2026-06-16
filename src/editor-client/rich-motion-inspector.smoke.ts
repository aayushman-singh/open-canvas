import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import {
  bindLottieOwnerAssetToElement,
  resetRichMotionInspectorCacheForSmoke,
  unbindRichMotionFromElement,
} from './rich-motion-inspector.js';
import { runDeleteAssetImpl } from './runtime-helpers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('[rich-motion-inspector:smoke] ' + message);
}

function mediaElement(id: string): CanvasElement {
  return {
    id,
    type: 'media',
    mediaKind: 'image',
    assetId: 'image-' + id,
    alt: '',
    fit: 'cover',
    box: { x: 0, y: 0, w: 320, h: 180, z: 1 },
  };
}

function siteWithElements(elements: CanvasElement[]): EditableSite {
  return {
    styleKit: 'charcoal',
    pages: [
      {
        id: 'page-home',
        slug: 'home',
        title: 'Home',
        width: 1440,
        sections: [
          {
            id: 'section-hero',
            recipeId: 'custom',
            name: 'Hero',
            height: 600,
            elements,
          },
        ],
      },
    ],
  };
}

function mutationCtx(state: EditableSite): {
  ctx: {
    state: EditableSite;
    captureForUndo(): void;
    rebuildElement(id: string): void;
    scheduleSave(): void;
  };
  log: { undo: number; rebuilds: string[]; saves: number };
} {
  const log = { undo: 0, rebuilds: [] as string[], saves: 0 };
  return {
    ctx: {
      state,
      captureForUndo() {
        log.undo += 1;
      },
      rebuildElement(id: string) {
        log.rebuilds.push(id);
      },
      scheduleSave() {
        log.saves += 1;
      },
    },
    log,
  };
}

resetRichMotionInspectorCacheForSmoke();

const hero = mediaElement('hero');
const secondary = mediaElement('secondary');
const state = siteWithElements([hero, secondary]);
const handles = mutationCtx(state);

const firstAsset = bindLottieOwnerAssetToElement(handles.ctx, hero, 'lottie-owner-1');
assert(
  hero.richMotionAssetId === firstAsset.id,
  'bind must pin the element to the new rich-motion asset',
);
assert(state.richMotionAssets?.length === 1, 'bind must create one rich-motion asset');
assert(
  firstAsset.ownerAssetId === 'lottie-owner-1',
  'created rich-motion asset must reference owner asset',
);
assert(
  firstAsset.source.kind === 'lottie-json',
  'created rich-motion asset must use lottie-json source',
);
assert(
  firstAsset.playback.reducedMotion === 'hide',
  'new Lottie assets must default to hide on reduced motion',
);
assert(handles.log.undo === 1, 'first bind must capture undo once');
assert(handles.log.rebuilds.includes('hero'), 'first bind must rebuild the edited element');
assert(handles.log.saves === 1, 'first bind must schedule save once');

const reused = bindLottieOwnerAssetToElement(handles.ctx, secondary, 'lottie-owner-1');
assert(reused.id === firstAsset.id, 'second element must reuse existing Lottie rich-motion asset');
assert(state.richMotionAssets?.length === 1, 'reuse must not duplicate rich-motion assets');
assert(secondary.richMotionAssetId === firstAsset.id, 'second bind must pin to the reused asset');

unbindRichMotionFromElement(handles.ctx, hero);
assert(hero.richMotionAssetId === undefined, 'unbind must remove the first element pin');
assert(
  state.richMotionAssets?.length === 1,
  'unbind must preserve rich-motion asset while another element uses it',
);

unbindRichMotionFromElement(handles.ctx, secondary);
assert(secondary.richMotionAssetId === undefined, 'unbind must remove the second element pin');
assert(state.richMotionAssets === undefined, 'last unbind must prune unused rich-motion asset');

const deleteTarget = mediaElement('delete-target');
const deleteState = siteWithElements([deleteTarget]);
deleteState.richMotionAssets = [
  {
    id: 'motion-delete',
    ownerAssetId: 'lottie-owner-delete',
    family: 'vector-animation',
    source: { kind: 'lottie-json' },
    playback: {
      trigger: { type: 'load' },
      loop: false,
      speed: 1,
      reducedMotion: 'hide',
    },
  },
];
deleteTarget.richMotionAssetId = 'motion-delete';

const deleteCalls: Array<{ url: string; method: string | undefined }> = [];
const confirmMessages: string[] = [];
const statusCalls: Array<{ text: string; tone: string | undefined }> = [];
let renderAllCalls = 0;
let saveCalls = 0;
let refreshCalls = 0;
const deleteCtx = {
  state: deleteState,
  apiBase: '/api',
  siteId: 'site-smoke',
  captureForUndo() {},
  findElement() {
    return null;
  },
  findSection() {
    return null;
  },
  currentPage() {
    return deleteState.pages[0] ?? null;
  },
  renderInspector() {},
  rebuildElement() {},
  preserveInspectorScrollFor() {},
  authFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    deleteCalls.push({ url, method: init?.method });
    if (url.includes('?confirm=1')) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          references: [
            {
              source: 'editable',
              siteName: 'Smoke',
              siteId: 'site-smoke',
              pageSlug: '',
              elementId: 'motion-delete',
              role: 'rich-motion-owner',
            },
          ],
        }),
        { status: 412, headers: { 'content-type': 'application/json' } },
      ),
    );
  },
  openConfirmModal(opts: { message: string }): Promise<boolean> {
    confirmMessages.push(opts.message);
    return Promise.resolve(true);
  },
  setStatus(text: string, tone?: 'ok' | 'error' | 'info') {
    statusCalls.push({ text, tone });
  },
  renderAll() {
    renderAllCalls += 1;
  },
  scheduleSave() {
    saveCalls += 1;
  },
};

await runDeleteAssetImpl(deleteCtx, 'lottie-owner-delete', () => {
  refreshCalls += 1;
  return Promise.resolve();
});

assert(deleteCalls.length === 2, 'delete flow must call probe and confirmed delete');
assert(
  deleteCalls[1]?.url === '/api/owner/assets/lottie-owner-delete?confirm=1',
  'confirmed delete URL must include ?confirm=1',
);
assert(
  confirmMessages[0]?.includes('rich-motion-owner'),
  'confirm modal must surface rich-motion owner references',
);
assert(
  deleteState.richMotionAssets === undefined,
  'local delete must remove deleted Lottie rich-motion asset',
);
assert(
  deleteTarget.richMotionAssetId === undefined,
  'local delete must remove element pin to deleted Lottie rich-motion asset',
);
assert(renderAllCalls === 1, 'local delete cleanup must render once');
assert(saveCalls === 1, 'local delete cleanup must schedule save once');
assert(refreshCalls === 1, 'delete flow must refresh after successful delete');
assert(
  statusCalls.some((call) => call.text === 'Asset deleted' && call.tone === 'ok'),
  'delete flow must report successful deletion',
);

console.log('[rich-motion-inspector:smoke] OK');
