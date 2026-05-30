# Handoff — delta-resolution sweep (revised 2026-05-30)

**Framing — read this first.**

The recording script is the **intended UX**. Default action for every delta is **product-fix**: the product should evolve to match the script.

A delta becomes a **script-rewrite** only when the product evolution is genuinely intentional — e.g. the kit count grew, variant names were renamed in code, a guard rail was deliberately added, or the script carries an internal numbering inconsistency that's never been resolved.

If you can't articulate *why* the script's UX is wrong, treat the delta as a product gap.

---

**Date:** 2026-05-30 (revised, replaces earlier biased version)
**Source-of-truth UX:** [docs/demo/act-1-script.md](act-1-script.md)
**Evidence trail (re-verify every claim here):** [docs/demo/drive-2026-05-29-pass-5-findings.md](drive-2026-05-29-pass-5-findings.md) — Playwright per-beat table, Passes 5 + 6
**Chronological deltas log:** [docs/demo/script-deltas-2026-05-29.md](script-deltas-2026-05-29.md) (Passes 1–6)
**Latest deploy:** version `59494fc8` (commit `a88933a` on `origin/main` at time of writing — implementation pass below has landed further commits on `origin/main` that require a fresh deploy to go live)

---

## Implementation status (2026-05-30 pass, post-rewrite)

All §3 product-backlog items below were addressed in a single implementation pass that landed 14 ADRs (0028–0042) on `origin/main`. Status per item:

| Handoff item | ADR | Status |
|---|---|---|
| §3.1 Page background colour picker | [0028](../adr/0028-page-background-colour-picker-verification.md) | Accepted — `buildColorRow` hoisted to module scope + wired to page-bg field. Hex-only (loses `transparent` / named colors); noted in ADR decision 4. |
| §3.2 Custom-404 toggle on page inspector | [0029](../adr/0029-custom-404-toggle-on-page-inspector.md) | Accepted — toggle at top of `renderPageInspector`; always-confirm modal on demotion. |
| §3.3 Audit button rename `Re-run check` → `Run audit` | [0030](../adr/0030-audit-button-label-run-audit.md) | Accepted — single-string rename. |
| §3.4 Audit score handling | [0031](../adr/0031-audit-numeric-score-handling.md) | Accepted with decision **hide the score**. Rubric was broken on its own terms (2 blockers + 0 warnings scored 60; 1 blocker + 8 warnings scored 40, the latter is worse despite being closer to publishable). Ring fill + headline + per-finding rows stay; digits removed. Script S7.A.1 stays silent on the score. |
| §3.5 CSV per-row icon on top-level Forms inbox | [0032](../adr/0032-csv-export-at-top-level-forms-inbox.md) | Accepted — per-row SVG download icon hits the existing per-form CSV endpoint. |
| §3.6 G6 — section inspector fields | [0033](../adr/0033-section-inspector-fields-for-role-bgeffect-entrance-bgvideo-popup.md) | Accepted — Identity / Background / Motion / Behaviour groups added above the existing action buttons. |
| §3.7 G7 — `+ New Page` modal | [0034](../adr/0034-new-page-modal-with-title-slug-locale.md) | Accepted — modal collects title / slug (auto-derives) / locale (top-10 BCP-47 + Site default + Other escape). Reserved-slug pre-validation; duplicate-slug pre-validation. |
| §3.8 G8 — visitor dark-mode 3-way picker | [0035](../adr/0035-visitor-dark-mode-three-way-enum.md) | Accepted — schema field renamed `darkModeEnabled` → `visitorTheme` enum (`light` / `dark` / `toggleable`); hard-cutover Drizzle migration `0012_visitor_theme_enum.sql`; UI replaced with 3-way radio. |
| §3.9 G10 — per-page password gate scope | [0036](../adr/0036-per-page-password-gate-scope.md) | **Rejected** — per-page scope not justified given the draft / unpublish primitive already covers the use case. Site-wide stays the only mechanism. Script S11.B + I5 record against the site-wide gate. |
| §3.10 S11.M account meters | [0042](../adr/0042-account-page-metering-only.md) (supersedes [0037](../adr/0037-account-page-billing-surface-pre-billing.md)) | Accepted — Account page reshaped to Usage (Sites + Storage meters) + Notifications + Account profile. Plan tiles, invoices, "Coming soon" alerts stripped per the Owner directive "im not implementing billing at all just metering." |
| §3.11 S12.F snapshot preview iframe | [0038](../adr/0038-snapshot-preview-iframe.md) | Accepted — verification confirmed the feature already ships end-to-end (`renderSnapshotPreview` at `src/version/preview-render.ts:55`, sandboxed `srcdoc` iframe at `version-timeline.tsx:291-295`). ADR ratifies the existing implementation; no new code. |
| §3.12 A11y link in editor header | [0039](../adr/0039-a11y-link-in-canvas-editor-header.md) | Accepted — `<a id="canvas-a11y-link">` between Settings and Save in the editor header; same-tab nav to `/dashboard/sites/{id}/a11y`. |
| §3.13 Canonical URL fixture-fix | [0040](../adr/0040-canonical-urls-from-host-config.md) | **Hot-fix shipped, structural fix Proposed.** Five `apogee.rev01.aayushman.dev` → `opencanvas.aayushman.dev` literals replaced in `apogee-showcase.json`. The ADR's structural decisions ({{APEX}} placeholder + loader substitution + boot-time check) stay Proposed for a follow-up implementation pass. |
| §3.14 OG-image fresh render per page | [0041](../adr/0041-og-image-fresh-render-per-page.md) | Accepted — three `ogImageAssetId: "seed-feature-canvas-1"` entries removed from the Apogee fixture; `resolveOgUrl` falls through to the existing `/og/{siteId}/{slug}.png` generator path. |

The §3 product backlog below is preserved as the original framing record. Per-row status is in the table above; do NOT re-implement closed items.

Pass-7 reset checklist (§4) and external prereqs (§5) remain unchanged.

---

## 1. Cheap-five fixes already shipped — DO NOT redo

Six product gaps closed in the May 28–29 sprint. The script needs small alignment edits to reflect the shipped state, nothing more. Do not re-open the underlying product work.

| Cheap-five gap | Shipped by | Script-edit needed (intentional, small) |
|---|---|---|
| Gap 1 — `_404` rename had no reserved-slug guard | guard in `canvas-client.ts renamePage` | **S4.F.1** — rewrite to "rename flashes `Slug 404 is reserved`; no Ctrl+Z needed" |
| Gap 3 — Save to library / Save as template modals only had `name` | Pass-5 modal expansion | **S6.F.1, S6.G.1, S13.E.1** — modal shows name + description + visibility. Owner can pick Private; Community requires admin (server returns 403). |
| Gap 4 — no TOC chip row in Settings | Pass-5 sidebar work | **S11.G.1** — rewrite "no TOC chip row" → seven chips across the top: `Hosting / Password / Search engines / Favicon / Dark mode / Collaborators / Delete site` |
| Gap 5 (a) — no version badge in editor header | Pass-5 header chip | **S7.G.1 + S10.H.1 + S13.C.1** — restore the `v0` (draft) → `v{n}` (published) flip beat |
| Gap 5 (b) — no OG preview pill | Pass-5 header chip | **S7.H.1** — restore "click the version badge → preview pill" beat (see caveat in §3 product backlog: OG fixture leak) |
| Pass-5 hex inputs (kicker pinned colour) | Pass-5 SELECTION-panel work | **S3.D.1** — voiceover/wording already aligns; no further edit needed. Listed for paper trail. |

---

## 2. Script-rewrite — other intentional product evolution

Small list. These are deltas where the product is the canonical state and the script narrative needs to catch up. Not driven by Cheap-five.

1. **S3 frontmatter + S3.A.1 + S3.A.2** — six built-in kits (charcoal, orange-editorial, blue-saas, green-organic, **ivory-press**, **midnight-violet**) per commit `73920d1`. Briar's seed kit is `blue-saas` (the Apogee Showcase fixture's actual seed), not `custom`. Cycle all six in the on-screen action.
2. **S3.A.3** — drop entirely. There is no Custom kit any more; the "Apogee shipped with a custom kit" beat is dead narrative after the six-kit reorg.
3. **S5.A.1 + S5.S.1** — pick **"sixteen entrance presets + `none`"** and apply consistently. Dropdown has 17 values including `none`; the script previously said "17 motion presets" in S5.A.1 and "sixteen entrance presets" in S5.S.1.
4. **S5.D + S5.E shape and container variants** — Pass-6 verified script already matches the live variants (`rect / pill / circle / line / badge / blob` and `flat / raised / glass / outlined / sticker / editorial-frame / soft-panel`). Confirmation only; no edit required.
5. **S5.N chart-kinds order** — borderline. Code is `bar / line / pie / donut / area`; script cycles `donut → pie → bar → line → area`. Either order cycles the same five kinds. Camera-direction call only; product not affected. **Recommendation:** leave script as-is unless the recording operator prefers code-order.

---

## 3. Product backlog — script stays; product catches up

Each item below: the script's UX is the target. The product is currently wrong. Land the fix before the recording, or accept that beat won't record cleanly.

### Cosmetic / mechanical fixes (small, fast)

1. **Page background colour picker** (S3.E.1) — script wants "pick warm cream"; product currently exposes a CSS hex text input on `/blog`'s page background. Mirror the Pass-5 Gap-7 hex-input pattern on the style-row: grow a swatch picker on the page background field.
2. **"Set as custom 404" toggle on page inspector** (S4.E.1) — script wants a visible toggle on `_404`. Currently the slug `_404` is the implicit-only mechanism (custom-404 is slug-based per `src/canvas/page-routing.ts CUSTOM_404_PAGE_SLUG`). Surface a `Set as custom 404 page` toggle in the page inspector body so the script's "toggle, already on" beat plays cleanly.
3. **Audit button rename**: `Re-run check` → `Run audit` (S7.D.1) — script wants "Run audit"; live button reads "Re-run check". One-string rename in the a11y audit page UI.
4. **Audit score handling** (S7.A.1) — audit page renders `50 / 100` for Briar's current state. **Decision: hide the score in the audit UI.** Rationale lives in [ADR 0031](../adr/0031-audit-numeric-score-handling.md): the rubric is broken on its own terms (1 blocker + 8 warnings scores 40, 2 blockers + 0 warnings scores 60 — second worse despite being further from publishable), the ring fill + per-finding rows already convey the trend without false precision. Script S7.A.1 stays silent about the score; no voiceover line, no on-camera narration of the number.
5. **CSV export at top-level forms inbox** (S8.B.1) — script's flow is `S8.A.1` (top-level inbox row from I2) → `S8.A.2` (expand row, full submission) → `S8.B.1` (Export click *at top level*). Currently CSV lives only on the per-form page. Add a per-row CSV icon to the top-level inbox so the script's flow plays without re-routing through `/forms/{formId}`.

### Medium-five product gaps (already triaged, still real)

6. **G6 — section inspector fields** (S5.P / S5.Q / S5.R) — surface `role` / `backgroundEffect` / `entrance` / `backgroundVideo` / `popupTrigger` in a section inspector body. Pattern to mirror: `buildTextInspector` at `canvas-client.ts:2877`. Without this, S5.P/Q/R stay voiceover-only.
7. **G7 — + New Page modal** (S4.A.1 + I4.B) — `+ New Page` currently creates `Page N` instantly. Script (and I4.B as originally written) wants name / slug / locale prompts in a modal. Without this: I4.B has to be the rename-then-SEO flow.
8. **G8 — visitor dark-mode 3-way picker** (S11.D) — schema is `bool` today; script wants `Light / Dark / Toggleable`. Without this: S11.D stays as single ON/OFF checkbox.
9. **G10 — per-page password gate scope** (S11.B + I5) — schema is site-wide today; script wants per-page (`/preview` only). Without this: S11.B + I5 rewrite to site-wide, and I5.A.1 visitor flow targets the site root instead of `/preview`.

### Earlier-pass items still open

10. **S11.M account meters** — script wants Free/Pro/Team plan tiles + usage meters + invoices on the Account page. Product currently exposes profile-only (display name + email Clerk-managed, bio, timezone, site count, Sign out). Build the billing UI to match the script.
11. **S12.F snapshot preview** — script wants an in-iframe sandboxed snapshot preview before Restore. Each timeline row currently shows only `Restore`. Add a per-row preview iframe so Maya can scrub before restoring.
12. **A11y link in editor header** (S7 entry beat) — currently the audit is only reachable via `/dashboard/sites/{id}/a11y` (dashboard sidebar). Add an `A11y` link to `#canvas-editor-header` alongside Settings so S7 enters cleanly from the editor without a dashboard detour.
13. **Canonical-URL fixture-fix** — `src/canvas/fixtures/apogee-showcase.json` still emits canonical URLs at `apogee.rev01.aayushman.dev` (pre-apex-migration). Search/replace canonicals to `opencanvas.aayushman.dev`. ~30 minutes; not a UX change but a meta-tag correctness fix that affects every published page from the Apogee Showcase template.
14. **S7.H OG-image fixture leak** — same fixture, related symptom. Published `og:image` points to `/assets/seed-feature-canvas-1` (Apogee seed) rather than a freshly-rendered Briar OG PNG. Fix: render a real OG PNG per published page and store it as `og:image`. Without this: the preview pill demo shows the fixture image, which is acceptable but worth a voiceover line.

---

## 4. Pass-7 reset-Briar checklist

Before the next drive, reset Briar so the script can record from a clean state. The agent / recording operator running Pass-7 should confirm each item is true before the drive starts.

- [ ] **Hero video alt text stripped** — re-introduce the S7 blocker so the publish gate has something to flag and Maya has something to fix on camera. Target element: hero `video` on `/index`.
- [ ] **2–3 manual snapshots saved** — so S12 restore has timeline depth and the pre-restore safety snapshot is the visible "+1" row. Label them with dates that read cleanly on camera (avoid timestamps that look like the current recording day).
- [ ] **"Apogee" text un-rebranded on `/index`** — S2.C bulk rebrand starts from this state. Reset header, hero, pricing, customer carousel, and footer copy back to Apogee phrasings so the AI Chat rebrand has something to do on camera.
- [ ] **Hero kicker has no pinned colour** — S3.D demos pinned-style from a clean state. Clear any pinned hex on the kicker text element so the demo of "type `#c75d3d`, then cycle kits, then watch the pin survive" plays cleanly.
- [ ] **Second Clerk account + clean-cookie browser profile ready** — for I1 (Sam collaborator accept), I3 (visitor first visit), S9 (custom-domain on-site editing). Separate browser profile, no edit-token cookie, magic-link inbox accessible on a second monitor.

---

## 5. Blocked on external prereqs (no script rewrite or product fix unblocks these)

- **I1 + S9 + I6** — Clerk webhook for invite acceptance, real Replicate API outputs in S3, email delivery on `noreply@opencanvas.aayushman.dev` (Resend verified). All three need their external service running; no script change unblocks them.
- **S3.G AI image gen** — requires real Replicate calls. Pre-recorded clip OR delete the beat.
- **S3.I custom WOFF2 font upload** — requires a font file on the recording machine + the upload route working end-to-end. Untested live this pass.

---

## 6. What NOT to do

- Don't re-introduce script changes for Gap-1 / Gap-3 / Gap-4 / Gap-5 — those are already resolved in product.
- **Don't rewrite the script to match product gaps.** The script is the source of truth for intended UX. Product catches up. The exception is the §2 list — small, justified script edits where the product evolution is intentional.
- Don't touch `apogee-showcase.json` outside the canonical URLs without checking the kicker / brand text still survives the S2.C rebrand flow. The kicker reads "Apogee AEO" because the recording rebrands it on camera; leave that string alone.
- Don't add new beats to the script for product-backlog items above without first asking whether the product fix is landing first.

---

## 7. Companion files

- **Recording script** (UX source of truth): [docs/demo/act-1-script.md](act-1-script.md)
- **Playwright Pass-5 + Pass-6 evidence** (re-verify every claim): [docs/demo/drive-2026-05-29-pass-5-findings.md](drive-2026-05-29-pass-5-findings.md)
- **Chronological deltas log Passes 1–6**: [docs/demo/script-deltas-2026-05-29.md](script-deltas-2026-05-29.md)
- **Pass-4 handoff** (still useful for items not yet absorbed): [docs/demo/handoff-2026-05-29-pass-4.md](handoff-2026-05-29-pass-4.md)
