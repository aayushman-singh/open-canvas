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
  bodyBuilders.includes("import { renderInlineRun } from '../canvas/elements/render-utils.js';") &&
    bodyBuilders.includes("import { renderIconSvg, isIconName } from '../canvas/icons.js';") &&
    bodyBuilders.includes('element.label.map(renderInlineRun).join') &&
    bodyBuilders.includes('node.innerHTML = iconHtml + labelHtml'),
  'action body builder must render iconKind plus rich InlineRun label HTML instead of flattening label text',
);
// Icon-only contract: when every label run has empty text, the builder
// must skip the label container so the editor preview matches the
// deployed renderer (no stray `<span></span>` consuming the flex gap).
assert(
  bodyBuilders.includes('const labelPlain = element.label.map((run) => run.text).join') &&
    bodyBuilders.includes("labelPlain.length === 0 ? '' :"),
  'action body builder must skip the label container when every run has empty text (icon-only affordance)',
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
  (
    selection.match(
      /ctx\.root\?\.querySelectorAll\(\s*['"]\[data-opencanvas-(section|element)=/g,
    ) || []
  ).length >= 4,
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

// ---------------------------------------------------------------------------
// ctx.apiBase dual-mount contract (GitHub issue #38).
//
// Convention: every URL the editor builds from `ctx.apiBase` MUST be reachable
// on BOTH the dashboard's `/api/*` mount (Clerk session auth) AND the on-site
// editor's `/__api/*` mount (edit-token auth). The two prefixes are auth-mode
// gates only; the handler surface behind them is the same `ownerApi` sub-app
// (see src/routes/api/owner-app.ts).
//
// The recurring regression class this pins (codex findings C2-C5) is:
// a route handler that the editor consumes via ctx.apiBase gets moved OUT of
// `ownerApi` and mounted directly under `/api/*` in src/index.ts. The
// dashboard keeps working; the on-site editor 404s silently because the
// handler is no longer reachable under `/__api/*`. C2 = snapshots, C3 = fonts,
// C4 = embed-expand, C5 = page-inspector entries URL — all `ctx.apiBase`
// consumers whose paths weren't mounted symmetrically.
//
// This assertion stack is source-text introspection (the existing smoke
// style — no live Hono boot in this folder). It walks two contracts:
//
//   1. src/index.ts must mount `ownerApi` on BOTH `/api` and `/__api`. If
//      either prefix is dropped, every URL family below silently breaks.
//
//   2. For each `ctx.apiBase`-derived URL family the editor builds, the
//      relevant editor source still produces that path AND
//      src/routes/api/owner-app.ts mounts a sub-app whose prefix covers it.
//      Both halves matter: an editor typo and a missing ownerApi mount are
//      both 404s, and both must fail this smoke loudly with the offending
//      path named in the message.
// ---------------------------------------------------------------------------

const indexSrc = await Bun.file(new URL('../index.ts', import.meta.url)).text();
assert(
  /app\.route\(\s*['"]\/api['"]\s*,\s*ownerApi\s*\)/.test(indexSrc),
  "src/index.ts must mount ownerApi at '/api' — drop this and the dashboard surface dies",
);
assert(
  /app\.route\(\s*['"]\/__api['"]\s*,\s*ownerApi\s*\)/.test(indexSrc),
  "src/index.ts must mount ownerApi at '/__api' — drop this and the on-site editor 404s on every ctx.apiBase URL",
);

const ownerAppSrc = await Bun.file(
  new URL('../routes/api/owner-app.ts', import.meta.url),
).text();

// Each entry: { family, editorFile, editorNeedle, ownerMountRe, ownerMountLabel }.
// `editorNeedle` is a substring grep against the editor source — it confirms
// the editor still BUILDS that URL family from ctx.apiBase (catches the
// editor-side leg of the contract: the editor stopped using ctx.apiBase, or
// the path changed without updating the mount). `ownerMountRe` confirms
// `ownerApi.route(<prefix>, ...)` is still present (catches the server-side
// leg: the route got moved out of ownerApi).
const apiBaseRouteContracts: ReadonlyArray<{
  family: string;
  editorFile: string;
  editorNeedle: string;
  ownerMountRe: RegExp;
  ownerMountLabel: string;
}> = [
  {
    family: 'GET/PUT /canvas/sites/:siteId (editor siteBase)',
    editorFile: './index.ts',
    editorNeedle: "boot.apiBase + '/canvas/sites/' + boot.siteId",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/canvas['"]\s*,\s*canvasApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/canvas', canvasApi)",
  },
  {
    family: 'POST /canvas-agent/sites/:siteId/apply (AI apply)',
    editorFile: './ai-integration.ts',
    editorNeedle: "ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/apply'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/canvas-agent['"]\s*,\s*canvasAgentApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/canvas-agent', canvasAgentApi)",
  },
  {
    family: 'POST /canvas-agent/sites/:siteId/preview (AI preview)',
    editorFile: './ai-preview-panel.ts',
    editorNeedle: "ctx.apiBase + '/canvas-agent/sites/' + ctx.siteId + '/preview'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/canvas-agent['"]\s*,\s*canvasAgentApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/canvas-agent', canvasAgentApi)",
  },
  {
    family: 'POST /publish/sites/:siteId (publish)',
    editorFile: './publish.ts',
    editorNeedle: "ctx.apiBase + '/publish/sites/' + ctx.siteId",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/publish['"]\s*,\s*publishApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/publish', publishApi)",
  },
  {
    family: 'GET/POST/DELETE /owner/assets (asset library)',
    editorFile: './runtime-helpers.ts',
    editorNeedle: "ctx.apiBase + '/owner/assets'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/owner\/assets['"]\s*,\s*ownerAssetsApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/owner/assets', ownerAssetsApi)",
  },
  {
    family: 'GET /sites/:siteId/elements/:elementId/history (slot history)',
    editorFile: './runtime-helpers.ts',
    editorNeedle: "ctx.apiBase +\n          '/sites/' +\n          encodeURIComponent(ctx.siteId) +\n          '/elements/'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/['"]\s*,\s*slotHistoryApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/', slotHistoryApi)",
  },
  {
    family: 'POST /sites/:siteId/sections/import (section import)',
    editorFile: './sections-picker.ts',
    editorNeedle: "ctx.apiBase + '/sites/' + ctx.siteId + '/sections/import'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/['"]\s*,\s*sectionsApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/', sectionsApi)",
  },
  {
    family: 'GET/POST/PUT/DELETE /library/sections (library)',
    editorFile: './section-toolbar.ts',
    editorNeedle: "ctx.apiBase + '/library/sections'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/library['"]\s*,\s*librarySectionsOwner\s*\)/,
    ownerMountLabel: "ownerApi.route('/library', librarySectionsOwner)",
  },
  {
    family: 'GET/POST/DELETE /custom-templates (custom templates)',
    editorFile: './section-toolbar.ts',
    editorNeedle: "ctx.apiBase + '/custom-templates'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/custom-templates['"]\s*,\s*customTemplatesOwner\s*\)/,
    ownerMountLabel: "ownerApi.route('/custom-templates', customTemplatesOwner)",
  },
  {
    family: 'GET /notifications, POST /notifications/:id/read, etc.',
    editorFile: '../index.ts',
    // Notifications has no ctx.apiBase callsite in editor-client; the dashboard
    // shell consumes it. Pin the ownerApi mount alone so the contract still
    // breaks loudly if anyone moves `notificationsApi` out from under both
    // /api/* and /__api/*.
    editorNeedle: 'notifications',
    ownerMountRe: /ownerApi\.route\(\s*['"]\/['"]\s*,\s*notificationsApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/', notificationsApi)",
  },
  {
    family: 'POST /sites/:siteId/chat (chat command surface)',
    editorFile: './chat-session.ts',
    editorNeedle: "ctx.apiBase + '/sites/' + ctx.siteId + '/chat'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/sites['"]\s*,\s*chatApi\s*\)/,
    ownerMountLabel: "ownerApi.route('/sites', chatApi)",
  },
  {
    family: 'GET /sites/:siteId/entries (page-inspector collection preview, C5)',
    editorFile: './page-inspector.ts',
    editorNeedle: "ctx.apiBase +\n    '/sites/' +\n    encodeURIComponent(ctx.siteId) +\n    '/entries?collection='",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/sites\/:siteId\/entries['"]\s*,\s*entriesRoute\s*\)/,
    ownerMountLabel: "ownerApi.route('/sites/:siteId/entries', entriesRoute)",
  },
  {
    family: 'POST /sites/:siteId/collections (collection scaffold)',
    editorFile: './collection-scaffold.ts',
    editorNeedle: "ctx.apiBase + '/sites/' + ctx.siteId + '/collections'",
    ownerMountRe:
      /ownerApi\.route\(\s*['"]\/sites\/:siteId\/collections['"]\s*,\s*collectionsRoute\s*\)/,
    ownerMountLabel: "ownerApi.route('/sites/:siteId/collections', collectionsRoute)",
  },
  {
    family: 'GET/POST/DELETE /sites/:siteId/snapshots (version history, C2)',
    editorFile: './versions-panel.ts',
    editorNeedle: "ctx.apiBase + '/sites/' + ctx.siteId + '/snapshots'",
    ownerMountRe:
      /ownerApi\.route\(\s*['"]\/sites\/:siteId\/snapshots['"]\s*,\s*versionRoute\s*\)/,
    ownerMountLabel: "ownerApi.route('/sites/:siteId/snapshots', versionRoute)",
  },
  {
    family: 'GET/POST/DELETE /sites/:siteId/fonts (owner custom fonts, C3)',
    editorFile: './inspector-text-font-family.ts',
    editorNeedle: '${ctx.apiBase}/sites/${encodeURIComponent(ctx.siteId)}/fonts',
    ownerMountRe:
      /ownerApi\.route\(\s*['"]\/sites\/:siteId\/fonts['"]\s*,\s*fontsOwnerRouter\s*\)/,
    ownerMountLabel: "ownerApi.route('/sites/:siteId/fonts', fontsOwnerRouter)",
  },
  {
    family: 'POST /embed/expand-shortlink (embed shortlink expansion, C4)',
    editorFile: './embed-shortlink.ts',
    editorNeedle: "ctx.apiBase + '/embed/expand-shortlink'",
    ownerMountRe: /ownerApi\.route\(\s*['"]\/embed['"]\s*,\s*embedExpandRoute\s*\)/,
    ownerMountLabel: "ownerApi.route('/embed', embedExpandRoute)",
  },
];

for (const contract of apiBaseRouteContracts) {
  const editorSrc = await source(contract.editorFile);
  assert(
    editorSrc.includes(contract.editorNeedle),
    `${contract.family}: editor source ${contract.editorFile} must still build the URL from ctx.apiBase (looking for "${contract.editorNeedle}") — the editor-side contract drifted`,
  );
  assert(
    contract.ownerMountRe.test(ownerAppSrc),
    `${contract.family}: src/routes/api/owner-app.ts must mount "${contract.ownerMountLabel}" so the path is reachable on BOTH /api/* and /__api/* — moving this mount out of ownerApi recreates codex findings C2/C3/C4/C5 (the editor 404s on /__api/* while /api/* keeps working)`,
  );
}

// Belt-and-braces: count unique `ownerApi.route(<prefix>, <subApp>)` mounts
// in owner-app.ts and confirm we have at least one per distinct sub-app
// referenced by the contracts above. Multiple contracts can share a mount
// (e.g. /canvas-agent serves both apply and preview), so we count by unique
// ownerMountLabel. If a future refactor introduces a NEW ownerApi mount,
// the table above is the canonical list — but the count check below also
// fires if someone drops a mount without updating this smoke.
const uniqueOwnerMountLabels = new Set(
  apiBaseRouteContracts.map((contract) => contract.ownerMountLabel),
);
const ownerApiRouteCount = (ownerAppSrc.match(/ownerApi\.route\(/g) || []).length;
assert(
  ownerApiRouteCount >= uniqueOwnerMountLabels.size,
  `ownerApi must have at least ${uniqueOwnerMountLabels.size} mounts (one per unique sub-app in the ctx.apiBase contracts table above); src/routes/api/owner-app.ts currently exposes ${ownerApiRouteCount}. A mount was dropped — check the contracts table above against owner-app.ts`,
);

console.log('[editor-client-regression:smoke] OK');
