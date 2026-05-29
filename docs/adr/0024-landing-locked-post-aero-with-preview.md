# ADR 0024 — Landing page is one locked Post-Aero surface with a checked-in preview artifact

**Status:** Proposed
**Date:** 2026-05-29
**Author:** Aayushman Singh
**Drives:** lifts the landing-page design lock from `src/landing/SUBSYSTEM.md` into canon. Per the 2026-05-29 SUBSYSTEM audit, the "locked design + static-at-request + checked-in preview" trio is a binding decision.

## Context

A Visitor's first impression of rev01 is the landing page at `/`. The product narrative — "multiplayer site builder with an agent at the cursor" — has to land instantly, with a single coherent visual identity, and without depending on per-request data the page might fail to load. The page is a single SSR document with inlined CSS, animated by one inline IIFE script (`src/landing/demo-script.ts`).

Three structural choices shape the surface today:

- **One locked visual language** (Post-Aero). The landing page does not inherit the user's Site theme tokens; it does not vary by Style Kit; it does not skin based on locale or device. Owners cannot rebrand it. It is a fixed first-impression surface.
- **Static at request time.** The route reads no headers, no query, no session. Every `GET /` produces byte-identical HTML.
- **Checked-in `PREVIEW.html`.** A build script (`bun run landing:preview`) generates a byte-identical copy of the rendered HTML and writes it to the repo. Reviewers and the maintainer can inspect the page without booting Wrangler.

Each of these is a real decision with consequences. None of them are forced by the framework; all three could plausibly go a different way. Lifting them into canon prevents a future contributor from quietly reskinning the landing page to "match the user's site theme" or making it per-locale, which would dissolve the surface's first-impression purpose.

## Decisions

1. **The landing page is rendered in a single locked design language (currently Post-Aero) that does not vary by user, locale, theme, Style Kit, or device.** The page owns its visual tokens, type loading, motion, and composition end-to-end.

   **Why:** the landing page is a *brand* surface, not a *product* surface. A Visitor who hasn't signed up does not have a Style Kit selection to honour; making the landing inherit something the Visitor hasn't chosen produces a generic, undifferentiated page. The Post-Aero design language is a deliberate identity that telegraphs "rev01 specifically" rather than "any site builder." Forks can replace the language wholesale by editing `src/landing/`; they cannot turn the landing into a per-user surface without a superseding ADR.

   This would be wrong if rev01's go-to-market shifted to "fully white-label first-impression page per fork." That is not the current product shape and would require a separate decision about how forks rebrand.

2. **The landing page is fully static at request time.** No headers are read, no query parameters parsed, no session consulted. Every `GET /` returns byte-identical HTML.

   **Why:** the landing has nothing the request can usefully personalise. Stripping per-request input means the route cannot fail on auth, cookie shape, or session validity — there is no auth code path on the landing route. It also means the response can be cached aggressively at the edge (Workers cache, CDN) without cache-key drift. The cost is the inability to do A/B testing or per-locale variants on this surface; for a brand page, that cost is small.

   This would be wrong if the page needed runtime configuration (a feature flag toggling a hero variant). The decision treats that as a superseding ADR concern, not an in-place evolution.

3. **A byte-identical `PREVIEW.html` is checked in at `src/landing/PREVIEW.html` and regenerated via `bun run landing:preview`.** The preview is the same output the route produces at request time.

   **Why:** the landing page is visually-heavy and design-iterative; reviewers and the maintainer review changes by *seeing* the page, not by reading the JSX. Booting Wrangler to render once is overhead a designer or a casual reviewer should not pay. A checked-in HTML artifact makes the page inspectable with one double-click. The preview script asserts byte-identity with the runtime render, so the artifact cannot drift silently — a divergence is a CI signal.

   The artifact lives in the repo (not in `dist/`) because git history then captures every visual iteration alongside the JSX changes — `git log src/landing/PREVIEW.html` is the design changelog.

## Out of scope

- The specifics of the Post-Aero visual language (typography choices, motion timings, palette) — those are owned by `src/landing/` code and may evolve within the "locked first-impression surface" constraint. A radical redesign would be a superseding ADR.
- The animated demo IIFE (`src/landing/demo-script.ts`) and its hook contract with `HeroPanel.tsx` — owned by [the demo-hooks smoke at `src/landing/demo-hooks.smoke.ts`] and not part of the page's static-at-request contract.
- Analytics or tracking pixels — none today; if added, they remain page-load-only with no per-request inputs.
- Localisation of the landing page — explicitly not done today (the lock applies); a localised landing would be a superseding ADR.
- A/B testing variants — explicitly out; same reason.
- Marketing / SEO meta tags — owned by route code; not part of this ADR.

## Consequences

**Positive:**
- The landing page is the most reviewable surface in the repo — the checked-in preview makes design changes inspectable without environment setup.
- Per-request input being zero means zero per-request failure modes on the landing route. A visitor never sees an error page on `/`.
- The locked design language makes the landing's identity stable across rev01's lifecycle — Visitors return to a page that looks the way they remember.
- Forks rebrand wholesale by replacing `src/landing/`. The decision does not invite per-fork half-measures (partial reskin, partial inheritance from Site themes).

**Negative:**
- The page cannot adapt to anything: a Visitor on mobile with prefers-reduced-motion still gets the full Post-Aero motion (modulo whatever CSS respects the prefers-reduced-motion media query — opt-in via CSS, not via runtime decision).
- The checked-in `PREVIEW.html` produces a large diff on every visual change. Reviewers see two diffs (JSX + preview); the size of the preview diff scales with the change.
- Forks who *want* a per-locale or per-region landing have to either fork the surface entirely or write a superseding ADR.

## Follow-ups

- Delete `src/landing/SUBSYSTEM.md` (its content is now in this ADR).
- If the preview artifact's byte-identity check is not currently a CI gate, add it. The artifact's value is exactly the guarantee that it matches the runtime render.
- If the Post-Aero language is ever revised, write a superseding ADR with the new language's name and link the new `PREVIEW.html` baseline.
