// src/ui/styles.ts
//
// `uiStyles` used to be the single source of truth for the rev01 UI
// primitive class rules (.opencanvas-ui-btn, .opencanvas-ui-badge, .opencanvas-ui-pill,
// .opencanvas-ui-card, .opencanvas-ui-input, .opencanvas-ui-field). Every one of those
// rules has moved to src/ui/components.css (the Open Canvas `.btn`,
// `.chip`, `.card`, `.field` primitives) as part of MIGRATION.md §3.
//
// The symbol is kept (now empty) so the three chrome hosts that import
// it — src/routes/dashboard/shell.tsx, src/landing/index.tsx, and the
// editor canvas — keep building. A later stage removes the import once
// componentsCss is wired everywhere uiStyles used to be.
export const uiStyles = ``;
