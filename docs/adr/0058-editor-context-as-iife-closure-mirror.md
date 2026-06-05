# ADR 0058 — EditorContext is a 1:1 mirror of the IIFE closure, populated incrementally

**Status:** Accepted
**Date:** 2026-06-03
**Accepted:** 2026-06-05
**Author:** Aayushman Singh
**Drives:** [ADR 0015](0015-editor-client-asset-pipeline.md) Phase 2 source migration. Phase 2a–2g extracted 18 pure-leaf modules (~5% of the IIFE). Every remaining chunk reads or mutates IIFE-local state — `state`, `selectedSectionId`/`selectedElementId`/`editingElementId`, cached DOM refs, render and persist orchestrators, undo stack, AI busy flags. Pure-leaf extraction is exhausted; continuing requires a context object the extracted modules accept as a parameter. This ADR pins the shape of that object.

**As-built (2026-06-05):** the IIFE migration is complete. `src/editor/canvas-client.ts` no longer exists; the editor route at [`src/editor/route.tsx`](../../src/editor/route.tsx#L611) serves the bundled entry from `EDITOR_CLIENT_MANIFEST.canvasClientUrl`. [`src/editor-client/index.ts`](../../src/editor-client/index.ts) exports a real `createEditor(boot)` that mirrors the original IIFE boot: DOM ref caching → async initial-state fetch → renderAll → event-listener wiring → setStatus('Ready') → session keepalive → chat session setup. [`src/editor-client/editor-context.ts`](../../src/editor-client/editor-context.ts) carries the `EditorContext` interface, ~150 members spread across phase markers 2h.1.a through 2q.k. ADR 0015 Phase 3 cutover shipped alongside the final 2q extractions.

**The wide migration-aid shape is now the live shape.** Per Decision 5 and the named follow-up, decomposition into smaller named contexts (`StateContext` / `DomContext` / `RenderContext` / `PersistContext` / `SelectionContext`) is captured in [ADR 0064](0064-editor-context-decomposition.md).

## Context

Today's editor client runs inside one ~14,400-line IIFE returned by `canvasClientScript()` ([`src/editor/canvas-client.ts`](../../src/editor/canvas-client.ts)). The IIFE body closes over roughly 40–50 local variables: the loaded EditableSite, selection ids, cached DOM anchors, debounce timers, an undo/redo stack, AI-busy flags, render and persist orchestrators. Everything inside the IIFE just reads or calls those names directly — `state.pages[i]…`, `scheduleSave()`, `renderAll()` — because closure makes them all in-scope.

ADR 0015 Phase 2 has extracted the pure leaves: constants, mark tags, id generators, html-escape, section-role queries, mark queries, z-order helpers, css-escape, palette helpers, sidebar factories, dom builders. Each is a pure function (or set of pure functions) that takes plain inputs and returns plain outputs. None of them needs to see the IIFE closure.

The remaining ~95% does. The drag handler reads `state` and mutates it. The inspector renderer reads `state` and `selectedElementId` and writes into the cached `inspector` DOM ref. The chat orchestrator reads/writes AI-busy flags and the undo stack. Every chunk crosses the closure boundary.

Phase 3 of ADR 0015 will cut the editor route over from the inline template literal to a real bundle built by `scripts/build-editor-client.ts`. For that cutover to be a small, reviewable change, the bundle's entry point must do exactly what today's IIFE does — same DOM caching, same state initialisation, same event-listener wiring, same closure surface — with extracted modules sitting alongside as siblings rather than as inline code. The cutover is therefore "swap the delivery mechanism," not "redesign the editor's runtime model."

The minimal-drift design therefore needs:

1. A single TypeScript object that represents the IIFE closure surface.
2. A factory that constructs the object exactly as the IIFE constructs its closure today.
3. A convention for how extracted modules receive the object.
4. A way to grow the interface incrementally without blocking each Phase 2 extraction on a full top-to-bottom enumeration.

The constraint that drives every decision below: **every Phase 2 commit must be diff-reviewable as `s/<closure-var>/ctx.<closure-var>/g`**. A reviewer looks at N lines of IIFE inline code and N lines of extracted module and sees only the `ctx.` prefix.

## Decisions

1. **`EditorContext` is a single mutable TypeScript interface whose fields mirror, 1:1, the IIFE closure surface of `canvas-client.ts`. There is no hierarchical grouping, no split into smaller contexts, no read-only view.**

   **Why:** the chosen migration goal is Phase 3 cutover unblock, with diff reviewability as the optimisation axis. Hierarchical groups (`ctx.dom.root`, `ctx.persist.scheduleSave`) would force renames at every extraction site — `state` becomes `editable` to avoid `ctx.state.state.pages`, `scheduleSave` becomes a method on a sub-object, etc. Every rename is a place where the diff stops looking mechanical, which is a place where review attention is spent on the wrong thing. A flat interface that mirrors the closure preserves the property "the extracted module reads like the IIFE body with a `ctx.` prefix on each closure access."

   This would be wrong if the migration goal were testability-in-isolation, AI-navigable narrow contracts, or any concern that values declared coupling over diff reviewability. None of those is the chosen goal for this migration. Post-Phase-3 decomposition into `StateContext` / `DomContext` / `RenderContext` / `PersistContext` / `SelectionContext` is named in Follow-ups; the migration aid is one shape, the long-term shape is another.

2. **The IIFE body is lifted into a real TS function `createEditor(boot: EditorBoot): void` in [`src/editor-client/index.ts`](../../src/editor-client/index.ts). The function caches DOM refs, constructs the `EditorContext` object as a local variable, starts the same internally-handled async boot task today's IIFE starts, wires event listeners that close over `ctx`, and dispatches into extracted modules with `(ctx, …)` signatures.**

   **Why:** `createEditor` IS today's IIFE, lifted out of the template literal into a TS module. No paradigm shift, no new construct introduced. It keeps the current failure contract: initial-load errors are caught inside the editor client and surfaced through the editor status line, not leaked as an unhandled top-level promise. Each Phase 2h+ extraction moves a chunk of inline code out of `createEditor`'s body into a sibling module that takes `ctx` as a parameter; `createEditor` shrinks each phase until, by Phase 3, it's just the boot sequence (DOM caching → async initial state fetch with explicit error reporting → event-listener wiring).

   This would be wrong if the editor required server-side rendering or hydration — a factory that runs in the browser would not apply. It does not; the editor is entirely client-side after boot ([ADR 0015](0015-editor-client-asset-pipeline.md) §"Out of scope").

3. **Extracted modules consume `ctx` as the first parameter of plain function exports. No classes, no factories, no DI containers.**

   ```ts
   // src/editor-client/<chunk>.ts
   export function dragEnd(ctx: EditorContext, event: PointerEvent): void { … }
   export function scheduleSave(ctx: EditorContext): void { … }
   ```

   Helpers consumed by many modules (`scheduleSave`, `renderAll`, `findElement`, `selectElement`) live as fields on `ctx` so call sites read `ctx.scheduleSave()` — the same shape as today's `scheduleSave()`. Helpers private to one module stay as inner function declarations inside that module's file, invisible to callers.

   **Why:** the function-with-ctx pattern matches the IIFE-closure shape exactly. A reviewer reading `dragEnd(ctx, event)` sees the same function body the IIFE has today with `ctx.` prefixes. Classes would force a `new` site, method-binding decisions, and an instance-vs-static call decision per helper — three places where the diff stops being mechanical. DI containers are overkill for a single-instance editor whose dependencies are all known at build time.

   This would be wrong if the editor client already used class-shaped orchestration or needed multiple runtime instances with lifecycle-managed dependencies. It does not: the editor client is a single browser runtime whose existing shape is closure + function declarations, and the adjacent canvas modules are function-oriented ([`src/canvas/elements/`](../../src/canvas/elements/), [`src/canvas/`](../../src/canvas/)). Plain functions fit this migration.

4. **The `EditorContext` interface starts empty. Each Phase 2h+ extraction adds the fields its module touches when that extraction lands. The interface grows commit-by-commit; reviewers see the new fields next to the new usage, in the same diff.**

   **Why:** upfront enumeration requires reading the 14,400-line IIFE top-to-bottom and listing every closure variable before any extraction touches state. That work is heavier than every individual Phase 2 extraction it gates, and it lands in one commit that's hard to review (a giant interface with no usage). Incremental growth defers each field's review cost to the commit that actually uses the field — the smallest reviewable unit. Dead closure vars surface naturally: a Phase 2 extraction either reads the var (it becomes a `ctx` field) or doesn't (the var is dead and can be deleted in a separate cleanup commit).

   The risk of incremental growth is that the interface is incomplete during the migration — late-Phase extractions could discover the design doesn't fit. The risk is bounded: every closure var in the IIFE today is a primitive, a DOM node, a JSON object, or a function; none of those shapes are pathological in a TS interface. If a late discovery surfaces, the ADR is revised, not the migration retried.

   This would be wrong if the IIFE's closure variables were under active churn (new vars added, removed, renamed in each commit). They are not — the IIFE has been stable in shape for months; only its size grows.

5. **`EditorContext` is the migration-aid shape, explicitly not the long-term shape. Decomposition into smaller contexts is named as a post-Phase-3 follow-up.**

   **Why:** the wide-interface property (acceptable cost for diff reviewability during the migration) is the same property that makes `EditorContext` a poor long-term shape — modules can't declare narrow contracts, mocking for tests is heavy, coupling is invisible at module boundaries. Naming the decomposition as a follow-up commits to revisiting the shape once the migration is unblocked, so the wide interface doesn't ossify into the permanent design.

   This would be wrong if Phase 3 cutover were the terminal milestone and no further architectural work were planned. It is not — [ADR 0011](0011-canvas-element-registry.md) Step 5 (client renderer dispatch), [ADR 0020](0020-csp-nonce-for-editor-boot-blob.md) (CSP nonce), and [ADR 0021](0021-dashboard-shared-asset-bundle.md) (dashboard bundle) all sit downstream of Phase 3 and will all benefit from a decomposed editor module surface.

## Out of scope

- **Phase 3 cutover mechanics** — the editor route's switch from `canvasClientScript()` to the bundled `EDITOR_CLIENT_MANIFEST` URL is governed by [ADR 0015](0015-editor-client-asset-pipeline.md) and will land as its own commit-set when Phase 2 completes. This ADR's scope ends at "Phase 2 extractions consume `EditorContext`."
- **Post-Phase-3 decomposition into smaller contexts** — named in Follow-ups, deferred to a future ADR. The decomposition is real future work, not speculative; this ADR commits only to the migration-aid shape.
- **Source map dev/prod split** — [ADR 0015](0015-editor-client-asset-pipeline.md) Decision 4. Orthogonal to `EditorContext` shape.
- **ADR 0014's substitution mechanism** — already [Rejected](0014-template-literal-data-substitution.md). This ADR makes no claim about template-literal substitution; it operates on the bundled-module side of the cut.
- **Owner-facing UI changes** — none. `EditorContext` is an internal refactor; the editor's behaviour, surface, and Owner experience are unchanged at every Phase 2 boundary and at Phase 3 cutover.
- **Server-side validation or schema changes** — none. `EditorContext` mirrors editor-only IIFE closure; it does not change what `/apply` accepts or what the renderer emits.

## Consequences

**Positive:**

- **Diff reviewability per extraction.** Each Phase 2h+ commit reads as a mechanical extraction: N lines of IIFE inline code move into a sibling module, each closure access gains a `ctx.` prefix, the IIFE body shrinks by N. Review attention focuses on "did anything change besides the prefix?" — the answer should always be no.
- **Migration progress is visible as an interface field count.** When `EditorContext` stops growing, the IIFE is fully decomposed. The interface is the migration's scoreboard.
- **No new constructs introduced.** Plain TS interface, plain factory function, plain functions taking parameters. Nothing the rest of the codebase doesn't already use.
- **Dead closure vars surface during extraction.** A var that no extracted module reads is dead and can be deleted in a follow-up. The migration is also a cleanup.
- **ADR 0011 Step 5 (client renderer dispatch) unblocks.** A typed `CLIENT_RENDER_DISPATCH` can ship as a sibling module that takes `ctx` and dispatches per `ElementType`.

**Negative:**

- **`EditorContext` is a wide interface — ~40–50 fields when complete.** It's hard to mock in unit tests; modules don't declare narrow contracts; coupling between modules is not visible at the interface level. This cost is paid for the migration's duration and removed by the post-Phase-3 decomposition follow-up. Naming the follow-up explicitly is the mitigation; not naming it would let the wide shape ossify.
- **The interface grows commit-by-commit during the migration.** Reviewers of an early-phase commit can't see the eventual shape; they can only see the field count at HEAD. This is acceptable because the commits themselves are small (each Phase adds a handful of fields tied to one cohesive extraction).
- **No isolation testing during the migration.** The editor route still serves `canvasClientScript()` until Phase 3, so the existing editor smokes prove the production inline path, not the dead-code `src/editor-client/` path. Each Phase 2h+ extraction must therefore keep the `src/editor-client/` bundle buildable (`bun run editor-client:build`) and add a phase-specific parity/import smoke where feasible. Pure unit tests against extracted modules with a mocked `ctx` are deferred — they fit naturally with the post-Phase-3 decomposed contexts and are awkward against the wide migration shape.
- **`EditorContext` is migration-aid debt by design.** The post-Phase-3 decomposition is not optional; the wide shape is acceptable for ~10 extraction phases and becomes a maintenance burden if it persists past cutover. The follow-up below names the work; the next session that touches `src/editor-client/` post-cutover should land it.

## Follow-ups

- **Land empty `EditorContext` interface + `createEditor` factory stub** in [`src/editor-client/editor-context.ts`](../../src/editor-client/editor-context.ts) and the existing [`src/editor-client/index.ts`](../../src/editor-client/index.ts) entry point. Preserve the current entry point's `styles.css` import and build-smoke imports so `scripts/build-editor-client.ts` continues to emit both JS and CSS artifacts. No behavioural change — the editor route still serves `canvasClientScript()`. This commit gates the design without exercising it in production.
- **Phase 2h through Phase 2N: cohesive-chunk extractions**, each adding its touched fields to `EditorContext`. Suggested chunk boundaries (subject to discovery during extraction):
  - 2h: Inspector renderer + field builders
  - 2i: Drag/drop + resize handlers
  - 2j: Section toolbar + section-level orchestration
  - 2k: Chat panel orchestration + suggestion-card lifecycle
  - 2l: Render orchestrators (renderAll, renderInspector, renderCanvas)
  - 2m: Persist orchestrator (scheduleSave + authFetch) + undo/redo
  - 2n: AI integration (canvas-agent client, busy flags)
  - 2o: Selection + keyboard handlers
  - 2p: Co-edit / presence integration
  - 2q: Final cleanup — what remains in `createEditor` is just the boot sequence
- **Per-phase bundle + parity smoke** where feasible: run `bun run editor-client:build`, hand the same input to the inline IIFE path and the extracted module, and assert byte-identical output. Some phases (drag handlers, event-driven flows) won't admit a clean parity smoke; for those, add an import/build smoke for the extracted module and document the behavioural assertion the existing editor smoke must continue to satisfy on the production inline path.
- **Phase 3 cutover ADR** — separate ADR moment when all Phase 2 extractions complete and the editor route is ready to switch from inline template literal to bundled module.
- **Post-Phase-3 decomposition ADR** — split `EditorContext` into smaller named contexts (`StateContext`, `DomContext`, `RenderContext`, `PersistContext`, `SelectionContext`). Each extracted module's signature changes from `(ctx: EditorContext, …)` to the narrow context(s) it actually needs. Named-and-deferred work, not speculative — this is the long-term shape the migration is aimed at.
