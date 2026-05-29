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

## Audit (2026-05-30)

Audited against the `adr-quick-wins` worktree (branched off `adr-0011-element-registry` at commit `e7a107d`).

| Decision | Status | Evidence | Gap |
|---|---|---|---|
| 1 — only write gate | Partial | publish.ts spread now clean (L470-479); `validateNavLinkEdit` pre-flight + `applyPinnedStyle.pinnedStyleValueIssue` still in `editor/canvas-client.ts` (L1590-1605, L3964-3969); `routes/api/canvas.ts` settings PUT (L267-302) + SEO PUT (L343-368) re-check `darkModeEnabled`/`faviconAssetId`/`noIndex`/`title` shapes that `validateEditableSite` already covers (L1078-1082, L1152-1161); `routes/api/sites.ts:510-519` materializes `styleKit` as a denormalized DB column alongside the JSON blob. | Drop the `styleKit` denorm; strip the route-level shape checks; delete the editor pre-flight (canvas-client.ts edits blocked on ADR 0014/0015 backtick discipline). |
| 2 — registry exhaustiveness | Non-compliant | `validateSiteShape` (validate.ts:1123-1204) is a hand-rolled `if (state.X !== undefined) {…}` chain. Zero `satisfies Record<keyof EditableSite, …>` constructs in `src/`. Adding a new optional field to `EditableSite` compiles cleanly even if the validator never reads it. | Introduce `FIELD_VALIDATORS: Record<keyof EditableSite, (v) => void>` (or equivalent mapped-type) so coverage is typechecked the same way INSPECTOR_DISPATCH enforces element coverage. |
| 3 — id predicates | **Done** | `SITE_ID_RE` + `isSiteId` now exported from `validate.ts`; the 5 call sites (`editor/canvas-client.ts:32`, `editor/route.tsx:40`, `routes/api/on-site-edit.ts:38`, inline-regex in `live/socket-route.ts:26` + `live/site-room.ts:274`) all consume the single source. `validateBackgroundVideo` (validate.ts:996) routes through `isAssetIdLike` instead of inlining the asset-id regex. | Element/section/page-id predicates remain unbuilt; treat as a follow-up once a second call site asks for one. |
| 4 — uniform error format | Partial | Shared helpers (`assertOneOf`, `validateInjectionSafeString`, `describe`) drive ~84 of the error-push sites. ~30 bespoke pushes remain: `validate.ts:1116,1119,1125,1135,1163,1262` (state.X must…); duplicate-id pushes at 464, 549, 876, 1173, 1180 (no `assertUnique` helper); finite-number box checks at 165-174 (no `assertFiniteNumber` helper); text-content path at 481 uses an `"text element <id>."` prefix instead of a dot path. | Add `assertNonEmptyString`, `assertBoolean`, `assertFiniteNumber`, `assertUnique`, `assertRequired` helpers; route the remaining inline pushes through them. |
| 5 — publish ⊇ edit parity | Partial | `validatePublishedSnapshot` reuses `validateSiteShape` (validate.ts:1253-1276, guaranteeing the subset relation structurally) and layers `version >= 1` + `publishedAt`-parseable + media-asset-non-empty on top. But no exported `PUBLISH_ONLY_REQUIRED_FIELDS` constant enumerates the additions, and no smoke fuzzes editable states to assert `validateEditableSite(s).valid ⟹ validatePublishedSnapshot({...s, version: 1, publishedAt: now}).valid`. | Define the constant; add the smoke. |
| 6 — downstream no-validate | Partial | `render.ts:294-307` still calls `void getStyleKitPreset(snapshot.styleKit)` for its throw side-effect — `canvas:smoke` pins this as the no-silent-fallback contract because the renderer's natural path emits the kit name as a data attribute and degrades silently on bad input. `emitHeadMeta(page)` throws are already cleaned up (0 matches). `agent/tool-parsers.ts` runs heavy parallel parsing/validation at parse-time (`isOneOf<ElementType>`, `parseBox`, `parseMotion`, enum guards), partially redundant with the post-apply `validateEditableSite` call in `canvas-agent.ts:128`; `agent/design-section-parser.ts` adds ~20 more enum guards. `yjs-projection.ts` is largely clean (two structural-invariant throws, not field-shape re-validation). | Refactor `render.ts` so the natural render path consumes the kit's preset in a load-bearing way (then the `void getStyleKitPreset` throw can go away without losing the no-silent-fallback contract). Decide whether agent parsers should be coercion-only (let validate.ts surface errors post-apply) or remain as a parse-time gate; if the latter, document the policy here. |

**Net:** decision 3 is done; decisions 1/4/5/6 are partially compliant with clear gap descriptions above; decision 2 is the largest remaining work.

## Follow-ups

- **Decision 1 cleanups:**
  - Drop the `styleKit` denormalized column in `routes/api/sites.ts:510-519` (read from the JSON blob on retrieval). DB schema change — needs a migration commit.
  - Strip the per-field shape checks from `routes/api/canvas.ts` settings/SEO PUTs (the `persistEditableState` boundary already runs `validateEditableSite`).
  - Delete `validateNavLinkEdit` + `pinnedStyleValueIssue` pre-flights in `editor/canvas-client.ts`. Blocked on canvas-client.ts editing discipline (backtick risk inside the template-literal body); fold into ADR 0014/0015 work if it sweeps the file anyway.
- **Decision 2:** introduce `FIELD_VALIDATORS: Record<keyof EditableSite, (v) => void>` and route `validateSiteShape` through it; a missing entry becomes a TypeScript compile error. Mirrors INSPECTOR_DISPATCH's mapped-type pattern from ADR 0011 Step 1.
- **Decision 4:** add `assertNonEmptyString`/`assertBoolean`/`assertFiniteNumber`/`assertUnique`/`assertRequired` helpers in `validate.ts`; sweep the ~30 inline `errors.push(...)` sites to use them.
- **Decision 5:** define `PUBLISH_ONLY_REQUIRED_FIELDS` constant; add a smoke that fuzzes editable states and asserts the subset relation.
- **Decision 6:**
  - Restructure `render.ts` so the natural render path looks up the kit preset in a load-bearing way (the kit's preset values flow into rendered output). Then `void getStyleKitPreset` deletes without the smoke regression the 2026-05-30 audit hit.
  - Settle the agent parser policy: coercion-only (delete the redundant enum guards in `tool-parsers.ts` + `design-section-parser.ts`) or parse-time gate (document why parsing duplicates `validate.ts` coverage).
- **Cross-ADR:** ADR 0011's per-element modules are the natural home for element-specific validation when that work happens — the validator's element-case branches become a `VALIDATE_DISPATCH` call mirroring `RENDER_DISPATCH` / `INSPECTOR_DISPATCH`. Sequence: this ADR (decision 2 mapped-type at the top level) → ADR 0011 element-validate-dispatch as the per-element layer.
- **Enum-source smoke:** every enum list referenced inside a `JsonSchema.enum` field in `agent/canvas-tools.ts` must be the spread of a constant imported from `schema.ts` (or an explicitly-justified per-tool subset). Catches the failure mode where a new `INLINE_MARK_TYPES` entry is accepted by the validator but never emitted by the LLM schema.
