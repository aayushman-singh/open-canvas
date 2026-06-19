// src/editor-client/inspector-media-mounts.ts
//
// ADR 0058 Phase 2h.2.a — media inspector mount functions.
// canvas-client.ts:4772-4838 carries the inline twins; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// Two mounts:
//   - mountMediaAi: image-only "AI media" button wired through
//     ctx.INSPECTOR_ACTION_HANDLERS["replace-media"]. Disabled while
//     ctx.aiBusy is true.
//   - mountVideoPlayback: video-only autoplay/muted/loop/controls switches
//     with the autoplay-implies-muted enforcement intact and the lazy
//     element.playback default-init on first inspector open.

import type { EditorContext, PersistContext } from './editor-context.js';
import type { MediaElement } from '../canvas/elements/media.js';
import {
  VIDEO_HOVER_PLAYBACK_MODES,
  VIDEO_HOVER_REDUCED_MOTION_MODES,
  type VideoHoverPlaybackMode,
  type VideoHoverReducedMotionMode,
} from '../canvas/elements/media.js';

// ADR 0064 — media inspector mounts split into two narrow surfaces.
// `mountMediaAi` reaches into the AI sidecar's busy flag + the inspector
// action-handler registry, both module-specific verbs that do NOT have
// a named cluster (the AI context aliases own panel state, not the
// action-handler dispatch table). Inline Pick declares the surface
// honestly. `mountVideoPlayback` only schedules saves on checkbox change,
// so it earns `PersistContext`.
export type InspectorMediaAiContext = Pick<
  EditorContext,
  'aiBusy' | 'INSPECTOR_ACTION_HANDLERS'
>;

export type InspectorVideoPlaybackContext = PersistContext &
  Pick<EditorContext, 'rebuildElement' | 'renderInspector' | 'setStatus'>;

// AI media generation is image-only. Skip rendering for video elements
// entirely — the upstream model has no video synthesis endpoint, so the
// button used to fail with "server did not return image bytes" if owners
// tried it. The image branch matches the legacy button-action shape:
// primary inspector button wired to the replaceMedia AI handler.
export function mountMediaAi(
  ctx: InspectorMediaAiContext,
  element: MediaElement,
  host: HTMLElement,
): void {
  if (element.mediaKind === 'video') return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'AI media';
  btn.setAttribute('data-ai-button', 'replace-media');
  if (ctx.aiBusy) btn.disabled = true;
  const handler = ctx.INSPECTOR_ACTION_HANDLERS['replace-media'];
  if (typeof handler !== 'function') {
    throw new Error('mountMediaAi: no action handler registered for replace-media');
  }
  btn.addEventListener('click', function () {
    handler(element.id);
  });
  host.appendChild(btn);
}

// Video-playback controls — autoplay, muted, loop, controls — with the
// autoplay-implies-muted enforcement that the legacy buildMediaInspector
// carried. No-op on images. Lazy-initialises element.playback on first
// render so older sites that pre-date the playback field still pick up
// the default shape on first inspector open.
export function mountVideoPlayback(
  ctx: InspectorVideoPlaybackContext,
  element: MediaElement,
  host: HTMLElement,
): void {
  if (element.mediaKind !== 'video') return;
  const playback =
    element.playback ||
    (element.playback = { autoplay: false, muted: true, loop: false, controls: true });

  // Build a single toggle pill (label.opencanvas-toggle) and return the
  // wrapper row plus the live input handle. Four sites in this function
  // all share the same shape, so the local helper earns its keep.
  function buildToggle(
    labelText: string,
    initialChecked: boolean,
  ): { row: HTMLDivElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'field field--toggle';
    const lbl = document.createElement('label');
    lbl.className = 'opencanvas-toggle';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'opencanvas-toggle-input';
    input.checked = initialChecked;
    const track = document.createElement('span');
    track.className = 'opencanvas-toggle-track';
    track.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'opencanvas-toggle-text';
    text.textContent = labelText;
    lbl.appendChild(input);
    lbl.appendChild(track);
    lbl.appendChild(text);
    row.appendChild(lbl);
    return { row, input };
  }

  const autoplayBuilt = buildToggle('autoplay', !!playback.autoplay);
  const autoplay = autoplayBuilt.input;
  const mutedBuilt = buildToggle('muted', !!playback.muted);
  const muted = mutedBuilt.input;
  const loopBuilt = buildToggle('loop', !!playback.loop);
  const loop = loopBuilt.input;
  const controlsBuilt = buildToggle('controls', !!playback.controls);
  const controls = controlsBuilt.input;

  function enforceMuted() {
    if (autoplay.checked) {
      muted.checked = true;
      muted.disabled = true;
    } else {
      muted.disabled = false;
    }
  }
  enforceMuted();

  autoplay.addEventListener('change', function () {
    playback.autoplay = autoplay.checked;
    enforceMuted();
    playback.muted = muted.checked;
    ctx.scheduleSave();
  });
  muted.addEventListener('change', function () {
    if (autoplay.checked) {
      muted.checked = true;
      return;
    }
    playback.muted = muted.checked;
    ctx.scheduleSave();
  });
  loop.addEventListener('change', function () {
    playback.loop = loop.checked;
    ctx.scheduleSave();
  });
  controls.addEventListener('change', function () {
    playback.controls = controls.checked;
    ctx.scheduleSave();
  });

  host.appendChild(autoplayBuilt.row);
  host.appendChild(mutedBuilt.row);
  host.appendChild(loopBuilt.row);
  host.appendChild(controlsBuilt.row);

  const hoverHeading = document.createElement('h3');
  hoverHeading.textContent = 'Video Stream Hover';
  hoverHeading.className = 'inspector-section-heading';
  host.appendChild(hoverHeading);

  const hoverBuilt = buildToggle('play on hover/focus', element.hoverPlayback?.enabled === true);
  const hoverEnabled = hoverBuilt.input;
  hoverEnabled.addEventListener('change', function () {
    ctx.captureForUndo();
    if (hoverEnabled.checked) {
      playback.autoplay = false;
      autoplay.checked = false;
      enforceMuted();
      element.hoverPlayback = {
        enabled: true,
        mode: 'play-reset',
        scrubOnHover: false,
        reducedMotion: 'disabled',
      };
    } else {
      delete element.hoverPlayback;
    }
    ctx.rebuildElement(element.id);
    ctx.renderInspector();
    ctx.scheduleSave();
  });
  host.appendChild(hoverBuilt.row);

  if (element.hoverPlayback?.enabled !== true) return;

  function buildSelect(
    labelText: string,
    options: readonly string[],
    value: string,
  ): { row: HTMLDivElement; select: HTMLSelectElement } {
    const row = document.createElement('div');
    row.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const select = document.createElement('select');
    for (const option of options) {
      const item = document.createElement('option');
      item.value = option;
      item.textContent = option;
      if (option === value) item.selected = true;
      select.appendChild(item);
    }
    label.appendChild(select);
    row.appendChild(label);
    return { row, select };
  }

  function buildText(
    labelText: string,
    value: string,
    placeholder: string,
  ): { row: HTMLDivElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = placeholder;
    label.appendChild(input);
    row.appendChild(label);
    return { row, input };
  }

  const modeBuilt = buildSelect('Hover mode', VIDEO_HOVER_PLAYBACK_MODES, element.hoverPlayback.mode);
  modeBuilt.select.addEventListener('change', function () {
    ctx.captureForUndo();
    element.hoverPlayback!.mode = modeBuilt.select.value as VideoHoverPlaybackMode;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(modeBuilt.row);

  const scrubBuilt = buildToggle('Scrub by pointer', element.hoverPlayback.scrubOnHover === true);
  scrubBuilt.input.addEventListener('change', function () {
    ctx.captureForUndo();
    element.hoverPlayback!.scrubOnHover = scrubBuilt.input.checked;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(scrubBuilt.row);

  const streamBuilt = buildText(
    'Hover stream asset',
    element.hoverPlayback.streamAssetId ?? '',
    'uploaded video asset id',
  );
  streamBuilt.input.addEventListener('change', function () {
    ctx.captureForUndo();
    const value = streamBuilt.input.value.trim();
    if (value.length === 0) {
      delete element.hoverPlayback!.streamAssetId;
    } else {
      element.hoverPlayback!.streamAssetId = value;
    }
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(streamBuilt.row);

  const posterBuilt = buildText(
    'Hover poster asset',
    element.hoverPlayback.streamPosterAssetId ?? '',
    'uploaded image asset id',
  );
  posterBuilt.input.addEventListener('change', function () {
    ctx.captureForUndo();
    const value = posterBuilt.input.value.trim();
    if (value.length === 0) {
      delete element.hoverPlayback!.streamPosterAssetId;
    } else {
      element.hoverPlayback!.streamPosterAssetId = value;
    }
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(posterBuilt.row);

  const reducedBuilt = buildSelect(
    'Reduced motion',
    VIDEO_HOVER_REDUCED_MOTION_MODES,
    element.hoverPlayback.reducedMotion,
  );
  reducedBuilt.select.addEventListener('change', function () {
    ctx.captureForUndo();
    element.hoverPlayback!.reducedMotion = reducedBuilt.select.value as VideoHoverReducedMotionMode;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  host.appendChild(reducedBuilt.row);
}
