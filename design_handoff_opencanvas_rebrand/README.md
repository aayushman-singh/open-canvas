# Handoff: Open Canvas — App Rebrand (rev01)

## Overview
This package redesigns the entire **app chrome** of `rev01` — a desktop canvas
site-builder — under a new brand, **Open Canvas**, aimed at non-technical
small-business users. It keeps every existing feature and only changes the
visual layer: tokens, typography, components, page chrome, light/dark theming,
and a handful of new/branded screens (auth, 404, draft, password gate).

The brand: a thin black "canvas frame" + an open ring (the "O") + two red marker
bars that punch across the frame edge — recreated as themeable SVG. One warm
coral red `#E84D4A`, warm neutrals, rounded surfaces, friendly copy.

## About the Design Files
The files in `design-references/` are **design references created in HTML** —
working prototypes that show the intended look and behavior. **They are not
production code to copy verbatim.** The task is to **recreate these designs
inside the existing `rev01` codebase** (Cloudflare Workers + Hono JSX + a vanilla
editor client) using its established patterns — server-rendered JSX for chrome,
the existing vanilla client for the editor. Do **not** introduce React or a new
framework; rev01 has no client framework by design.

`design-references/MIGRATION.md` is the authoritative, repo-specific port guide
(file-by-file mapping, variable-name aliases, PR sequence). **Read it first.**
This README is the design spec; MIGRATION.md is the implementation plan.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, and
interactions are all specified. Recreate pixel-faithfully using the codebase's
patterns. Exact tokens are in `design-references/theme.css` and below.

## Critical scoping rules (read before coding)
1. **App chrome only.** Two styling systems coexist in rev01:
   - *Chrome* = landing, dashboard, editor, account, public error pages. **This
     is what you restyle.** (`src/landing/`, `src/routes/dashboard/`,
     `src/editor/canvas-styles.ts`, `src/ui.ts`, `src/routes/public.ts`,
     `src/password/gate.ts`.)
   - *Style Kits* = `src/canvas/style-kits.ts` + `src/canvas/public-styles.ts`.
     These theme the **end-user's published site**, not the brand. **Do not
     touch them.** Published visitor output must stay byte-identical.
2. **The brand red is not a Style Kit.** Never bleed `#E84D4A` into kit tokens.
3. **The editor canvas/artboard stays light even in chrome dark mode** — it
   renders the user's site, not chrome.

---

## Design Tokens
Source of truth: `design-references/theme.css` (includes `[data-theme="dark"]`
and alias blocks that re-point rev01's existing variable names —
`--bg/--panel/--accent` in `shell.tsx`, `--bg-deep/--fg/--accent/--hairline` in
`landing/styles.ts`, `--rev01-*` in `canvas-styles.ts`).

### Color — light (`:root`)
| Token | Value | Use |
|---|---|---|
| `--paper` | `#FBFAF8` | page background |
| `--surface` | `#FFFFFF` | cards / panels |
| `--surface-2` | `#F4F1EC` | insets, hovers |
| `--surface-3` | `#ECE8E1` | tracks, skeletons |
| `--ink` | `#1A1917` | primary text |
| `--ink-2` | `#5B564E` | secondary text |
| `--ink-3` | `#948D82` | tertiary / placeholder |
| `--line` | `#ECE7DF` | hairline |
| `--line-2` | `#DCD6CB` | stronger border |
| `--red` | `#E84D4A` | brand / primary action |
| `--red-strong` | `#D33C39` | hover |
| `--red-ink` | `#C5332F` | red text on light |
| `--red-soft` | `#FBEDEC` | tint fill |
| `--red-tint` | `#FCF4F3` | faint wash |
| `--red-line` | `#F4CFCD` | red border |
| `--ok` `#2E9E6B` · `--ok-soft` `#E6F5EE` | | success |
| `--warn` `#D98A1F` · `--warn-soft` `#FBF1DE` | | warning |

### Color — dark (`[data-theme="dark"]`)
`--paper #16140F` · `--surface #201D17` · `--surface-2 #2A261F` ·
`--surface-3 #353027` · `--ink #F6F2E9` · `--ink-2 #B7AFA1` · `--ink-3 #837B6D` ·
`--line rgba(255,255,255,.10)` · `--line-2 rgba(255,255,255,.17)` ·
`--red #FF6257` · `--red-ink #FF8378` · `--red-soft rgba(255,98,87,.15)` ·
`--red-line rgba(255,98,87,.32)`.

### Radius
`--r-xs 8` · `--r-sm 12` · `--r 16` · `--r-lg 22` · `--r-xl 28` · `--r-pill 999` (px).

### Shadows (warm-neutral)
- `--shadow-sm`: `0 1px 2px rgba(40,34,26,.05), 0 2px 6px rgba(40,34,26,.04)`
- `--shadow`: `0 2px 6px rgba(40,34,26,.06), 0 12px 28px -10px rgba(40,34,26,.14)`
- `--shadow-lg`: `0 4px 12px rgba(40,34,26,.07), 0 28px 60px -18px rgba(40,34,26,.22)`
- `--shadow-red`: `0 8px 22px -8px rgba(232,77,74,.5)`
- `--ring` (focus): `0 0 0 4px rgba(232,77,74,.22)`

### Typography
- `--display`: **Bricolage Grotesque** (700/800) — headings. `letter-spacing:-0.02em` to `-0.035em`, `line-height` 1.02–1.14.
- `--sans`: **Hanken Grotesk** (400/450/500/600/650/700) — body. base 16px / 1.6.
- `--mono`: **Spline Sans Mono** — published-address chip & code only.
- Google Fonts link in MIGRATION.md §2. Body weight 420–450; buttons 650.
- Scale: H1 ~32px (page) / clamp to 58–76 (hero); H2 ~20–32; body 15–16; label 12.5–13; eyebrow 12.5 uppercase `letter-spacing:.14em`.

---

## Components (classes in `design-references/styles.css`)
| Component | Class | Spec |
|---|---|---|
| Button (primary) | `.btn .btn-primary` | red fill, white text, `--r-pill`, `12px 20px`, weight 650, `--shadow-red`; hover `--red-strong` + translateY(-1px) |
| Button (ink/outline/ghost) | `.btn-ink` / `.btn-outline` / `.btn-ghost` | dark / surface+`--line-2` border / transparent |
| Button sizes | `.btn-sm` (`8px 14px`,13px) · `.btn-lg` (`15px 26px`,16px) | |
| Chip | `.chip` (+`.chip-ok`/`.chip-red`/`.chip-url`) | pill, `--surface-2`, `5px 12px`, 12.5px, `white-space:nowrap`; `.dot` 7px status dot |
| Card | `.card` | `--surface`, 1px `--line`, `--r-lg`, `--shadow-sm` |
| Input | `.field` + `label.lbl` | 1.5px `--line-2`, `--r-sm`, `11px 14px`; focus → `--red` border + `--ring` |
| Switch | `.switch > input + .track` | 46×27 track, red when checked, 21px knob slides 19px |
| Eyebrow | `.eyebrow` | uppercase red label with a 22×3 red tick drawn as **background-gradient** (NOT `::before`), `padding-left:31px` |
| Headline accent | `.marker` | red underline drawn as `background-image:linear-gradient(var(--red),var(--red))` bottom, `background-size:100% 0.13em` (NOT a pseudo-element) |
| Logo | `.oc-logo` + inline SVG | see MIGRATION.md §4; ring/frame use `currentColor`, bars use `--red` |

---

## Screens / Views
All mocks are in `design-references/`. Each has light+dark and a theme toggle.

1. **`index.html`** — design-system hub (reference only; not a shipped route). Shows brand, color, type, components, and links to every screen.
2. **`landing.html` + `demo.js`** — marketing page. Sticky translucent nav (logo, links, theme toggle, Sign in, Start building); centered hero (eyebrow, Bricolage headline with `.marker`, sub, two CTAs); **live multiplayer demo** = a rounded browser-framed mini-editor (left rail, dotted canvas with a "Bloom & Co." artboard, right AI panel) that loops: peer "Sam" selects the CTA → assistant recolors it → "You" drops a badge → Publish toast. Then: social-proof row, 3 feature cards with mini visuals, 4 template thumbnails, dark CTA card with red edge-bars, footer. → `src/landing/`.
3. **`dashboard.html`** — 232px sidebar (Your sites/Templates/Add-ons, recent sites, Free-plan upsell meter, Help) + topbar (search, theme, notifications, New site, avatar→account) + content: greeting, 4 stat cards, segmented filter, site grid. One **expanded site card** spans full width and surfaces all 9 per-site tools as a link grid; plus normal site cards (hover reveals "Open editor") and a dashed "Start a new site" card. → `src/routes/dashboard/`.
4. **`editor.html` + `editor.js`** — full-viewport app: top bar (logo→dashboard, breadcrumb+page menu, URL chip, undo/redo, save state, presence avatars, theme, **Ask AI**, **Publish**); left panel (Add/Sections/Pages tabs — element grid + Style-kit list); center canvas (dotted bg, light artboard with fit-to-view zoom, selection box with handles, drifting peer cursor, zoom controls); right inspector (Label, Style variants, Fill swatches, roundness slider, link picker, motion); status bar. **Ask AI** opens a right slide-out chat with op-preview/accept. Interactions: tab switch, variant/fill/roundness live-update the canvas button, AI accept enlarges the heading, Publish toast. → `src/editor/`.
5. **`settings.html`** — per-site sidebar shell + Hosting, Password protection (switch reveals password field), Search engines, Visitor dark mode, Collaborators (avatars + role chips + Invite), Danger zone. → `site-settings.tsx`.
6. **`forms.html`** — submissions inbox: form selector, 3 mini-stats, table (From / Message / Received / chevron), unread dot, Export CSV. → `forms-inbox.tsx`.
7. **`versions.html`** — vertical timeline of snapshots (publish vs manual dots; Live/restore/preview). → `version-timeline.tsx`.
8. **`domains.html`** — current addresses w/ status chips, connect form, DNS records card. → `domains.tsx`.
9. **`a11y.html`** — conic-gradient score ring, 6 check cards (pass/warn), issue list with severity chips + "Fix in editor". → `a11y-report.tsx`.
10. **`account.html`** — global top-nav; tabs: Profile (avatar, fields, sign out) + Plan & billing (usage meters, 3 plan cards, invoices). → `profile.tsx` + `settings.tsx`.
11. **`shop.html`** — global top-nav; add-on cards (installed / not-on-site / coming-soon states). → `addon-shop.tsx`.
12. **`auth.html`** — split: dark brand panel (logo, headline w/ marker, mini-canvas, red edge-bars) + form side with Sign in / Create account toggle, OAuth, email fields. Wrap Clerk here. → Clerk route.
13. **`404.html`** — friendly not-found; "0" of 404 is the red ring; "Powered by Open Canvas". → `public.ts`.
14. **`draft.html`** — unpublished-site visitor view; "coming soon", half-built canvas with shimmer, owner sign-in nudge. → unpublished branch in `public.ts`.
15. **`locked.html`** — password gate; lock glyph, password field, error state (demo pwd `springtime`), keep minimal/no-JS. → `password/gate.ts`.

`site-shell.js` shows the shared per-site sidebar/topbar (links + icons) used by screens 5–9.

## Interactions & Behavior
- **Theme toggle:** flips `data-theme` on `<html>`, persists to `localStorage('oc-theme')`; inline `<head>` script applies before paint to avoid flash. For SSR routes also read an `oc-theme` cookie and stamp `data-theme` server-side. Transitions: `background-color/color .35s`.
- **Landing demo:** pure JS timeline loop (`demo.js`); inline-style transforms for cursors, class toggles for the button recolor; respects `prefers-reduced-motion` (renders final state statically).
- **Editor:** tabs/variants/fills/slider mutate the live artboard; `fit()` computes zoom to fit stage; AI panel slide-in; Publish shows a toast 2.6s.
- **Hovers:** buttons lift 1px; cards lift 4px + `--shadow-lg`; quick-action icons tint red-soft.
- **Focus:** `--ring` on inputs.
- **Responsive:** desktop-first; sidebars collapse < ~760px; grids drop columns; editor side panels hide assistant on narrow.

## State Management
Minimal client state (these are chrome prototypes): active tab, selected element + its style props (variant/fill/radius/label), theme, AI panel open, zoom level, toast visibility, switch states. In rev01 the editor's real state lives in the existing Yjs/vanilla client — only wire the visual controls to it; don't replace it. Dashboard/settings state is server-rendered.

## Design Tokens / Assets
- All tokens: `design-references/theme.css`. Components: `design-references/styles.css`.
- Logo: recreated as inline SVG (see MIGRATION.md §4) + original at `design-references/assets/logo-original.png`.
- Fonts: Google Fonts (Bricolage Grotesque, Hanken Grotesk, Spline Sans Mono) — self-host via existing `src/fonts/` for prod.
- Icons: inline stroke SVGs (1.8–2px) throughout the mocks; reuse or map to your icon set.
- Imagery: artboard "photos" are CSS gradients standing in for user uploads.

## Files (in this bundle, under `design-references/`)
`index.html`, `landing.html`, `dashboard.html`, `editor.html`, `settings.html`,
`forms.html`, `versions.html`, `domains.html`, `a11y.html`, `account.html`,
`shop.html`, `auth.html`, `404.html`, `draft.html`, `locked.html`,
`styles.css`, `theme.css`, `demo.js`, `editor.js`, `site-shell.js`,
`MIGRATION.md`, `assets/logo-original.png`.

## Suggested implementation order
Per MIGRATION.md §9: (1) tokens+fonts+components, (2) dashboard shell, (3) editor
chrome, (4) landing+demo, (5) sub-pages, (6) auth+public+dark-mode SSR. Verify
with MIGRATION.md §10 QA checklist — especially that published visitor sites are
unchanged.
