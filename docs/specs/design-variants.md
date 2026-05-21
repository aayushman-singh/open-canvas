# Design language variants

**Status:** Draft for selection
**Date:** 2026-05-21

Four mutually exclusive design directions for the rev01 landing page + dashboard chrome. Pick one before any UI code lands. Each is described with: identity, type system, color logic, surface, motion, hero composition, and a recruiter-readable one-liner.

The goal: **avoid the default-shadcn / default-tailwind aesthetic** that 90% of portfolio projects share. The first 5 seconds on the landing page must telegraph "real designer behind this."

---

## Variant A — Brutalist-Mono

**Identity:** Print-shop. Concrete and ink. Looks like a 1970s technical manual reset for a 4K display.

**Type:**
- Display: **Space Grotesk** 96–160px, tracking -2%, hard left-aligned, no centering.
- Body: **JetBrains Mono** 14–16px.
- One typeface family across the whole product. No serifs.

**Color:**
- Background: `#0E0E0E` (near-black) or `#F2F0EA` (warm paper) — pick mode at session start, no toggle.
- Single accent: blood-orange `#FF3B00`.
- No gradients. No glass. No shadows.
- WCAG AAA contrast minimum.

**Surface:**
- Hard 1px black borders on every panel.
- Sharp corners (`radius=none`).
- Asymmetric grid — 13-column with explicit gutter cells visible as bordered boxes.

**Motion:**
- Zero ease curves. Linear only.
- Type stagger reveal on scroll (chars or words, no fades).
- Cursor leaves a 1-frame ghost trail.

**Hero:**
- Massive type: `rev01.` filling 70% of viewport width, baseline-aligned.
- Below it, a single live element: a real `document.json` rendering in a bordered box, with a Yjs cursor visibly editing it.
- No video, no 3D.

**One-liner for recruiter:** "Looks like nothing else on Webflow's homepage."

**Risks:** Polarizing — some will read as "too design-school." Works only if executed precisely; mediocre brutalism reads as broken.

---

## Variant B — Editorial-Serif

**Identity:** Long-form magazine, New York Review of Books online. Confident, literate, calm.

**Type:**
- Display: **PP Editorial New** or **Tiempos Headline** at 64–120px, generous line-height, regular weight.
- Subhead: **Inter** 18–22px.
- Body: **Inter** 16px, prose width capped at 68ch.

**Color:**
- Background: ivory `#F8F5EF` (light mode default).
- Ink: `#1A1A1A`.
- Single muted accent: deep teal `#0E5A5A`.
- Tasteful gradients allowed but only as washes (5–10% opacity).

**Surface:**
- Soft 1px hairline borders on muted tone.
- Radii: 4px max.
- Generous whitespace, prose-first layout.
- Drop-caps in section openings.

**Motion:**
- Slow ease-out curves (600–900ms).
- Words fade up one at a time on scroll.
- Hover states are page-curl style (CSS transforms, no JS).

**Hero:**
- Single sentence in display serif: "*A site builder that thinks in paragraphs.*"
- Underneath, a real prose paragraph slowly being typed by an AI agent.
- No images above the fold.

**One-liner for recruiter:** "Reads like prose, not a SaaS landing page."

**Risks:** Could feel too soft for a "developer tool" pitch — sells the *content* side but undersells the *engineering* side. Mitigate with an engineering-anchored second screen.

---

## Variant C — Candy-Glass

**Identity:** Liquid, optimistic, post-Vision-Pro. Pastel chroma + frosted depth. Apple-2024 if Apple were younger.

**Type:**
- Display: **Geist** 64–96px, semibold.
- Body: **Geist Mono** at 13–14px for any technical UI, **Geist** sans for prose.
- Wide tracking (+1%) on display.

**Color:**
- Background: animated mesh gradient — soft lavender → coral → mint, blurred to 200px.
- Surface chrome: white with 60% backdrop-filter blur (frosted glass).
- Accent: hot magenta `#FF2D90`.
- WCAG AA only — contrast intentionally lower for the dreamy feel; legibility maintained by Geist's hinting.

**Surface:**
- 16–20px radius everywhere.
- Layered glass panels w/ inner highlights.
- Subtle parallax depth — 3 layers, each at different scroll speeds.

**Motion:**
- Spring physics (motion.dev `spring({ stiffness: 200, damping: 18 })`).
- Mesh gradient slowly shifts hue (60s cycle).
- Card hover = lift + tilt (CSS 3D transform).

**Hero:**
- Three floating glass panels at different depths, each showing a different page of the same site being edited in realtime.
- AI-agent panel front-and-center, streaming a draft.
- Camera-shake-style entrance.

**One-liner for recruiter:** "Looks like Linear, Notion, and Arc had a baby."

**Risks:** Heaviest GPU load — must guard for `prefers-reduced-motion`. Risk of looking generic-2024 (lots of products are doing glass right now). Differentiator must come from the *content* shown inside the glass.

---

## Variant D — Post-Aero (terminal × Aero)

**Identity:** Windows Vista Aero meets a code editor. Embraces nostalgia + density. Maximalist, technical, unapologetic.

**Type:**
- Display: **IBM Plex Sans** 48–72px.
- UI: **IBM Plex Mono** 12–14px for chrome, labels, buttons.
- Body: **IBM Plex Sans** 15px.

**Color:**
- Background: deep navy `#0A1628` w/ subtle noise.
- Glass chrome: `rgba(120, 180, 255, 0.08)` w/ inner cyan glow.
- Accent: electric cyan `#00E5FF` + warning amber `#FFB020`.
- Title bars on panels w/ minimize/maximize/close glyphs (purely decorative).

**Surface:**
- Window-chrome panels — every card has a faux title bar.
- 8px radius, beveled inner shadow.
- Dense — 4-pane layouts on landing, info per screen 2× the SaaS norm.
- Inline status bars, FPS counter (real), connection indicator (real).

**Motion:**
- Subtle scanline + chromatic-aberration shader on hero canvas.
- Panel-open animations mimic Vista's window-aero ease (cubic-bezier(0.2, 0.9, 0.1, 1.0), 280ms).
- Realtime ticker of "edits per second" across all live sites.

**Hero:**
- Three side-by-side panels — "editor", "preview", "agent" — all live, all updating.
- Bottom status bar: "Connected · 3 collaborators · Synced 4ms ago · 124 edits/min".
- The product is the screenshot.

**One-liner for recruiter:** "Most opinionated portfolio site on the recruiter's screen this week."

**Risks:** Looks busy → first-time visitor confusion. Mitigate with strong hierarchy and a single CTA above the fold. Nostalgia angle has to be intentional, not accidental — execution gap is wide.

---

## Decision matrix

| Trait | A Brutalist | B Editorial | C Candy-Glass | D Post-Aero |
|---|---|---|---|---|
| Time to ship landing | M (custom type) | M | L (motion-heavy) | L (lots of chrome) |
| GPU / mobile cost | low | low | high | medium |
| Recruiter "wow" risk | high — polarizing | medium — sells calm | medium — generic-2024 risk | high — polarizing |
| Engineering signal carried | strong (no chrome to hide behind) | medium | low (chrome can mask) | strong (live data visible) |
| Differentiator vs Webflow/Framer | strongest | medium | weakest | strong |
| Fits "AI-native multiplayer" pitch | medium | weak | strong | strongest |
| Maintenance cost | low | low | medium | high |

## Recommendation

**Variant D (Post-Aero)** if executed well — it carries the most engineering signal because the chrome *is* live data, and it is the strongest match for the multiplayer + agent pitch. Variant A (Brutalist) is the safest fallback if D's complexity threatens the demo deadline.

**Variant C is the one to avoid** for hireability — every shipped 2024–2026 SaaS product looks like it, so it telegraphs "followed a trend" rather than "design point of view."

## Next step

Pick one. Once picked, I land a single landing-page PR using the chosen language and lock the token graph in `src/theme/tokens.ts`.
