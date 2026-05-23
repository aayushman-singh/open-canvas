// src/canvas/elements/table-smoke.ts
//
// Wave 4 #18 smoke. Asserts the TableElement renderer against the brief's
// contract:
//
//   1. 3x3 table -> HTML contains `<table>`, 3 `<th>`, 4 `<tr>`
//      (1 header + 3 body), 9 `<td>`.
//   2. `zebra: true` -> CSS includes `tbody tr:nth-child(2n+1)` styling.
//   3. Phone breakpoint output has `display: block` and `data-label="<header>"`
//      attributes on cells.
//   4. Per-column alignment renders `text-align` correctly.
//   5. Empty table (no rows / no columns) renders without crashing.
//
// Run with `bun.cmd run table:smoke`. Exits non-zero on assertion failure so
// the wishlist:smoke runner short-circuits.

import { renderTable, type TableElement } from './table.js';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    process.stderr.write(`[table:smoke] FAIL - ${message}\n`);
    process.exit(1);
  }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

function baseTable(): Omit<TableElement, 'columns' | 'rows' | 'zebra' | 'collapseOnPhone'> {
  return {
    id: 'table-smoke',
    type: 'table',
    box: { x: 0, y: 0, w: 600, h: 200, z: 1 },
  };
}

// --- Assertion 1: 3x3 table shape ------------------------------------------
{
  const el: TableElement = {
    ...baseTable(),
    columns: [
      { id: 'c1', header: 'Name' },
      { id: 'c2', header: 'Role' },
      { id: 'c3', header: 'Office' },
    ],
    rows: [
      { id: 'r1', cells: { c1: 'Ada', c2: 'Engineer', c3: 'London' } },
      { id: 'r2', cells: { c1: 'Linus', c2: 'Maintainer', c3: 'Portland' } },
      { id: 'r3', cells: { c1: 'Grace', c2: 'Admiral', c3: 'New York' } },
    ],
    zebra: false,
    collapseOnPhone: false,
  };
  const html = renderTable(el, { styleKit: 'charcoal' });
  assert(html.includes('<table'), '3x3: expected <table tag in HTML');
  assert(html.includes('<thead>'), '3x3: expected <thead> in HTML');
  assert(html.includes('<tbody>'), '3x3: expected <tbody> in HTML');
  const thCount = countOccurrences(html, '<th ');
  assert(thCount === 3, `3x3: expected 3 <th>, got ${String(thCount)}`);
  const trCount = countOccurrences(html, '<tr>');
  assert(trCount === 4, `3x3: expected 4 <tr> (1 header + 3 body), got ${String(trCount)}`);
  const tdCount = countOccurrences(html, '<td ');
  assert(tdCount === 9, `3x3: expected 9 <td>, got ${String(tdCount)}`);
  // Header text must appear.
  assert(html.includes('Name'), '3x3: expected "Name" header in HTML');
  assert(html.includes('Engineer'), '3x3: expected "Engineer" cell value in HTML');
}

// --- Assertion 2: zebra mode emits nth-child rule --------------------------
{
  const el: TableElement = {
    ...baseTable(),
    id: 'table-zebra',
    columns: [
      { id: 'a', header: 'A' },
      { id: 'b', header: 'B' },
    ],
    rows: [
      { id: 'r1', cells: { a: '1', b: '2' } },
      { id: 'r2', cells: { a: '3', b: '4' } },
    ],
    zebra: true,
    collapseOnPhone: false,
  };
  const html = renderTable(el, { styleKit: 'charcoal' });
  assert(
    html.includes('tbody tr:nth-child(2n+1)'),
    'zebra: expected CSS rule "tbody tr:nth-child(2n+1)" in HTML',
  );
  // Wrapper carries the marker too so downstream consumers can detect zebra
  // mode without parsing CSS.
  assert(
    html.includes('data-rev01-zebra="true"'),
    'zebra: expected data-rev01-zebra="true" on the <table>',
  );

  // Cross-check: a table with zebra=false MUST NOT emit the nth-child rule.
  const elNo: TableElement = { ...el, id: 'table-no-zebra', zebra: false };
  const htmlNo = renderTable(elNo, { styleKit: 'charcoal' });
  assert(
    !htmlNo.includes('tbody tr:nth-child(2n+1)'),
    'zebra: expected NO nth-child rule when zebra=false',
  );
  assert(
    htmlNo.includes('data-rev01-zebra="false"'),
    'zebra: expected data-rev01-zebra="false" on a non-zebra table',
  );
}

// --- Assertion 3: phone breakpoint emits display:block + data-label --------
{
  const el: TableElement = {
    ...baseTable(),
    id: 'table-phone',
    columns: [
      { id: 'n', header: 'Name' },
      { id: 'r', header: 'Role' },
    ],
    rows: [{ id: 'r1', cells: { n: 'Ada', r: 'Engineer' } }],
    zebra: false,
    collapseOnPhone: true,
  };
  const html = renderTable(el, { styleKit: 'charcoal' });
  // Phone media query present.
  assert(
    html.includes('@media (max-width: 767px)'),
    'phone: expected @media (max-width: 767px) wrapper',
  );
  // display: block on the table family.
  assert(html.includes('display: block;'), 'phone: expected "display: block" inside the @media');
  // data-label attribute on every <td>.
  assert(
    html.includes('data-label="Name"'),
    'phone: expected data-label="Name" on the first column <td>',
  );
  assert(
    html.includes('data-label="Role"'),
    'phone: expected data-label="Role" on the second column <td>',
  );
  // ::before content rule that projects the label.
  assert(
    html.includes('content: attr(data-label)'),
    'phone: expected "content: attr(data-label)" CSS rule',
  );

  // collapseOnPhone=false suppresses the media block but still keeps
  // `data-label` on the cells (cheap, useful for consumers).
  const elNo: TableElement = { ...el, id: 'table-no-phone', collapseOnPhone: false };
  const htmlNo = renderTable(elNo, { styleKit: 'charcoal' });
  assert(
    !htmlNo.includes('@media (max-width: 767px)'),
    'phone: expected NO @media block when collapseOnPhone=false',
  );
  assert(
    htmlNo.includes('data-label="Name"'),
    'phone: data-label attributes stay on cells even when collapseOnPhone=false (cheap, useful)',
  );
}

// --- Assertion 4: per-column alignment ------------------------------------
{
  const el: TableElement = {
    ...baseTable(),
    id: 'table-align',
    columns: [
      { id: 'a', header: 'A' }, // default = left, no rule emitted
      { id: 'b', header: 'B', align: 'center' },
      { id: 'c', header: 'C', align: 'right' },
    ],
    rows: [{ id: 'r1', cells: { a: '1', b: '2', c: '3' } }],
    zebra: false,
    collapseOnPhone: false,
  };
  const html = renderTable(el, { styleKit: 'charcoal' });
  // Column 2 = center; the rule targets nth-child(2).
  assert(
    html.includes('th:nth-child(2)') && html.includes('text-align: center'),
    'align: expected "th:nth-child(2) { text-align: center }" for the centered column',
  );
  // Column 3 = right.
  assert(
    html.includes('th:nth-child(3)') && html.includes('text-align: right'),
    'align: expected "th:nth-child(3) { text-align: right }" for the right-aligned column',
  );
  // Column 1 is default-left -> no extra nth-child rule for it.
  assert(
    !html.includes('th:nth-child(1)'),
    'align: expected NO th:nth-child(1) rule for a default-left column',
  );
}

// --- Assertion 5: empty table renders without crashing --------------------
{
  // Truly empty: no columns, no rows.
  const el: TableElement = {
    ...baseTable(),
    id: 'table-empty',
    columns: [],
    rows: [],
    zebra: false,
    collapseOnPhone: false,
  };
  let html = '';
  try {
    html = renderTable(el, { styleKit: 'charcoal' });
  } catch (err) {
    assert(false, `empty: renderTable threw - ${String(err)}`);
  }
  assert(html.length > 0, 'empty: renderTable returned an empty string');
  assert(html.includes('<table'), 'empty: expected <table> tag even with no rows / cols');
  // No header row when there are no columns.
  assert(!html.includes('<thead>'), 'empty: expected no <thead> when columns are empty');
  // <tbody> is emitted (so the DOM is structurally stable) but is empty.
  assert(html.includes('<tbody></tbody>'), 'empty: expected an empty <tbody></tbody>');
  // No spurious cells.
  assert(countOccurrences(html, '<th ') === 0, 'empty: expected zero <th>');
  assert(countOccurrences(html, '<td ') === 0, 'empty: expected zero <td>');

  // Columns present, but zero rows -> header but empty body.
  const elCols: TableElement = {
    ...baseTable(),
    id: 'table-cols-no-rows',
    columns: [{ id: 'c1', header: 'Solo' }],
    rows: [],
    zebra: false,
    collapseOnPhone: false,
  };
  const htmlCols = renderTable(elCols, { styleKit: 'charcoal' });
  assert(htmlCols.includes('<thead>'), 'cols-no-rows: expected <thead> when columns present');
  assert(
    htmlCols.includes('<tbody></tbody>'),
    'cols-no-rows: expected empty <tbody> when zero rows',
  );

  // Rows present, but zero columns -> header empty, body has empty rows.
  const elRows: TableElement = {
    ...baseTable(),
    id: 'table-rows-no-cols',
    columns: [],
    rows: [{ id: 'r1', cells: {} }],
    zebra: false,
    collapseOnPhone: false,
  };
  const htmlRows = renderTable(elRows, { styleKit: 'charcoal' });
  assert(
    !htmlRows.includes('<thead>'),
    'rows-no-cols: expected no <thead> when columns are empty',
  );
  // Row exists but has zero <td>s because no columns drive cell emission.
  const trCount = countOccurrences(htmlRows, '<tr>');
  assert(trCount === 1, `rows-no-cols: expected 1 <tr> in body, got ${String(trCount)}`);
  assert(
    countOccurrences(htmlRows, '<td ') === 0,
    'rows-no-cols: expected zero <td> when no columns drive cells',
  );
}

// --- Extra sanity: HTML escaping of user-controlled strings ---------------
{
  const el: TableElement = {
    ...baseTable(),
    id: 'table-escape',
    columns: [{ id: 'c', header: '<Header>' }],
    rows: [{ id: 'r', cells: { c: '<script>x</script>' } }],
    zebra: false,
    collapseOnPhone: true,
  };
  const html = renderTable(el, { styleKit: 'charcoal' });
  assert(html.includes('&lt;Header&gt;'), 'escape: expected escaped header in <th>');
  assert(
    html.includes('&lt;script&gt;x&lt;/script&gt;'),
    'escape: expected escaped cell value in <td>',
  );
  // data-label attribute escapes quotes / brackets.
  assert(
    html.includes('data-label="&lt;Header&gt;"'),
    'escape: expected escaped header inside data-label attribute',
  );
  assert(
    !html.includes('<script>'),
    'escape: raw <script> must never appear in rendered HTML',
  );
}

process.stdout.write(
  '[table:smoke] OK - 5 assertions passed (3x3 shape, zebra, phone collapse, alignment, empty)\n',
);
