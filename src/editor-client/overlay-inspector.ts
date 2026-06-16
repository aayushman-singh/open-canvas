import type { Overlay } from '../canvas/overlays.js';
import type { CanvasElement, CanvasSection, EditableSite } from '../canvas/schema.js';
import { field, selectInput } from './dom-builders.js';
import type { EditorContext } from './editor-context.js';
import { uuid } from './ids.js';

type OverlayMode = 'modal' | 'popover' | 'fullscreen';

interface OverlayConfig {
  mode: OverlayMode;
}

type OverlayInspectorContext = Pick<
  EditorContext,
  | 'state'
  | 'inspector'
  | 'captureForUndo'
  | 'renderAll'
  | 'scheduleSave'
  | 'renderInspector'
>;

const OVERLAY_MODES: OverlayMode[] = ['modal', 'popover', 'fullscreen'];

export function appendOverlayInspector(ctx: OverlayInspectorContext, element: CanvasElement): void {
  if (!ctx.inspector) return;
  const state = requireState(ctx);
  const overlay = findOverlayForElement(state, element);

  const heading = document.createElement('h3');
  heading.textContent = 'Overlay';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  const mode = overlay === undefined ? 'none' : modeForOverlay(overlay);
  const modeSelect = selectInput(['none', ...OVERLAY_MODES], mode);
  modeSelect.addEventListener('change', () => {
    if (modeSelect.value === 'none') {
      removeOverlayFromElement(ctx, element);
      ctx.renderInspector();
      return;
    }
    upsertOverlayForElement(ctx, element, { mode: modeSelect.value as OverlayMode });
    ctx.renderInspector();
  });
  ctx.inspector.appendChild(field('Open overlay', modeSelect));

  if (overlay === undefined) return;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = 'content: ' + overlay.contentSectionId;
  ctx.inspector.appendChild(meta);

  const removeRow = document.createElement('div');
  removeRow.className = 'style-row';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'style-btn-clear';
  remove.textContent = 'Remove overlay';
  remove.addEventListener('click', () => {
    removeOverlayFromElement(ctx, element);
    ctx.renderInspector();
  });
  removeRow.appendChild(remove);
  ctx.inspector.appendChild(field('Remove', removeRow));
}

export function findOverlayForElement(
  state: EditableSite,
  element: CanvasElement,
): Overlay | undefined {
  return (state.overlays ?? []).find(
    (overlay) => overlay.trigger.type === 'click' && overlay.trigger.elementId === element.id,
  );
}

export function upsertOverlayForElement(
  ctx: Pick<OverlayInspectorContext, 'state' | 'captureForUndo' | 'renderAll' | 'scheduleSave'>,
  element: CanvasElement,
  config: OverlayConfig,
): Overlay {
  validateElementId(element);
  if (!OVERLAY_MODES.includes(config.mode)) {
    throw new Error('upsertOverlayForElement: unsupported mode ' + config.mode);
  }
  const state = requireState(ctx);
  ctx.captureForUndo();

  let overlay = findOverlayForElement(state, element);
  if (overlay === undefined) {
    const section = createOverlaySection(state, element);
    if (state.overlaySections === undefined) state.overlaySections = [];
    state.overlaySections.push(section);
    overlay = createOverlayForElement(state, element, section.id);
    if (state.overlays === undefined) state.overlays = [];
    state.overlays.push(overlay);
  }

  applyOverlayMode(overlay, element.id, config.mode);
  commitOverlayChange(ctx);
  return overlay;
}

export function removeOverlayFromElement(
  ctx: Pick<OverlayInspectorContext, 'state' | 'captureForUndo' | 'renderAll' | 'scheduleSave'>,
  element: CanvasElement,
): void {
  const state = requireState(ctx);
  const overlay = findOverlayForElement(state, element);
  if (overlay === undefined) return;

  ctx.captureForUndo();
  const contentSectionId = overlay.contentSectionId;
  const nextOverlays = (state.overlays ?? []).filter((candidate) => candidate.id !== overlay.id);
  if (nextOverlays.length === 0) delete state.overlays;
  else state.overlays = nextOverlays;

  const sectionStillUsed = nextOverlays.some(
    (candidate) => candidate.contentSectionId === contentSectionId,
  );
  if (!sectionStillUsed) {
    const nextSections = (state.overlaySections ?? []).filter(
      (section) => section.id !== contentSectionId,
    );
    if (nextSections.length === 0) delete state.overlaySections;
    else state.overlaySections = nextSections;
  }

  commitOverlayChange(ctx);
}

function requireState(ctx: Pick<OverlayInspectorContext, 'state'>): EditableSite {
  if (ctx.state === null) {
    throw new Error('overlay inspector requires a loaded editor state');
  }
  return ctx.state;
}

function validateElementId(element: CanvasElement): void {
  if (element.id.trim().length === 0) {
    throw new Error('upsertOverlayForElement: element id must be non-empty');
  }
}

function createOverlayForElement(
  state: EditableSite,
  element: CanvasElement,
  contentSectionId: string,
): Overlay {
  return {
    id: nextOverlayId(state),
    contentSectionId,
    trigger: { type: 'click', elementId: element.id },
    modality: 'modal',
    placement: { type: 'center' },
    dismissal: {
      closeButton: true,
      escapeKey: true,
      backdropClick: true,
      routeChange: true,
    },
    focus: {
      initial: { type: 'overlay' },
      returnTo: { type: 'trigger' },
      trap: true,
    },
    bodyScroll: 'lock',
  };
}

function createOverlaySection(state: EditableSite, element: CanvasElement): CanvasSection {
  const sectionId = nextOverlaySectionId(state);
  return {
    id: sectionId,
    recipeId: 'custom',
    name: 'Overlay for ' + element.id,
    height: 420,
    elements: [
      {
        id: 'overlay-title-' + uuid(),
        type: 'text',
        box: { x: 48, y: 48, w: 640, h: 72, z: 1 },
        content: [{ text: 'Overlay title' }],
        role: 'heading',
        fontSize: 36,
        fontWeight: 700,
        align: 'left',
      },
    ],
  };
}

function applyOverlayMode(overlay: Overlay, elementId: string, mode: OverlayMode): void {
  overlay.trigger = { type: 'click', elementId };
  overlay.dismissal = {
    closeButton: true,
    escapeKey: true,
    backdropClick: true,
    routeChange: true,
  };
  overlay.focus.initial = { type: 'overlay' };
  overlay.focus.returnTo = { type: 'trigger' };

  if (mode === 'popover') {
    overlay.modality = 'non-modal';
    overlay.placement = { type: 'anchored', anchorElementId: elementId, side: 'bottom' };
    overlay.focus.trap = false;
    overlay.bodyScroll = 'allow';
    return;
  }

  overlay.modality = 'modal';
  overlay.placement = mode === 'fullscreen' ? { type: 'fullscreen' } : { type: 'center' };
  overlay.focus.trap = true;
  overlay.bodyScroll = 'lock';
}

function modeForOverlay(overlay: Overlay): 'modal' | 'popover' | 'fullscreen' {
  if (overlay.placement.type === 'anchored') return 'popover';
  if (overlay.placement.type === 'fullscreen') return 'fullscreen';
  return 'modal';
}

function nextOverlayId(state: EditableSite): string {
  const existing = new Set((state.overlays ?? []).map((overlay) => overlay.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = 'overlay-' + uuid();
    if (!existing.has(id)) return id;
  }
  throw new Error('nextOverlayId: failed to generate a unique id after 20 attempts');
}

function nextOverlaySectionId(state: EditableSite): string {
  const existing = new Set((state.overlaySections ?? []).map((section) => section.id));
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = 'overlay-section-' + uuid();
    if (!existing.has(id)) return id;
  }
  throw new Error('nextOverlaySectionId: failed to generate a unique id after 20 attempts');
}

function commitOverlayChange(
  ctx: Pick<OverlayInspectorContext, 'renderAll' | 'scheduleSave'>,
): void {
  ctx.renderAll();
  ctx.scheduleSave();
}
