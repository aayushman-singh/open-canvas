# ADR 0064 — EditorContext decomposes into narrow named-Pick contexts per consumer

**Status:** Accepted
**Date:** 2026-06-05
**Accepted:** 2026-06-05
**Author:** Aayushman Singh
**Drives:** [ADR 0058](0058-editor-context-as-iife-closure-mirror.md) named follow-up — "split `EditorContext` into smaller named contexts (`StateContext`, `DomContext`, `RenderContext`, `PersistContext`, `SelectionContext`). Each extracted module's signature changes from `(ctx: EditorContext, …)` to the narrow context(s) it actually needs."

**As-built (2026-06-05):**
- The canonical five named-Pick aliases — `StateContext`, `DomContext`, `SelectionContext`, `RenderContext`, `PersistContext` — plus `StatusEmitterContext` for the cross-cluster `setStatus` verb live at the bottom of [`src/editor-client/editor-context.ts`](../../src/editor-client/editor-context.ts) (commit `819564f`).
- First carve landed on [`src/editor-client/delete-shortcut.ts`](../../src/editor-client/delete-shortcut.ts) (commit `c2c4a61`): `handleDeleteShortcut`'s parameter type drops from `EditorContext` (~150 members) to `DeleteShortcutContext = SelectionContext & StateContext & StatusEmitterContext & Pick<EditorContext, 'isEditableShortcutTarget' | 'deleteElement' | 'handleSectionAction'>` (10 members).
- Per Decision 4 — remaining module signatures stay on `EditorContext` and migrate opportunistically. There is no big-bang sweep; the ADR is "Accepted" because the design pattern is committed and the first consumer proves it. The lazy cluster contexts from Decision 5 (`InspectorMountContext`, `ChatContext`, `CoEditContext`, `AiContext`, `ConfigContext`) land when a module signs against them.

## Context

[ADR 0058](0058-editor-context-as-iife-closure-mirror.md) shipped a 1:1 mirror of the editor IIFE's closure surface as the `EditorContext` interface. ADR 0015 Phase 3 cutover landed alongside the final Phase 2 extractions; the editor route now serves the bundled entrypoint and `createEditor(boot)` is the live boot orchestrator. `EditorContext` is no longer a migration aid — it is the live coupling surface for every module in [`src/editor-client/`](../../src/editor-client/).

The interface carries roughly 150 members across 32 phase markers ([`editor-context.ts:59-580`](../../src/editor-client/editor-context.ts#L59)). Every module signs as `(ctx: EditorContext, …)`. The signatures cost nothing to write but they:

- **Hide coupling.** A reader cannot tell from `(ctx: EditorContext)` whether the module touches DOM, state, render, or all three. The interface name asserts no contract beyond "it is editor wiring."
- **Block isolation tests.** A unit test for one module has to mock the full interface — ~150 fields including DOM nodes, async helpers, and CRDT machinery — even when the module reads two fields.
- **Make field renames invisible.** Renaming `state` → `editable` on `EditorContext` would land cleanly, but a reader of any module signature would never know whether the rename narrowed or widened its surface, because the module didn't declare its surface.

ADR 0058 Decision 5 named this debt and committed to revisit. The post-Phase-3 follow-up is this ADR.

The constraint that drives every decision below: **`EditorContext` itself stays as the boot-side shape `createEditor` constructs**. Decomposition adds named views on top, not new objects. Boot ordering, runtime-helpers wiring, and the existing 1:1 mirror are unchanged. The change is purely at the parameter-type layer — `(ctx: EditorContext, …)` becomes `(ctx: SelectionContext & StateContext, …)` per consumer, with `EditorContext` assignable to every named view by structural subtyping.

## Decisions

1. **Named context interfaces are declared as `Pick<EditorContext, K>` aliases in [`editor-context.ts`](../../src/editor-client/editor-context.ts), one per cohesive cluster the IIFE-closure phase markers already group around. Modules sign their parameters as the named view(s) they touch.**

   The canonical five from ADR 0058's follow-up land first:

   ```ts
   export type StateContext = Pick<EditorContext,
     'state' | 'findElement' | 'findSection' | 'currentPage'
   >;
   export type DomContext = Pick<EditorContext,
     'root' | 'inspector' | 'sidebar' | 'mainEl' | 'statusEl' | 'viewport'
     | 'saveButton' | 'publishButton' | 'versionBadge' | 'saveTemplateButton'
     | 'chatToggleBtn' | 'chatPanelEl' | 'chatCloseBtn'
     | 'chatSelectionEl' | 'chatSelectionTextEl' | 'chatSelectionClearBtn'
   >;
   export type SelectionContext = Pick<EditorContext,
     'selectedElementId' | 'selectedSectionId' | 'editingElementId'
     | 'selectElement' | 'selectSection' | 'clearSelection'
   >;
   export type RenderContext = Pick<EditorContext,
     'renderAll' | 'renderInspector' | 'rebuildElement' | 'preserveInspectorScrollFor'
   >;
   export type PersistContext = Pick<EditorContext,
     'scheduleSave' | 'captureForUndo' | 'authFetch' | 'apiBase' | 'siteId'
   >;
   ```

   **Why named-Pick instead of independent interfaces:** the `Pick<>` mechanic gives free structural subtyping — `EditorContext` is assignable to any `Pick<EditorContext, K>` with zero ceremony, so `createEditor` keeps minting `EditorContext` and every caller that already has `ctx: EditorContext` can pass it to a narrow consumer. Renaming or removing a field on `EditorContext` surfaces as a compile error inside the `Pick<…>` literal next to the alias, not as a silent drift in a sibling interface. The alias name carries the semantic intent; the `Pick<>` carries the implementation.

   This would be wrong if isolation tests needed to mock a `StateContext` without depending on `EditorContext` at all. They do not — every editor module is consumed by `createEditor`, which holds the wide shape; an isolation test mocks the narrow view as a plain object literal whose shape `Pick<EditorContext, K>` accepts.

2. **A module's parameter type is the intersection of the narrow contexts it touches, plus an inline `Pick<EditorContext, …>` of any verbs that do not belong to a named context. Verbs that ten modules need (`setStatus`, `closeElementMenu`) get their own one-field `Pick` aliases (`StatusEmitterContext`, `MenuContext`); verbs that two modules need stay inline at the call site.**

   ```ts
   // Two named clusters, two cross-cutting verbs.
   export function handleDeleteShortcut(
     ctx: SelectionContext & StateContext & StatusEmitterContext & Pick<EditorContext,
       'isEditableShortcutTarget' | 'deleteElement' | 'handleSectionAction'
     >,
     ev: DeleteShortcutEvent,
   ): DeleteShortcutOutcome { … }
   ```

   **Why intersection rather than a per-module catch-all interface:** intersection lets each name carry one concept. `SelectionContext & StateContext` reads as "this module touches selection state and queries site state" — both true facts about the module. A bespoke `DeleteShortcutContext` interface would name nothing the reader doesn't already get from the function name. Inline `Pick` for one-off verbs keeps the cost of declaring a new alias proportional to its reuse: a verb used twice stays inline, a verb used everywhere earns a name.

   This would be wrong if intersection signatures became too dense to read at the call site. They do not in practice — the densest modules touch 3–4 named contexts plus 2–3 inline verbs, which fits one signature line in monospace at editor width. The escape hatch for a module that genuinely needs 8+ surfaces is to keep signing as `EditorContext` (Decision 4) until the module decomposes structurally.

3. **`EditorContext` stays as the wide live shape — the boot-side type `createEditor` constructs, the type `createEditorContextSkeleton` returns, the type `installRuntimeHelpers` writes onto. Every narrow context is a view, not an independent object.**

   **Why:** there is exactly one runtime `ctx` object per editor session. Splitting it into multiple objects (each a separate `{state, findElement, …}` allocation) would cost: a) re-wiring boot to mint N objects, b) deciding which object owns shared mutable state (`state`, `selectedElementId`), c) cross-object call paths for `setStatus` from a module that holds only `SelectionContext`. A view-only decomposition pays none of these costs while delivering the readability and isolation-test wins the ADR is aimed at. The single `ctx` identity also keeps Yjs / co-edit invariants intact — every module that reads `ctx.state` reads the same object the autosave callback sees.

   This would be wrong if the editor needed multiple runtime contexts (multi-site editing, per-tab isolation). It does not — the editor is a single-instance browser runtime per tab, by ADR 0058 Decision 2.

4. **Migration is per-touched-module, opportunistically. There is no big-bang sweep that retypes every module to its narrow context.**

   When a module is touched for any reason — bug fix, feature, refactor — its signature is narrowed to the matching context(s) as part of the same commit. A module that is not touched stays as `(ctx: EditorContext, …)` until its turn comes.

   **Why:** wholesale retyping would be a single ~92-file commit that touches every module's signature, body, and import. Review attention would scatter across modules that nobody is editing. Opportunistic narrowing pays the cost on the commits that already have the module open. The named-context aliases land in one commit (the alias declarations); per-module narrowing lands incrementally as the codebase moves.

   The risk is that some modules never get touched and stay on `EditorContext` forever. Acceptable — those modules also have stable shape and low coupling pressure, which is the case for staying wide. If a coupling problem surfaces on a wide-typed module, that surfacing IS the touch that triggers the narrowing.

5. **`InspectorMountContext`, `ChatContext`, `CoEditContext`, `AiContext`, `ConfigContext` are named in the canonical list but land lazily — each gets declared on the first commit that needs it.** The five canonical contexts from Decision 1 land upfront because they cover the broadest call surface. The cluster-specific ones land when a module signs against them.

   **Why:** declaring all ten upfront would mean shipping unused aliases — review cost without consumer to validate the boundary. Lazy declaration ties each alias's existence to a real call site that asserts the boundary works. The five upfront contexts are the ones every cluster of modules touches; the cluster-specific ones are by definition narrower in reach.

## Out of scope

- **Refactoring `EditorContext` itself.** This ADR does not add, remove, rename, or restructure fields. The wide interface stays exactly as it is post-Phase-3. Future cleanup commits can prune dead fields under their own ADR moment.
- **Multi-instance editors.** Per Decision 3, the editor is single-instance. Multi-instance support would invalidate the single-`ctx` assumption and is its own design problem.
- **`Pick`-vs-independent-interface choice for the canvas-side modules** ([`src/canvas/elements/`](../../src/canvas/elements/), [`src/canvas/`](../../src/canvas/)). Those modules don't take an editor context; their dispatch shape is ADR 0011 and is unaffected by this ADR.
- **Test infrastructure for isolated module tests.** Naming the narrow context unlocks unit-testability; writing the unit tests is a separate workstream that follows the per-module touches.
- **The ten-context full list as a commit-now sweep.** Decision 5 schedules the cluster-specific contexts lazily; this ADR commits only to the canonical five plus `StatusEmitterContext` for the most-touched verb.

## Consequences

**Positive:**

- **Coupling becomes visible at signatures.** A module that takes `SelectionContext & StateContext & StatusEmitterContext` declares its full coupling to the editor; a reviewer can audit the surface without opening the body.
- **Renames of `EditorContext` fields surface inside the `Pick<>` literal in `editor-context.ts`** — one place, next to the named alias. Cross-module drift is impossible: TS resolves the Pick to the live interface at type-check time.
- **Per-module isolation tests become writable.** A test for `handleDeleteShortcut` mocks ~10 fields, not ~150.
- **Opportunistic migration costs nothing on its own.** Commits that touch a module narrow its signature as part of the same change; commits that don't touch it pay nothing.
- **The wide `EditorContext` doesn't go away** — it remains the boot-side shape and the fallback for modules that don't yet fit a narrow contract. Decomposition is additive, not subtractive.

**Negative:**

- **Intersection signatures get verbose** for modules with 4+ context touches. Mitigations: factor a module's split (does the surface decompose into smaller modules?), introduce a per-cluster named context (Decision 5's lazy schedule), or accept the verbosity as honest documentation of the coupling.
- **Two ways to declare a parameter type now exist** (`EditorContext` or a narrow view). Until every module migrates, signatures are heterogeneous. This is the per-touched-module migration cost; Decision 4 accepts it.
- **No silver bullet for cross-cutting verbs.** `setStatus`, `closeElementMenu`, `findElement` are used by ~all clusters. The ADR's answer (one-field `Pick` alias when reuse is high, inline `Pick` when reuse is low) is a judgment call per verb, not a uniform rule. The judgment is documented next to each alias.
- **The `Pick<>` shape couples narrow aliases to field names on `EditorContext`.** Renames are still mechanical (Find/Replace in `editor-context.ts`), but a field rename + narrow-alias rename happen in the same commit. Independent interfaces would have decoupled the rename schedule; the trade is per Decision 1.

## Follow-ups

- **Land the canonical five context aliases + `StatusEmitterContext`** in [`editor-context.ts`](../../src/editor-client/editor-context.ts) as the alias-declaration commit. No module signatures change in this commit.
- **First carve: `delete-shortcut.ts`.** Narrow `handleDeleteShortcut`'s signature to `SelectionContext & StateContext & StatusEmitterContext & Pick<EditorContext, 'isEditableShortcutTarget' | 'deleteElement' | 'handleSectionAction' | 'currentPage'>`. The carve demonstrates the intersection-of-Picks pattern on a real consumer; the existing [`delete-shortcut:smoke`](../../src/editor-client/delete-shortcut.smoke.ts) proves the runtime contract is unchanged.
- **Per-touched-module narrowing**, opportunistically. When you touch a module for any reason, narrow its signature as part of the commit.
- **Lazy cluster contexts** — `InspectorMountContext`, `ChatContext`, `CoEditContext`, `AiContext`, `ConfigContext` get declared on the first commit that needs them. The aliases live in `editor-context.ts` next to the canonical five.
- **Dead-field audit** post-decomposition — once enough modules narrow, fields on `EditorContext` that no `Pick<>` references are candidates for removal. Track this as a follow-up ADR moment, not as inline cleanup.

## References

- [ADR 0058](0058-editor-context-as-iife-closure-mirror.md) — the migration-aid shape this ADR decomposes.
- [ADR 0015](0015-editor-client-asset-pipeline.md) — Phase 3 cutover; `createEditor` is the live entry point.
- [ADR 0011](0011-canvas-element-registry.md) — canvas-side dispatch pattern; unaffected by this ADR but the same minimum-coupling philosophy.
