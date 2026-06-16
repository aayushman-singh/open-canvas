import type { CanvasElement, EditableSite } from '../canvas/schema.js';
import type { RichMotionAsset, RichMotionReducedMotion } from '../canvas/rich-motion-assets.js';
import { field, selectInput } from './dom-builders.js';
import type { EditorContext } from './editor-context.js';
import { uuid } from './ids.js';

type RichMotionInspectorContext = Pick<
  EditorContext,
  | 'state'
  | 'inspector'
  | 'siteId'
  | 'apiBase'
  | 'authFetch'
  | 'postAssetUpload'
  | 'setStatus'
  | 'captureForUndo'
  | 'rebuildElement'
  | 'scheduleSave'
  | 'renderInspector'
>;

interface LottieOwnerAssetOption {
  id: string;
  mediaType: string;
}

type LottieGalleryState =
  | { status: 'loading'; assets: LottieOwnerAssetOption[]; error: null }
  | { status: 'ready'; assets: LottieOwnerAssetOption[]; error: null }
  | { status: 'error'; assets: LottieOwnerAssetOption[]; error: string };

const lottieGalleryBySite = new Map<string, LottieGalleryState>();
const lottieGalleryFetches = new Map<string, Promise<void>>();

export function resetRichMotionInspectorCacheForSmoke(): void {
  lottieGalleryBySite.clear();
  lottieGalleryFetches.clear();
}

export function appendRichMotionInspector(
  ctx: RichMotionInspectorContext,
  element: CanvasElement,
): void {
  if (!ctx.inspector) return;
  const state = requireState(ctx);
  const inspector = ctx.inspector;
  const boundAsset = findBoundRichMotionAsset(state, element);

  const heading = document.createElement('h3');
  heading.textContent = 'Rich motion';
  heading.className = 'inspector-section-heading';
  inspector.appendChild(heading);

  const bindSelect = buildRichMotionSelect(state, element);
  bindSelect.addEventListener('change', () => {
    if (bindSelect.value === '__none__') {
      unbindRichMotionFromElement(ctx, element);
      ctx.renderInspector();
      return;
    }
    bindExistingRichMotionAssetToElement(ctx, element, bindSelect.value);
    ctx.renderInspector();
  });
  inspector.appendChild(field('Animation', bindSelect));

  if (element.richMotionAssetId !== undefined && boundAsset === undefined) {
    const warning = document.createElement('div');
    warning.className = 'meta';
    warning.textContent = 'Missing rich motion asset: ' + element.richMotionAssetId;
    inspector.appendChild(warning);
  }

  appendLottieUploadRow(ctx, element, inspector);
  appendLottieLibraryRow(ctx, element, inspector);
  if (boundAsset !== undefined) appendBoundAssetControls(ctx, element, boundAsset, inspector);
}

export function bindLottieOwnerAssetToElement(
  ctx: Pick<
    RichMotionInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
  ownerAssetId: string,
): RichMotionAsset {
  if (ownerAssetId.trim().length === 0) {
    throw new Error('bindLottieOwnerAssetToElement: ownerAssetId must be non-empty');
  }
  const state = requireState(ctx);
  const existing = findReusableLottieAsset(state, ownerAssetId);
  if (existing !== undefined && element.richMotionAssetId === existing.id) return existing;

  ctx.captureForUndo();
  const previous = element.richMotionAssetId;
  const asset = existing ?? createLottieRichMotionAsset(state, ownerAssetId);
  element.richMotionAssetId = asset.id;
  if (previous !== undefined && previous !== asset.id) pruneUnusedRichMotionAsset(state, previous);
  commitElementRichMotionChange(ctx, element);
  return asset;
}

export function bindExistingRichMotionAssetToElement(
  ctx: Pick<
    RichMotionInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
  richMotionAssetId: string,
): RichMotionAsset {
  const state = requireState(ctx);
  const asset = (state.richMotionAssets ?? []).find(
    (candidate) => candidate.id === richMotionAssetId,
  );
  if (asset === undefined) {
    throw new Error(
      'bindExistingRichMotionAssetToElement: missing richMotionAsset ' + richMotionAssetId,
    );
  }
  if (element.richMotionAssetId === asset.id) return asset;
  ctx.captureForUndo();
  const previous = element.richMotionAssetId;
  element.richMotionAssetId = asset.id;
  if (previous !== undefined && previous !== asset.id) pruneUnusedRichMotionAsset(state, previous);
  commitElementRichMotionChange(ctx, element);
  return asset;
}

export function unbindRichMotionFromElement(
  ctx: Pick<
    RichMotionInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
): void {
  const previous = element.richMotionAssetId;
  if (previous === undefined) return;
  const state = requireState(ctx);
  ctx.captureForUndo();
  delete element.richMotionAssetId;
  pruneUnusedRichMotionAsset(state, previous);
  commitElementRichMotionChange(ctx, element);
}

function requireState(ctx: Pick<RichMotionInspectorContext, 'state'>): EditableSite {
  if (ctx.state === null) {
    throw new Error('rich-motion inspector requires a loaded editor state');
  }
  return ctx.state;
}

function buildRichMotionSelect(state: EditableSite, element: CanvasElement): HTMLSelectElement {
  const select = document.createElement('select');
  const none = document.createElement('option');
  none.value = '__none__';
  none.textContent = 'None';
  select.appendChild(none);

  const assets = state.richMotionAssets ?? [];
  let hasCurrent = element.richMotionAssetId === undefined;
  for (const asset of assets) {
    const option = document.createElement('option');
    option.value = asset.id;
    option.textContent = richMotionOptionLabel(asset);
    select.appendChild(option);
    if (asset.id === element.richMotionAssetId) hasCurrent = true;
  }
  if (!hasCurrent && element.richMotionAssetId !== undefined) {
    const stale = document.createElement('option');
    stale.value = element.richMotionAssetId;
    stale.textContent = element.richMotionAssetId + ' (missing)';
    select.appendChild(stale);
  }
  select.value = element.richMotionAssetId ?? '__none__';
  return select;
}

function richMotionOptionLabel(asset: RichMotionAsset): string {
  return asset.id + ' / ' + asset.source.kind + ' / ' + asset.ownerAssetId;
}

function appendLottieUploadRow(
  ctx: RichMotionInspectorContext,
  element: CanvasElement,
  inspector: HTMLElement,
): void {
  const row = document.createElement('div');
  row.className = 'style-row';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.style.display = 'none';

  const uploadBtn = document.createElement('button');
  uploadBtn.type = 'button';
  uploadBtn.className = 'style-btn';
  uploadBtn.textContent = 'Upload Lottie';
  uploadBtn.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    uploadAndBindLottie(ctx, element, file);
  });

  row.appendChild(uploadBtn);
  row.appendChild(fileInput);
  inspector.appendChild(field('Lottie JSON', row));
}

function uploadAndBindLottie(
  ctx: RichMotionInspectorContext,
  element: CanvasElement,
  file: File,
): void {
  ctx.setStatus('Uploading Lottie...', 'info');
  ctx
    .postAssetUpload(file, '', element.id)
    .then((result) => {
      if (result.kind !== 'lottie-json') {
        throw new Error('Lottie upload returned unsupported asset kind ' + result.kind);
      }
      bindLottieOwnerAssetToElement(ctx, element, result.assetId);
      lottieGalleryBySite.delete(ctx.siteId);
      ctx.renderInspector();
      ctx.setStatus('Lottie animation added', 'ok');
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      ctx.setStatus('Lottie upload failed: ' + message, 'error');
    });
}

function appendLottieLibraryRow(
  ctx: RichMotionInspectorContext,
  element: CanvasElement,
  inspector: HTMLElement,
): void {
  const gallery = ensureLottieGalleryLoaded(ctx);
  if (gallery.status === 'loading') {
    const loading = document.createElement('div');
    loading.className = 'meta';
    loading.textContent = 'Loading Lottie assets...';
    inspector.appendChild(loading);
    return;
  }
  if (gallery.status === 'error') {
    const row = document.createElement('div');
    row.className = 'style-row';
    const message = document.createElement('span');
    message.className = 'unit-label';
    message.textContent = gallery.error;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'style-btn-clear';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => {
      lottieGalleryBySite.delete(ctx.siteId);
      ctx.renderInspector();
    });
    row.appendChild(message);
    row.appendChild(retry);
    inspector.appendChild(field('Library', row));
    return;
  }

  const row = document.createElement('div');
  row.className = 'style-row';
  const select = document.createElement('select');
  select.disabled = gallery.assets.length === 0;
  for (const asset of gallery.assets) {
    const option = document.createElement('option');
    option.value = asset.id;
    option.textContent = asset.id;
    select.appendChild(option);
  }
  const useBtn = document.createElement('button');
  useBtn.type = 'button';
  useBtn.className = 'style-btn';
  useBtn.textContent = 'Use asset';
  useBtn.disabled = gallery.assets.length === 0;
  useBtn.addEventListener('click', () => {
    if (select.value.length === 0) {
      ctx.setStatus('Pick a Lottie asset first', 'error');
      return;
    }
    bindLottieOwnerAssetToElement(ctx, element, select.value);
    ctx.renderInspector();
    ctx.setStatus('Lottie animation bound', 'ok');
  });
  if (gallery.assets.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'unit-label';
    empty.textContent = 'No Lottie assets';
    row.appendChild(empty);
  } else {
    row.appendChild(select);
    row.appendChild(useBtn);
  }
  inspector.appendChild(field('Library', row));
}

function ensureLottieGalleryLoaded(ctx: RichMotionInspectorContext): LottieGalleryState {
  const cached = lottieGalleryBySite.get(ctx.siteId);
  if (cached !== undefined) return cached;
  const loading: LottieGalleryState = { status: 'loading', assets: [], error: null };
  lottieGalleryBySite.set(ctx.siteId, loading);
  if (!lottieGalleryFetches.has(ctx.siteId)) {
    const url = ctx.apiBase + '/owner/assets';
    const request = ctx
      .authFetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('GET ' + url + ' returned ' + String(response.status));
        }
        const body = (await response.json()) as { assets?: unknown };
        if (!Array.isArray(body.assets)) {
          throw new Error('GET ' + url + ' returned malformed assets[]');
        }
        const assets: LottieOwnerAssetOption[] = [];
        for (const entry of body.assets) {
          if (typeof entry !== 'object' || entry === null) {
            throw new Error('GET ' + url + ' returned a malformed asset entry');
          }
          const record = entry as {
            id?: unknown;
            assetId?: unknown;
            kind?: unknown;
            mediaType?: unknown;
          };
          if (record.kind !== 'lottie-json') continue;
          const id = typeof record.id === 'string' ? record.id : record.assetId;
          if (typeof id !== 'string' || id.length === 0) {
            throw new Error('GET ' + url + ' returned a lottie-json asset without id');
          }
          assets.push({
            id,
            mediaType: typeof record.mediaType === 'string' ? record.mediaType : '',
          });
        }
        lottieGalleryBySite.set(ctx.siteId, { status: 'ready', assets, error: null });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        lottieGalleryBySite.set(ctx.siteId, { status: 'error', assets: [], error: message });
        ctx.setStatus('Could not load Lottie assets: ' + message, 'error');
      })
      .finally(() => {
        lottieGalleryFetches.delete(ctx.siteId);
        ctx.renderInspector();
      });
    lottieGalleryFetches.set(ctx.siteId, request);
  }
  return loading;
}

function appendBoundAssetControls(
  ctx: RichMotionInspectorContext,
  element: CanvasElement,
  asset: RichMotionAsset,
  inspector: HTMLElement,
): void {
  if (asset.source.kind !== 'lottie-json') {
    const unsupported = document.createElement('div');
    unsupported.className = 'meta';
    unsupported.textContent = 'Unsupported rich motion source: ' + asset.source.kind;
    inspector.appendChild(unsupported);
    return;
  }

  const triggerOptions = ['load', 'viewport-enter'];
  if (!triggerOptions.includes(asset.playback.trigger.type)) {
    triggerOptions.push(asset.playback.trigger.type);
  }
  const trigger = selectInput(triggerOptions, asset.playback.trigger.type);
  trigger.addEventListener('change', () => {
    updateBoundRichMotionAsset(ctx, element, (current) => {
      if (trigger.value === 'load') current.playback.trigger = { type: 'load' };
      else if (trigger.value === 'viewport-enter') {
        current.playback.trigger = { type: 'viewport-enter', elementId: element.id };
      } else {
        throw new Error('rich motion trigger is not editable by this inspector: ' + trigger.value);
      }
    });
  });
  inspector.appendChild(field('Trigger', trigger));

  const loopLabel = document.createElement('label');
  loopLabel.className = 'opencanvas-toggle';
  loopLabel.title = 'Loop animation';
  const loopInput = document.createElement('input');
  loopInput.type = 'checkbox';
  loopInput.className = 'opencanvas-toggle-input';
  loopInput.checked = asset.playback.loop;
  const loopTrack = document.createElement('span');
  loopTrack.className = 'opencanvas-toggle-track';
  loopTrack.setAttribute('aria-hidden', 'true');
  loopLabel.appendChild(loopInput);
  loopLabel.appendChild(loopTrack);
  loopInput.addEventListener('change', () => {
    updateBoundRichMotionAsset(ctx, element, (current) => {
      current.playback.loop = loopInput.checked;
    });
  });
  inspector.appendChild(field('Loop', loopLabel));

  const speed = document.createElement('input');
  speed.type = 'number';
  speed.min = '0.1';
  speed.max = '4';
  speed.step = '0.1';
  speed.value = String(asset.playback.speed);
  speed.addEventListener('change', () => {
    const next = Number(speed.value);
    if (!Number.isFinite(next) || next <= 0 || next > 4) {
      ctx.setStatus('Animation speed must be between 0.1 and 4', 'error');
      speed.value = String(asset.playback.speed);
      return;
    }
    updateBoundRichMotionAsset(ctx, element, (current) => {
      current.playback.speed = next;
    });
  });
  inspector.appendChild(field('Speed', speed));

  const reducedOptions: RichMotionReducedMotion[] =
    asset.playback.reducedMotion === 'poster' ? ['hide', 'pause', 'poster'] : ['hide', 'pause'];
  const reduced = selectInput(reducedOptions, asset.playback.reducedMotion);
  reduced.addEventListener('change', () => {
    updateBoundRichMotionAsset(ctx, element, (current) => {
      current.playback.reducedMotion = reduced.value as RichMotionReducedMotion;
    });
  });
  inspector.appendChild(field('Reduced motion', reduced));

  const removeRow = document.createElement('div');
  removeRow.className = 'style-row';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'style-btn-clear';
  remove.textContent = 'Remove animation';
  remove.addEventListener('click', () => {
    unbindRichMotionFromElement(ctx, element);
    ctx.renderInspector();
  });
  removeRow.appendChild(remove);
  inspector.appendChild(field('Remove', removeRow));
}

function updateBoundRichMotionAsset(
  ctx: Pick<
    RichMotionInspectorContext,
    'state' | 'captureForUndo' | 'rebuildElement' | 'scheduleSave'
  >,
  element: CanvasElement,
  mutate: (asset: RichMotionAsset) => void,
): RichMotionAsset {
  const state = requireState(ctx);
  const asset = findBoundRichMotionAsset(state, element);
  if (asset === undefined) {
    throw new Error('updateBoundRichMotionAsset: element has no bound richMotionAsset');
  }
  ctx.captureForUndo();
  mutate(asset);
  commitElementRichMotionChange(ctx, element);
  return asset;
}

function findBoundRichMotionAsset(
  state: EditableSite,
  element: CanvasElement,
): RichMotionAsset | undefined {
  if (element.richMotionAssetId === undefined) return undefined;
  return (state.richMotionAssets ?? []).find((asset) => asset.id === element.richMotionAssetId);
}

function findReusableLottieAsset(
  state: EditableSite,
  ownerAssetId: string,
): RichMotionAsset | undefined {
  return (state.richMotionAssets ?? []).find(
    (asset) =>
      asset.family === 'vector-animation' &&
      asset.source.kind === 'lottie-json' &&
      asset.ownerAssetId === ownerAssetId,
  );
}

function createLottieRichMotionAsset(state: EditableSite, ownerAssetId: string): RichMotionAsset {
  const id = nextRichMotionAssetId(state);
  const asset: RichMotionAsset = {
    id,
    ownerAssetId,
    family: 'vector-animation',
    source: { kind: 'lottie-json' },
    playback: {
      trigger: { type: 'load' },
      loop: false,
      speed: 1,
      reducedMotion: 'hide',
    },
  };
  if (state.richMotionAssets === undefined) state.richMotionAssets = [];
  state.richMotionAssets.push(asset);
  return asset;
}

function nextRichMotionAssetId(state: EditableSite): string {
  const existing = new Set((state.richMotionAssets ?? []).map((asset) => asset.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = 'motion-' + uuid();
    if (!existing.has(id)) return id;
  }
  throw new Error('nextRichMotionAssetId: failed to generate a unique id after 20 attempts');
}

function commitElementRichMotionChange(
  ctx: Pick<RichMotionInspectorContext, 'rebuildElement' | 'scheduleSave'>,
  element: CanvasElement,
): void {
  ctx.rebuildElement(element.id);
  ctx.scheduleSave();
}

function pruneUnusedRichMotionAsset(state: EditableSite, richMotionAssetId: string): void {
  if (siteUsesRichMotionAssetId(state, richMotionAssetId)) return;
  const assets = state.richMotionAssets ?? [];
  const next = assets.filter((asset) => asset.id !== richMotionAssetId);
  if (next.length === 0) delete state.richMotionAssets;
  else state.richMotionAssets = next;
}

function siteUsesRichMotionAssetId(state: EditableSite, richMotionAssetId: string): boolean {
  let found = false;
  const visit = (element: CanvasElement): void => {
    if (found) return;
    if (element.richMotionAssetId === richMotionAssetId) {
      found = true;
      return;
    }
    if (element.type === 'tabs') {
      for (const tab of element.tabs) {
        for (const child of tab.elements) visit(child);
      }
      return;
    }
    if (element.type === 'collection') {
      for (const child of element.customTemplate ?? []) visit(child);
      for (const entry of element.entries ?? []) {
        for (const child of entry) visit(child);
      }
    }
  };
  const visitSection = (section: EditableSite['pages'][number]['sections'][number]): void => {
    for (const element of section.elements) visit(element);
  };
  if (state.header !== undefined) visitSection(state.header);
  if (state.footer !== undefined) visitSection(state.footer);
  for (const overlay of state.overlaySections ?? []) visitSection(overlay);
  for (const page of state.pages) {
    for (const section of page.sections) visitSection(section);
  }
  return found;
}
