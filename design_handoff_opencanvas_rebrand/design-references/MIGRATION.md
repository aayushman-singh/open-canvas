# Open Canvas — Migration Guide

Faithful recreation of the new visual system inside the **rev01** codebase
(Cloudflare Workers + Hono JSX + vanilla editor client). This is a **reskin**:
you touch CSS tokens, component classes, fonts, markup chrome, and a theme
toggle. **You do not touch app logic, routing, the canvas schema, Yjs, the
agent, or the style-kits that theme *visitor* sites.**

> Mental model — two separate styling systems live in this repo:
> 1. **App chrome** = the landing, dashboard, and editor UI. *This* is what the
>    rebrand changes. Files: `landing/styles.ts`, `routes/dashboard/*`,
>    `editor/canvas-styles.ts`, `ui.ts`.
> 2. **Style Kits** = deterministic themes applied to the *user's published
>    site* (`canvas/style-kits.ts`, `public-styles.ts`). These are the
>    end-user's content, **not** the Open Canvas brand. Leave them unless you
>    want to add a new "Bloom"-style default kit (optional, see §8).

Reference implementation lives in `opencanvas/` — every screen is a working
HTML mock using `opencanvas/styles.css`. When in doubt, open the matching mock
and copy the markup/CSS.

---

## 0. File map (mock → your repo)

| Mock file | Your target |
|---|---|
| `theme.css` (tokens) | `src/ui.ts` (global) + prepend to landing/editor style strings |
| `styles.css` (components) | new `src/ui/components.css` loaded globally |
| `landing.html` + `demo.js` | `src/landing/index.tsx` + `styles.ts` + `demo-script.ts` |
| `dashboard.html` | `src/routes/dashboard/shell.tsx` + `index.tsx` |
| `editor.html` + `editor.js` | `src/editor/canvas-index.tsx` + `canvas-styles.ts` + `canvas-client.ts` |
| `settings.html` | `src/routes/dashboard/site-settings.tsx` |
| `forms.html` | `src/routes/dashboard/forms-inbox.tsx` |
| `versions.html` | `src/routes/dashboard/version-timeline.tsx` |
| `domains.html` | `src/routes/dashboard/domains.tsx` |
| `a11y.html` | `src/routes/dashboard/a11y-report.tsx` |
| `account.html` | `src/routes/dashboard/profile.tsx` + `settings.tsx` (billing) |
| `shop.html` | `src/routes/dashboard/addon-shop.tsx` + `site-addons.tsx` |
| `auth.html` | your Clerk sign-in/up route wrapper |
| `404.html` | `src/routes/public.ts` not-found response |
| `draft.html` | unpublished-site branch in `src/routes/public.ts` |
| `locked.html` | `src/password/gate.ts` |
| `site-shell.js` | the dashboard site-level sidebar (`shell.tsx` already has one) |

---

## 1. Tokens — do this first (≈70% of the reskin)

1. Copy `opencanvas/theme.css` into the repo as `src/ui/theme.css` (or paste its
   contents into `uiStyles` in `src/ui.ts`).
2. Ensure it loads on **every** route, **after** existing `<style>` blocks.
   - **Dashboard:** `shell.tsx` injects `shellStyles` — put theme.css tokens
     *before* it, then delete the `:root{…}` block currently in `shellStyles`
     (theme.css's alias block already defines `--bg/--panel/--text/--accent/…`).
   - **Landing:** `src/landing/styles.ts` starts with a `:root{…}`. Replace that
     `:root` block with an `@import`/prepend of theme.css. The alias block
     re-points `--bg-deep/--fg/--accent/--hairline/--font-sans/…` automatically.
   - **Editor:** `src/editor/canvas-styles.ts` builds `chromeCss` with a
     `:root{ --rev01-… }` block. Prepend theme.css; the `--rev01-*` alias block
     re-points those names. Keep `kitCss` (visitor kits) untouched.

The alias blocks in theme.css map your existing variable names onto the new
palette, so variable-driven rules flip instantly. **Hard-coded literals are not
caught** — see §7.

**Why light now works:** tokens are defined for `:root` (light) and
`[data-theme="dark"]`. Your app was always-dark; after this it defaults light
and supports dark via the attribute (§6).

---

## 2. Fonts

Add to every page `<head>` (or inject once in the shared HTML wrapper):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Hanken+Grotesk:wght@400;450;500;600;700;800&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">
```

`--display` (Bricolage) is for headings, `--sans` (Hanken) for body, `--mono`
(Spline) only for the published-address chip and code-ish bits. Remove Inter and
IBM Plex from the **chrome** (keep IBM Plex/JetBrains in `style-kits.ts` if a
visitor kit uses them — that's the user's site, not your brand).

Self-host for production if you don't want a Google dependency: drop the woff2s
in R2 and emit `@font-face` (you already have `src/fonts/face-emit.ts`).

---

## 3. Component primitives

Copy the component classes from `opencanvas/styles.css` (everything below the
token blocks) into `src/ui/components.css`, loaded globally. Then swap class
names in your JSX. Mapping:

| Use | Class | Notes |
|---|---|---|
| Primary button | `.btn .btn-primary` | red fill, pill, `--shadow-red` |
| Secondary | `.btn .btn-ink` / `.btn .btn-outline` / `.btn .btn-ghost` | |
| Sizes | `.btn-sm` / `.btn-lg` | |
| Status pill | `.chip`, `.chip-ok`, `.chip-red`, `.chip-url` | `.chip` is `white-space:nowrap` |
| Card | `.card` | surface + hairline + `--shadow-sm` + `--r-lg` |
| Text input | `.field` + `label.lbl` | red focus ring via `--ring` |
| Toggle switch | `.switch > input + .track` | checkbox inside |
| Section label | `.eyebrow` | see §7 |
| Headline accent | `.marker` | see §7 |

These are framework-free CSS, so they work identically in Hono JSX — just put
the class on the element. Keep your existing `StyledModal` system; restyle it
with `.card` + `.btn`.

---

## 4. Brand mark (Hono JSX component)

Create `src/ui/Logo.tsx`. It inherits `currentColor` (set `color:var(--ink)` on
the parent) so it themes for free; the two red bars stay branded.

```tsx
export const Logo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <rect x="14" y="9" width="40" height="46" stroke="currentColor" stroke-width="2.4" />
    <circle cx="34" cy="32" r="11" stroke="currentColor" stroke-width="7" />
    <rect x="40" y="19" width="21" height="3.6" rx="1.8" fill="var(--red)" />
    <rect x="6"  y="43" width="21" height="3.6" rx="1.8" fill="var(--red)" />
  </svg>
);

export const Wordmark = () => (
  <span class="oc-logo" style="color:var(--ink)">
    <Logo />
    <span class="oc-word">Open&nbsp;Canvas</span>
  </span>
);
```

`.oc-logo` / `.oc-word` styles are in `styles.css`. Replace the current rev01
wordmark everywhere (header, footer, auth, error pages, emails).

---

## 5. Surface-by-surface

### 5a. Landing (`src/landing/`)
- Replace the `:root` + color rules in `styles.ts` with theme.css tokens; most
  selectors already use `--fg/--accent/--hairline` so they survive.
- **Kill the dark-on-dark literals:** `styles.ts` has many `oklch(...)` values
  baked into `body` gradients, `.panel`, `.statusbar`, etc. Replace with
  `var(--surface)/var(--line)/var(--paper)` etc. (grep for `oklch(`).
- Hero demo: the logic in `demo-script.ts` can stay. Restyle its DOM to match
  `opencanvas/demo.js` + the `.demo-*` CSS in `landing.html`:
  rounded browser frame, light canvas, red CTA, peer cursors, op-card. **Keep
  the live demo** — that was a requirement.
- Copy tone: benefit-first, plain language (see landing.html headings).

### 5b. Dashboard (`src/routes/dashboard/shell.tsx`, `index.tsx`)
- `shell.tsx`: delete its `:root` block, keep theme.css. Restyle `.app-header`/
  sidebar with the classes from `dashboard.html` (`.side`, `.topbar`, `.stat`,
  `.site-card`, `.new-card`). Structure already matches (sidebar + grid).
- The expanded "all features" card in `dashboard.html` shows how to link to the
  9 per-site tools — wire each to your existing routes.

### 5c. Editor (`src/editor/`)
- `canvas-styles.ts`: prepend theme.css, keep `kitCss`. Retheme the chrome
  selectors (`.ebar`, `.lpanel`, `.tabs`, `.ipanel`, `.cstage`, `.zoom`,
  `.status`) per `editor.html`. The **canvas/artboard stays light** — it renders
  the user's site, not your chrome.
- `canvas-client.ts` logic is untouched. Match the look of selection handles
  (`.selbox`), the AI slide-out (`.ai-panel`), and inspector controls
  (`.variants`, `.swrow`, `.slider`, `.seg2`) to `editor.html`.
- The fit-to-view zoom math is in `opencanvas/editor.js` (`fit()`), if useful.

### 5d. Site sub-pages (settings/forms/versions/domains/a11y)
- These share one sidebar+topbar shell. In the mocks it's injected by
  `site-shell.js`; in your repo that's a Hono JSX layout component — you already
  have a site-level sidebar in `shell.tsx`. Port the link list/icons from
  `site-shell.js` and the content layouts from each mock.

### 5e. Account (`profile.tsx` + `settings.tsx` billing tab) → `account.html`
- Profile form + the Billing tab (usage meters `.mtr`, plan cards `.plan`,
  invoices `.inv`). Two tabs in one page or keep your two routes.

### 5f. Add-ons (`addon-shop.tsx`, `site-addons.tsx`) → `shop.html`
- `.addon` cards with installed / coming-soon states.

### 5g. Auth → `auth.html`
- Clerk renders the actual form; wrap it in the split layout (dark brand panel
  left + form right). Style Clerk's elements via its `appearance` API to match
  `.btn`/`.field`, or use the branded panel around Clerk's `<SignIn/>`.

### 5h. Public pages (`src/routes/public.ts`, `src/password/gate.ts`)
- 404: port `404.html` markup into your not-found response.
- Draft/unpublished: port `draft.html` into the "no published snapshot" branch.
- Password gate: port `locked.html` into `gate.ts` (keep it minimal/no-JS for
  low attack surface — the real submit posts to `/__rev01/unlock`).

---

## 6. Dark mode wiring

The system is `[data-theme]` on `<html>`. Light is default.

- **Client toggle** (dashboard/editor/landing): the snippet at the bottom of
  every mock — flip the attribute + persist:
  ```js
  const cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', cur);
  localStorage.setItem('oc-theme', cur);
  ```
- **No-flash on load:** the tiny inline script in each mock `<head>` reads
  `localStorage` before paint. For server-rendered routes, also read a cookie
  (`oc-theme`) and stamp `data-theme` into the SSR `<html>` so there's no flash
  even before JS.
- **Visitor dark mode** is a *separate* existing feature
  (`src/themes/visitor-mode/`) for the published site — don't conflate it with
  chrome theme.

---

## 7. Gotchas (read before you start)

1. **`.marker` and `.eyebrow` use a background-gradient, not `::before`.**
   The red underline under headlines and the red tick before eyebrows are drawn
   with `background-image:linear-gradient(var(--red),var(--red))` so they render
   everywhere and survive screenshotting. Don't "refactor" them to pseudo-
   elements.
2. **The brand red ≠ a Style Kit.** If a visitor's site uses the "Orange
   Editorial" kit, that orange is theirs. The Open Canvas red only dresses the
   chrome. Keep `style-kits.ts` hex values as-is.
3. **Wrapped display headings:** Bricolage is wide. Give headline containers
   real `line-height` (≥1.1) and the following element a positive `margin-top`;
   don't pin heights.
4. **`white-space:nowrap`** is set on `.chip`, `.eyebrow`, nav links, and tabs
   on purpose (they must never wrap). Keep it.
5. **OKLCH:** your editor chrome used OKLCH; the new tokens are hex/rgba for
   wider reach. Fine to keep OKLCH literals you still want, but prefer the
   `var(--…)` tokens.

---

## 8. Optional — a matching default Style Kit

If you want new *sites* to start on-brand, add a "Bloom" kit to
`src/canvas/style-kits.ts` mirroring the mock artboard:
`accent #E84D4A`, bg `#FBFAF8`, panel `#FFFFFF`, ink `#1A1917`, display
Bricolage Grotesque, body Hanken Grotesk, radius 16, soft warm shadows.
This is independent of the chrome reskin.

---

## 9. Suggested order / PRs

1. **PR 1 — tokens + fonts + components** (`theme.css`, `components.css`,
   `Logo.tsx`). Merging this alone visibly shifts the whole app.
2. **PR 2 — dashboard shell + site grid.**
3. **PR 3 — editor chrome.**
4. **PR 4 — landing + live demo restyle.**
5. **PR 5 — sub-pages (settings/forms/versions/domains/a11y/account/shop).**
6. **PR 6 — auth + public (404/draft/gate) + dark-mode cookie SSR.**

## 10. QA checklist

- [ ] Toggle light/dark on every surface — no unreadable text, no flash on load.
- [ ] Grep chrome files for `oklch(`, `#0a0e1a`, `#080b13`, `#7dd3fc`, `Inter`,
      `IBM Plex` — replace leftover literals with tokens.
- [ ] Logo renders in both themes (red bars visible on dark).
- [ ] Buttons/inputs/chips/switches match the mocks.
- [ ] Editor canvas/artboard stays light in dark mode (it's the user's site).
- [ ] Published visitor sites are UNCHANGED (style-kits untouched).
- [ ] 404 / draft / password gate themed and functional.
- [ ] Keyboard focus rings visible (`--ring`).
