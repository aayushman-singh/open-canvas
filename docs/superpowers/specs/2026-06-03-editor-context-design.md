# EditorContext design — brainstorm spec

**Date:** 2026-06-03
**Owner:** Aayushman Singh
**Decision-of-record:** [ADR 0058](../../adr/0058-editor-context-as-iife-closure-mirror.md)

This document is the brainstorm output that produced ADR 0058. It records the questions asked, the answers chosen, the reasoning behind each decision, and the alternatives rejected — context the ADR doesn't carry. The ADR is the canonical contract; this spec is the trail.

## Problem

`src/editor/canvas-client.ts` is a 14,372-line template literal returning the editor's IIFE-wrapped client script. ADR 0015 commits to extracting it into a real TS module tree under `src/editor-client/`. Phase 2a–2g landed 18 pure-leaf modules covering ~5% of the source. The remaining ~95% reads or mutates IIFE-local state (the loaded `EditableSite`, selection ids, cached DOM refs, debounce timers, undo stack, AI-busy flags, render and persist orchestrators).

Pure-leaf extraction is exhausted. To continue, extracted modules need a context object as parameter. The handoff named two open questions — mutable singleton vs. functional updates; cached DOM refs vs. queried — but those are downstream of the larger question: **what is the goal of the migration?** The shape of EditorContext depends entirely on what "done" looks like.

## Brainstorm trail

### Q1 — Migration goal (what does "done" look like?)

Four options surfaced:
- **A.** Phase 3 cutover unblocks. Mechanical refactor aid; minimise behavioural drift; optimise for diff reviewability.
- **B.** AI-navigable chunks. Each module declares a narrow contract; future work on one editor concern doesn't require holding 14k LOC in context.
- **C.** Testable in isolation. Each extracted module is unit-testable without a real DOM or state tree.
- **D.** Owner-facing improvements unblock. The migration enables CSP nonce, shared dashboard bundle, source maps — shape is whatever's quickest.

**Choice: A.** The migration is a means to Phase 3 cutover, and Phase 3 is the gate for ADR 0011 Step 5 (client renderer dispatch), ADR 0020 (CSP nonce), ADR 0021 (dashboard bundle). The chosen goal pulls every downstream decision toward "stay close to today's IIFE-closure model."

### Q2 — EditorContext boundary

Three options surfaced:
- **Everything 1:1 with IIFE closure** — ~40-50 fields mirroring today's closure surface. Mechanical `s/<var>/ctx.<var>/g` extraction.
- **Behavioural surface only** — ~10-15 fields, the API extracted modules need. Internal state stays in owning module closures.
- **Hierarchical groups** — `ctx.state`, `ctx.selection`, `ctx.dom`, `ctx.persist`, `ctx.render`. Each sub-object has 5-10 members.

**Choice: Everything 1:1 with IIFE closure.** Hierarchical groups force renames (`state` → `editable`, `scheduleSave` → `persist.scheduleSave`); each rename is a place where the diff stops being mechanical and review attention is spent on the wrong thing. Behavioural-only would force a judgment-call decision per closure var ("is this API or internal?") that bloats the brainstorm into a per-variable triage. The wide-interface cost is acceptable for the migration; it's named in the ADR's negative consequences and the post-Phase-3 decomposition follow-up.

### Q3 — Interface population timing

Three options surfaced:
- **Upfront enumeration** — read the IIFE top-to-bottom, enumerate every closure var, land the complete interface in one commit.
- **Incremental growth** — start empty, each Phase 2h+ extraction adds its touched fields.
- **Hybrid** — enumerate now, accept growth.

**Choice: Incremental growth.** Upfront enumeration lands in one giant commit with no usage — hard to review, easy to miss fields, blocks every Phase 2 extraction behind one big enumeration pass. Incremental defers each field's review cost to the commit that actually uses the field — the smallest reviewable unit. The risk (late discovery that the design doesn't fit) is bounded by the homogeneity of IIFE closure vars (primitives, DOM nodes, JSON, functions — none pathological in a TS interface).

### Implied answers to the handoff's two original open questions

The chosen goal of "Phase 3 cutover unblock with minimal behavioural drift" closes the handoff's two questions without separate decisions:

- **Mutable singleton vs. functional updates** → **mutable singleton**. Today's IIFE mutates `state.pages[i].sections[j]…` freely. Functional updates would introduce a paradigm shift (immer / reducer) that's behaviourally different and harder to diff against today.
- **Cached DOM refs vs. queried** → **cached at boot**. Today's IIFE caches DOM refs at boot and never re-queries. Querying mid-flight would change timing-sensitive paths.

Both are named in the ADR's first decision as properties of the EditorContext shape.

## Design shape (canonical: ADR 0058)

```ts
// src/editor-client/editor-context.ts
export interface EditorContext {
  // Empty at the gating commit; populated incrementally by each
  // Phase 2h+ extraction with the fields its module touches.
}
```

```ts
// src/editor-client/index.ts
export function createEditor(boot: EditorBoot): void {
  const ctx: EditorContext = { /* ...IIFE-cached refs + mutable boot slots... */ };
  // ...start the internally-handled async boot task, wire event listeners
  //    that close over ctx, and dispatch into extracted modules with
  //    (ctx, …) signatures...
}
```

```ts
// src/editor-client/<chunk>.ts  (example, Phase 2h+)
export function dragEnd(ctx: EditorContext, event: PointerEvent): void {
  // reads ctx.state, ctx.selection, mutates ctx.state, calls ctx.scheduleSave()
}
```

Helpers consumed by many modules (`scheduleSave`, `renderAll`, `findElement`, `selectElement`) live as fields on `ctx` so call sites read `ctx.scheduleSave()` — the same shape as today's `scheduleSave()`. Helpers private to one module stay as inner declarations in that module's file.

## Sequenced follow-ups

1. **Land ADR 0058 + spec** (this commit-set). No code change.
2. **Land empty `EditorContext` interface + `createEditor` stub** in `src/editor-client/`. Preserve the existing entry point's `styles.css` import and build-smoke imports so `scripts/build-editor-client.ts` still emits both JS and CSS. No behavioural change.
3. **Phase 2h..2N: cohesive-chunk extractions**, each adding its touched fields to `EditorContext`. Suggested boundaries in ADR 0058 §Follow-ups (subject to discovery).
4. **Per-phase bundle + parity smoke** where feasible — run `bun run editor-client:build`, feed identical input to inline IIFE and extracted module, and assert byte-identical output. Where parity doesn't admit a clean smoke (drag handlers, event-driven flows), add an import/build smoke for the extracted module and document the behavioural assertion the existing editor smoke must satisfy on the production inline path.
5. **Phase 3 cutover ADR** — separate decision moment when all Phase 2 extractions complete.
6. **Post-Phase-3 decomposition ADR** — split EditorContext into smaller named contexts. This is real future work, not speculative.

## What this brainstorm rejected

- **Hierarchical sub-objects (`ctx.state`, `ctx.dom`, …) during migration.** Right shape long-term; wrong shape for diff reviewability. Deferred to post-Phase-3 ADR.
- **Class-shaped extracted modules.** Forces `new` sites, method-binding decisions, instance-vs-static call decisions — places the diff stops being mechanical. Plain functions taking `ctx` match the IIFE shape directly.
- **DI containers / inversion of control.** Single-instance editor with build-time-known dependencies. Container is overkill.
- **Upfront enumeration of the full interface.** Heavy first commit with no usage; defers review attention away from per-extraction diffs. Incremental growth puts the review cost next to the use site.
- **Read-only state views, frozen snapshots, immer-style structural sharing.** All change the mutation pattern at every call site; the diff stops being mechanical. Mutable singleton matches today.

## Tradeoffs explicitly accepted

- Wide `EditorContext` interface (~40-50 fields when complete). Hard to mock. Coupling not narrowed at module boundaries. Cost paid for the migration's duration; lifted by the post-Phase-3 decomposition.
- Interface grows commit-by-commit during migration; reviewers of an early-phase commit can't see the eventual shape. Acceptable because each commit's growth is small and tied to one cohesive extraction.
- Per-module unit tests with mocked `ctx` are deferred. Because `src/editor-client/` is dead code until Phase 3, each extracted module must stay covered by `bun run editor-client:build` plus a phase-specific parity/import smoke where feasible; existing editor smokes continue to prove the production inline path.

## What this spec is not

- Not a migration plan with timelines. The plan is one extraction phase at a time, gated by the existing pre-commit chain, sequenced by what feels natural during the actual extraction (often guided by what's coupled-most to what's already extracted).
- Not a final shape. EditorContext is migration-aid debt by intent. The long-term shape is the post-Phase-3 decomposition.
- Not a substitute for ADR 0058. ADR 0058 is canonical. This spec is the trail of how that decision was reached.
