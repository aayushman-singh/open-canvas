// src/editor-client/regression.smoke.ts
//
// Focused source guards for Phase 3 regressions that used to be covered by
// the monolithic review smoke while the inline IIFE was production code.

declare const Bun: {
  file(input: URL): {
    text(): Promise<string>;
  };
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`[editor-client-regression:smoke] ${message}`);
}

async function source(name: string): Promise<string> {
  // Bun.file is the canonical file-read in this directory's smokes (the
  // editor-client tsconfig excludes node types so node:fs/promises is not
  // in scope). Same shape as the other smokes in this folder.
  return Bun.file(new URL(name, import.meta.url)).text();
}

const bodyBuilders = await source('./body-builders-basic.ts');
assert(
  bodyBuilders.includes('if (element.behavior !== undefined)'),
  'action body builder must branch on behavior before resolving href',
);
assert(
  bodyBuilders.includes("button.setAttribute('data-opencanvas-copy', element.behavior.value)"),
  'copy behavior actions must render the copy payload data attribute',
);
assert(
  bodyBuilders.includes('resolveActionHrefLocal(ctx, element.href)'),
  'href actions must still resolve external/page hrefs through the local resolver',
);
assert(
  bodyBuilders.includes("throw new Error('resolveActionHref: missing page id '"),
  'page href resolver must throw loudly when the referenced page is missing',
);

const flushBeforeServerFiles = [
  ['./ai-preview-panel.ts', "ctx.apiBase + '/canvas-agent/sites/'"],
  ['./publish.ts', "ctx.apiBase + '/publish/sites/'"],
  ['./sections-picker.ts', "ctx.apiBase + '/sites/' + ctx.siteId + '/sections/import'"],
  ['./section-toolbar.ts', "ctx.apiBase + '/library/sections'"],
  ['./section-toolbar.ts', "ctx.apiBase + '/custom-templates'"],
  ['./sidebar.ts', "ctx.siteBase + '/style-kit'"],
] as const;

for (const [file, serverNeedle] of flushBeforeServerFiles) {
  const text = await source(file);
  const flushIndex = text.indexOf('const saved = await ctx.flushPendingSave();');
  const notSavedIndex = text.indexOf('!saved', flushIndex);
  const serverIndex = text.indexOf(serverNeedle);
  assert(flushIndex >= 0, `${file} must await ctx.flushPendingSave before server mutation`);
  assert(serverIndex >= 0, `${file} must contain server mutation ${serverNeedle}`);
  assert(flushIndex < serverIndex, `${file} must flush pending saves before server mutation`);
  assert(
    notSavedIndex > flushIndex && notSavedIndex < serverIndex,
    `${file} must stop when flushPendingSave fails before server mutation`,
  );
}

// Site-pinned sections (header/footer) render one DOM wrapper per
// artboard but share a single section/element id. selectSection and
// selectElement must querySelectorAll + loop so the data-selected
// highlight reflects on every page, not just the first DOM match.
// Regression: pre-fix code used querySelector singular, leaving Page B's
// footer un-highlighted and Page A's stale.
const selection = await source('./selection.ts');
assert(
  !/ctx\.root\?\.querySelector\(\s*['"]\[data-opencanvas-(section|element)=/.test(selection),
  'selection.ts must NOT use singular querySelector for data-opencanvas-section/element — repeated site-pinned wrappers need querySelectorAll',
);
assert(
  (selection.match(/ctx\.root\?\.querySelectorAll\(\s*['"]\[data-opencanvas-(section|element)=/g) || []).length >= 4,
  'selection.ts must querySelectorAll all four section/element add+remove paths',
);

// setActivePage clears selection — must route through selectElement/
// selectSection so the DOM data-selected attribute is scrubbed on every
// artboard, not just nulled in the model.
const pageCrud = await source('./page-crud.ts');
assert(
  /ctx\.selectElement\(null\)/.test(pageCrud) && /ctx\.selectSection\(null\)/.test(pageCrud),
  'page-crud setActivePageImpl must clear selection via selectElement(null)+selectSection(null) so DOM data-selected is scrubbed on page switch',
);
assert(
  !/ctx\.selectedSectionId\s*=\s*null/.test(pageCrud),
  'page-crud must NOT null ctx.selectedSectionId directly — routes around the DOM cleanup',
);
assert(
  !/ctx\.selectedElementId\s*=\s*null/.test(pageCrud),
  'page-crud must NOT null ctx.selectedElementId directly — routes around the DOM cleanup',
);

const linkPopover = await source('./link-popover.ts');
assert(
  linkPopover.includes("window.open(href, '_blank', 'noopener,noreferrer')"),
  'link popover Open must use noopener,noreferrer',
);
assert(
  linkPopover.includes("anchorEl.setAttribute('rel', 'noopener noreferrer')"),
  'inline link edit must set rel when target=_blank',
);
assert(
  linkPopover.includes("anchorEl.removeAttribute('rel')"),
  'inline link edit must remove stale rel when target is no longer blank',
);
assert(
  linkPopover.includes('focusAfterClose: closestEditableRoot(anchorEl)'),
  'inline link edit must restore focus to the editable root after modal close',
);

// Drag/resize clamp regression: the nested-frame (tab panel, collection
// card) branch must convert the screen-space getBoundingClientRect to
// world coords by dividing by ctx.camera.zoom — NOT by reading a scale
// off the section's own transform, which is translate-only and would
// always return 1, collapsing the clamp to camera.zoom × world-size and
// trapping dragged elements in the top-left quadrant of the panel at any
// zoom < 1.
const dragResize = await source('./drag-resize.ts');
assert(
  !/function\s+wrapperScale\s*\(/.test(dragResize),
  'drag-resize must NOT reintroduce wrapperScale — section transforms are translate-only and the function always returned 1; use ctx.camera.zoom for the world-coord conversion',
);
assert(
  !/WRAPPER_MATRIX_RE/.test(dragResize),
  'drag-resize must NOT reintroduce WRAPPER_MATRIX_RE — the section-transform parse it served is dead code; ctx.camera.zoom replaces it',
);
assert(
  /boundW\s*=\s*rect\.width\s*\/\s*zoom/.test(dragResize) &&
    /boundH\s*=\s*rect\.height\s*\/\s*zoom/.test(dragResize),
  'beginDragImpl nested-frame clamp must divide rect.width/height by the canvas zoom to recover world coords',
);
assert(
  /pageWidth\s*=\s*rect\.width\s*\/\s*zoom/.test(dragResize) &&
    /sectionHeight\s*=\s*rect\.height\s*\/\s*zoom/.test(dragResize),
  'beginResizeImpl nested-frame clamp must divide rect.width/height by the canvas zoom to recover world coords',
);
assert(
  /ctx\.camera\.zoom\s*>\s*0\s*\?\s*ctx\.camera\.zoom\s*:\s*1/.test(dragResize),
  'drag-resize must guard ctx.camera.zoom > 0 before dividing — a stale 0 would NaN-poison the clamp',
);

console.log('[editor-client-regression:smoke] OK');
