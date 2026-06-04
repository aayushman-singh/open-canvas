# ADR 0062 — Section accent border is a single discriminated-union field with four mutually exclusive variants

**Status:** Proposed
**Date:** 2026-06-04
**Author:** Aayushman Singh

## Context

`CanvasSection` ([`src/canvas/schema.ts:414-454`](../../src/canvas/schema.ts#L414-L454)) exposes a small set of section-level styling fields today: `backgroundEffect` (a 6-value enum), `backgroundVideoAssetId`, the page-level `pageBackground` shorthand, plus structural fields (`role`, `anchorId`, `instanceScope`). None of them touch the section's edge — every visual hook landing inside the section background. Owners reaching for "this section needs a thin orange line at the top" or "I want a soft halo behind the hero" today either hand-roll a child shape element pinned to the section's edge (loses the section as the conceptual unit, hard to copy across templates) or write a custom CSS hook into `pinnedStyle` on a child element (unbinds the effect from the section entirely).

The Owner-facing ask that surfaced this: **"let me put a 2 px solid border, or a thin top stripe, or a left bar, or a soft glow around any section."** Four variants, mutually exclusive in practice ("which kind of accent does this section have?") but covering structurally different CSS shapes:

- **Solid border** — `border: <width>px solid <color>` around the section box; the only variant that affects layout (1–2 px is visually fine and fits inside the section without padding adjustments).
- **Top stripe** — a thin line on the top edge only. CSS-wise either a `border-top` or an `inset 0 Npx 0 0` `box-shadow`; the latter overlays without changing box dimensions.
- **Left bar** — symmetric to the top stripe, on the left edge.
- **Glow / soft halo** — a soft outer `box-shadow` in a tinted, partially transparent color; no hard edge.

Three shapes immediately compete:

- **(A)** Four independent optional fields (`solidBorder?`, `topAccent?`, `leftAccent?`, `accentGlow?`). Honest about the shape of each variant; but allows nonsensical combinations (a section with both a solid border AND a top stripe AND a glow), which the editor would then have to police in UI, the renderer would have to layer-order, and the validator would have to either reject as mutually exclusive (re-introducing the discriminated-union semantics in a validator rule) or accept and emit, which means the conceptual model is hidden behind four un-coordinated nodes.
- **(B)** A single `accentBorder?: AccentBorder` discriminated by `type`. One node, one storage slot, mutual exclusion enforced by the type system: setting one variant replaces whichever was previously set. The editor UI is a type-picker followed by variant-specific controls, mirroring the existing `trigger?` shape on the same `CanvasSection` interface.
- **(C)** A single `accentBorder?: { kind: 'solid' | 'top' | 'left' | 'glow'; color: string; size: number }` with one flat shape. Smallest type surface; but flattens the units — `size` means "border width" for solid, "stripe thickness" for top/left, "glow radius" for glow — and loses the optional `spread` glow takes. The Owner reads "Size: 48 px" without knowing what it sizes.

(B) is the choice. (A) externalises mutual exclusion to four validators-rules and four UI gates; (C) hides the variants behind a misleading uniform vocabulary. (B) is also the shape `trigger?` already uses on `CanvasSection`, so the editor's conditional-form pattern, the Yjs encoder's nested-map pattern, and the validator's arm-dispatch pattern all transfer verbatim.

A non-negotiable constraint: the editor mutates the field through a single "Style: None / Solid / Top stripe / Left bar / Glow" type-picker, never through four independent toggles. The wire format must therefore make "absent" the encoding of "no accent" — no `{ type: 'none' }` arm and no four-way nullable flags.

## Decisions

1. **`CanvasSection` gains a single optional field, `accentBorder?: AccentBorder`, where `AccentBorder` is a discriminated union by `type` covering four arms: `solid` (color + `width`), `top` (color + `thickness`), `left` (color + `thickness`), and `glow` (color + `radius` + optional `spread`). Absence of the field encodes "no accent"; there is no `{ type: 'none' }` arm.**

   **Why:** four variants are conceptually one decision ("which kind of accent does this section have?"), and the user picks exactly one. A discriminated union makes mutual exclusion structural — the type system rejects mixing `width` with `thickness` at compile time, the validator rejects mismatched arms at runtime, and the editor's type-picker can only place the section in one arm at a time. Absent-means-none keeps the wire and the storage representations honest: the JSONB row carries no `accentBorder` key at all when there is no accent, which is what matters for both diff-friendliness and the editor's per-row "is anything set?" reads. A `{ type: 'none' }` arm would require every consumer (validator, renderer, inspector, Yjs codec) to special-case it as a no-op while still serialising as data — pure overhead.

   This would be wrong if a future feature required *layering* accents — e.g. "a solid border AND a glow." Today no such layering is requested, and the visual stacking order would itself be a design question that needs its own ADR. If layering becomes a real ask, the field migrates from a single `accentBorder?` to an `accentBorders?: AccentBorder[]` with a stable z-order — a forward-compatible widening, not a redesign.

2. **Color is a CSS color string, validated through the same `validateInjectionSafeString` path that `elementStyle.backgroundColor` and `elementStyle.borderColor` already use. Hex, named colors, `rgba()`, `hsl()`, and `oklch()` all pass.**

   **Why:** the existing pinned-style safety regex (re-used by `validateInjectionSafeString`) is the project's canonical "this string is safe to drop into a CSS declaration" filter. Reusing it keeps the validator surface single-pathed and inherits the same protection from CSS injection that every other color field already has. The glow variant specifically wants `rgba(<r>,<g>,<b>,<a>)` so Owners can dial in halo opacity without a separate field; restricting to `#rrggbb` would force a second `opacity` knob and hide what is conceptually one decision.

   This would be wrong if the renderer needed to mechanically blend the color with anything (e.g. computing the halo by darkening the solid color algorithmically). It does not — every variant emits the user-chosen color verbatim into the CSS.

3. **Numeric fields are arm-specific and named for their CSS role: `width` (solid border, positive px, validated as a positive finite number), `thickness` (top/left stripe, positive px), `radius` (glow blur radius, positive px), and `spread` (glow shadow spread, non-negative px, optional). Cross-arm fields are explicitly rejected by the validator — a `solid` arm carrying `thickness`, or a `glow` arm carrying `width`, fails validation.**

   **Why:** naming each field for its CSS role (rather than a generic `size`) keeps the editor labels and the data shape aligned — the Owner sees "Width (px)" when picking solid and "Radius (px)" when picking glow, and the JSONB row carries the same name. Cross-arm rejection is the validator's job per [ADR 0012](0012-validation-write-gate.md) (validator is the only write gate): a `{ type: 'solid', width: 1, thickness: 2 }` row is ambiguous and the validator must fail loudly rather than silently dropping the extra field. The all-or-nothing failure stance applies — there is no acceptable "fall back to the canonical arm field and ignore the rest" path.

   This would be wrong if a single shared `size` field would be more legible to Owners. It would not — `size: 48` next to a glow variant is meaningless without context, and the editor would have to read the variant to compose the label anyway.

4. **Yjs encodes the field as a nested `Y.Map` keyed by the discriminator (`type`), `color`, and the arm-specific numeric field(s). The encoding mirrors the existing `trigger` arm on the same `CanvasSection` map — same pattern, same `setIfDefined` rule for the optional `spread`, same `if (map.has('accentBorder'))` gate on decode.**

   **Why:** the `trigger` field is the existing discriminated-union precedent on `CanvasSection`'s Yjs encoding and has the same encode/decode shape this ADR needs. Reusing the pattern keeps the Yjs codec's "how do I encode a discriminated union?" answer single-shaped, and the projection determinism rule (encoding the same state twice yields byte-equal updates) extends cleanly because the arms walk fields in a fixed order.

   This would be wrong if accent-border state ever needed live co-edit semantics that `trigger` doesn't have — e.g. two collaborators independently changing the color while a third changes the variant. Co-edit on a discriminated union is one of Yjs's harder problems and is acceptable to ship as last-writer-wins on the parent map for both fields. If concurrent color/variant edits become a real complaint, the encoding can split into independent leaves; today it does not.

5. **The renderer emits the CSS inline on the section's outer `<section>` wrapper, never as a class or stylesheet selector. Solid uses CSS `border:` (the only variant that affects layout, with `box-sizing: border-box` so the section keeps its authored height); top and left use `box-shadow: inset …` so they overlay the background without changing layout; glow uses a non-inset `box-shadow` for the soft outer halo.**

   **Why:** per-section state has to be self-contained inline so a copy of the section to another page or another site carries its own visual presentation without depending on a shared stylesheet rule. `border` is the right tool for solid because the Owner expects 1–2 px to actually push the content in by that much (matches every other "border" they've ever drawn); `inset box-shadow` is the right tool for the edge stripes because they're decorative, must not change the section's height, and the inset placement keeps them inside the section's clipping region; non-inset `box-shadow` is the only way to draw a soft outer glow without a wrapping element. The renderer also emits a `data-accent-border="<type>"` attribute mirroring the existing `data-bg-effect` hook so editor smokes can target the variant without re-parsing inline styles.

   This would be wrong if accent border state needed to participate in a kit-token system (e.g. all sections of a site sharing a single accent color resolved from the active style kit). Today Owners ask for per-section accent control, not a site-wide token. If kit-level accent ever lands, the field migrates to support a token sentinel (`color: '@accent'`) without changing this ADR's shape.

6. **The section inspector adds a single "Accent border" group, between Background and Motion, structured as a five-value type-picker (None / Solid / Top stripe / Left bar / Glow) followed by variant-specific controls (color via the existing `buildColorRow`, then thickness/width/radius/spread inputs). Switching variants writes a fresh object with sensible per-arm defaults (width 1 for solid, thickness 3 for top/left, radius 48 for glow) and re-renders the inspector so the variant-specific controls update in place.**

   **Why:** the inspector pattern (group of labelled controls, conditional sub-controls based on a leading select, re-render on the discriminator change) is the same pattern `trigger` already uses inside the same `renderSectionInspector`. Reusing it keeps the inspector's vocabulary internally consistent — Owners learn the "pick a type, then fill in its fields" idiom once. Defaults per arm exist because the moment the user picks a variant, the section gets that variant applied with whatever values are in the field; defaulting to a non-zero numeric value prevents the "I picked solid and nothing changed because width was empty" trap. Per the global no-fallbacks stance the defaults are *explicit initial values* the user immediately sees and can edit, not silent corrections.

   This would be wrong if the four variants were not actually one mental concept for Owners and they wanted to mix-and-match. They are one mental concept; the type-picker matches that.

## Out of scope

- **Layered accent borders.** Stacking a solid border AND a glow on one section is rejected by the discriminated-union shape. A future ADR opens if real demand surfaces.
- **Kit-token accent color.** Color is a literal CSS color string here. Hooking accent color into the style-kit token system (`color: '@accent'` resolving from the active kit) is a follow-up.
- **Animated accent borders.** No keyframe motion on the accent itself. The section's existing `entrance` motion still applies to the whole section including its accent.
- **Per-edge stripes other than top/left.** Bottom and right stripes are deliberately omitted: a left bar is a near-universal "this is a sidebar/quote/callout" cue, a top stripe is a common "this section is special" cue, and bottom/right add picker noise without a driving ask. If a real ask surfaces they slot in as `bottom` / `right` arms with `thickness` mirroring the existing arms.
- **Corner-radius on the accent.** The solid variant inherits the section's `border-radius` (currently always 0 for sections); top and left inset shadows clip to the section's box so they round automatically. A separate `radius` field on the accent itself is not needed today.
- **Migration of existing sections to opt into an accent.** Templates and library sections do not change as part of this ADR; the field is purely additive.

## Consequences

### Schema

- New optional field `accentBorder?: AccentBorder` on `CanvasSection`.
- New exported `ACCENT_BORDER_TYPES` const tuple and `AccentBorderType` / `AccentBorder` types.
- No DB schema change — the field rides inside the existing JSONB `EditableSite` payload.

### Validator

- New `validateAccentBorder` helper in `src/canvas/validate.ts`, called from `validateSection`.
- Per-arm shape enforcement: each arm rejects cross-arm fields and requires its own numeric.
- Color validation reuses `validateInjectionSafeString` — no new color regex.

### Yjs projection

- `encodeSection` emits a nested `Y.Map` for `accentBorder` mirroring the `trigger` arm.
- `decodeSection` reads the discriminator and dispatches to the matching arm.
- Section-map shape doc comment at the top of `yjs-projection.ts` records the new key.
- Round-trip smoke fixture covers the glow arm; the dedicated smoke covers all four.

### Renderer

- `renderSection` reads `section.accentBorder` and pushes the variant-specific CSS into `styleEntries`.
- Section wrapper gets a `data-accent-border="<type>"` attribute alongside `data-bg-effect`.

### Editor

- `renderSectionInspector` gains a fifth labelled group between Background and Motion.
- The type-picker re-renders the inspector on change so variant-specific controls swap in place.
- Color row reuses `buildColorRow` from `inspector-leaf-builders.ts` — no new color picker.

### Smokes

- New `src/canvas/section-accent-border.smoke.ts` covering validate + render + Yjs round-trip across all four variants and the no-accent case.
- Smoke added to the `ci:smoke` chain in `package.json`.

## Follow-ups

- **Kit-token accent color.** When the style-kit grammar adds an accent-color token, accent border color can opt into the token by sentinel value.
- **Layered accents.** Tracked as a forward-compatible migration to `accentBorders?: AccentBorder[]` if a real ask appears.
- **Per-instance vs. per-library accent.** The Section Library row schema (ADR 0061) carries `accentBorder` as part of its `section_data` blob; whether Owners can override the accent without editing the library section is a Section Override question deferred to ADR 0061's instance-scope follow-up.

## References

- [ADR 0011](0011-canvas-element-registry.md) — establishes the per-element registry pattern this ADR's inspector group follows for sections.
- [ADR 0012](0012-validation-write-gate.md) — validator is the only write gate; this ADR's cross-arm rejection lands there.
- [ADR 0027](0027-yjs-projection-central-placement.md) — Yjs encode/decode stays central; this ADR's nested `accentBorder` map slots into the existing central codec.
- [ADR 0033](0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md) — establishes the section-inspector group pattern this ADR extends.
- [ADR 0061](0061-section-library-is-canonical-pool-templates-are-compositions.md) — accent border data flows through the Section Library row's JSONB blob without schema change.
