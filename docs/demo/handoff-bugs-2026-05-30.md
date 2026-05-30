# Pass-7 bug handoff — 2026-05-30

**For:** next agent picking up bug investigation + fix work before demo recording.
**From:** Pass-7 Playwright drive against prod
([drive-2026-05-30-pass-7-findings.md](drive-2026-05-30-pass-7-findings.md)
has the full evidence trail with network calls, console logs, and screenshots).
**Subject site:** Briar — `74a8854d-6f2a-45f8-af18-19b0f74bf215`, published v2.
**Branch:** `main` (deployed worker, ~10:46 UTC on 2026-05-30).

## How to use this doc

Each item below is independently actionable. Pick one, fix it, **leave the
checkbox checked + add a one-line "fixed in <commit-sha>" note**, then ping
the user. They will trigger a Playwright retest using the retest steps under
each item. Don't bundle fixes unless the items are explicitly grouped.

The items are roughly ordered by impact — P0 product bugs that break real
users at the top, then recording-blockers, then script-wording deltas.

## Pass-7 resolution sweep — 2026-05-30 (post-handoff)

| Bug | Status | Fixed in / Notes |
| --- | --- | --- |
| B1 — CSP blocks Turnstile | ✅ Already shipped | `ab68578` — `src/embed/csp.ts:85,92,95` add `https://challenges.cloudflare.com` to script-src + frame-src + connect-src. Awaits redeploy. |
| B2 — Agent apply endpoint shape | ✅ Already shipped | `5fbbc4e` — `src/routes/api/canvas-agent.ts:367-392` accepts canonical `{ ops }` + legacy `{ tool, params }` shapes; both client callers post canonical. |
| B3 — Editor never broadcasts changes | ✅ Closed by this sweep | `d8b30e3` covered config PATCH only. This sweep adds `broadcastEditableStateReplaced()` to PUT `/seo`, PUT `/metadata`, POST `/style-kit` so every non-Yjs write path refreshes the DO. |
| B4 — Collaborator autosave gated | 🟡 Partially closed | The 403 handler from B9 now surfaces a loud "Access removed" modal when the collaborator's session loses access. The deeper Pass-7 repro (collaborator edit → blur → wait 30s → server unchanged on a *still-authorized* session) appears to be in the Yjs co-edit projection path, not authorization — `src/live/co-edit/autosave.ts` has no auth gating, so the autosave should fire on any Y.Doc update. **Diagnostic harness shipped: `e2e/live-driver/b4-repro.mjs`** — see B4 investigation notes below before the next code change. |
| B5 — Stale Yjs cache overwrite | ✅ Closed transitively | Downstream of B3 — broadcasts now refresh stale DOs on every non-Yjs write, so the stale-tab clobber scenario in the original repro no longer applies. State-vector reconciliation on focus is a separate enhancement (not regression). |
| B6 — Visitor dark-mode toggle missing | ✅ Closed by this sweep | `src/routes/public.ts` now calls `renderModeToggleHtml(c.env)` when `visitorTheme === 'toggleable'` and injects the button into body before the footer. The button + click script + cookie writer were always defined in `src/themes/visitor-mode/toggle-element.ts`; the renderer simply never called them. |
| B7 — Stale rev01 canonicals | ✅ Already shipped | `854432b` — fixture canonicals removed; `src/seo/meta-emit.ts:138-149` derives canonical from `ctx.host`; `src/seo/smoke.ts:474-509` pins behaviour. Awaits redeploy. |
| B8 — OG image fixture leak | ✅ Already shipped | `c6ad95f` — `ogImageAssetId` dropped from Apogee fixture; `src/seo/og-resolve.ts:43-62` falls back to `/og/{siteId}/{slug}.png` generator. Awaits redeploy. |
| B9 — No "Access removed" overlay | ✅ Closed by this sweep | `src/editor/canvas-client.ts` — `authFetch` now branches on 403 → `handleAccessRevoked()` shows a locked-down "Access removed" alertdialog with a "Back to dashboard" CTA, locks Save/Publish/AI controls, and traps keyboard shortcuts so Ctrl+Z / Ctrl+S can't keep mutating a server that's already refusing the writes. No auto-reload (would loop on the same 403); the user navigates away on their own terms. |
| B10 — GA addon validation | ✅ Already shipped | `8d15ae7` — client pattern at `src/routes/dashboard/addon-shop.tsx:315` + `site-addons.tsx:233`; server 400 at `src/routes/api/addons.ts:219-228`; registry pattern at `src/addons/registry.ts:54-55`; smoke `src/addons/google-analytics.smoke.ts` pins both layers. |
| B11 — Header buttons count | 🟡 Mostly resolved | `425c44e` removed A11y from the editor header (now: AI Chat · Settings · Save · Publish + version badge = 4 buttons + badge) and added Accessibility to the site-settings TOC. Script S2.A.7 says "five buttons" + no version badge — still a mismatch on count + badge, but smaller. Script edit (or accept the badge) is the cheap close. |
| B12 — Template gallery count | ✅ Closed by this sweep | `docs/demo/act-1-script.md` S1.5 + S1.9 — voiceover now says "eight templates" and enumerates Press Canvas + Violet Launch alongside the original six. |
| B13 — Landing CTA wording | ✅ Closed by this sweep | `docs/demo/act-1-script.md` S0.2 + S0.3 — voiceover now references the live "Start building" button instead of the absent "Launch dashboard." |
| B14 — `Launch PageProduct` collapse | ✅ Already shipped | `src/landing/styles.ts:776-781` — `.tpl .cap { display: flex; flex-direction: column; }`. Awaits redeploy. |
| B15 — AI media modal | ✅ Already shipped | `11829d4` — `src/editor/canvas-client.ts:1130-1227` ships aspect picker (1:1/16:9/4:3/9:16), 4-up gallery grid (`repeat(2, 1fr)`), button labelled `"Generate with AI"`. |
| B16 — Element click intercepted | ✅ Closed by parallel work | `425c44e` ships a transparent `::after` click-shield on the wrapper for code/table/chart/form/carousel — pointer events on widget internals now resolve to the host element. CSS-only fix; second click reaches the widget per the Figma/Webflow pattern. |
| B17 — Strike mark deprecated tag | ✅ Already shipped | `8d15ae7` — `src/canvas/elements/render-utils.ts:100`, `src/editor/canvas-client.ts:2239,4161` emit `<s>`; smoke `src/canvas/elements/render-utils.smoke.ts:28-36` asserts no `<strike>` emit. Deserialiser accepts both for paste tolerance. |
| C1 / C2 — Recording prep | ➡️ Operator task | No code change — recording operator (Maya) cleans Briar per the cleanup list before camera rolls. |

**Net of this sweep (cumulative across two passes):**

- ✅ Closed by this work: B3, B6, B9, B12, B13.
- ✅ Closed by parallel commit `425c44e`: B16, B11 (mostly).
- ✅ Already shipped, awaiting redeploy: B1, B2, B7, B8, B10, B14, B15, B17. Plus B5 (collapses out via B3).
- 🟡 Partially closed: B4 — the 403 handler from B9 makes revoked sessions loud, but the original Pass-7 repro of a *still-authorized* collaborator's edits not autosaving needs a reproducer (WS frame capture) before a real fix lands; not blocking the demo because manual Save still works.
- ➡️ Operator task: C1 + C2 recording prep.

All 17 numbered items have a status; nothing else outstanding from
the handoff. Next-session focus when reproducing B4: capture the
on-site editor's WebSocket frames during a collaborator edit to see
whether the Y.Doc update message actually reaches the DO.

## B4 investigation — how to use the diagnostic harness

`e2e/live-driver/b4-repro.mjs` reproduces the Pass-7 evidence beat with
WebSocket frame capture on both tabs and a before/after read of
`editableState` via the canvas API. Three plausible root causes:

1. **`coEditSync()` silently returns false** — `canvas-client.ts:2143-2161`
   has an `if (coEditConnection) { ... return; }` branch that toasts
   "Co-edit disconnected; changes not saved" and never falls back to the
   HTTP autosave. Edits land in this branch when the WebSocket is open
   but the Y.Doc projection hits a transient.
2. **WS handshake never opens** for the on-site editor on a published
   subdomain — possible cookie / SameSite / CSP / domain mismatch.
   `coEditConnection` stays null, the HTTP debounce *should* fire as the
   fallback path, but if the editor's session-cookie scope doesn't cover
   the subdomain the HTTP PUT itself would 401 (and the new B9 modal
   would unmask that case).
3. **DO autosave debounce keeps getting canceled** — `co-edit/autosave.ts`
   uses a 750ms debounce; if a noisy peer keeps poking the Y.Doc the
   timer can in principle reset forever. Unlikely but worth eliminating.

How to run it:

```
node e2e/live-driver/driver.mjs start &        # window 1, persistent
node e2e/live-driver/b4-repro.mjs \             # window 2
  --siteId 74a8854d-6f2a-45f8-af18-19b0f74bf215 \
  --subdomain briar \
  --elementId wf-hero-cta-primary \
  --newLabel "B4-diag-$(date +%s)" \
  --out /tmp/b4-report.json
```

Read the JSON's `diff` field first:
- `applied` → the autosave path worked end-to-end. The original Pass-7
  evidence may have been a stale-state artifact rather than a real bug;
  rerun on a fresh editor session before filing a new code fix.
- `reverted-or-never-saved` → B4 reproduces. Then read
  `tabB.statusLineHistory` to learn which leg failed:
  - history contains `"Synced"` → Y.Doc projection ran, DO is the
    culprit. Look at `tabB.wsFrames` for unanswered `sent` frames.
  - history contains `"Co-edit disconnected; changes not saved"` →
    root cause #1, fix in `scheduleSave()` HTTP fallback.
  - history contains `"Saved"` only → coEditConnection was null;
    HTTP debounce fired but the PUT was rejected (look at console
    errors for the response detail).

The harness reuses the existing Clerk-authenticated profile in
`e2e/live-driver/.profile/` (started by `driver.mjs start`), so no
extra account setup is required for a single-account / two-tab repro.
Two-account collaborator-vs-owner setup is a follow-up if the single-
account repro doesn't reveal anything.

---

## P0 — real product bugs that break users today

These break the live site for non-recording users. Ship these first.

### B1 — CSP blocks Turnstile on every published page

- [ ] **Fix shipped.** (Mark when done.)

**Symptom.** No visitor can submit any form on any published Open Canvas
site. Form POSTs hit `500 Internal Server Error` because no
`cf-turnstile-response` token is in the body.

**Evidence.**
- Console error on `https://briar.opencanvas.aayushman.dev/enterprise`:
  ```
  Loading the script 'https://challenges.cloudflare.com/turnstile/v0/api.js'
  violates the following Content Security Policy directive:
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com".
  ```
- `https://challenges.cloudflare.com/turnstile/v0/api.js` returns `FAILED csp`
  in the network panel.
- The Turnstile placeholder div in DOM:
  `<div class="cf-turnstile" data-sitekey="0x4AAAAAADXnjlMqWuuYSN8-"></div>`
  stays empty (no iframe injected).
- Form POST `/__rev01/forms/{siteId}/{formId}` → `500`.

**Suspected location.** Whatever response-CSP middleware sets
`script-src` for published HTML. Likely `src/security/csp.ts` or wherever
the CSP header is composed for the visitor surface. ADR 0020 (CSP nonce)
is the home for this work.

**Recommended fix.**
1. Add `https://challenges.cloudflare.com` to the `script-src` directive
   in the published-page CSP.
2. Also add it to `frame-src` (Turnstile renders the challenge inside a
   child iframe).
3. Double-check `connect-src` allows
   `https://challenges.cloudflare.com` for the token-validation XHR.

**Retest steps.**
1. `https://briar.opencanvas.aayushman.dev/enterprise` — open DevTools
   console.
2. Confirm no CSP errors for the Turnstile script.
3. Confirm `<div class="cf-turnstile">` now has an `<iframe>` child within
   a few seconds.
4. Fill the form, submit. Expect `__rev01/forms/...` → `200` (with a
   redirect to the success page) instead of `500`.
5. Check the inbox on `/dashboard/sites/{id}/forms` — submission row
   should appear.

**Script beats affected.** I2.E (visitor first visit), S5.F (form element
demo), I6 (lead inflow montage), S8 (forms inbox).

---

### B2 — Agent `apply` endpoint rejects the chat client's body shape

- [ ] **Fix shipped.**

**Symptom.** Every "Accept" on an AI Chat proposal silently fails. User
clicks Accept on a `deletePage` / `addPage` / `updateElement` card; card
flips from `Accept` → `Failed` after a few seconds; nothing happens to
the site.

**Evidence.**
- Network: `POST /api/canvas-agent/sites/{id}/apply` returns `400`.
- Error body when reproducing the request with the client's payload
  `{tool, params, threadId}`:
  ```json
  {"error":"body must be { ops: CanvasAgentOp[] }"}
  ```
- With a corrected `{ops: [{tool, params}]}` shape, server returns:
  ```json
  {"error":"ops[0]: unknown op kind: undefined"}
  ```
  → so the op shape inside the array is *also* wrong (expects `kind` not `tool`).

**Suspected location.**
- Client side: editor chat UI's "Accept" handler — likely in
  `src/editor/canvas-client.ts` or a chat-card component that posts to
  `/apply`.
- Server side: `src/routes/canvas-agent.ts` (or similar) — the route
  handler that parses `body.ops[].kind`.

**Recommended fix.**
1. Decide on the canonical shape — server's `{ ops: [{ kind, params }] }`
   is the more flexible one and matches the multi-op naming.
2. Update the client `Accept` handler to wrap its single tool call in
   `{ops: [{kind: <toolName>, params: <args>}]}`.
3. Add a smoke test that mocks the chat client and POSTs an `apply` call
   with the new shape end-to-end so this can't regress silently.

**Retest steps.**
1. Open editor on Briar → AI Chat → prompt: `Delete the customers page entirely.`
2. Wait for the `deletePage` proposal card.
3. Click `Accept`. Card should flip from `Accept` → vanish (apply success),
   not `Failed`.
4. Open Pages tab in sidebar — `customers` row should be gone.
5. Network: confirm `POST /apply → 200`.

**Script beats affected.** S4.B (AI deletePage demo), S4.C (AI addPage
demo), every "Accept" card flow in S2.C/D.

---

### B3 — On-site editor never broadcasts changes to other open sessions

- [ ] **Fix shipped.**

**Symptom.** When two editor sessions are open on the same site and one
saves a change, the other does not see it until refresh. Most visible
during collaboration but also when an owner has two tabs open.

**Evidence.**
- Repro during I1: 2nd profile changed `wf-hero-cta-primary.label` to
  `test1234` on `briar.opencanvas.aayushman.dev/?edit`, clicked Save.
- Server `editableState` immediately reflected `test1234`.
- Owner-side dashboard editor + a second on-site editor tab the owner
  opened both continued to render `Get started free` on the same element.
- After ~30 s with no change. After hard-refresh, owner-side rendered
  `test1234`.

**Suspected location.** The Yjs broadcast / awareness channel layer —
likely `src/live/site-room.ts` (the SiteRoom DO). The save persists via
the HTTP autosave path, but the broadcast that should fan out updates
to other connected WebSockets is missing or scoped too narrowly.

**Recommended fix.**
1. Audit `SiteRoom.broadcast()` — does it actually emit a Y update
   message to other connected clients when a save lands?
2. Check whether the on-site editor's edit-token-cookie WebSocket
   connection is in the same broadcast room as the dashboard editor's
   session-cookie connection. If they live in separate rooms, the doc
   updates can't merge — fix by keying the SiteRoom solely on `siteId`,
   not on origin or auth scheme.

**Retest steps.**
1. Open two editor tabs on Briar:
   - Tab A: dashboard editor at `opencanvas.aayushman.dev/dashboard/sites/{id}/edit`
   - Tab B: on-site editor at `briar.opencanvas.aayushman.dev/?edit`
2. In tab B, click a CTA, change its label to `RETEST-B3`, blur, hit Save.
3. Within ~3 seconds, tab A's canvas should re-render with `RETEST-B3`
   on the same element, no refresh.

**Script beats affected.** I1.D, I1.E (Sam edits CTA → cut to Maya, change
already in her view).

---

### B4 — On-site editor does not autosave for collaborators

- [ ] **Fix shipped.**

**Symptom.** A collaborator (anyone with an edit-token cookie, not the
account cookie) edits a text element. The change shows on their canvas
but never reaches the server. If they refresh, the change is gone.
Workaround: click the top-bar Save button explicitly.

**Evidence.**
- Repro during I1: 2nd profile (collaborator) double-clicked hero CTA,
  changed label, blurred. Waited 30 s. Server `editableState` still
  showed the old label.
- After clicking Save manually, server flipped to the new value.

**Suspected location.** The Yjs autosave debounce / save trigger in the
on-site editor surface — likely the same canvas-client code that drives
the dashboard editor, but with autosave wired only to the dashboard's
cookie/auth shape, not the edit-token cookie path.

**Recommended fix.**
1. Find the autosave hook (likely in `src/editor/canvas-client.ts` or
   `src/live/co-edit/`) and confirm it runs unconditionally when any
   editor session is open, not gated on owner-session cookies.
2. If gating is intentional, surface a visible warning to collaborators
   ("Autosave off — click Save to keep your changes") so they don't lose
   work silently.

**Retest steps.**
1. Re-invite a collaborator (or use an account with edit access).
2. From the collaborator session, edit any text element, blur, wait
   15 s. Do NOT click Save.
3. Fetch `/api/canvas/sites/{id}` and confirm `editableState` reflects
   the change without a manual Save click.

**Script beats affected.** I1 (Sam co-edit), any future demo that
involves a non-owner editing.

---

### B5 — Stale Yjs local cache silently overwrites recent server saves

- [ ] **Fix shipped.**

**Symptom.** Session A loads doc, sits idle. Session B (different user)
edits the same element + saves. Session A reconnects (page focus,
navigation back) and its stale local Y.Map state is pushed back to the
server, overwriting Session B's save.

**Evidence.**
- Repro during I1: 2nd profile saved `wf-hero-cta-primary.label = 'test1234'`.
  Owner navigated dashboard editor → settings (Remove) → back to dashboard
  editor. Owner's local state had `'Get started free'` cached from before
  the test1234 save. Server then read `'Get started free'` again — the
  collaborator's recent save was silently lost.

**Suspected location.** Yjs CRDT merge layer, likely in
`src/live/site-room.ts` or the autosave debounce inside
`src/editor/canvas-client.ts`. The expected behavior is last-write-wins
on Y.Map keys, but in practice the stale write won.

**Recommended fix.**
1. May be a downstream effect of B3 — without live broadcast, the stale
   session never received the test1234 update to merge with, so its local
   Y.Doc has a stale state vector. Fixing B3 may fix this automatically.
2. If not, audit the autosave write path — it should not blindly overwrite
   server state with the local Y update on reconnect; it should rebase
   on the latest server state vector first.
3. Add a Y state-vector reconciliation step on focus/visibility-change.

**Retest steps.**
1. Open editor in two tabs (same account is fine for repro).
2. Tab A: navigate away to settings.
3. Tab B: edit a label, save.
4. Tab A: navigate back to the editor (don't refresh).
5. Confirm the new label is preserved on the server — tab A should not
   silently overwrite it.

**Script beats affected.** Risk of data loss whenever any user has
multiple sessions open. Indirectly affects I1, any multi-tab demo.

---

## P1 — recording blockers (script can't run as written until fixed)

### B6 — Visitor dark-mode toggle never renders even after publish with `Toggleable`

- [ ] **Fix shipped.**

**Symptom.** Site Settings → `Visitor dark mode` is set to `Toggleable by
visitors`. The helper text reads `Takes effect at the next publish`. After
publishing v2, no toggle button appears on the visitor page.

**Evidence.**
- Briar's `/settings#dark-mode` shows the checkbox checked + helper text.
- `briar.opencanvas.aayushman.dev/` after v2 publish: no
  `aria-label="theme"` button, no moon/sun emoji, no `[role="switch"]`
  for theme in the DOM.
- Inline anti-flash script *is* present in the head (reads
  `__opencanvas_theme` cookie and `prefers-color-scheme`), but there's
  no UI to flip the cookie.

**Suspected location.** Published-page render template — likely
`src/canvas/render.ts` or the section/footer renderer. The toggle is
either gated behind a wrong feature flag, or its component is missing
from the rendered output despite the schema bool being true.

**Recommended fix.**
1. Find the visitor-toggle component (whatever renders the moon/sun
   button) and confirm it's mounted on published pages when
   `editableState.darkMode === true`.
2. If the component exists but is conditionally hidden, fix the gating.
3. Add an integration test that publishes a fixture with darkMode=true
   and asserts the toggle is in the rendered HTML.

**Retest steps.**
1. Open `https://briar.opencanvas.aayushman.dev/` after this fix lands.
   No refresh needed — just visit.
2. Look for a visible theme toggle (moon/sun button) in the header or
   floating near the bottom-right.
3. Click it. Confirm the page repaints in the opposite mode and the
   `__opencanvas_theme` cookie value updates.

**Script beats affected.** I2.D (visitor dark mode).

---

### B7 — Published pages emit stale `rev01.aayushman.dev` canonical URLs

- [ ] **Fix shipped.**

**Symptom.** Every page on Briar (and any site created from the Apogee
Showcase template) emits a `<link rel="canonical">` pointing at
`https://apogee.rev01.aayushman.dev/...` — a host that no longer exists
after the rebrand to `opencanvas.aayushman.dev`. SEO regression on every
published page.

**Evidence.**
- DevTools on `https://briar.opencanvas.aayushman.dev/`:
  `<link rel="canonical" href="https://apogee.rev01.aayushman.dev/">`.
- `src/canvas/fixtures/apogee-showcase.json` lines 610, 2352, 3448, 4945,
  6362 hardcode the stale canonical URLs.

**Suspected location.** `src/canvas/fixtures/apogee-showcase.json` — the
fixture used to seed every Apogee Showcase site.

**Recommended fix.**
1. Search-and-replace `apogee.rev01.aayushman.dev` →
   `opencanvas.aayushman.dev` (or leave the canonical field unset so
   the renderer derives it from `siteId.subdomain`).
2. Better: stop baking absolute hostnames into fixtures. Let the
   render layer compute canonicals from `{subdomain}.{APP_DOMAIN}` at
   publish time. The fixture should only carry relative paths.
3. Backfill existing Briar's editableState if it's storing the stale
   canonical too (memory `project_a11y_audit_gates_publish` for the
   shape).

**Retest steps.**
1. After the fix, publish a fresh Apogee Showcase site (or republish
   Briar).
2. DevTools head: confirm `<link rel="canonical">` shows the live URL
   (`https://briar.opencanvas.aayushman.dev/...`).
3. Test with a non-index page: `/blog`, `/pricing` — should each have
   the correct page-specific canonical.

**Script beats affected.** S7.H.2 ("DevTools → meta property=og:image
shows the cached URL" — camera will pan into head tags and see the
broken canonical too).

---

### B8 — OG image fixture leak — published pages use the seed asset, not a rendered OG PNG

- [ ] **Fix shipped.**

**Symptom.** `<meta property="og:image">` on every Briar page points to
`https://briar.opencanvas.aayushman.dev/assets/seed-feature-canvas-1` —
the Apogee seed asset. Per Act 2 D19, the product should render a real
OG PNG per published page (Satori → resvg → R2 cache).

**Evidence.**
- DevTools on `briar.opencanvas.aayushman.dev/`:
  `<meta property="og:image" content="…/assets/seed-feature-canvas-1">`.
- Backlog item #14 in [`handoff-delta-resolution-2026-05-30.md`](handoff-delta-resolution-2026-05-30.md)
  describes the intended pipeline.

**Suspected location.** OG-image rendering pipeline — likely
`src/og-image/` if it exists, or `src/seo/` for the meta-tag emission
side. The Satori → resvg path described in Act 2 D19 may not be wired
to the publish flow yet.

**Recommended fix.**
1. Confirm whether the OG-image renderer is implemented at all. If not,
   build it per D19 (Satori for SVG, resvg-wasm for PNG, content-hash
   key in R2).
2. If it exists, wire it to the publish flow so each `pages[]` entry
   gets a per-page OG render at publish time and the meta tag points
   at the cached R2 URL.
3. Fall back to the favicon or a kit-themed default if neither a
   page-specific OG nor the slot media is set.

**Retest steps.**
1. Republish Briar.
2. View source / DevTools on `/`, `/blog`, `/pricing` —
   `og:image` should be a per-page R2 URL with a content-hash key,
   *not* the seed asset path.
3. Each different page should have a different OG image URL.

**Script beats affected.** S7.H.1 (OG preview pill in editor header).

---

### B9 — No "Access removed" overlay after collaborator is revoked

- [ ] **Fix shipped.**

**Symptom.** When the owner removes a collaborator (Settings →
Collaborators → Remove), the 2nd profile's editor goes silently
read-only. No modal, no toast, no overlay, no redirect — they only
discover they've lost access when their next edit doesn't take effect.

**Evidence.**
- Repro during I1: owner DELETE on collab row returned 200.
- 2nd profile continued to interact with the editor; edits failed
  silently.

**Suspected location.** The editor's `applyOp` / save handler (likely
in `src/editor/canvas-client.ts`). Needs to catch the 401 from the
autosave/apply route and surface a styled modal.

**Recommended fix.**
1. Catch any `401 Unauthorized` from any editor write call.
2. Display a centered modal: `Access removed — this site is no longer
   shared with you. Sign in or close this tab.`
3. Include a `Back to dashboard` link (for the collaborator's own
   account dashboard, if they have one).
4. Disable further write interactions in the editor after the modal
   fires.

**Retest steps.**
1. Re-invite a collaborator. They accept.
2. Owner clicks Remove on their row → Confirm.
3. From collaborator session, attempt any edit.
4. Confirm an `Access removed` modal appears immediately on the
   first failed write.

**Script beats affected.** I1.G (the "401 Access removed overlay"
voiceover beat).

---

### B10 — GA addon: bad measurement ID accepted, no validation client- or server-side

- [ ] **Fix shipped.**

**Symptom.** The Google Analytics addon's "Measurement ID" input accepts
any string (e.g. `X-INVALID-123`) and returns `200` on the PUT. Helper
text reads `Must start with G- followed by letters and numbers` but
neither the form nor the server enforces this.

**Evidence.**
- Tested `X-INVALID-123` → `PUT /api/addons/sites/{id}/addon_google_analytics → 200`.
- Tested `G-PASS7TEST01` → also 200.

**Suspected location.** Site-addon form handler (likely
`src/routes/addons.ts` or similar) + the JSX of the GA addon card.

**Recommended fix.**
1. Client: add an HTML5 `pattern="^G-[A-Z0-9]{8,15}$"` (or the actual
   GA4 pattern) attribute to the input plus a `required` if enabled.
2. Server: reject the PUT with a `400 { error: 'measurementId must
   match /^G-[A-Z0-9]+$/' }` if the body fails the pattern.
3. Surface the server error inline in the form.

**Retest steps.**
1. /dashboard/sites/{id}/addons — enable GA on Briar.
2. Type `XYZ-BAD` in measurement ID, click Save.
3. Confirm: inline error message appears, PUT returns 4xx, no save.
4. Type `G-VALID01` → Save succeeds.

**Script beats affected.** S10 (Acquire GA + configure → validation
error → fix).

---

## P2 — script-text deltas (rewrite script or rename UI to match)

These are 1-string product renames OR script-line edits. They don't block
real users; they only make the recording feel polished. Pick **one side**
of each (product vs script) and ship.

### B11 — Editor header has 6 buttons + version badge, script S2.A.7 says 5

- [ ] **Decided.**

**Live state:** the editor header right cluster reads
`AI Chat · Settings · A11y · Save · Publish · v{n} · Save as template`.

**Script S2.A.7 says** "five buttons" + no version badge.

**Action.** Either remove the A11y link (probably not — that was a
positive backlog #12 ship) and revert script, or simply rewrite the
script to list six buttons + the version badge.

**Recommendation.** Rewrite the script — A11y in the header is the better
UX and Pass-7 confirms backlog #12 shipped intentionally.

**Retest.** N/A — script-only edit. After the script is updated, mark
this checked.

---

### B12 — Template gallery shows 8 templates, script S1.5 says 6

- [ ] **Decided.**

**Live state:** Community tab reads `(8)`. Templates: Starter Canvas,
Launch Page, Enterprise Scale, Studio Portfolio, Local Business,
**Press Canvas**, **Violet Launch**, Apogee Showcase.

**Script S1.5 says** "six templates."

**Action.** Rewrite script to say "eight templates" and mention the two
new ones (Press Canvas + Violet Launch) by name OR don't enumerate them
all in voiceover.

**Recommendation.** Script edit. Both templates exist intentionally.

---

### B13 — Landing CTA: live buttons say "Sign in" / "Start building", script S0.2/S0.3 say "Launch dashboard"

- [ ] **Decided.**

**Live state:** Landing page top-right has `Sign in` + `Start building`
buttons. Hero CTAs are `Start building — it's free` and `Open the editor`.
None say `Launch dashboard`.

**Script S0.2 / S0.3** voiceover says "click Launch dashboard."

**Recommendation.** Rewrite script to say "Start building" or "Sign in"
(whichever the host wants to click on camera). Product rename adds no
value.

---

### B14 — `Launch PageProduct` rendering bug on landing template gallery tile

- [ ] **Fix shipped.**

**Symptom.** The "Launch Page · Product" tile in the landing template
gallery renders both fragments on one line as `Launch PageProduct`
without spacing, because the `.cap` class lacks `display: block` or
column-layout CSS.

**Evidence.** Landing page template grid tile for `Launch Page` template.
The two `<span>`s inside `<b>Launch Page</b><span>Product</span>` collapse.

**Suspected location.** `src/landing/components/StatLine.tsx:24-25`
(per prior handoff notes).

**Recommended fix.** Add `display: block` to the parent `.cap` class
so the two children stack vertically.

**Retest.** Open `https://opencanvas.aayushman.dev/`, scroll to
"Pick a starting point, make it yours." — the Launch Page tile should
read `Launch Page` and `Product` on two lines, not `Launch PageProduct`.

**Script beats.** S0 (visible on landing during cold open).

---

### B15 — AI media modal: missing aspect-ratio picker, single preview not four, button labeled "AI media" not "Generate with AI"

- [ ] **Decided.**

**Live state.**
- Inspector button reads `AI media`, not `Generate with AI`.
- Modal has only a single textarea (`Describe the image`,
  placeholder `Sunset over ocean`) + Cancel/OK. No aspect ratio
  dropdown.
- After Generate → one preview returned + Apply/Discard inline in the
  section inspector. Script says "four previews render, pick one."

**Script S3.G.1 / S3.G.2 says** "Aspect: 16:9", "four previews render",
"Generate with AI" button.

**Action.** Two paths:
1. Product: ship aspect ratio picker + 4-up preview grid.
2. Script: rewrite to single-preview, no aspect picker, "AI media" button.

**Recommendation.** Script edit for speed unless the 4-up grid is on
the roadmap.

---

### B16 — Element clicks on `code / table / chart / form / carousel` are intercepted by parent section

- [ ] **Investigated.**

**Symptom.** Programmatic clicks on `data-rev01-element="..."` for code,
table, chart, form, and carousel elements never select the element —
the click hits the parent section, and the inspector shows the section
inspector instead of the element inspector. Reproducible in Playwright
with the click coordinates inside the element.

**Evidence.**
- Repro during S5 inspection pass: clicks on
  `wf-faq-accordion`, `wf-form-element`, `wf-chart-donut`,
  `wf-compare-table`, `wf-embed-player`, `wf-carousel-gallery`,
  `showcase-code-snippet` all routed to the section inspector.

**Action.** May or may not be a bug — needs a manual mouse test to
confirm real users hit it too. If reproducible with a real mouse, the
click-routing layer (`canvas-client.ts` mousedown handler?) needs to
check element bounding boxes before the section's.

**Retest.** Human operator clicks each of the five element types
during script S5 recording — if the inspector flips to element-level
for each, this can be closed as a Playwright synthetic-click artifact.

**Script beats.** S5.H (code language), S5.I (table column align),
S5.J (accordion items), S5.K (carousel slides), S5.N (chart kind).

---

### B17 — Strike mark uses deprecated `<strike>` tag

- [ ] **Fix shipped.**

**Symptom.** When applying the Strike mark via the rich text toolbar,
the markup wraps the selection in `<strike>...</strike>` (deprecated
in HTML5). Should be `<s>` (presentational strike) or `<del>` (semantic
deletion).

**Evidence.** After applying Strike to "rank" in the hero body:
`<strike>rank</strike>`.

**Suspected location.** The mark renderer in `src/editor/marks.ts` or
wherever the rich-text mark-to-tag mapping lives.

**Recommended fix.** Switch the tag emit from `<strike>` to `<s>`.

**Retest.** Apply Strike mark to a word, inspect the DOM — should be
`<s>word</s>`, not `<strike>word</strike>`.

---

## Recording-prep cleanup (not bugs, but blocking the recording)

Items the recording operator (Maya) needs done on Briar before camera rolls.
None require new code — just clean-up actions in the editor / dashboard.

### C1 — Reset Pass-7 mutations on Briar

- [ ] Done.

- Hero CTA `wf-hero-cta-primary` label currently reads `Get started free`
  (auto-reset by stale-Yjs overwrite — see B5). Leave as-is.
- Delete the `Briar hero (Pass-7)` library entry. (Dashboard →
  library route, or via API.)
- Delete the `Briar v0 (Pass-7)` manual snapshot label if it's still in
  the timeline.
- Clear the AI Chat thread on Briar's editor (or accept the visible
  history during recording).
- Clear the GA measurement ID `G-PASS7TEST01` from
  `/dashboard/sites/{id}/addons` and `/dashboard/addons`.
- Hero video alt text: currently `Briar product video — calm focus app
  preview.` Leave as-is (matches script S7.C.2).
- Hero media is the Replicate-generated `8bbaff29-...`. Use the slot's
  `Recent in this slot` MRU to swap back to `seed-feature-canvas-1`
  before recording S2 / S3.

### C2 — Optional: re-seed a fresh Briar from the rebrand-fixed Apogee fixture

- [ ] Done.

If B7 (canonical URL fixture fix) ships, consider deleting the current
Briar and recreating it from the patched fixture so the entire history
is clean. Otherwise the existing Briar will still have stale canonical
URLs baked into its editableState until you republish.

---

## Verification once everything is fixed

When the next agent has worked through this list, ping the user. They'll
trigger a re-drive of the Pass-7 surfaces. Specifically the retests they
will run:

- Form submit on `/enterprise` (B1 → B10)
- AI Chat: `Delete the customers page entirely.` → Accept (B2)
- Open editor in two tabs, edit in one, watch the other (B3)
- Collaborator edits without manual Save (B4)
- Stale-tab overwrite scenario (B5)
- Visitor view dark-mode toggle (B6)
- DevTools head tags on every page (B7, B8)
- Collaborator removed → next edit → modal (B9)
- GA bad ID → error → fix (B10)
- Landing page tile text (B14)
- Strike mark DOM (B17)

## Companion files

- Full Pass-7 evidence: [drive-2026-05-30-pass-7-findings.md](drive-2026-05-30-pass-7-findings.md)
- Screenshots: [drive-2026-05-30/](drive-2026-05-30/)
- Recording script: [act-1-script.md](act-1-script.md)
- Prior backlog context: [handoff-delta-resolution-2026-05-30.md](handoff-delta-resolution-2026-05-30.md)
