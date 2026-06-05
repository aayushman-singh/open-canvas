# ADR 0016 — Fake discriminated-union patterns become real TS discriminated unions

**Status:** Accepted
**Date:** 2026-05-29
**Accepted:** 2026-06-05
**Author:** Aayushman Singh
**Drives:** Theme C of the rev01 OSS code review (handoff-rev01-batch-27 §"Theme C — Fake discriminated unions everywhere"), narrowed to the two patterns that actually fit the fake-DU shape.
**As-built (2026-06-05):**
- Decision 1 — `EditableSiteStyleKit` DU lives in [`src/canvas/schema.ts`](../../src/canvas/schema.ts) alongside `EditableSiteBase`; `EditableSite = EditableSiteBase & EditableSiteStyleKit`. Two helpers (`pickStyleKitField`, `pickEditableSiteBase`) collapse the construction patterns at builder sites.
- Decision 2 + Decision 4 — `ElementNodeBody` DU lives in [`src/canvas/layout/tree.ts`](../../src/canvas/layout/tree.ts); the five `requireXProps` guards in `engine.ts` are deleted. The switch in `createCanvasElement` narrows on `el.type` directly; content-level non-empty checks (text content, media imagePrompt, action label) remain inline.
- Decision 3 — wire format unchanged; no DB migration ran.
- Audit query — ran 2026-06-05 against Neon prod (`mute-haze-45580836`). Zero rows in `site.editable_state`, `site.published_snapshot`, `custom_template.site_state` have `styleKit='custom'` with missing `customStyleKit`. Four rows carry a stray `customStyleKit` on a non-`custom` discriminator; per Decision 3 the validator behaviour does not change, and the existing validator already tolerates the stray field — no data correction required.
- Round-trip smoke at [`src/canvas/adr-0016-du-narrowing.smoke.ts`](../../src/canvas/adr-0016-du-narrowing.smoke.ts), wired into `ci:smoke`.

The custom-theme PUT/DELETE route (`src/themes/route.ts`) and the style-kit POST endpoint (`src/routes/api/canvas.ts`) now reject cross-branch transitions that the dedicated custom-theme endpoint should own — the latter is a small behavioural tightening that surfaced naturally from the DU.

## Context

A developer reading `EditableSite` today can write `{ styleKit: 'custom' }` with no `customStyleKit` and the TS compiler accepts it. The state is invalid — `validatePublishedSnapshot` rejects it at write time, and the renderer would throw if it ever reached one — but the type *says it is fine*. A reader has to consult the validator (or the inline comment "customStyleKit is required when styleKit === 'custom'") to know what data goes with what discriminator. The type carries the discriminator; the sibling that depends on it is optional; nothing in TS enforces the dependency.

Two places in the schema fit this exact shape:

**`EditableSite.styleKit` / `EditableSite.customStyleKit`** (`src/canvas/schema.ts`):
- `styleKit: 'charcoal' | 'orange-editorial' | 'blue-saas' | 'green-organic' | 'custom'`
- `customStyleKit?: StyleKitPreset` — required when `styleKit === 'custom'`, ignored otherwise
- Comment at the field says exactly that; validator at `validate.ts:1053-1075` enforces it; the renderer assumes it (and the recent Theme-J cleanup removed the force-validate call that defended against it). Three distinct files agree on the contract; the type does not express it.

**`ElementNode.element`** (`src/canvas/layout/tree.ts:73-83`):
```ts
export interface ElementNode {
  element: {
    type: DesignElementType;        // 'text' | 'media' | 'action' | 'shape' | 'container'
    text?: TextProps;
    media?: MediaProps;
    action?: ActionProps;
    shape?: ShapeProps;
    container?: ContainerProps;
  };
  size?: ElementSize;
}
```
Five optional siblings keyed by the same discriminator. The layout engine carries six runtime guard functions to compensate: `requireTextProps`, `requireMediaProps`, `requireActionProps`, `requireShapeProps`, `requireContainerProps`, and the matching `node: ElementNode` parameter type narrows to `NonNullable<ElementNode['element']['text']>` etc. (`engine.ts:176-219`). Each guard throws when the type and the discriminator disagree. The guards are the evidence that the type does not carry the invariant — code that uses the element has to *re-check at runtime* what the type already nominally said.

The handoff's Theme C also flagged `SectionRecipeId 'custom'` and `MEDIA_KINDS` as fake-DU candidates. They are not, on closer reading:

- **`SECTION_RECIPE_IDS = [...AGENT_RECIPE_IDS, 'custom']`** with `RECIPE_REGISTRY['custom'] = buildCustom`. The `'custom'` value is a *sentinel for "this section was designed by the Owner, not built from a recipe"* — it has no sibling field, no per-branch data. The pattern is sentinel-for-absence, not discriminator-with-sibling. A different decision shape (could be `recipe?: { id: AgentRecipeId, … }` with `undefined` meaning manual) and a different ADR if it becomes painful.
- **`MEDIA_KINDS = ['image', 'video']`** is a plain string enum on `MediaElement`; no sibling field varies by kind. Not a fake DU.

The Owner-perceived failure mode of the two real fake-DU patterns is small but specific: a script, agent, raw DB INSERT, or migration that bypasses `validatePublishedSnapshot` can land a row that violates the contract, and the editor / renderer either crashes loudly (the `requireXProps` path) or silently picks up the wrong field (the `customStyleKit` path, depending on the consumer). The developer-perceived failure mode is constant: every reader of these types has to learn the unwritten contract from comments or from the validator, and every writer can express invalid states the compiler accepts. The `requireXProps` functions in `engine.ts` are six pieces of code that exist solely to compensate for the missing type-level invariant.

[ADR 0012](0012-validation-write-gate.md) decided that `canvas/validate.ts` is the only write gate and that consumers trust its output. A real discriminated union is the type-level expression of the same property: if the type cannot express invalid states, consumers cannot read them. The two ADRs reinforce each other — the gate enforces at the JSONB boundary, the type enforces at every other boundary.

## Decisions

1. **`EditableSite.styleKit` and `EditableSite.customStyleKit` collapse into a real discriminated union where `customStyleKit` is required exactly when the discriminator is `'custom'` and absent otherwise.** The on-disk JSONB representation does not change — the wire still shows `{ styleKit: 'custom', customStyleKit: {…} }` or `{ styleKit: 'charcoal' }`. What changes is the TS type:

   ```ts
   export type EditableSiteStyleKit =
     | { styleKit: BuiltInStyleKit }
     | { styleKit: 'custom'; customStyleKit: StyleKitPreset };

   export type EditableSite = EditableSiteStyleKit & { /* all other fields */ };
   ```

   **Why:** the contract today lives in three places (the schema comment, the validator, the renderer). Moving it into the type makes the contract one place — readable at the field, enforced by the compiler, and impossible to forget when adding a new consumer. The wire-format-unchanged property keeps every existing DB row valid and means no migration runs; the change is purely a type refinement on the same data. Wrong only if some legitimate code path needs to construct an `EditableSite` *without* knowing whether it is in the custom branch yet — but every constructor in the codebase either knows (the editor receives the branch from user input) or has no business minting one (consumers receive validated rows from the DB). The pattern that is "wrong" — constructing a partial `EditableSite` and filling in `customStyleKit` later — already fails the validator today.

2. **`ElementNode.element` collapses into a real discriminated union per element type; the five optional props become one required prop per branch.** The wire format does not change. The new shape:

   ```ts
   export type ElementNodeBody =
     | { type: 'text'; text: TextProps }
     | { type: 'media'; media: MediaProps }
     | { type: 'action'; action: ActionProps }
     | { type: 'shape'; shape: ShapeProps }
     | { type: 'container'; container: ContainerProps };

   export interface ElementNode {
     element: ElementNodeBody;
     size?: ElementSize;
   }
   ```

   **Why:** the runtime guards in `engine.ts:176-219` (`requireTextProps`, `requireMediaProps`, `requireActionProps`, `requireShapeProps`, `requireContainerProps`) exist *only* because the current type lies about the invariant. With the DU, narrowing falls out of `switch (node.element.type)` and the guards become unreachable. The five guard functions delete; the call sites lose one runtime throw each; the engine reads as "given a `'text'` element, its text props are right there" rather than "given an element, assert it's text-shaped, throw if not." This is exactly the substitution the Theme-J synthesis named as the goal: stop validating at use-time when the type can carry the invariant.

3. **The wire format is unchanged for both patterns. No DB migration runs; no auto-coercion happens on read.** Existing rows that match the new contract continue to validate and parse; existing rows that violate it continue to fail the validator at the JSONB boundary — exactly as they do today. The validator's behaviour does not change; the type's behaviour does.

   **Why:** wire-format changes are expensive (migration script, backwards-compat handling, version flag in every consumer). The contract this ADR pins is the relationship between discriminator and siblings — that relationship is *already* enforced at the validator; the JSONB shape *already* matches the new DU. There is nothing to migrate. The change is type-level only because the data is already shaped correctly.

   This is wrong if there are stored rows that violate the new contract — e.g. a `type: 'text'` element with no `text` prop and a stray `media` prop instead. The validator already rejects such rows on read; the question is whether any are sitting in the DB right now from a pre-validator era. The follow-ups include an audit query against production data before merging; if any such rows exist, they get fixed (or quarantined) in a one-shot data correction, not in a fallback path.

4. **The runtime guards `requireTextProps`, `requireMediaProps`, `requireActionProps`, `requireShapeProps`, `requireContainerProps` (and their `NonNullable<ElementNode['element']['<x>']>`-typed return values) are deleted as part of the migration.** Their callers switch to discriminator-based narrowing.

   **Why:** the guards' only job is to defend against the type lying. With the DU, the type stops lying, and the guards have no remaining job. Keeping them as "belt and suspenders" reproduces exactly the redundant-validation pattern [ADR 0012](0012-validation-write-gate.md) decision 6 deletes from the renderer; the same logic applies here. Trust the type; trust the validator at the boundary; stop re-asserting in the middle.

5. **The `'custom'` branch of `SectionRecipeId` is explicitly out of scope. The `MediaKind` enum is explicitly out of scope.** Each is a different shape than the two patterns this ADR addresses; conflating them would either widen the ADR beyond its decision or force a misfit collapse.

   **Why:** `SectionRecipeId 'custom'` is a sentinel-for-absence pattern (the section was designed by hand, not built from a recipe); it has no per-branch data and would not benefit from a DU. The honest refactor is either "remove `'custom'` and let `recipeId` be optional" or "leave it as the sentinel it already is" — a separate decision with its own user-experience trade. `MEDIA_KINDS` is a plain enum on `MediaElement`; both branches have the same sibling fields. There is no DU to make.

## Out of scope

- `SectionRecipeId 'custom'` and `MEDIA_KINDS`, per decision 5.
- Wire-format changes for any pattern (decision 3).
- Backwards-compatibility shims for rows that violated the contract pre-this-ADR. The audit + one-shot fix in follow-ups is the path, not a runtime coercion layer.
- Schema-library replacement (Zod, Valibot, TypeBox). [ADR 0012](0012-validation-write-gate.md) decision 2 picked hand-rolled registry; this ADR inherits that decision.
- Validator changes. The validators already enforce the contract this ADR formalises in the type; no behavioural change there.
- Per-element module restructure ([ADR 0011](0011-canvas-element-registry.md)). The DU change is to the *types*; the per-element-module organisation is orthogonal and lands on its own schedule.

## Consequences

**Positive:**

- Impossible states (the `{ styleKit: 'custom' }` with no preset; the `{ type: 'text' }` with no text props) become unrepresentable. A new consumer of either shape gets compile-time help rather than runtime surprises.
- The five `requireXProps` guards in `engine.ts` delete. The engine loses six runtime throws and reads more directly.
- The schema comments that today describe the invariant ("required when styleKit === 'custom'", "type discriminates which prop is present") become redundant. They can stay as documentation or move into the type's JSDoc.
- The type-level expression of the contract reinforces the validator's role per [ADR 0012](0012-validation-write-gate.md): one write gate at the JSONB boundary, one type that says what valid data looks like, no re-checking in between.
- The same pattern (real DU instead of optional siblings) becomes the obvious move for any future schema field that wants to express "value depends on discriminator." The decision becomes precedent.

**Negative:**

- Every consumer that today reads `site.customStyleKit` unconditionally — and there are several, scattered across renderer, editor, validator helpers — has to narrow first: `if (site.styleKit === 'custom') { site.customStyleKit /* now typed */ }`. The narrowing is correct (the unconditional read was a latent bug), but it is mechanical noise across many files. The migration PR will be large.
- TypeScript narrowing through `&` intersection types and across function boundaries occasionally surprises — a value narrowed in one function may need to be re-narrowed in a callee that takes the wider type. The patterns are well-understood but each call-site fix is a small judgment call.
- Element constructors in tests and fixtures that today say `{ type: 'text', text: {…} }` work unchanged; ones that say `{ type: 'text' as any, … }` break loudly. Loud breakage is the point.
- If any pre-validator DB rows exist with the contract-violating shape (decision 3 caveat), they fail on read after this ADR ships — same failure mode as today, but with a TS error at the assignment instead of a thrown `requireXProps`. The audit prevents surprise; the cleanup is data-correction, not code-fallback.

## Follow-ups

- Run an audit query against production `editableSite` JSONB rows: count rows where `styleKit = 'custom'` and `customStyleKit IS NULL`. Same for `type = 'text'` element nodes with `text IS NULL` and the matching combinations for media/action/shape/container. Expected: zero. If non-zero, fix in a one-shot data correction PR before the type change merges.
- Change `EditableSite` to use the DU per decision 1. Update consumers (renderer, editor, validator, agent tools) to narrow on `styleKit === 'custom'`. The validator's check stays as-is — it now backs the DU at the JSONB boundary.
- Change `ElementNode` to use the DU per decision 2. Delete `requireTextProps`, `requireMediaProps`, `requireActionProps`, `requireShapeProps`, `requireContainerProps`, and the matching `NonNullable<…>` return types in `engine.ts`. Update the layout engine's call sites to discriminate via `node.element.type`.
- Add a smoke that round-trips a `'custom'` `EditableSite` through `validatePublishedSnapshot` → JSONB → `validatePublishedSnapshot` → typed read, and asserts the narrowed `customStyleKit` is present. Same shape smoke for one `ElementNode` per branch.
- Decide separately whether `SectionRecipeId 'custom'` should remain a sentinel or become an absence (optional `recipe?: { id: AgentRecipeId; … }`). Separate ADR if either direction matters enough to commit.
- Sweep the schema comments that today describe the discriminator-sibling invariant; either delete them (the type now says it) or move them into JSDoc on the DU branches.
