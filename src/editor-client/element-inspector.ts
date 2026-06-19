// src/editor-client/element-inspector.ts
//
// ADR 0058 Phase 2h.3.c — element inspector orchestrator.
// canvas-client.ts:6626-7102 carries the inline twin; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// Orchestration shape:
//   1. Reel-open / no-selection / missing-element early returns.
//   2. Inspector header (heading + close button) + id meta.
//   3. Read-only kit summary. Z-order (front/forward/backward/back),
//      Duplicate, and Delete live in the 3-dot element menu
//      (./element-menu.ts); surfacing them in the inspector duplicated
//      the menu's affordances and cluttered the panel. Per-element
//      reading-order has no semantic weight either — element ordering
//      inside a section doesn't change the page outline — so it stays
//      scoped to sections (./section-inspector.ts) where it does matter.
//   4. Per-element-type spec table lookup (INSPECTOR_DISPATCH) → call
//      ctx.renderInspectorSpec to walk the spec into DOM.
//   5. The big inline `buildStyleSection` IIFE — element-level visual
//      controls (background colour/image/size, border radius, border,
//      opacity, box-shadow presets+custom, text colour, overflow,
//      "Reset all"). PRESERVED VERBATIM with `ctx.<name>` rewrites for
//      closure accesses — no structural changes.
//   6. Motion preset + delay + per-element replay button (calls
//      replayAnimations from ./page-inspector.js).
//
// Non-element branches:
//   - selectedSectionId set → renderSectionInspector (sibling module).
//   - else (no selection) → renderPageInspector (sibling module).

import type { EditorContext } from './editor-context.js';
import type { InspectorSpec } from '../canvas/elements/inspector-spec.js';
import type { CanvasElement } from '../canvas/schema.js';
import {
  MARQUEE_DIRECTIONS,
  MARQUEE_COLLECTION_FIELDS,
  MARQUEE_REDUCED_MOTION_MODES,
  MOTION_PRESETS,
  POINTER_FX_DRAG_AXES,
  POINTER_FX_PRIMITIVES,
  POINTER_FX_REDUCED_MOTION_MODES,
  POINTER_FX_TOUCH_ACTIVATION_MODES,
  type MarqueeCollectionField,
  type MarqueeDirection,
  type MarqueeReducedMotionMode,
  type MotionPreset,
  type PointerFxDragAxis,
  type PointerFxPrimitive,
  type PointerFxReducedMotionMode,
  type PointerFxTouchActivationMode,
} from '../canvas/schema.js';
import {
  TEXT_SPLIT_UNITS,
  type MotionSequence,
  type MotionSequenceStep,
  type ScrollScene,
} from '../canvas/behaviour-primitives.js';
import type {
  CollectionElement,
  CollectionGalleryAxis,
  CollectionGalleryReducedMotionMode,
  CollectionSort,
} from '../canvas/elements/collection.js';
import {
  COLLECTION_DISPLAYS,
  COLLECTION_GALLERY_AXES,
  COLLECTION_GALLERY_REDUCED_MOTION_MODES,
  COLLECTION_SORTS,
} from '../canvas/elements/collection.js';
import {
  VIDEO_HOVER_PLAYBACK_MODES,
  VIDEO_HOVER_REDUCED_MOTION_MODES,
  type VideoHoverPlaybackMode,
  type VideoHoverReducedMotionMode,
} from '../canvas/elements/media.js';
import { seedCustomTemplate } from '../canvas/elements/collection-defaults.js';
import { templateHasAnyPlaceholder } from '../canvas/elements/collection-materializer.js';
import { renderSectionInspector } from './section-inspector.js';
import { renderPageInspector, replayAnimations } from './page-inspector.js';
import { field, selectInput } from './dom-builders.js';
import { mountComponentStyle } from './inspector-component-style.js';
import { buildColorRow, buildKitSummary } from './inspector-leaf-builders.js';

export function renderInspector(ctx: EditorContext): void {
  if (!ctx.inspector) return;
  if (ctx.isReelOpen) {
    ctx.inspector.hidden = true;
    ctx.revokePendingPreviews();
    ctx.inspector.replaceChildren();
    ctx.inspectorRenderSubject = null;
    return;
  }
  if (!ctx.selectedElementId) {
    if (ctx.selectedSectionId) {
      renderSectionInspector(ctx);
    } else {
      renderPageInspector(ctx);
    }
    return;
  }
  const found = ctx.findElement(ctx.selectedElementId);
  if (!found) {
    ctx.inspector.hidden = true;
    ctx.revokePendingPreviews();
    ctx.inspector.replaceChildren();
    ctx.inspectorRenderSubject = null;
    return;
  }
  ctx.inspector.hidden = false;
  const { element } = found;
  ctx.preserveInspectorScrollFor('element:' + element.id);
  ctx.revokePendingPreviews();
  ctx.inspector.replaceChildren();

  const headerRow = document.createElement('div');
  headerRow.className = 'inspector-header';
  const heading = document.createElement('h3');
  heading.textContent = element.type + ' element';
  headerRow.appendChild(heading);
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'inspector-close';
  closeBtn.setAttribute('aria-label', 'Close inspector');
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    ctx.selectElement(null);
  });
  headerRow.appendChild(closeBtn);
  ctx.inspector.appendChild(headerRow);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = 'id: ' + element.id;
  ctx.inspector.appendChild(meta);

  // Active style-kit read-only summary. The token values are read directly
  // off the editor wrapper's computed CSS so the summary stays in sync with
  // whatever kit is active without the client having to ship a duplicate
  // copy of STYLE_KIT_PRESETS. Hidden if the wrapper isn't there yet.
  ctx.inspector.appendChild(buildKitSummary(ctx));

  // ADR 0011 Step 1 cutover: INSPECTOR_DISPATCH is now
  // Record<Exclude<ElementType, 'collection'>, InspectorSpec> — every
  // element type except collection has a spec; missing a spec for a new
  // element type fails TypeScript compile in src/canvas/elements/index.ts.
  // collection still flows through here at runtime; the indexed lookup
  // returns undefined for it and the inspector body stays empty (children
  // render their own inspectors when selected).
  const inspectorSpec: InspectorSpec | undefined = (
    ctx.INSPECTOR_DISPATCH as Record<string, InspectorSpec | undefined>
  )[element.type];
  if (inspectorSpec) {
    ctx.renderInspectorSpec(inspectorSpec, element);
  } else if (element.type === 'collection') {
    // ADR 0063 dec 8 + dec 10 — Collection is the only element whose
    // inspector lives outside the InspectorSpec dispatch (the dispatch
    // type-excludes 'collection'). The reasons:
    //  - the fields are dynamic (folder list depends on slug, manual reel
    //    depends on sort) and the InspectorSpec walker assumes a static
    //    field tree;
    //  - the source-slug dropdown fires a network read (and surfaces
    //    inline status), which the walker has no hook for;
    //  - the manual-reel drag-and-drop primitive is element-local and
    //    F4 explicitly defers extracting a shared sortable component
    //    until a third caller exists.
    // Hence the bespoke renderer below.
    renderCollectionInspector(ctx, element);
  }

  // -- Element style controls -----------------------------------------------
  (function buildStyleSection() {
    const styleHeading = document.createElement('h3');
    styleHeading.textContent = 'Style';
    styleHeading.className = 'inspector-section-heading';
    ctx.inspector.appendChild(styleHeading);

    const es = element.elementStyle || {};

    function onStyleChange() {
      let empty = true;
      for (const k in es) {
        if ((es as Record<string, unknown>)[k] !== undefined) {
          empty = false;
          break;
        }
      }
      if (empty) {
        delete element.elementStyle;
      } else {
        element.elementStyle = es;
      }
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    }

    // -- Background color (uses the module-level buildColorRow helper)
    const bgRow = buildColorRow({
      getValue: function () {
        return es.backgroundColor;
      },
      setValue: function (v) {
        es.backgroundColor = v;
      },
      clearValue: function () {
        delete es.backgroundColor;
      },
      onChange: onStyleChange,
      enabledTitle: 'Enable background color',
      swatchDefault: '#000000',
      resetLabel: 'Clear',
    });
    ctx.inspector.appendChild(field('Background', bgRow));

    // -- Background image upload
    const bgImgRow = document.createElement('div');
    bgImgRow.className = 'style-row';
    const bgImgThumb = document.createElement('div');
    bgImgThumb.className = 'bg-img-thumb';
    if (es.backgroundImageAssetId) {
      const thumbImg = document.createElement('img');
      thumbImg.src =
        ctx.siteBase + '/assets/' + encodeURIComponent(es.backgroundImageAssetId);
      thumbImg.alt = '';
      bgImgThumb.appendChild(thumbImg);
    } else {
      bgImgThumb.textContent = 'none';
    }
    const bgImgUpload = document.createElement('button');
    bgImgUpload.type = 'button';
    bgImgUpload.textContent = 'Upload';
    bgImgUpload.className = 'style-btn';
    const bgImgClear = document.createElement('button');
    bgImgClear.type = 'button';
    bgImgClear.textContent = 'x';
    bgImgClear.className = 'style-btn-clear';
    bgImgClear.title = 'Clear only the background image override';
    bgImgClear.disabled = !es.backgroundImageAssetId;
    // File input lives in the DOM so the picker actually opens. Chromium
    // silently no-ops .click() on a detached input[type=file] as a
    // user-gesture security measure — mirroring the main media upload at
    // line ~4855 which also appends its hidden input to the row.
    const bgImgFileInput = document.createElement('input');
    bgImgFileInput.type = 'file';
    bgImgFileInput.accept = 'image/*';
    bgImgFileInput.style.display = 'none';
    bgImgFileInput.addEventListener('change', function () {
      if (!bgImgFileInput.files || bgImgFileInput.files.length === 0) return;
      const file = bgImgFileInput.files[0]!;
      ctx.setStatus('Uploading background...', 'info');
      ctx
        .postAssetUpload(file, '', element.id)
        .then(function (result) {
          es.backgroundImageAssetId = result.assetId;
          if (!es.backgroundSize) es.backgroundSize = 'cover';
          onStyleChange();
          renderInspector(ctx);
          ctx.setStatus('Background image set', 'ok');
        })
        .catch(function (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          ctx.setStatus('Upload failed: ' + message, 'error');
        });
    });
    bgImgUpload.addEventListener('click', function () {
      bgImgFileInput.value = '';
      bgImgFileInput.click();
    });
    bgImgClear.addEventListener('click', function () {
      delete es.backgroundImageAssetId;
      delete es.backgroundSize;
      onStyleChange();
      renderInspector(ctx);
    });
    bgImgRow.appendChild(bgImgThumb);
    bgImgRow.appendChild(bgImgUpload);
    bgImgRow.appendChild(bgImgClear);
    bgImgRow.appendChild(bgImgFileInput);
    ctx.inspector.appendChild(field('Bg image', bgImgRow));

    if (es.backgroundImageAssetId) {
      const bgSizeSelect = selectInput(['cover', 'contain'], es.backgroundSize || 'cover');
      bgSizeSelect.addEventListener('change', function () {
        es.backgroundSize = bgSizeSelect.value as 'cover' | 'contain';
        onStyleChange();
      });
      ctx.inspector.appendChild(field('Bg size', bgSizeSelect));
    }

    // -- Border radius
    const radiusRow = document.createElement('div');
    radiusRow.className = 'style-row';
    const radiusInput = document.createElement('input');
    radiusInput.type = 'number';
    radiusInput.min = '0';
    radiusInput.max = '200';
    radiusInput.placeholder = 'inherit';
    radiusInput.value = typeof es.borderRadius === 'number' ? String(es.borderRadius) : '';
    radiusInput.addEventListener('change', function () {
      if (radiusInput.value === '') {
        delete es.borderRadius;
      } else {
        const n = Number(radiusInput.value);
        if (Number.isFinite(n) && n >= 0) es.borderRadius = n;
      }
      onStyleChange();
    });
    const radiusUnit = document.createElement('span');
    radiusUnit.className = 'unit-label';
    radiusUnit.textContent = 'px';
    radiusRow.appendChild(radiusInput);
    radiusRow.appendChild(radiusUnit);
    ctx.inspector.appendChild(field('Corner radius', radiusRow));

    // -- Border color + width
    const borderRow = document.createElement('div');
    borderRow.className = 'style-row';
    const borderColor = document.createElement('input');
    borderColor.type = 'color';
    borderColor.value = es.borderColor || '#ffffff';
    borderColor.className = 'color-swatch';
    const borderHex = document.createElement('input');
    borderHex.type = 'text';
    borderHex.className = 'color-hex';
    borderHex.value = es.borderColor || '';
    borderHex.placeholder = '#ffffff';
    borderHex.spellcheck = false;
    borderHex.maxLength = 7;
    const borderEnabledLabel = document.createElement('label');
    borderEnabledLabel.className = 'opencanvas-toggle';
    borderEnabledLabel.title = 'Enable border';
    const borderEnabled = document.createElement('input');
    borderEnabled.type = 'checkbox';
    borderEnabled.className = 'opencanvas-toggle-input';
    borderEnabled.checked = !!(es.borderColor || typeof es.borderWidth === 'number');
    borderEnabled.title = 'Enable border';
    const borderEnabledTrack = document.createElement('span');
    borderEnabledTrack.className = 'opencanvas-toggle-track';
    borderEnabledTrack.setAttribute('aria-hidden', 'true');
    borderEnabledLabel.appendChild(borderEnabled);
    borderEnabledLabel.appendChild(borderEnabledTrack);
    const borderWidth = document.createElement('input');
    borderWidth.type = 'number';
    borderWidth.min = '0';
    borderWidth.max = '20';
    borderWidth.value = typeof es.borderWidth === 'number' ? String(es.borderWidth) : '1';
    borderWidth.style.width = '48px';
    const bwUnit = document.createElement('span');
    bwUnit.className = 'unit-label';
    bwUnit.textContent = 'px';
    borderEnabled.addEventListener('change', function () {
      if (borderEnabled.checked) {
        es.borderColor = borderColor.value;
        es.borderWidth = Number(borderWidth.value) || 1;
        borderHex.value = borderColor.value;
      } else {
        delete es.borderColor;
        delete es.borderWidth;
        borderHex.value = '';
      }
      onStyleChange();
    });
    borderColor.addEventListener('input', function () {
      if (!borderEnabled.checked) borderEnabled.checked = true;
      es.borderColor = borderColor.value;
      borderHex.value = borderColor.value;
      if (typeof es.borderWidth !== 'number') es.borderWidth = Number(borderWidth.value) || 1;
      onStyleChange();
    });
    borderHex.addEventListener('input', function () {
      const v = borderHex.value.trim();
      if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v)) {
        const normalised =
          v.length === 4
            ? ('#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3]).toLowerCase()
            : v.toLowerCase();
        borderColor.value = normalised;
        if (!borderEnabled.checked) borderEnabled.checked = true;
        es.borderColor = normalised;
        if (typeof es.borderWidth !== 'number') es.borderWidth = Number(borderWidth.value) || 1;
        onStyleChange();
      }
    });
    borderWidth.addEventListener('change', function () {
      const n = Number(borderWidth.value);
      if (Number.isFinite(n) && n >= 0) {
        es.borderWidth = n;
        if (!borderEnabled.checked) borderEnabled.checked = true;
        if (!es.borderColor) es.borderColor = borderColor.value;
        onStyleChange();
      }
    });
    borderRow.appendChild(borderEnabledLabel);
    borderRow.appendChild(borderColor);
    borderRow.appendChild(borderHex);
    borderRow.appendChild(borderWidth);
    borderRow.appendChild(bwUnit);
    ctx.inspector.appendChild(field('Border', borderRow));

    // -- Opacity
    const opacityRow = document.createElement('div');
    opacityRow.className = 'style-row';
    const opacityRange = document.createElement('input');
    opacityRange.type = 'range';
    opacityRange.min = '0';
    opacityRange.max = '1';
    opacityRange.step = '0.05';
    opacityRange.value = typeof es.opacity === 'number' ? String(es.opacity) : '1';
    const opacityReadout = document.createElement('span');
    opacityReadout.className = 'unit-label';
    opacityReadout.textContent = typeof es.opacity === 'number' ? String(es.opacity) : '1';
    opacityRange.addEventListener('input', function () {
      const n = Number(opacityRange.value);
      opacityReadout.textContent = String(n);
      if (n >= 1) {
        delete es.opacity;
      } else {
        es.opacity = n;
      }
      onStyleChange();
    });
    opacityRow.appendChild(opacityRange);
    opacityRow.appendChild(opacityReadout);
    ctx.inspector.appendChild(field('Opacity', opacityRow));

    // -- Box shadow. Preset dropdown covers ~99% of needs; "Custom CSS…"
    // reveals a raw text field so power users can paste arbitrary
    // box-shadow strings (the schema stores boxShadow as a raw CSS string
    // either way, so presets and custom values share the same code path
    // in render.ts).
    const SHADOW_PRESETS = [
      { value: '', label: 'None' },
      { value: '0 1px 2px rgba(0,0,0,0.06)', label: 'Subtle' },
      { value: '0 2px 8px rgba(0,0,0,0.08)', label: 'Soft' },
      { value: '0 4px 14px rgba(0,0,0,0.10)', label: 'Medium' },
      { value: '0 10px 30px rgba(0,0,0,0.14)', label: 'Large' },
      { value: '0 20px 50px rgba(0,0,0,0.20)', label: 'Dramatic' },
    ];
    const shadowRow = document.createElement('div');
    shadowRow.className = 'style-row';
    shadowRow.style.flexDirection = 'column';
    shadowRow.style.alignItems = 'stretch';
    shadowRow.style.gap = '6px';
    const shadowSelect = document.createElement('select');
    for (let spi = 0; spi < SHADOW_PRESETS.length; spi++) {
      const sp = SHADOW_PRESETS[spi]!;
      const spOpt = document.createElement('option');
      spOpt.value = sp.value;
      spOpt.textContent = sp.label;
      shadowSelect.appendChild(spOpt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom CSS…';
    shadowSelect.appendChild(customOpt);
    const shadowCustom = document.createElement('input');
    shadowCustom.type = 'text';
    shadowCustom.placeholder = 'e.g. 0 4px 12px rgba(0,0,0,0.15)';
    shadowCustom.value = es.boxShadow || '';
    const currentShadow = es.boxShadow || '';
    const matchedPreset = SHADOW_PRESETS.find(function (p) {
      return p.value === currentShadow;
    });
    if (matchedPreset) {
      shadowSelect.value = matchedPreset.value;
      shadowCustom.hidden = true;
    } else {
      shadowSelect.value = '__custom__';
      shadowCustom.hidden = false;
    }
    shadowSelect.addEventListener('change', function () {
      if (shadowSelect.value === '__custom__') {
        shadowCustom.hidden = false;
        shadowCustom.focus();
        return;
      }
      shadowCustom.hidden = true;
      if (shadowSelect.value === '') {
        delete es.boxShadow;
      } else {
        es.boxShadow = shadowSelect.value;
      }
      shadowCustom.value = shadowSelect.value;
      onStyleChange();
    });
    shadowCustom.addEventListener('change', function () {
      const v = shadowCustom.value.trim();
      if (v === '' || v === 'none') {
        delete es.boxShadow;
      } else {
        es.boxShadow = v;
      }
      onStyleChange();
    });
    shadowRow.appendChild(shadowSelect);
    shadowRow.appendChild(shadowCustom);
    ctx.inspector.appendChild(field('Shadow', shadowRow));

    // -- Text color
    const textColorRow = buildColorRow({
      getValue: function () {
        return es.color;
      },
      setValue: function (v) {
        es.color = v;
      },
      clearValue: function () {
        delete es.color;
      },
      onChange: onStyleChange,
      enabledTitle: 'Enable text color override',
      swatchDefault: '#ffffff',
    });
    ctx.inspector.appendChild(field('Text color', textColorRow));

    // -- Overflow
    const overflowSelect = selectInput(['auto', 'visible', 'hidden'], es.overflow || 'auto');
    overflowSelect.addEventListener('change', function () {
      if (overflowSelect.value === 'auto') {
        delete es.overflow;
      } else {
        es.overflow = overflowSelect.value as 'visible' | 'hidden';
      }
      onStyleChange();
    });
    ctx.inspector.appendChild(field('Overflow', overflowSelect));

    // -- Reset all element styles. The per-property × buttons only clear
    // their own slot; this nukes the entire elementStyle so an Owner who
    // wants a clean slate doesn't have to walk every control.
    const resetRow = document.createElement('div');
    resetRow.className = 'style-row';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'style-btn-clear';
    resetBtn.textContent = 'Reset all';
    resetBtn.title = 'Remove every per-element style override on this element';
    resetBtn.disabled = !element.elementStyle;
    resetBtn.addEventListener('click', function () {
      delete element.elementStyle;
      ctx.rebuildElement(element.id);
      renderInspector(ctx);
      ctx.scheduleSave();
    });
    resetRow.appendChild(resetBtn);
    ctx.inspector.appendChild(field('Reset', resetRow));
  })();

  // Motion controls.
  const motionPreset = selectInput(
    MOTION_PRESETS,
    element.motion ? element.motion.preset : 'none',
  );
  motionPreset.addEventListener('change', () => {
    if (motionPreset.value === 'none') {
      delete element.motion;
    } else {
      const next: { preset: MotionPreset; delayMs?: number } = {
        preset: motionPreset.value as MotionPreset,
      };
      if (element.motion && typeof element.motion.delayMs === 'number') {
        next.delayMs = element.motion.delayMs;
      }
      element.motion = next;
    }
    ctx.rebuildElement(element.id);
    // Replace + reapply the data-motion-preset attribute on the freshly-
    // rebuilt wrapper so the kit's CSS animation actually fires. Without
    // this the wrapper-replacement alone landed inside the same paint as
    // the attribute, and Chromium occasionally short-circuited the
    // keyframe restart — owners read it as "picking a preset does
    // nothing." replayAnimations forces a layout read so the animation
    // restarts deterministically.
    if (element.motion) replayAnimations(ctx, element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Motion preset', motionPreset));

  if (element.motion) {
    const delay = document.createElement('input');
    delay.type = 'number';
    delay.min = '0';
    delay.max = '2000';
    delay.value = String(element.motion.delayMs || 0);
    delay.addEventListener('change', () => {
      const n = Number(delay.value);
      if (Number.isFinite(n) && n >= 0 && n <= 2000) {
        element.motion!.delayMs = n;
        ctx.rebuildElement(element.id);
        replayAnimations(ctx, element.id);
        ctx.scheduleSave();
      }
    });
    ctx.inspector.appendChild(field('Motion delay (ms)', delay));
  }

  renderMarqueeInspector(ctx, element, found.section.elements);
  renderPointerFxInspector(ctx, element);

  if (element.type === 'text') {
    renderTextSplitInspector(ctx, element.id, found.section.id);
  }

  // Play/replay button for this element's animation.
  const elPlayBtn = document.createElement('button');
  elPlayBtn.type = 'button';
  elPlayBtn.className = 'opencanvas-replay-btn';
  const elPlayIcon = document.createElement('span');
  elPlayIcon.className = 'play-icon';
  elPlayBtn.appendChild(elPlayIcon);
  const elPlayLabel = document.createElement('span');
  elPlayLabel.textContent = 'Replay animation';
  elPlayBtn.appendChild(elPlayLabel);
  if (!element.motion) elPlayBtn.disabled = true;
  elPlayBtn.addEventListener('click', function () {
    replayAnimations(ctx, element.id);
  });
  ctx.inspector.appendChild(elPlayBtn);

  if (ctx.state?.overlays && ctx.state.overlays.length > 0) {
    const triggerHeading = document.createElement('h3');
    triggerHeading.textContent = 'Overlay trigger';
    triggerHeading.className = 'inspector-section-heading';
    ctx.inspector.appendChild(triggerHeading);

    const overlaySelect = document.createElement('select');
    for (const overlay of ctx.state.overlays) {
      const option = document.createElement('option');
      option.value = overlay.id;
      option.textContent = overlay.name || overlay.id;
      overlaySelect.appendChild(option);
    }
    ctx.inspector.appendChild(field('Overlay', overlaySelect));

    const useAsTriggerBtn = document.createElement('button');
    useAsTriggerBtn.type = 'button';
    useAsTriggerBtn.className = 'opencanvas-replay-btn';
    useAsTriggerBtn.textContent = 'Use as overlay trigger';
    useAsTriggerBtn.addEventListener('click', function () {
      ctx.useSelectedElementAsOverlayTrigger(overlaySelect.value);
    });
    ctx.inspector.appendChild(useAsTriggerBtn);
  }
}

function renderPointerFxInspector(ctx: EditorContext, element: CanvasElement): void {
  if (!ctx.inspector) return;
  const heading = document.createElement('h3');
  heading.textContent = 'Pointer FX';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = element.pointerFx?.enabled === true;
  enabled.addEventListener('change', () => {
    ctx.captureForUndo();
    if (enabled.checked) {
      element.pointerFx = {
        enabled: true,
        primitive: 'tilt',
        reducedMotion: 'disabled',
        touchActivation: 'none',
      };
    } else {
      delete element.pointerFx;
    }
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Enable pointer FX', enabled));

  if (element.pointerFx?.enabled !== true) return;

  const primitive = selectInput(POINTER_FX_PRIMITIVES, element.pointerFx.primitive);
  primitive.addEventListener('change', () => {
    ctx.captureForUndo();
    element.pointerFx!.primitive = primitive.value as PointerFxPrimitive;
    if (element.pointerFx!.primitive === 'image-follow') {
      element.pointerFx!.previewAssetId = element.pointerFx!.previewAssetId ?? '';
    } else {
      delete element.pointerFx!.previewAssetId;
    }
    if (element.pointerFx!.primitive === 'drag-inertia') {
      element.pointerFx!.touchActivation = 'none';
      element.pointerFx!.dragAxis = element.pointerFx!.dragAxis ?? 'x';
      element.pointerFx!.inertia = element.pointerFx!.inertia ?? true;
    } else {
      delete element.pointerFx!.dragAxis;
      delete element.pointerFx!.inertia;
    }
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Primitive', primitive));

  if (element.pointerFx.primitive === 'image-follow') {
    const previewAsset = document.createElement('input');
    previewAsset.type = 'text';
    previewAsset.placeholder = 'cursor-preview.webp';
    previewAsset.value = element.pointerFx.previewAssetId ?? '';
    previewAsset.addEventListener('change', () => {
      ctx.captureForUndo();
      element.pointerFx!.previewAssetId = previewAsset.value.trim();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    ctx.inspector.appendChild(field('Preview asset id', previewAsset));
  }

  if (element.pointerFx.primitive === 'drag-inertia') {
    const dragAxis = selectInput(POINTER_FX_DRAG_AXES, element.pointerFx.dragAxis ?? 'x');
    dragAxis.addEventListener('change', () => {
      ctx.captureForUndo();
      element.pointerFx!.dragAxis = dragAxis.value as PointerFxDragAxis;
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    ctx.inspector.appendChild(field('Drag axis', dragAxis));

    const inertia = document.createElement('input');
    inertia.type = 'checkbox';
    inertia.checked = element.pointerFx.inertia !== false;
    inertia.addEventListener('change', () => {
      ctx.captureForUndo();
      element.pointerFx!.inertia = inertia.checked;
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    ctx.inspector.appendChild(field('Inertia', inertia));
  }

  const touchActivation = selectInput(
    POINTER_FX_TOUCH_ACTIVATION_MODES,
    element.pointerFx.touchActivation ?? 'none',
  );
  touchActivation.addEventListener('change', () => {
    ctx.captureForUndo();
    element.pointerFx!.touchActivation = touchActivation.value as PointerFxTouchActivationMode;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Touch activation', touchActivation));

  const reducedMotion = selectInput(
    POINTER_FX_REDUCED_MOTION_MODES,
    element.pointerFx.reducedMotion,
  );
  reducedMotion.addEventListener('change', () => {
    ctx.captureForUndo();
    element.pointerFx!.reducedMotion = reducedMotion.value as PointerFxReducedMotionMode;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Reduced motion', reducedMotion));
}

function renderMarqueeInspector(
  ctx: EditorContext,
  element: CanvasElement,
  sectionElements: CanvasElement[],
): void {
  if (!ctx.inspector) return;
  const heading = document.createElement('h3');
  heading.textContent = 'Marquee';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  const enabled = document.createElement('input');
  enabled.type = 'checkbox';
  enabled.checked = element.marquee?.enabled === true;
  enabled.addEventListener('change', () => {
    ctx.captureForUndo();
    if (enabled.checked) {
      element.marquee = {
        enabled: true,
        direction: 'left',
        speedPxPerSecond: 80,
        pauseOnHover: true,
        edgeFade: false,
        hoverReverse: false,
        reducedMotion: 'static',
      };
    } else {
      delete element.marquee;
    }
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Enable marquee', enabled));

  if (element.marquee?.enabled !== true) return;

  const direction = selectInput(MARQUEE_DIRECTIONS, element.marquee.direction);
  direction.addEventListener('change', () => {
    ctx.captureForUndo();
    element.marquee!.direction = direction.value as MarqueeDirection;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Direction', direction));

  const speed = document.createElement('input');
  speed.type = 'number';
  speed.min = '1';
  speed.max = '600';
  speed.step = '1';
  speed.value = String(element.marquee.speedPxPerSecond);
  speed.addEventListener('change', () => {
    const n = Number(speed.value);
    if (!Number.isFinite(n) || n <= 0 || n > 600) {
      ctx.setStatus('Marquee speed must be between 1 and 600 px/s', 'error');
      speed.value = String(element.marquee!.speedPxPerSecond);
      return;
    }
    ctx.captureForUndo();
    element.marquee!.speedPxPerSecond = n;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Speed (px/s)', speed));

  const rows = document.createElement('input');
  rows.type = 'number';
  rows.min = '1';
  rows.max = '6';
  rows.step = '1';
  rows.value = String(element.marquee.rows ?? 1);
  rows.addEventListener('change', () => {
    const n = Number(rows.value);
    if (!Number.isInteger(n) || n < 1 || n > 6) {
      ctx.setStatus('Marquee rows must be between 1 and 6', 'error');
      rows.value = String(element.marquee!.rows ?? 1);
      return;
    }
    ctx.captureForUndo();
    if (n === 1) {
      delete element.marquee!.rows;
    } else {
      element.marquee!.rows = n;
    }
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Rows', rows));

  const rowGap = document.createElement('input');
  rowGap.type = 'number';
  rowGap.min = '0';
  rowGap.max = '200';
  rowGap.step = '1';
  rowGap.value = String(element.marquee.rowGapPx ?? 0);
  rowGap.addEventListener('change', () => {
    const n = Number(rowGap.value);
    if (!Number.isFinite(n) || n < 0 || n > 200) {
      ctx.setStatus('Marquee row gap must be between 0 and 200px', 'error');
      rowGap.value = String(element.marquee!.rowGapPx ?? 0);
      return;
    }
    ctx.captureForUndo();
    if (n === 0) {
      delete element.marquee!.rowGapPx;
    } else {
      element.marquee!.rowGapPx = n;
    }
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Row gap (px)', rowGap));

  const rowOffset = document.createElement('input');
  rowOffset.type = 'number';
  rowOffset.min = '0';
  rowOffset.max = '100';
  rowOffset.step = '1';
  rowOffset.value = String(element.marquee.rowOffsetPercent ?? 50);
  rowOffset.addEventListener('change', () => {
    const n = Number(rowOffset.value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      ctx.setStatus('Marquee row offset must be between 0 and 100%', 'error');
      rowOffset.value = String(element.marquee!.rowOffsetPercent ?? 50);
      return;
    }
    ctx.captureForUndo();
    if (n === 50) {
      delete element.marquee!.rowOffsetPercent;
    } else {
      element.marquee!.rowOffsetPercent = n;
    }
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Row offset (%)', rowOffset));

  const sourceMode = selectInput(
    ['manual', 'collection-element'],
    element.marquee.source?.type ?? 'manual',
  );
  sourceMode.addEventListener('change', () => {
    ctx.captureForUndo();
    if (sourceMode.value === 'manual') {
      delete element.marquee!.source;
    } else {
      const firstCollection = sectionElements.find((candidate) => candidate.type === 'collection');
      if (!firstCollection) {
        ctx.setStatus('Add a Collection element in this section before binding marquee source', 'error');
        sourceMode.value = 'manual';
        return;
      }
      element.marquee!.source = {
        type: 'collection-element',
        elementId: firstCollection.id,
        field: 'title',
        separator: ' / ',
      };
    }
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Marquee source', sourceMode));

  if (element.marquee.source?.type === 'collection-element') {
    const collectionElements = sectionElements.filter((candidate) => candidate.type === 'collection');
    const collectionElementId = element.marquee.source.elementId;
    if (collectionElements.length === 0) {
      const missing = document.createElement('p');
      missing.className = 'opencanvas-section-picker-empty';
      missing.textContent = 'Add a Collection element in this section before binding marquee source.';
      ctx.inspector.appendChild(missing);
    } else {
      const collectionInput = selectInput(
        collectionElements.map((candidate) => candidate.id),
        collectionElements.some((candidate) => candidate.id === collectionElementId)
          ? collectionElementId
          : collectionElements[0]!.id,
      );
      collectionInput.addEventListener('change', () => {
        ctx.captureForUndo();
        const currentSource =
          element.marquee!.source?.type === 'collection-element'
            ? element.marquee!.source
            : { type: 'collection-element' as const, elementId: collectionInput.value, field: 'title' as const };
        element.marquee!.source = {
          ...currentSource,
          elementId: collectionInput.value,
        };
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector.appendChild(field('Collection element', collectionInput));

      const sourceField = selectInput(MARQUEE_COLLECTION_FIELDS, element.marquee.source.field);
      sourceField.addEventListener('change', () => {
        ctx.captureForUndo();
        const currentSource =
          element.marquee!.source?.type === 'collection-element'
            ? element.marquee!.source
            : { type: 'collection-element' as const, elementId: collectionInput.value, field: 'title' as const };
        element.marquee!.source = {
          ...currentSource,
          field: sourceField.value as MarqueeCollectionField,
        };
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector.appendChild(field('Collection field', sourceField));

      const separator = document.createElement('input');
      separator.type = 'text';
      separator.value = element.marquee.source.separator ?? ' / ';
      separator.addEventListener('change', () => {
        const value = separator.value;
        if (value.trim().length === 0) {
          ctx.setStatus('Marquee source separator cannot be empty', 'error');
          separator.value = element.marquee!.source?.type === 'collection-element'
            ? (element.marquee!.source.separator ?? ' / ')
            : ' / ';
          return;
        }
        ctx.captureForUndo();
        const currentSource =
          element.marquee!.source?.type === 'collection-element'
            ? element.marquee!.source
            : { type: 'collection-element' as const, elementId: collectionInput.value, field: 'title' as const };
        element.marquee!.source = {
          ...currentSource,
          separator: value,
        };
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector.appendChild(field('Source separator', separator));

      const maxItems = document.createElement('input');
      maxItems.type = 'number';
      maxItems.min = '1';
      maxItems.max = '50';
      maxItems.step = '1';
      maxItems.value = String(element.marquee.source.maxItems ?? 50);
      maxItems.addEventListener('change', () => {
        const n = Number(maxItems.value);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          ctx.setStatus('Marquee source max items must be between 1 and 50', 'error');
          maxItems.value = String(element.marquee!.source?.type === 'collection-element' ? (element.marquee!.source.maxItems ?? 50) : 50);
          return;
        }
        ctx.captureForUndo();
        const currentSource =
          element.marquee!.source?.type === 'collection-element'
            ? element.marquee!.source
            : { type: 'collection-element' as const, elementId: collectionInput.value, field: 'title' as const };
        element.marquee!.source = {
          ...currentSource,
          maxItems: n,
        };
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      ctx.inspector.appendChild(field('Source max items', maxItems));
    }
  }

  const pause = document.createElement('input');
  pause.type = 'checkbox';
  pause.checked = element.marquee.pauseOnHover === true;
  pause.addEventListener('change', () => {
    ctx.captureForUndo();
    element.marquee!.pauseOnHover = pause.checked;
    if (pause.checked) element.marquee!.hoverReverse = false;
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Pause on hover', pause));

  const hoverReverse = document.createElement('input');
  hoverReverse.type = 'checkbox';
  hoverReverse.checked = element.marquee.hoverReverse === true;
  hoverReverse.addEventListener('change', () => {
    ctx.captureForUndo();
    element.marquee!.hoverReverse = hoverReverse.checked;
    if (hoverReverse.checked) element.marquee!.pauseOnHover = false;
    ctx.rebuildElement(element.id);
    renderInspector(ctx);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Reverse on hover', hoverReverse));

  const edgeFade = document.createElement('input');
  edgeFade.type = 'checkbox';
  edgeFade.checked = element.marquee.edgeFade === true;
  edgeFade.addEventListener('change', () => {
    ctx.captureForUndo();
    element.marquee!.edgeFade = edgeFade.checked;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Edge fade mask', edgeFade));

  const reducedMotion = selectInput(MARQUEE_REDUCED_MOTION_MODES, element.marquee.reducedMotion);
  reducedMotion.addEventListener('change', () => {
    ctx.captureForUndo();
    element.marquee!.reducedMotion = reducedMotion.value as MarqueeReducedMotionMode;
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Reduced motion', reducedMotion));
}

function renderTextSplitInspector(
  ctx: EditorContext,
  elementId: string,
  sectionId: string,
): void {
  if (!ctx.state || !ctx.inspector) return;
  const heading = document.createElement('h3');
  heading.textContent = 'Text Split Target';
  heading.className = 'inspector-section-heading';
  ctx.inspector.appendChild(heading);

  const current = findTextSplitStep(ctx.state.motionSequences ?? [], elementId);
  const currentUnit = current?.step.target.type === 'text-split' ? current.step.target.unit : 'off';
  const unitSelect = selectInput(['off', ...TEXT_SPLIT_UNITS], currentUnit);
  unitSelect.addEventListener('change', () => {
    ctx.captureForUndo();
    if (unitSelect.value === 'off') {
      removeTextSplitTarget(ctx, elementId);
      ctx.setStatus('Text split target disabled', 'ok');
    } else {
      upsertTextSplitTarget(ctx, elementId, sectionId, unitSelect.value as (typeof TEXT_SPLIT_UNITS)[number]);
      ctx.setStatus('Text split target enabled', 'ok');
    }
    ctx.renderInspector();
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(field('Split unit', unitSelect));

  const note = document.createElement('p');
  note.className = 'opencanvas-section-picker-empty';
  note.textContent =
    'Creates a schema-owned Motion Sequence target. Runtime split spans are aria-hidden and the text host keeps the full aria-label.';
  ctx.inspector.appendChild(note);

  const scrollPreset = document.createElement('button');
  scrollPreset.type = 'button';
  scrollPreset.textContent = 'Scroll-progress text preset';
  scrollPreset.addEventListener('click', () => {
    ctx.captureForUndo();
    const unit =
      unitSelect.value === 'off'
        ? 'word'
        : (unitSelect.value as (typeof TEXT_SPLIT_UNITS)[number]);
    upsertTextSplitScrollPreset(ctx, elementId, sectionId, unit);
    ctx.setStatus('Scroll-progress text preset enabled', 'ok');
    ctx.renderInspector();
    ctx.scheduleSave();
  });
  ctx.inspector.appendChild(scrollPreset);
}

function findTextSplitStep(
  sequences: MotionSequence[],
  elementId: string,
): { sequence: MotionSequence; step: MotionSequenceStep } | null {
  for (const sequence of sequences) {
    for (const step of sequence.steps) {
      if (step.target.type === 'text-split' && step.target.elementId === elementId) {
        return { sequence, step };
      }
    }
  }
  return null;
}

function uniqueSequenceId(sequences: MotionSequence[], base: string): string {
  const ids = new Set(sequences.map((sequence) => sequence.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(base + '-' + String(index))) index += 1;
  return base + '-' + String(index);
}

function uniqueScrollSceneId(scenes: ScrollScene[], base: string): string {
  const ids = new Set(scenes.map((scene) => scene.id));
  if (!ids.has(base)) return base;
  let index = 2;
  while (ids.has(base + '-' + String(index))) index += 1;
  return base + '-' + String(index);
}

function scrollTextSplitStep(
  sequenceId: string,
  elementId: string,
  unit: (typeof TEXT_SPLIT_UNITS)[number],
): MotionSequenceStep {
  return {
    id: sequenceId + '-scroll-step',
    target: { type: 'text-split', elementId, unit },
    from: { opacity: 0, translateY: 48, filter: 'blur(8px)' },
    to: { opacity: 1, translateY: 0, filter: 'blur(0px)' },
    durationMs: 1,
    delayMs: 0,
    staggerMs: unit === 'char' ? 18 : unit === 'word' ? 40 : 80,
    easing: 'linear',
  };
}

function upsertTextSplitScrollPreset(
  ctx: EditorContext,
  elementId: string,
  sectionId: string,
  unit: (typeof TEXT_SPLIT_UNITS)[number],
): void {
  if (!ctx.state) return;
  const sequences = ctx.state.motionSequences ?? [];
  const scenes = ctx.state.scrollScenes ?? [];
  const existing = findTextSplitStep(sequences, elementId);
  const sequenceId = existing?.sequence.id ?? uniqueSequenceId(sequences, 'text-split-scroll-' + elementId);
  const sceneId =
    existing?.sequence.trigger.type === 'scroll-scene'
      ? existing.sequence.trigger.scrollSceneId
      : uniqueScrollSceneId(scenes, 'text-split-scroll-' + elementId + '-scene');
  const step = scrollTextSplitStep(sequenceId, elementId, unit);
  const scene: ScrollScene = {
    id: sceneId,
    sectionId,
    sequenceId,
    pinTarget: { type: 'section', sectionId },
    startOffsetPx: 0,
    endOffsetPx: 720,
  };

  if (existing) {
    existing.sequence.trigger = { type: 'scroll-scene', scrollSceneId: sceneId };
    existing.sequence.reducedMotion = 'final-state';
    delete existing.sequence.repeat;
    delete existing.sequence.playbackDirection;
    existing.sequence.steps = existing.sequence.steps.map((candidate) =>
      candidate.id === existing.step.id ? { ...step, id: existing.step.id } : candidate,
    );
    ctx.state.motionSequences = sequences;
  } else {
    ctx.state.motionSequences = [
      ...sequences,
      {
        id: sequenceId,
        trigger: { type: 'scroll-scene', scrollSceneId: sceneId },
        reducedMotion: 'final-state',
        steps: [step],
      },
    ];
  }

  const existingSceneIndex = scenes.findIndex((candidate) => candidate.id === sceneId);
  if (existingSceneIndex >= 0) {
    ctx.state.scrollScenes = scenes.map((candidate, index) =>
      index === existingSceneIndex ? scene : candidate,
    );
  } else {
    ctx.state.scrollScenes = [...scenes, scene];
  }
}

function upsertTextSplitTarget(
  ctx: EditorContext,
  elementId: string,
  sectionId: string,
  unit: (typeof TEXT_SPLIT_UNITS)[number],
): void {
  if (!ctx.state) return;
  const sequences = ctx.state.motionSequences ?? [];
  const existing = findTextSplitStep(sequences, elementId);
  if (existing) {
    existing.step.target = { type: 'text-split', elementId, unit };
    existing.step.staggerMs = unit === 'char' ? 18 : unit === 'word' ? 40 : 80;
    ctx.state.motionSequences = sequences;
    return;
  }
  const sequenceId = uniqueSequenceId(sequences, 'text-split-' + elementId);
  const step: MotionSequenceStep = {
    id: sequenceId + '-step',
    target: { type: 'text-split', elementId, unit },
    from: { opacity: 0, translateY: 24 },
    to: { opacity: 1, translateY: 0 },
    durationMs: 420,
    delayMs: 0,
    staggerMs: unit === 'char' ? 18 : unit === 'word' ? 40 : 80,
    easing: 'ease-out',
  };
  ctx.state.motionSequences = [
    ...sequences,
    {
      id: sequenceId,
      trigger: { type: 'section-enter', sectionId },
      reducedMotion: 'final-state',
      steps: [step],
    },
  ];
}

function removeTextSplitTarget(ctx: EditorContext, elementId: string): void {
  if (!ctx.state) return;
  ctx.state.motionSequences = (ctx.state.motionSequences ?? [])
    .map((sequence) => ({
      ...sequence,
      steps: sequence.steps.filter(
        (step) => !(step.target.type === 'text-split' && step.target.elementId === elementId),
      ),
    }))
    .filter((sequence) => sequence.steps.length > 0);
}

// ---------------------------------------------------------------------------
// ADR 0063 dec 8 + dec 10 — Collection element inspector.
// ---------------------------------------------------------------------------
//
// Renders the seven fields listed in the ADR (source slug, folder, sort,
// manual-order reel, display mode, manage-entries link, status line).
//
// Why this lives inline in element-inspector.ts rather than its own module:
//  - all reads + writes go through the ctx/element pair the orchestrator
//    already holds; no shared state crosses a module boundary;
//  - the F4 extraction of the manual-reel drag primitive is explicitly
//    deferred until a third caller exists — pulling out a helper module
//    on N=1 would invent the wrong shape;
//  - element-inspector.ts already owns the dispatch fork for collection
//    (the InspectorSpec dispatch type-excludes it), so the function lives
//    next to its caller for readability.
//
// Entries fetch: a single `GET ctx.apiBase + '/sites/<id>/entries'` per
// inspector render. The endpoint does not yet expose `?slugs=true` or a
// `?folder=` filter (Phase 2C left it as a flat list-by-site, with an
// optional `?collection=` narrowing). We fetch the full site list once,
// derive distinct slugs + folders client-side, and filter the manual reel
// + status count by element.collectionSlug / element.folder in memory. A
// per-site cache (`entriesBySite`) shared across inspector renders keeps
// reopen-the-inspector cheap; the cache is keyed on siteId only so a slug
// change on one Collection doesn't refetch for the next, but the cache is
// invalidated explicitly after a publish or entries-tab navigation by the
// dashboard route (not by the inspector — same scope rule as the page-
// inspector preview cache).

interface InspectorEntryRow {
  id: string;
  collectionSlug: string;
  slug: string;
  title: string;
  folder: string | null;
  ogImageAssetId: string | null;
  publishedDate: string;
  status: string;
}

interface EntriesCacheState {
  status: 'loading' | 'ready' | 'error';
  rows: InspectorEntryRow[];
  error: string | null;
}

const entriesBySite = new Map<string, EntriesCacheState>();
const pendingFetches = new Map<string, Promise<void>>();

function ensureEntriesLoaded(ctx: EditorContext): EntriesCacheState {
  const cached = entriesBySite.get(ctx.siteId);
  if (cached !== undefined) return cached;
  const initial: EntriesCacheState = { status: 'loading', rows: [], error: null };
  entriesBySite.set(ctx.siteId, initial);
  // Loud-failure rule (CLAUDE.md): a fetch error surfaces both in the
  // inspector status line AND ctx.setStatus, never silently degrades to
  // an empty list. The retry path is "re-open the inspector" — the cache
  // remembers the failure until the user explicitly tries again.
  const url = ctx.apiBase + '/sites/' + encodeURIComponent(ctx.siteId) + '/entries';
  const p = fetch(url, { credentials: 'include' })
    .then(function (res) {
      if (!res.ok) {
        throw new Error(
          'GET ' + url + ' returned ' + String(res.status) + ' ' + res.statusText,
        );
      }
      return res.json() as Promise<{ entries: InspectorEntryRow[] }>;
    })
    .then(function (body) {
      const rows = Array.isArray(body.entries) ? body.entries : [];
      entriesBySite.set(ctx.siteId, { status: 'ready', rows: rows, error: null });
      pendingFetches.delete(ctx.siteId);
      // Re-render only if the user is still inspecting a Collection. The
      // renderInspector path is idempotent — calling it for a different
      // element type just rebuilds that inspector with fresh entry data
      // it didn't need, which is wasted work but not incorrect.
      if (ctx.selectedElementId !== null) {
        const found = ctx.findElement(ctx.selectedElementId);
        if (found !== null && found.element.type === 'collection') {
          renderInspector(ctx);
        }
      }
    })
    .catch(function (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[element-inspector] entries fetch failed for site', ctx.siteId, err);
      entriesBySite.set(ctx.siteId, {
        status: 'error',
        rows: [],
        error: message,
      });
      pendingFetches.delete(ctx.siteId);
      ctx.setStatus('Could not load entries: ' + message, 'error');
      if (ctx.selectedElementId !== null) {
        const found = ctx.findElement(ctx.selectedElementId);
        if (found !== null && found.element.type === 'collection') {
          renderInspector(ctx);
        }
      }
    });
  pendingFetches.set(ctx.siteId, p);
  return initial;
}

/** Distinct collection slugs present in the site's entries, sorted. */
function distinctSlugs(rows: ReadonlyArray<InspectorEntryRow>): string[] {
  const set = new Set<string>();
  for (const row of rows) set.add(row.collectionSlug);
  const out = Array.from(set);
  out.sort();
  return out;
}

/** Distinct folder values within a given slug. `null` represents
 *  "ungrouped" and is preserved as a separate option. */
function distinctFolders(
  rows: ReadonlyArray<InspectorEntryRow>,
  slug: string,
): Array<string | null> {
  const set = new Set<string | null>();
  for (const row of rows) {
    if (row.collectionSlug !== slug) continue;
    set.add(row.folder);
  }
  // Order: real folders alphabetically, then null at the end.
  const real: string[] = [];
  let hasNull = false;
  for (const v of set) {
    if (v === null) hasNull = true;
    else real.push(v);
  }
  real.sort();
  const out: Array<string | null> = real;
  if (hasNull) out.push(null);
  return out;
}

/** The entries actually matched by the element's (slug, folder) pair. The
 *  manual-reel uses this same filter so the reel and the materialized output
 *  agree on which entries are "in" the Collection. */
function matchedEntries(
  rows: ReadonlyArray<InspectorEntryRow>,
  el: CollectionElement,
): InspectorEntryRow[] {
  if (el.collectionSlug === undefined) return [];
  const slug = el.collectionSlug;
  const wantsFolder = el.folder !== undefined;
  const out: InspectorEntryRow[] = [];
  for (const row of rows) {
    if (row.collectionSlug !== slug) continue;
    if (wantsFolder && row.folder !== el.folder) continue;
    out.push(row);
  }
  return out;
}

/** Build the ordered manual-reel list, stripping stale IDs (entries no
 *  longer in the source) and appending unordered entries (in the source
 *  but missing from manualOrder) at the end. Pure — exported shape is
 *  the array; the inspector renders it. */
function buildManualReelOrder(
  matched: ReadonlyArray<InspectorEntryRow>,
  manualOrder: ReadonlyArray<string> | undefined,
): { ordered: InspectorEntryRow[]; unordered: InspectorEntryRow[] } {
  const byId = new Map<string, InspectorEntryRow>();
  for (const row of matched) byId.set(row.id, row);
  const ordered: InspectorEntryRow[] = [];
  const seen = new Set<string>();
  if (manualOrder !== undefined) {
    for (const id of manualOrder) {
      const row = byId.get(id);
      if (row === undefined) continue;
      if (seen.has(id)) continue;
      ordered.push(row);
      seen.add(id);
    }
  }
  const unordered: InspectorEntryRow[] = [];
  for (const row of matched) {
    if (seen.has(row.id)) continue;
    unordered.push(row);
  }
  return { ordered: ordered, unordered: unordered };
}

/** Persist the current manualOrder back to the element. Stale IDs are
 *  stripped before write so a stale-id load that never sees a drag still
 *  cleans up on the next inspector render. */
function persistManualOrder(
  ctx: EditorContext,
  el: CollectionElement,
  matched: ReadonlyArray<InspectorEntryRow>,
  nextOrder: ReadonlyArray<string>,
): void {
  const validIds = new Set<string>();
  for (const row of matched) validIds.add(row.id);
  const cleaned: string[] = [];
  for (const id of nextOrder) {
    if (validIds.has(id) && cleaned.indexOf(id) === -1) cleaned.push(id);
  }
  el.manualOrder = cleaned;
  ctx.captureForUndo();
  ctx.rebuildElement(el.id);
  ctx.scheduleSave();
}

function renderCollectionInspector(ctx: EditorContext, el: CanvasElement): void {
  if (el.type !== 'collection') return;
  if (!ctx.inspector) return;
  const collection = el;
  const inspector = ctx.inspector;

  // Header — visual separation from the action groups above and the
  // Style section that follows.
  const heading = document.createElement('h3');
  heading.textContent = 'Collection';
  heading.className = 'inspector-section-heading';
  inspector.appendChild(heading);

  const cache = ensureEntriesLoaded(ctx);

  // -- 1. Source slug dropdown ---------------------------------------------
  // Free-text is deliberately not allowed: the slug must exist in the
  // site's entries, and the Phase 1 validator catches it at save time.
  // The inspector enforces it at edit time too.
  const slugSelect = document.createElement('select');
  const unsetOpt = document.createElement('option');
  unsetOpt.value = '__unset__';
  unsetOpt.textContent = '— Unset —';
  slugSelect.appendChild(unsetOpt);
  const slugs = distinctSlugs(cache.rows);
  // If the element points at a slug that no longer exists in the cache
  // (entry deleted, source renamed, fetch still loading), surface it as
  // an option so the dropdown reflects current state truthfully.
  const knownSlug = collection.collectionSlug;
  const slugList: string[] = slugs.slice();
  if (knownSlug !== undefined && slugList.indexOf(knownSlug) === -1) {
    slugList.push(knownSlug);
    slugList.sort();
  }
  for (const slug of slugList) {
    const opt = document.createElement('option');
    opt.value = slug;
    opt.textContent = slug;
    slugSelect.appendChild(opt);
  }
  if (collection.collectionSlug === undefined) {
    slugSelect.value = '__unset__';
  } else {
    slugSelect.value = collection.collectionSlug;
  }
  slugSelect.addEventListener('change', function () {
    ctx.captureForUndo();
    if (slugSelect.value === '__unset__') {
      delete collection.collectionSlug;
      // Clearing the slug also clears any folder / manualOrder — both
      // reference entries that have no meaning without a source.
      delete collection.folder;
      delete collection.manualOrder;
    } else {
      collection.collectionSlug = slugSelect.value;
      // Changing the slug invalidates the folder (folders are scoped to
      // a slug) and the manualOrder (IDs are slug-scoped). Drop both so
      // the next render rebuilds from the new source.
      delete collection.folder;
      delete collection.manualOrder;
    }
    ctx.rebuildElement(collection.id);
    ctx.scheduleSave();
    renderInspector(ctx);
  });
  inspector.appendChild(field('Source', slugSelect));

  // -- 7. Status line (rendered immediately under the source picker so the
  //   "0 entries" signal sits next to its cause). The ADR puts it as the
  //   last field, but visually the message belongs adjacent to the picker
  //   that produces the count. The fields are still semantically distinct.
  const statusLine = document.createElement('div');
  statusLine.style.cssText =
    'font-size:12px; color:var(--opencanvas-fg-mute, #888); margin: -4px 0 8px 0;';
  if (cache.status === 'loading') {
    statusLine.textContent = 'Loading entries…';
  } else if (cache.status === 'error') {
    statusLine.textContent = 'Could not load entries: ' + (cache.error ?? 'unknown error');
    statusLine.style.color = 'var(--opencanvas-error, #d33)';
  } else if (collection.collectionSlug === undefined) {
    statusLine.textContent = 'Pick a source to bind this collection.';
  } else {
    const matched = matchedEntries(cache.rows, collection);
    statusLine.textContent =
      String(matched.length) + ' entries match this source/folder.';
    if (matched.length === 0) {
      const addHint = document.createElement('div');
      addHint.style.cssText = 'margin-top:2px;';
      addHint.textContent = 'Add entries from the dashboard to see real content.';
      statusLine.appendChild(addHint);
    }
  }
  inspector.appendChild(statusLine);

  // -- 2. Folder dropdown --------------------------------------------------
  const folderSelect = document.createElement('select');
  const folderAllOpt = document.createElement('option');
  folderAllOpt.value = '__all__';
  folderAllOpt.textContent = '(All folders)';
  folderSelect.appendChild(folderAllOpt);

  let staleFolderWarning: HTMLElement | null = null;

  if (collection.collectionSlug === undefined || cache.status !== 'ready') {
    folderSelect.disabled = true;
    folderSelect.value = '__all__';
  } else {
    const folders = distinctFolders(cache.rows, collection.collectionSlug);
    for (const f of folders) {
      const opt = document.createElement('option');
      if (f === null) {
        opt.value = '__null__';
        opt.textContent = 'Ungrouped';
      } else {
        opt.value = 'folder:' + f;
        opt.textContent = f;
      }
      folderSelect.appendChild(opt);
    }
    if (collection.folder === undefined) {
      folderSelect.value = '__all__';
    } else {
      // Map element.folder onto the dropdown values. Note: element.folder
      // is `string | undefined`; the schema uses undefined for "all" and
      // a string for a specific folder. The DB column also allows null
      // ("ungrouped"); on the element we surface that via a tagged
      // dropdown value (__null__) but we don't currently let the element
      // bind to "ungrouped only" — the dropdown allows it, and a select
      // of __null__ writes nothing distinguishable into the element
      // schema unless we add another sentinel field. For now, picking
      // "Ungrouped" filters to entries with `folder === null`; we store
      // the literal empty string as the element's folder marker so the
      // materializer (Phase 2B) can filter equivalently. Folder values
      // are validated to be 1..64 chars on the API side, so '' is
      // unambiguous as the "match-null" sentinel inside the element.
      const desired = collection.folder === '' ? '__null__' : 'folder:' + collection.folder;
      let found = false;
      for (let i = 0; i < folderSelect.options.length; i++) {
        if (folderSelect.options[i]!.value === desired) {
          folderSelect.value = desired;
          found = true;
          break;
        }
      }
      if (!found) {
        // Stale: the element's folder no longer exists in the source.
        // Surface a one-line warning + clear-it button (loud failure per
        // the ADR's failure-mode section). The dropdown shows __all__
        // because the stale value isn't a real option.
        folderSelect.value = '__all__';
        staleFolderWarning = document.createElement('div');
        staleFolderWarning.style.cssText =
          'font-size:12px; color:var(--opencanvas-error, #d33); margin: -4px 0 8px 0;';
        const warnText = document.createElement('span');
        warnText.textContent =
          "Folder '" +
          collection.folder +
          "' is no longer present in this source. ";
        staleFolderWarning.appendChild(warnText);
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.textContent = 'Clear';
        clearBtn.className = 'style-btn-clear';
        clearBtn.addEventListener('click', function () {
          ctx.captureForUndo();
          delete collection.folder;
          ctx.rebuildElement(collection.id);
          ctx.scheduleSave();
          renderInspector(ctx);
        });
        staleFolderWarning.appendChild(clearBtn);
      }
    }
  }
  folderSelect.addEventListener('change', function () {
    ctx.captureForUndo();
    const v = folderSelect.value;
    if (v === '__all__') {
      delete collection.folder;
    } else if (v === '__null__') {
      collection.folder = '';
    } else if (v.indexOf('folder:') === 0) {
      collection.folder = v.slice('folder:'.length);
    }
    // Folder change invalidates manualOrder (it referenced entries the
    // new filter may exclude). Strip on next render rather than wiping
    // — strip-on-render lets a temporary folder swap keep the order.
    ctx.rebuildElement(collection.id);
    ctx.scheduleSave();
    renderInspector(ctx);
  });
  inspector.appendChild(field('Folder', folderSelect));
  if (staleFolderWarning !== null) inspector.appendChild(staleFolderWarning);

  // -- 3. Sort dropdown ----------------------------------------------------
  // The schema-level sort can also be a legacy object shape during the
  // multi-commit migration; normalize before display so the dropdown
  // never reads an object.
  let currentSort: CollectionSort = 'date-desc';
  if (typeof collection.sort === 'string') {
    if (COLLECTION_SORTS.indexOf(collection.sort) !== -1) currentSort = collection.sort;
  }
  const sortSelect = document.createElement('select');
  const SORT_LABELS: Record<CollectionSort, string> = {
    'date-desc': 'Newest first',
    'date-asc': 'Oldest first',
    manual: 'Manual order',
  };
  for (const s of COLLECTION_SORTS) {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = SORT_LABELS[s];
    sortSelect.appendChild(opt);
  }
  sortSelect.value = currentSort;
  sortSelect.addEventListener('change', function () {
    ctx.captureForUndo();
    const next = sortSelect.value as CollectionSort;
    collection.sort = next;
    if (next !== 'manual') {
      // Leaving manual drops manualOrder — the IDs have no meaning under
      // a date sort and keeping them around would just confuse the next
      // time the Owner toggles back.
      delete collection.manualOrder;
    } else if (collection.manualOrder === undefined) {
      // Entering manual seeds an empty order so the reel renders an
      // explicit "Unordered" group; the matched entries fall into it
      // and the Owner reorders by dragging.
      collection.manualOrder = [];
    }
    ctx.rebuildElement(collection.id);
    ctx.scheduleSave();
    renderInspector(ctx);
  });
  inspector.appendChild(field('Sort', sortSelect));

  // -- 4. Manual order reel (only when sort === 'manual') ------------------
  if (currentSort === 'manual' && collection.collectionSlug !== undefined && cache.status === 'ready') {
    const matched = matchedEntries(cache.rows, collection);
    const split = buildManualReelOrder(matched, collection.manualOrder);

    // Strip stale IDs on render — per the ADR: "Removed entries are
    // stripped from `manualOrder` lazily on the next inspector render."
    // We only write back if the cleaned order differs to avoid a
    // pointless save thrash.
    if (collection.manualOrder !== undefined) {
      const cleaned = split.ordered.map(function (r) { return r.id; });
      const before = collection.manualOrder.join('|');
      const after = cleaned.join('|');
      if (before !== after) {
        collection.manualOrder = cleaned;
        ctx.scheduleSave();
      }
    }

    const reelHost = document.createElement('div');
    reelHost.className = 'opencanvas-collection-manual-reel';
    reelHost.style.cssText =
      'display:flex; flex-direction:column; gap:4px; ' +
      'border:1px solid var(--opencanvas-hairline, var(--line, #2a2a2a)); ' +
      'border-radius:4px; padding:6px; background:transparent;';

    const orderedIds: string[] = split.ordered.map(function (r) { return r.id; });

    function buildRow(row: InspectorEntryRow, isUnordered: boolean): HTMLElement {
      const r = document.createElement('div');
      r.className = 'opencanvas-collection-manual-row';
      r.setAttribute('data-entry-id', row.id);
      r.style.cssText =
        'display:flex; align-items:center; gap:8px; padding:4px 6px; ' +
        'background:var(--opencanvas-bg-card, rgba(255,255,255,0.03)); ' +
        'border:1px solid var(--opencanvas-hairline, var(--line, #2a2a2a)); ' +
        'border-radius:3px;' +
        (isUnordered ? ' opacity:0.7;' : '');

      const thumb = document.createElement('div');
      thumb.style.cssText =
        'width:32px; height:32px; flex:0 0 32px; border-radius:2px; ' +
        'background:var(--opencanvas-bg-mute, #222); overflow:hidden; ' +
        'display:flex; align-items:center; justify-content:center;';
      if (row.ogImageAssetId !== null && row.ogImageAssetId.length > 0) {
        const img = document.createElement('img');
        img.src = ctx.siteBase + '/assets/' + encodeURIComponent(row.ogImageAssetId);
        img.alt = '';
        img.style.cssText = 'width:100%; height:100%; object-fit:cover;';
        thumb.appendChild(img);
      }
      r.appendChild(thumb);

      const titleEl = document.createElement('div');
      titleEl.style.cssText =
        'flex:1; font-size:12px; overflow:hidden; ' +
        'text-overflow:ellipsis; white-space:nowrap;';
      titleEl.textContent = row.title.length > 0 ? row.title : row.slug;
      r.appendChild(titleEl);

      const grip = document.createElement('span');
      grip.setAttribute('data-collection-reel-grip', '');
      grip.title = isUnordered ? 'Drag into the manual order' : 'Drag to reorder';
      grip.style.cssText =
        'flex:0 0 auto; font-family:var(--mono, monospace); ' +
        'font-size:14px; cursor:grab; padding:0 6px; user-select:none;';
      grip.textContent = '⋮⋮';
      r.appendChild(grip);

      // Drag handler — inline because F4 explicitly defers extracting a
      // shared sortable component. Mirrors beginReelDragImpl's shape:
      // 5px movement threshold, ghost follows pointer, drop-line painted
      // at the would-be insertion slot, commit on mouseup.
      grip.addEventListener('mousedown', function (startEv) {
        if (startEv.button !== 0) return;
        startEv.preventDefault();
        const startX = startEv.clientX;
        const startY = startEv.clientY;
        let hasMoved = false;
        let ghost: HTMLElement | null = null;
        let dropLine: HTMLElement | null = null;
        // Drop position is computed in the "merged" array (ordered +
        // unordered), then snapped down to the orderedIds-only space
        // when persisted. This lets the Owner pull an Unordered row
        // into a specific slot.
        let dropAt = -1;

        function onMove(ev: MouseEvent): void {
          const dx = ev.clientX - startX;
          const dy = ev.clientY - startY;
          if (!hasMoved && Math.sqrt(dx * dx + dy * dy) < 5) return;
          if (!hasMoved) {
            hasMoved = true;
            ghost = document.createElement('div');
            ghost.style.cssText =
              'position:fixed; pointer-events:none; opacity:0.8; z-index:9000; ' +
              'background:var(--opencanvas-bg-card, #222); padding:4px 8px; ' +
              'border:1px solid var(--opencanvas-hairline, var(--line, #2a2a2a)); ' +
              'border-radius:3px; font-size:12px; max-width:240px; ' +
              'overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
            ghost.textContent = row.title.length > 0 ? row.title : row.slug;
            document.body.appendChild(ghost);

            dropLine = document.createElement('div');
            dropLine.style.cssText =
              'position:fixed; pointer-events:none; z-index:9000; ' +
              'height:2px; background:var(--opencanvas-accent, #4af);';
            dropLine.hidden = true;
            document.body.appendChild(dropLine);
            r.style.opacity = '0.4';
          }
          ghost!.style.left = ev.clientX - 100 + 'px';
          ghost!.style.top = ev.clientY - 12 + 'px';

          // Compute drop slot against the rows in reelHost — both
          // ordered and unordered rows are valid targets so the Owner
          // can pull an Unordered entry into any slot in one drag.
          const rows = Array.from(
            reelHost.querySelectorAll<HTMLElement>('.opencanvas-collection-manual-row'),
          );
          dropAt = rows.length;
          for (let i = 0; i < rows.length; i++) {
            const rect = rows[i]!.getBoundingClientRect();
            if (ev.clientY < rect.top + rect.height / 2) {
              dropAt = i;
              break;
            }
          }
          // Skip-self no-op — same as beginReelDragImpl's pattern.
          const selfIdx = rows.indexOf(r);
          if (dropAt === selfIdx || dropAt === selfIdx + 1) {
            dropLine!.hidden = true;
            dropAt = -1;
            return;
          }
          // Paint the drop line at the slot boundary.
          let refRect: DOMRect;
          if (dropAt < rows.length) {
            refRect = rows[dropAt]!.getBoundingClientRect();
            dropLine!.style.top = refRect.top - 1 + 'px';
          } else {
            refRect = rows[rows.length - 1]!.getBoundingClientRect();
            dropLine!.style.top = refRect.bottom - 1 + 'px';
          }
          dropLine!.style.left = refRect.left + 'px';
          dropLine!.style.width = refRect.width + 'px';
          dropLine!.hidden = false;
        }

        function onUp(): void {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          if (ghost !== null) ghost.remove();
          if (dropLine !== null) dropLine.remove();
          r.style.opacity = '';
          if (!hasMoved) return;
          if (dropAt < 0) return;
          // Build the new merged ordering by removing `row.id` from its
          // current spot and re-inserting at dropAt. Then snap to the
          // orderedIds-only space for persistence (Unordered rows that
          // were never reordered stay at the bottom; the dragged row
          // becomes part of the ordered set wherever it landed).
          try {
            const mergedIds: string[] = [];
            for (const o of split.ordered) mergedIds.push(o.id);
            for (const u of split.unordered) mergedIds.push(u.id);
            const fromIdx = mergedIds.indexOf(row.id);
            if (fromIdx < 0) {
              ctx.setStatus('Reorder failed, try again.', 'error');
              renderInspector(ctx);
              return;
            }
            mergedIds.splice(fromIdx, 1);
            const adjusted = dropAt > fromIdx ? dropAt - 1 : dropAt;
            const clampedAt = Math.max(0, Math.min(adjusted, mergedIds.length));
            mergedIds.splice(clampedAt, 0, row.id);
            // The new manualOrder includes every entry above and
            // including the dragged row in the merged list — i.e.
            // anything explicitly placed becomes part of the order;
            // anything below the dragged row that was never ordered
            // remains Unordered. This is the minimal write that
            // matches user intent.
            const newDraggedIdx = mergedIds.indexOf(row.id);
            const explicitOrder = mergedIds.slice(0, newDraggedIdx + 1);
            // Merge with any prior orderedIds that were above the
            // dragged row and didn't move — they stay in their slot.
            for (const id of orderedIds) {
              if (explicitOrder.indexOf(id) === -1) {
                // Pre-existing ordered ID that wasn't repositioned —
                // keep its relative position by appending in order.
                explicitOrder.push(id);
              }
            }
            persistManualOrder(ctx, collection, matched, explicitOrder);
            renderInspector(ctx);
          } catch (err) {
            console.error('[element-inspector] manual reel drop failed', err);
            ctx.setStatus('Reorder failed, try again.', 'error');
            renderInspector(ctx);
          }
        }

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });

      return r;
    }

    for (const row of split.ordered) reelHost.appendChild(buildRow(row, false));

    if (split.unordered.length > 0) {
      const divider = document.createElement('div');
      divider.style.cssText =
        'font-size:11px; color:var(--opencanvas-fg-mute, #888); ' +
        'margin: 4px 2px 2px; text-transform:uppercase; letter-spacing:0.04em;';
      divider.textContent = 'Unordered (will append at the end)';
      reelHost.appendChild(divider);
      for (const row of split.unordered) reelHost.appendChild(buildRow(row, true));
    }

    if (split.ordered.length === 0 && split.unordered.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'font-size:12px; color:var(--opencanvas-fg-mute, #888);';
      emptyMsg.textContent = 'No entries to order — bind a source with entries first.';
      reelHost.appendChild(emptyMsg);
    }

    inspector.appendChild(field('Manual order', reelHost));
  }

  // -- 5. Display mode -----------------------------------------------------
  // ADR 0065 D1 — 'custom' joins 'card' / 'image-only'. COLLECTION_DISPLAYS
  // is the single source of truth (the union widened in collection.ts).
  // Switch semantics per ADR 0065:
  //   * to 'custom' from non-custom AND customTemplate absent → enter
  //     edit mode immediately (first-time auto-enter per D3); the verb
  //     atomically seeds customTemplate.
  //   * to 'custom' from non-custom AND customTemplate already present →
  //     just flip display (D4 silent keep — Owner clicks "Edit template"
  //     explicitly per D3 second-or-later case).
  //   * away from 'custom' WHILE editing → call exit FIRST (D10 auto-exit),
  //     then flip display, so the editing state never references a
  //     Collection whose display is no longer 'custom'.
  //   * away from 'custom' while NOT editing → just flip display
  //     (D4 silent keep — customTemplate persists for the next switch back).
  const DISPLAY_LABELS: Record<string, string> = {
    card: 'Card grid',
    'image-only': 'Image only',
    custom: 'Custom',
  };
  const displaySelect = document.createElement('select');
  for (const d of COLLECTION_DISPLAYS) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = DISPLAY_LABELS[d] ?? d;
    displaySelect.appendChild(opt);
  }
  displaySelect.value = collection.display ?? 'card';
  displaySelect.addEventListener('change', function () {
    const next = displaySelect.value as typeof COLLECTION_DISPLAYS[number];
    const prev = collection.display ?? 'card';
    if (next === prev) return;
    if (next === 'custom') {
      // Switching TO custom. The first-time path needs an atomic seed
      // + flip; the second-or-later path just flips display and waits
      // for an explicit "Edit template" click.
      if (collection.customTemplate === undefined) {
        ctx.captureForUndo();
        collection.display = 'custom';
        // Hand off to the canonical enter verb — it owns the atomic
        // seed + editingCollectionTemplate write per D3. The verb will
        // capture undo + scheduleSave itself; we already captured above
        // for the display flip, so the verb's second capture coalesces
        // into the same undo entry via the persist module's debounce.
        //
        // ADR 0065 D5 + codex review pass 1 — do NOT call
        // ctx.rebuildElement(collection.id) here. enterCollectionTemplateEdit
        // already invokes ctx.renderAll() which re-mounts every wrapper AND
        // re-runs mountTemplateEditChromeImpl (see render.ts). A trailing
        // rebuildElement replaces the just-mounted wrapper, stripping the
        // `data-template-edit-active` attribute and the Done button (the
        // chrome mount is keyed off renderAll, not rebuildElement) and
        // leaving only the scrim (which lives on ctx.viewport). The
        // renderAll-only path is sufficient because nothing else needs the
        // wrapper to be torn down: the display flip is already reflected by
        // renderAll, the seed lives inside customTemplate which the
        // wrapper's body builder reads, and the chrome mount runs after the
        // wrapper mounts.
        ctx.enterCollectionTemplateEdit(collection.id);
        // Codex review pass 4 finding 2 — re-render the inspector so the
        // "Edit template" / "Done editing template" / "Reset template"
        // controls (gated on display === 'custom' + the edit pin) appear
        // immediately. Without this, the dropdown shows Custom but the
        // Edit/Done/Reset row is missing until the Owner reselects the
        // element. renderInspector is idempotent.
        ctx.renderInspector();
        return;
      }
      ctx.captureForUndo();
      collection.display = 'custom';
      ctx.rebuildElement(collection.id);
      ctx.scheduleSave();
      // Codex review pass 4 finding 2 — same re-render rationale as the
      // first-switch branch. Without it, switching to Custom (when a
      // saved customTemplate already exists) leaves the inspector showing
      // the pre-change state — display dropdown reads Custom but the
      // Edit/Reset controls are absent.
      ctx.renderInspector();
      return;
    }
    // Switching AWAY from custom. D10 auto-exit: if we're editing THIS
    // Collection's template, exit BEFORE applying the display change so
    // the editing pin never references a non-custom Collection.
    if (
      prev === 'custom' &&
      ctx.editingCollectionTemplate !== null &&
      ctx.editingCollectionTemplate.collectionId === collection.id
    ) {
      ctx.exitCollectionTemplateEdit();
    }
    ctx.captureForUndo();
    collection.display = next;
    ctx.rebuildElement(collection.id);
    ctx.scheduleSave();
    // Codex review pass 4 finding 2 — switching away from Custom must
    // also re-render the inspector so the Edit/Done/Reset row (only
    // shown when display === 'custom') disappears in lock-step with the
    // dropdown change.
    ctx.renderInspector();
  });
  inspector.appendChild(field('Display', displaySelect));

  const galleryModeSelect = document.createElement('select');
  const galleryOff = document.createElement('option');
  galleryOff.value = 'off';
  galleryOff.textContent = 'Off';
  galleryModeSelect.appendChild(galleryOff);
  const galleryReveal = document.createElement('option');
  galleryReveal.value = 'hover-reveal-detail';
  galleryReveal.textContent = 'Hover reveal + detail';
  galleryModeSelect.appendChild(galleryReveal);
  const galleryDrag = document.createElement('option');
  galleryDrag.value = 'drag-slider';
  galleryDrag.textContent = 'Drag slider';
  galleryModeSelect.appendChild(galleryDrag);
  galleryModeSelect.value = collection.gallery?.mode ?? 'off';
  galleryModeSelect.addEventListener('change', () => {
    ctx.captureForUndo();
    if (galleryModeSelect.value === 'off') {
      delete collection.gallery;
    } else {
      const selectedMode = galleryModeSelect.value === 'drag-slider' ? 'drag-slider' : 'hover-reveal-detail';
      collection.gallery = {
        mode: selectedMode,
        detailMode: 'inline-panel',
        reducedMotion: collection.gallery?.reducedMotion ?? 'allow',
        ...(collection.gallery?.videoHover ? { videoHover: collection.gallery.videoHover } : {}),
        ...(selectedMode === 'drag-slider'
          ? {
              sliderAxis: collection.gallery?.sliderAxis ?? 'x',
              sliderInertia: collection.gallery?.sliderInertia ?? true,
            }
          : {}),
      };
    }
    ctx.rebuildElement(collection.id);
    ctx.scheduleSave();
    ctx.renderInspector();
  });
  inspector.appendChild(field('Collection gallery', galleryModeSelect));

  if (collection.gallery?.mode === 'hover-reveal-detail' || collection.gallery?.mode === 'drag-slider') {
    const reducedMotionSelect = document.createElement('select');
    for (const mode of COLLECTION_GALLERY_REDUCED_MOTION_MODES) {
      const option = document.createElement('option');
      option.value = mode;
      option.textContent = mode === 'instant' ? 'Instant under reduced motion' : 'Allow motion';
      reducedMotionSelect.appendChild(option);
    }
    reducedMotionSelect.value = collection.gallery.reducedMotion;
    reducedMotionSelect.addEventListener('change', () => {
      ctx.captureForUndo();
      collection.gallery = {
        mode: collection.gallery!.mode,
        detailMode: 'inline-panel',
        reducedMotion: reducedMotionSelect.value as CollectionGalleryReducedMotionMode,
        ...(collection.gallery?.videoHover ? { videoHover: collection.gallery.videoHover } : {}),
        ...(collection.gallery?.mode === 'drag-slider'
          ? {
              sliderAxis: collection.gallery.sliderAxis ?? 'x',
              sliderInertia: collection.gallery.sliderInertia ?? true,
            }
          : {}),
      };
      ctx.rebuildElement(collection.id);
      ctx.scheduleSave();
      ctx.renderInspector();
    });
    inspector.appendChild(field('Gallery reduced motion', reducedMotionSelect));

    if (collection.gallery.mode === 'drag-slider') {
      const sliderAxis = selectInput(COLLECTION_GALLERY_AXES, collection.gallery.sliderAxis ?? 'x');
      sliderAxis.addEventListener('change', () => {
        ctx.captureForUndo();
        collection.gallery!.sliderAxis = sliderAxis.value as CollectionGalleryAxis;
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Slider axis', sliderAxis));

      const sliderInertia = document.createElement('input');
      sliderInertia.type = 'checkbox';
      sliderInertia.checked = collection.gallery.sliderInertia !== false;
      sliderInertia.addEventListener('change', () => {
        ctx.captureForUndo();
        collection.gallery!.sliderInertia = sliderInertia.checked;
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Slider inertia', sliderInertia));
    }

    const galleryVideoHover = document.createElement('input');
    galleryVideoHover.type = 'checkbox';
    galleryVideoHover.checked = collection.gallery.videoHover?.enabled === true;
    galleryVideoHover.addEventListener('change', () => {
      ctx.captureForUndo();
      if (galleryVideoHover.checked) {
        collection.gallery!.videoHover = collection.gallery!.videoHover ?? {
          enabled: true,
          mode: 'play-reset',
          reducedMotion: 'disabled',
        };
        collection.gallery!.videoHover.enabled = true;
      } else if (collection.gallery?.videoHover) {
        delete collection.gallery.videoHover;
      }
      ctx.rebuildElement(collection.id);
      ctx.scheduleSave();
      ctx.renderInspector();
    });
    inspector.appendChild(field('Gallery video hover', galleryVideoHover));

    if (collection.gallery.videoHover?.enabled === true) {
      const hoverMode = selectInput(VIDEO_HOVER_PLAYBACK_MODES, collection.gallery.videoHover.mode);
      hoverMode.addEventListener('change', () => {
        ctx.captureForUndo();
        collection.gallery!.videoHover = {
          ...collection.gallery!.videoHover!,
          enabled: true,
          mode: hoverMode.value as VideoHoverPlaybackMode,
        };
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Gallery hover mode', hoverMode));

      const hoverReduced = selectInput(
        VIDEO_HOVER_REDUCED_MOTION_MODES,
        collection.gallery.videoHover.reducedMotion,
      );
      hoverReduced.addEventListener('change', () => {
        ctx.captureForUndo();
        collection.gallery!.videoHover = {
          ...collection.gallery!.videoHover!,
          enabled: true,
          reducedMotion: hoverReduced.value as VideoHoverReducedMotionMode,
        };
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Gallery hover reduced motion', hoverReduced));

      const hoverStream = document.createElement('input');
      hoverStream.type = 'text';
      hoverStream.value = collection.gallery.videoHover.streamAssetId ?? '';
      hoverStream.addEventListener('change', () => {
        ctx.captureForUndo();
        const value = hoverStream.value.trim();
        const next = { ...collection.gallery!.videoHover!, enabled: true };
        if (value.length > 0) next.streamAssetId = value;
        else delete next.streamAssetId;
        collection.gallery!.videoHover = next;
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Gallery hover stream asset', hoverStream));

      const hoverPoster = document.createElement('input');
      hoverPoster.type = 'text';
      hoverPoster.value = collection.gallery.videoHover.streamPosterAssetId ?? '';
      hoverPoster.addEventListener('change', () => {
        ctx.captureForUndo();
        const value = hoverPoster.value.trim();
        const next = { ...collection.gallery!.videoHover!, enabled: true };
        if (value.length > 0) next.streamPosterAssetId = value;
        else delete next.streamPosterAssetId;
        collection.gallery!.videoHover = next;
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Gallery hover poster asset', hoverPoster));

      const hoverIntentDelay = document.createElement('input');
      hoverIntentDelay.type = 'number';
      hoverIntentDelay.min = '0';
      hoverIntentDelay.max = '5000';
      hoverIntentDelay.step = '10';
      hoverIntentDelay.value = String(collection.gallery.videoHover.intentDelayMs ?? 0);
      hoverIntentDelay.addEventListener('change', () => {
        const n = Number(hoverIntentDelay.value);
        if (!Number.isFinite(n) || n < 0 || n > 5000) {
          ctx.setStatus('Gallery hover intent delay must be between 0 and 5000ms', 'error');
          hoverIntentDelay.value = String(collection.gallery!.videoHover?.intentDelayMs ?? 0);
          return;
        }
        ctx.captureForUndo();
        collection.gallery!.videoHover = {
          ...collection.gallery!.videoHover!,
          enabled: true,
          intentDelayMs: n,
        };
        ctx.rebuildElement(collection.id);
        ctx.scheduleSave();
      });
      inspector.appendChild(field('Gallery hover intent delay', hoverIntentDelay));
    }
  }

  mountComponentStyle(ctx, collection, inspector);

  // -- 5b. Custom-template controls (ADR 0065 D9) -------------------------
  // Three buttons mapped to three intents: enter, exit, reset.
  //
  // Visibility precedent: "Edit template" and "Done editing template" are
  // mutually exclusive states of the same affordance, driven by whether
  // ctx.editingCollectionTemplate pins THIS Collection. "Reset template"
  // is always visible when display === 'custom' so the Owner can blow
  // away accumulated experiments without leaving the inspector.
  //
  // Design choice — "Edit template" is HIDDEN (not disabled-with-tooltip)
  // when display !== 'custom'. Two reasons:
  //   (a) the ADR's D9 wording is "Inspector controls WHEN display ===
  //       'custom'" — the buttons aren't part of the inspector contract
  //       outside that mode at all;
  //   (b) the precondition is one dropdown click away, and the dropdown
  //       lives directly above the button row, so a disabled-with-tooltip
  //       would just clutter the inspector for an Owner who hasn't
  //       chosen 'custom' yet.
  if (collection.display === 'custom') {
    const tplControls = document.createElement('div');
    tplControls.className = 'opencanvas-zorder-buttons';

    const isEditingThis =
      ctx.editingCollectionTemplate !== null &&
      ctx.editingCollectionTemplate.collectionId === collection.id;

    if (!isEditingThis) {
      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit template';
      editBtn.addEventListener('click', function () {
        ctx.enterCollectionTemplateEdit(collection.id);
        ctx.renderInspector();
      });
      tplControls.appendChild(editBtn);
    } else {
      const doneBtn = document.createElement('button');
      doneBtn.type = 'button';
      doneBtn.textContent = 'Done editing template';
      doneBtn.addEventListener('click', function () {
        ctx.exitCollectionTemplateEdit();
        ctx.renderInspector();
      });
      tplControls.appendChild(doneBtn);
    }

    // "Reset template" is destructive — gate behind a confirm dialog
    // matching the asset-delete pattern (runtime-helpers.ts:902). Cancel
    // path leaves customTemplate untouched (D4 silent keep applies — only
    // explicit Reset discards). Confirm path seeds afresh via the same
    // seedCustomTemplate() entry point the verb uses on first-enter.
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Reset template';
    resetBtn.addEventListener('click', function () {
      void (async function runReset(): Promise<void> {
        const confirmed = await ctx.openConfirmModal({
          title: 'Reset template',
          message:
            'Replace your custom template with the default card?',
          confirmLabel: 'Reset',
          danger: true,
        });
        if (!confirmed) return;
        // Re-resolve in case the element was removed by a concurrent
        // collaborator while the modal was open. Loud failure on miss —
        // no silent skip.
        const refound = ctx.findElement(collection.id);
        if (!refound || refound.element.type !== 'collection') {
          ctx.setStatus(
            'Reset template failed: Collection ' +
              collection.id +
              ' is no longer present.',
            'error',
          );
          return;
        }
        ctx.captureForUndo();
        // Codex review pass 1 — pass refound.element.id so the reset seed
        // carries `--<collectionId>` suffixes on its element ids, matching
        // the first-switch seed path. Two Collections on the same page can
        // both reset without colliding on `card-default-root`.
        //
        // Codex review pass 5 finding 1 — pass refound.element.box.w/h so
        // the reset seed scales to fit the (possibly resized) Collection.
        // If the Owner shrank the host below the seed's native 320x360
        // before clicking Reset, an unscaled seed would overflow and the
        // save would block on box-bound validation errors.
        refound.element.customTemplate = seedCustomTemplate(
          refound.element.id,
          refound.element.box.w,
          refound.element.box.h,
        );
        // Codex review pass 3 finding 2 — reset must NOT use
        // ctx.rebuildElement here. When the Owner is currently editing THIS
        // Collection's template, the Phase 3 chrome (banner, Done button,
        // `data-template-edit-active` marker, surround dimming) lives on
        // the wrapper that rebuildElement replaces; the replacement strips
        // that chrome and leaves edit mode appearing active but visually
        // unmoored. ctx.renderAll() rebuilds the entire canvas AND re-runs
        // mountTemplateEditChromeImpl (render.ts:381), so the chrome
        // re-mounts on the fresh wrapper. The first-switch path uses the
        // same renderAll-only discipline (pass 1 F2); this path now matches.
        ctx.renderAll();
        ctx.scheduleSave();
        ctx.setStatus('Custom template reset to default.', 'ok');
      })();
    });
    tplControls.appendChild(resetBtn);

    inspector.appendChild(field('Custom template', tplControls));

    // ADR 0065 F1-multi-collab-presence — surface concurrent template
    // editors on this Collection. `ctx.collectionTemplateEditors` is
    // maintained by onRemotePresence (co-edit.ts) off the Yjs awareness
    // fan-out; the keys are Collection ids that have ≥1 OTHER peer
    // (local self is excluded by the receive-side computation) currently
    // pinned to template-edit mode. Rendered as a subtle informational
    // line under the Edit/Done/Reset row.
    //
    // Indicator copy: "N other(s) editing: name1, name2" — singular
    // "other" when N === 1, plural "others" otherwise. Surface tone
    // matches the inspector's other quiet hints (var(--opencanvas-muted)
    // with fallback), not the error-tone treatment used by
    // staleFolderWarning + the substitution warning below — the message
    // is informational, not a correctness signal.
    const concurrentEditors = ctx.collectionTemplateEditors.get(collection.id);
    if (concurrentEditors && concurrentEditors.length > 0) {
      const presenceIndicator = document.createElement('div');
      presenceIndicator.style.cssText =
        'font-size:12px; color:var(--opencanvas-muted, #888); margin: -4px 0 8px 0;';
      const noun = concurrentEditors.length === 1 ? 'other' : 'others';
      presenceIndicator.textContent =
        concurrentEditors.length +
        ' ' +
        noun +
        ' editing: ' +
        concurrentEditors.join(', ');
      inspector.appendChild(presenceIndicator);
    }

    // ADR 0065 F1-substitution-warning — when the Owner has a non-empty
    // customTemplate that contains zero `{{<placeholder>}}` tokens, every
    // materialized card will render identical static content. That may be
    // intentional (the Owner genuinely wants N identical cards) so the
    // signal is informational, not blocking; ADR §Out-of-scope pins that
    // the validator MUST NOT reject the template. Empty template
    // (length === 0) is handled by a separate chrome (materializer
    // decision 8 failure path) so we do not double-warn here.
    //
    // Visual treatment matches `staleFolderWarning` above — same DOM
    // shape, same error-toned 12px style — so the inspector's two
    // inline warnings read consistently.
    if (
      collection.customTemplate !== undefined &&
      collection.customTemplate.length > 0 &&
      !templateHasAnyPlaceholder(collection.customTemplate)
    ) {
      const noSubstitutionsWarning = document.createElement('div');
      noSubstitutionsWarning.style.cssText =
        'font-size:12px; color:var(--opencanvas-error, #d33); margin: -4px 0 8px 0;';
      noSubstitutionsWarning.textContent =
        'This template has no per-entry substitutions — all cards will show the ' +
        'same content. Add {{title}} or {{excerpt}} to a Text element to vary cards ' +
        'per entry.';
      inspector.appendChild(noSubstitutionsWarning);
    }
  }

  // -- 6. Manage entries link (ADR 0063 dec 10) ----------------------------
  // Only rendered when the slug is set — there's no entries view for an
  // unbound Collection. The link opens the dashboard's entries tab,
  // pre-filtered to the slug (and folder, when set).
  if (collection.collectionSlug !== undefined) {
    const manageLink = document.createElement('a');
    let href =
      '/dashboard/sites/' +
      encodeURIComponent(ctx.siteId) +
      '/entries?collection=' +
      encodeURIComponent(collection.collectionSlug);
    if (collection.folder !== undefined && collection.folder.length > 0) {
      href += '&folder=' + encodeURIComponent(collection.folder);
    }
    manageLink.href = href;
    manageLink.target = '_blank';
    manageLink.rel = 'noopener';
    manageLink.className = 'opencanvas-page-inspector-link';
    let label = 'Manage entries in ' + collection.collectionSlug;
    if (collection.folder !== undefined && collection.folder.length > 0) {
      label += '/' + collection.folder;
    }
    label += ' →';
    manageLink.textContent = label;
    manageLink.title = 'Open the Entries dashboard tab for this collection';
    const linkWrap = document.createElement('div');
    linkWrap.style.cssText = 'margin: 8px 0;';
    linkWrap.appendChild(manageLink);
    inspector.appendChild(linkWrap);
  }
}
