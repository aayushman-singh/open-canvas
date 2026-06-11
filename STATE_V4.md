# STATE_V4 — ADR 0066 variant-preset wave (read first on resume)

Branch: `feat/v4-variant-layer`. Mission: implement canonical ADR 0066 —
variant-preset layer for form/carousel/accordion/tabs + pointer-fx runtime
fragment. Live site stays up; mergeable + ci:smoke green; deploy user-gated (no
merge).

## CRITICAL CONTEXT
- The canonical ADR 0066 (`docs/adr/0066-*.md`, Status: Proposed) is the spec.
  It is NOT my early invented "named interactive states on BaseElement" model —
  that was reverted (see DECISIONS_V4 D0). Re-read the ADR, not the handoff
  one-liner.
- Baseline `bun run typecheck` GREEN at branch start. Branch cut from main
  `f4a8fd34`.

## Design (real ADR 0066 — see DECISIONS_V4 for catalogs/decisions)
- Add optional `variant?` enum to FormElement/CarouselElement/AccordionElement/
  TabsElement (tuple exported from each element module).
- Render fn emits `data-variant="<value|firstArm>"` on the component root; CSS
  in public-styles.ts paints each arm by *setting* `--opencanvas-<comp>-*`
  custom props (inner CSS reads `var(--prop, kit-fallback)`).
- pointer-fx: `src/interactive/pointer-fx.ts` fragment publishes `--opencanvas-
  ptr-x/y` (spotlight) + `--opencanvas-tilt-x/y` (tilt) from pointer events; no
  scroll (that stays with motion.preset). inject widens on `data-opencanvas-
  pointer-fx`. Carousel `coverflow` uses runtime-published `--opencanvas-slide-
  offset`.
- Validator: per-element variant-enum membership check. Yjs: `variant` leaf
  encode/decode per component. Editor mirror: pointer-fx + carousel offset in
  hydrate-interactives.ts. Smokes + parity, wired into ci:smoke.

## Progress log
- [x] Mapped codebase; read action.ts reference (variant template), accordion/
      tabs/carousel/form render roots, public-styles structure, validate seam,
      yjs seam, interactive runtime, editor inspector.
- [x] Reverted invented-model edits; rewrote ADR-aligned DECISIONS_V4 + this file.
- [ ] Element files: variant tuple+field+render+inspector+agent (4 files).
- [ ] index.ts re-exports; validate.ts enum checks.
- [ ] yjs encode/decode variant leaf.
- [ ] public-styles.ts variant CSS blocks.
- [ ] pointer-fx runtime + build/runtime/inject + carousel offset.
- [ ] editor mirror.
- [ ] smokes + ci:smoke wiring.
- [ ] codex, ADR→Accepted+SHA, SESSION_SUMMARY_V4.md, green gate, PR.

## Key seams (file:line, branch start)
- Element render roots to add data-variant:
  accordion.ts:90 (`.opencanvas-accordion`), tabs.ts:84 (`.opencanvas-tabs`),
  carousel.ts:197 (`.opencanvas-carousel`), form.ts:331 (`.opencanvas-form`).
- Action reference template: action.ts (variant field 53, render data-variant
  68/76/82, inspector select 99, agent enum 206-210).
- index.ts re-exports: ~60-95.
- validate.ts per-element switch: validateElement ~834; switch ~876 (add variant
  enum check in each of form/carousel/accordion/tabs cases). assertOneOf ~106.
- yjs-projection.ts: per-element encoders (search encodeAccordion/Tabs/Carousel/
  Form) + decoders; action/shape/container `variant` leaf is the pattern
  (encode ~396-422, decode ~1108+).
- public-styles.ts: accordion CSS 388-430, tabs 432-467, carousel 469+, form
  273-382. Add `[data-variant=...]` arm blocks per component.
- Interactive runtime: build.ts (INTERACTIVE_RUNTIME_SRC ~35), inject.ts
  (snapshotNeedsInteractiveRuntime, INTERACTIVE_ELEMENT_TYPES ~34), runtime.ts
  (hydrateAll), carousel.ts (active-index tracking). New pointer-fx.ts.
- Editor mirror: src/editor-client/hydrate-interactives.ts.
- ci:smoke chain: package.json "ci:smoke"; smoke pattern = `bun run x.smoke.ts`,
  throw-on-false assert.
