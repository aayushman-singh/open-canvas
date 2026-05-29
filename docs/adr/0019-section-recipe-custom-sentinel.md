# ADR 0019 — `SectionRecipeId 'custom'` is the sentinel for manually-designed sections

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** Codifies the existing `'custom'` recipe-id pattern so future review work does not re-litigate it. Surfaced as a follow-up in [ADR 0016](0016-fake-discriminated-unions-to-real.md) decision 5.

## Context

`src/canvas/schema.ts` defines `SECTION_RECIPE_IDS = [...AGENT_RECIPE_IDS, 'custom']`. The `'custom'` value is not a recipe in the same sense as `'hero-split'` or `'feature-grid'`; it is a sentinel meaning *this section was designed by the Owner in the editor, not built from an agent recipe*. The `RECIPE_REGISTRY` in `src/canvas/recipes.ts` carries a `buildCustom` factory for the value, kept intentionally minimal — `// kept (Theme C, ADR-class; see synthesis)` per the batch-8 cleanup commit (`7bef446`).

[ADR 0016](0016-fake-discriminated-unions-to-real.md) collapsed the two real fake-discriminated-union patterns in the schema but excluded `SECTION_RECIPE_IDS 'custom'` because it does not fit the fake-DU shape: there is no sibling field that varies by recipe id. Every section has the same shape regardless of recipe; the recipe is the *construction history*, not a discriminator over data.

Two alternatives have surfaced in review:
- (a) keep the sentinel: every section has `recipeId: SectionRecipeId`; manually-designed sections carry `recipeId: 'custom'`.
- (b) make it absence: `recipeId?: AgentRecipeId`, where the field's absence means "this section was not built from a recipe." Drops `'custom'` and `buildCustom`.

The Owner-perceived difference between (a) and (b) is zero — a section renders the same way in both shapes. The developer-perceived difference is small but real: (b) makes "did this section come from a recipe?" a type-level question (`recipeId !== undefined`); (a) makes it a value-equality question (`recipeId !== 'custom'`). (b) also requires a one-shot DB migration to drop `'custom'` from existing rows.

The decision in this ADR is (a) — keep the sentinel — because the migration cost outweighs the marginal developer-ergonomics gain, and because the existing `buildCustom` factory is part of the `Record<SectionRecipeId, RecipeFactory>` exhaustiveness check that catches "added a recipe to the union, forgot to register a factory" at compile time. Removing `'custom'` from the union would not remove that check, but it would require either a separate non-exhaustive registry (the union and the registry diverge) or a different exhaustiveness pattern. Both are extra cost for a small ergonomics gain.

## Decisions

1. **`SECTION_RECIPE_IDS` keeps `'custom'`. The value means "this section was designed by the Owner in the editor, not built from a recipe." `recipeId` stays required on every `CanvasSection`.**

   **Why:** every section needs *some* identifier of how it came to exist for the editor's "what kind of section is this?" UI and for the agent's "is this a section I built or one the Owner customised?" reasoning. A sentinel value is the cheapest way to express that for sections that did not pass through a recipe. The wire format does not change; existing rows continue to validate; the validator's existing case for `'custom'` continues to work; the `Record<SectionRecipeId, RecipeFactory>` exhaustiveness pattern in `RECIPE_REGISTRY` continues to apply uniformly.

   This would be wrong if "this section came from a recipe" became a type-level question consumers needed to ask frequently (the optional-`recipeId` shape would express that better) — but no current consumer asks that question; the agent and editor both treat `'custom'` as a recipe identifier indistinguishable from the agent-built ones at most call sites.

2. **`buildCustom` in `src/canvas/recipes.ts` stays.** It is the registry passthrough required by the `Record<SectionRecipeId, RecipeFactory>` exhaustiveness check. Its body remains minimal — a stub heading-only section — because no caller invokes it for real section construction (manually-designed sections are constructed in the editor, not by calling the factory).

   **Why:** the factory's presence is what makes the exhaustiveness check work; the factory's content is irrelevant to anything except the smoke that calls it. Removing the factory would require removing `'custom'` from `SECTION_RECIPE_IDS` (per decision 1, we are not doing that) or adding a per-key exception to the registry pattern (extra code for no benefit).

## Out of scope

- The shape of `CanvasSection` itself.
- The agent's behaviour around manually-designed sections (whether it reads them, modifies them, treats them differently). That is an agent-tool ADR if anything.
- The `MEDIA_KINDS` enum, explicitly excluded from [ADR 0016](0016-fake-discriminated-unions-to-real.md) for the same shape reasons.
- A potential future `recipeId?: AgentRecipeId` shape if the developer-ergonomics calculus changes. A separate ADR would supersede this one.

## Consequences

**Positive:**
- The `'custom'` sentinel is now an explicit design decision rather than a tolerated artefact. Future reviewers do not re-litigate it.
- The wire format is stable; no migration cost.
- The `RECIPE_REGISTRY` exhaustiveness pattern stays uniform across all recipe ids.

**Negative:**
- The `buildCustom` factory remains as a stub callers ignore. It looks dead at first read; the codebase-level reason it exists (registry exhaustiveness) is not obvious from the factory file alone. The mitigation is the header comment in `recipes.ts` referencing this ADR.
- "Did this section come from an agent recipe?" remains a value-equality check (`recipeId !== 'custom'`) rather than a type-level absence check. Minor ergonomics cost; no behavioural cost.

## Follow-ups

- Update the `buildCustom` header comment in `src/canvas/recipes.ts` to cite this ADR (replacing the current "Theme C, ADR-class; see synthesis" pointer).
- If the developer-ergonomics calculus changes (e.g. several new consumers want type-level "is this a recipe?" narrowing), open a superseding ADR rather than evolving this one in place.
