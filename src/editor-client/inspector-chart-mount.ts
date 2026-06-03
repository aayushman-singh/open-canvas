// src/editor-client/inspector-chart-mount.ts
//
// ADR 0058 Phase 2h.2.e — chart inspector data-grid mount.
// canvas-client.ts:4287-4453 carries the inline twin; retires on Phase 3
// cutover. Behavioural parity assertion lives in src/editor/inspector-smoke.ts
// against the production inline path (no DOM in Bun, so this module skips
// its own parity smoke).
//
// One mount:
//   - mountChartData: the 2D series × categories data grid for ChartElement.
//     Top-level fields (kind, x/y axis titles, showLegend) are declarative
//     in the InspectorSpec (see src/canvas/elements/chart.ts), so this mount
//     handles only the imperative grid. Header row carries one editable
//     <input type="text"> per category plus a per-column remove button and
//     a trailing "+ cat" button. Body rows carry an editable label input,
//     one <input type="number" step="any"> per category cell, and a
//     trailing remove-series button. A final row holds "+ series".
//
// Behavioural invariants the inline twin pins (and this module must keep):
//   - Grid stays rectangular: every series.values array is padded with 0
//     or trimmed to cats.length on every renderGrid call.
//   - Adding a category pushes 0 into every existing series; removing a
//     category splices that index out of every series.
//   - Number-cell edits revert the input value when the parsed value is
//     non-finite (no silent NaN write into element.series).
//   - Empty-state hint appears only when both series.length === 0 and
//     cats.length === 0.

import type { EditorContext } from './editor-context.js';
import type { ChartElement } from '../canvas/elements/chart.js';

export function mountChartData(
  ctx: EditorContext,
  element: ChartElement,
  host: HTMLElement,
): void {
  const gridHost = document.createElement('div');
  gridHost.className = 'opencanvas-chart-grid-host';
  gridHost.style.marginTop = '8px';
  host.appendChild(gridHost);

  function renderGrid(): void {
    gridHost.replaceChildren();
    const series = Array.isArray(element.series) ? element.series : (element.series = []);
    const cats = Array.isArray(element.categories) ? element.categories : (element.categories = []);
    // Header row: blank + each category name.
    const table = document.createElement('table');
    table.className = 'opencanvas-chart-grid';
    table.style.borderCollapse = 'collapse';
    table.style.width = '100%';
    table.style.fontSize = '11px';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.style.textAlign = 'left';
    corner.style.padding = '4px';
    corner.textContent = 'Series \\ Category';
    headRow.appendChild(corner);
    for (let ci = 0; ci < cats.length; ci++) {
      const th = document.createElement('th');
      th.style.padding = '2px';
      const catInput = document.createElement('input');
      catInput.type = 'text';
      catInput.value = String(cats[ci]);
      catInput.style.width = '100%';
      catInput.style.minWidth = '60px';
      catInput.style.boxSizing = 'border-box';
      catInput.addEventListener('change', () => {
        cats[ci] = catInput.value;
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      th.appendChild(catInput);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'x';
      removeBtn.title = 'Remove this category';
      removeBtn.style.marginLeft = '2px';
      removeBtn.addEventListener('click', () => {
        cats.splice(ci, 1);
        for (let si = 0; si < series.length; si++) {
          if (Array.isArray(series[si]!.values)) series[si]!.values.splice(ci, 1);
        }
        renderGrid();
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      th.appendChild(removeBtn);
      headRow.appendChild(th);
    }
    // Trailing + column header for adding a category.
    const addCatTh = document.createElement('th');
    const addCatBtn = document.createElement('button');
    addCatBtn.type = 'button';
    addCatBtn.textContent = '+ cat';
    addCatBtn.addEventListener('click', () => {
      cats.push('Cat ' + (cats.length + 1));
      for (let si = 0; si < series.length; si++) {
        if (Array.isArray(series[si]!.values)) series[si]!.values.push(0);
      }
      renderGrid();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    addCatTh.appendChild(addCatBtn);
    headRow.appendChild(addCatTh);
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let si = 0; si < series.length; si++) {
      const row = document.createElement('tr');
      const labelTd = document.createElement('td');
      labelTd.style.padding = '2px';
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = String(series[si]!.label);
      labelInput.style.width = '100%';
      labelInput.style.minWidth = '80px';
      labelInput.style.boxSizing = 'border-box';
      labelInput.addEventListener('change', () => {
        series[si]!.label = labelInput.value;
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      labelTd.appendChild(labelInput);
      row.appendChild(labelTd);
      if (!Array.isArray(series[si]!.values)) series[si]!.values = [];
      // Pad / trim values to category count so the grid is rectangular.
      while (series[si]!.values.length < cats.length) series[si]!.values.push(0);
      if (series[si]!.values.length > cats.length) series[si]!.values.length = cats.length;
      for (let ci = 0; ci < cats.length; ci++) {
        const td = document.createElement('td');
        td.style.padding = '2px';
        const num = document.createElement('input');
        num.type = 'number';
        num.step = 'any';
        num.style.width = '100%';
        num.style.minWidth = '60px';
        num.style.boxSizing = 'border-box';
        num.value = String(series[si]!.values[ci]);
        num.addEventListener('change', () => {
          const n = Number(num.value);
          if (Number.isFinite(n)) {
            series[si]!.values[ci] = n;
            ctx.rebuildElement(element.id);
            ctx.scheduleSave();
          } else {
            num.value = String(series[si]!.values[ci]);
          }
        });
        td.appendChild(num);
        row.appendChild(td);
      }
      // Trailing cell — remove-series button.
      const removeTd = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'x';
      removeBtn.title = 'Remove this series';
      removeBtn.addEventListener('click', () => {
        series.splice(si, 1);
        renderGrid();
        ctx.rebuildElement(element.id);
        ctx.scheduleSave();
      });
      removeTd.appendChild(removeBtn);
      row.appendChild(removeTd);
      tbody.appendChild(row);
    }
    // Add-series row.
    const addRow = document.createElement('tr');
    const addCell = document.createElement('td');
    addCell.colSpan = cats.length + 2;
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ series';
    addBtn.addEventListener('click', () => {
      const newValues: number[] = [];
      for (let i = 0; i < cats.length; i++) newValues.push(0);
      series.push({ label: 'Series ' + (series.length + 1), values: newValues });
      renderGrid();
      ctx.rebuildElement(element.id);
      ctx.scheduleSave();
    });
    addCell.appendChild(addBtn);
    addRow.appendChild(addCell);
    tbody.appendChild(addRow);
    table.appendChild(tbody);
    gridHost.appendChild(table);

    if (series.length === 0 && cats.length === 0) {
      const hint = document.createElement('div');
      hint.style.fontSize = '11px';
      hint.style.opacity = '0.7';
      hint.style.marginTop = '4px';
      hint.textContent = 'Add a category and a series to start.';
      gridHost.appendChild(hint);
    }
  }
  renderGrid();
}
