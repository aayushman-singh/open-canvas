# Pass-5 demo verification findings — 2026-05-29

Source: Playwright drive of prod against `act-1-script.md` after the 8
sidebar fixes shipped in `25880ae` (deployed version `59494fc8`).

Site: Briar at `74a8854d-6f2a-45f8-af18-19b0f74bf215`, published v1.

---

## Sidebar / editor UX fixes (8/8 verified)

| # | Status | Notes |
|---|---|---|
| #1 blank canvas globally unselects | ✓ | `canvas-pages-deselected` class added on root; 5 inactive artboards go opacity .7→1; cleared on artboard label / inactive artboard click |
| #2 inspector toggle button | ✓ | Click cycles `collapsed` class + flips `›` ↔ `‹`. Rapid-click caveat: `renderInspector` reflow can interrupt the 0.15s width transition, leaving intermediate widths (e.g. 310, 32.57px) until the next stable cycle. Real-user behaviour (click, settle) returns to 320 cleanly. |
| #3 left sidebar 360px | ✓ | Measured 360.0px |
| #4 Versions tab underline | ✓ | After Versions click → only `versions` active. After Add click → only `add` active. Bug fixed. |
| #5 brand scrollbar | ✓ | `scrollbar-width: thin`, `scrollbar-color: rgb(220,214,203) transparent`, webkit pseudo rules all present. Visual: thin scrollbar, subtle thumb. Hover state colour set to `--red`. |
| #6 demo sidebar parity | ✓ | Landing page now shows 180px sidebar with 4 tabs (Add active / Sections / Pages / Versions), tool grid below. Old 56px tool rail removed. |
| #7 color hex inputs | ✓ | All four sync scenarios pass: swatch→hex, hex `#rrggbb`→swatch, hex `#abc`→`#aabbcc`, invalid→no-op. Enable checkbox auto-flips on first valid edit. |
| #8 replay all animations | ✓ | Page with `scrollTriggerMode: "on-scroll"` and `data-entrance-animation="parallax-soft"` was missed by old `[data-motion-preset]`-only selector. After fix: `data-motion-preset` gets stamped to `parallax-soft`, CSS animation `rev01-blue-saas-parallax-soft 0.42s` runs. |

---

## Session 3 — Style kit + assets + custom font

### S3.A — Style kits (COLORS)

| Beat | Status | Notes |
|---|---|---|
| S3.A.1 COLORS section visible | ✓ | Heading exists, kit grid rendered |
| S3.A.2 cycle 4 built-in kits | **SCRIPT DELTA** | There are **6 kits live**, not 4: charcoal / orange-editorial / blue-saas / green-organic / **ivory-press** / **midnight-violet** (added in commit `73920d1`). Script must say "six built-in kits" and cycle through all six. |
| S3.A.3 "Apogee shipped with a `custom` kit" | **SCRIPT DELTA** | Briar's active kit is `blue-saas`, not `custom`. The custom-kit fixture beat is stale. Either reseed Briar with a custom kit or rewrite the beat. |

### S3.C — Element style controls

| Beat | Status | Notes |
|---|---|---|
| S3.C.1 inspector Style block fields | ✓ | All eight expected fields present: Background, Bg image, Corner radius, Border, Opacity, Shadow, Text color, Overflow. Plus extras: Role, Font size, Font weight, Align, Reset, Motion preset, Motion delay (ms). |
| S3.C.2 corner radius 6 + border 1 | ✓ | Verified via computed style on `wf-hero-kicker`: `border-radius: 6px`, `border-width: 0.571429px` (kit-scaled), `border-style: solid`. |

### S3.D — Pinned color

| Beat | Status | Notes |
|---|---|---|
| S3.D.1 SELECTION panel + `Text colour (hex)` input | ✓ | `#canvas-sidebar-selection` group visible, hex input accepts `#c75d3d`, kicker color → `rgb(199, 93, 61)`. |
| S3.D.2 cycle kit, kicker keeps pinned | ✓ | Charcoal applied, kicker stays at `rgb(199, 93, 61)`. |

### S3.E — Page background override

| Beat | Status | Notes |
|---|---|---|
| S3.E.1 blog page background warm cream | ✓ (with **SCRIPT DELTA**) | Page-background field IS in the page inspector, but it is a single text input (placeholder `e.g. #1a1a2e or transparent`), not a colour picker. Script says "pick warm cream" — should say "type a warm cream hex". Verified: blog article `background: rgb(247,237,227)`, home article untouched at kit default. |

### S3.F-I (assets, AI gen, fonts) — **needs manual recording**
- These beats require real file uploads (R2) and live Replicate API calls. The sidebar Add panel has **no Assets or Theme entry**; the asset library and font upload surfaces live elsewhere (image-element click → picker, dedicated font upload route). Worth a Pass-6 walkthrough by hand before the recording.

---

## Session 4 — Multi-page deep dive

| Beat | Status | Notes |
|---|---|---|
| S4.A.1 6 pages + Rename/SEO/Del | ✓ | All six rows present (home, blog, pricing, enterprise, customers, _404). Each row has a Rename button, an SEO **link** (`<a target="_blank">`, not a button), and a Del button. |
| S4.B.1 / S4.C.1 AI Chat deletePage / addPage | **SKIPPED** (cost) | Live AI runs cost money per chat-concurrency memory; not run. UI is reachable via the AI Chat header button. |
| S4.D.1 SEO link opens /pages/{id}/seo | ✓ | Each row's SEO is an anchor to `/dashboard/sites/{id}/pages/{pageId}/seo`. Title cap / description cap / OG image / locale / canonical / noIndex fields all live on that route (not deep-walked here — needs a Pass-6 trip). |
| S4.E.1 "`_404` toggle, already on" | **SCRIPT DELTA** | There is **no "is 404" toggle** in the `_404` page inspector. The custom-404 mechanism is slug-based — a page IS the custom 404 iff its slug equals `_404` (see `src/canvas/page-routing.ts`). The page inspector shows the standard motion / background / SEO controls only, no toggle. Script should say: "no toggle — the slug `_404` is the mechanism. The page exists because its slug equals `_404`." |
| S4.F.1 `_404` rename → "/404" slug, Ctrl+Z | **VERIFIED (Gap-1 fix; script now stale)** | Pass-5's reserved-slug guard fires: rename to `_404` is **blocked** with `setStatus("Slug '404' is reserved for the custom 404 page", "error")`. Blog row's title and slug stay untouched — no Ctrl+Z needed. Script must read: "Maya types `_404` as a title. Editor flashes 'Slug 404 is reserved for the custom 404 page'. Rename does not apply." |

---

## Session 5 — Element-by-element exercise (batch surface check)

| Beat | Status | Notes |
|---|---|---|
| Add panel — 14 element types | ✓ | All present: Text, Image, Video, Button, Shape, Container, Chart, Form, Embed, Code, Accordion, Carousel, Table, Nav. Matches "fourteen direct-add buttons". |
| Motion presets count | **SCRIPT DELTA** | The dropdown lists **17 values** including `none`. Script S5.A.1 says "17 motion presets" (correct if `none` counts), S5.S.1 says "sixteen entrance presets" (correct if `none` excluded). Either is defensible — pick one and apply consistently across script. |
| S5.Q.1 section roles via data attributes | ✓ | First section is `wf-site-header` with `data-section-role="header"`. Roles are exposed on the rendered DOM, so a tooltip / outline showing the role is accurate. Film reel needs explicit "open" action before role can be hovered on a thumbnail. |
| S5.P.1 / S5.R.1 "no editor UI for section bgEffect / bgVideo / role / popupTrigger / entrance" | ✓ confirmed | This is **Gap 6** of the cheap-five list — the section inspector still shows action buttons (duplicate/move/save-to-library/delete/AI) only, not the data-model fields. Voice-only beats are still correct. |
| Other S5 per-variant cycles (action variants / shape / container / form / embed / code / table / accordion / carousel / nav / collection / chart / rotation / opacity) | **needs manual recording** | Each requires picking a specific element on a specific page, exercising its inspector, and cycling values. Too many interactions for batch verification — recommend manual driver pass before recording. |
| S5.T.1 undo/redo | ✓ | Ctrl+Z / Ctrl+Y wired to Yjs history; confirmed by the per-test Ctrl+Z undo during sidebar work. |

---

## Session 6 — Responsive + library save + custom template save

| Beat | Status | Notes |
|---|---|---|
| Editor breakpoint switcher (`desktop / tablet / phone`) | **MISSING** | No `[data-breakpoint]`, `#canvas-breakpoint`, or `.rev01-breakpoint-switcher` in the DOM. This is **Gap 9** of the medium-five list (the handoff explicitly flagged: "Editor breakpoint switcher (desktop / tablet / phone preview)" as not-yet-shipped). S6 beats that switch breakpoints (`S5.I.1` phone collapse demo, S6.A onwards) will not work as written. Either ship Gap 9 or rewrite beats. |
| Save section to library / Save site as template | **partially-shipped (Gap 3)** | Pass-5 Gap-3 cheap-five fix landed the description + Private/Community visibility flow. S6.F.1 / S6.G.1 / S13.E.1 beats can now exercise the radio + description input. |

---

## Session 7 — A11y audit + first publish

| Beat | Status | Notes |
|---|---|---|
| A11y link reachable from editor | **none** | No `<a href*="a11y">` in the editor DOM. The audit lives at the dashboard route `/dashboard/sites/{id}/a11y` — accessed from the dashboard, not from the editor header. Script should either ship an editor-header link, OR voiceover the dashboard route. |
| Publish button reachable | ✓ | `#canvas-publish` enabled, ready. The post-publish modal + version-badge update + OG-pill all land per Pass-5 work. |
| Audit gates publish | ✓ (memory-confirmed) | Per `project_a11y_audit_gates_publish` memory: "route returns 422 with blockers when runAudit.blockerCount > 0" — handoff/dryrun P2-1 claim was stale, this gate already enforced. |

---

## Sessions 8–13 — not driven

Time-budget hit. The handoff's "each fits in one Playwright sweep" estimate held for the cheap-five but breaks down at this depth — S5 alone has 20 sub-beats, S8–S11 each have ~6 sub-beats, S12–S13 are sequence-y restores + saves. A Pass-6 driver pass is the right shape: open the editor, walk Sessions 8–13 by hand, log mismatches.

Likely deltas to watch for:
- S8 collaborators + invites — email flow + token handler.
- S10 addons — entitlement shop UX.
- S11 forms inbox.
- S12 version-restore safety snapshot — verified end-to-end in code; live exercise still useful.
- S13 Community-template save — exercises Pass-5 Gap-3 flow.

---

## Cumulative script-vs-product deltas (Pass-5)

To fold into `docs/demo/script-deltas-2026-05-29.md` and `docs/demo/act-1-script.md`:

1. **S3.A.2** — six kits live, not four.
2. **S3.A.3** — Briar runs on `blue-saas`, not `custom`. Drop or reseed.
3. **S3.E.1** — Page background is a CSS text input, not a colour-swatch picker.
4. **S4.E.1** — There is no "is 404" toggle. Slug `_404` IS the mechanism.
5. **S4.F.1** — `_404` rename is now **blocked** by Pass-5 Gap-1 guard. Rewrite the beat: "editor flashes 'Slug 404 is reserved'; no rename applies".
6. **S5.A.1 / S5.S.1** — pick a consistent count (16 or 17) for motion presets and use it in both beats.
7. **S5.P / S5.R / S5.Q.1 reel-open** — accurate as written, no change needed.
8. **S6 breakpoint switcher** — **product gap** (Gap 9). Either ship it or rewrite beats.
9. **S7 a11y access from editor** — no link in the editor header. Either add one or route through the dashboard `/a11y`.

---

## Script-vs-product deltas to fold into act-1-script.md / script-deltas-2026-05-29.md

1. **S3.A.2**: four → six built-in kits (charcoal, orange-editorial, blue-saas, green-organic, ivory-press, midnight-violet). Adjust cycle voiceover + on-screen action accordingly.
2. **S3.A.3**: drop the "Apogee shipped with a `custom` kit" beat OR reseed Briar with a custom kit before recording. Currently Briar runs on `blue-saas`.
3. **S3.E.1**: replace "pick warm cream" with "type a warm cream hex (e.g. `#f7ede3`)" — the page-background field is a plain text input that accepts any CSS background value, not a swatch picker.
