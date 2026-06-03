// src/editor-client/inspector-content-mounts.ts
//
// ADR 0058 Phase 2h.2.c — content-element inspector mount functions.
// canvas-client.ts:5240-5636 carries the inline twins; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// Three mounts:
//   - mountAccordionItems: per-item editor (title + rich-text body with a
//     contentEditable toolbar). The body is stored as InlineRun[] and
//     edited via execCommand-driven bold/italic/underline/strikethrough
//     buttons, then round-tripped back through ctx.serializeContentToRuns
//     on blur. runsToHtml escapes user text inline with the same &/</> rule
//     the IIFE twin uses and applies a fixed mark allow-list (bold, italic,
//     underline, strike, code, highlight, link) plus an http(s)/mailto/tel/
//     relative/anchor href guard.
//   - mountCarouselSlides: per-slide editor (thumbnail + upload + caption +
//     link). Upload reuses ctx.postAssetUpload, ctx.setStatus, and
//     ctx.buildPickerThumb so the carousel slide editor matches the media
//     picker's wiring without duplicating thumbnail/upload primitives.
//   - mountTableGrid: 2D rows × columns editor with per-cell text inputs,
//     per-column header inputs, add/remove column, add/remove row, and the
//     cascading cell cleanup that strips cells[<removedColId>] from every
//     row when a column is deleted. Cell ids use ctx.newElementId (sub-
//     items get fresh ids) so the IIFE twin's id contract is preserved.

import type { EditorContext } from './editor-context.js';
import type { AccordionElement } from '../canvas/elements/accordion.js';
import type { CarouselElement } from '../canvas/elements/carousel.js';
import type { TableElement } from '../canvas/elements/table.js';
import type { InlineRun } from '../canvas/schema.js';
import { field } from './dom-builders.js';
import { newElementId } from './ids.js';

export function mountAccordionItems(
  ctx: EditorContext,
  element: AccordionElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.items)) element.items = [];
  const itemListHost = document.createElement('div');

  // Accordion item bodies are stored as InlineRun[] but edited in a compact
  // inspector control. Render the saved runs as escaped HTML; only the small
  // mark allowlist below is converted back into tags.
  function runsToHtml(runs: InlineRun[]): string {
    let out = '';
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri]!;
      const text = run.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let inner = text;
      const marks = Array.isArray(run.marks) ? run.marks : [];
      for (let mi = 0; mi < marks.length; mi++) {
        const m = marks[mi]!;
        if (m.type === 'bold') inner = '<strong>' + inner + '</strong>';
        if (m.type === 'italic') inner = '<em>' + inner + '</em>';
        if (m.type === 'underline') inner = '<u>' + inner + '</u>';
        if (m.type === 'strike') inner = '<s>' + inner + '</s>';
        if (m.type === 'code') inner = '<code>' + inner + '</code>';
        if (m.type === 'highlight') inner = '<mark>' + inner + '</mark>';
        if (m.type === 'link') {
          const safeHref = /^(https?:|mailto:|tel:|\/|#)/i.test(m.href) ? m.href : '#';
          inner = '<a href="' + safeHref.replace(/"/g, '&quot;') + '">' + inner + '</a>';
        }
      }
      out += inner;
    }
    return out;
  }

  function renderItemList(): void {
    itemListHost.replaceChildren();
    for (let ii = 0; ii < element.items.length; ii++) {
      (function (idx: number) {
        const item = element.items[idx]!;
        const card = document.createElement('div');
        card.className = 'inspector-list-card';

        const titleInput = document.createElement('input');
        titleInput.type = 'text';
        titleInput.value = item.title;
        titleInput.placeholder = 'Title';
        titleInput.addEventListener('change', function () {
          item.title = titleInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Title', titleInput));

        const bodyWrap = document.createElement('div');
        const toolbar = document.createElement('div');
        toolbar.style.cssText = 'display:flex;gap:2px;margin-bottom:4px;';
        const boldBtn = document.createElement('button'); boldBtn.type = 'button'; boldBtn.textContent = 'B'; boldBtn.style.fontWeight = '700';
        const italicBtn = document.createElement('button'); italicBtn.type = 'button'; italicBtn.textContent = 'I'; italicBtn.style.fontStyle = 'italic';
        const underlineBtn = document.createElement('button'); underlineBtn.type = 'button'; underlineBtn.textContent = 'U'; underlineBtn.style.textDecoration = 'underline';
        const strikeBtn = document.createElement('button'); strikeBtn.type = 'button'; strikeBtn.textContent = 'S'; strikeBtn.style.textDecoration = 'line-through';
        toolbar.appendChild(boldBtn);
        toolbar.appendChild(italicBtn);
        toolbar.appendChild(underlineBtn);
        toolbar.appendChild(strikeBtn);
        bodyWrap.appendChild(toolbar);

        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        editable.style.cssText = 'min-height:40px;padding:4px 6px;border:1px solid var(--opencanvas-hairline);border-radius:4px;font-size:12px;background:var(--opencanvas-bg-panel);color:var(--opencanvas-fg);overflow-y:auto;max-height:120px;';
        editable.innerHTML = runsToHtml(Array.isArray(item.body) ? item.body : []);
        bodyWrap.appendChild(editable);

        function wireAccordionToolbarButton(button: HTMLButtonElement, command: string): void {
          button.addEventListener('mousedown', function (ev) {
            ev.preventDefault();
          });
          button.addEventListener('click', function () {
            editable.focus();
            document.execCommand(command);
          });
        }
        wireAccordionToolbarButton(boldBtn, 'bold');
        wireAccordionToolbarButton(italicBtn, 'italic');
        wireAccordionToolbarButton(underlineBtn, 'underline');
        wireAccordionToolbarButton(strikeBtn, 'strikeThrough');

        editable.addEventListener('blur', function () {
          item.body = ctx.serializeContentToRuns(editable);
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });

        card.appendChild(field('Body', bodyWrap));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'opencanvas-inspector-remove';
        removeBtn.textContent = '\\u00d7';
        removeBtn.title = 'Remove item';
        removeBtn.setAttribute('aria-label', 'Remove item');
        removeBtn.addEventListener('click', function () {
          element.items.splice(idx, 1);
          renderItemList();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(removeBtn);

        itemListHost.appendChild(card);
      })(ii);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'opencanvas-inspector-add';
    addBtn.textContent = 'Add item';
    addBtn.addEventListener('click', function () {
      element.items.push({ id: newElementId(), title: 'New item', body: [{ text: 'Content' }] });
      renderItemList();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    itemListHost.appendChild(addBtn);
  }
  renderItemList();
  host.appendChild(field('Items', itemListHost));
}

export function mountCarouselSlides(
  ctx: EditorContext,
  element: CarouselElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.slides)) element.slides = [];
  const slideListHost = document.createElement('div');

  function renderSlideList(): void {
    slideListHost.replaceChildren();
    for (let si = 0; si < element.slides.length; si++) {
      (function (idx: number) {
        const slide = element.slides[idx]!;
        const card = document.createElement('div');
        card.className = 'inspector-list-card';

        const thumbWrap = document.createElement('div');
        thumbWrap.style.cssText = 'margin-bottom:4px;';
        const thumb = ctx.buildPickerThumb(slide.assetId, slide.assetId, function () {});
        thumbWrap.appendChild(thumb);

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        const uploadBtn = document.createElement('button');
        uploadBtn.type = 'button';
        uploadBtn.textContent = 'Upload image';
        uploadBtn.addEventListener('click', function () {
          fileInput.value = '';
          fileInput.click();
        });
        fileInput.addEventListener('change', function () {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;
          ctx.setStatus('Uploading...');
          ctx.postAssetUpload(file, '', element.id).then(function (result) {
            slide.assetId = result.assetId;
            ctx.rebuildElement(element.id);
            ctx.scheduleSave();
            renderSlideList();
            ctx.setStatus('Uploaded', 'ok');
          }).catch(function (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            ctx.setStatus('Upload failed: ' + message, 'error');
          });
        });
        thumbWrap.appendChild(uploadBtn);
        thumbWrap.appendChild(fileInput);
        card.appendChild(thumbWrap);

        const captionInput = document.createElement('input');
        captionInput.type = 'text';
        captionInput.value = slide.caption || '';
        captionInput.placeholder = 'Caption';
        captionInput.addEventListener('change', function () {
          slide.caption = captionInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Caption', captionInput));

        const hrefInput = document.createElement('input');
        hrefInput.type = 'text';
        hrefInput.value = slide.href || '';
        hrefInput.placeholder = 'Link (optional)';
        hrefInput.addEventListener('change', function () {
          slide.href = hrefInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(field('Link', hrefInput));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'opencanvas-inspector-remove';
        removeBtn.textContent = '\\u00d7';
        removeBtn.title = 'Remove slide';
        removeBtn.setAttribute('aria-label', 'Remove slide');
        removeBtn.addEventListener('click', function () {
          element.slides.splice(idx, 1);
          renderSlideList();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        card.appendChild(removeBtn);

        slideListHost.appendChild(card);
      })(si);
    }

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'opencanvas-inspector-add';
    addBtn.textContent = 'Add slide';
    addBtn.addEventListener('click', function () {
      element.slides.push({ id: newElementId(), assetId: '__placeholder__', caption: '' });
      renderSlideList();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    slideListHost.appendChild(addBtn);
  }
  renderSlideList();
  host.appendChild(field('Slides', slideListHost));
}

export function mountTableGrid(
  ctx: EditorContext,
  element: TableElement,
  host: HTMLElement,
): void {
  if (!Array.isArray(element.columns)) element.columns = [];
  if (!Array.isArray(element.rows)) element.rows = [];
  const gridHost = document.createElement('div');

  function renderTableGrid(): void {
    gridHost.replaceChildren();
    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:11px;';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const cornerCell = document.createElement('th');
    cornerCell.textContent = '#';
    cornerCell.style.cssText = 'padding:2px 4px;border:1px solid var(--opencanvas-hairline);';
    headerRow.appendChild(cornerCell);

    for (let ci = 0; ci < element.columns.length; ci++) {
      (function (colIdx: number) {
        const col = element.columns[colIdx]!;
        const th = document.createElement('th');
        th.style.cssText = 'padding:2px;border:1px solid var(--opencanvas-hairline);';
        const headerInput = document.createElement('input');
        headerInput.type = 'text';
        headerInput.value = col.header;
        headerInput.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;';
        headerInput.addEventListener('change', function () {
          col.header = headerInput.value;
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        th.appendChild(headerInput);

        const rmColBtn = document.createElement('button');
        rmColBtn.type = 'button';
        rmColBtn.textContent = '\\u00d7';
        rmColBtn.title = 'Remove column';
        rmColBtn.setAttribute('aria-label', 'Remove column');
        rmColBtn.style.cssText = 'font-size:13px;line-height:1;padding:1px 5px;margin-left:2px;color:var(--ink-3);border:1px solid var(--line-2);border-radius:4px;background:transparent;cursor:pointer;';
        rmColBtn.addEventListener('click', function () {
          const removedId = element.columns[colIdx]!.id;
          element.columns.splice(colIdx, 1);
          for (let ri = 0; ri < element.rows.length; ri++) {
            if (element.rows[ri]!.cells && element.rows[ri]!.cells[removedId] !== undefined) {
              delete element.rows[ri]!.cells[removedId];
            }
          }
          renderTableGrid();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        th.appendChild(rmColBtn);
        headerRow.appendChild(th);
      })(ci);
    }

    const addColTh = document.createElement('th');
    addColTh.style.cssText = 'padding:2px;border:1px solid var(--opencanvas-hairline);';
    const addColBtn = document.createElement('button');
    addColBtn.type = 'button';
    addColBtn.textContent = '+ col';
    addColBtn.title = 'Add column';
    addColBtn.style.cssText = 'font-size:11px;padding:2px 8px;color:var(--ink-2);border:1px dashed var(--line-2);border-radius:4px;background:transparent;cursor:pointer;font-weight:650;';
    addColBtn.addEventListener('click', function () {
      const newColId = newElementId();
      element.columns.push({ id: newColId, header: 'Column ' + (element.columns.length + 1) });
      for (let ri = 0; ri < element.rows.length; ri++) {
        if (!element.rows[ri]!.cells) element.rows[ri]!.cells = {};
        element.rows[ri]!.cells[newColId] = '';
      }
      renderTableGrid();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    addColTh.appendChild(addColBtn);
    headerRow.appendChild(addColTh);
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let rowIdx = 0; rowIdx < element.rows.length; rowIdx++) {
      (function (ri: number) {
        const rowData = element.rows[ri]!;
        if (!rowData.cells) rowData.cells = {};
        const tr = document.createElement('tr');

        const numCell = document.createElement('td');
        numCell.textContent = String(ri + 1);
        numCell.style.cssText = 'padding:2px 4px;border:1px solid var(--opencanvas-hairline);text-align:center;color:var(--opencanvas-fg-faint);';
        tr.appendChild(numCell);

        for (let ci2 = 0; ci2 < element.columns.length; ci2++) {
          (function (colIdx2: number) {
            const colId = element.columns[colIdx2]!.id;
            const td = document.createElement('td');
            td.style.cssText = 'padding:1px;border:1px solid var(--opencanvas-hairline);';
            const cellInput = document.createElement('input');
            cellInput.type = 'text';
            cellInput.value = rowData.cells[colId] || '';
            cellInput.style.cssText = 'width:100%;box-sizing:border-box;font-size:11px;';
            cellInput.addEventListener('change', function () {
              rowData.cells[colId] = cellInput.value;
              ctx.rebuildElement(element.id);
              ctx.scheduleSave();
            });
            td.appendChild(cellInput);
            tr.appendChild(td);
          })(ci2);
        }

        const rmCell = document.createElement('td');
        rmCell.style.cssText = 'padding:2px;border:1px solid var(--opencanvas-hairline);';
        const rmRowBtn = document.createElement('button');
        rmRowBtn.type = 'button';
        rmRowBtn.textContent = '\\u00d7';
        rmRowBtn.title = 'Remove row';
        rmRowBtn.setAttribute('aria-label', 'Remove row');
        rmRowBtn.style.cssText = 'font-size:13px;line-height:1;padding:1px 5px;color:var(--ink-3);border:1px solid var(--line-2);border-radius:4px;background:transparent;cursor:pointer;';
        rmRowBtn.addEventListener('click', function () {
          element.rows.splice(ri, 1);
          renderTableGrid();
          ctx.rebuildElement(element.id);
          ctx.scheduleSave();
        });
        rmCell.appendChild(rmRowBtn);
        tr.appendChild(rmCell);
        tbody.appendChild(tr);
      })(rowIdx);
    }

    const addRowTr = document.createElement('tr');
    const addRowTd = document.createElement('td');
    addRowTd.colSpan = element.columns.length + 2;
    const addRowBtn = document.createElement('button');
    addRowBtn.type = 'button';
    addRowBtn.textContent = '+ row';
    addRowBtn.title = 'Add row';
    addRowBtn.style.cssText = 'font-size:11px;padding:3px 10px;color:var(--ink-2);border:1px dashed var(--line-2);border-radius:4px;background:transparent;cursor:pointer;font-weight:650;width:100%;';
    addRowBtn.addEventListener('click', function () {
      const cells: Record<string, string> = {};
      for (let ci3 = 0; ci3 < element.columns.length; ci3++) {
        cells[element.columns[ci3]!.id] = '';
      }
      element.rows.push({ id: newElementId(), cells: cells });
      renderTableGrid();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    addRowTd.appendChild(addRowBtn);
    addRowTr.appendChild(addRowTd);
    tbody.appendChild(addRowTr);
    table.appendChild(tbody);
    gridHost.appendChild(table);

    if (element.columns.length === 0 && element.rows.length === 0) {
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.7';
      hint.style.marginTop = '4px';
      hint.textContent = 'Add a column and a row to start.';
      gridHost.appendChild(hint);
    }
  }
  renderTableGrid();
  host.appendChild(field('Data', gridHost));
}
