# ADR 0059 — Site header/footer is the only canonical pinned section; pages opt-in or opt-out

**Status:** Accepted
**Date:** 2026-06-04
**Author:** Aayushman Singh
**Shipped:** 2e83f12 (schema/validator cutover + drizzle 0014 + replay smoke + fixtures + editor shims), f39fc04 (renderer + anchor validator respect suppress flags), ca23468 (Yjs page-map codec for suppress flags), b419cc4 (section-roles.ts deleted, editor callers cleaned)

## Context

Today the canvas schema offers two ways to express a pinned header or footer:

1. **Site-level slots** — `EditableSite.header?: CanvasSection` and `EditableSite.footer?: CanvasSection` ([`src/canvas/schema.ts:472-475`](../../src/canvas/schema.ts#L472-L475)). One instance per site, rendered above/below every page by [`src/canvas/render.ts:420`](../../src/canvas/render.ts#L420).
2. **Page-level pinned sections** — a section inside `page.sections[]` whose `role` field is `'header'` or `'footer'` ([`src/editor-client/section-roles.ts:13-26`](../../src/editor-client/section-roles.ts#L13-L26)). Pinned to one page only; the same UI affordances (pinned styling, locked top/bottom position) as the site-level slot.

The two paths are visually indistinguishable in the editor and the rendered output but have totally different propagation semantics: editing the site-level footer updates every page, editing a page-level `role:'footer'` section updates only that page. Owners cannot tell which one they have until they click into a second page and see whether the edit appears.

The problem manifested when an Owner reported "I edited the footer on one page and it didn't show up anywhere else." Investigation confirmed both storage shapes are alive and 6 of 9 built-in templates ship the page-level shape (every template that derives from `home.json` via `buildTemplate()` in [`src/templates/registry.ts:14-77`](../../src/templates/registry.ts#L14-L77) inherits `home.json`'s `role:'footer'` page section).

There are two ways out of this:

- **(A)** Keep both storage shapes; teach the editor UI to clearly distinguish them ("edit site footer" vs. "convert section to per-page footer override"). Two nodes, one extra relation (which-is-which signaller), permanent dual cognitive load.
- **(B)** Collapse to one canonical shape: only the site-level slot is pinned; if an Owner wants a different footer on a specific page, they add a regular (unpinned) section to that page and style it as they wish. One node, zero ambiguity.

The minimally complex system has fewer nodes. There is no observable Owner behaviour that requires *both* storage shapes simultaneously — the per-page customisation use case is satisfied by an ordinary section the Owner authored themselves.

## Decisions

1. **`EditableSite.header` and `EditableSite.footer` are the only places a pinned header/footer can be defined. `CanvasSection.role` loses `'header'` and `'footer'` from its union; pinning is no longer a property a page section can carry.**

   **Why:** removes the dual-storage ambiguity at its source. The schema, not UI labels, is what makes "site footer" and "page footer" indistinguishable, so the fix has to land in the schema. With `role:'header'|'footer'` gone, there is exactly one storage location for a pinned header/footer per site; "where did my edit go?" is no longer a question an Owner can ask.

   This would be wrong if there were a legitimate need for *more than one* pinned footer per site that shared no content — e.g. a localisation scheme that needed per-page footers indexed by language. Localisation is handled elsewhere (per-page `locale` + locale-aware content), so the case does not arise.

2. **Per-page apply/skip is expressed as `CanvasPage.suppressHeader?: boolean` and `CanvasPage.suppressFooter?: boolean`, default = show.**

   **Why:** matches today's effective behaviour (every page renders the site footer) so existing sites need no field backfill — absent flag means show. A positive `showFooter` flag would require backfilling `true` on every existing page or treating undefined as true, which is the same logic via a less honest field name. The suppress framing also makes the rare "no footer here" case explicit at the page where it matters, rather than implicit in the global default.

   This would be wrong if pages needed three-way logic (show site / show alternate / show nothing). The "show alternate" case is served by Decision 3 — the Owner suppresses the site footer and adds a regular section. Three-way enum is unneeded.

3. **A page that needs a different footer adds a regular section to its `sections[]` and styles it as desired. There is no "footer override" slot, no marker, no special class.**

   **Why:** an Owner-authored section *is* the override. Adding a typed slot or marker would re-introduce the same dual-storage ambiguity this ADR removes. The Owner already has full control over section position, content, and styling; nothing about "this section is meant to behave like a footer" needs to be stored.

   This would be wrong if downstream consumers (sitemaps, a11y audits, RSS) needed to know "this section is the footer" for non-rendering reasons. They do not — sitemaps key off pages, a11y audits key off landmarks the Owner sets, RSS keys off page metadata.

4. **Symmetry: the same rules apply to header. Site-level header is the only pinned header. `role:'header'` is removed from `CanvasSection` in the same change as `role:'footer'`. `CanvasPage.suppressHeader` mirrors `suppressFooter`.**

   **Why:** header has the identical architecture and identical ambiguity. Fixing footer alone preserves the bug in the symmetric half of the schema, requiring a second ADR and a second migration. One coordinated change is cheaper than two.

   This would be wrong if header had different propagation semantics or different Owner editing patterns that justified asymmetric storage. It does not: both have a site-level slot, both can be page-level pinned, both render the same way relative to the page.

5. **Validator hard-cutover: from this deploy onward, [`src/canvas/validate.ts`](../../src/canvas/validate.ts) rejects any page section with `role === 'header'` or `role === 'footer'`. No silent strip, no backwards-compatible accept-and-coerce.**

   **Why:** matches the project's all-or-nothing failure stance and ADR 0012 (validator is the only write gate). A silent strip in the validator would leave the codebase containing dead branches that handle "what if a page section has `role:'footer'`" for the lifetime of the codebase — exactly the dual-storage cognitive load this ADR removes. The validator's job is to fail loudly on shapes the system no longer supports.

   This would be wrong if existing user data could reach the validator before the migration ran. Decision 6 closes that window.

6. **Drizzle migration `0014_site_pinned_only.sql` runs before the schema/validator change ships. For each `EditableSite` JSONB in `published_site` and the equivalent draft tables: if `site.header` is absent and any page has a section with `role === 'header'`, promote the first such section to `site.header`. Same for footer. Then strip `role` from every page section in every site. Idempotent — re-running it is a no-op.**

   **Why:** "promote first found" preserves visible behaviour for sites that relied on a page-level footer — the Owner sees their footer continue to render, now from the canonical slot. "Strip everywhere" is the data-side companion to Decision 5: after the migration, no page section in the DB carries the dead role, so the validator cannot trip on legacy data. Idempotency means the migration is safe to re-apply if a deploy is rolled back.

   This would be wrong if "first found" produced a worse outcome than "ask the Owner which one to keep" — e.g. if it were common for a site to have *different* page-level footers per page intentionally. It is not common; the pattern arose from template inheritance, not deliberate per-page customisation. Owners who *did* want per-page variation will still have those sections (they become regular sections that the Owner can keep, modify, or delete), and the suppressed-footer mechanism lets them opt out of the now-canonical site footer on those pages.

7. **Smoke test `src/canvas/site-pinned-only.migration.smoke.ts` replays a snapshot of the pre-migration JSONB shape from a real site captured 2026-06-04 and asserts the migration produces the expected post-shape: site slot populated, page `role` fields gone, no other changes to the site tree.**

   **Why:** per the 2026-06-02 action-shape break (portfolio PR flipped action.label string→InlineRun[] without migration, 500'd all prod sites), schema-affecting migrations need a historical-replay smoke that runs in CI. The smoke is the regression net for "we forgot a site shape that exists in the DB."

   This would be wrong if no real pre-migration data existed — e.g. for a greenfield feature. It exists.

## Consequences

- **Schema simplification.** `CanvasSection.role` becomes redundant in the only-`'body'` case. Whether to delete the field entirely is deferred to a follow-up ADR; this ADR only removes `'header'` and `'footer'` from the union.
- **Editor UI simplification.** [`src/editor-client/section-roles.ts`](../../src/editor-client/section-roles.ts) shrinks to `clampInsertIndex` only (or is deleted if other call sites are also removed). Reel "+ Add Header" / "+ Add Footer" buttons in [`src/editor-client/reel.ts:208-238`](../../src/editor-client/reel.ts#L208-L238) act on `site.header` / `site.footer` only.
- **Template fixture updates.** [`src/canvas/fixtures/home.json`](../../src/canvas/fixtures/home.json) (lines 15, 422), [`src/canvas/fixtures/portfolio-showcase.json`](../../src/canvas/fixtures/portfolio-showcase.json) (lines 192, 257), [`src/canvas/fixtures/apogee-showcase.json`](../../src/canvas/fixtures/apogee-showcase.json) (lines 171, 241) all need their pinned sections moved to site-level slots and their `role` markers stripped. Six templates that inherit from `home.json` via `buildTemplate()` automatically benefit.
- **Render path additions.** [`src/canvas/render.ts`](../../src/canvas/render.ts) must respect `page.suppressHeader` and `page.suppressFooter` when composing each page's HTML.
- **Yjs projection.** [`src/canvas/yjs-projection.ts`](../../src/canvas/yjs-projection.ts) encodes the suppress flags as boolean leaves in the page map; no structural change to the site-root header/footer encoding.

## Follow-ups

- Decide whether to delete the `role` field from `CanvasSection` entirely (now that `'body'` is the only valid value). New ADR if so.
- Editor UI for the suppress toggle: per-page inspector toggle vs. reel-level affordance. Tracked as a UX follow-up, not blocking this ADR.
- Consider whether built-in templates should ever ship with `suppressFooter: true` on collection-style pages (e.g. blog post pages where the site footer feels heavy). Owner-side concern; out of scope here.
