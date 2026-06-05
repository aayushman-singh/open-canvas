# ADR 0061 — Section Library is the canonical pool; Template Seeds are compositions of Section Instances

**Status:** Accepted
**Date:** 2026-06-04
**Accepted:** 2026-06-05
**Author:** Aayushman Singh
**As-built:** landed on `origin/main` at `98f72ad` on 2026-06-04. `instantiateTemplate` materializes compositions from `librarySection` rows; `SECTION_CATALOG` deleted; drizzle 0016 added `base_slug`, `version`, `parent_id`, `category` columns and applied to Neon. Picker reads from DB only with category filter + expanded search haystack. Nine TemplateSeed fixtures decomposed into composition refs.

## Context

Today the codebase carries **two parallel storage mechanisms** for section-like things:

1. **`SECTION_CATALOG`** ([`src/templates/section-catalog.ts:33-52`](../../src/templates/section-catalog.ts#L33-L52)) — a boot-time index built by walking every `TemplateSeed.state.pages[*].sections` and harvesting each section into a flat list. Sections here are *embedded by value* in each TemplateSeed; the catalog is a read-only projection.

2. **`librarySection` DB table** ([`src/routes/api/library-sections.ts:196-235`](../../src/routes/api/library-sections.ts#L196-L235)) — Owner-private and admin-promoted global rows that hold standalone `CanvasSection` blobs. Created at runtime by `POST /api/library/sections`; never derived from TemplateSeed data.

The picker endpoint `GET /api/library/sections` merges both at the API edge ([`library-sections.ts:203-232`](../../src/routes/api/library-sections.ts#L203-L232)), but the two lanes never unify. Catalog entry ids are constructed as `${templateId}:${sectionId}` ([`library-sections.ts:176`](../../src/routes/api/library-sections.ts#L176)) precisely because raw section ids collide across templates — every home-cloning template has its own `section-hero`.

Concretely, six of the nine templates (`Starter`, `Launch`, `Studio`, `Local`, `Press`, `Violet`) all run through `cloneBaseState(baseSeed)` at [`src/templates/registry.ts:14-23`](../../src/templates/registry.ts#L14-L23) where `baseSeed = home.json`, then mutate six text/label fields via `setText` / `setActionLabel` ([`registry.ts:65-70`](../../src/templates/registry.ts#L65-L70)). The remaining structural fields are byte-identical across all six. The result is six templates that visibly differ only in `styleKit` + content, but the codebase stores them as six independent EditableSites with six independent section trees.

Three downstream pains follow:

- **Two pickers, two query paths.** Owners browse the catalog through one read path that internally combines two storage shapes. A new affordance (e.g. "filter sections by category") has to be designed twice — once for the harvest projection and once for the DB rows.
- **No global section identity.** A Section cannot be referred to by a single stable id. Cross-template linking, versioning, "show me where this section is used", and admin moderation all bump into the dual-id problem.
- **Standalone fixtures have no home.** Adding "three new testimonial sections" today forces a choice between (a) inventing a synthetic TemplateSeed to host them, (b) inserting them as DB rows via a hand-rolled migration, or (c) inventing a third lane. None is clean.

The Owner-facing ask that surfaced this — **"add 3 kinds of testimonials to the library and make the sidebar searchable + filterable by type"** — would be a 50-line patch under a unified model. Under the current dual-lane model it requires picking which lane the new entries live in, then patching the picker UX in both shapes.

There are three ways out, sketched during grilling against the user's mental model ("Templates are just collections of sections with some global overrides"):

- **(A)** Add a third code-defined lane just for these testimonials. Defers unification. Smallest diff. Worst on "one source of truth".
- **(B)** Unify the read pool only — DB becomes the single read path; built-ins get upserted from code on deploy; TemplateSeeds keep their embedded shape. Medium scope.
- **(C)** Full alignment — collapse Templates into compositions that reference a single `librarySection` pool by id. Largest scope; honours the user's mental model exactly; sets the foundation for versioning, admin moderation, and cross-template introspection.

Grilling resolved on (C) with specific design choices captured below. The model trades a non-trivial migration of nine TemplateSeeds and a schema change for a permanently smaller surface: one storage lane, one read path, one identity scheme, one place to author "add a section to the library."

## Decisions

1. **The `librarySection` DB table is the single canonical store for every Section, whether built-in, Owner-private, or standalone library fixture. `SECTION_CATALOG` is retired; `src/templates/section-catalog.ts` is deleted at cutover.**

   **Why:** the user's "one source of truth" only holds if there is one storage lane. The DB lane already supports visibility/customerId/blob/thumbnail; the harvest lane supports nothing it doesn't. Collapsing onto DB also unblocks admin moderation, usage analytics, and soft-delete without adding a fourth lane.

   This would be wrong if the DB became unavailable for build/preview workflows (e.g. SSR of marketing pages without a database). Today every read path that touches sections already goes through a database call, so the failure mode does not appear.

2. **Code is the structural source of truth for built-in Sections. A server-boot hook in `src/index.ts` upserts every code-defined `SECTION_LIBRARY` entry into `librarySection` on each deploy. Admin in-DB edits to a `visibility:'global'` row are intentionally ephemeral — overwritten on the next deploy.**

   **Why:** built-in Sections must be reviewable in code, diffable in PRs, and reproducible from a clean DB. Making code structurally canonical preserves those properties while still letting the picker read from a single DB query at runtime. The "admin can edit live" affordance was considered and rejected during grilling because it forks the source of truth between code and DB between deploys, and a structural bug fix to a built-in then requires admin coordination rather than a code change.

   This would be wrong if admins legitimately needed to hot-patch a built-in section without a deploy. They don't — the deploy pipeline is fast enough; emergency hot-fixes go through the same path as regular changes.

3. **Visibility stays 2-tier: `'private'` (Owner-only, gated by `customerId` match) and `'global'` (built-in, code-managed, readable by every Owner). Sharing between Owners happens at the site-collaborator level, not at the Section level. There is no `'community'` tier.**

   **Why:** the existing site-collab mechanism already covers Owner-to-Owner section sharing — collaborators on a site see the embedded sections inside that site. Introducing a Section-level community tier adds a moderation/review surface for an Owner workflow that has another, simpler answer. Two tiers is fewer nodes than three.

   This would be wrong if Owners wanted to publish discoverable sections to other Owners without first sharing a whole site. Today that demand has not surfaced; if it does, a `'community'` tier becomes its own ADR with admin moderation in scope from day one.

4. **Editing a private Section is in-place (a new `PUT /api/library/sections/:id`). Editing a global Section through the UI is forbidden. Both private and global Sections can be saved as a new version via the existing `POST` endpoint with explicit lineage: new columns `baseSlug text not null`, `version int not null default 1`, `parent_id uuid null references library_section(id)`. v2 carries the predecessor's `id` in `parent_id` and `version = parent.version + 1`.**

   **Why:** versioned save lets templates reference exact section ids and never silently break under an upstream edit. In-place edit on private rows matches Owner expectations (it's their data); immutability on globals protects every Template that references them. Lineage stored as columns rather than slug convention makes "show all versions of `home-template-hero`" a single indexed query.

   This would be wrong if Templates referenced by `baseSlug + latest` instead of by exact `id`. They do reference by exact `id` (Decision 6), so a v2 does not silently swap into existing Templates — only new compositions opt into the new version.

5. **Section base slugs encode template origin: `home-template-hero`, `apogee-template-testimonial-row`, etc. Standalone library fixtures (the testimonials) use the `library-template-…` prefix. The pool is *not* deduplicated by structure — six home-cloning templates produce six independent pool rows with byte-identical element trees, free to diverge after migration.**

   **Why:** the user's mental model treats Templates as owners of their own sections; structural duplication is acceptable in exchange for traceable origin in the slug, no fork-friction when a template wants to evolve its hero independently, and a slug that is human-readable in admin tools without joining to an origin column. The cost is ~50 pool rows instead of ~15, and `Section Override` becomes a rarely-populated schema field rather than a load-bearing instantiation mechanism.

   This would be wrong if templates were expected to share canonical sections by reference, with overrides as the diversity mechanism. They are not — grilling explicitly chose origin-named over deduped.

6. **A Template Seed is a composition of `Section Instance` refs, never an embedded EditableSite. The new shape:**

   ```ts
   interface TemplateSeed {
     id: string;
     name: string;
     tagline: string;
     styleKit: StyleKit;
     headerRef?: SectionInstanceRef;
     footerRef?: SectionInstanceRef;
     pages: { id: string; slug: string; title: string; bodyRefs: SectionInstanceRef[] }[];
   }
   interface SectionInstanceRef {
     sectionId: string;        // library_section.id (exact version)
     instanceId: string;       // /^[a-z][a-z0-9]*$/
     overrides?: { [origElementId: string]: Partial<CanvasElement> };
   }
   ```

   **Why:** matches the user's mental model verbatim. Multi-page support is required because Apogee and Portfolio templates are multi-page today. Per-instance overrides (rather than template-root overrides) allow the same `sectionId` to appear twice in one page with different content. Overrides cover any field on the target element (full `Partial<CanvasElement>`) because no field was identified as off-limits; constraining to content-only was considered and rejected as premature.

   This would be wrong if the override surface needed to mutate the section's element *count* (add or remove elements). It does not — adding/removing elements is "this is a different Section", which means a new pool row, which the workflow already supports via Save-as-new.

7. **Instance scoping is by *wrapper attribute*, not id transformation. A `Section Instance` keeps its underlying Section's original element ids in the persistence shape; the renderer emits a `data-instance-scope` attribute on each section wrapper, and validators check element-id and anchor-id uniqueness *per scope* rather than globally per page. The renderer rewrites `anchorId` attributes and matching `href="#…"` references to `#${scope}-${anchorId}` at HTML emit time.**

   **Why:** keeps the on-disk Section data portable. Save-as-new from a site doesn't have to strip prefixes off element ids; pool sections are diffable across templates; the inspector identifies elements by `(scope, id)` cleanly. The cost is renderer + validator + inspector + agent-tool work to thread the scope through every consumer of element id, captured as a follow-up bundle below.

   This would be wrong if any consumer downstream relied on element id being globally unique at the page level *in storage* — e.g. a Yjs CRDT that keyed updates by element id. The Yjs codec keys by `(pageId, sectionId, elementId)` ([`src/canvas/yjs-projection.ts`](../../src/canvas/yjs-projection.ts)) which gracefully extends to `(pageId, sectionId, instanceScope, elementId)`.

8. **Each Section carries a `category` column from a closed enum: `'header' | 'hero' | 'features' | 'testimonials' | 'cta' | 'gallery' | 'footer' | 'other'`. The sidebar picker filters by category; clicking a `header`-category card wires the section into `EditableSite.header` rather than entering body-placement mode.**

   **Why:** the Owner-facing filter labels need to be stable language ("Testimonials") regardless of how many recipes back them. Category is orthogonal to Section Recipe (a structural constraint) and to visibility (an auth concern). A unified picker that handles header/footer/body in one surface eliminates a separate inspector-side picker for the site-pinned slots.

   This would be wrong if Sections legitimately spanned multiple categories (a hero-with-testimonial hybrid). They do not in the current model; if a hybrid appears, `'other'` is the explicit escape hatch and the migration can re-categorise.

9. **The Section Recipe column stays as-is. The Agent continues to generate fresh sections from the existing `AGENT_RECIPE_IDS` recipe path. Agent integration with the Section Library is explicitly out of scope and deferred to a separate ADR.**

   **Why:** Agent-as-pool-consumer is a substantial design surface (pool search by recipe, ranking, override generation, tool schemas) that benefits from the Library landing first so a follow-up ADR can grill it against real pool data rather than projections. Keeping Agent unchanged also keeps the migration's blast radius bounded to the editor + picker + DB shape.

   This would be wrong if the Agent's freshly-generated sections produced visibly worse output than pool sections would — e.g. if Owners routinely complained about Agent style choices when the pool had better-styled equivalents. Today the Agent's output is acceptable; the gap is not urgent.

10. **Three standalone Section Library fixtures land with the migration: `library-template-testimonial-quote` (single pulled quote + attribution), `library-template-testimonial-cards` (three side-by-side container cards with avatar + quote + name + title), `library-template-testimonial-video` (video media on the left + supporting quote on the right). Each is category `'testimonials'`, recipe `'testimonial-row'`, visibility `'global'`. Each is a distinct element tree, not a colour swap of the others.**

   **Why:** "three kinds" is only meaningful if the three are structurally distinguishable. Same-shape colour swaps would feel like styling variants, not different Section choices, and would not exercise the picker's new search/filter affordances. The three trees cover the three most common testimonial patterns in marketing pages.

   This would be wrong if Owners specifically wanted brand-coloured variants rather than structural variants. They have not asked for that; if they do, the kit + pinnedStyle path already exists to colour-swap any pool Section.

11. **The picker UX gets: a search input whose haystack is `slug + name + recipeId + category + headingPreview + originTemplateName + description`; a category dropdown (Header / Hero / Features / Testimonials / CTA / Gallery / Footer / Other / All); a sort toggle (A-Z slug | Recently added). The existing source filter (All / Built-in / Library) is retired in favour of the category filter, which subsumes the meaningful intent.**

   **Why:** searching "testimonial" must surface `library-template-testimonial-quote` and every `testimonial-row` recipe entry; today's haystack excludes both `recipeId` and `slug` ([`sections-picker.ts:176-182`](../../src/editor-client/sections-picker.ts#L176-L182)). Category as the primary filter matches the Owner ask verbatim. Sort by recently-added is the only ordering that needs a toggle; everything else is alphabetical.

   This would be wrong if Owners cared about the seed-vs-library distinction the current filter exposes. Grilling confirmed they do not — they care about *what the section is*, not where it came from.

## Out of scope

- **Agent integration with the Section Library.** Decision 9 defers this to a separate ADR. The pool will land first; Agent-as-pool-consumer becomes its own design conversation once real pool data is in place to ground it.
- **A `'community'` visibility tier between `'private'` and `'global'`.** Site-collaborator sharing already covers Owner-to-Owner section reuse; introducing a moderation queue, review surface, and admin UX for Section-level community publication has no driving user demand today.
- **Soft-delete or "section in use" reference-counting on `library_section`.** Hard DELETE remains on private rows (Owner-controlled) and global rows (admin-only). A future Template that points at a deleted `sectionId` fails loudly at instantiation rather than silently substituting; that is the intended failure mode under the global "no fallbacks" preference.
- **Per-page header/footer override.** ADR 0059 collapsed pinned sections onto `EditableSite.header` and `EditableSite.footer`; this ADR does not reintroduce a per-page slot. Pages that want a unique footer suppress the site footer (per ADR 0059 dec 2) and add an ordinary body Section.
- **Pool-level usage analytics, popularity ranking, "most-used Sections" surfaces.** The DB shape leaves room for these; the picker UX in this ADR does not include them.
- **Migration of `recipeId === 'custom'` Sections to fit a constrained recipe.** Owner-saved Sections that don't match any of the seven `AGENT_RECIPE_IDS` shapes continue to carry `recipeId: 'custom'`. The Agent will never select a `'custom'` Section under Decision 9; this is intended.
- **Renaming `TemplateSeed` → `Template` in code identifiers, route paths, or dashboard UI strings.** The glossary update in CONTEXT.md redefines the concept; the code identifier rename is a separate, smaller change deferred to avoid blast radius creep.

## Consequences

### Schema

- New table columns on `library_section`: `base_slug text not null`, `version int not null default 1`, `parent_id uuid null references library_section(id)`, `category text not null` (closed enum gated at write).
- `LIBRARY_SECTION_VISIBILITY` stays 2-tier (`'private' | 'global'`).
- `library_section.section_data` continues to carry one `CanvasSection`; element ids inside it stay as authored, with no instance-scope transformation at storage time.
- New uniqueness constraint: `(base_slug, version)` unique on `library_section`.

### Type layer

- `TemplateSeed` rewrites per Decision 6. The existing `TemplateSeed.state: EditableSite` field is deleted.
- New `SectionInstanceRef` interface exported from `src/canvas/section-library/types.ts`.
- `CanvasSection` gains an `instanceScope?: string` field (post-instantiation). The Section Library row itself never carries `instanceScope`; the field is set only when the Section is realised into an EditableSite.
- `validateEditableSite` switches to per-scope element-id and anchor-id uniqueness; pages with sections of different scopes can share original element ids.

### Renderer

- Section wrappers emit `data-instance-scope="<scope>"`.
- Anchor rewriter: every `anchorId="x"` element becomes `id="${scope}-x"` in HTML, and every `href="#x"` resolved against an element in the same scope becomes `href="#${scope}-x"`. Anchor hrefs that don't resolve in scope fall back to global resolution; if there's still no match, the renderer fails loudly (per global "fail loud, no fallbacks" preference).
- CSS that targets `[data-opencanvas-element]` continues to work; scope is additive.

### API

- `POST /api/library/sections` accepts `category` (required) and `parentId` (optional, signals save-as-new for an existing section's lineage).
- New `PUT /api/library/sections/:id` for in-place private edits. Forbidden on `visibility:'global'` rows.
- `GET /api/library/sections` returns `category` on every entry; no longer joins to seed catalog.
- Deploy hook in `src/index.ts` (or a startup migration if Wrangler's hook lifecycle requires) upserts every code-defined entry by `(base_slug, version)`.

### Picker UI

- Filter dropdown replaces source options with category options.
- Search haystack expands per Decision 11.
- Sort toggle adds a single A-Z / Recently-added selector.
- Header-category cards trigger a different code path than body cards: they write `state.header = { sectionId, instanceId }` rather than entering body placement mode.

### Agent

- No change in this ADR.

### Deletions

- `src/templates/section-catalog.ts` (retired in favour of DB read).
- `src/templates/registry.ts` rewrites entirely (`TemplateSeed` shape changes; `buildTemplate` / `cloneBaseState` / `setText` / `setActionLabel` all delete).
- Whole-template JSON fixtures (`home.json`, `enterprise-scale.json`, `apogee-showcase.json`, `portfolio-showcase.json`) decompose into one JSON-per-Section + a small composition definition per template.

## Follow-ups

- **Agent + Library** — separate ADR. Surface area: pool search tool, ranking heuristic, override generation, tool schemas.
- **Anchor scope conflicts** — if Owners report broken `#section-x` links that worked before, the renderer's global-fallback path may need to expand. Defer until a real report surfaces.
- **Soft-delete on `library_section`** — currently DELETE is hard. Templates that reference deleted private sections would break at instantiation. Decision deferred; in the short term, deletion is admin-only on globals and Owners cannot delete private rows referenced by their own templates.
- **`SECTION_RECIPE_IDS` and `'custom'`** — the `'custom'` recipe member is preserved for Sections that don't fit any constrained shape; Owner-saved sections that diverge structurally get saved with `recipeId: 'custom'`. The pool can hold custom entries; the Agent will not pick them under Decision 9.
- **Pages within a template that share a single header/footer ref** — per ADR 0059, header/footer live at site level, not per page; this ADR does not reintroduce per-page pinned slots.

## References

- ADR 0011 — Element registry dispatch pattern (informs the per-Section schema).
- ADR 0050 — Anchor id uniqueness (extended here to per-scope semantics).
- ADR 0058 — Editor context as IIFE closure mirror (picker UI changes land in this module's idiom).
- ADR 0059 — Site header/footer is the only canonical pinned section (this ADR builds on the post-0059 schema).
- CONTEXT.md — Section Library, Section Instance, Section Category, Section Override term definitions.
