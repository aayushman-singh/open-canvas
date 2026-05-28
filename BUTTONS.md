# BUTTONS.md — rev01 interactive-control catalog

Master list of every interactive control that exists in the rev01 product (marketing + auth + dashboard + editor + published site). Stable IDs per row so you can dispatch agents at named subsets.

## How to use this doc

Each row tells an agent **where** to find a control and **what** should happen when it's exercised. Columns:

- **ID** — stable identifier (`B-<surface>-<seq>`). Don't re-number; append new rows at the end of a surface's table when something new ships.
- **Label** — the visible text or aria-label.
- **Selector** — a precise DOM selector or `data-*` attribute. Prefer this over text matching in tests.
- **Kind** — button | link | text | textarea | email | password | url | checkbox | radio | range | color | number | select | file | hidden-input | submit | tab | dialog.
- **Action** — what the click/change/submit hits server-side, OR the local UI mutation it should produce.
- **Expected on success** — the observable contract: status code, DOM change, modal opens/closes, URL change, status text appears, etc.
- **Source** — file:line where the control is emitted (server-rendered) or injected (canvas-client).
- **Preconditions** — must-be-true state for the control to even appear (e.g. "an element is selected on canvas", "site has at least one Form element").

## Agent-prompt template

When dispatching an agent at a row or set of rows, hand them this brief:

> Open `<url>`, locate the control at selector `<selector>` (label "`<label>`"). Verify the precondition. Fire the event appropriate to its `kind` (click for button, fill+submit for text, etc.). Observe the **Expected on success** column and report PASS or FAIL with: HTTP status of the triggered request, any console error, the diff of `editableState` if a canvas write was involved, and whether the user-visible status text/toast/modal landed. Restore any state you changed.

## Legend in the tables

- 🚨 = currently broken (Run 3) — included so an agent can confirm the regression is fixed.
- ⚠️ = partial / has a quirk.
- (everything else is presumed working unless an agent reports otherwise)

---

## 0. Sign-in / Sign-out

| ID         | Label                                               | Selector                                              | Kind | Action                                                                                             | Expected on success                                                                                                      | Source                                                                                             | Pre              |
| ---------- | --------------------------------------------------- | ----------------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------- |
| B-AUTH-001 | Sign in (Clerk hosted)                              | n/a (Clerk Account Portal)                            | link | redirects to `accounts.<root>/sign-in?redirect_url=...` from any unauth'd `/dashboard/*` route hit | Clerk portal renders sign-in UI; after success, redirects back with `__session` cookie; original URL loads               | `src/auth/require-auth.ts:46-50` (`buildSignInUrl`)                                                | unauth'd browser |
| B-AUTH-002 | Sign out (dashboard kebab in shell or Profile page) | `a.dash-sign-out` (index) / `a.btn-signout` (profile) | link | `GET /sign-out`                                                                                    | Clerk session revoked via Backend API; known Clerk cookies plus `__rev01_edit` expire on host/shared domain; 302s to `/` | `src/auth/sign-out-route.ts`, `src/routes/dashboard/index.tsx`, `src/routes/dashboard/profile.tsx` | signed in        |

---

## 1. Marketing landing `/`

| ID              | Label                                                                                                                               | Selector                             | Kind            | Action                                                              | Expected on success                                                                                                          | Source                              | Pre |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --- |
| B-LAND-001      | rev01 logo                                                                                                                          | `header a[href="/"]`                 | link            | navigates `/`                                                       | landing root re-renders                                                                                                      | `src/routes/marketing.tsx` (header) | —   |
| B-LAND-002      | docs                                                                                                                                | `header a[href$="/docs"]`            | link            | navigates `https://github.com/aayushman-singh/rev01/tree/main/docs` | github tab opens                                                                                                             | same                                | —   |
| B-LAND-003      | github                                                                                                                              | `header a[href$="rev01"]`            | link            | github repo                                                         | github tab opens                                                                                                             | same                                | —   |
| B-LAND-004      | Launch dashboard (header)                                                                                                           | `header a[href="/dashboard"]`        | link            | → `/dashboard`                                                      | dashboard renders (or B-AUTH-001 redirect if unauth)                                                                         | same                                | —   |
| B-LAND-005      | Start building (hero CTA)                                                                                                           | hero region `a[href="/dashboard"]`   | link            | → `/dashboard`                                                      | dashboard renders                                                                                                            | same                                | —   |
| B-LAND-006      | View source (hero CTA)                                                                                                              | hero region `a[href$="rev01"]`       | link            | github                                                              | tab opens                                                                                                                    | same                                | —   |
| B-LAND-007      | Launch dashboard (footer)                                                                                                           | footer `a[href="/dashboard"]`        | link            | → `/dashboard`                                                      | dashboard renders                                                                                                            | same                                | —   |
| B-LAND-008      | github (footer)                                                                                                                     | footer `a[href$="rev01"]`            | link            | github                                                              | tab opens                                                                                                                    | same                                | —   |
| B-LAND-009      | docs (footer)                                                                                                                       | footer `a[href$="/docs"]`            | link            | github docs                                                         | tab opens                                                                                                                    | same                                | —   |
| B-LAND-010..014 | Hero demo replay buttons: Add / Sections / Pages / + Blank section / Text / Image / Button / Shape / Container / Nav / Chart / Form | `.demo-sidebar button`               | button          | replay-only — no event handler                                      | clicking is a no-op (purely visual); the recorded canvas animation continues                                                 | same                                | —   |
| B-LAND-015..018 | Style kit chips charcoal / orange / blue / green                                                                                    | `.demo-style-kit button[data-kit=…]` | button          | replay-only                                                         | no-op visually swaps tile colours in the demo replay                                                                         | same                                | —   |
| B-LAND-019      | Runtime counters (LOC / EDIT OPS / AGENT OPS / PUBLISHED)                                                                           | `[data-counter]`                     | non-interactive | IntersectionObserver tick                                           | numbers tick from 0 to final value (LOC≈1247, edits≈42, agents≈12, published seeded value) when section is partially in fold | same                                | —   |

---

## 2. Published site `<subdomain>.rev01.aayushman.dev/`

The published-site DOM depends on the author's canvas. The shell always emits:

| ID        | Label                                              | Selector                                        | Kind   | Action                                                                                  | Expected on success                                                            | Source                                                    | Pre                                      |
| --------- | -------------------------------------------------- | ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| B-PUB-001 | made with rev01                                    | footer `a[href="https://rev01.aayushman.dev/"]` | link   | marketing root                                                                          | landing loads                                                                  | `src/routes/public.ts` shell                              | branding enabled (Free plan)             |
| B-PUB-002 | edit this site                                     | footer `a[href="/?edit"]`                       | link   | opens `/?edit`; without `__rev01_edit`, bootstraps `/api/on-site-edit` in a Clerk popup | popup auths owner; on close, `/?edit` reopens editor on parent site            | `src/routes/public.ts` + `src/routes/api/on-site-edit.ts` | branding enabled                         |
| B-PUB-003 | browse templates                                   | footer `a[href="…/dashboard/templates"]`        | link   | → marketing dashboard                                                                   | templates page loads                                                           | shell                                                     | branding enabled                         |
| B-PUB-004 | published site form elements (Form element submit) | form `[data-rev01-form]`                        | submit | `POST /api/sites/:siteId/forms/:formElementId/submissions`                              | submission persisted; success "thank you" state shown                          | `src/forms/submit.ts`                                     | author added a Form element to a section |
| B-PUB-005 | every author-defined Action element                | the `<a>` it renders                            | link   | resolved per element's `href.type` (`internal` page slug or `external` URL)             | navigates / opens new tab                                                      | canvas action element renderer                            | author placed actions                    |
| B-PUB-006 | visitor dark-mode toggle                           | `[data-visitor-mode-toggle]`                    | button | flips `data-color-mode` on `<html>` + persists in localStorage                          | site re-renders in opposite mode                                               | site settings has "Let visitors switch" on                | dark-mode addon enabled                  |
| B-PUB-007 | `/sitemap.xml`                                     | n/a                                             | GET    | returns valid `<urlset>`                                                                | 200, `application/xml`; `<loc>` is the canonical published URL (no `#v=` hash) | `src/routes/public.ts` sitemap handler                    | site published                           |
| B-PUB-008 | `/robots.txt`                                      | n/a                                             | GET    | returns content-signals preamble + `User-agent: *`                                      | 200, `text/plain`                                                              | same                                                      | —                                        |
| B-PUB-009 | `/__rev01/search?q=…`                              | n/a                                             | GET    | returns `{q, hits:[{pageSlug, elementId, snippet}]}`                                    | 200, `application/json`; tsv-backed full-text search                           | `src/routes/public.ts` search                             | search-indexing enabled                  |
| B-PUB-010 | `/og/:siteId/:pageSlug.png`                        | n/a                                             | GET    | renders 1200×630 OG image                                                               | 200, `image/png`, non-empty body                                               | `src/routes/api/og.ts`                                    | site has canvas                          |

---

## 3. Dashboard shell — top-nav + site-sidebar (visible on every `/dashboard/*` page)

Top-nav (`src/routes/dashboard/shell.tsx:328-345`):

| ID          | Label      | Selector                                     | Kind | Action                 | Expected on success      | Pre       |
| ----------- | ---------- | -------------------------------------------- | ---- | ---------------------- | ------------------------ | --------- |
| B-SHELL-001 | rev01 logo | `a.app-logo`                                 | link | → `/dashboard`         | dashboard renders        | signed in |
| B-SHELL-002 | Sites      | `.app-nav-link[href="/dashboard"]`           | link | → `/dashboard`         | dashboard renders        | —         |
| B-SHELL-003 | Templates  | `.app-nav-link[href="/dashboard/templates"]` | link | → templates            | templates page renders   | —         |
| B-SHELL-004 | Addons     | `.app-nav-link[href="/dashboard/addons"]`    | link | → addons shop          | shop renders             | —         |
| B-SHELL-005 | Settings   | `.app-nav-link[href="/dashboard/settings"]`  | link | → settings             | account settings renders | —         |
| B-SHELL-006 | Avatar     | `a.app-avatar-link`                          | link | → `/dashboard/profile` | profile renders          | —         |

Site-sidebar (shown on every `/dashboard/sites/:siteId/*` page, `shell.tsx:355-372`):

| ID          | Label           | Selector                                  | Kind | Action                    | Expected on success | Pre                    |
| ----------- | --------------- | ----------------------------------------- | ---- | ------------------------- | ------------------- | ---------------------- |
| B-SHELL-101 | ← All sites     | `a.site-sidebar-back`                     | link | → `/dashboard`            | dashboard renders   | inside a site sub-page |
| B-SHELL-102 | ✎ Go to editor  | `a.site-sidebar-link[href$="/edit"]`      | link | → editor for current site | editor renders      | —                      |
| B-SHELL-103 | ⚙ Settings      | `a.site-sidebar-link[href$="/settings"]`  | link | → site settings           | renders             | —                      |
| B-SHELL-104 | ☰ Navigation   | `a.site-sidebar-link[href$="/nav"]`       | link | → site nav editor         | renders             | —                      |
| B-SHELL-105 | ✉ Forms         | `a.site-sidebar-link[href$="/forms"]`     | link | → forms inbox             | renders             | —                      |
| B-SHELL-106 | ⧖ Versions      | `a.site-sidebar-link[href$="/snapshots"]` | link | → version timeline        | renders             | —                      |
| B-SHELL-107 | ⌗ Domains       | `a.site-sidebar-link[href$="/domains"]`   | link | → domains                 | renders             | —                      |
| B-SHELL-108 | ⬡ Addons        | `a.site-sidebar-link[href$="/addons"]`    | link | → site addons             | renders             | —                      |
| B-SHELL-109 | ✔ Accessibility | `a.site-sidebar-link[href$="/a11y"]`      | link | → a11y report             | renders             | —                      |
| B-SHELL-110 | … Chat          | `a.site-sidebar-link[href$="/chat"]`      | link | → site chat               | renders             | —                      |

---

## 4. `/dashboard` index (`src/routes/dashboard/index.tsx`) 🚨 currently 500

| ID         | Label                                                                 | Selector                              | Kind   | Action                                           | Expected on success                                                   | Source line | Pre                               |
| ---------- | --------------------------------------------------------------------- | ------------------------------------- | ------ | ------------------------------------------------ | --------------------------------------------------------------------- | ----------- | --------------------------------- |
| B-DASH-001 | Import                                                                | `#import-btn`                         | button | opens import modal                               | modal shown with URL + name + subdomain inputs                        | 1195        | —                                 |
| B-DASH-002 | + New site                                                            | `.new-site` (when under limit)        | link   | → `/dashboard/templates`                         | templates renders                                                     | 1198        | sites < plan limit                |
| B-DASH-003 | Upgrade to add sites                                                  | `.new-site` (when at limit)           | link   | → `/dashboard/settings`                          | settings (Billing) renders                                            | 1197        | sites == plan limit               |
| B-DASH-004 | URL to import                                                         | `#import-url`                         | url    | modal field                                      | accepts URL                                                           | 1214        | import modal open                 |
| B-DASH-005 | Site name                                                             | `#import-name`                        | text   | modal field                                      | accepts text                                                          | 1219        | same                              |
| B-DASH-006 | Subdomain                                                             | `#import-subdomain`                   | text   | modal field                                      | accepts slug                                                          | 1223        | same                              |
| B-DASH-007 | Cancel (import modal)                                                 | `#import-cancel`                      | button | closes modal                                     | modal removed                                                         | 1229        | same                              |
| B-DASH-008 | Import (modal submit)                                                 | `#import-submit`                      | submit | `POST /api/import`                               | 200; new site appears in grid                                         | 1230        | same                              |
| B-DASH-009 | (site card address chip)                                              | `.site-card-addr`                     | link   | opens `https://<subdomain>.rev01.aayushman.dev/` | published site loads in new tab                                       | 1255-1262   | site card                         |
| B-DASH-010 | Edit (per card)                                                       | `.btn-edit`                           | link   | → editor for that site                           | editor renders                                                        | 1273        | —                                 |
| B-DASH-011 | Live · Make draft (per card)                                          | `.btn-unpublish`                      | button | `POST /api/publish/sites/:id/unpublish`          | 200; pill flips to "Draft"; card status updated                       | 1275-1283   | site is published                 |
| B-DASH-012 | Publish (per card)                                                    | `.btn-publish`                        | button | `POST /api/publish/sites/:id`                    | 200; publish modal of unfilled slots or success; pill flips to "Live" | 1285-1288   | site is draft + no unfilled media |
| B-DASH-013 | ⋮ kebab (per card)                                                    | `.btn-dots`                           | button | toggles `.site-card-details` panel               | panel slides open / closes                                            | 1289-1297   | —                                 |
| B-DASH-014 | Settings gear (in details)                                            | `.details-gear`                       | link   | → `/dashboard/sites/:id/settings`                | renders                                                               | 1032-1048   | details open                      |
| B-DASH-015 | Detail rows (Forms / A11y / Versions / Domains / Addons / Nav / Chat) | `.detail-row--link`                   | link   | → corresponding site sub-page                    | renders                                                               | 1017-1024   | details open                      |
| B-DASH-016 | Sign out                                                              | `a.dash-sign-out`                     | link   | B-AUTH-002                                       | session terminated                                                    | 1236        | —                                 |
| B-DASH-017 | Pick a template (welcome)                                             | welcome card link                     | link   | → `/dashboard/templates`                         | renders                                                               | 1310        | new user (0 sites)                |
| B-DASH-018 | Import existing site (welcome)                                        | welcome card button                   | button | opens import modal                               | modal shown                                                           | 1311        | new user                          |
| B-DASH-019 | Start from a template (quick-card)                                    | `.dash-quick-card[href$="templates"]` | link   | → templates                                      | renders                                                               | 1315        | —                                 |
| B-DASH-020 | Set up your profile (quick-card)                                      | `.dash-quick-card[href$="profile"]`   | link   | → profile                                        | renders                                                               | 1320        | —                                 |
| B-DASH-021 | Explore settings (quick-card)                                         | `.dash-quick-card[href$="settings"]`  | link   | → settings                                       | renders                                                               | 1325        | —                                 |

---

## 5. `/dashboard/templates` (`src/routes/dashboard/templates.tsx`) 🚨 currently 500

| ID             | Label                                                                                                                                              | Selector                                      | Kind   | Action                                    | Expected on success                                                | Source line | Pre                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------ | ----------------------------------------- | ------------------------------------------------------------------ | ----------- | -------------------- |
| B-TPL-001      | Community tab                                                                                                                                      | `input#ttab-community` (`label[for=…]`)       | radio  | swaps template grid to community seeds    | community grid visible; "Personal" hidden                          | 278-333     | —                    |
| B-TPL-002      | Personal tab                                                                                                                                       | `input#ttab-personal` (`label[for=…]`)        | radio  | swaps to user's saved templates           | personal grid visible; community hidden                            | same        | —                    |
| B-TPL-003..008 | 6 community template radios: `starter-canvas` / `launch-canvas` / `enterprise-scale-canvas` / `studio-canvas` / `local-canvas` / `apogee-showcase` | `input[name="templateId"][value=<id>]`        | radio  | selects template seed for the create form | radio checked; "Create site" button enabled (if under plan limit)  | same        | community tab active |
| B-TPL-009      | Site name                                                                                                                                          | `input[name="siteName"]`                      | text   | accepts site title                        | "My site" placeholder; required                                    | 339         | —                    |
| B-TPL-010      | Subdomain                                                                                                                                          | `input[name="subdomain"]`                     | text   | accepts slug                              | "auto-generated" placeholder; appended with `.rev01.aayushman.dev` | 348-354     | —                    |
| B-TPL-011      | Create site                                                                                                                                        | form submit                                   | submit | `POST /api/sites`                         | 201; redirect to `/dashboard/sites/:newId/edit`                    | 365-368     | sites < plan limit   |
| B-TPL-012      | Upgrade                                                                                                                                            | `.limit-notice a[href="/dashboard/settings"]` | link   | → settings                                | renders                                                            | 361         | sites == plan limit  |

---

## 6. `/dashboard/shop` ≡ `/dashboard/addons` (`src/routes/dashboard/addon-shop.tsx`)

| ID         | Label                           | Selector                                    | Kind     | Action                                   | Expected on success                 | Source line | Pre                    |
| ---------- | ------------------------------- | ------------------------------------------- | -------- | ---------------------------------------- | ----------------------------------- | ----------- | ---------------------- |
| B-SHOP-001 | Get (per-addon card)            | `.btn-acquire[data-addon-id=…]`             | button   | `POST /api/addons/:addonId/acquire`      | 200; card flips to "OWNED"          | ~96-100     | addon not yet acquired |
| B-SHOP-002 | (per-site config) site selector | `.addon-site-select select`                 | select   | scopes per-site rendering                | site list populated                 | inline      | acquired addon         |
| B-SHOP-003 | Enable on this site (per-site)  | `.addon-site-config input[type="checkbox"]` | checkbox | toggles `enabled` for the chosen site    | row visible in "active sites" list  | inline      | acquired addon         |
| B-SHOP-004 | Save (per-site config)          | `.addon-site-config button`                 | button   | `PUT /api/addons/sites/:siteId/:addonId` | 200; "Saved" status briefly visible | inline      | acquired addon         |

---

## 7. `/dashboard/profile` (`src/routes/dashboard/profile.tsx`)

| ID         | Label        | Selector                    | Kind     | Action              | Expected on success                                             | Source | Pre |
| ---------- | ------------ | --------------------------- | -------- | ------------------- | --------------------------------------------------------------- | ------ | --- |
| B-PROF-001 | Display name | `input[name="displayName"]` | text     | profile field       | accepts text                                                    | —      | —   |
| B-PROF-002 | Bio          | `textarea[name="bio"]`      | textarea | profile field       | accepts text                                                    | —      | —   |
| B-PROF-003 | Timezone     | `select[name="timezone"]`   | select   | profile field       | options populated; value persists                               | —      | —   |
| B-PROF-004 | Save changes | form submit                 | submit   | `POST /api/profile` | 200; status "Saved" text appears for ~2s; reload preserves diff | —      | —   |
| B-PROF-005 | Sign out     | `a.btn-signout`             | link     | B-AUTH-002          | session terminated                                              | —      | —   |

---

## 8. `/dashboard/settings` (`src/routes/dashboard/settings.tsx`) 🚨 currently 500

| ID             | Label                                                                                                                 | Selector                                        | Kind     | Action                                               | Expected on success                                            | Source | Pre                                                                |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------------- | ------ | ------------------------------------------------------------------ |
| B-SET-001      | Billing tab                                                                                                           | `.settings-tab[data-tab="billing"]`             | tab      | swap panel                                           | billing panel visible                                          | 42-62  | —                                                                  |
| B-SET-002      | Notifications tab                                                                                                     | `.settings-tab[data-tab="notifications"]`       | tab      | swap panel                                           | notifications panel visible                                    | 42-62  | —                                                                  |
| B-SET-003      | Account tab                                                                                                           | `.settings-tab[data-tab="account"]`             | tab      | swap panel                                           | account panel visible                                          | 42-62  | —                                                                  |
| B-SET-101      | Upgrade to Pro                                                                                                        | `.plan-card[data-plan="pro"] button`            | button   | opens Stripe checkout for the Pro price ID           | new tab to `checkout.stripe.com`; success → webhook flips plan | —      | on Free plan                                                       |
| B-SET-102      | Upgrade to Team                                                                                                       | `.plan-card[data-plan="team"] button`           | button   | opens Stripe checkout for Team                       | same                                                           | —      | on Free or Pro                                                     |
| B-SET-103      | Invoice download (per row)                                                                                            | `.invoice-row a`                                | link     | streams invoice PDF                                  | PDF file downloads                                             | —      | invoice exists                                                     |
| B-SET-201..205 | Notifications toggles: Site published / Collaborator activity / Form submissions / Product updates / Tips & tutorials | `.notif-row input[type="checkbox"]` (5 toggles) | checkbox | should `PATCH /api/profile/notifications` per change | 200; reload preserves toggle state                             | —      | ⚠️ B3: currently no `name`, no form, no JS handler — verify wiring |
| B-SET-301      | Delete account                                                                                                        | `.danger-zone button`                           | button   | (irreversible) `DELETE /api/profile`                 | account + sites + data destroyed; redirect to landing          | —      | ⚠️ never click during DFS                                          |

---

## 9. `/dashboard/sites/:id/settings` — Site Settings (`src/routes/dashboard/site-settings.tsx`)

| ID        | Label                         | Selector                                                                     | Kind     | Action                                             | Expected on success                                                               | Source line | Pre                         |
| --------- | ----------------------------- | ---------------------------------------------------------------------------- | -------- | -------------------------------------------------- | --------------------------------------------------------------------------------- | ----------- | --------------------------- |
| B-SST-001 | Enable (password protection)  | `form.pw button[type="submit"]` (`name="action"`, `value="enable-password"`) | submit   | `POST /api/sites/:id/password`                     | 200; password panel switches to "Enabled" state with "Change" + "Disable" buttons | 172-175     | password currently disabled |
| B-SST-002 | Password input                | `form.pw input[type="password"]`                                             | password | gate password                                      | accepts                                                                           | 182-195     | enable form open            |
| B-SST-003 | Disable (password)            | `.disable-pw-btn`                                                            | button   | `POST /api/sites/:id/password/disable`             | 200; panel reverts to "Disabled / Never set"                                      | inline      | password enabled            |
| B-SST-004 | Allow search engines to index | `input[type="checkbox"]` next to "Search indexing"                           | checkbox | `PUT /api/sites/:id/settings` `{indexable}`        | 200; checkbox state persists across reload                                        | —           | —                           |
| B-SST-005 | Choose image (favicon)        | `.favicon-picker button` (or label for hidden file input)                    | button   | opens `.picker-modal`                              | modal renders; can pick existing asset OR upload                                  | 320+        | —                           |
| B-SST-006 | (favicon file input)          | `.picker-modal input[type="file"]`                                           | file     | `POST /api/sites/:id/favicon`                      | 200; modal closes; preview thumbnail updates                                      | inline      | picker modal open           |
| B-SST-007 | Clear favicon                 | `.favicon-picker button.clear`                                               | button   | `DELETE /api/sites/:id/favicon`                    | 200; "none" state restored                                                        | 329-334     | favicon currently set       |
| B-SST-008 | Visitor dark mode toggle      | `input[type="checkbox"]` next to "Let visitors switch"                       | checkbox | `PUT /api/sites/:id/settings` `{visitorDarkMode}`  | 200; persists; published site re-renders to add toggle script                     | —           | —                           |
| B-SST-009 | Collaborator email            | `.collab-form input[type="email"]`                                           | email    | invite form field                                  | accepts                                                                           | 217-232     | —                           |
| B-SST-010 | Collaborator role             | `.collab-form select`                                                        | select   | options: `editor` (and any others defined in code) | accepts                                                                           | same        | —                           |
| B-SST-011 | Invite                        | `.collab-form button`                                                        | submit   | `POST /api/sites/:id/collaborators`                | 201; row appears in collaborators list; pending-invite badge                      | 205-232     | —                           |
| B-SST-012 | Remove (per row)              | `.remove-btn` (per collaborator row)                                         | button   | `DELETE /api/sites/:id/collaborators/:collabId`    | 200; row removed                                                                  | 270-284     | collaborator row exists     |

---

## 10. `/dashboard/sites/:id/nav` — Nav Editor (`src/routes/dashboard/nav-editor.tsx`) 🚨 currently 404

| ID        | Label                | Selector                                | Kind     | Action                                     | Expected on success       | Pre        |
| --------- | -------------------- | --------------------------------------- | -------- | ------------------------------------------ | ------------------------- | ---------- |
| B-NAV-001 | Layout               | `select[name="layout"]`                 | select   | options: `left-center-right`, `left-right` | accepted                  | —          |
| B-NAV-002 | Logo asset ID        | `input[name="logoAssetId"]`             | text     | references an Owner Asset id               | accepted                  | —          |
| B-NAV-003 | Sticky               | `input[name="sticky"][type="checkbox"]` | checkbox | toggles `nav.sticky`                       | accepted                  | —          |
| B-NAV-004 | Link label (per row) | `input[name^="label"]`                  | text     | accepted                                   | accepted                  | row exists |
| B-NAV-005 | Link kind (per row)  | `select[name^="kind"]`                  | select   | `internal` / `external`                    | accepted                  | row exists |
| B-NAV-006 | Link href (per row)  | `input[name^="href"]`                   | url      | accepted                                   | accepted                  | row exists |
| B-NAV-007 | Remove (per row)     | row `button`                            | button   | drops the row client-side                  | row disappears            | row exists |
| B-NAV-008 | + Add link           | bottom `button`                         | button   | adds a blank row client-side               | row inserted              | —          |
| B-NAV-009 | Save                 | form submit                             | submit   | `PUT /api/canvas/sites/:id/nav`            | 200; bar config persisted | —          |

---

## 11. `/dashboard/sites/:id/forms` — Forms Inbox (`src/routes/dashboard/forms-inbox.tsx`)

| ID        | Label                                | Selector                               | Kind | Action                                             | Expected on success     | Pre                                    |
| --------- | ------------------------------------ | -------------------------------------- | ---- | -------------------------------------------------- | ----------------------- | -------------------------------------- |
| B-FRM-001 | (form card, per form)                | `.form-card`                           | link | → `/dashboard/sites/:id/forms/:formElementId`      | submission list renders | site has ≥1 Form element               |
| B-FRM-002 | Download CSV (on a form detail page) | `.actions a[href$="/submissions.csv"]` | link | `GET /api/sites/:id/forms/:formId/submissions.csv` | CSV streams             | on form detail page with ≥1 submission |
| B-FRM-003 | Back to forms                        | `.actions a[href$="/forms"]`           | link | → forms inbox                                      | renders                 | on form detail page                    |

---

## 12. `/dashboard/sites/:id/snapshots` — Versions (`src/routes/dashboard/version-timeline.tsx`)

| ID        | Label             | Selector                                         | Kind   | Action                                                                                    | Expected on success                                                                                             | Source line | Pre             |
| --------- | ----------------- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------- | --------------- |
| B-SNP-001 | Preview (per row) | `button[data-timeline-action="preview"]`         | button | `GET /api/sites/:id/snapshots/:snapshotId/preview` (HTML)                                 | 200; HTML injected into the PREVIEW pane (no iframe)                                                            | 325-326     | snapshot exists |
| B-SNP-002 | Restore (per row) | `button[data-timeline-action="restore"]`         | button | opens `__rev01Modal.confirm`; on OK → `POST /api/sites/:id/snapshots/:snapshotId/restore` | confirm modal uses `.rev01-modal-backdrop`; 200 → page reloads after 800ms; current canvas == restored snapshot | 328-330     | snapshot exists |
| B-SNP-003 | Snapshot label    | `form[data-timeline-form] input[name="label"]`   | text   | captured in form data                                                                     | accepts                                                                                                         | 337-342     | —               |
| B-SNP-004 | Save (snapshot)   | `form[data-timeline-form] button[type="submit"]` | submit | `POST /api/sites/:id/snapshots` `{label}`                                                 | 201; new row appears at top of timeline                                                                         | 344         | —               |

---

## 13. `/dashboard/sites/:id/domains` — Custom Domains (`src/routes/dashboard/domains.tsx`)

| ID        | Label                   | Selector                                 | Kind   | Action                                    | Expected on success                                                           | Source line | Pre        |
| --------- | ----------------------- | ---------------------------------------- | ------ | ----------------------------------------- | ----------------------------------------------------------------------------- | ----------- | ---------- |
| B-DOM-001 | Hostname                | `form.add-domain input[name="hostname"]` | text   | accepts hostname                          | accepts                                                                       | 66-72       | —          |
| B-DOM-002 | Add domain              | `form.add-domain button[type="submit"]`  | submit | `POST /api/sites/:id/domains`             | 201; new row with "pending verification" status; DNS CNAME instructions shown | 49-58       | —          |
| B-DOM-003 | Delete domain (per row) | `.domain button` (per row)               | button | `DELETE /api/sites/:id/domains/:domainId` | 200; row removed                                                              | inline      | row exists |

---

## 14. `/dashboard/sites/:id/addons` — Site Addons (`src/routes/dashboard/site-addons.tsx`)

| ID         | Label                                | Selector                                               | Kind     | Action                                       | Expected on success                                      | Pre            |
| ---------- | ------------------------------------ | ------------------------------------------------------ | -------- | -------------------------------------------- | -------------------------------------------------------- | -------------- |
| B-SADD-001 | Enable on this site (GA)             | `input[type="checkbox"]` next to "Enable on this site" | checkbox | toggles enabled state in the local form      | accepts                                                  | GA addon owned |
| B-SADD-002 | MEASUREMENT ID                       | `input[name="measurementId"]`                          | text     | accepts `G-XXXXXXX`                          | accepts                                                  | —              |
| B-SADD-003 | Save (GA)                            | section button                                         | submit   | `PUT /api/addons/sites/:id/google-analytics` | 200; status "Saved. Publish your site to apply changes." | —              |
| B-SADD-004 | Visit Addons (Custom Scripts locked) | shop link                                              | link     | → `/dashboard/shop`                          | shop renders                                             | —              |

---

## 15. `/dashboard/sites/:id/a11y` — A11y Report

No interactive controls. Read-only display of violations grouped by severity.

| ID         | Label  | Selector | Kind   | Action | Expected on success                                                                                                                       | Pre |
| ---------- | ------ | -------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | --- |
| B-A11Y-001 | (read) | n/a      | static | n/a    | shows N blocking / N warning / N info counts and a card per issue (heading-skip, color-contrast, etc.) with element id + remediation copy | —   |

---

## 16. `/dashboard/sites/:id/chat` — Site Chat (`src/routes/dashboard/chat-panel.tsx`)

| ID        | Label                | Selector                    | Kind     | Action                                                    | Expected on success                                                                                        | Source line | Pre                      |
| --------- | -------------------- | --------------------------- | -------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------- | ------------------------ |
| B-CHT-001 | Message textarea     | `textarea#chat-input`       | textarea | accepts message                                           | accepts                                                                                                    | 356         | —                        |
| B-CHT-002 | Send                 | `button#chat-send`          | button   | `POST /api/sites/:siteId/chat` (SSE stream)               | 200; assistant message streamed into transcript; respects "do not modify" guard (no unsolicited tool call) | 151, 305    | —                        |
| B-CHT-003 | Accept (proposed op) | dynamic button per proposal | button   | applies the agent's proposed canvas op to `editableState` | element/section/etc. mutates as described; proposal block clears                                           | —           | agent has proposed an op |
| B-CHT-004 | Reject (proposed op) | dynamic button per proposal | button   | discards the proposal                                     | proposal block clears; no canvas mutation                                                                  | —           | agent has proposed an op |

---

## 17. Editor `/dashboard/sites/:id/edit`

### 17.1 Topbar (`src/editor/canvas-index.tsx:151-169`)

| ID         | Label                  | Selector                                          | Kind   | Action                                                                                                                                                           | Expected on success                                                                                                                                                                                                                                                 | Pre |
| ---------- | ---------------------- | ------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| B-ED-T-001 | dashboard (breadcrumb) | `header.rev01-editor-header a[href="/dashboard"]` | link   | → `/dashboard`                                                                                                                                                   | dashboard renders                                                                                                                                                                                                                                                   | —   |
| B-ED-T-002 | AI Chat                | `#canvas-chat-toggle`                             | button | toggles `#canvas-chat-panel` visible/hidden                                                                                                                      | panel slide-out animates open or closed                                                                                                                                                                                                                             | —   |
| B-ED-T-003 | Settings               | `#canvas-settings-link`                           | link   | → `/dashboard/sites/:id/settings`                                                                                                                                | site settings renders                                                                                                                                                                                                                                               | —   |
| B-ED-T-004 | Save                   | `#canvas-save`                                    | button | `PUT /api/canvas/sites/:id` (debounced)                                                                                                                          | 200 `{ok:true}`; status changes to "Saved" briefly                                                                                                                                                                                                                  | —   |
| B-ED-T-005 | Publish                | `#canvas-publish`                                 | button | `POST /api/publish/sites/:id`                                                                                                                                    | 200 if all media slots are filled → success modal "Site published" with link; 400 with `{error:"cannot publish: unfilled media slots", unfilledMediaSlots:[…]}` if any element references a placeholder asset — render the error in a `.rev01-modal-backdrop` modal | —   |
| B-ED-T-006 | Save as template       | `#canvas-save-template`                           | button | two-step modal: `openTextModal("Save as template — name")` → `openTextModal("One-line description")` → `POST /api/custom-templates {name, tagline, sourceState}` | 200 `{ok:true, id}`; template appears in `/dashboard/templates` Personal tab                                                                                                                                                                                        | —   |

### 17.2 Sidebar tabs (`src/editor/canvas-index.tsx:187-203` + canvas-client injection)

| ID           | Label               | Selector                        | Kind   | Action                                         | Expected on success              | Pre                                                                     |
| ------------ | ------------------- | ------------------------------- | ------ | ---------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| B-ED-TAB-001 | Add                 | `[data-sidebar-tab="add"]`      | tab    | shows Sections + Components + Style Kit panels | Add panel visible; others hidden | —                                                                       |
| B-ED-TAB-002 | Sections            | `[data-sidebar-tab="sections"]` | tab    | shows sections picker                          | sections panel visible           | —                                                                       |
| B-ED-TAB-003 | Pages               | `[data-sidebar-tab="pages"]`    | tab    | shows pages list                               | pages panel visible              | —                                                                       |
| B-ED-TAB-004 | Symbols (injected)  | `[data-sidebar-tab="symbols"]`  | tab    | shows Symbols panel                            | Symbols panel visible            | canvas-client.ts injects on mount (line 8918 `ensureSymbolsTabMounted`) |
| B-ED-TAB-005 | Versions (injected) | `[data-sidebar-tab="versions"]` | tab    | shows Version History panel                    | Version panel visible            | canvas-client.ts injects                                                |
| B-ED-TAB-006 | Sidebar toggle      | `#sidebar-toggle`               | button | collapses/expands the sidebar                  | sidebar width animates           | line 186                                                                |

### 17.3 Add panel — Sections + Components + Style Kit (`canvas-index.tsx:213-354`)

| ID                | Label                                                                                                                         | Selector                                                 | Kind   | Action                                              | Expected on success                                                                        | Pre                  |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------- | --------- | ----- | ---- | ----- | ---- | --------- | -------- | ----- | ------- | ------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| B-ED-ADD-001      | + Blank section                                                                                                               | `[data-sidebar-add-section="blank"]`                     | button | appends an empty section to the active page         | `editableState.pages[i].sections.length += 1`; canvas shows new section                    | active page selected |
| B-ED-ADD-002..015 | Text / Image / Video / Button (action) / Shape / Container / Chart / Form / Embed / Code / Accordion / Carousel / Table / Nav | `[data-sidebar-add-component="<text                      | image  | video                                               | action                                                                                     | shape                | container | chart | form | embed | code | accordion | carousel | table | nav>"]` | button (×14) | appends a fresh element of that type to the focused section | `editableState.pages[i].sections[k].elements.length += 1`; canvas renders new element at default position (40, 40) | a section is focused (otherwise the click is a silent no-op) |
| B-ED-ADD-016      | (style kit chip)                                                                                                              | `button[data-sidebar-style-kit="<kitId>"][aria-pressed]` | button | `POST /api/canvas/sites/:id/style-kit {styleKitId}` | 200; `main[data-style-kit]` flips; canvas re-renders with new tokens; aria-pressed updated | —                    |

### 17.4 Pages panel (`canvas-index.tsx:378-385` + canvas-client `:960-1003`)

| ID          | Label            | Selector                            | Kind   | Action                                                                     | Expected on success                                                         | Pre                                            |
| ----------- | ---------------- | ----------------------------------- | ------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| B-ED-PG-001 | (page item)      | `.rev01-page-item[data-page-id]`    | click  | `setActivePage(pageId)`                                                    | clicked page becomes active; canvas re-renders; URL hash optionally updates | —                                              |
| B-ED-PG-002 | Rename (per row) | `button[data-page-action="rename"]` | button | `openTextModal` → `PUT /api/canvas/sites/:id` with updated page title/slug | 200; sidebar entry updates; page title in browser tab updates               | —                                              |
| B-ED-PG-003 | SEO (per row)    | per-row `a`                         | link   | → `/dashboard/sites/:id/pages/:pageId/seo`                                 | SEO page opens in new tab                                                   | —                                              |
| B-ED-PG-004 | Del (per row)    | `button[data-page-action="delete"]` | button | `openConfirmModal` → `PUT /api/canvas/sites/:id` removing the page         | 200; row disappears; first remaining page activates                         | site has ≥2 pages (last page can't be deleted) |
| B-ED-PG-005 | + New Page       | `#canvas-add-page`                  | button | `openTextModal` → creates a new page in `editableState.pages`              | 200; new page row + canvas switches to it                                   | —                                              |

### 17.5 Versions panel (injected, canvas-client `:8681-8827`)

| ID           | Label             | Selector                                               | Kind   | Action                                                                   | Expected on success                                                | Pre             |
| ------------ | ----------------- | ------------------------------------------------------ | ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------- |
| B-ED-VER-001 | Save snapshot     | `button.rev01-sidebar-command` (within Versions panel) | button | `openTextModal` → `POST /api/sites/:id/snapshots {label}`                | 201; new row at top of in-editor timeline; status "Snapshot saved" | —               |
| B-ED-VER-002 | Restore (per row) | `button` per row                                       | button | `openConfirmModal` → `POST /api/sites/:id/snapshots/:snapshotId/restore` | 200; editor reloads with restored canvas state                     | snapshot exists |

### 17.6 Inspector — selected element (canvas-client `:2436-4531`)

All inspector controls require a precondition: **an element is selected**. Click any `[data-rev01-element]` on the canvas to surface the inspector in the right-side aside (~320px wide, no className — find via width filter). After that, the controls that appear vary by element type. Below is the complete set; not every type renders every control.

#### Reading order + z-order + Duplicate/Delete (always shown)

| ID           | Label                      | Selector           | Kind   | Action                                        | Expected on success                                                                              |
| ------------ | -------------------------- | ------------------ | ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| B-ED-INS-001 | Move up in reading order   | inspector `button` | button | `moveInReadingOrder(section, element, -1)`    | element index in section.elements decreases; canvas re-renders; disabled when already at index 0 |
| B-ED-INS-002 | Move down in reading order | inspector `button` | button | `moveInReadingOrder(section, element, +1)`    | element index in section.elements increases                                                      |
| B-ED-INS-003 | Bring to front             | inspector `button` | button | `applyZOrderAction("front")`                  | element.box.z = max(section z) + 1                                                               |
| B-ED-INS-004 | Send to back               | inspector `button` | button | `applyZOrderAction("back")`                   | element.box.z = min(section z) - 1                                                               |
| B-ED-INS-005 | Forward                    | inspector `button` | button | `applyZOrderAction("forward")`                | element.box.z += 1 (swap with next-z element)                                                    |
| B-ED-INS-006 | Backward                   | inspector `button` | button | `applyZOrderAction("backward")`               | element.box.z -= 1                                                                               |
| B-ED-INS-007 | Duplicate                  | inspector `button` | button | `duplicateElement`                            | new element with new id appended to section.elements; new id becomes selected                    |
| B-ED-INS-008 | Delete                     | inspector `button` | button | `deleteElement` (no confirm modal; immediate) | element removed; inspector shows next element or empty state                                     |

#### Text element controls

| ID           | Label             | Selector                                    | Kind   | Action                                                        | Expected on success                                    |
| ------------ | ----------------- | ------------------------------------------- | ------ | ------------------------------------------------------------- | ------------------------------------------------------ |
| B-ED-INS-010 | Role              | inspector `select` (role)                   | select | `element.role = value` (display / heading / label / body)     | element re-rendered with role-appropriate typography   |
| B-ED-INS-011 | Font size         | inspector `input[type="number"]` (fontSize) | number | `element.fontSize = value`                                    | canvas updates immediately                             |
| B-ED-INS-012 | Font weight       | inspector `select` (fontWeight)             | select | `element.fontWeight = value`                                  | canvas updates                                         |
| B-ED-INS-013 | Align             | inspector `select` (align)                  | select | `element.align = value` (`left` / `center` / `right`)         | canvas updates                                         |
| B-ED-INS-014 | AI Rewrite (text) | inspector `button`                          | button | `aiRewriteText(elementId)` — opens prompt modal → calls agent | proposed rewrite preview; Accept/Reject buttons appear |

#### Action (button) element controls

| ID           | Label       | Selector                                                | Kind        | Action                                                 | Expected on success                                    |
| ------------ | ----------- | ------------------------------------------------------- | ----------- | ------------------------------------------------------ | ------------------------------------------------------ |
| B-ED-INS-020 | Variant     | inspector `select` (variant)                            | select      | `element.variant = value` (`solid` / `ghost` / `text`) | button restyles                                        |
| B-ED-INS-021 | Label       | inspector `input[type="text"]` (label)                  | text        | `element.label = value`                                | button text updates                                    |
| B-ED-INS-022 | Link Type   | inspector `select` (href.type)                          | select      | `internal` / `external`                                | dependent field swaps between page-select and URL-text |
| B-ED-INS-023 | Destination | inspector `input[type="url"]` OR `select` (page picker) | text/select | `element.href.url` or `.pageId`                        | href stored                                            |

#### Shape element controls

| ID           | Label           | Selector                     | Kind   | Action                    | Expected on success |
| ------------ | --------------- | ---------------------------- | ------ | ------------------------- | ------------------- |
| B-ED-INS-030 | Variant (shape) | inspector `select` (variant) | select | `element.variant = value` | shape morphs        |

#### Media element controls

| ID           | Label           | Selector                           | Kind   | Action                                                                                       | Expected on success                                                                                    |
| ------------ | --------------- | ---------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| B-ED-INS-040 | Fit             | inspector `select` (fit)           | select | `cover` / `contain` / `fill`                                                                 | image renders with that object-fit                                                                     |
| B-ED-INS-041 | Upload          | inspector `button.style-btn`       | button | opens OS file picker → `POST /api/owner/assets` (multipart) → `element.assetId = newAssetId` | 200; preview thumb updates                                                                             |
| B-ED-INS-042 | × (clear asset) | inspector `button.style-btn-clear` | button | clears `assetId` (re-points to `__placeholder__`)                                            | preview reverts to placeholder; element style overrides are unchanged (use B-ED-INS-111 to clear them) |

#### Chart element controls

| ID           | Label               | Selector                                        | Kind     | Action                            | Expected on success       |
| ------------ | ------------------- | ----------------------------------------------- | -------- | --------------------------------- | ------------------------- |
| B-ED-INS-050 | Chart kind          | inspector `select` (kind)                       | select   | `bar` / `line` / `area` / `pie`   | chart re-renders          |
| B-ED-INS-051 | X-axis title        | inspector `input[type="text"]` (xAxisTitle)     | text     | `element.xAxisTitle = value`      | rendered axis updates     |
| B-ED-INS-052 | Y-axis title        | inspector `input[type="text"]` (yAxisTitle)     | text     | `element.yAxisTitle = value`      | same                      |
| B-ED-INS-053 | Show legend         | inspector `input[type="checkbox"]` (showLegend) | checkbox | toggles legend                    | legend appears/disappears |
| B-ED-INS-054 | + cat               | inspector `button` (add category)               | button   | appends to `element.categories[]` | grid row added            |
| B-ED-INS-055 | x (remove category) | inspector per-row `button`                      | button   | splices category                  | row removed               |

#### Container element controls

| ID           | Label                  | Selector           | Kind   | Action                          | Expected on success                                    |
| ------------ | ---------------------- | ------------------ | ------ | ------------------------------- | ------------------------------------------------------ |
| B-ED-INS-060 | AI Rewrite (container) | inspector `button` | button | `aiRewriteContainer(elementId)` | proposed children update; Accept/Reject buttons appear |

#### Style controls (apply to most element types, canvas-client `:4239-4531`)

| ID           | Label                     | Selector                                                                                                          | Kind   | Action                                                                                  | Expected on success                                                       |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| B-ED-INS-100 | Background color          | inspector `input[type="color"]` + adjacent checkbox                                                               | color  | `element.elementStyle.backgroundColor = value` (or unset)                               | canvas updates                                                            |
| B-ED-INS-101 | Background image (Upload) | inspector `button` near "Bg image"                                                                                | button | opens picker → `POST /api/owner/assets` → `element.elementStyle.backgroundImageAssetId` | 200; canvas updates with image                                            |
| B-ED-INS-102 | × (clear bg image)        | inspector `button`                                                                                                | button | clears `backgroundImageAssetId`                                                         | canvas updates without image                                              |
| B-ED-INS-103 | Bg size                   | inspector `select` (backgroundSize)                                                                               | select | `cover` / `contain` / `auto`                                                            | canvas updates                                                            |
| B-ED-INS-104 | Corner radius             | inspector `input[type="number"]` (borderRadius)                                                                   | number | `element.elementStyle.borderRadius = value`                                             | canvas updates                                                            |
| B-ED-INS-105 | Border color              | inspector `input[type="color"]` (border)                                                                          | color  | `element.elementStyle.borderColor = value`                                              | canvas updates                                                            |
| B-ED-INS-106 | Border width              | inspector `input[type="number"]` (border)                                                                         | number | `element.elementStyle.borderWidth = value`                                              | canvas updates                                                            |
| B-ED-INS-107 | Opacity                   | inspector `input[type="range"]`                                                                                   | range  | `element.elementStyle.opacity = value` (0–100 → 0–1)                                    | canvas updates                                                            |
| B-ED-INS-108 | Shadow                    | inspector `input[type="text"]` (boxShadow CSS)                                                                    | text   | `element.elementStyle.boxShadow = value`                                                | canvas updates                                                            |
| B-ED-INS-109 | Text color                | inspector `input[type="color"]` (text color)                                                                      | color  | `element.elementStyle.color = value`                                                    | canvas updates                                                            |
| B-ED-INS-110 | Overflow                  | inspector `select` (overflow)                                                                                     | select | `visible` / `hidden` / `auto` / `scroll`                                                | canvas updates                                                            |
| B-ED-INS-111 | Reset all                 | inspector style section `button.style-btn-clear[title="Remove every per-element style override on this element"]` | button | deletes `element.elementStyle`                                                          | all per-element style overrides clear; canvas updates; next save persists |

#### Motion controls

| ID           | Label                     | Selector                                          | Kind   | Action                                                                                                                                                                                                                                             | Expected on success                          |
| ------------ | ------------------------- | ------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| B-ED-INS-120 | Motion preset             | inspector `select` (motion.preset)                | select | one of `none` / `fade-up` / `fade-down` / `fade-in` / `fade-right` / `slide-left` / `slide-up` / `slide-right` / `scale-in` / `zoom-out` / `blur-in` / `rotate-in` / `flip-in` / `bounce-in` / `stagger-children` / `slow-drift` / `parallax-soft` | element re-renders with new motion data-attr |
| B-ED-INS-121 | Motion delay (ms)         | inspector `input[type="number"]` (motion.delayMs) | number | `element.motion.delayMs = value`                                                                                                                                                                                                                   | accepted                                     |
| B-ED-INS-122 | Play (preview motion)     | inspector `.rev01-replay-btn`                     | button | triggers motion replay on canvas                                                                                                                                                                                                                   | element animates once                        |
| B-ED-INS-123 | Replay animation (footer) | inspector `.rev01-replay-btn`                     | button | re-plays element's motion                                                                                                                                                                                                                          | animation re-runs                            |

### 17.7 AI Chat slide-out panel (`canvas-index.tsx:393-403`)

| ID            | Label         | Selector                                  | Kind   | Action                           | Expected on success                                                    | Pre        |
| ------------- | ------------- | ----------------------------------------- | ------ | -------------------------------- | ---------------------------------------------------------------------- | ---------- |
| B-ED-CHAT-001 | × (close)     | `#canvas-chat-close`                      | button | hides `#canvas-chat-panel`       | panel slides closed                                                    | panel open |
| B-ED-CHAT-002 | Message input | `#canvas-chat-input`                      | text   | accepts message                  | accepts                                                                | —          |
| B-ED-CHAT-003 | Send          | `#canvas-chat-form button[type="submit"]` | submit | `POST /api/sites/:id/chat` (SSE) | streaming assistant reply rendered; same agent guardrails as B-CHT-002 | —          |

### 17.8 Canvas viewport controls (the "↖ ✋ Fit 100% - +" widget in footer)

| ID           | Label           | Selector                                     | Kind   | Action                               | Expected on success           | Pre |
| ------------ | --------------- | -------------------------------------------- | ------ | ------------------------------------ | ----------------------------- | --- |
| B-ED-VPT-001 | Cursor mode (↖) | viewport `button[data-tool="select"]`        | button | sets canvas cursor to default select | crosshair becomes arrow       | —   |
| B-ED-VPT-002 | Pan mode (✋)   | viewport `button[data-tool="pan"]`           | button | sets cursor to grab                  | viewport panning enabled      | —   |
| B-ED-VPT-003 | Fit             | viewport `button[data-zoom-action="fit"]`    | button | zoom-to-fit canvas                   | canvas scales to fit viewport | —   |
| B-ED-VPT-004 | 100%            | viewport `button[data-zoom-action="actual"]` | button | reset zoom to 1.0                    | scale=1                       | —   |
| B-ED-VPT-005 | − (zoom out)    | viewport `button[data-zoom-action="out"]`    | button | zoom step down                       | scale decreases               | —   |
| B-ED-VPT-006 | + (zoom in)     | viewport `button[data-zoom-action="in"]`     | button | zoom step up                         | scale increases               | —   |

### 17.9 Page settings (the page properties strip in the editor: PAGE BACKGROUND / SECTION GAP / CONTENT MAX-WIDTH / SEO & METADATA)

| ID            | Label                 | Selector                                           | Kind         | Action                                            | Expected on success           | Pre |
| ------------- | --------------------- | -------------------------------------------------- | ------------ | ------------------------------------------------- | ----------------------------- | --- |
| B-ED-PSET-001 | Entrance animation    | page-settings `select`                             | select       | `page.entranceAnimation = value`                  | saved                         | —   |
| B-ED-PSET-002 | Replay all animations | page-settings `button`                             | button       | re-plays section animations                       | sections animate sequentially | —   |
| B-ED-PSET-003 | Page background       | page-settings `input[type="color"]` / asset picker | color/button | `page.backgroundColor` / `page.backgroundAssetId` | saved; canvas updates         | —   |
| B-ED-PSET-004 | Section gap           | page-settings `input[type="number"]`               | number       | `page.sectionGap = value`                         | saved                         | —   |
| B-ED-PSET-005 | Content max-width     | page-settings `input[type="number"]`               | number       | `page.contentMaxWidth = value`                    | saved                         | —   |
| B-ED-PSET-006 | Open SEO panel →      | `a` to `/dashboard/sites/:id/pages/:pageId/seo`    | link         | navigates                                         | SEO page renders              | —   |

### 17.10 Symbols panel (injected, canvas-client `:8918+`)

| ID           | Label                                           | Selector                                            | Kind   | Action                                            | Expected on success                                 | Pre                              |
| ------------ | ----------------------------------------------- | --------------------------------------------------- | ------ | ------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| B-ED-SYM-001 | Sym (convert section)                           | `button.rev01-section-sym-btn` (per section header) | button | converts section to Symbol master + adds instance | 200; section becomes a referenceable Symbol         | Symbols feature available        |
| B-ED-SYM-002 | (symbol thumbnail in panel)                     | `.rev01-symbol-card`                                | click  | inserts new instance into current section         | new symbol-instance element appended                | symbol exists                    |
| B-ED-SYM-003 | Detach instance (when symbol instance selected) | inspector `button`                                  | button | converts symbol-instance back to plain elements   | symbol-instance becomes its underlying section copy | symbol-instance element selected |

---

## 18. Modals (cross-cutting)

There are two modal managers in this codebase, but both use the shared `rev01-modal-*` class prefix.

| ID          | System                                                                            | Class prefix                             | Used by                                                                                                                                                               | Source                                           |
| ----------- | --------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| B-MOD-EDX   | Editor modal manager (`__rev01Modal.alert/confirm/openTextModal/openSelectModal`) | `.rev01-modal-backdrop` + `.rev01-modal` | Editor publish error, save-as-template name+description, AI Rewrite proposal, page rename/delete, restore confirmation in editor Versions panel, asset/favicon picker | `src/editor/canvas-client.ts:587-871`            |
| B-MOD-SHELL | Dashboard shell modal manager                                                     | `.rev01-modal-backdrop` + `.rev01-modal` | `/dashboard/sites/:id/snapshots` Restore + Preview confirms, presumably other dashboard pages                                                                         | `src/routes/dashboard/shell.tsx:180`, `:378-379` |

Modal action contracts:

| ID        | Modal type                                  | Buttons                  | Inputs                      | Resolves to                        |
| --------- | ------------------------------------------- | ------------------------ | --------------------------- | ---------------------------------- |
| B-MOD-001 | `openTextModal`                             | OK / Cancel              | one `input[type="text"]`    | string or null on cancel           |
| B-MOD-002 | `openSelectModal`                           | OK / Cancel              | one `select`                | option value or null on cancel     |
| B-MOD-003 | `openConfirmModal` / `__rev01Modal.confirm` | OK / Cancel              | none                        | `true` / `false`                   |
| B-MOD-004 | `openAlertModal` / `__rev01Modal.alert`     | OK                       | none                        | resolves on dismiss                |
| B-MOD-005 | Favicon picker                              | choose / upload / cancel | hidden `input[type="file"]` | uploaded asset URL or null         |
| B-MOD-006 | Import site modal                           | Import / Cancel          | URL + name + subdomain      | submits B-DASH-008                 |
| B-MOD-007 | Publish error modal                         | OK                       | none                        | shows list of `unfilledMediaSlots` |
| B-MOD-008 | Restore confirm (dashboard Versions)        | OK / Cancel              | none                        | confirms B-SNP-002                 |

---

## 19. API endpoints behind the buttons (reference)

For agents that want to bypass UI and probe the contract directly. Status codes are what callers should expect when the system is healthy.

| Endpoint                                          | Method                                     | Status                       | Notes                                               |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------- | --------------------------------------------------- |
| `/api/sites`                                      | `GET`                                      | 200                          | list of sites for current owner                     |
| `/api/sites`                                      | `POST`                                     | 201                          | create site (templates page)                        |
| `/api/sites/:id`                                  | `DELETE`                                   | 200                          | delete site                                         |
| `/api/sites/:id/settings`                         | `PUT`                                      | 200                          | persistent settings (search-index, dark-mode, etc.) |
| `/api/sites/:id/password`                         | `POST`                                     | 200                          | enable password protection                          |
| `/api/sites/:id/password/disable`                 | `POST`                                     | 200                          | disable                                             |
| `/api/sites/:id/favicon`                          | `POST`                                     | 200                          | upload favicon                                      |
| `/api/sites/:id/favicon`                          | `DELETE`                                   | 200                          | clear favicon                                       |
| `/api/sites/:id/collaborators`                    | `GET/POST/DELETE`                          | 200/201/200                  | manage collaborators                                |
| `/api/sites/:id/collaborators/:collabId`          | `DELETE`                                   | 200                          | remove collaborator                                 |
| `/api/sites/:id/domains`                          | `POST`                                     | 201                          | add custom domain                                   |
| `/api/sites/:id/domains/:domainId`                | `DELETE`                                   | 200                          | delete domain                                       |
| `/api/sites/:id/snapshots`                        | `POST`                                     | 201                          | save snapshot                                       |
| `/api/sites/:id/snapshots/:snapshotId/preview`    | `GET`                                      | 200 (HTML)                   | snapshot preview                                    |
| `/api/sites/:id/snapshots/:snapshotId/restore`    | `POST`                                     | 200                          | restore snapshot                                    |
| `/api/sites/:id/forms/:formId/submissions.csv`    | `GET`                                      | 200 (text/csv)               | export submissions                                  |
| `/api/sites/:id/forms/:formElementId/submissions` | `POST` (public)                            | 201                          | submit a form (called from published site)          |
| `/api/sites/:id/chat`                             | `POST` (SSE)                               | 200                          | AI chat stream                                      |
| `/api/canvas/sites/:id`                           | `GET`                                      | 200                          | full editable state                                 |
| `/api/canvas/sites/:id`                           | `PUT` body `{editableState}`               | 200 `{ok:true}`              | save canvas                                         |
| `/api/canvas/sites/:id/style-kit`                 | `POST` body `{styleKitId}`                 | 200                          | swap kit                                            |
| `/api/canvas/sites/:id/nav`                       | `PUT`                                      | 200                          | save site nav config                                |
| `/api/publish/sites/:id`                          | `POST`                                     | 200 / 400 unfilledMediaSlots | publish                                             |
| `/api/publish/sites/:id/unpublish`                | `POST`                                     | 200                          | unpublish                                           |
| `/api/owner/assets`                               | `POST` (multipart)                         | 200 `{id, url, ...}`         | upload an asset                                     |
| `/api/custom-templates`                           | `GET`                                      | 200 `{templates:[…]}`        | list owner's saved templates                        |
| `/api/custom-templates`                           | `POST` body `{name, tagline, sourceState}` | 200 `{ok:true,id}`           | save canvas as template                             |
| `/api/custom-templates/:id`                       | `DELETE`                                   | 200 `{ok:true}`              | delete template                                     |
| `/api/addons/:addonId/acquire`                    | `POST`                                     | 200                          | buy/acquire addon                                   |
| `/api/addons/sites/:siteId/:addonId`              | `PUT`                                      | 200                          | per-site addon config                               |
| `/api/import`                                     | `POST` body `{url, name, subdomain}`       | 201                          | import existing public site                         |
| `/api/profile`                                    | `POST`                                     | 200                          | save profile                                        |
| `/api/profile/notifications`                      | `PATCH`                                    | 200                          | (expected, currently unwired — B3/N2)               |

---

## 20. Suggested agent splits

For parallel dispatch:

- **A1 — Public auth + landing**: B-AUTH-001..002, B-LAND-001..019, B-PUB-001..010.
- **A2 — Dashboard list pages**: B-DASH-_, B-TPL-_, B-SHOP-_, B-SET-_ (currently blocked on B1/N1, so this agent's first job is to verify the dashboard 500 is fixed before continuing).
- **A3 — Site-management sweep (per site `:id`)**: B-SHELL-101..110, B-SST-_, B-NAV-_, B-FRM-_, B-SNP-_, B-DOM-_, B-SADD-_, B-A11Y-_, B-CHT-_.
- **A4 — Editor topbar + tabs + Add panel**: B-ED-T-_, B-ED-TAB-_, B-ED-ADD-_, B-ED-PG-_.
- **A5 — Inspector**: B-ED-INS-\* (will need to programmatically click a target canvas element first; specify which element type to test, since each type exposes a different subset).
- **A6 — Editor chat + viewport + page-settings + symbols**: B-ED-CHAT-_, B-ED-VPT-_, B-ED-PSET-_, B-ED-SYM-_.
- **A7 — Modals**: B-MOD-\* (cross-cutting; verify both class-prefix systems work end-to-end).
- **A8 — Profile**: B-PROF-\*.

Sequence: A1 first (cheap), then A2 (blocker), then A3..A6 in parallel, then A7 sanity, then A8.

---

## 21. Maintenance

When a new control ships:

1. Append a new row to the relevant surface table.
2. Keep IDs append-only — never re-number.
3. If the control replaces an existing one, mark the old row `~~struck through~~` rather than deleting it so old agent logs still resolve.
4. If a control is intentionally removed, change its **Action** column to `[REMOVED <date>]` so referring agents fail loudly instead of silently passing.
