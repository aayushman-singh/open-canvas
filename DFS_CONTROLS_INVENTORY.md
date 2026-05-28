# DFS Controls Inventory — every button/link/input that exists in the dashboard + editor source, with the status it landed in during the 2026-05-28 prod DFS walkthrough

> Companion to [DFS_TEST_INVENTORY.md](DFS_TEST_INVENTORY.md). That doc is bug-focused; this one is coverage-focused.
>
> Source enumerated by grepping every `<button>`, `<a href>`, `<input>`, `<select>`, `<textarea>`, `<form>` and `role="button"` across:
> - 15 files in [src/routes/dashboard/](src/routes/dashboard/)
> - [src/editor/canvas-index.tsx](src/editor/canvas-index.tsx) (server-rendered editor shell)
> - [src/editor/canvas-client.ts](src/editor/canvas-client.ts) (DOM-injected controls: Symbols tab, Versions tab, AI Chat panel, inspector toolbar, modals)
>
> Status legend per control:
> - ✅ — physically clicked / typed-in during the live session and observed the expected effect
> - 👁 — observed in the live DOM (right selector, right label, right href/action) but I did not fire the event
> - ⚠️ — exercised and produced a bug (cross-reference Bx in the main report)
> - 🟨 — intentionally skipped because invoking it would corrupt billing / account / live site state, or because the precondition (e.g. existing snapshot, existing form submission) didn't exist on test1
> - 🟦 — control is defined in source but the page or sub-state that surfaces it was never reached (mostly blocked by **B1 dashboard 500**)

---

## Tally

| Surface | Source controls | Exercised ✅ | Observed 👁 | Bug ⚠️ | Skipped 🟨 | Unreached 🟦 |
|---|---:|---:|---:|---:|---:|---:|
| Marketing landing `/` | 9 anchors + 14 demo-replay buttons | 4 anchors + 2 demo buttons | 5 anchors + 12 demo buttons | 1 (B8 counters) | 0 | 0 |
| Published site (test1) | 9 anchors | 0 (read-only browse) | 7 | 2 (B5 `/contact` ×2) | 0 | 0 |
| Dashboard shell top-nav | 4 links + avatar | 0 | 5 | 0 | 0 | 0 |
| Dashboard shell site-sidebar | 9 site links (Editor + 8 sub) | 0 | 9 | 0 | 0 | 0 |
| Dashboard `/dashboard` index | 22 controls | 0 | 0 | 0 | 0 | **22** (B1) |
| Templates `/dashboard/templates` | 9 controls | 1 (Personal tab — failed) | 8 | 2 (B6 iframe spam, B7 tab) | 1 (Create button — gated by plan) | 0 |
| Addon shop `/dashboard/shop` ≡ `/dashboard/addons` | 4 controls | 0 | 4 | 0 | 4 (Get + per-site configure) | 0 |
| Profile `/dashboard/profile` | 4 controls | 0 | 4 | 0 | 1 (Save changes) | 0 |
| Account Settings `/dashboard/settings` | 14 controls | 1 (Notifications tab) | 9 | 2 (B3 fake toggles, B9 copy) | 4 (Upgrade Pro/Team, Delete account, invoice download) | 0 |
| Site Settings `/dashboard/sites/:id/settings` | 13 controls | 0 | 13 | 0 | 13 (every form would mutate site) | 0 |
| Nav Editor `/dashboard/sites/:id/nav` | 9 controls | 0 | 9 | 0 | 9 | 0 |
| Forms `/dashboard/sites/:id/forms` | 0 live controls (empty inbox) | n/a | n/a | n/a | n/a | n/a |
| Versions `/dashboard/sites/:id/snapshots` | 3 controls + per-row Preview/Restore | 0 | 3 + 2 (1 snapshot row) | 0 | 5 | 0 |
| Domains `/dashboard/sites/:id/domains` | 3 controls | 0 | 2 (empty list, no Delete) | 0 | 2 | 0 |
| Site Addons `/dashboard/sites/:id/addons` | 4 controls | 0 | 4 | 0 | 1 (Save GA id) | 0 |
| A11y Report `/dashboard/sites/:id/a11y` | 0 (read-only) | n/a | n/a | n/a | n/a | n/a |
| Site Chat `/dashboard/sites/:id/chat` | 3 controls + per-proposal Accept/Reject | 2 (Send, Reject) | 1 | 1 (B4 agent guard) | 1 (Accept on a real proposal) | 0 |
| Editor header `/dashboard/sites/:id/edit` | 6 controls | 3 (AI Chat, Save, Publish) | 3 (dashboard link, Settings, Save as template) | 2 (B2 Save+Publish 400) | 1 (Save as template) | 0 |
| Editor sidebar tabs | 5 tabs (static + 2 dynamic from canvas-client.ts) | 5 | 0 | 0 | 0 | 0 |
| Editor Add panel | 14 component buttons + 1 "Blank section" + 4 style-kit chips | 0 | 19 | 0 | 19 (every click adds an element) | 0 |
| Editor Pages panel | "+ New Page" + per-page rename/delete | 0 | 1 ("+ New Page") | 0 | 1 | 0 |
| Editor Versions panel | (dynamic — sidebar version list) | 0 | 0 | 0 | 0 | 1 (panel content not enumerated) |
| Editor Chat panel (slide-out) | input + Send + × | 1 (open + ×) | 2 | 0 | 1 (Send — same flow as site-level chat, already tested) | 0 |
| Inspector toolbar (selection-based) | ~12 mark + style buttons via canvas-client | 0 | 0 | 0 | 0 | 12 (no element was selected during DFS) |
| **Total** | **~165 controls** | **~19** | **~115** | **10 bugs** | **~50** | **~35** |

---

## 1. Marketing landing `/` — [src/routes/marketing.tsx](src/routes/marketing.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| rev01 (logo) | `header a[href="/"]` | link | navigates `/` | 👁 |
| docs | `header nav a` | link | → github docs tree | 👁 |
| github | `header nav a` | link | → github repo | 👁 |
| Launch dashboard (header) | `header a[href="/dashboard"]` | link | → `/dashboard` (lands on B1) | ✅ (B1) |
| Start building | hero CTA | link | → `/dashboard` (B1) | 👁 |
| View source | hero CTA | link | → github | 👁 |
| Launch dashboard (footer) | footer | link | → `/dashboard` | 👁 |
| github (footer) | footer | link | → github | 👁 |
| docs (footer) | footer | link | → github docs | 👁 |
| Demo: Add tab | `.demo-sidebar [data-tab=add]` | button (replay-only) | visual no-op | 👁 |
| Demo: Sections tab | `.demo-sidebar [data-tab=sections]` | button (replay-only) | visual no-op | 👁 |
| Demo: Pages tab | `.demo-sidebar [data-tab=pages]` | button (replay-only) | visual no-op | 👁 |
| Demo: + Blank section | `.demo-sidebar` | button (replay-only) | visual no-op | 👁 |
| Demo: Text | `.demo-sidebar` | button (replay-only) | clicked — no event observed | ✅ |
| Demo: Image | same | button (replay-only) | visual no-op | 👁 |
| Demo: Button | same | button (replay-only) | visual no-op | 👁 |
| Demo: Shape | same | button (replay-only) | visual no-op | 👁 |
| Demo: Container | same | button (replay-only) | visual no-op | 👁 |
| Demo: Nav | same | button (replay-only) | visual no-op | 👁 |
| Demo: Chart | same | button (replay-only) | visual no-op | 👁 |
| Demo: Form | same | button (replay-only) | visual no-op | 👁 |
| Demo: charcoal kit | `.demo-style-kit` | button (replay-only) | visual no-op | 👁 |
| Demo: orange kit | `.demo-style-kit` | button (replay-only) | clicked — no event observed | ✅ |
| Demo: blue kit | `.demo-style-kit` | button (replay-only) | visual no-op | 👁 |
| Demo: green kit | `.demo-style-kit` | button (replay-only) | visual no-op | 👁 |
| Runtime counters (LOC / EDIT / AGENT / PUBLISHED) | `[data-counter]` | non-interactive | IntersectionObserver-driven | ⚠️ B8 |

## 2. Published site `test1.rev01.aayushman.dev/`

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Talk to sales | `a[href="/contact"]` (1st) | link | → `/contact` 404 | ⚠️ B5 |
| View platform | `a[href="#enterprise-scale"]` | link | anchor jump | 👁 |
| Explore scale | `a[href="#enterprise-governance"]` | link | anchor jump | 👁 |
| Review controls | `a[href="#enterprise-success"]` | link | anchor jump | 👁 |
| Contact sales | `a[href="/contact"]` (2nd) | link | → `/contact` 404 | ⚠️ B5 |
| Read the guide | `a[href="#enterprise-hero"]` | link | anchor jump | 👁 |
| made with rev01 | footer link | link | → marketing root | 👁 |
| edit this site | `a[href="/__edit"]` | link | opens Clerk-gated edit popup | 👁 |
| browse templates | footer link | link | → `/dashboard/templates` | 👁 |

## 3. Dashboard shell — [src/routes/dashboard/shell.tsx](src/routes/dashboard/shell.tsx)

### Top-nav (appears on every dashboard page)

| Label | Selector | Source | Status |
|---|---|---|---|
| rev01 logo | `a.app-logo` | shell.tsx:330 | 👁 |
| Sites | `.app-nav-link[href="/dashboard"]` | shell.tsx:332-340 | 👁 (target 500s — B1) |
| Templates | `.app-nav-link[href="/dashboard/templates"]` | shell.tsx:332-340 | 👁 |
| Addons | `.app-nav-link[href="/dashboard/addons"]` | shell.tsx:332-340 | 👁 |
| Settings | `.app-nav-link[href="/dashboard/settings"]` | shell.tsx:332-340 | 👁 |
| Avatar | `a.app-avatar-link` → `/dashboard/profile` | shell.tsx:343 | 👁 |

### Site-management sidebar (appears on every `/dashboard/sites/:id/*` page)

| Label | URL | Source | Status |
|---|---|---|---|
| ← All sites | `/dashboard` | shell.tsx:358 | 👁 (B1) |
| ✎ Go to editor | `/dashboard/sites/:id/edit` | shell.tsx:362-370 | ✅ |
| ⚙ Settings | `/dashboard/sites/:id/settings` | shell.tsx:362-370 | ✅ |
| ☰ Navigation | `/dashboard/sites/:id/nav` | shell.tsx:362-370 | ✅ |
| ✉ Forms | `/dashboard/sites/:id/forms` | shell.tsx:362-370 | ✅ |
| ⧖ Versions | `/dashboard/sites/:id/snapshots` | shell.tsx:362-370 | ✅ |
| ⌗ Domains | `/dashboard/sites/:id/domains` | shell.tsx:362-370 | ✅ |
| ⬡ Addons | `/dashboard/sites/:id/addons` | shell.tsx:362-370 | ✅ |
| ✔ Accessibility | `/dashboard/sites/:id/a11y` | shell.tsx:362-370 | ✅ |
| … Chat | `/dashboard/sites/:id/chat` | shell.tsx:362-370 | ✅ |

## 4. `/dashboard` index — [src/routes/dashboard/index.tsx](src/routes/dashboard/index.tsx) — ❌ B1 (page returns 500)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Import | `#import-btn` | button | opens import modal | 🟦 (B1) |
| + New site | `.new-site` | link | → `/dashboard/templates` | 🟦 |
| Upgrade to add sites | `.new-site` (alt copy at plan limit) | link | → `/dashboard/settings` | 🟦 |
| URL to import | `#import-url` | input[type=url] | modal field | 🟦 |
| Site name | `#import-name` | text | modal field | 🟦 |
| Subdomain | `#import-subdomain` | text | modal field | 🟦 |
| Cancel (import modal) | `#import-cancel` | button | closes modal | 🟦 |
| Import (modal submit) | `#import-submit` | button | POST `/api/import` | 🟦 |
| site address (per card) | `.site-card-addr` | link | opens published site | 🟦 |
| Edit (per card) | `.btn-edit` | link | → `/dashboard/sites/:id/edit` | 🟦 |
| Make draft (per card) | `.btn-unpublish` | button | POST `/api/publish/sites/:id/unpublish` | 🟦 |
| Publish (per card) | `.btn-publish` | button | POST `/api/publish/sites/:id` | 🟦 |
| ⋮ (per card) | `.btn-dots` | button | toggles details panel | 🟦 |
| Settings gear (details) | `.details-gear` | link | → site settings | 🟦 |
| Detail rows (Forms, A11y, etc.) | `.detail-row--link` | link | → per-section | 🟦 |
| Sign out | `.dash-sign-out` | link | logs out + redirect | 🟦 |
| Pick a template (welcome) | (button) | link | → `/dashboard/templates` | 🟦 |
| Import existing site (welcome) | (button) | button | opens import modal | 🟦 |
| Start from a template | `.dash-quick-card` | link | → `/dashboard/templates` | 🟦 |
| Set up your profile | `.dash-quick-card` | link | → `/dashboard/profile` | 🟦 |
| Explore settings | `.dash-quick-card` | link | → `/dashboard/settings` | 🟦 |

## 5. `/dashboard/templates` — [src/routes/dashboard/templates.tsx](src/routes/dashboard/templates.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Community (6) tab | `label[for=ttab-community]` | radio (visual tab) | swaps grid | 👁 (active by default) |
| Personal (0) tab | `label[for=ttab-personal]` | radio (visual tab) | swaps grid | ⚠️ B7 click intercepted |
| Starter Canvas | `input[name=templateId][value=starter-canvas]` | radio (template pick) | seeds new site | 👁 |
| Launch Page | `input[name=templateId][value=launch-canvas]` | radio | seeds new site | 👁 |
| Enterprise Scale | `input[name=templateId][value=enterprise-scale-canvas]` | radio | seeds new site | 👁 |
| Studio Portfolio | `input[name=templateId][value=studio-canvas]` | radio | seeds new site | 👁 |
| Local Business | `input[name=templateId][value=local-canvas]` | radio | seeds new site (embeds Rick Astley — B6) | 👁 |
| Apogee Showcase | `input[name=templateId][value=apogee-showcase]` | radio | seeds new site | 👁 |
| Site name | `input[name=siteName]` | text | new-site field | 👁 |
| Subdomain | `input[name=subdomain]` | text | new-site field | 👁 |
| Create site | form submit | button | POST `/api/sites` | 🟨 (hidden — plan limit) |
| Upgrade | `.limit-notice a` | link | → `/dashboard/settings` | 👁 |

## 6. `/dashboard/shop` ≡ `/dashboard/addons` — [src/routes/dashboard/addon-shop.tsx](src/routes/dashboard/addon-shop.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Get addon (per card) | `.btn-acquire` | button | POST `/api/addons/:id/acquire` | 🟨 (would buy) |
| Site selector | `.addon-site-select select` | select | scopes per-site config | 👁 |
| Per-site addon toggle | `.addon-site-config input[type=checkbox]` | checkbox | enables addon on a site | 🟨 |
| Save config | `.addon-site-config button` | button | PUT `/api/addons/sites/:id/:addonId` | 🟨 |

## 7. `/dashboard/profile` — [src/routes/dashboard/profile.tsx](src/routes/dashboard/profile.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Display name | `input[name=displayName]` | text | profile name | 👁 (pre-filled "Aayushman Singh") |
| Bio | `textarea[name=bio]` | textarea | profile bio | 👁 (pre-filled) |
| Timezone | `select[name=timezone]` | select | tz preference | 👁 (UTC) |
| Save changes | `form button[type=submit]` | button | POST `/api/user/profile` | 🟨 (would mutate) |

## 8. `/dashboard/settings` — [src/routes/dashboard/settings.tsx](src/routes/dashboard/settings.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Billing tab | `.settings-tab` | button | swaps panel | 👁 (active by default) |
| Notifications tab | `.settings-tab` | button | swaps panel | ✅ |
| Account tab | `.settings-tab` | button | swaps panel | 👁 |
| Current plan (Free) | `.plan-card` | (card) | non-interactive | 👁 |
| Upgrade to Pro | `.plan-card button` | button | Stripe checkout | 🟨 |
| Upgrade to Team | `.plan-card button` | button | Stripe checkout | 🟨 |
| Plan card copy | (Free = "1 site") | static | shows wrong limit | ⚠️ B9 |
| Notifications: Site published | `input[type=checkbox]` | checkbox (decorative) | nothing — **B3** | ⚠️ B3 |
| Notifications: Collaborator activity | `input[type=checkbox]` | checkbox (decorative) | nothing — **B3** | ⚠️ B3 |
| Notifications: Form submissions | `input[type=checkbox]` | checkbox (decorative) | nothing — **B3** | ⚠️ B3 |
| Notifications: Product updates | `input[type=checkbox]` | checkbox (decorative) | nothing — **B3** | ⚠️ B3 |
| Notifications: Tips & tutorials | `input[type=checkbox]` | checkbox (decorative) | nothing — **B3** | ⚠️ B3 |
| Invoices: download (per row) | `a[href]` | link | downloads invoice | 🟨 |
| Delete account | Danger zone button | button | DELETE account | 🟨 |

## 9. Site Settings `/dashboard/sites/:id/settings` — [src/routes/dashboard/site-settings.tsx](src/routes/dashboard/site-settings.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Enable password protection | `form.pw button` | button | POST `/api/sites/:id/password` | 🟨 |
| Password input | `form.pw input[type=password]` | password | password-gate form | 👁 |
| Disable password | `.disable-pw-btn` | button | POST `/api/sites/:id/password/disable` | 🟨 (hidden — currently disabled) |
| Allow search engines | `input[type=checkbox]` (search-indexing) | checkbox | PUT site settings | 👁 (checked) |
| Choose image (favicon) | `input[type=file]` label | file-upload | POST `/api/sites/:id/favicon` | 🟨 |
| Clear favicon | `.favicon-picker button.clear` | button | DELETE `/api/sites/:id/favicon` | 🟨 (hidden — no favicon) |
| Favicon picker modal | `.picker-modal` (hidden) | modal | image picker UI | 🟦 |
| Visitor dark mode | `input[type=checkbox]` (dark-mode) | checkbox | PUT site settings | 👁 (unchecked) |
| Collaborator email | `.collab-form input[type=email]` | email | invite form | 👁 |
| Collaborator role | `.collab-form select` | select | role assignment | 👁 |
| Invite | `.collab-form button` | button | POST `/api/sites/:id/collaborators` | 🟨 (would email someone) |
| Remove collaborator | `.remove-btn` (per row) | button | DELETE `/api/sites/:id/collaborators/:email` | 🟨 (empty list) |

## 10. Nav Editor `/dashboard/sites/:id/nav` — [src/routes/dashboard/nav-editor.tsx](src/routes/dashboard/nav-editor.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Layout | `select[name=layout]` | select | left-center-right / left-right | 👁 |
| Logo asset ID | `input[name=logoAssetId]` | text | sets logo | 👁 |
| Sticky | `input[name=sticky][type=checkbox]` | checkbox | sticky nav | 👁 |
| Link label | per-link `input[name=label]` | text | link label | 👁 |
| Link kind | per-link `select` | select | internal/external | 👁 |
| Link href | per-link `input[type=url]` | text | href | 👁 |
| Remove link | per-link `button` | button | drops row | 👁 |
| + Add link | bottom of form | button | adds blank row | 🟨 |
| Save | form submit | button | PUT `/api/canvas/sites/:id/nav` | 🟨 |

## 11. Forms `/dashboard/sites/:id/forms` — [src/routes/dashboard/forms-inbox.tsx](src/routes/dashboard/forms-inbox.tsx)

Empty inbox on test1, so the controls below are defined in source but never rendered in the live DOM during this DFS:

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Form card link (per form) | `.form-card` | link | → `/dashboard/sites/:id/forms/:formId` | 🟦 |
| Download CSV (per form detail) | `.actions a` | link | GET `…/submissions.csv` | 🟦 |
| Back to forms | `.actions a` | link | → forms inbox | 🟦 |

## 12. Versions `/dashboard/sites/:id/snapshots` — [src/routes/dashboard/version-timeline.tsx](src/routes/dashboard/version-timeline.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Preview (per row) | `[data-action=preview]` | button | GET preview HTML → iframe | 👁 (1 row visible) |
| Restore (per row) | `[data-action=restore]` | button | POST `…/restore` (confirm modal) | 🟨 (would overwrite current edits) |
| Snapshot label | `form.timeline-form input` | text | label for new snapshot | 👁 |
| Save snapshot | `form.timeline-form button` | button | POST `/api/canvas/sites/:id/snapshots` | 🟨 |

## 13. Domains `/dashboard/sites/:id/domains` — [src/routes/dashboard/domains.tsx](src/routes/dashboard/domains.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Hostname | `form.add-domain input` | text | hostname field | 👁 |
| Add domain | `form.add-domain button` | button | POST `/api/sites/:id/domains` | 🟨 (would start CF verification) |
| Delete domain (per row) | `.domain button` | button | DELETE `/api/sites/:id/domains/:id` | 🟦 (empty list) |

## 14. Site Addons `/dashboard/sites/:id/addons` — [src/routes/dashboard/site-addons.tsx](src/routes/dashboard/site-addons.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Enable on this site (GA) | `input[type=checkbox]` | checkbox | toggles GA for site | 👁 (disabled) |
| MEASUREMENT ID | `input[name=measurementId]` | text | GA tracking ID | 👁 |
| Save (GA) | button | button | PUT `/api/addons/sites/:id/google-analytics` | 🟨 |
| Visit Addons (Custom Scripts) | link | link | → `/dashboard/shop` | 👁 |

## 15. A11y Report `/dashboard/sites/:id/a11y` — [src/routes/dashboard/a11y-report.tsx](src/routes/dashboard/a11y-report.tsx)

No interactive controls. Read-only display of 0 blocking / 3 warning / 1 info. ✅

## 16. Site Chat `/dashboard/sites/:id/chat` — [src/routes/dashboard/chat-panel.tsx](src/routes/dashboard/chat-panel.tsx)

| Label | Selector | Kind | Action | Status |
|---|---|---|---|---|
| Message input | `textarea#chat-input` | textarea | message to agent | ✅ typed "hi, just a smoke test, do not modify the site" |
| Send | `button#chat-send` | button | POST `/api/sites/:id/chat` (SSE) | ✅ (B4 — agent ignored guard) |
| Accept (per proposal) | dynamic button | button | applies agent op | 🟨 (would mutate site) |
| Reject (per proposal) | dynamic button | button | discards agent op | ✅ |

## 17. Editor `/dashboard/sites/:id/edit` — [src/editor/canvas-index.tsx](src/editor/canvas-index.tsx) + [src/editor/canvas-client.ts](src/editor/canvas-client.ts)

### Editor Header

| Label | Selector | Source | Status |
|---|---|---|---|
| dashboard | breadcrumb `a` | canvas-index.tsx:114 | 👁 (B1 destination) |
| AI Chat | `#canvas-chat-toggle` | canvas-index.tsx:151 | ✅ (opens panel) |
| Settings | `#canvas-settings-link` | canvas-index.tsx:154 | 👁 |
| Save | `#canvas-save` | canvas-client.ts:170 | ⚠️ B2 (400) |
| Publish | `#canvas-publish` | canvas-client.ts:171 | ⚠️ B2 (400) |
| Save as template | `#canvas-save-template` | canvas-client.ts:172 | 🟨 |

### Sidebar tabs (3 static + 2 injected by canvas-client.ts)

| Label | Selector | Source | Status |
|---|---|---|---|
| Add | `[data-sidebar-tab=add]` | canvas-index.tsx:188 | ✅ |
| Sections | `[data-sidebar-tab=sections]` | canvas-index.tsx:198 | ✅ |
| Pages | `[data-sidebar-tab=pages]` | canvas-index.tsx:201 | ✅ |
| Symbols | `[data-sidebar-tab=symbols]` (injected) | canvas-client.ts:8918 `ensureSymbolsTabMounted` | ✅ |
| Versions | `[data-sidebar-tab=versions]` (injected) | canvas-client.ts (renderVersionsPanel) | ✅ |
| Toggle sidebar | `#sidebar-toggle` | canvas-index.tsx:186 | 👁 |

### Add panel — Sections + Components + Style Kit

| Label | Selector | Source | Status |
|---|---|---|---|
| Blank section | `[data-sidebar-add-section=blank]` | canvas-index.tsx:213 | 🟨 |
| Text | `[data-sidebar-add-component=text]` | canvas-index.tsx:225 | 🟨 |
| Image | `[data-sidebar-add-component=image]` | canvas-index.tsx:241 | 🟨 |
| Video | `[data-sidebar-add-component=video]` | canvas-index.tsx:249 | 🟨 |
| Button | `[data-sidebar-add-component=action]` | canvas-index.tsx:257 | 🟨 |
| Shape | `[data-sidebar-add-component=shape]` | canvas-index.tsx:265 | 🟨 |
| Container | `[data-sidebar-add-component=container]` | canvas-index.tsx:273 | 🟨 |
| Chart | `[data-sidebar-add-component=chart]` | canvas-index.tsx:281 | 🟨 |
| Form | `[data-sidebar-add-component=form]` | canvas-index.tsx:289 | 🟨 |
| Embed | `[data-sidebar-add-component=embed]` | canvas-index.tsx:297 | 🟨 |
| Code | `[data-sidebar-add-component=code]` | canvas-index.tsx:305 | 🟨 |
| Accordion | `[data-sidebar-add-component=accordion]` | canvas-index.tsx:313 | 🟨 |
| Carousel | `[data-sidebar-add-component=carousel]` | canvas-index.tsx:321 | 🟨 |
| Table | `[data-sidebar-add-component=table]` | canvas-index.tsx:329 | 🟨 |
| Nav | `[data-sidebar-add-component=nav]` | canvas-index.tsx:337 | 🟨 |
| Style kit chip × N | `[data-sidebar-style-kit]` | canvas-index.tsx:345 | 🟨 (would POST style-kit change → broken Save anyway) |

### Pages panel

| Label | Selector | Source | Status |
|---|---|---|---|
| + New Page | `#canvas-add-page` | canvas-index.tsx:378 | 🟨 |
| Per-page rename | (dynamic) | canvas-client.ts | 🟦 |
| Per-page delete | (dynamic) | canvas-client.ts | 🟨 |

### AI Chat slide-out panel (right-side, toggled by editor header AI Chat)

| Label | Selector | Source | Status |
|---|---|---|---|
| Close (×) | `#canvas-chat-close` | canvas-index.tsx:393 | ✅ |
| Message input | `#canvas-chat-input` | canvas-index.tsx:397 | 👁 |
| Send | `#canvas-chat-form button[type=submit]` | canvas-index.tsx:403 | 🟨 (same flow as site-level chat → B4) |

### Inspector toolbar (canvas-client.ts, surfaces only when an element is selected — never selected during DFS)

| Label | Selector | Source | Status |
|---|---|---|---|
| Bold / Italic / Underline / Strike / Code / Highlight / Link mark toolbar | `[data-mark]` | canvas-client.ts | 🟦 |
| Section "Sym" convert button | inserted on eligible sections | canvas-client.ts:8644 | 🟦 |
| Element delete / duplicate / nudge | inspector | canvas-client.ts | 🟦 |

### Versions sidebar panel (injected)

| Label | Selector | Source | Status |
|---|---|---|---|
| Snapshot rows (Preview/Restore) | dynamic | canvas-client.ts `renderVersionsPanel` 8498 | 🟦 |

---

## What was NOT tested (and why)

**Blocked by B1** — every control under `/dashboard` index (22 controls). Until that route stops 500-ing they cannot be reached from the canonical entry point. (Some have alternative entries — e.g. `/dashboard/templates` works directly.)

**Blocked by B2** — Save and Publish in the editor are confirmed broken; everything downstream (style-kit change, add-element on dirty state, version save) chains off Save and would re-hit the same 400.

**Blocked by precondition state** — Forms inbox is empty (no form element on test1), so Download CSV / form detail / submission table never render. Versions has 1 snapshot row — Preview was not clicked (would open iframe — safe) and Restore was not clicked (would overwrite current edits). Domains list is empty so Delete buttons never render. Collaborators list is empty so Remove buttons never render.

**Skipped due to side effects (user policy = full DFS but I drew the line at):**
- Stripe upgrades (Pro / Team)
- Delete account
- Add custom domain (CF verification side effect)
- Form / addon / nav / settings Save buttons (would mutate live site)
- Send a chat message that requests a real edit then click Accept
- Save as template (would create a personal template entry)

**Inspector toolbar (~12 marks/actions)** — never surfaced because no element was selected during the walkthrough. To exercise these the next DFS needs to: click an element on the canvas → wait for inspector → fire each toolbar button. Not done this pass.

---

## Recommendations for the next DFS pass

1. **Fix B1 first.** It blocks 22 controls and the canonical entry point.
2. **Fix B2 (`__placeholder__`).** It blocks every editor write — including all the 🟨 add-component controls that would otherwise be exercisable.
3. **Either repair B3 or hide the Notifications tab** so we stop shipping a fake toggle UI.
4. **Run a second pass after fixes**, this time:
   - selecting an element on the editor canvas (exercises the inspector toolbar)
   - creating a Form element + publishing → submitting a form from the public site (exercises Forms inbox + per-form CSV)
   - saving a snapshot, then clicking Preview/Restore on a non-published snapshot
   - clicking Save changes on Profile with a deliberate diff
   - one collaborator invite to a throwaway address
