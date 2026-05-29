# ADR 0027 — Yjs encode/decode dispatch stays central; per-element files do not gain yjs runtime dependencies

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** the open design question after [ADR 0011](0011-canvas-element-registry.md) Step 4 (Yjs encoder/decoder dispatch) landed `Y_ENCODE_DISPATCH` + `Y_DECODE_DISPATCH` inside `src/canvas/yjs-projection.ts` rather than moving the per-element encoders into the per-element modules under `src/canvas/elements/`.

## Context

[ADR 0011](0011-canvas-element-registry.md) decision 1 says the strong form of the registry principle:

> "Each element type has exactly one source-of-truth module that defines every behavior unique to that element."

Step 4 of the [ADR 0011](0011-canvas-element-registry.md) migration order (dec 3) targeted the Yjs encoder/decoder pair living in `src/canvas/yjs-projection.ts` — the highest-severity drift surface in the per-element fan-out, because a missing case in either side is a silent data-loss bug on round-trip.

The minimum-viable Step 4 (commit `219d2cd` on the `adr-0011-element-registry` branch) formalised both sides as mapped-type `Record<CanvasElement['type'], fn>` dispatches _inside `yjs-projection.ts`_. The encoder fan-out (~30 lines of `case 'text': return encodeTextElement(el);` etc.) collapsed into one dispatch index. The decoder side previously inlined every case in a single `decodeElement` switch (~226 lines); Step 4 extracted each arm into a named `decode<Type>Element(map, base)` function parallel to the encoders, then registered all 14 in `Y_DECODE_DISPATCH`.

Both dispatches catch "added an `ElementType` but forgot its encoder/decoder" at TypeScript compile time, mirroring `RenderDispatch` / `InspectorDispatch` / `AGENT_TOOL_DISPATCH` / `SIDEBAR_DISPATCH`. The existing round-trip smoke (`bun run yjs-projection:smoke`, which runs `decodeYDoc(encodeYDoc(state))` deep-equal against `home.json`, `enterprise-scale.json`, and a synthetic state covering every `ElementType`) is the runtime safety net.

The strong reading of [ADR 0011](0011-canvas-element-registry.md) dec 1 says the encoders should not have stopped at `yjs-projection.ts`. They should have moved into the per-element modules — `encodeTextY` / `decodeTextY` in `text.ts`, `encodeFormY` / `decodeFormY` in `form.ts`, and so on — with `yjs-projection.ts` reduced to assembling dispatches that re-export them.

The minimum-viable Step 4 stopped one move short. This ADR makes the stop deliberate and names what would need to change for the move to make sense.

A future contributor reading [ADR 0011](0011-canvas-element-registry.md) and the `yjs-projection.ts` source side by side will notice the gap. Without this ADR they will see the central placement as oversight or unfinished migration. They will move the encoders/decoders into per-element files in a "completing the migration" PR. The downstream cost — described in decision 1 — will not surface for them until the worker bundle has already grown and the renderer-only consumers have already started importing yjs transitively.

## Decisions

1. **Per-element files in `src/canvas/elements/*.ts` do not gain runtime dependencies on `yjs`.** The `Y_ENCODE_DISPATCH` and `Y_DECODE_DISPATCH` tables, the per-element encoder/decoder functions, and the per-element sub-shape helpers (`decodeFormFieldDef`, `decodeChartSeries`, `decodeAccordionItem`, `decodeCarouselSlide`, `decodeTableColumn`, `decodeTableRow`, `decodeNavLink`) all stay in `src/canvas/yjs-projection.ts`.

   **Why:** the editor's worker bundle already includes `yjs` because the co-edit subsystem uses it. The _renderer_ path does not include `yjs` and must not gain it — `src/canvas/render.ts`, `src/canvas/elements/index.ts`, and every per-element module are imported by the public visitor route, which the operator wants small and fast (rev01 ships on Cloudflare Workers with a per-isolate cold-start budget). A runtime `import * as Y from 'yjs'` at the top of `text.ts` would be evaluated by the module loader for every per-element module that any code path resolves, including the public renderer. Bundler tree-shaking does not save us here: `yjs` does work at module-init time (constructor registrations on its internal type registry), so the side effect of importing `text.ts` would always pull `yjs` into the worker bundle that serves `/site/<id>/<page>`.

   This would be wrong if a build pipeline existed that split the worker into renderer-only and editor-only bundles, or if `yjs`'s top-level side effects were eliminated. Neither holds today.

2. **`yjs-projection.ts` is the named exception to [ADR 0011](0011-canvas-element-registry.md) dec 1 for the Yjs concern.** Other concerns in the per-element ADR-0011 dispatch series (inspector, agent tool, sidebar) live in their owning element files. Yjs encode/decode does not. Future per-element concerns the same shape as Yjs (the concern needs a heavy module-init runtime library that the renderer must not pull in) are allowed to follow this precedent and stay central, with their own ADR naming the carve-out.

   **Why:** [ADR 0011](0011-canvas-element-registry.md) dec 1 expresses an ideal — "every behavior unique to the element lives in one file." The cost the ideal pays is "every dep that file's behaviors touch becomes a dep every importer transitively pays." For pure-data concerns (inspector field arrays, agent JSON-schema fragments, sidebar metadata), that cost is zero. For Yjs encode/decode it is the entire `yjs` package. The carve-out is the principled response: the rule's _purpose_ is making "added an element type, forgot one of its behaviors" a compile error, and the central `Y_*_DISPATCH` records achieve that purpose without the dep-spread cost. The principle is preserved; only the location is different.

   This would be wrong if dispatch-completeness were not the rule's load-bearing property — if, say, "developers should be able to find all of text's code in `text.ts`" were the actual point. Decision 1 of [ADR 0011](0011-canvas-element-registry.md) names compile-time exhaustiveness as the load-bearing property, not file co-location, so the carve-out is consistent with the spirit of the original.

3. **The carve-out is undone, automatically, when an editor-client / public-render bundle split lands.** [ADR 0015](0015-editor-client-asset-pipeline.md) is the most credible vehicle: when the editor ships as a separately-built browser bundle, the renderer's worker bundle no longer needs to share a TypeScript dependency graph with the editor, and the renderer-only path can ship without any of the editor-only modules being module-init-evaluated. At that point, per-element files can gain `yjs` deps without bloating the renderer worker, and the central placement loses its justification.

   **Why:** the carve-out exists because of a specific bundling constraint, not because the principle is wrong. Naming the bundling event that removes the constraint makes the carve-out self-revoking — when the constraint is gone, the carve-out is too, and the encoders/decoders move into per-element files without needing a separate ADR to re-litigate the principle. This also gives the move a clear trigger: the PR that ships [ADR 0015](0015-editor-client-asset-pipeline.md)'s split is the PR that should also schedule (in its follow-ups) the per-element encoder move.

4. **The Yjs dispatch tables (`Y_ENCODE_DISPATCH`, `Y_DECODE_DISPATCH`) are typed as full `Record<CanvasElement['type'], fn>` mapped types, not as `Partial<Record>` even during transitional states.** Step 4 landed both at full strength in commit `219d2cd`; no future PR is allowed to widen them back to `Partial` for a migration intermediate.

   **Why:** the dispatch's whole purpose is the compile-time exhaustiveness check. `Partial<Record>` regresses to "missing entry is silently fine, runtime throws." The round-trip smoke catches a missing case at runtime, but at that point a coverage gap has already been introduced and the contributor is debugging from a smoke failure rather than from a TS error. The full mapped type is the cheaper feedback loop and the cost of holding it (every PR that adds an `ElementType` adds both encode + decode entries in the same commit) is the work [ADR 0011](0011-canvas-element-registry.md) Step 4 was designed to enforce.

## Out of scope

- **Moving per-element sub-shape helpers (`decodeFormFieldDef`, `decodeChartSeries`, …) into per-element files.** Same reasoning: they call into Y types and the renderer must not pull `yjs` in. They stay alongside the dispatches in `yjs-projection.ts`.
- **A `canvas/yjs-helpers.ts` split.** Splitting `setIfDefined`, `encodeInlineRuns`, `encodePositionedBox`, etc. into a separate module is pure file-arrangement; it does not change the dep-graph and does not help with the central-vs-distributed question this ADR resolves. If the file grows beyond comfortable, a future refactor inside `canvas/yjs-projection.ts`'s scope can split helpers without ADR-level approval.
- **Renderer-only worker bundle split** — that is [ADR 0015](0015-editor-client-asset-pipeline.md)'s job, and this ADR is explicitly waiting on it (decision 3) before its own carve-out goes away.
- **`canvas/render.ts` itself adopting per-element renderer files** — the `RenderDispatch` table already wires `renderText`, `renderMedia`, etc. from per-element files. Renderers are pure-data-out, no runtime lib dep, so [ADR 0011](0011-canvas-element-registry.md) dec 1 holds for the renderer concern without carve-out. This ADR is about Yjs only.
- **A new round-trip smoke** — `yjs-projection:smoke` already exists and covers every `ElementType` via the synthetic fixture. Step 4's dispatch landing did not need a new smoke; this ADR does not introduce one.

## Consequences

**Positive:**

- The renderer's worker bundle stays free of `yjs`. The cold-start budget for the public visitor path is preserved.
- The compile-time exhaustiveness check for "added an element type, forgot its encoder or decoder" works exactly the same as if the encoders lived in per-element files. The Owner-perceived failure mode the dispatch tables prevent — silent data loss on round-trip after a forgotten case — is closed regardless of file location.
- The carve-out is named and bounded. A future contributor opening `yjs-projection.ts` and noticing the gap with [ADR 0011](0011-canvas-element-registry.md) dec 1 can read this ADR, understand the trade-off, and stop themselves from the "completing the migration" PR that would silently bloat the worker bundle.
- The trigger for revoking the carve-out (decision 3) ties the work to the same PR that makes it safe ([ADR 0015](0015-editor-client-asset-pipeline.md)'s bundle split), so the cleanup is automatic when the constraint is gone.

**Negative:**

- [ADR 0011](0011-canvas-element-registry.md) dec 1 reads as a universal "one source of truth per element" rule, and this ADR introduces an exception. A reader who has internalised the rule needs to know the exception exists; future per-element concerns the same shape need to either fit the original rule or write a follow-up ADR naming their own carve-out, which is a small ongoing process cost.
- `yjs-projection.ts` is now the file with the highest concentration of element-type-specific code. Edits to it carry a higher coordination cost — adding a new `ElementType` touches both the schema, the per-element file (for inspector/agent/sidebar/render), and this central file (for encode/decode). The dispatch records keep the touch sites concentrated to one block each, but they remain on the developer's checklist.
- The single round-trip smoke (`yjs-projection:smoke`) carries more of the safety contract than it would if the encoders/decoders lived in 14 per-element files each with its own smoke. The mapped types are still doing their compile-time job, but a regression in the smoke's coverage (e.g. someone trimming the synthetic fixture's `ElementType` coverage by accident) is now more load-bearing. The next maintainer of that smoke should know it is the canonical round-trip check for the entire `Y_*_DISPATCH` surface.

## Follow-ups

- When [ADR 0015](0015-editor-client-asset-pipeline.md) lands and splits the editor / renderer bundles: schedule a follow-up PR that moves `Y_ENCODE_DISPATCH`, `Y_DECODE_DISPATCH`, the 14 named encoders/decoders, and the per-element sub-shape helpers into `src/canvas/elements/*.ts` files. The dispatches become re-exports from `src/canvas/elements/index.ts`. `yjs-projection.ts` shrinks to the page/section orchestration logic and the shared helpers (`encodeInlineRuns`, `encodePositionedBox`, etc.) that are not per-element specific.
- That follow-up PR supersedes this ADR. Mark this one Superseded then, with a pointer to the PR.
- The `yjs-projection:smoke` synthetic fixture's `ElementType` coverage is currently asserted by the smoke's structure (every element type has a constructor in the fixture builder). Add an explicit assertion that `Object.keys(Y_ENCODE_DISPATCH).length === ELEMENT_TYPES.length` and that the synthetic fixture covers every type, so the safety contract decision 4 names is observable in CI rather than implicit in the fixture-builder's shape.
