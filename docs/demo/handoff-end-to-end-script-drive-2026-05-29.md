# Handoff — end-to-end script drive on opencanvas

**Date:** 2026-05-29
**Branch:** main
**Repo:** `C:\Repo\rev01`
**Prod:** `https://opencanvas.aayushman.dev` (deployed CF Worker, current version `f49138d3-8e42-44f1-83d8-f21b91d0f31e`)

## Why this handoff exists

The Open Canvas rebrand has cut over and the demo's recording-blockers (P0-1 worker 1102, Clerk sign-in across the new apex, custom-branded `/auth` surface, DELETE site handler) are all closed. The script at [`act-1-script.md`](act-1-script.md) has been updated against the [decisions punch list](script-deltas-2026-05-29.md).

**What's left before the camera rolls: drive the script straight through against prod and report any beat that doesn't match.** This handoff is the action queue for that pass.

## Canonical artifacts to read first

| Path | What it is |
|---|---|
| [`act-1-script.md`](act-1-script.md) | Updated demo script. Sessions 0–2 fully drafted, S3–S12 stub-only ("Beats:" sentences). Domain references switched to `opencanvas.aayushman.dev`, S2.A topbar trimmed to match reality, S2.C/D collapsed into single AI Chat surface, S5.R popup rewritten to live-add, S0/S0.2/S0.3 CTA renamed to "Launch dashboard". |
| [`script-deltas-2026-05-29.md`](script-deltas-2026-05-29.md) | The decision log. Every row that was applied is marked with its recommended call. **Rows marked S7, I1, S9, S10, S11, S12 still require external prerequisites — see "Skipped beats" below.** |
| [`dryrun-report.md`](dryrun-report.md) | The original 2026-05-29 morning dry-run report. Largely superseded but the bug ledger is useful context. |
| [`feature-coverage.md`](feature-coverage.md) | Per-feature ledger linking script beats to FEATURES.md sections. |

## State of prod (current)

- **Apex:** `opencanvas.aayushman.dev` (custom domain) + `*.opencanvas.aayushman.dev/*` (wildcard) — see [`wrangler.toml`](../../wrangler.toml).
- **Clerk:** LIVE instance, frontend API at `clerk.aayushman.dev`, portal at `accounts.aayushman.dev`. Both have valid CNAMEs at `frontend-api.clerk.services` / `accounts.clerk.services` and provisioned SSL. Publishable key rotated to encode `clerk.aayushman.dev`.
- **Sign-in:** custom OC-branded `/auth` surface at [src/auth/sign-in-route.tsx](../../src/auth/sign-in-route.tsx) — `requireAuth()` redirects unauthed page navigations there ([src/auth/require-auth.ts](../../src/auth/require-auth.ts)). Widget loads, tabs switch cleanly between Sign in / Create account, "Secured by Clerk" badge sits as a muted footnote.
- **`wrangler.toml [vars]`** committed with the canonical opencanvas values; every plain `wrangler deploy` carries them. Don't deploy without the var block.
- **Owner account:** `kremzylo@gmail.com`, signed in via Google OAuth, currently owns 2 sites (Briar at `80f9f4d7-39ab-4d58-8beb-ce56467fc923` + Meridian Studio at `ee1eccda-6a5f-4ecf-9105-89b6c76426dd`). Free plan, 2/3 sites.

## Recent commits that affect the script drive

| Commit | What it changed | Recording impact |
|---|---|---|
| `16cea24` | OG content-hash memo cache | publish CPU bounded; concurrent publishes safe |
| `deb3b17` | publish defers side effects via `c.executionCtx.waitUntil()` | response returns ~2.5s; OG + search + version timeline + broadcast run in background |
| `f727ae2` | host-config env vars to `wrangler.toml [vars]` | every deploy carries `APP_DOMAIN` / `AUTHORIZED_PARTIES` / `COOKIE_NAME_PREFIX` / `EMAIL_FROM` |
| `b6574ad` | `CLERK_FRONTEND_API_URL` override in require-auth | server-side sign-in URL no longer derived from stale publishable key |
| `bd1f91c` | `requireAuth()` redirects to local `/auth` | unauthed users land on the OC-branded sign-in shell |
| `19ffeb8` | `/auth` (no trailing slash) — Hono mount path | trailing-slash form 404s |
| `200c136` | server-resolve clerk-js host in all 4 bootstrap sites | clerk-js bundle URL no longer depends on publishable-key host |
| `d541e6d` | sign-in `mountSignUp` unmount fix + cl-card width + badge placement | Create account tab no longer blank; widget aligned with formcard |
| `94ac1e2` | Secured-by-Clerk badge targeted via anchor href | badge sits as small centred footnote |
| `c6bd62b` | DELETE `/api/sites/:siteId` handler + host-config refactor | dashboard Delete-site button works end-to-end |

## What's drafted in the script (drive these in this order)

- **S0** Cold open — landing page hero with the multiplayer-cursor demo
- **S1** Sign-up + dashboard + template gallery + Apogee pick — fully drafted
- **S2.A** Editor topbar tour — rewritten to match the real header
- **S2.B** Sidebar tabs + film reel + inspector — fully drafted
- **S2.C** AI Chat bulk rebrand (collapsed from "AI Agent modal") — fully drafted
- **S2.D** AI Chat iterative refinement — fully drafted as continuation of S2.C
- **S2.E** Rich text marks — fully drafted

## What's still stub-only (beats: sentences)

S3, S4, S5, S6, I1, S7 (drafted at the bullet level), I2, S8, I3, I4, S9, S10, S11, I5, I6, S12, S13. The deltas doc punts these to a "next pass" — recording operator's call whether the bullet-level beats give the host enough to narrate or whether each session needs a full two-column table first.

## Drive method

Use Playwright (the MCP `mcp__playwright__browser_*` tools) for everything except:
- **Clerk sign-in** itself (you need the user's Google account; ask the user to drive that step or take a screen-share). The browser session persists across `mcp__playwright__browser_navigate` calls so once signed in, all dashboard / editor / API calls work.

For each beat, capture:
- The action(s) taken (URL navigated, element clicked, text typed)
- The observed state (page title, key visible text, network response status, console errors)
- Any divergence from the script — file the row as a delta in a new section of [`script-deltas-2026-05-29.md`](script-deltas-2026-05-29.md)

## Open known issues (not blockers, but worth catching on camera)

1. **"Launch PageProduct" landing card** — [src/landing/components/StatLine.tsx:24-25](../../src/landing/components/StatLine.tsx#L24) renders `<b>Launch Page</b><span>Product</span>` side-by-side because the `.cap` class likely lacks `display: block` / column layout. Renders as a single concatenated word on the landing page. Cosmetic; fix is in the landing CSS file.
2. **Editor CSS class names** still say `rev01-editor` / `rev01-editor-header` ([src/editor/route.tsx:170-171](../../src/editor/route.tsx#L170)). Internal class names, not visible to camera, but a future rebrand cleanup item.
3. **Fixtures with `rev01.aayushman.dev` canonical URLs** — [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) lines 610, 2352, 3448, 4945, 6362 + [src/canvas/fixtures/home.json](../../src/canvas/fixtures/home.json) lines 83, 84. These get baked into published HTML as `<link rel="canonical">` — Apogee-template sites will emit rev01 canonicals. The current Briar site was created from a pre-rebrand fixture; new sites from the Apogee template post-rebrand will still inherit the rev01 canonicals until the fixtures are updated.
4. **Version race in publish.ts** — 5 concurrent POSTs to `/api/publish/sites/:id` all race to `publishedVersion + 1`. Single-publisher Maya never hits this. Future fix: `UPDATE ... SET publishedVersion = publishedVersion + 1 RETURNING`.
5. **Chat concurrency boundary** — per memory `chat-concurrency-boundary`, do NOT fire multiple chat requests in parallel with publish. The recording's sequential single-action use is safe; Playwright stress tests are not.

## Skipped beats — still need work or external prereqs

- **I1 Sam collaborator** — needs a second Clerk-LIVE account in a separate browser profile. The LIVE Clerk instance now resolves cleanly, so this is unblocked technically; just needs the operator to set up the 2nd account.
- **S9 Custom domain** — needs real DNS for `briar.app` (or a sandbox domain) pointed at Cloudflare for SaaS.
- **S10 Addon Shop** — GA4 + Custom Scripts walkthrough not exercised. Surfaces exist; per-control behaviour not driven.
- **S11 Dashboard tour megabeat** — Site Settings, Nav Editor, Account Settings, Dashboard Chat panel. Surfaces exist.
- **S12 Version restore** — Briar has 15+ snapshots in timeline. Restore UI exists; flow not driven.
- **S7 a11y gate** — code already gates publish (memory `a11y-audit-gates-publish`). Drive a deliberate alt-text removal on Briar, confirm 422 + blockers in response, re-add alt, publish for the recording.

## Suggested skills for the next session

- `verify` — drive each session, observe behaviour, report divergence. Bias toward narrating what you see rather than asserting what you expect.
- `grill-with-docs` — for each script-vs-reality delta you find, decide product-fix vs. script-fix with the user one row at a time. The decisions go back into [`script-deltas-2026-05-29.md`](script-deltas-2026-05-29.md).
- `code-review` (low effort) — quick scan of the four "bootstrap clerk-js" sites ([sign-in-route.tsx](../../src/auth/sign-in-route.tsx), [routes/dashboard/index.tsx](../../src/routes/dashboard/index.tsx), [editor/route.tsx](../../src/editor/route.tsx), [routes/public.ts](../../src/routes/public.ts)) for any other in-browser `atob` of the publishable key that would re-introduce the stale-host bug.

## Useful state to know

- Latest deploy: `f49138d3-8e42-44f1-83d8-f21b91d0f31e`
- `wrangler.toml` routes: `opencanvas.aayushman.dev` (custom domain), `*.opencanvas.aayushman.dev/*` (wildcard)
- Briar: `80f9f4d7-39ab-4d58-8beb-ce56467fc923` at `https://briar.opencanvas.aayushman.dev/` — published v9 (rebrand-era), 15+ snapshots in version timeline
- Meridian Studio: `ee1eccda-6a5f-4ecf-9105-89b6c76426dd`
- `*.rev01.aayushman.dev` DNS removed — old share links 404 at DNS. CF Rules to 301 the old apex to the new are NOT in place yet.
- Cron `*/5 * * * *` — custom-domain status poller, very light.

## Uncommitted work in tree (don't trip on it)

- [`docs/demo/`](.) — whole directory untracked, including this handoff, the act-1 script, the dryrun report, the deltas doc, and the diagrams scaffold
- `BUTTONS_GAPS.md` at repo root — untracked, content unknown
- [`src/canvas/fixtures/apogee-showcase.json`](../../src/canvas/fixtures/apogee-showcase.json) — modified (the popup-removal patch from the 2026-05-29 dryrun, never committed)
