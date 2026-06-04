# Section Library migration plan

Operational plan for shipping [ADR 0061](../adr/0061-section-library-is-canonical-pool-templates-are-compositions.md). Ordered phases; each phase leaves the system in a working state and ships independently. Smokes at every phase boundary.

Total estimate: ~7 phases, each landable as one PR / commit cluster.

---

## Phase A — Schema additions (additive, no behaviour change)

**Goal:** widen `library_section` to carry lineage + category without breaking any existing read or write path.

**Changes**
- New Drizzle migration `drizzle/0015_section_library_lineage.sql`:
  - `ALTER TABLE library_section ADD COLUMN base_slug text` (nullable initially; backfilled in same migration)
  - `ALTER TABLE library_section ADD COLUMN version int NOT NULL DEFAULT 1`
  - `ALTER TABLE library_section ADD COLUMN parent_id uuid NULL REFERENCES library_section(id)`
  - `ALTER TABLE library_section ADD COLUMN category text NOT NULL DEFAULT 'other'`
  - Backfill: `UPDATE library_section SET base_slug = id` for existing rows (they'll all be `version=1` with no parent)
  - `ALTER TABLE library_section ALTER COLUMN base_slug SET NOT NULL`
  - `CREATE UNIQUE INDEX library_section_base_slug_version_idx ON library_section (base_slug, version)`
- `src/db/schema.ts` — extend `librarySection` Drizzle schema to declare the new columns; add `SECTION_CATEGORIES = ['header','hero','features','testimonials','cta','gallery','footer','other'] as const`.
- `src/canvas/validate.ts` — no change yet; per-scope uniqueness lands in Phase D.

**Smoke**
- `bun run drizzle-migrate:smoke` (or equivalent) — verify the migration replays on a clean DB.
- A new `src/db/section-library-schema.smoke.ts` — round-trip an `INSERT` with the new columns and assert the unique index rejects duplicate `(base_slug, version)`.

**Verification**
- All existing `library_section` rows have `base_slug = id`, `version = 1`, `parent_id = NULL`, `category = 'other'`.
- All existing GET / POST / DELETE routes unchanged behaviour.

**Rollback**
- Revert migration; drop columns.

---

## Phase B — Code-defined `SECTION_LIBRARY` const + boot upsert

**Goal:** introduce the code-canonical pool registry with the deploy-time upsert hook. Pool starts empty (no entries yet); built-ins land in Phase C. The mechanism ships first.

**Changes**
- New directory `src/canvas/section-library/`:
  - `index.ts` — re-exports the registry and types.
  - `types.ts` — exports `SectionLibraryEntry`, `SectionInstanceRef`, `SectionCategory` types.
  - `registry.ts` — exports `SECTION_LIBRARY: ReadonlyArray<SectionLibraryEntry>`. Initially empty.
  - `entries/` — directory for per-section JSON files (filled in Phase C).
- `src/index.ts` (server entry) — add a startup hook that runs once per server boot: walks `SECTION_LIBRARY`, computes a stable `id` for each entry (deterministic from `base_slug + version`), upserts each into `library_section` with `visibility='global'`, `customerId=null`.
- New `src/canvas/section-library/boot-upsert.smoke.ts` — assert that a clean DB plus boot equals the SECTION_LIBRARY contents (and that re-running boot is idempotent).

**Verification**
- Boot logs show "upserted 0 sections" (registry empty).
- Existing global rows untouched.

**Rollback**
- Delete the boot hook; SECTION_LIBRARY const is harmless without it.

---

## Phase C — Extract existing template sections into `SECTION_LIBRARY`

**Goal:** every section currently embedded in a TemplateSeed becomes a pool entry. ~50 entries land. TemplateSeed shape is unchanged in this phase — sections still embed.

**Changes**
- For each TemplateSeed in `src/templates/registry.ts`, walk its `state.pages[*].sections` and its `state.header` / `state.footer`. For each Section, create one entry under `src/canvas/section-library/entries/<base-slug>.json`:
  - `base_slug`: origin-named per ADR 0061 dec 5 (`home-template-hero`, `apogee-template-testimonial-row`, etc.)
  - `category`: assigned from a manual mapping table — heroes → `'hero'`, feature grids → `'features'`, testimonials → `'testimonials'`, headers → `'header'`, footers → `'footer'`, ctas → `'cta'`, gallery strips → `'gallery'`, anything else → `'other'`
  - `sectionData`: the CanvasSection JSON, unchanged
  - `recipeId`: from the existing `section.recipeId`
  - `originTemplateId`: which template extracted it (for later filter/display)
- `src/canvas/section-library/registry.ts` — populate `SECTION_LIBRARY` from the JSON files.
- Add a new `src/canvas/section-library/origin-mapping.ts` carrying the manual `(originTemplateId, originSectionId) → base_slug` map so Phase D's TemplateSeed rewrites can resolve each old `section-hero` to its new pool id.
- No changes yet to TemplateSeed shape, picker, or validators.

**Smoke**
- New `src/canvas/section-library/extraction.smoke.ts` — assert every (templateId, sectionId) pair appears in the origin map and every base_slug resolves to a SECTION_LIBRARY entry.
- Boot upsert smoke now upserts ~50 rows.

**Verification**
- `SELECT count(*) FROM library_section WHERE visibility='global'` ≈ 50 (after boot).
- `library_section` rows visible to any Owner via the existing GET route.

**Rollback**
- Delete `SECTION_LIBRARY` entries; boot upsert no-ops. DB rows persist until manually cleared (acceptable — they're harmless extra global rows).

---

## Phase D — New `TemplateSeed` type + composition + instance scope

**Goal:** templates become compositions of refs. Renderer, validator, and instantiation all respect `instanceScope`. This is the biggest phase; ship it as one coherent change.

**Changes — types**
- `src/canvas/section-library/types.ts` — finalise `SectionInstanceRef` per ADR 0061 dec 6 (`{ sectionId, instanceId, overrides? }`).
- `src/templates/registry.ts` — rewrite `TemplateSeed` interface per ADR 0061 dec 6.
- `src/canvas/schema.ts` — `CanvasSection` gains optional `instanceScope?: string` (only set on instantiated, never on Library entries).

**Changes — TemplateSeed migration**
- Rewrite each of the 9 TemplateSeed exports in `src/templates/registry.ts` from `state: EditableSite` to `{ styleKit, headerRef?, footerRef?, pages: [...] }`. Refs resolve through the origin map from Phase C.
- For the 6 home-cloning templates, each composition references its own pool entries (origin-named per Phase C); overrides land on the few `text.content` / `action.label` fields that the old `buildTemplate` mutated. Overrides keyed by *original* element id.
- For Apogee / Portfolio / Enterprise, refs map 1:1 to extracted pool entries with no overrides.
- Delete `buildTemplate`, `cloneBaseState`, `setText`, `setActionLabel` from `registry.ts`. Add a new `instantiateTemplate(templateId): EditableSite` function that walks refs, deep-clones pool sections, applies overrides, sets `instanceScope`.

**Changes — validator**
- `src/canvas/validate.ts`:
  - Element-id uniqueness assertion changes from page-wide to `(page, instanceScope) → set`. Element ids in different scopes may collide.
  - Anchor-id uniqueness assertion from `validatePageAnchorIdUniqueness` similarly scopes per `(page, scope)`.
  - Section validation accepts `instanceScope` as an optional non-empty string matching `/^[a-z][a-z0-9]*$/`.

**Changes — renderer**
- `src/canvas/render.ts`:
  - Each `.opencanvas-section` wrapper emits `data-instance-scope="<scope>"` when `section.instanceScope` is set.
  - Each `.opencanvas-element` wrapper emits the same attribute.
  - Anchor href rewrite: walk every emitted element, transform `anchorId="x"` → `id="${scope}-x"` and every `<a href="#x">` inside the same scope → `href="#${scope}-x"`. Out-of-scope `#…` hrefs fall back to global resolution; failures throw loudly.

**Changes — Yjs codec**
- `src/canvas/yjs-projection.ts` — element/section keys widen to include `instanceScope`. ADR 0007's codec contract holds; the smoke gets a new round-trip case with scope-set sections.

**Changes — editor client**
- `src/editor-client/canvas-client.ts` and inspector mounts — element identification widens to `(scope, elementId)`. Selection state, update calls, anchor target picker all thread the scope through.

**Smoke**
- New `src/canvas/section-library/composition.smoke.ts` — instantiate every TemplateSeed and verify byte-equality against a checked-in snapshot (so a refactor of the override mechanism can't silently change output).
- Update validator smokes for per-scope uniqueness.
- Update renderer smokes for the new `data-instance-scope` attr and anchor rewrite.
- Update Yjs codec smoke for scoped element keys.

**Verification**
- All TemplateSeeds instantiate to the same byte content they produced pre-migration (modulo the new `instanceScope` attribute and the new `data-instance-scope` attribute on element wrappers).
- A two-instance-of-same-section test page renders both instances correctly with different scope attrs.

**Rollback**
- Revert is painful; this is the load-bearing phase. Keep the prior TemplateSeed code paths behind a feature flag for one PR if scope/risk warrants. If reverted, Phase C's pool entries remain but unused.

---

## Phase E — API + picker UI

**Goal:** unified picker that reads from DB only, surfaces category + slug + recipe + name in search, routes header cards to `state.header`.

**Changes — API**
- `src/routes/api/library-sections.ts`:
  - `POST /sections` — accept `category` (required, validated against `SECTION_CATEGORIES`), `parentId` (optional, signals save-as-new; bumps version if parent exists).
  - New `PUT /sections/:id` — in-place edit, owner-private rows only (403 on `visibility='global'`).
  - `GET /sections` — strip the seed-catalog merge (Phase F deletes `section-catalog.ts`); return DB rows only with the new `category`, `baseSlug`, `version`, `parentId` fields.

**Changes — picker UI**
- `src/editor-client/sections-picker.ts`:
  - Filter dropdown: rebuild options from `SECTION_CATEGORIES`. Default = "All".
  - Search haystack: widen to `slug + name + recipeId + category + headingPreview + originTemplateName + description`.
  - New sort toggle: "A-Z" (default) / "Recently added".
  - Card click handler: read `category`. If `'header'` → write `state.header = { sectionId, instanceId: 'site-header' }`. If `'footer'` → write `state.footer`. Otherwise → existing placement-mode flow.
- `src/editor-client/styles.css` (or styles-build.ts) — minor layout for the new sort toggle.

**Smoke**
- New `src/editor-client/sections-picker.smoke.ts` — feed a mock catalog with mixed categories; assert filter, search, sort, and click-to-header behaviour.

**Verification**
- Search "testimonial" matches all `testimonial-row` recipe entries AND `library-template-testimonial-*` entries.
- Selecting a header-category card writes `state.header`; the inspector picks it up.

**Rollback**
- Revert picker UI changes; the API additions (`PUT`, `category`) are additive and safe.

---

## Phase F — Three standalone testimonial fixtures

**Goal:** the user's original ask. Three new `'global'` entries with distinct element trees.

**Changes**
- `src/canvas/section-library/entries/library-template-testimonial-quote.json` — single pulled quote + attribution.
- `src/canvas/section-library/entries/library-template-testimonial-cards.json` — three side-by-side containers, each with avatar (media), quote text, name + title text.
- `src/canvas/section-library/entries/library-template-testimonial-video.json` — video media element + supporting quote + attribution.
- Each entry: `category: 'testimonials'`, `recipeId: 'testimonial-row'`, `visibility: 'global'`, `version: 1`, `parent_id: null`.
- Each entry validates against the synthetic-state validation path already used by `validateSectionForLibrary` in `library-sections.ts`.

**Smoke**
- New `src/canvas/section-library/testimonial-fixtures.smoke.ts` — assert each of the three entries:
  - Validates as a CanvasSection.
  - Renders without throwing.
  - Includes at least one text element with the expected content type per variant.

**Verification**
- Searching "testimonial" in the picker shows all 3 + any existing `testimonial-row` extracted entries.
- Each renders correctly when dropped onto a page.

**Rollback**
- Delete the three JSON entries; boot upsert stops adding them on next deploy. Existing DB rows can be cleaned up via admin DELETE.

---

## Phase G — Cleanup + retire legacy code paths

**Goal:** delete `SECTION_CATALOG`, retire `home.json` / `enterprise-scale.json` / `apogee-showcase.json` / `portfolio-showcase.json` as whole-template JSONs by splitting them into per-section files referenced through the pool.

**Changes**
- Delete `src/templates/section-catalog.ts`.
- Delete `src/templates/section-thumbnail.ts` if its only consumer was the catalog (verify first).
- Delete the four whole-template JSON fixtures; each section now lives as one file under `src/canvas/section-library/entries/`.
- Delete the `seedEntryToCatalog` merge logic from `library-sections.ts`.
- Delete `assertNoFixtureSeoLeak` if its scope is now covered by individual section validation (verify first).
- Update `src/canvas/section-library/origin-mapping.ts` — the mapping is now used only for documentation; the live code path uses Section ids directly.

**Smoke**
- Existing canvas smoke continues to pass with the new TemplateSeed instantiation path.
- A new dead-code-detection step (or `tsc --noUnusedLocals`) confirms no dangling imports.

**Verification**
- `grep -r SECTION_CATALOG src/` returns no hits.
- All 9 templates still render correctly via `instantiateTemplate`.

**Rollback**
- Most painful. Keep the pre-deletion files in git history; reverting brings them back but the Phase D code paths would need to be re-routed. Practical rollback strategy: forward-fix rather than revert.

---

## Touchpoint summary

| Layer | Files touched | Phases |
|---|---|---|
| DB schema | `drizzle/0015_*.sql`, `src/db/schema.ts` | A |
| Section Library code | `src/canvas/section-library/{index,types,registry,boot-upsert,origin-mapping,entries/*.json}.ts` | B, C, F |
| Template registry | `src/templates/registry.ts` (rewrite) | D |
| Canvas schema | `src/canvas/schema.ts` (add `instanceScope`) | D |
| Validator | `src/canvas/validate.ts` (per-scope uniqueness) | D |
| Renderer | `src/canvas/render.ts` (scope attr + anchor rewrite) | D |
| Yjs codec | `src/canvas/yjs-projection.ts` (scoped element keys) | D |
| Editor client | `src/editor-client/canvas-client.ts`, inspector mounts | D, E |
| Picker UI | `src/editor-client/sections-picker.ts`, picker styles | E |
| API | `src/routes/api/library-sections.ts` (POST + PUT + GET) | E |
| Boot hook | `src/index.ts` (startup upsert) | B |
| Deletions | `src/templates/section-catalog.ts`, 4 whole-template JSON fixtures | G |
| Smokes | new per phase; updates to existing canvas, render, validate, Yjs smokes | A–G |

---

## Risks and mitigations

- **Per-scope validator change is load-bearing.** Many smokes assert global-page uniqueness; mass update needed in Phase D. Mitigation: land the validator change with a `legacyGlobalUniqueness` opt-in flag that defaults true for the first PR, then flip default in a follow-up PR after every consumer updates.
- **Anchor href rewrite has subtle edge cases** (cross-page anchors, nav links pointing into the body of a non-existent section). Mitigation: a dedicated `src/canvas/render-anchor-rewrite.smoke.ts` covering 8+ scenarios; renderer fails loudly when a rewrite has no resolution (matches global "fail loud" preference).
- **TemplateSeed migration changes byte output** of `enterprise-scale.json` / `apogee-showcase.json` / `portfolio-showcase.json` if their original sections had element-id collisions across pages (unlikely but verify). Mitigation: byte-snapshot smoke in Phase D catches the regression.
- **Boot upsert on every deploy adds startup cost** (~50 SQL statements). Mitigation: single transaction; benchmark against deploy SLO; if it lands over budget, batch upsert into one `INSERT ... ON CONFLICT DO UPDATE` per row using prepared statements.
- **Parallel-branch coordination.** Other agents may be editing `registry.ts` or `validate.ts` concurrently. Mitigation: each phase is one cluster, the orchestration discipline rules apply (use `-o` commits, snapshot/restore for file overlap, `SKIP_SIMPLE_GIT_HOOKS=1` per session memory).

---

## What ships first

If only one PR ships from this plan, it is **Phases A + B + F**:
- Schema additions (additive, safe)
- Code-defined registry + boot upsert (mechanism in place)
- The three new testimonial fixtures (the user's original ask, deliverable in isolation)

Phases C–E + G become the full structural refactor that follows. This gives a minimal first ship that satisfies the testimonial ask while the architectural change marinates.
