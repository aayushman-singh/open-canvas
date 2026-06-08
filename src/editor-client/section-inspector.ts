// src/editor-client/section-inspector.ts
//
// ADR 0058 Phase 2h.3.a — section inspector renderer.
// canvas-client.ts:5825-6084 carries the inline twin; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// Renders the section-selection inspector pane: Identity (role) →
// Background (effect, video) → Motion (entrance preset) → Behaviour
// (popup trigger) → action button grid (Duplicate/Move up/Move down for
// non-pinned sections, plus Save to library, Delete section, and Generate
// with AI). Every change handler follows the canonical sequencing
// captureForUndo → renderAll → (optional renderSectionInspector for
// re-renders that need updated derived state) → scheduleSave.

import type {
  EditorContext,
  PersistContext,
  RenderContext,
  StatusEmitterContext,
} from './editor-context.js';
import type {
  AccentBorder,
  BackgroundEffect,
  MotionPreset,
  SectionRole,
} from '../canvas/schema.js';
import { MOTION_PRESETS } from '../canvas/schema.js';
import { selectInput } from './dom-builders.js';
import { buildColorRow } from './inspector-leaf-builders.js';

// ADR 0064 — narrow context for the section inspector. Three canonical
// clusters fit cleanly: RenderContext (renderAll + preserveInspectorScrollFor),
// PersistContext (captureForUndo + scheduleSave), StatusEmitterContext
// (setStatus). The remaining surface is single-field-per-cluster
// (`inspector` from DomContext, `findSection` from StateContext,
// `selectedSectionId` from SelectionContext) plus six module-specific
// verbs that no named cluster owns (`inspectorRenderSubject`,
// `revokePendingPreviews`, `selectableSectionRoles`, `postAssetUpload`,
// `aiBusy`, `aiCreateSection`); per Decision 2 those stay inline rather
// than widening the signature to clusters where only one field is consumed.
// `aiBusy` belongs to the lazy `AiContext` cluster but is the only field
// of it the section inspector touches — inline `Pick` honours the cluster
// while keeping the surface honest.
export type SectionInspectorContext = RenderContext &
  PersistContext &
  StatusEmitterContext &
  Pick<
    EditorContext,
    | 'inspector'
    | 'findSection'
    | 'selectedSectionId'
    | 'inspectorRenderSubject'
    | 'revokePendingPreviews'
    | 'selectableSectionRoles'
    | 'postAssetUpload'
    | 'aiBusy'
    | 'aiCreateSection'
  >;

export function renderSectionInspector(ctx: SectionInspectorContext): void {
  if (!ctx.inspector) return;
  const sectionLookup = ctx.findSection(ctx.selectedSectionId);
  if (!sectionLookup) {
    ctx.inspector.hidden = true;
    ctx.inspector.replaceChildren();
    ctx.inspectorRenderSubject = null;
    return;
  }
  // Local non-null alias so callback closures keep the narrowed type
  // without re-asserting on every read.
  const section = sectionLookup;
  ctx.preserveInspectorScrollFor('section:' + section.id);
  ctx.revokePendingPreviews();
  ctx.inspector.replaceChildren();
  ctx.inspector.hidden = false;

  const heading = document.createElement('h3');
  heading.textContent = 'Section';
  ctx.inspector.appendChild(heading);

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = section.name || section.recipeId;
  ctx.inspector.appendChild(meta);

  // -- Section fields (ADR 0033) --------------------------------------
  // Grouped Identity (role) -> Background (effect, video) -> Motion
  // (entrance) -> Behaviour (trigger). All five fields previously
  // existed in the schema (src/canvas/schema.ts:337-351) without
  // editor UI; AI Chat was the only mutation surface. Hand-rolled
  // groups (no spec-driven generation): the section inspector is
  // not in INSPECTOR_DISPATCH because section is not an ElementType.

  // -- Identity -------------------------------------------------------
  const groupIdentity = document.createElement('div');
  groupIdentity.className = 'opencanvas-page-inspector-group';
  const hIdentity = document.createElement('h4');
  hIdentity.textContent = 'Identity';
  groupIdentity.appendChild(hIdentity);
  const roleLabel = document.createElement('label');
  roleLabel.textContent = 'Role';
  roleLabel.style.display = 'block';
  roleLabel.style.fontSize = '12px';
  roleLabel.style.color = 'var(--opencanvas-fg-mute)';
  roleLabel.style.marginBottom = '4px';
  groupIdentity.appendChild(roleLabel);
  const roleSel = selectInput(ctx.selectableSectionRoles(section), section.role || 'body');
  roleSel.addEventListener('change', function () {
    if (roleSel.value === 'body') delete section.role;
    else section.role = roleSel.value as SectionRole;
    // Re-render: role change can flip pinned/unpinned which changes
    // the action-buttons list (Duplicate/Move up/Move down are hidden
    // for pinned sections at line 4194).
    ctx.captureForUndo();
    ctx.renderAll();
    renderSectionInspector(ctx);
    ctx.scheduleSave();
  });
  groupIdentity.appendChild(roleSel);
  ctx.inspector.appendChild(groupIdentity);

  // -- Background -----------------------------------------------------
  const groupBg = document.createElement('div');
  groupBg.className = 'opencanvas-page-inspector-group';
  const hBg = document.createElement('h4');
  hBg.textContent = 'Background';
  groupBg.appendChild(hBg);
  const bgEffectLabel = document.createElement('label');
  bgEffectLabel.textContent = 'Effect';
  bgEffectLabel.style.cssText =
    'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px';
  groupBg.appendChild(bgEffectLabel);
  const bgEffectSel = selectInput(
    ['none', 'grain', 'grid', 'soft-light', 'paper', 'glass'],
    section.backgroundEffect || 'none',
  );
  bgEffectSel.addEventListener('change', function () {
    if (bgEffectSel.value === 'none') delete section.backgroundEffect;
    else section.backgroundEffect = bgEffectSel.value as BackgroundEffect;
    ctx.captureForUndo();
    ctx.renderAll();
    ctx.scheduleSave();
  });
  groupBg.appendChild(bgEffectSel);

  const bgVideoLabel = document.createElement('label');
  bgVideoLabel.textContent = 'Video';
  bgVideoLabel.style.cssText =
    'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin:10px 0 4px';
  groupBg.appendChild(bgVideoLabel);
  const bgVideoRow = document.createElement('div');
  bgVideoRow.style.cssText = 'display:flex;gap:6px;align-items:center';
  const bgVideoStatus = document.createElement('div');
  bgVideoStatus.textContent = section.backgroundVideoAssetId
    ? 'Asset ' + section.backgroundVideoAssetId.slice(0, 8) + '...'
    : 'none';
  bgVideoStatus.style.cssText =
    'flex:1;font-size:12px;color:var(--opencanvas-fg-mute);overflow:hidden;text-overflow:ellipsis';
  const bgVideoUpload = document.createElement('button');
  bgVideoUpload.type = 'button';
  bgVideoUpload.textContent = 'Upload';
  bgVideoUpload.className = 'style-btn';
  const bgVideoClear = document.createElement('button');
  bgVideoClear.type = 'button';
  bgVideoClear.textContent = 'x';
  bgVideoClear.className = 'style-btn-clear';
  bgVideoClear.title = 'Clear background video';
  bgVideoClear.disabled = !section.backgroundVideoAssetId;
  const bgVideoFileInput = document.createElement('input');
  bgVideoFileInput.type = 'file';
  bgVideoFileInput.accept = 'video/*';
  bgVideoFileInput.style.display = 'none';
  bgVideoFileInput.addEventListener('change', function () {
    if (!bgVideoFileInput.files || bgVideoFileInput.files.length === 0) return;
    const file = bgVideoFileInput.files[0]!;
    ctx.setStatus('Uploading background video...', 'info');
    ctx
      .postAssetUpload(file, '', '')
      .then(function (result) {
        section.backgroundVideoAssetId = result.assetId;
        ctx.captureForUndo();
        ctx.renderAll();
        renderSectionInspector(ctx);
        ctx.scheduleSave();
        ctx.setStatus('Background video set', 'ok');
      })
      .catch(function (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.setStatus('Upload failed: ' + message, 'error');
      });
  });
  bgVideoUpload.addEventListener('click', function () {
    bgVideoFileInput.value = '';
    bgVideoFileInput.click();
  });
  bgVideoClear.addEventListener('click', function () {
    delete section.backgroundVideoAssetId;
    ctx.captureForUndo();
    ctx.renderAll();
    renderSectionInspector(ctx);
    ctx.scheduleSave();
  });
  bgVideoRow.appendChild(bgVideoStatus);
  bgVideoRow.appendChild(bgVideoUpload);
  bgVideoRow.appendChild(bgVideoClear);
  bgVideoRow.appendChild(bgVideoFileInput);
  groupBg.appendChild(bgVideoRow);
  ctx.inspector.appendChild(groupBg);

  // -- Accent border (ADR 0062) --------------------------------------
  // Discriminated-union field; four variants are mutually exclusive by
  // construction. Type-picker first; then variant-specific controls
  // (color + thickness/width/radius/spread) render conditionally so the
  // shape of the form matches the shape of the data exactly.
  const groupAccent = document.createElement('div');
  groupAccent.className = 'opencanvas-page-inspector-group';
  const hAccent = document.createElement('h4');
  hAccent.textContent = 'Accent border';
  groupAccent.appendChild(hAccent);

  const accentTypeLabel = document.createElement('label');
  accentTypeLabel.textContent = 'Style';
  accentTypeLabel.style.cssText =
    'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px';
  groupAccent.appendChild(accentTypeLabel);

  // Display values map to the user-facing labels in the spec; storage
  // values stay aligned with AccentBorder['type'] + 'none' for absence.
  const ACCENT_DISPLAY: Array<{ value: 'none' | AccentBorder['type']; label: string }> = [
    { value: 'none', label: 'None' },
    { value: 'solid', label: 'Solid' },
    { value: 'top', label: 'Top stripe' },
    { value: 'left', label: 'Left bar' },
    { value: 'glow', label: 'Glow' },
  ];
  const currentAccent = section.accentBorder ? section.accentBorder.type : 'none';
  const accentTypeSel = document.createElement('select');
  for (const opt of ACCENT_DISPLAY) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === currentAccent) o.selected = true;
    accentTypeSel.appendChild(o);
  }
  accentTypeSel.addEventListener('change', function () {
    const next = accentTypeSel.value as 'none' | AccentBorder['type'];
    const prevColor = section.accentBorder ? section.accentBorder.color : '#3b82f6';
    if (next === 'none') {
      delete section.accentBorder;
    } else if (next === 'solid') {
      section.accentBorder = { type: 'solid', color: prevColor, width: 1 };
    } else if (next === 'top') {
      section.accentBorder = { type: 'top', color: prevColor, thickness: 3 };
    } else if (next === 'left') {
      section.accentBorder = { type: 'left', color: prevColor, thickness: 3 };
    } else {
      section.accentBorder = { type: 'glow', color: prevColor, radius: 48 };
    }
    ctx.captureForUndo();
    ctx.renderAll();
    // Re-render the inspector so the variant-specific controls update.
    renderSectionInspector(ctx);
    ctx.scheduleSave();
  });
  groupAccent.appendChild(accentTypeSel);

  if (section.accentBorder) {
    const ab = section.accentBorder;

    // Color row — reuses buildColorRow so the picker, hex entry, and
    // reset story match the rest of the inspector.
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Color';
    colorLabel.style.cssText =
      'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin:10px 0 4px';
    groupAccent.appendChild(colorLabel);
    const colorRow = buildColorRow({
      getValue: function () {
        return section.accentBorder ? section.accentBorder.color : null;
      },
      setValue: function (v) {
        if (section.accentBorder) section.accentBorder.color = v;
      },
      clearValue: function () {
        // The accent group as a whole has its own "None" type-pick to
        // remove the field; the per-row clear button reverts color to
        // the default rather than dropping the accent altogether.
        if (section.accentBorder) section.accentBorder.color = '#3b82f6';
      },
      onChange: function () {
        ctx.captureForUndo();
        ctx.renderAll();
        ctx.scheduleSave();
      },
      enabledTitle: 'Use a custom accent color',
      swatchDefault: '#3b82f6',
    });
    groupAccent.appendChild(colorRow);

    // Variant-specific numeric control. Type-narrowed locally so each
    // arm only writes the field it owns.
    const numericLabel = document.createElement('label');
    numericLabel.style.cssText =
      'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin:10px 0 4px';
    const numericInput = document.createElement('input');
    numericInput.type = 'number';
    numericInput.min = '1';
    numericInput.style.cssText = 'width:100%';

    if (ab.type === 'solid') {
      numericLabel.textContent = 'Width (px)';
      numericInput.value = String(ab.width);
      numericInput.max = '12';
      numericInput.addEventListener('change', function () {
        const v = parseInt(numericInput.value, 10);
        if (!isNaN(v) && v > 0 && section.accentBorder && section.accentBorder.type === 'solid') {
          section.accentBorder.width = v;
          ctx.captureForUndo();
          ctx.renderAll();
          ctx.scheduleSave();
        }
      });
    } else if (ab.type === 'top' || ab.type === 'left') {
      numericLabel.textContent = 'Thickness (px)';
      numericInput.value = String(ab.thickness);
      numericInput.max = '24';
      numericInput.addEventListener('change', function () {
        const v = parseInt(numericInput.value, 10);
        if (
          !isNaN(v) &&
          v > 0 &&
          section.accentBorder &&
          (section.accentBorder.type === 'top' || section.accentBorder.type === 'left')
        ) {
          section.accentBorder.thickness = v;
          ctx.captureForUndo();
          ctx.renderAll();
          ctx.scheduleSave();
        }
      });
    } else {
      // glow
      numericLabel.textContent = 'Radius (px)';
      numericInput.value = String(ab.radius);
      numericInput.max = '200';
      numericInput.addEventListener('change', function () {
        const v = parseInt(numericInput.value, 10);
        if (!isNaN(v) && v > 0 && section.accentBorder && section.accentBorder.type === 'glow') {
          section.accentBorder.radius = v;
          ctx.captureForUndo();
          ctx.renderAll();
          ctx.scheduleSave();
        }
      });
    }
    groupAccent.appendChild(numericLabel);
    groupAccent.appendChild(numericInput);

    if (ab.type === 'glow') {
      const spreadLabel = document.createElement('label');
      spreadLabel.textContent = 'Spread (px, optional)';
      spreadLabel.style.cssText =
        'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin:10px 0 4px';
      const spreadInput = document.createElement('input');
      spreadInput.type = 'number';
      spreadInput.min = '0';
      spreadInput.max = '100';
      spreadInput.style.cssText = 'width:100%';
      spreadInput.value = ab.spread !== undefined ? String(ab.spread) : '';
      spreadInput.addEventListener('change', function () {
        if (!section.accentBorder || section.accentBorder.type !== 'glow') return;
        const raw = spreadInput.value.trim();
        if (raw === '') {
          delete section.accentBorder.spread;
        } else {
          const v = parseInt(raw, 10);
          if (!isNaN(v) && v >= 0) section.accentBorder.spread = v;
        }
        ctx.captureForUndo();
        ctx.renderAll();
        ctx.scheduleSave();
      });
      groupAccent.appendChild(spreadLabel);
      groupAccent.appendChild(spreadInput);
    }
  }
  ctx.inspector.appendChild(groupAccent);

  // -- Motion ---------------------------------------------------------
  const groupMotion = document.createElement('div');
  groupMotion.className = 'opencanvas-page-inspector-group';
  const hMotion = document.createElement('h4');
  hMotion.textContent = 'Motion';
  groupMotion.appendChild(hMotion);
  const entranceLabel = document.createElement('label');
  entranceLabel.textContent = 'Entrance preset';
  entranceLabel.style.cssText =
    'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px';
  groupMotion.appendChild(entranceLabel);
  const entranceSel = selectInput(MOTION_PRESETS, section.entrance || 'none');
  entranceSel.addEventListener('change', function () {
    if (entranceSel.value === 'none') delete section.entrance;
    else section.entrance = entranceSel.value as MotionPreset;
    ctx.captureForUndo();
    ctx.renderAll();
    ctx.scheduleSave();
  });
  groupMotion.appendChild(entranceSel);
  ctx.inspector.appendChild(groupMotion);

  // -- Behaviour (popup trigger) --------------------------------------
  const groupBeh = document.createElement('div');
  groupBeh.className = 'opencanvas-page-inspector-group';
  const hBeh = document.createElement('h4');
  hBeh.textContent = 'Behaviour';
  groupBeh.appendChild(hBeh);
  const triggerLabel = document.createElement('label');
  triggerLabel.textContent = 'Popup trigger';
  triggerLabel.style.cssText =
    'display:block;font-size:12px;color:var(--opencanvas-fg-mute);margin-bottom:4px';
  groupBeh.appendChild(triggerLabel);
  const currentTriggerType = section.trigger ? section.trigger.type : 'none';
  const triggerSel = selectInput(['none', 'exit-intent', 'delay', 'scroll'], currentTriggerType);
  triggerSel.addEventListener('change', function () {
    if (triggerSel.value === 'none') {
      delete section.trigger;
    } else if (triggerSel.value === 'exit-intent') {
      section.trigger = { type: 'exit-intent' };
    } else if (triggerSel.value === 'delay') {
      const prev =
        section.trigger && section.trigger.type === 'delay' ? section.trigger.value : 5000;
      section.trigger = { type: 'delay', value: prev };
    } else if (triggerSel.value === 'scroll') {
      const prevS =
        section.trigger && section.trigger.type === 'scroll' ? section.trigger.value : 50;
      section.trigger = { type: 'scroll', value: prevS };
    }
    ctx.captureForUndo();
    ctx.renderAll();
    renderSectionInspector(ctx);
    ctx.scheduleSave();
  });
  groupBeh.appendChild(triggerSel);
  if (section.trigger && (section.trigger.type === 'delay' || section.trigger.type === 'scroll')) {
    const valRow = document.createElement('div');
    valRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-top:6px';
    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.value = String(section.trigger.value);
    valInput.min = '0';
    valInput.max = section.trigger.type === 'scroll' ? '100' : '60000';
    valInput.style.cssText = 'flex:1';
    const unit = document.createElement('span');
    unit.textContent = section.trigger.type === 'scroll' ? '%' : 'ms';
    unit.style.cssText = 'font-size:12px;color:var(--opencanvas-fg-mute)';
    valInput.addEventListener('change', function () {
      const v = parseInt(valInput.value, 10);
      if (
        !isNaN(v) &&
        section.trigger &&
        (section.trigger.type === 'delay' || section.trigger.type === 'scroll')
      ) {
        section.trigger.value = v;
        ctx.captureForUndo();
        ctx.scheduleSave();
      }
    });
    valRow.appendChild(valInput);
    valRow.appendChild(unit);
    groupBeh.appendChild(valRow);
  }
  ctx.inspector.appendChild(groupBeh);

  // -- Action buttons (existing grid below the fields) ----------------
  const grid = document.createElement('div');
  grid.className = 'opencanvas-section-inspector-grid';

  // ADR 0059 — page sections can never be pinned; duplicate/move always allowed.
  const defs: { label: string; action: string; tip: string; danger?: boolean }[] = [];
  defs.push({ label: 'Duplicate', action: 'duplicate-section', tip: 'Create a copy of this section' });
  defs.push({ label: 'Move up', action: 'move-up', tip: 'Move this section up on the page' });
  defs.push({ label: 'Move down', action: 'move-down', tip: 'Move this section down on the page' });
  defs.push({
    label: 'Save to library',
    action: 'save-to-library',
    tip: 'Save this section for reuse on other pages',
  });
  defs.push({
    label: 'Delete section',
    action: 'delete-section',
    danger: true,
    tip: 'Remove this section from the page',
  });

  for (let i = 0; i < defs.length; i++) {
    const def = defs[i]!;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = def.label;
    btn.title = def.tip;
    btn.setAttribute('data-section-action', def.action);
    btn.setAttribute('data-section-id', section.id);
    if (def.danger) btn.classList.add('danger');
    grid.appendChild(btn);
  }

  const aiBtn = document.createElement('button');
  aiBtn.type = 'button';
  aiBtn.textContent = 'Generate with AI';
  aiBtn.title = 'Use AI to design this section from a description';
  aiBtn.setAttribute('data-ai-button', 'create-section');
  aiBtn.setAttribute('data-section-id', section.id);
  if (ctx.aiBusy) aiBtn.disabled = true;
  aiBtn.addEventListener('click', function (ev) {
    ev.stopPropagation();
    ctx.aiCreateSection(section.id);
  });
  grid.appendChild(aiBtn);

  ctx.inspector.appendChild(grid);
}
