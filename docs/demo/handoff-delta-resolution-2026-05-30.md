# Handoff — delta-resolution sweep, starts now

**Date:** 2026-05-30 (early)
**Source-of-truth log:** [docs/demo/script-deltas-2026-05-29.md](script-deltas-2026-05-29.md) (Passes 1–5)
**Latest Playwright trace:** [docs/demo/drive-2026-05-29-pass-5-findings.md](drive-2026-05-29-pass-5-findings.md)
**Latest deploy:** version `59494fc8` (commit `25880ae` — 8 sidebar UX fixes), `e232278` on `origin/main`.

The user wants delta resolution to start in parallel with a Pass-6 manual drive. This handoff is for the **delta-resolution agent**; the Pass-6 driver is a separate work-stream.

---

## Already resolved (do NOT redo)

These were live deltas in earlier passes and have been shipped via the cheap-five and Pass-5 sidebar work — script rewrite still needed but the product side is done.

| Was-delta | Resolved by | Script action |
|---|---|---|
| **S4.F** no reserved-slug check (`_404` rename succeeded) | Cheap-five Gap 1 — guard in `canvas-client.ts renamePage` | Rewrite S4.F.1: "rename flashes 'Slug 404 is reserved'; no Ctrl+Z needed". |
| **S6.F** Save to library has only name field | Cheap-five Gap 3 + Pass-5 hex inputs | Rewrite S6.F.1 to mention description + Private/Community visibility. Live behaviour: Owner can pick Private; Community requires admin (server returns 403). |
| **S6.G** Save as template has only name field | Cheap-five Gap 3 | S13.E.1 + S6.G can now be recorded as written (name + description + Community). |
| **S7.G** no version badge in header | Cheap-five Gap 5 | Restore the "Version badge: v1 → v2" beat (S7.G.1 + S10.H.1 + S13.C.1). Badge text is `v0` (draft) or `v{n}` (published). |
| **S7.H** no OG preview pill | Cheap-five Gap 5 | Restore the "click the version badge → preview pill" beat. **Caveat**: `og:image` still points to the fixture asset (Pass-4 note); the pill displays whatever the page actually publishes. Either accept that the demo's OG card is the fixture image, or do the fixture-fix below. |
| **S11.G** no TOC chip row in /settings | Cheap-five Gap 4 | Restore S11.G.1 "TOC chip row → anchor jump". Chips: Hosting / Password / Search engines / Favicon / Dark mode / Collaborators / Delete site. |

---

## To do — script-only rewrites (cheap; days, not weeks)

The product is correct; the script is wrong. These can be done in one writing sweep.

### Pass-5 batch (new since this evening's drive)

1. **S3.A.2** "Four built-in kits" → "Six built-in kits": charcoal, orange-editorial, blue-saas, green-organic, **ivory-press**, **midnight-violet** (added in commit `73920d1`). Cycle through all six in the on-screen action.
2. **S3.A.3** "Apogee shipped with a `custom` kit" — Briar runs on `blue-saas`. Either drop the beat or (alt: do the fixture fix below).
3. **S3.E.1** "pick warm cream" → "type a warm cream hex (`#f7ede3`)". Page background is a CSS text input, not a colour swatch.
4. **S4.E.1** "the `is 404` toggle, already on" → "there's no toggle; the slug `_404` IS the mechanism". Custom-404 is slug-based (`src/canvas/page-routing.ts CUSTOM_404_PAGE_SLUG`).
5. **S5.A.1 / S5.S.1** motion-preset count: pick **"sixteen entrance presets + `none`"** and use it consistently in both beats. Dropdown has 17 values including `none`.
6. **S3.F / S3.I** Assets and Theme beats: there is no Assets entry and no Theme panel in the canvas sidebar. Either drop the beats or relocate to the element-image-picker / dedicated font upload route.

### Pass-1–4 backlog (still un-rewritten)

7. **S5.D Shape variants** — script says "rectangle / circle / triangle / line / divider / blob"; reality is **"rect / pill / circle / line / badge / blob"**. Update list.
8. **S5.E Container variants** — script says "plain / card / bordered / glass / inset / raised / sunken"; reality is **"flat / raised / glass / outlined / sticker / editorial-frame / soft-panel"**. Update list.
9. **S5.N Chart kinds** — order in script is `donut → pie → bar → line → area`; code's `CHART_KINDS` is `bar / line / pie / donut / area`. Update order.
10. **S7.E.1** drop the "Confirmation modal — first publish — yes" beat. No confirm modal exists.
11. **S7.F.1** status flow — replace per-stage "Snapshot saved → OG rendering → Search rebuilt" with the actual flip `Saved → Saving... → Published v{n}`.
12. **S8.B Export CSV** — split into S8.A.1 (top-level inbox totals) → click into `/forms/{formId}` → S8.A.2 Export CSV link there.
13. **S11.B password scope** — rewrite from "set scope = `/preview` page" to "Set a password — gates the **whole site**". Mirror in I5.
14. **S11.D dark-mode picker** — rewrite from 3-way picker to single ON/OFF checkbox.
15. **S11.M Account meters** — rewrite Free/Pro/Team tiles + meters + invoices out. Account page = display name + email (Clerk-read-only) + bio + timezone + site-count + Sign out.
16. **S12.F Preview snapshot** — drop the "sandboxed iframe preview" beat. Each snapshot row has only Restore.
17. **I2.D dark/light toggle on visitor site** — drop until Settings dark mode is enabled at S11.D (then move I2.D after that beat).
18. **I4.B locale picker at + New Page** — rewrite: "+ New Page creates `Page N` instantly. She renames to `Doha launch`, opens its SEO panel, sets Locale `ar`. RTL flip on save."

---

## To do — product fixes (medium-to-large; gate the recording if not shipped)

Each of these is a real product gap. The script can be recorded only if the gap is closed OR the beat is dropped.

### Big ones (Gap-list medium-five — already triaged)

**G6 — Section inspector fields** (S5.P / S5.Q / S5.R)
- Surface `role` / `backgroundEffect` / `entrance` / `backgroundVideo` / `popupTrigger` in a section inspector body.
- Pattern to mirror: `buildTextInspector` at `canvas-client.ts:2877`.
- Without this: drop S5.P / Q / R or keep them voiceover-only.

**G9 — Editor breakpoint switcher** (S5.I phone-collapse, S6 responsive sweep)
- Add desktop / tablet / phone preview to the editor toolbar.
- Without this: rewrite the responsive flow to use the published site + manual browser resize.

**G7 — + New Page modal** (S4.A.1 surface + I4.B)
- Currently page-create is instant. No name / slug / locale prompt.
- Without this: I4.B has to be the rename-then-SEO flow described in script-fix #18 above.

**G8 — Visitor dark-mode 3-way picker** (S11.D)
- Schema is `bool` today; script wants `Light / Dark / Toggleable`.
- Without this: keep the script-fix #14 rewrite (single checkbox).

**G10 — Per-page password gate scope** (S11.B / I5)
- Schema is site-wide; script wants per-page.
- Without this: keep script-fix #13 (site-wide rewrite).

### Smaller ones

**S7.H OG-image fixture leak**
- Published `og:image` points to `/assets/seed-feature-canvas-1` (the Apogee fixture asset). The version-badge preview pill shows whatever is set.
- Fix: render a real OG PNG per published page and store it as `og:image`. Or accept the demo shows the fixture image and add a voiceover line.

**Canonical leak** (verified Pass 3 + 4)
- Canonical for Briar's index emits `https://apogee.rev01.aayushman.dev/` because `apogee-showcase.json` was not updated for the apex migration.
- Fix: search/replace canonical URLs in [src/canvas/fixtures/apogee-showcase.json](../../src/canvas/fixtures/apogee-showcase.json) to use the live apex (`opencanvas.aayushman.dev`).

**A11y link from editor header** (S7 entry beat)
- Currently only reachable from dashboard `/dashboard/sites/{id}/a11y`.
- Fix: add an `A11y` link to `#canvas-editor-header` alongside Settings. OR rewrite S7 entry as "Maya jumps to the dashboard for a moment to open the audit".

---

## Blocked on external prereqs (cannot script-rewrite around)

- **I1 + S9 + I6** — Clerk webhook for invite acceptance, real Replicate API outputs in S3, email delivery on `noreply@opencanvas.aayushman.dev` (Resend verified). All three need their external service running; no script change unblocks them.
- **S3.G AI image gen** — requires real Replicate calls. Use a pre-recorded clip OR delete the beat.
- **S3.I custom WOFF2 font upload** — requires a font file on the recording machine + the upload route working end-to-end. Untested live this pass.

---

## Recommended action order

1. **Script-only rewrites (#1–#18 above)** — single writing pass on `act-1-script.md`. Half a day. Unblocks recording for everything except the product-gap beats below.
2. **Fixture-fix the canonical leak** — 30 minutes. Avoids the wrong-URL on every published page.
3. **Product fix #1 — G6 section inspector** — biggest unlock for S5.
4. **Product fix #2 — G9 breakpoint switcher** — biggest unlock for S5.I + S6.
5. **Product fix #3 — G7 + New Page modal** — needed for I4.B as originally written.
6. **G8 / G10** — only if you want the script to read exactly as the original I4 / I5 / S11.B / S11.D beats. Otherwise the rewrites above are fine.

---

## What NOT to do

- Don't ship a script change that re-introduces the cheap-five resolutions (the kicker's pinned color survives kit cycle — that's Pass-5-shipped Gap 3 + verified Pass-5).
- Don't touch `apogee-showcase.json` outside the canonical URLs without checking what else references the fixture — the kicker text still reads "Apogee AEO" because the recording flow rebrands it during S2.C, so leave that alone.
- Don't add new beats to the script for the deltas above without first checking whether a Pass-5-resolved item already covers them.

---

## Companion files

- The **Pass-6 driver** continues from where Pass 5 stopped: S5 per-variant cycles + S8–S13. Their handoff is in `docs/demo/drive-2026-05-29-pass-5-findings.md` "Not driven this pass" section.
- The **Pass-5 trace** is the source of evidence for the new deltas — every claim here can be re-verified by reading the per-beat table in `drive-2026-05-29-pass-5-findings.md`.
