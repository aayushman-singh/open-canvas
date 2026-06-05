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
//   3. Read-only kit summary, reading-order group, z-order group, and
//      element-actions group (verbs delegate to ./inspector-actions.js
//      builders).
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
import { MOTION_PRESETS, type MotionPreset } from '../canvas/schema.js';
import { renderSectionInspector } from './section-inspector.js';
import { renderPageInspector, replayAnimations } from './page-inspector.js';
import { field, selectInput } from './dom-builders.js';
import { buildColorRow, buildKitSummary } from './inspector-leaf-builders.js';
import {
  buildReorderGroup,
  buildZOrderGroup,
  buildElementActionsGroup,
} from './inspector-action-buttons.js';

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
  const { element, section } = found;
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

  // Reading-order group sits ABOVE the z-order group per the plan. The
  // caption is part of the group so it lives next to the buttons that
  // change it.
  ctx.inspector.appendChild(buildReorderGroup(ctx, section, element));
  ctx.inspector.appendChild(buildZOrderGroup(ctx, section, element));
  ctx.inspector.appendChild(buildElementActionsGroup(ctx, section, element));

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
    const borderEnabled = document.createElement('input');
    borderEnabled.type = 'checkbox';
    borderEnabled.checked = !!(es.borderColor || typeof es.borderWidth === 'number');
    borderEnabled.title = 'Enable border';
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
    borderRow.appendChild(borderEnabled);
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
}
