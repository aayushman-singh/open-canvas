# Multi-page nav

**Wishlist #:** 16 **Tier:** B **Wave:** 4 **Status:** queued
**Depends on:** Phase 0 ✓, **#14 symbols (Wave 3) must be merged**
**Blocks:** none

## User-visible outcome

An Owner with multiple Canvas Pages adds a Nav Element. The Nav lives once as a Symbol; instances appear on every page automatically. Editing the Nav (adding a link, changing the logo) once updates every page. Visitors see a shared navigation strip at the same place on each page with links to the other pages.

## Scope in

- New ElementType `nav` (a specialised Symbol Master pattern):
  - `logoAssetId?: string`, `links: Array<{ label, href, kind: 'internal' | 'external' }>`.
  - Layout slots: `left`, `center`, `right` to match the gamma-style nav we observed.
- Convention: each site auto-creates a single `nav` Symbol named "Site Nav" on first add; subsequent pages auto-include a Symbol Instance pointing at it.
- Internal link picker: dropdown of existing pages so labels stay correct after renames.
- Public renderer pins nav at top of page, sticky optional.
- Editor: nav editor opens at site level (not per-page), reflects through every page.

## Scope out

- Mega-menus / multi-level nav.
- Mobile hamburger toggle with JS (use CSS-only details/summary or skip in POC; falls under #17 interactive runtime if implemented).
- Per-page nav variants (always one site-wide).

## Schema delta

Phase 0:

```ts
// src/canvas/elements/nav.ts (Phase 0 stub)
export interface NavElement extends BaseElement {
  type: 'nav';
  logoAssetId?: string;
  links: Array<{ label: string; href: string; kind: 'internal' | 'external' }>;
  layout: 'left-center-right' | 'left-right';
  sticky: boolean;
}
```

`'nav'` added to `ELEMENT_TYPES` in Phase 0. Behind the scenes the Nav is stored as a SymbolMaster (from #14) whose `section.elements[0]` is the NavElement. Editing the nav = editing the master.

## Files owned (write)

- `src/canvas/elements/nav.ts` — interface + render fn.
- `src/canvas/elements/nav-renderer.ts` — flex layout into three slots.
- `src/symbols/nav-bootstrap.ts` — ensures the site has the "Site Nav" symbol when first nav added; creates Instance on each existing page.
- `src/routes/dashboard/nav-editor.tsx` — site-level nav editor view.
- `src/canvas/recipes.ts` — small recipe entry that uses NavElement (additive). Phase 0 leaves additive slot.
- `nav:smoke` in `package.json`.

## Files read-only (must not modify)

- `src/canvas/schema.ts`, `src/canvas/render.ts`, `src/db/schema.ts`.
- `src/symbols/master.ts`, `src/symbols/merge.ts` (consume only).

## Contract with neighbors

- Uses `src/symbols/master.ts` to author the master.
- Internal-link picker queries `editableState.pages` for slug list.
- Hrefs prefixed `/<slug>` for internal; raw URL for external (with `target="_blank" rel="noopener"`).

## Smoke test

- `bun run nav:smoke`:
  - Add nav to fresh site; assert SymbolMaster created and instances appear on all pages.
  - Add new page; instance auto-added.
  - Edit nav label on master; all instances reflect.
  - Override on one page changes only that instance label.

## Acceptance criteria

- Visitor sees consistent nav across all pages.
- Owner edits once, propagates.
- All smokes green.

## Open questions

- Auto-instance behaviour on every new page: Recommend yes (default-on), with an Owner toggle to suppress on a specific page (set page-level `hideSiteNav: true`).
