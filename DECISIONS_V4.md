# DECISIONS_V4 — ADR 0066 variant-preset layer wave

Autonomous decisions under HANDOFF_V4 hard-rule 1 ("decide + record, bias
ambitious"). The real ADR 0066 (variant-preset layer for the 4 interactive
components + a pointer-fx runtime fragment) is the spec; these record the
implementation choices the ADR left to the implementer ("subject to refinement
during implementation").

## D0 — ADR 0066 arrived mid-wave; reconciled.
On branch start `docs/adr/0066-*.md` was absent (and no STATE_V4), so I began by
drafting a *different* design from the handoff one-liner (named interactive
states on `BaseElement`). The canonical ADR 0066 then landed on disk (Status:
Proposed) — the variant-preset layer extending `variant`→`data-variant`→CSS to
form/carousel/accordion/tabs, plus a pointer-fx runtime fragment. I **reverted**
the invented-model edits to schema.ts + validate.ts (no residue) and pivoted to
implement the canonical ADR. No code from the wrong model ships.

## D1 — Variant enums live in each element module, not schema.ts.
ADR Consequences>Schema: "*_VARIANTS const tuple exported alongside the element
interface." So `ACCORDION_VARIANTS`/`TABS_VARIANTS`/`CAROUSEL_VARIANTS`/
`FORM_VARIANTS` are defined in accordion.ts/tabs.ts/carousel.ts/form.ts (next to
their interface) and re-exported through `elements/index.ts`, keeping the four
element-file edits disjoint. (ACTION_VARIANTS lives in schema.ts for legacy
reasons; new ones follow the ADR's stated placement.)

## D2 — `variant` is optional; render always emits `data-variant`, defaulting to first arm.
The field is `variant?: <T>` (absent = current look). The render fn emits
`data-variant="${el.variant ?? '<firstArm>'}"` on the component root — always
present, like action. The first arm's CSS reproduces the current look, so a
snapshot with no `variant` renders visually identically; the added inert
attribute is the only HTML delta (ADR dec 3 "byte-identical" read as visually
identical — the attribute is inert until its CSS arm is selected).

## D3 — Variant catalogs (ADR dec 3, finalised here).
- **Accordion**: `list` (default/current), `bordered`, `cards`, `filled`.
- **Tabs**: `underline` (default/current), `pill`, `segmented`, `vertical-rail`.
- **Carousel**: `classic` (default/current), `coverflow`, `ken-burns`, `editorial`.
- **Form**: `classic` (default/current), `underline`, `card`, `brutalist`, `spotlight`.
Each first arm = the component's existing look verbatim.

## D4 — Component-scoped custom-property namespaces (ADR dec 2).
Variant arms only *set* properties; inner-part CSS reads `var(--prop, <kit
fallback>)`. New namespaces mirror the existing `--opencanvas-form-*`:
`--opencanvas-accordion-*`, `--opencanvas-tabs-*`, `--opencanvas-carousel-*`.
Owner overrides via `pinnedStyle` on the root beat the `[data-variant]` arm
(inline > stylesheet), so kit-token < variant < granular holds.

## D5 — pointer-fx: spotlight wired to Form `spotlight`; tilt implemented + tested but uncatalogued.
ADR dec 4 names two initial primitives (`spotlight`, `tilt`). Only `spotlight`
appears in a catalog arm (Form `spotlight`), which emits
`data-opencanvas-pointer-fx="spotlight"`. `tilt` is fully implemented in the
runtime fragment and covered by the pointer-fx smoke (attribute set
synthetically), available for a future catalog arm — not left as dead code, not
forced into an arm the ADR didn't ask for.

## D6 — pointer-fx is one fragment in the existing IIFE; no new `<script>`.
`src/interactive/pointer-fx.ts` exports `POINTER_FX_RUNTIME_SRC`; `build.ts`
concatenates it into the existing interactive IIFE; `runtime.ts` `hydrateAll`
runs a document-wide `[data-opencanvas-pointer-fx]` scan (a new pass, not a
`data-opencanvas-interactive` dispatch arm). `inject.ts`
`snapshotNeedsInteractiveRuntime` widens to trip on any pointer-fx attribute
(ADR dec 5) so a button-with-spotlight still hydrates.

## D7 — Static base is authored + smoke-tested, not a silent fallback (ADR dec 6).
Form `spotlight`'s static base is the `card` look with a fixed centred glow; the
pointer-follow is the enhancement layered via `--opencanvas-ptr-x/y` (which
default to 50%/50% in the CSS `var()` fallback, so JS-absent renders the centred
glow deliberately). The smoke asserts the static base exists.

## D8 — Editor mirror updated (ADR Editor consequence).
`src/editor-client/hydrate-interactives.ts` gains the pointer-fx pass + carousel
`--opencanvas-slide-offset` publishing, mirroring the visitor fragments
line-for-line; a parity smoke guards against drift.

## D11 — Editor preview: emit data-variant + mirror the runtime; defer the static-CSS arm mirror.
The editor preview does NOT load `canvasPublishedStyles`; it maintains a
separate ~3k-line hand-written stylesheet (`styles-build.ts`) with preview-
specific class names. This wave: (a) emits `data-variant` (+ form pointer-fx) on
the editor builder nodes, (b) mirrors the pointer-fx pass + carousel slide-offset
in `hydrate-interactives.ts`, (c) adds the inspector `Style` select. So the
Owner's choice persists, hydrates, and publishes correctly. Re-parameterising
the editor stylesheet's preview-class inner CSS for every arm is deferred (ADR
follow-up) — a large, regression-prone edit to the live editor for a preview
nicety, against the "do not break the live editor" mandate. Honest follow-up,
not a silent gap.

## D12 — Kept my variant work isolated from injected prior-wave WIP.
The working tree carried uncommitted prior-wave WIP injected by the environment
(billing rate-limit hardening in `agent/chat/orchestrator.ts` + `agent/chat/
smoke.ts`; a collection-empty-preview improvement in `body-builders-data.ts` +
`collection-empty-preview.smoke.ts` + its `package.json` entries). None of it is
ADR 0066. Per atomic-commit discipline + "don't redo prior waves," my commit
contains ONLY the variant layer; the injected WIP is left uncommitted in the
working tree (preserved, not destroyed, not adopted). `body-builders-data.ts`
was temporarily reverted to author my variant edits cleanly, then the injected
collection hunk was re-applied to the working tree afterward.

## D13 — Codex review applied (see codex/20260611-variant-layer-disposition.md).
Codex flagged 8 issues. Fixed: the custom-property cascade (variant vars now set
on the `.opencanvas-element` wrapper via `render.ts variantAttr`, so pinnedStyle
wins and formStyle composes correctly); form arms now set `--opencanvas-form-*`
vars instead of bypassing them; coverflow scoped out of scroll-snap mode +
depth-clamped so scale never goes negative; `vertical-rail` tabs dropped (inline
panel sizing can't reflow into a rail); tabs first arm renamed `classic` (the
real current look) with a genuine `underline` arm; pointer-fx now loud-logs
unknown primitives. Documented as out-of-scope/pre-existing: full editor static-
CSS arm preview (D11 / ADR follow-up) and live-broadcast re-hydration (pre-
existing across all interactives; runtime-dedup follow-up).

## Implementing commit
`47eb4cb6` — `feat(canvas): ADR 0066 variant-preset layer + pointer-fx runtime`
(branch `feat/v4-variant-layer`). Also recorded in the ADR header and PR body.
