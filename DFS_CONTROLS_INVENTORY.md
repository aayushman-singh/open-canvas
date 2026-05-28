# DFS Controls Inventory — Run 2 (2026-05-28 ~10:32 UTC, post-fix)

> Re-ran after `git log` showed the following bug-fix commits had shipped:
> - `ca1eb65` POST /api/sites post-rebase damage cleanup
> - `ac610cc` clear rickroll URLs from apogee-showcase embeds (B6)
> - `c9bd5e9` chat agent no-modify + future-tense rules (B4)
> - `a787276` sitemap "home" → root URL collapse (B10)
> - `8bfc559` landing counters animate when partially in fold (B8)
> - `041176b` enterprise-scale CTAs use mailto: instead of /contact (B5)
> - `fa2f10a` canvas site-assets merge + `__placeholder__` skip (B2)
> - `ab8e1d1` + `8d934ee` billing plan + site-limit wiring (B9)
>
> This pass: clicked every reachable interactive control, observed network responses + DOM mutations, restored any state I changed (search-indexing, dark-mode, profile bio, GA addon, measurement ID).
>
> Status legend:
> - ✅ — clicked and observed correct effect (network 2xx, DOM updated, state persisted on reload)
> - ⚠️ — clicked and got a non-fatal problem (validation, partial persistence, no-op)
> - ❌ — clicked and got a server/client error (500/502/4xx/exception)
> - 🟦 — control still unreachable because the surfacing page itself 500/404s
> - 🟨 — intentionally not clicked (would charge $, delete account, send email to a third party)

---

## Bug status after re-test

| # | Original | Status | Evidence |
|---|---|---|---|
| **B1** | `/dashboard` 500 | ❌ STILL BROKEN + **REGRESSION**: `/dashboard/templates` and `/dashboard/settings` (Billing/Notifications/Account) now also 500 — all three pages that need the sites-list crash | cf-ray `a02c8a7cde9e8823-SIN`; per-site pages still 200, so `requireAuth` is fine; the list query is the regression vector. `ca1eb65` only touched POST `/api/sites`, not the GET path that powers the dashboard list. |
| **B2** | Save+Publish 400 (`__placeholder__`) | ✅ Save returns 200 (verified via direct PUT + `#canvas-save` click); Publish returns a *correct* 400 `{error: "cannot publish: unfilled media slots", elementId: "el-defc1f53-..."}` — that's the legit gate, not the old infra bug | The `fa2f10a` skip-placeholder fix landed for save; publish still demands real assets, which is the right behaviour. |
| **B3** | Notifications toggles cosmetic | 🟦 Unverifiable — `/dashboard/settings` 500s with B1 regression | n/a this pass |
| **B4** | Agent ignored "do not modify" + false past tense | ✅ Re-sent identical prompt. Agent replied: *"Hello! I'm the rev01 site builder Agent. I'm ready to help you build your site. What would you like to do?"* — no unsolicited `query_site`/`updateElement` proposal, no false past-tense. | `c9bd5e9` system-prompt update worked. |
| **B5** | `/contact` CTAs in published Enterprise Scale 404 | ⚠️ Template seed fixed in `041176b`, but the existing **test1** site still ships both `/contact` links (template fixes don't retroactively rewrite existing site state). | Verified `test1.rev01.aayushman.dev/` still has 2× `a[href="/contact"]`, no `mailto:`. A new site spawned from the template would have the fix. |
| **B6** | Rickroll YouTube embed in templates | 🟦 `/dashboard/templates` 500s (B1 regression) — couldn't reload the iframe spam. The `ac610cc` commit cleared the URLs in the seed JSON; assume fixed but can't verify in-browser. | |
| **B7** | Personal tab click intercepted | 🟦 `/dashboard/templates` 500s | |
| **B8** | Landing counters stuck at 0 | ✅ Counters now animate when the section is even partially in the fold (verified by scrolling the section to bottom-of-viewport — counters tick). | `8bfc559` landed. |
| **B9** | Plan card said "1 site" but enforcement at 3 | 🟦 `/dashboard/settings` 500s; can't verify the card. The `ab8e1d1` + `8d934ee` commits suggest entitlements are now single-sourced; presume fixed but unverified. | |
| **B10** | Sitemap had `#v=1` hash | ✅ `/sitemap.xml` now emits `https://test1.rev01.aayushman.dev/` (root, no `home`, no hash). | `a787276` landed. |

## NEW bugs from Run 2 (not in Run 1)

| # | Sev | Page | Element / flow | Evidence |
|---|---|---|---|---|
| **N1** | 🚨 Critical | `/dashboard`, `/dashboard/templates`, `/dashboard/settings` | All three pages return 500 to authenticated requests. Per-site routes work fine. | See B1 above — same root cause: the sites-list query or its rendering. |
| **N2** | 🚨 Critical | Editor canvas — every mutation | 19× `Error: Unexpected content type` from Yjs `_integrate`/`integrate`/`Kr` in the bundled editor JS, fired on every Add-component click, every inspector toolbar click, every style-kit pick. Save still 200s on the *current* canvas state (because Yjs failed to apply the change, so save is a no-op replay), but the **clicks have no visible effect**. | Clicked Add → 14 component buttons; only 3 elements appeared in `editableState.pages[0]` after save (108 → 111). Clicked inspector → 7 buttons (move up/down, front/back, forward/backward, duplicate); 0 elements added, total still 111. Console flooded with the Yjs integration error. |
| **N3** | 🚨 Critical | `/dashboard/sites/:id/nav` | Page returns **404 Not Found**. The route is gone but `shell.tsx` still emits the sidebar link, so every site sub-page has a dead "Navigation" entry. | `fetch('/dashboard/sites/:id/nav') → 404`. |
| **N4** | 🚨 Critical | `/dashboard/sites/:id/snapshots` | Page itself renders, but the API it calls (`/api/canvas/sites/:id/snapshots`) returns **404**. Both **Preview** and **Save snapshot** buttons fail: Preview pane shows "Preview failed: Internal Server Error" (because the proxy turns the 404 into a 500); Save form action also dead-ends. | Direct fetch: `/api/canvas/sites/:id/snapshots?limit=10 → 404 "404 Not Found"`. The page UI bound to it is non-functional. |
| **N5** | ⚠️ High | `/dashboard/sites/:id/domains` | `POST /api/sites/:id/domains` returns **502 Bad Gateway** on add. UI shows no error toast — the row just silently fails to appear. | Submitted `dfs-test-fake-…invalid` (deliberately invalid TLD); got 502 instead of a 4xx validation reject. |
| **N6** | ⚠️ Medium | Site settings checkbox toggles | First click on Search-indexing / Visitor dark-mode persists to the server (verified by reload). Second click in the same tick (to restore) does NOT persist (still flipped on reload). Looks like client-side debounce or pending-save guard drops the second toggle. | Reproduced: search-indexing went from `checked=true` → flipped → reload showed `false`; restored manually. |

## Tally (Run 2)

| Surface | Reached? | Clicked controls | Bug |
|---|---|---:|---|
| Landing `/` | ✅ | 4 anchors visited; counters now animate; demo-replay buttons left alone (replay-only) | none (B8 fixed) |
| Published site `test1...` | ✅ | 1 anchor (`/contact`) clicked → still 404 | ⚠️ B5 (template patched, test1 state stale) |
| `/dashboard` index | ❌ | 0 of 22 — page 500s | 🚨 N1 |
| `/dashboard/templates` | ❌ | 0 — page 500s | 🚨 N1 |
| `/dashboard/shop` ≡ `/dashboard/addons` | ✅ (not retested this pass) | — | — |
| `/dashboard/profile` | ✅ | Save changes round-trip: edited bio → "Saved" → reloaded showed marker → reverted → reloaded showed original | ✅ works |
| `/dashboard/settings` | ❌ | 0 — page 500s | 🚨 N1 |
| Site Settings `/dashboard/sites/:id/settings` | ✅ | search-indexing checkbox flip, dark-mode flip, **Enable** password (revealed pw form), **Choose image** (opened favicon modal) | ⚠️ N6 second-click debounce drop |
| Nav Editor | ❌ | 0 — route returns 404 | 🚨 N3 |
| Forms inbox | ✅ (no rows) | — | — |
| Versions | ⚠️ | Preview clicked → "Preview failed: Internal Server Error"; Save snapshot with label clicked → silent 404 | 🚨 N4 |
| Domains | ⚠️ | Add domain submitted → 502 silent | ⚠️ N5 |
| Site Addons | ✅ | GA Enable checkbox flipped, measurement-id typed `G-DFSTEST1`, Save → "Saved. Publish to apply changes." Reloaded → state persisted. Cleared field + flipped back + Save → restored. | ✅ works |
| A11y Report | ✅ (read-only) | — | — |
| Site Chat | ✅ | Sent "do not modify" prompt → agent replied with a single greeting, **no** unsolicited tool call, **no** false past-tense | ✅ B4 fixed |
| Editor topbar | ⚠️ | dashboard link (works to navigate but B1 destination), AI Chat button (opens slide-out), Save (200), Publish (correct 400 "unfilled media") | ⚠️ Publish gated by stale `__placeholder__` element |
| Editor sidebar tabs | ✅ | Add, Sections, Pages, Symbols, Versions — visibility swap verified | ✅ |
| Editor Add panel — components | ❌ | Clicked all 14 (Text/Image/Video/Button/Shape/Container/Chart/Form/Embed/Code/Accordion/Carousel/Table/Nav) + Blank section. **Only 3 of 15 actually persisted** (108 → 111). 12 Yjs `Unexpected content type` errors. | 🚨 N2 |
| Editor inspector toolbar | ❌ | Selected `enterprise-hero-bg`; clicked Move up, Move down, Bring to front, Send to back, Forward, Backward, Duplicate. **0 of 7 persisted** (still 111 elements). 7 more Yjs errors. | 🚨 N2 |

---

## Per-control click outcomes (Run 2)

### `/dashboard/sites/:id/edit` — Editor

**Topbar**
| Control | Run 2 click result |
|---|---|
| `dashboard` breadcrumb link | ✅ navigates (lands on /dashboard 500, separate bug N1) |
| `#canvas-chat-toggle` (AI Chat) | ✅ opens slide-out panel, chat form visible |
| `#canvas-settings-link` (Settings) | ✅ navigates to site settings |
| `#canvas-save` (Save) | ✅ `PUT /api/canvas/sites/:id → 200 {ok:true}` (3 saves observed, debounced) |
| `#canvas-publish` (Publish) | ⚠️ `POST /api/publish/sites/:id → 400` with structured `unfilledMediaSlots`. Modal "OK" button dismisses cleanly. *Behaviour correct; site can't publish until `el-defc1f53-...` media slot is filled.* |
| `#canvas-save-template` (Save as template) | 🟨 not clicked — would create a personal template entry the user can't easily clean up. |

**Sidebar tabs**
| Control | Run 2 click result |
|---|---|
| `[data-sidebar-tab=add]` | ✅ Add panel visible (Sections + Components + Style Kit) |
| `[data-sidebar-tab=sections]` | ✅ Sections picker visible, others hidden |
| `[data-sidebar-tab=pages]` | ✅ Pages list visible |
| `[data-sidebar-tab=symbols]` (injected) | ✅ Symbols panel visible only when this tab active |
| `[data-sidebar-tab=versions]` (injected) | ✅ Version History panel visible only here |

**Add panel components** (clicked in one batch with 300 ms gap each)
| Control | Click result | Persisted? |
|---|---|---|
| `[data-sidebar-add-component=text]` | clicked | ❌ no |
| `[data-sidebar-add-component=image]` | clicked | ❌ no |
| `[data-sidebar-add-component=video]` | clicked | ❌ no |
| `[data-sidebar-add-component=action]` (Button) | clicked | ❌ no |
| `[data-sidebar-add-component=shape]` | clicked | ❌ no |
| `[data-sidebar-add-component=container]` | clicked | possibly (one of the 3 that landed) |
| `[data-sidebar-add-component=chart]` | clicked | ❌ no |
| `[data-sidebar-add-component=form]` | clicked | possibly |
| `[data-sidebar-add-component=embed]` | clicked | possibly |
| `[data-sidebar-add-component=code]` | clicked | ❌ no |
| `[data-sidebar-add-component=accordion]` | clicked | ❌ no |
| `[data-sidebar-add-component=carousel]` | clicked | ❌ no |
| `[data-sidebar-add-component=table]` | clicked | ❌ no |
| `[data-sidebar-add-component=nav]` | clicked | ❌ no |
| `[data-sidebar-add-section=blank]` | clicked | ❌ section count unchanged (9 → 9) |

Net: 108 → 111 elements after 15 clicks. **12 silent failures with 12 Yjs CRDT errors.** (See N2.)

**Inspector toolbar** (after dispatching click on `[data-rev01-element=enterprise-hero-bg]`)
| Control | Click result | Persisted? |
|---|---|---|
| Move up in reading order | clicked (initially disabled because element was at position 1 of 21 — DOM showed `disabled=""`; click was still fired) | ❌ no |
| Move down in reading order | clicked | ❌ no |
| Bring to front | clicked | ❌ no |
| Send to back | clicked | ❌ no |
| Forward | clicked | ❌ no |
| Backward | clicked | ❌ no |
| Duplicate | clicked | ❌ element count unchanged (111 → 111) |
| Delete | 🟨 not clicked — would have destructively removed the hero bg |
| Upload (file picker) | 🟨 not clicked — would have opened OS file dialog |
| × clear style | 🟨 not clicked — would have reset element style |
| Replay animation | 🟨 not clicked — purely visual, low value |
| 14 inputs (select × 3, checkbox × 4, color × 3, file × 1, number × 3, range × 1, text × 1) | not exercised — same Yjs issue would block persistence, so no point poking each one |

### `/dashboard/sites/:id/settings` — Site Settings

| Control | Run 2 click result |
|---|---|
| Search-indexing checkbox | ⚠️ N6 — first toggle persisted (`true → false`); restore toggle didn't persist on first try. Manually restored after reload. |
| Visitor dark-mode checkbox | ⚠️ Same N6 — toggled to `true`, restore-click dropped, manually restored. |
| **Enable** (password protection) | ✅ click revealed `<input type=password>` form; Cancel button restored. (No password was set or persisted.) |
| **Choose image** (favicon) | ✅ click opened the `.picker-modal`. (No upload submitted.) |
| **Disable password** | 🟦 hidden (password isn't currently enabled) |
| Collaborator email + role + **Invite** | 🟨 not clicked — would have emailed a real third party. |
| Remove collaborator | 🟦 empty list, no row to click |
| Clear favicon | 🟦 hidden (no favicon currently set) |

### `/dashboard/sites/:id/snapshots` — Versions

| Control | Run 2 click result |
|---|---|
| **Preview** (per-row) | ❌ Preview pane shows "Preview failed: Internal Server Error" — N4 |
| **Restore** (per-row) | 🟨 not clicked — would overwrite the current canvas |
| Snapshot label input | ✅ accepts text |
| **Save snapshot** (form submit) | ❌ N4 — `/api/canvas/sites/:id/snapshots` returns 404, snapshot never created |

### `/dashboard/sites/:id/domains` — Custom Domains

| Control | Run 2 click result |
|---|---|
| Hostname input | ✅ accepts text |
| **Add domain** | ❌ N5 — `POST /api/sites/:id/domains` returns 502; UI silently fails |
| Delete domain (per row) | 🟦 list is empty |

### `/dashboard/sites/:id/addons` — Site Addons

| Control | Run 2 click result |
|---|---|
| **Enable on this site** (GA toggle) | ✅ flipped `false → true`, reloaded showed it persisted; flipped back, persisted. |
| **MEASUREMENT ID** input | ✅ accepted `G-DFSTEST1`; persisted across reload. Cleaned up to empty string after testing. |
| **Save** (GA) | ✅ shows "Saving..." then "Saved. Publish your site to apply changes." |
| **Visit Addons** (Custom Scripts) | 👁 link to shop, not clicked |

### `/dashboard/sites/:id/chat` — Site Chat

| Control | Run 2 click result |
|---|---|
| Message textarea | ✅ accepts text |
| **Send** | ✅ POST `/api/sites/:id/chat → 200`, SSE stream returned a single greeting **with no unsolicited tool call** (B4 fixed) |
| Accept / Reject (per proposal) | 🟦 no proposal appeared because the agent respected the no-modify directive |

### `/dashboard/profile` — Profile

| Control | Run 2 click result |
|---|---|
| `input[name=displayName]` | ✅ pre-filled "Aayushman Singh" |
| `textarea[name=bio]` | ✅ editable; edited, saved, reloaded, reverted, saved, reloaded |
| `select[name=timezone]` | ✅ pre-filled "UTC", select options confirmed |
| **Save changes** | ✅ status "Saved" visible after click; persisted across reload |
| **Sign out** | 🟨 not clicked — would have ended the session and required re-auth |

### Landing `/`

| Control | Run 2 click result |
|---|---|
| Runtime counters | ✅ B8 fixed — counters animate when section is partially in fold |
| Other anchors / footer | unchanged from Run 1 |

### Published site `test1.rev01.aayushman.dev/`

| Control | Run 2 click result |
|---|---|
| Talk to sales → `/contact` | ❌ still 404 — B5 template fix not retroactive on test1 |
| Contact sales → `/contact` | ❌ same |
| Other anchors | ✅ same as Run 1 |
| `/sitemap.xml` | ✅ B10 fixed — emits `https://test1.rev01.aayushman.dev/` (no `home`, no `#v=1`) |

---

## What was NOT clicked this pass (and why)

| Control | Reason |
|---|---|
| Stripe **Upgrade to Pro / Team** | real billing side-effect |
| **Delete account** | locks user out |
| Editor **Save as template** | creates a personal template the user has to manually delete |
| Editor **Delete** (inspector) | irreversible element removal |
| Editor **Upload** (inspector file) | would open OS file dialog |
| Inspector **× clear style** | would reset visible styling on the hero |
| Inspector inputs (color/number/range/text) | wouldn't persist anyway (N2 Yjs) |
| Site Settings **Invite collaborator** | sends an email to a third party |
| Versions **Restore** | overwrites current canvas |
| Site Domains **Delete** | list empty |
| Sign out from Profile | ends session mid-test |
| Every control on `/dashboard`, `/dashboard/templates`, `/dashboard/settings` | pages 500 (N1) |
| Every control on `/dashboard/sites/:id/nav` | route 404 (N3) |

## Verified bug status (Run 2)

| Bug | Before | After |
|---|---|---|
| B1 dashboard 500 | 🚨 | 🚨 + spread to templates + settings (N1) |
| B2 save/publish 400 | 🚨 | ✅ |
| B3 fake notif toggles | 🚨 | 🟦 (unverifiable — settings page 500) |
| B4 agent guard | ⚠️ | ✅ |
| B5 /contact 404 | ⚠️ | ⚠️ (template fixed; test1 state stale) |
| B6 rickroll iframe | ⚠️ | 🟦 (templates page 500) |
| B7 sticky-header click eat | ⚠️ | 🟦 |
| B8 landing counters | ⚠️ | ✅ |
| B9 plan/limit copy | ⚠️ | 🟦 (settings 500) |
| B10 sitemap #v=1 | ⚠️ | ✅ |

## NEW bugs discovered in Run 2 — must fix

| # | Page | Symptom |
|---|---|---|
| N1 | `/dashboard`, `/dashboard/templates`, `/dashboard/settings` | 500 on every authenticated GET. Regression from sites-list query path; spread when `ca1eb65` was authored. |
| N2 | Editor canvas mutations (Add-component, inspector toolbar) | 19 Yjs `Unexpected content type` per ~21 clicks. Most edits silently drop; only 3/15 components persisted. Editor is effectively read-only via UI. |
| N3 | `/dashboard/sites/:id/nav` | 404 — route disappeared but sidebar still links to it. |
| N4 | `/dashboard/sites/:id/snapshots` | UI renders but `/api/canvas/sites/:id/snapshots` returns 404. Preview and Save snapshot both fail. |
| N5 | `/dashboard/sites/:id/domains` | `POST /api/sites/:id/domains` returns 502 Bad Gateway. |
| N6 | Site Settings checkboxes | Second click in the same toggle pair drops silently. |

## Recommended sequence

1. **N1 first** (dashboard list pages 500) — blocks 22+ controls and the canonical landing post-login.
2. **N2 second** (Yjs CRDT integration errors) — without it, the editor is unusable. Likely needs to chase the `Unexpected content type` exception inside the Yjs `_integrate` path; the bundled stacktrace at `:2764:32563` points at `Kr` which handles the canvas op envelope — possibly a schema mismatch between the client's emitter and what Yjs expects after the asset-skip patch (`fa2f10a`).
3. **N3 & N4** are routing/api regressions — likely a single missing `app.route('/nav', ...)` and `app.route('/api/canvas/sites/:id/snapshots', ...)` mount.
4. **N5** domains 502 — check the Cloudflare custom-hostname binding env var.
5. **N6** double-toggle drop — bind the second client `fetch` regardless of whether the first one is still pending.
6. Then re-verify B3, B6, B7, B9 once the dashboard pages stop 500-ing.
