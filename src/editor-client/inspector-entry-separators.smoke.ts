// src/editor-client/inspector-entry-separators.smoke.ts
//
// Regression smoke for the repeated-entry inspector visual separation.
//
// Bug: before this commit, every repeated-entry inspector list (carousel
// slides, accordion items, form fields, nav links) emitted its per-entry
// rows as a flat sequence of `.field` divs wrapped in `.inspector-list-card`
// with no visible per-entry heading and no accent divider. Reading the
// slides for a carousel showed
//   Upload image | Caption | Link | × | Upload image | Caption | Link | ×
// repeated with no breaks — owners couldn't tell where slide 1 ended.
//
// Fix: every list mount wraps each entry in a `<div class="opencanvas-
// inspector-entry">` via the shared `createInspectorEntry(label, removeBtn?)`
// helper. The wrapper renders an accent-red header ("SLIDE 1", "ITEM 2",
// "FIELD 3", "LINK 4") with the remove button slotted right-aligned, and
// the `.opencanvas-inspector-entry + .opencanvas-inspector-entry` adjacent-
// sibling CSS rule paints a 2px var(--red) divider between entries.
//
// The project ships without a DOM library (happy-dom / jsdom), so this
// smoke runs source-level grep checks:
//   1. createInspectorEntry is exported from inspector-leaf-builders.ts.
//   2. Every list mount imports it and wraps entries with a per-entry
//      label ("Item " + (idx + 1), "Slide " + (idx + 1), etc.).
//   3. Both stylesheet twins (styles.css + styles-build.ts) carry the
//      .opencanvas-inspector-entry rules with var(--red) for the divider
//      and header label colour.
//
// Wired into ci:smoke (package.json: inspector-entry-separators:smoke).

declare const Bun: {
  file(input: URL): { text(): Promise<string> };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[inspector-entry-separators:smoke] ${message}`);
}

// ---- 1. Helper export -------------------------------------------------

const leafBuildersSrc = await Bun.file(
  new URL('./inspector-leaf-builders.ts', import.meta.url),
).text();

assert(
  leafBuildersSrc.includes('export function createInspectorEntry('),
  'inspector-leaf-builders.ts must export createInspectorEntry',
);
assert(
  leafBuildersSrc.includes("entry.className = 'opencanvas-inspector-entry';"),
  'createInspectorEntry must apply class opencanvas-inspector-entry to the wrapper',
);
assert(
  leafBuildersSrc.includes("header.className = 'opencanvas-inspector-entry-header';"),
  'createInspectorEntry must build a header div with class opencanvas-inspector-entry-header',
);
assert(
  leafBuildersSrc.includes(
    "labelSpan.className = 'opencanvas-inspector-entry-header-label';",
  ),
  'createInspectorEntry must build a label span with class opencanvas-inspector-entry-header-label',
);
assert(
  leafBuildersSrc.includes("throw new Error('createInspectorEntry: label must be a non-empty string')"),
  'createInspectorEntry must fail loudly on empty label (per CLAUDE.md no-fallback stance)',
);

// ---- 2. Every list mount uses the helper -------------------------------

const contentMountsSrc = await Bun.file(
  new URL('./inspector-content-mounts.ts', import.meta.url),
).text();

assert(
  contentMountsSrc.includes(
    "import { createInspectorEntry } from './inspector-leaf-builders.js';",
  ),
  'inspector-content-mounts.ts must import createInspectorEntry',
);
assert(
  contentMountsSrc.includes("createInspectorEntry('Item ' + (idx + 1), removeBtn)"),
  'mountAccordionItems must wrap each item with createInspectorEntry("Item N", removeBtn)',
);
assert(
  contentMountsSrc.includes("createInspectorEntry('Slide ' + (idx + 1), removeBtn)"),
  'mountCarouselSlides must wrap each slide with createInspectorEntry("Slide N", removeBtn)',
);

const formMountsSrc = await Bun.file(
  new URL('./inspector-form-mounts.ts', import.meta.url),
).text();

assert(
  formMountsSrc.includes(
    "import { buildColorRow, createInspectorEntry } from './inspector-leaf-builders.js';",
  ),
  'inspector-form-mounts.ts must import createInspectorEntry alongside buildColorRow',
);
assert(
  formMountsSrc.includes("createInspectorEntry('Field ' + (idx + 1), removeBtn)"),
  'mountFormFields must wrap each field with createInspectorEntry("Field N", removeBtn)',
);

const navMountsSrc = await Bun.file(
  new URL('./inspector-nav-media-picker-mounts.ts', import.meta.url),
).text();

assert(
  navMountsSrc.includes(
    "import { createInspectorEntry } from './inspector-leaf-builders.js';",
  ),
  'inspector-nav-media-picker-mounts.ts must import createInspectorEntry',
);
assert(
  navMountsSrc.includes("createInspectorEntry('Link ' + (idx + 1), removeBtn)"),
  'mountNavLinks must wrap each link with createInspectorEntry("Link N", removeBtn)',
);

// ---- 3. The four list mounts must no longer use the old card pattern.
// The single-card mountNavPrimaryAction (one optional card, not a list) is
// allowed to keep `.inspector-list-card`. To prove the four list mounts
// switched, count the remaining occurrences and assert each file matches
// expectations.

function countOccurrences(src: string, needle: string): number {
  let n = 0;
  let i = 0;
  while ((i = src.indexOf(needle, i)) >= 0) {
    n++;
    i += needle.length;
  }
  return n;
}

assert(
  countOccurrences(contentMountsSrc, "card.className = 'inspector-list-card';") === 0,
  'inspector-content-mounts.ts must not use inspector-list-card anymore — every list entry wraps via createInspectorEntry',
);
assert(
  countOccurrences(formMountsSrc, "card.className = 'inspector-list-card';") === 0,
  'inspector-form-mounts.ts must not use inspector-list-card anymore — every field wraps via createInspectorEntry',
);
// nav-media-picker still has ONE inspector-list-card in mountNavPrimaryAction
// (a single optional card, not a list). It's intentionally not converted.
assert(
  countOccurrences(navMountsSrc, "card.className = 'inspector-list-card';") === 1,
  'inspector-nav-media-picker-mounts.ts must have exactly one inspector-list-card left (mountNavPrimaryAction — single optional card, not a list)',
);

// ---- 4. CSS twins carry the accent-red divider + header rules ----------

const stylesCssSrc = await Bun.file(new URL('./styles.css', import.meta.url)).text();
const stylesBuildSrc = await Bun.file(new URL('./styles-build.ts', import.meta.url)).text();

function assertStylesheetCarries(sheet: string, sheetName: string): void {
  assert(
    sheet.includes('#canvas-inspector .opencanvas-inspector-entry {'),
    sheetName + ' must define the .opencanvas-inspector-entry wrapper rule',
  );
  assert(
    sheet.includes(
      '#canvas-inspector .opencanvas-inspector-entry + .opencanvas-inspector-entry {',
    ) && sheet.includes('border-top: 2px solid var(--red);'),
    sheetName + ' must paint a 2px var(--red) divider between adjacent entries',
  );
  assert(
    sheet.includes('#canvas-inspector .opencanvas-inspector-entry-header {') &&
      sheet.includes('color: var(--red);'),
    sheetName + ' must colour the entry header with var(--red)',
  );
  assert(
    sheet.includes('#canvas-inspector .opencanvas-inspector-entry-header-label::before {') &&
      sheet.includes('background: var(--red);'),
    sheetName + ' must render an accent dot (::before) with var(--red) background on the header label',
  );
}

assertStylesheetCarries(stylesCssSrc, 'styles.css');
assertStylesheetCarries(stylesBuildSrc, 'styles-build.ts');

console.log('[inspector-entry-separators:smoke] OK');
