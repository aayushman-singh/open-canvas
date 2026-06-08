// src/editor-client/inspector-form-mounts.ts
//
// ADR 0058 Phase 2h.2.b — form inspector mount functions.
// canvas-client.ts:4865-5230 carries the inline twins; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// Two mounts:
//   - mountFormFields: per-field card editor (label / kind / required /
//     conditional placeholder / conditional select-options list) plus the
//     "Add field" button. assertFormOptionShape throws synchronously when
//     a stored option lacks the { value, label } shape rather than silently
//     rendering a broken row.
//   - mountFormStyle: per-form visual customisation (typography / labels /
//     inputs / submit button) rendered as collapsible <details> sections.
//     Writes into element.formStyle and clears the object when every field
//     is unset, so a never-touched form never carries a stale formStyle.
//
// Behavioural invariants the inline twin pins (and this module must keep):
//   - Field-card render order: Label, Kind, Required, [Placeholder if
//     kind !== 'checkbox'], [Options if kind === 'select'], Remove.
//   - Switching kind → 'select' auto-creates default options when none
//     exist so the renderer never sees an empty options array.
//   - assertFormOptionShape throws on malformed option entries (no
//     silent skip — see CLAUDE.md "no fallbacks" stance).

import type { EditorContext } from './editor-context.js';
import type { FormElement, FormFieldDef, FormStyle } from '../canvas/elements/form.js';
import { field, selectInput } from './dom-builders.js';
import { newElementId } from './ids.js';
import { buildColorRow, createInspectorEntry } from './inspector-leaf-builders.js';

export function mountFormFields(
  ctx: EditorContext,
  element: FormElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.fields)) element.fields = [];
  const fieldListHost = document.createElement('div');

  function formOption(label: string): { value: string; label: string } {
    return { value: label, label: label };
  }

  function assertFormOptionShape(
    option: unknown,
    fieldId: string,
    optionIndex: number,
  ): asserts option is { value: string; label: string } {
    if (
      !option ||
      typeof option !== 'object' ||
      typeof (option as { value?: unknown }).value !== 'string' ||
      typeof (option as { label?: unknown }).label !== 'string'
    ) {
      throw new Error(
        'mountFormFields: field ' +
          JSON.stringify(fieldId) +
          ' option ' +
          String(optionIndex) +
          ' must be { value: string, label: string }',
      );
    }
  }

  function renderFieldList(): void {
    fieldListHost.replaceChildren();
    for (let fi = 0; fi < element.fields.length; fi++) {
      (function (idx: number) {
        const f = element.fields[idx] as FormFieldDef;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'opencanvas-inspector-remove';
        removeBtn.textContent = '×';
        removeBtn.title = 'Remove field';
        removeBtn.setAttribute('aria-label', 'Remove field');
        removeBtn.addEventListener('click', function () {
          element.fields.splice(idx, 1);
          renderFieldList();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        const card = createInspectorEntry('Field ' + (idx + 1), removeBtn);

        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = f.label;
        labelInput.placeholder = 'Field label';
        labelInput.addEventListener('change', function () {
          f.label = labelInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Label', labelInput));

        const kindSel = selectInput(
          ['text', 'email', 'textarea', 'checkbox', 'select'],
          f.kind,
        );
        kindSel.addEventListener('change', function () {
          f.kind = kindSel.value as FormFieldDef['kind'];
          if (f.kind === 'select' && !Array.isArray(f.options)) {
            f.options = [formOption('Option 1'), formOption('Option 2')];
          }
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
          renderFieldList();
        });
        card.appendChild(field('Kind', kindSel));

        const reqRow = document.createElement('div');
        reqRow.className = 'field field--toggle';
        const reqLabel = document.createElement('label');
        reqLabel.className = 'opencanvas-toggle';
        const reqCheck = document.createElement('input');
        reqCheck.type = 'checkbox';
        reqCheck.className = 'opencanvas-toggle-input';
        reqCheck.checked = !!f.required;
        const reqTrack = document.createElement('span');
        reqTrack.className = 'opencanvas-toggle-track';
        reqTrack.setAttribute('aria-hidden', 'true');
        const reqText = document.createElement('span');
        reqText.className = 'opencanvas-toggle-text';
        reqText.textContent = 'Required';
        reqCheck.addEventListener('change', function () {
          f.required = reqCheck.checked;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        reqLabel.appendChild(reqCheck);
        reqLabel.appendChild(reqTrack);
        reqLabel.appendChild(reqText);
        reqRow.appendChild(reqLabel);
        card.appendChild(reqRow);

        if (f.kind !== 'checkbox') {
          const phInput = document.createElement('input');
          phInput.type = 'text';
          phInput.value = f.placeholder || '';
          phInput.placeholder = 'Placeholder text';
          phInput.addEventListener('change', function () {
            f.placeholder = phInput.value;
            ctx.rebuildElement(element.id);
            ctx.scheduleSave();
          });
          card.appendChild(field('Placeholder', phInput));
        }

        if (f.kind === 'select') {
          if (!Array.isArray(f.options)) f.options = [];
          const optHost = document.createElement('div');

          function renderOpts(): void {
            optHost.replaceChildren();
            const options = f.options as Array<{ value: string; label: string }>;
            for (let oi = 0; oi < options.length; oi++) {
              (function (optIdx: number) {
                const option = options[optIdx];
                assertFormOptionShape(option, f.id, optIdx);
                const optRow = document.createElement('div');
                optRow.style.cssText = 'display:flex;gap:4px;margin-bottom:2px;';
                const optInput = document.createElement('input');
                optInput.type = 'text';
                optInput.value = option.label;
                optInput.style.cssText = 'flex:1;min-width:0;';
                optInput.addEventListener('change', function () {
                  options[optIdx] = { value: optInput.value, label: optInput.value };
                  ctx.rebuildElement(element.id);
                  ctx.scheduleSave();
                });
                optRow.appendChild(optInput);
                const rmOpt = document.createElement('button');
                rmOpt.type = 'button';
                rmOpt.className = 'opencanvas-inspector-remove';
                rmOpt.textContent = '×';
                rmOpt.title = 'Remove option';
                rmOpt.setAttribute('aria-label', 'Remove option');
                rmOpt.addEventListener('click', function () {
                  options.splice(optIdx, 1);
                  renderOpts();
                  ctx.rebuildElement(element.id);
                  ctx.scheduleSave();
                });
                optRow.appendChild(rmOpt);
                optHost.appendChild(optRow);
              })(oi);
            }
            const addOpt = document.createElement('button');
            addOpt.type = 'button';
            addOpt.className = 'opencanvas-inspector-add';
            addOpt.textContent = 'Add option';
            addOpt.addEventListener('click', function () {
              options.push(formOption('Option ' + (options.length + 1)));
              renderOpts();
              ctx.rebuildElement(element.id);
              ctx.scheduleSave();
            });
            optHost.appendChild(addOpt);
          }
          renderOpts();
          card.appendChild(field('Options', optHost));
        }

        fieldListHost.appendChild(card);
      })(fi);
    }

    const addFieldBtn = document.createElement('button');
    addFieldBtn.type = 'button';
    addFieldBtn.className = 'opencanvas-inspector-add';
    addFieldBtn.textContent = 'Add field';
    addFieldBtn.addEventListener('click', function () {
      element.fields.push({
        id: newElementId(),
        label: 'New field',
        kind: 'text',
        required: false,
        placeholder: '',
      });
      renderFieldList();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    fieldListHost.appendChild(addFieldBtn);
  }
  renderFieldList();
  host.appendChild(field('Fields', fieldListHost));
}

export function mountFormStyle(
  ctx: EditorContext,
  element: FormElement,
  host: HTMLElement,
): void {
  const fs: FormStyle = element.formStyle || {};

  function ensureFs(): void {
    if (!element.formStyle) element.formStyle = fs;
  }
  function maybeClear(): void {
    let hasAny = false;
    for (const k in fs) {
      if ((fs as Record<string, unknown>)[k] !== undefined) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) delete element.formStyle;
  }
  function commit(): void {
    ensureFs();
    maybeClear();
    ctx.rebuildElement(element.id);
    ctx.scheduleSave();
  }

  function colorRowFor(
    key: keyof FormStyle,
    swatchDefault: string,
    label: string,
  ): HTMLDivElement {
    const row = buildColorRow({
      getValue: function () {
        return fs[key] as string | undefined;
      },
      setValue: function (v: string) {
        (fs as Record<string, unknown>)[key as string] = v;
      },
      clearValue: function () {
        delete (fs as Record<string, unknown>)[key as string];
      },
      onChange: commit,
      enabledTitle: 'Enable ' + label.toLowerCase(),
      swatchDefault: swatchDefault,
    });
    return field(label, row);
  }

  function pxRowFor(
    key: keyof FormStyle,
    label: string,
    opts?: { min?: number; max?: number; placeholder?: string },
  ): HTMLDivElement {
    const min = opts && typeof opts.min === 'number' ? opts.min : 0;
    const max = opts && typeof opts.max === 'number' ? opts.max : 200;
    const placeholder = opts && opts.placeholder ? opts.placeholder : 'auto';
    const row = document.createElement('div');
    row.className = 'style-row';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.placeholder = placeholder;
    input.value = typeof fs[key] === 'number' ? String(fs[key]) : '';
    input.style.width = '72px';
    const unit = document.createElement('span');
    unit.className = 'unit-label';
    unit.textContent = 'px';
    input.addEventListener('change', function () {
      const raw = input.value.trim();
      if (raw === '') {
        delete (fs as Record<string, unknown>)[key as string];
      } else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < min) {
          input.value = typeof fs[key] === 'number' ? String(fs[key]) : '';
          return;
        }
        (fs as Record<string, unknown>)[key as string] = n;
      }
      commit();
    });
    row.appendChild(input);
    row.appendChild(unit);
    return field(label, row);
  }

  function weightRowFor(key: keyof FormStyle, label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'style-row';
    const select = document.createElement('select');
    const options = [
      { value: '', label: 'Default' },
      { value: 'normal', label: 'Normal' },
      { value: 'medium', label: 'Medium' },
      { value: 'bold', label: 'Bold' },
    ];
    for (let i = 0; i < options.length; i++) {
      const entry = options[i]!;
      const opt = document.createElement('option');
      opt.value = entry.value;
      opt.textContent = entry.label;
      select.appendChild(opt);
    }
    select.value = typeof fs[key] === 'string' ? (fs[key]) : '';
    select.addEventListener('change', function () {
      if (select.value === '') delete (fs as Record<string, unknown>)[key as string];
      else (fs as Record<string, unknown>)[key as string] = select.value;
      commit();
    });
    row.appendChild(select);
    return field(label, row);
  }

  function checkboxRowFor(key: keyof FormStyle, label: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'field field--toggle';
    const lbl = document.createElement('label');
    lbl.className = 'opencanvas-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'opencanvas-toggle-input';
    cb.checked = !!fs[key];
    const track = document.createElement('span');
    track.className = 'opencanvas-toggle-track';
    track.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.className = 'opencanvas-toggle-text';
    text.textContent = label;
    cb.addEventListener('change', function () {
      if (cb.checked) (fs as Record<string, unknown>)[key as string] = true;
      else delete (fs as Record<string, unknown>)[key as string];
      commit();
    });
    lbl.appendChild(cb);
    lbl.appendChild(track);
    lbl.appendChild(text);
    row.appendChild(lbl);
    return row;
  }

  function section(title: string, rows: HTMLElement[]): HTMLDetailsElement {
    const details = document.createElement('details');
    details.className = 'form-style-section';
    const summary = document.createElement('summary');
    summary.textContent = title;
    details.appendChild(summary);
    for (let i = 0; i < rows.length; i++) details.appendChild(rows[i]!);
    return details;
  }

  // -- Typography
  const fontSelect = document.createElement('select');
  const fontOptions = [
    { value: '', label: 'Default (inherit)' },
    { value: 'kit-display', label: 'Kit display font' },
    { value: 'kit-body', label: 'Kit body font' },
    { value: 'kit-mono', label: 'Kit mono font' },
    { value: 'custom', label: 'Custom font…' },
  ];
  for (let fi = 0; fi < fontOptions.length; fi++) {
    const entry = fontOptions[fi]!;
    const fOpt = document.createElement('option');
    fOpt.value = entry.value;
    fOpt.textContent = entry.label;
    fontSelect.appendChild(fOpt);
  }
  fontSelect.value =
    typeof fs.fontFamily === 'string' && fs.fontFamily !== 'inherit' ? fs.fontFamily : '';
  const fontCustom = document.createElement('input');
  fontCustom.type = 'text';
  fontCustom.placeholder = "e.g. 'Inter', system-ui, sans-serif";
  fontCustom.value = fs.fontFamilyCustom || '';
  fontCustom.style.marginTop = '6px';
  fontCustom.hidden = fontSelect.value !== 'custom';
  fontSelect.addEventListener('change', function () {
    if (fontSelect.value === '') {
      delete fs.fontFamily;
      delete fs.fontFamilyCustom;
      fontCustom.hidden = true;
    } else {
      fs.fontFamily = fontSelect.value as NonNullable<FormStyle['fontFamily']>;
      if (fontSelect.value !== 'custom') delete fs.fontFamilyCustom;
      fontCustom.hidden = fontSelect.value !== 'custom';
    }
    commit();
  });
  fontCustom.addEventListener('change', function () {
    const v = fontCustom.value.trim();
    if (v === '') delete fs.fontFamilyCustom;
    else fs.fontFamilyCustom = v;
    commit();
  });
  const fontRowWrap = document.createElement('div');
  fontRowWrap.style.display = 'flex';
  fontRowWrap.style.flexDirection = 'column';
  fontRowWrap.style.gap = '4px';
  fontRowWrap.appendChild(fontSelect);
  fontRowWrap.appendChild(fontCustom);

  host.appendChild(
    section('Typography', [
      field('Font', fontRowWrap),
      pxRowFor('fontSize', 'Base size', { min: 8, max: 48, placeholder: 'inherit' }),
      pxRowFor('fieldGap', 'Field gap', { min: 0, max: 64, placeholder: '14' }),
    ]),
  );

  // -- Labels
  host.appendChild(
    section('Labels', [
      colorRowFor('labelColor', '#222222', 'Color'),
      pxRowFor('labelFontSize', 'Size', { min: 8, max: 32, placeholder: 'inherit' }),
      weightRowFor('labelFontWeight', 'Weight'),
    ]),
  );

  // -- Inputs
  host.appendChild(
    section('Inputs', [
      colorRowFor('inputBackgroundColor', '#ffffff', 'Background'),
      colorRowFor('inputColor', '#222222', 'Text color'),
      colorRowFor('inputBorderColor', '#cccccc', 'Border color'),
      pxRowFor('inputBorderWidth', 'Border width', { min: 0, max: 8, placeholder: '1' }),
      pxRowFor('inputBorderRadius', 'Radius', { min: 0, max: 40, placeholder: '6' }),
      pxRowFor('inputPaddingX', 'Padding X', { min: 0, max: 40, placeholder: '12' }),
      pxRowFor('inputPaddingY', 'Padding Y', { min: 0, max: 40, placeholder: '10' }),
      colorRowFor('inputPlaceholderColor', '#999999', 'Placeholder'),
      colorRowFor('inputFocusRingColor', '#3b82f6', 'Focus ring'),
    ]),
  );

  // -- Submit
  host.appendChild(
    section('Submit button', [
      colorRowFor('submitBackgroundColor', '#3b82f6', 'Background'),
      colorRowFor('submitColor', '#ffffff', 'Text color'),
      colorRowFor('submitHoverBackgroundColor', '#2563eb', 'Hover background'),
      colorRowFor('submitBorderColor', '#3b82f6', 'Border color'),
      pxRowFor('submitBorderWidth', 'Border width', { min: 0, max: 8, placeholder: '0' }),
      pxRowFor('submitBorderRadius', 'Radius', { min: 0, max: 40, placeholder: '6' }),
      pxRowFor('submitPaddingX', 'Padding X', { min: 0, max: 60, placeholder: '18' }),
      pxRowFor('submitPaddingY', 'Padding Y', { min: 0, max: 40, placeholder: '10' }),
      pxRowFor('submitFontSize', 'Font size', { min: 8, max: 32, placeholder: '14' }),
      weightRowFor('submitFontWeight', 'Font weight'),
      checkboxRowFor('submitFullWidth', 'Full width'),
    ]),
  );
}
