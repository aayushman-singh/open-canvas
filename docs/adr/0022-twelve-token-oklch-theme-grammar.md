# ADR 0022 — Twelve-token OKLCH theme grammar derived from a single seed

**Status:** Accepted
**Date:** 2026-05-29 (proposed); 2026-06-01 (accepted)
**Author:** Aayushman Singh
**Drives:** lifts the architectural decision from `src/theme/SUBSYSTEM.md` into canon. Per the 2026-05-29 SUBSYSTEM audit, the derivation table and accent-rotation fallback in that file encode a binding design grammar that should not live in a non-canonical doc.
**Accepted-context:** verified 2026-06-01 — `src/theme/derive.ts` implements every row of the table at the exact OKLCH coordinates (12 tokens, `CHROMATIC_FLOOR=0.04`, accent rotation `+200° mod 360`, fixed semantic hues 70/145/25). OKLCH/sRGB math + WCAG contrast helpers in `src/theme/oklch.ts`. `src/theme/SUBSYSTEM.md` was deleted in an earlier pass; stale references in `derive.ts` and `oklch.ts` docblocks now point at this ADR.

## Context

Every rev01 site is painted from a single per-site palette seed (a `paletteSeed` hex on the `Site` row, jsonb). The studio's promise to the Owner is: pick one colour, get a coherent, accessible, semantically-meaningful theme back. The grammar that translates one seed into a renderable theme has to be deterministic (the same seed always produces the same theme), perceptually balanced across hues (a red seed and a blue seed produce equally-readable tonal scales), and stable in its semantic colours (a "danger" colour must look dangerous regardless of the seed).

`src/theme/deriveTokens` implements this today as a small (~80 LOC) pure function. The derivation table — twelve named tokens, each computed from the seed's OKLCH coordinates with explicit rules — is described in prose in `src/theme/SUBSYSTEM.md`. Per the user's "only ADRs are canonical" rule, that prose either gets lifted into an ADR or it isn't load-bearing. The table is genuinely load-bearing (the studio, the renderer, and any future audit tool depend on it), so it gets lifted.

## Decisions

1. **The theme grammar is twelve named OKLCH-derived tokens, deterministically computed from the seed's `(L, C, H)` coordinates per the table below.** The names and roles are part of the grammar; renaming a token is a breaking change for every consumer (renderer, studio, contrast audit).

   | Token | L | C | H | α | Role |
   |---|---|---|---|---|---|
   | `bgDeep` | 0.12 | 0.03 | seed.H | 1 | Deepest background surface |
   | `bgPanel` | 0.20 | 0.04 | seed.H | 0.8 | Default panel/card background |
   | `bgPanelStrong` | 0.22 | 0.04 | seed.H | 0.95 | Emphasized panel |
   | `fg` | 0.96 | 0.02 | seed.H | 1 | Default foreground / text |
   | `fgMute` | 0.70 | 0.04 | seed.H | 1 | Muted text / secondary copy |
   | `accent` | 0.78 | 0.15 | accentH | 1 | Primary action / brand accent |
   | `accentGlow` | 0.78 | 0.18 | accentH | 0.4 | Hover/focus glow on accent |
   | `warn` | 0.82 | 0.18 | 70 | 1 | Semantic warning (fixed hue) |
   | `ok` | 0.82 | 0.18 | 145 | 1 | Semantic success (fixed hue) |
   | `err` | 0.82 | 0.18 | 25 | 1 | Semantic error (fixed hue) |
   | `grid` | 0.40 | 0.02 | seed.H | 0.08 | Subtle grid lines |
   | `hairline` | 0.60 | 0.02 | seed.H | 0.28 | Strong hairline borders |

   **Why:** the grammar is the contract between "Owner picks a colour" and "site looks coherent." Each row has a specific role; collapsing two would lose a real distinction the renderer relies on. Twelve is the count that emerged from the design language; deviating from it (eleven or thirteen) breaks either a real distinction or introduces an unused slot.

2. **`accentH = seed.H` when `seed.C ≥ 0.04`; otherwise `accentH = (seed.H + 200) mod 360`.** A near-monochrome seed (low chroma) cannot produce a usable accent at its own hue — the accent would be visually indistinguishable from the foreground/background. Rotating by +200° lands a near-monochrome seed in the cyan/teal range, where the Variant D (Post-Aero) design language places its default accent.

   **Why:** a grey seed (`#888888`) without this rotation produces an invisible accent — the user clicks "primary" buttons that disappear into the background. The 0.04 chroma threshold and the +200° rotation are empirical values chosen to land near-greys in a visually-distinct accent zone. Any seed with meaningful chroma (`C ≥ 0.04`) keeps its own hue, which preserves the Owner's "I picked teal, my accent is teal" expectation.

3. **`warn`, `ok`, `err` are fixed semantic colours.** Their hues (70, 145, 25 — yellow, green, red) do not drift with the palette seed. A "delete" button must look dangerous regardless of whether the site's accent is teal or magenta.

   **Why:** semantic colour is a UX contract with the visitor, not a brand variable. A red "delete" works because every visitor has learned to associate red with caution; reskinning that to "magenta delete" because the site's accent is magenta breaks the universal signal. The L (0.82) and C (0.18) values match the accent's chroma/lightness so the three semantic colours sit visually adjacent to the accent without competing with it.

4. **The derivation operates in OKLCH, not HSL, because OKLCH's L is perceptual.** HSL's "L = 0.5" for a pure red and a pure blue look very differently bright; OKLCH's "L = 0.5" for both reads as the same brightness. A tonal scale built from HSL skews unevenly across hues; the same scale in OKLCH stays balanced.

   **Why:** the design language depends on each token having a consistent perceptual role across all seed hues. HSL cannot guarantee that; OKLCH can. The colour algebra (Ottosson 2020) for sRGB↔OKLCH conversion is small (~80 LOC including the matrices) and hand-implemented in `src/theme/`. The cost of OKLCH over HSL is the conversion math; the benefit is that the same derivation table produces a coherent theme for any seed.

5. **WCAG contrast checks operate on sRGB luminance (`relativeLuminance` + `contrastRatio`), with seed values round-tripped through `oklchToSrgb` first.** WCAG is sRGB-relative because that's what browsers paint. Computing contrast in OKLCH would diverge from what the visitor actually sees.

   **Why:** the studio shows a contrast matrix (foreground × background) so the Owner can see at a glance which token pairs meet WCAG AA/AAA. If the contrast were computed in OKLCH, the matrix would predict a different contrast than the browser delivers. The round-trip through sRGB matches the browser exactly.

## Out of scope

- Typography tokens (font families, sizes, weights, line heights) — handled by `src/canvas/style-kits.ts` and the Style Kit registry, not the theme grammar.
- Surface tokens (radius, shadow, border) — same.
- The active canvas Style Kit wire format — lives in `src/canvas/schema.ts` and `src/canvas/style-kits.ts`. The theme grammar is the *palette* derivation; Style Kits are the *full visual contract* that consumes a derived palette plus its own non-palette tokens.
- The CSS emission format (`tokensToCssDecls`) — implementation detail; output shape is "a `--name: value;` block" but the exact prefix is mechanical.
- Adding new tokens — a new token is a breaking change for every consumer and requires a superseding ADR.

## Consequences

**Positive:**
- The derivation table is now canonical. A future contributor asking "why twelve, why these specific OKLCH coordinates?" gets the answer from one file, with the reasoning preserved.
- Any change to the table (adding a token, changing a coefficient) is a deliberate ADR-level event rather than a quiet code edit.
- The grammar's fixed semantic colours (`warn`/`ok`/`err`) are now pinned against drift — a future contributor cannot quietly make them seed-derived without a superseding ADR.

**Negative:**
- Twelve tokens is a commitment. If product requirements change (e.g. a separate "destructive-accent" token becomes useful), the change requires an ADR and consumer migration.
- The OKLCH choice is now canon. Replacing the conversion math (e.g. with a library) is fine; replacing OKLCH with HSL or LCH would be a superseding ADR.
- The accent-rotation threshold (`C ≥ 0.04`) is a magic number. It works empirically; if a future product designer wants to tune it, they edit the ADR.

## Follow-ups

- Delete `src/theme/SUBSYSTEM.md` (its content is now in this ADR).
- If the contrast matrix UI in the studio ever extracts to its own component, link this ADR from its docblock so future maintainers see the grammar's source of truth.
- If a future ADR proposes a thirteenth token or a different derivation table, supersede this one explicitly rather than amending in place.
