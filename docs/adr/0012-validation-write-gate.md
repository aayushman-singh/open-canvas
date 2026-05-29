# ADR 0012 — `canvas/validate.ts` is the only write gate; consumers trust its output

**Status:** Proposed
**Date:** 2026-05-28
**Author:** Aayushman Singh
**Drives:** the validation-coverage theme from the rev01 OSS code review (handoff-rev01-batch-27 §"Theme B"), and consolidates findings from batches 4, 9, 10, 11, 22, and 24.

## Context

An Owner who clicks "Save" or "Publish" expects that whatever the system accepted will render without crashing, will survive a co-edit round-trip, and will look the same in the visitor as it did in the editor preview. If a field is malformed — wrong type, missing required sibling, an unrecognized enum value — the Owner expects to see a clear error at save-time pointing at the bad field, not a render-time blank screen, not a publish-time "something went wrong," and not a quiet drop of the field on disk.

Today, the system holds that contract unevenly:

- `src/canvas/validate.ts` exposes `validateEditableSite` and `validatePublishedSnapshot`. The verification pass (`handoff-rev01-batch-28` §4 row 7) confirms all seven previously-flagged PublishedSnapshot fields are now covered: `ogImageAssetId`, `canonical`, `noIndex`, `page.locale`, `customStyleKit`, `darkModeEnabled`, `faviconAssetId`. The originally-claimed coverage gap is closed.
- However, consumers do not yet uniformly trust validate.ts as the only gate. `src/routes/api/publish.ts` redundantly spreads validated state into its own shape; `src/routes/api/sites.ts` materializes some fields a second time; `src/editor/canvas-client.ts` runs a pre-flight check before submitting (`batch 16 #9`). Each redundant check is a place where the contract can silently drift away from validate.ts and produce a "the editor said it was fine but the server rejected it" Owner-facing inconsistency.
- The validator itself accumulated locally-helpful idioms (date parsing, id-format checks, "one of" assertions) some of which were extracted recently (`assertOneOf`, `validateInjectionSafeString`, `isParseableDate`) and some of which are still inline. Coverage is correct today; the *contract that future fields are covered* is not load-bearing — adding a new field to the schema does not fail the validator's compile, so a contributor can ship "the schema knows about it, the validator doesn't" silently.
- Id-format validation is partially uniform: `isAssetIdLike` covers asset ids; element/section/page id format checks live inline at each call site and have drifted (`SITE_ID_RE` lives in five files per `handoff-rev01-batch-28` §4 row 5, two of which inline the regex rather than importing).

The Owner-perceived risk is concrete: a field accepted by the editor but rejected by the server (or vice versa) shows up as "rev01 lost my work" or "rev01 won't let me save what's already saved." The risk is small while the consumers happen to agree with validate.ts. It grows every time a new field lands and someone forgets to update either the validator, the route check, or the editor pre-flight.

## Decisions

1. **`canvas/validate.ts` is the only write gate. Every write path runs it; no consumer adds parallel validation logic.**

   **Why:** the contract the Owner depends on — "if it saved, it works" — has to live in exactly one place or it lives in zero places. Today multiple consumers re-derive partial versions of that contract (publish.ts spreads, sites.ts materializes, canvas-client.ts pre-flights). Each re-derivation is a chance for the consumers to disagree with validate.ts on what "valid" means. Trusting validate.ts as the single source means: the route handler runs `validatePublishedSnapshot`, branches on the result, and from that point treats the snapshot as a fully-typed, fully-shaped value with no further runtime defensiveness. The editor runs the same function (or a stricter editable-state variant) and shows the Owner exactly the same errors the server would show.

   This is wrong if any consumer has access to context the validator does not — e.g. database-side uniqueness checks the validator cannot perform. Those are not validation in this ADR's sense; they are integrity checks downstream of validation and remain in their natural homes (DB constraints, route-level cross-record checks).

2. **The validator's coverage of every schema-declared field is enforced at compile time by a registry-driven exhaustiveness check, not by author discipline.**

   **Why:** "current coverage is correct" (per the verification pass) is a frozen-in-time property. A new schema field added in `src/canvas/schema.ts` does not, today, fail the validator's typecheck if the validator never reads it. The validator silently allows the new field to pass through unvalidated; the bug appears when the new field reaches a consumer that assumed validate.ts had checked it. The fix is a type-level link: the validator exhaustively visits a registry whose keys are the schema's field names, so that adding a field to the schema (without adding a registry entry) is a compile error. This is the same idiom ADR-0011 uses for element dispatches — a mapped type over a closed key set. The exact registry shape is implementation detail; the property is "the validator cannot ship while the schema has an unvalidated field."

   This would be wrong if the schema legitimately had "optional opaque metadata that the validator should accept without inspecting" — but the codebase has no such field today and the no-fallback rule (CLAUDE.md) explicitly disallows the "we accept whatever, the consumer can defend itself" pattern.

3. **One predicate per id-class, exported from `canvas/validate.ts` (or a sibling module), is the only definition of what each id shape means.**

   **Why:** the verification pass found `SITE_ID_RE = /^[A-Za-z0-9-]+$/` defined in five files; two of them inline the regex rather than importing it, so any change to the shape (say, allowing underscores) requires finding all five and fixing them by hand. The same drift is forming around element ids, section ids, page ids, asset ids, and font ids — every consumer that touches these has its own check. The decision is: every id class has exactly one exported predicate (`isSiteId`, `isElementId`, `isAssetId`, …), and every consumer imports it. The regex source lives next to the predicate. Changing an id shape is then a single-file edit.

   `canvas/validate.ts` is the natural home because validation is already its job; if it grows uncomfortably large, the predicates split into `canvas/id-shapes.ts` as a pure module the validator imports. The cross-server delivery problem (the editor's template-literal-bound script cannot import TS modules) is ADR-γ's; this ADR specifies the predicate's *single source*, not its distribution.

4. **The error format is one shape across every validator output: `<path.to.field> <verb> <constraint> (got <actual>)`, produced by shared helpers.**

   **Why:** the editor surfaces validation errors to the Owner as a list. If half the errors say `customStyleKit is required when styleKit === "custom"` and the other half say `page[0].locale must be a non-empty BCP-47 string when present (got 123)`, the Owner reads two different vocabularies. Worse, a test that asserts on error text has to know which idiom each branch uses. The shared helpers `assertOneOf` and `validateInjectionSafeString` already produce a uniform shape; the decision is that every error string in the validator goes through such a helper (`assertShape`, `assertOneOf`, `assertInjectionSafe`, `assertParseableDate`, etc.) so the format is enforced by the helpers, not by author discipline. The Owner sees a consistent error list; tests can assert on stable shapes.

5. **`validatePublishedSnapshot` is strictly stricter than (or equal to) `validateEditableSite`: anything the editor accepts must publish, modulo fields that are explicitly required-only-at-publish (and that distinction is itemized in code).**

   **Why:** the Owner edits in the editor and publishes from the editor; if the editor accepts a state that publish rejects, the Owner cannot proceed without losing data. Today the two validators evolve independently; nothing prevents them from disagreeing in directions other than "publish requires X that edit does not." The decision pins the relationship: edit is a subset of (or equal to) publish on every field except an enumerated list of "publish-only required" fields (e.g. an Owner can save a draft with no published slug but cannot publish without one). The list is a constant in `validate.ts`; both validators consult it; a smoke asserts the only differences between the two are entries in the list.

   This is wrong if the product introduces "fields that are optional at publish but required for edit" (unusual but conceivable for some collaborative-locking model). At that point the list grows two-sided and the smoke adjusts; the contract — "differences between the two are enumerated, not implicit" — stays.

6. **The renderer does not validate. The encoder/decoder does not validate. The agent tool does not validate. They trust validate.ts has run.**

   **Why:** the codebase carries several "force-validate at render time" patterns (`emitHeadMeta(page)` called for its throw side effect in `render.ts`, `getStyleKitPreset(snapshot.styleKit)` called only to throw — per handoff-rev01-batch-27 §"Theme J"). Each is a runtime-validation-of-types pattern that hides where validation actually belongs. The decision is: if validate.ts ran and said `{ valid: true }`, every downstream consumer treats its input as fully shaped. Defensive re-checks at render/encode/decode/agent-apply time are deleted; their failure modes become validate.ts's responsibility to surface at save-time instead. The renderer becomes a pure function of validated input.

   This is wrong only if validate.ts can be bypassed — which decision 1 forbids. The two decisions reinforce each other.

## Out of scope

- Database integrity checks (uniqueness, foreign-key existence, ownership). These are not validation in the sense this ADR uses; they remain in route-handler boundary code.
- Yjs document validation (whether the Y.Doc representation is well-formed). The encoder/decoder is a translator between two valid shapes; if both endpoints are validated, the translator does not need its own gate.
- Editor-side live validation UX (showing red squiggles as the Owner types). The decision here is what validates and where; how the editor presents the errors is a UX concern.
- Schema evolution / migration of stored sites whose old shape predates a current required field. That is a one-shot migration concern, separate from the write-gate contract.
- Type-level validation via libraries (Zod, Valibot, etc.). The decision is that there is one validator; whether that validator is hand-rolled or generated from a schema library is implementation detail.

## Consequences

**Positive:**

- The Owner sees one consistent contract: if save succeeded, the state is good. No "saved fine, published broken" surprises.
- The codebase loses three classes of duplicate-validation noise: publish.ts spread cleanup (batch 22 #1), sites.ts materialization removal (batch 23 #6), canvas-client.ts pre-flight delete (batch 16 #9). All three were waiting on the validator being trustworthy; the verification pass shows the coverage is now there, and this ADR makes the trust explicit.
- The renderer becomes shorter and faster — every "validate-as-side-effect" call goes away.
- A new schema field cannot ship without a validator entry. The "added the field, forgot the check" failure mode disappears at compile time.
- Id-shape changes become a one-file edit. The five SITE_ID_RE sites collapse to one source and four imports.

**Negative:**

- Removing the redundant consumer checks is a behavior change in failure modes: where previously a bug in validate.ts would be caught by one of the duplicate gates, after this ADR it sails straight to the renderer. The mitigation is the exhaustiveness check (decision 2) and the editor/publish parity smoke (decision 5); together they should catch validator regressions before code review.
- Decision 2's registry-driven exhaustiveness adds a structural commitment: every schema change is also a validator-registry change. Contributors learn to expect this. The compiler enforces it.
- The single error format constrains how validators express constraints — a field with a genuinely novel constraint shape has to fit the `<path> <verb> <constraint> (got X)` mold or extend the helper set. Most constraints fit; complex cross-field constraints sometimes don't (e.g. "field A must equal field B's length"). Those will need new shared helpers, not bespoke error strings.
- Id-class predicates may live separately from the things that produce ids (the route that mints a new site id needs to import `isSiteId`). One more import; modest cost.

## Follow-ups

- Execute the three unblocked cleanups (publish.ts spread, sites.ts materialization, canvas-client.ts pre-flight). Each closes a finding and reinforces decision 1 by removing a parallel-validator surface.
- Land the SITE_ID_RE consolidation: one exported predicate, five callers updated. The two inline-regex callers (`src/live/socket-route.ts:26`, `src/live/site-room.ts:287`) get the import; `canvas-client.ts` is blocked on ADR-γ for cross-server delivery.
- Write a smoke that introspects the `EditableSite` type at build time (via a generated schema or a manually-maintained field registry) and asserts every field appears in the validator's registry. The exact mechanism depends on whether the codebase grows a build-time schema introspection helper; until then a hand-maintained registry plus a smoke is the practical floor.
- Extend the same registry-driven coverage check to `PublishedSnapshot` and itemize the "publish-only required" list (decision 5).
- Audit the remaining "force-validate at render time" call sites identified in handoff-rev01-batch-27 §"Theme J" and delete them in a single sweep PR.
- Ship an "enum-source smoke" that pins the relationship between `src/canvas/schema.ts` and `src/agent/canvas-tools.ts`: every enum list referenced inside a `JsonSchema.enum` field in `canvas-tools.ts` must be the spread of a constant imported from `schema.ts` (or an explicitly-justified per-tool subset). The hand-rolled validator-and-LLM-schema split (per decision 2, kept because schema fields land rarely) leaves a single drift class — enum lists added in `schema.ts` that the LLM schema never learns about. The smoke catches that class without forcing the foundation rewrite that a JSON-schema-native library would. Failure mode it prevents: a new `INLINE_MARK_TYPES` entry that the validator accepts but the LLM never emits, so the model invisibly under-uses the feature.
- ADR-0011 (element registry) interacts: when per-element modules ship, each one becomes the natural home for its element-specific validation. The validator dispatches on element type just like the renderer does. Sequence: ADR-0012 (this) lands the contract; ADR-0011 lands the element-side mechanics; the validator's element-case `switch` collapses to a `VALIDATE_DISPATCH` call.
