# theme

## Definition

Owns the colour grammar of every rev01 site. Given a single palette seed (an OKLCH-ready sRGB hex), derives the twelve-token graph that the Variant D (Post-Aero) design language is built on, and answers two questions the studio asks repeatedly: "is this fg/bg pair WCAG-readable?" and "what does this CSS look like?".

Pure functions, zero runtime deps. The math is auditable and small. Nothing here touches the network, the DOM, or the database.

## Inputs

- `paletteSeed: string` — an sRGB hex literal (`#RGB` or `#RRGGBB`) coming from either:
  - the dashboard theme-studio form (operator edits in browser),
  - `Site.tokens.paletteSeed` (jsonb on every render).
- That is the only inbound relation. Fonts, radius, density flow around the theme subsystem; they never enter it.

## Outputs

- `deriveTokens(seedHex)` → twelve named OKLCH colours: `bgDeep`, `bgPanel`, `bgPanelStrong`, `fg`, `fgMute`, `accent`, `accentGlow`, `warn`, `ok`, `err`, `grid`, `hairline`.
- `tokensToCssDecls(tokens)` → a CSS custom-property declaration block; the document renderer inlines it on `<article class="rev01-doc">`, the studio inlines it on the live preview.
- `checkContrast(fg, bg)` → `{ ratio, aaNormal, aaLarge, aaaNormal, aaaLarge }`. The studio renders this as a fg×bg matrix; an automated audit could consume the same shape.
- Helpers (`parseHex`, `toCss`, `toHex`, `oklchToSrgb`, `relativeLuminance`, `contrastRatio`) are exposed for the rare caller that needs a primitive instead of the whole derivation.

## Name

`theme` — not `colour`, not `tokens`. The subsystem owns the **theme** in the design-system sense: the named slots and their relationships, not the underlying colour math (an implementation detail). The active canvas Style Kit wire format lives in `src/canvas/schema.ts` and `src/canvas/style-kits.ts`.

## Derivation rules

All values are deterministic functions of the seed's OKLCH coordinates `(L, C, H)`.

| Token           | L    | C    | H       | α    |
| --------------- | ---- | ---- | ------- | ---- |
| `bgDeep`        | 0.12 | 0.03 | seed.H  | 1    |
| `bgPanel`       | 0.20 | 0.04 | seed.H  | 0.8  |
| `bgPanelStrong` | 0.22 | 0.04 | seed.H  | 0.95 |
| `fg`            | 0.96 | 0.02 | seed.H  | 1    |
| `fgMute`        | 0.70 | 0.04 | seed.H  | 1    |
| `accent`        | 0.78 | 0.15 | accentH | 1    |
| `accentGlow`    | 0.78 | 0.18 | accentH | 0.4  |
| `warn`          | 0.82 | 0.18 | 70      | 1    |
| `ok`            | 0.82 | 0.18 | 145     | 1    |
| `err`           | 0.82 | 0.18 | 25      | 1    |
| `grid`          | 0.40 | 0.02 | seed.H  | 0.08 |
| `hairline`      | 0.60 | 0.02 | seed.H  | 0.28 |

`accentH = seed.H` when the seed has enough chroma (`seed.C ≥ 0.04`); otherwise `accentH = (seed.H + 200) mod 360`. The rotation lands a near-monochrome seed in the cyan/teal range where the Variant D accent lives.

`warn`, `ok`, `err` are fixed semantic colours — they must not drift with the palette, or a "delete" button stops looking dangerous.

## Why OKLCH, not HSL

HSL's "L" is not perceptual: a 0.5-L red and a 0.5-L blue have wildly different visible brightness, so a tonal scale built from HSL skews unevenly across hues. OKLCH's L is perceptual, so the derivation rules above produce a balanced graph regardless of the seed hue. The colour algebra (Ottosson 2020) is small enough to hand-implement (~80 LOC including matrices).

## Why WCAG ratios in this subsystem

The contrast matrix is the audit surface for "is this theme accessible?" — a question with one right answer per pair, so the studio shows it inline rather than gating the operator. WCAG luminance is sRGB-relative, so it has to round-trip through `oklchToSrgb` first. That round trip stays here so callers cannot accidentally measure contrast against a different colour space than the browser will paint.
