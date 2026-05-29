# Dry-Run Report — Briar via Apogee, 2026-05-29

End-to-end Playwright drive-through of the Act 1 script against production at `https://rev01.aayushman.dev/`, using the user's Clerk session cookies. Outcome: **Maya's site "Briar" is created from the patched Apogee Showcase template and published v1 at `https://briar.rev01.aayushman.dev/`.** Several P0 product bugs surfaced — three were fixed and deployed during the run; one is unresolved (Worker resource exhaustion at scale).

---

## What landed in production this session

| Time | Action | Outcome |
|---|---|---|
| 1 | Apogee fixture patch deployed (version `642b5411`) | post-patch state live for new sites |
| 2 | DELETE /api/sites/:id endpoint added + UI confirm modal wired + deployed (version `5631dba4`) | site removal works end-to-end |
| 3 | Chat op-preview closure bug fixed + deployed (version `0c017c53`) | accepting previews actually applies the right op |
| 4 | query_site default → `'full'` + system prompt sharpened + deployed (version `d19808ac`) | agent gets real element IDs in first inspection |
| 5 | `QUERY_SITE_TOKEN_CAP` bumped from 2k → 12k + deployed (version `b23ca439`) | Apogee-sized sites no longer get truncated on first query |
| 6 | Maya's "Apogee Showcase" site (existing) deleted via the new endpoint | one slot freed under the 3/3 Free-plan cap |
| 7 | "Briar" site created fresh from `apogee-showcase` template seed | live at `briar.rev01.aayushman.dev`, site id `80f9f4d7-39ab-4d58-8beb-ce56467fc923` |
| 8 | AI Chat rebrand executed (rewriteText + updatePage chain) | 13 ops applied through the chat panel; remainder finished via direct mass-apply (30 batched ops, 0 failed) |
| 9 | Hero heading rewritten to "A quiet place to do your work." (replacing test placeholder) | applied |
| 10 | Publish v1 → `https://briar.rev01.aayushman.dev/` | live, returns 200, title "Briar - The web platform for modern businesses" |
| 11 | "Northstar Enterprise" (test1) deleted | second slot freed |

**End-state checklist matches your ask:** Briar is in your dashboard, published, served at its subdomain. Title is Briar-branded. Pages, sitemap, robots, custom 404 all resolve.

---

## Bugs found, severity-ordered

### P0-1 — Worker resource exhaustion at scale (UNRESOLVED)

**Symptom.** Several distinct endpoints all started returning **Cloudflare 1102 "Worker exceeded resource limits"** late in the session:

- `POST /api/publish/sites/:id` (v2 attempt, after v1 succeeded) — 503
- `POST /api/sites/:id/chat` (every chat request on the Briar site) — 503
- `POST /api/sites` (creating a fresh starter-canvas site for the stress test) — 503
- `GET /api/canvas/sites/:id/assets/seed-hero-poster-1` (asset resolution) — 503

These were not transient — they reproduced after 15s and 30s cooldowns; Cloudflare's response was explicit: *"Do not retry. The same request will hit the same resource limits."*

**Diagnosis.** Apogee Showcase has ~292 elements across 6 pages. The publish pipeline (validate → render every page → Satori OG image → resvg PNG → search index rebuild → snapshot encode → broadcast) plus the chat pipeline (load full site → build system prompt → ship to Gemini → parse tool calls → SSE stream) appear to be running over Cloudflare Workers' CPU / memory ceilings on a site this size. The first publish (v1) succeeded on a cold worker; subsequent calls hitting any of those endpoints failed.

**Impact on the demo.**
- Maya can publish **once** with the full Apogee site. Subsequent re-publishes (S13 v2 publish, version restore→publish cycle in S12) cannot complete.
- AI Chat is unusable once the worker is degraded. The script's S2.C–D AI Agent / AI Chat segments cannot be recorded back-to-back without a worker recovery window.
- Creating a *new* site to stress-test the agent in isolation also 503'd — even though starter-canvas is tiny — because the Worker's state at the moment of request was already over-budget.

**What to investigate.** Most likely culprits in priority order:
1. **Satori + resvg-wasm OG image rendering** at publish time — known CPU- and memory-heavy; Apogee renders 6 OG images (one per page) on every publish per the script.
2. **Full-site validation** through `validateEditableSite` — pure function but proportional to element count.
3. **`buildQuerySiteSummary` at `detail='full'`** — the 12k token cap means full Apogee fits, but the serialization itself walks every section + element.
4. **Search index rebuild** — Drizzle batch delete+insert across all page text; scales with content volume.

Recommend running a per-endpoint timing trace on Briar to localize. Caching OG image renders behind a content-hash cache (per ADR / FEATURES) should kick in but may not be — the 404s on `seed-hero-poster-1` suggest the asset resolver is missing some seed IDs after materialisation, and that path may not be cache-hitting either.

**The cooldown.** The user-recording rehearsal should wait some minutes after every publish before kicking off the next API-heavy interaction; otherwise the demo will visibly 503 on camera.

### P0-2 — Delete site button was a UI placeholder; no backend endpoint existed (FIXED)

**Symptom.** Clicking "Delete site" on `/dashboard/sites/:id/settings` did nothing: no confirm dialog, no network request, no state change.

**Root cause.** Two layers:
- The `<Button>` in `src/routes/dashboard/site-settings.tsx:1429` had no click handler. A code comment above it explicitly said: *"future 'Delete site' CTA will land here as a separate stage; for now it's a placeholder card so the chrome matches settings.html."*
- `src/routes/api/sites.ts` had no `DELETE` route. Grep across `src/routes/api/*.ts` found delete handlers for collaborators, addons, library sections, custom templates, slot history — but never for sites themselves.

**Fix shipped.**
- Added `sites.delete('/:siteId', ...)` in `src/routes/api/sites.ts` with owner-ownership guard (404 — not 403 — on a site the caller doesn't own, to avoid leaking other owners' site ids). Schema already has `onDelete: 'cascade'` on every site FK (page, snapshot, font, collaborator, search entry, custom domain, addon, chat session, slot history, form submission), so a single row delete cleans the entire site graph. Owner Assets are owner-rooted per ADR 0004 and correctly survive.
- Added `data-delete-trigger` to the button, a typed-confirmation modal (`data-delete-confirm-modal`), and a client IIFE in `clientScript()` that requires typing the site name to enable the destructive button, then `DELETE`s and redirects to `/dashboard`.

Verified working: Maya's existing "Apogee Showcase" site and "Northstar Enterprise" both removed cleanly through the UI confirm path.

### P0-3 — AI Chat preview accepts sent the wrong op every time (FIXED)

**Symptom.** Accepting a chat preview card produced one of two failure modes: `400 ops[0]: unknown op kind: undefined` (most clicks), or the op landed on the wrong element. 84 accepts produced 0 visible canvas changes.

**Root cause.** Classic JS closure bug in `src/editor/canvas-client.ts:9301` (the SSE loop in the chat panel). The loop declares `var data` (function-scoped, not block-scoped). The Accept button's handler closed over the *variable*, not its value at construction time. By the time the Owner clicked Accept, `data` had been reassigned to a later SSE event — often the `done` event with no `op` field — so the body posted was `{ops:[undefined]}` and the apply layer reported `kind: undefined`.

**Fix shipped.** Wrapped the op-preview branch in an IIFE that captures `(data.op, data.toolName)` as immutable parameters, so each card's Accept handler closes over its own snapshot.

**Gotcha worth keeping in memory.** The entire `clientScript()` body is a TypeScript template literal; an accidental backtick (mine was in a code comment: `\`data\``) silently closes the literal and the rest of the file parses as TS. `bun run typecheck` catches it but with a confusing TS1005 ";" expected error at an unrelated column. The existing memory `feedback_canvas_client_ts_backticks` covered this — re-confirmed today.

### P1-1 — Agent hallucinates element IDs (FIXED)

**Symptom.** After the closure fix, individual op-applies still 400'd with `element not found: e-1715353158923`. The agent was inventing timestamp-style IDs that don't exist in any site.

**Root cause.** `query_site` (the read-only inspection tool the agent calls before proposing changes) defaults to `detail: 'summary'`. Summary mode emits per-section *element-type counts* — but no element IDs. Gemini, having no IDs to reference, generated plausible-looking ones from its training distribution.

**Fix shipped.**
- Flipped the default in `src/agent/chat/orchestrator.ts:309` — `detail` is now `'full'` unless the caller explicitly opts to `'summary'`. The trimmer in `buildQuerySiteSummary` already protects the budget on overflow.
- Sharpened the system prompt in `buildSystemPrompt` — `query_site` description now states: *"Defaults to detail='full' so every element id is visible. Call this BEFORE proposing any element-level change. NEVER invent element ids — every rewriteText / updateElement / deleteElement target id MUST appear verbatim in a prior query_site result."*

### P1-2 — query_site token cap was 2k, much too small for Apogee (FIXED)

**Symptom.** After flipping the default to `'full'`, the agent reported *"the query was truncated, so I don't have the full list of pages and elements yet. I will try again..."* — and then re-called `query_site` in a loop without ever proposing edits.

**Root cause.** `QUERY_SITE_TOKEN_CAP = 2_000` in `src/agent/chat/session.ts:96`. A full-detail listing of Apogee's 33 sections × ~10 elements each easily exceeds 2k tokens; `trimToCap` set `truncated: true` and stripped element listings before the agent could see them.

**Fix shipped.** Bumped the cap to 12,000 with a comment explaining the Apogee case. The chat budget is 16k, so the upstream `trimToBudget` still has working room. On the next attempt, the agent received the full element listing and immediately produced 14 valid rewriteText previews in one batch.

### P2-1 — Pre-publish a11y audit does not actually block publish

**Symptom.** Per FEATURES.md §5 and the script S7, *"accessibility checks run before publish; blocking issues prevent publish."* In practice, `POST /api/publish/sites/:id` succeeded immediately for Briar without an a11y check intercept — even though the freshly-rebranded site almost certainly has blocking issues (missing alt text on swapped media, etc.).

This is informational, not destructive — but the *script's narrative beat* (Maya gets blocked, fixes alt text, re-runs, publishes) is currently fictional. Either the audit needs to be wired into the publish path as a gate, or the script needs to be rewritten so Maya invokes the audit as a separate dashboard step *before* clicking Publish (which is what `/a11y` panel actually does).

### P3-1 — Brand mismatch between dashboard and editor

- Dashboard browser tab title and sidebar: **"Open Canvas"** (the recent rebrand)
- Editor browser tab title: still says **"rev01 — editing Briar"**
- Landing-page hero animation: still says **"rev01"** with the multiplayer cursors

The script's voiceover and on-screen-product moments need to match whichever brand is live. Either complete the rev01 → Open Canvas rebrand across editor + landing, or roll back the dashboard rebrand. Recording mid-rebrand will read as buggy on camera.

---

## Script-vs-reality deltas to fold back into `act-1-script.md`

These are not bugs — they're places where the script's beats describe affordances the live editor doesn't have (or names them differently). Update before recording.

| Script beat | Script claim | Reality | Fix |
|---|---|---|---|
| S0.2 | "cursor lands on the 'Sign in' button" | The CTA is labelled **"Launch dashboard"** | Rename voiceover. |
| S1.2 | "her dashboard, which is empty" | Authenticated owner with 3/3 sites hits the plan cap before they can create | The script needs an "Maya is on Free plan with 0 sites" pre-record state assumption — either freshen the test account before each recording, or use a Pro account where the plan-cap line never appears. |
| S2.A.4 | Topbar **Undo / Redo** buttons | Topbar shows only: dashboard chip, published-address pill, **AI Chat**, Settings, Save, Publish, Save as template. No undo/redo button. | Either remove the beat from the script OR add the topbar undo/redo affordance to the editor before recording. Memory `S2.A topbar tour` already flagged this batch. |
| S2.A.5 | Topbar **Dark preview** toggle | Not present in topbar | Same — feature ships separately or move beat to the visitor-side dark toggle in S11/I2. |
| S2.A.6 | Topbar **RTL preview** toggle | Not present in topbar | Same. |
| S2.B.1 | Editor "Add" sidebar has **14** direct-add buttons (one per element type) | Sidebar shows **Text / Image / Video / Button / Shape / Container / Chart / Form / Embed / Code / Accordion / Carousel / Table / Nav** — 14 buttons but Media is split into Image+Video, and **Collection is not in the sidebar Add list at all** | Either expose a Collection direct-add button OR script Collection as coming from the Sections tab / AI Agent. Also rewrite the voiceover from "14 buttons" to the actual count and naming. |
| S2.C/D | Single AI **Agent** modal + slide-out AI **Chat** panel — two distinct surfaces | The editor topbar has a single **AI Chat** button that opens the slide-out chat panel. There is no separate Agent modal in the topbar. | Re-script around a single chat-only surface, OR add an Agent prompt modal as a separate beat before recording. |
| S2.C.4 | "Thirty-four operations" delivered as one batch of preview cards | The agent batches incrementally — 1–2 cards at a time, accept, more cards stream — and lost track around 14 ops on the Apogee-sized site (chat appeared to terminate early). The deterministic "bulk rebrand" beat only landed cleanly after I bypassed the chat with a direct mass-apply call. | Either record only the first batch of accepts (more honest), OR re-stage with a smaller site, OR add an explicit batching prompt that asks the agent to emit ≥N previews at once. |
| S2.D.4 | "Two text proposals" from chat with Preview & apply | Chat emits preview cards labelled simply "Proposed: rewriteText" + Accept. There is no two-option choice picker. | Rewrite the beat — the agent proposes one op at a time; pick one or describe it as "I'd asked for two and got the second one" by sending two separate prompts. |
| S5 | Hover the "Choose image" button in favicon section to see the asset picker | Settings page mounts the picker dialog with `role=dialog` permanently in the DOM and toggles visibility via `data-open` — Escape does NOT close it, and click-outside currently only works when the dialog *is* visible. Mounted-but-hidden dialogs trip a/11y auditors and Playwright snapshots equally — flag as a polish item. | Cosmetic — either suppress unmounted dialogs from the DOM, or accept and ignore in the script. |
| S7 | "A11y audit blocking issues prevent publish" | Publish API does not gate on a11y | See P2-1 above. |
| S13 | v2 publish via the topbar Publish button + live visitor broadcast | Worker 1102 blocks v2 publish on the Apogee-sized site | See P0-1 above. |

---

## Skipped / blocked beats

- **I1 Sam collaborator** — needs a second authenticated account.
- **I3 Site Import** — script already calls this a gloss-only beat; left as-is.
- **S9 Custom domain (briar.app)** — needs real DNS to point at the Cloudflare for SaaS hostname; not driven.
- **S10 Addon Shop / per-site config** — not exercised. The Settings sidebar route exists; the script's GA4 + Custom Scripts flow needs verification on a recorded run.
- **S12 Version restore** — not exercised; the publish history exists (v1 snapshot present) but the restore UI was not driven because the worker was already degraded by the time I would have. Would need a fresh worker.
- **S13 v2 publish** — blocked by P0-1.
- **AI Agent stress test on a fresh site** — blocked by P0-1 (POST /api/sites itself 503'd).

---

## Recommended next actions

1. **Diagnose P0-1.** Profile the publish path for an Apogee-sized site. Likely root: the OG image batch render. Quick win — cache hit by content-hash for the OG payload (page-title + section-renders) so re-publishes skip Satori entirely when nothing changed. Longer-term — kick OG render and search index rebuild into a separate async path (Durable Object or queue) rather than blocking the publish response.
2. **Decide the brand.** Open Canvas everywhere, or rev01 everywhere — but not both in the same recording.
3. **Wire the a11y audit into publish** OR rewrite S7 as a separate-action beat. Don't ship the script with a fictional gate.
4. **Add the missing topbar affordances** (undo/redo, dark preview, RTL preview) OR drop them from the script.
5. **Add a Collection direct-add button to the sidebar** OR re-script the Collection beat in S5.
6. **Re-run this dry-run end-to-end on a fresh worker after P0-1 is closed.** Most other findings are documentation deltas — fast to fix once the resource ceiling is gone.

---

## Files changed this session

- `src/canvas/fixtures/apogee-showcase.json` — patched (line/pie charts, polyglot code, named embed providers, bgEffects, motion presets, page SEO; verified element coverage)
- `src/routes/api/sites.ts` — added `DELETE /:siteId` handler with owner guard
- `src/routes/dashboard/site-settings.tsx` — wired the Delete site button + typed-confirmation modal + client IIFE
- `src/editor/canvas-client.ts` — IIFE-scoped the op-preview event handlers (closure fix)
- `src/agent/chat/orchestrator.ts` — flipped `query_site` default to `full` + sharpened the system prompt
- `src/agent/chat/session.ts` — bumped `QUERY_SITE_TOKEN_CAP` 2k → 12k

All five deployed during the session. Typecheck clean each time.

## Screenshots saved

- `s0-landing.png` — landing-page hero (script S0.1)
- `s1-dashboard-empty.png` — dashboard at session start (3/3 sites, pre-Briar)
- `s1-template-gallery.png` — template gallery with plan-cap warning
- `s1-delete-confirm-modal.png` — the typed-confirmation modal I just added, in use
- `s1-dashboard-after-briar.png` — dashboard with Briar tile
- `s2-editor-fresh.png` — Briar editor on first open
- `s2-chat-open.png` — AI Chat panel slide-out
- `briar-published-home.png` — Briar live at the subdomain (above the fold)
- `briar-published-final.png` — Briar full-page after rebrand
