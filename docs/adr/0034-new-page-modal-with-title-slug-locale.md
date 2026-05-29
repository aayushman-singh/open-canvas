# ADR 0034 — `+ New Page` opens a modal that captures title, slug, and locale up front

**Status:** Proposed
**Date:** 2026-05-30
**Author:** Aayushman Singh
**Drives:** G7 in [docs/demo/handoff-delta-resolution-2026-05-30.md](../demo/handoff-delta-resolution-2026-05-30.md) §3.7. Resolves the friction surfaced by Interlude 4 in [docs/demo/act-1-script.md](../demo/act-1-script.md) (I4.B), where an Arabic page has to be created, then renamed, then have its locale set via the SEO panel — three round-trips for what the Owner thinks of as one act.

## Context

`+ New Page` in the Pages tab of the editor sidebar calls `createPage` in `src/editor/canvas-client.ts`. The function fabricates a page with `title = "Page N"`, `slug = "page-N"`, no locale, one blank `feature-grid` section, pushes it onto `state.pages`, sets it active, and saves. The Owner then renames the page via the row's `Rename` action (which derives a slug from the new title and guards against `_404` / `404` per [ADR 0029](0029-custom-404-toggle-on-page-inspector.md)), and sets the locale via the SEO panel's `Locale (BCP-47)` text input at `src/routes/dashboard/page-settings.tsx`.

For an English page that adopts the site's default locale this is fine — `Page N` is throwaway, Rename happens once, and locale never needs to be touched. For Interlude 4's Arabic page it is not fine: the Owner wants the page named `Doha launch` with locale `ar` from the first render so the RTL flip the script demos (I4.C, I4.D, I4.E) is the *first* thing she sees on the new artboard, not a thing that appears after two follow-up edits. The recording reads cleaner; more importantly, the Owner's lived experience of "make me an Arabic page" matches "type name, type locale, hit Create" — one act, not three.

The same shape exists in the dashboard's `Create from <template>` flow at `src/routes/dashboard/templates.tsx` (S1.7 in act 1): the Owner picks a template, types a site name, the subdomain field auto-derives from the name, she confirms, and `briar.opencanvas.aayushman.dev` is live. That modal is the canonical "configure-before-create" pattern in the product. The page-create surface has drifted from it.

The reserved-slug set `_404` / `404` is enforced in `renamePage` (after the slug has been derived from a Rename action) and at the page-settings save path. It is *not* enforced before a page exists — there is no surface where the Owner can name a page `_404` at create time today, because the create path doesn't accept a name. Adding a name field at create time opens that gap; the modal has to close it itself.

## Decisions

1. **`+ New Page` opens a modal with three fields — Title, Slug, Locale — and a Create button. The modal is the only path to creating a page from the editor sidebar; the instant-create behaviour is removed.**

   **Why:** the Owner's mental model of "add a Doha launch page in Arabic" is one act, not three. Routing it through a modal that captures all three pieces matches the `Create from Apogee Showcase` modal from S1.7 — the Owner already understands `configure → confirm → it exists` as the way new things enter the product. Keeping the instant path alongside a modal would split the create surface in two and force the Owner to remember which one preserves which fields; the script never demonstrates a use case for instant-create where the rename-then-SEO follow-up isn't on the Owner's mind. Removing it costs nothing the Owner values.

2. **A modal — not an inline expanding row — because the editor sidebar is the wrong canvas for a three-field form, and the Pages tab's row idiom is `[title] [Rename] [SEO] [Del]`, which has no room.**

   **Why:** the sidebar is narrow (the editor's chrome budget is documented across the sidebar/inspector ADR series). An inline expanding row would have to push every page below it down by ~140px and would compete with the row's own action buttons for click area. The `Create from <template>` modal is already the visual language the Owner expects for "I'm about to make a thing"; using it again for page-create is consistent, not novel. A modal also gives the locale picker (decision 4) room to expose its dropdown without clipping the sidebar's width.

3. **The Slug field auto-derives from Title keystrokes (lowercase, non-alphanumerics → `-`, collapse runs, trim edges — the same normaliser `renamePage` already uses), and stops auto-deriving the first time the Owner edits the Slug field directly.** Editing Title after that point updates Title only; Slug is the Owner's once they touch it. Clearing the Slug field (back to empty) re-arms auto-derivation.

   **Why:** the `briar` flow from S1.7 has trained the Owner that "type the name, the system fills the URL" is how naming-to-routing works in this product. Matching that here keeps the two create surfaces (site-create and page-create) idiomatic with each other. Stopping auto-derivation on the first manual Slug edit is the standard escape hatch — the Owner who wants `solutions-for-teams` as a title and `teams` as a slug types both, in either order, and the system doesn't fight her. Re-arming on clear is the "I changed my mind, derive again" gesture; cheap to implement, matches the model.

4. **Locale is a dropdown of curated common locales (the BCP-47 subset `src/i18n/locale-resolve.ts` already accepts: 2-letter primary, optional 2-letter region) with an `Other (type BCP-47 tag)` option that reveals a text input.** The curated list opens with `Site default` selected; picking it leaves the page's `locale` field unset (the renderer falls back to the site's default per the existing resolver). Picking a specific locale stores that value verbatim.

   **Why:** the SEO panel's existing locale field is a freeform text input because the SEO panel is where the Owner who knows BCP-47 goes to type `ar-EG`. The create modal is where the Owner who *doesn't* know BCP-47 goes to pick `Arabic` from a list and have the right tag stored without typing. Giving the create surface a curated dropdown matches the Owner's confidence level at create time (low — she's still naming the page) and the SEO panel's freeform input matches the Owner's confidence level at SEO time (higher — she's filling in metadata deliberately). The `Other` escape hatch keeps the curated list from being a ceiling: the operator who wants `fil-PH` types it, the modal stores it, and the existing locale-resolve grammar accepts it on the next render. The curated list is not the canonical set of supported locales; it is a UX shortcut for the common case.

5. **The modal pre-validates the Slug against the reserved set `_404` and `404` (per [ADR 0029](0029-custom-404-toggle-on-page-inspector.md) and `CUSTOM_404_PAGE_SLUG` in `src/canvas/page-routing.ts`) and against any slug already in use by another page on the site. Reserved or duplicate slugs disable the Create button and surface the rule inline next to the Slug field; they do not silently auto-suffix `-2`.**

   **Why:** the reserved-slug guard in `renamePage` fires *after* the Owner has typed the new title and clicked OK, then surfaces the rejection as a status flash. That's fine for rename because the page still exists and the Owner can try again. It is wrong for create: a rejected create modal that closes and loses the Title and Locale the Owner just typed is a worse experience than surfacing the rule before the Owner commits. Disabling Create with an inline reason makes the rule visible at the moment the Owner could act on it. Silent `-2` suffixing on duplicates is rejected for the same reason it would be wrong on Rename — the Owner who typed `about` and got `about-2` doesn't learn that `about` is taken; she learns that the system silently renames her work. Surfacing the conflict and letting her decide (pick a different title, or rename the existing `about`) preserves her agency.

6. **The new page starts with the same blank `feature-grid` section the instant-create path produced today.** No section-recipe picker in the modal.

   **Why:** Session 4 of the script (S4.C.1) demonstrates that picking the starting section is what AI Chat does — the Owner types `Add a new page called Manifesto. Use the hero-split section recipe.` and the agent runs `addPage` + `addSection`. Forcing the modal-create path to pick a recipe up front would either duplicate that affordance (modal recipe picker AND chat-driven add) or push the Owner away from the chat path the recipes-as-factories story (per [ADR 0019](0019-section-recipe-custom-sentinel.md)) is built around. The blank `feature-grid` start is the "I'll fill it in" default, and Owners who want a recipe go through chat. Scope kept narrow.

## Out of scope

- **AI-Chat-driven page creation (`addPage` tool).** The agent path stays as-is — chat creates pages without the modal, accepting all three fields as tool arguments. The modal is the manual create surface; chat is the conversational create surface; both write through the same `state.pages.push` underneath.
- **The SEO panel's Locale field.** It stays a freeform text input. The two surfaces are deliberately different per decision 4; a future ADR can revisit whether the SEO panel should also gain a curated dropdown, but that is not this ADR's scope.
- **A locale picker on the Rename action.** Rename stays title-only. Owners who want to change a page's locale post-create still go through the SEO panel — that flow is already on every page row and removing it would be a regression for the Owner who only realised mid-edit that the page should be Arabic.
- **Slug auto-derivation in `renamePage`.** Rename already derives slug from title in one direction; the no-auto-after-edit rule from decision 3 belongs to the create modal because the create modal exposes both fields simultaneously. Rename exposes title only.
- **Reserved-slug guard widening.** This ADR adds the existing `_404` / `404` set to the create modal's pre-validation. Any future reserved slug (e.g. a published API route) is a separate decision; the modal reads from the same `CUSTOM_404_PAGE_SLUG` constant `renamePage` reads, so widening the set in one place widens it in both.

## Consequences

**Positive:**

- Interlude 4 reads as one act: open modal, type `Doha launch`, pick `Arabic (ar)`, click Create, the artboard renders RTL on first paint. The script no longer needs the rename-then-SEO follow-up beats that script-fix #18 in the handoff describes as a workaround.
- The create surface matches the `Create from <template>` modal from S1.7, so the Owner's "configure-before-create" mental model holds across site-create and page-create. One pattern, two surfaces, same shape.
- Reserved-slug rejection happens before the Owner commits, not after, so a typo like `_404` never costs the Owner the Title and Locale she already typed.

**Negative:**

- One extra click for the common case (English page, default locale, throwaway title) — Owner now goes through a modal where she previously got a page instantly. The mitigation is that the modal pre-fills Title with `Page N` and leaves Locale on `Site default`, so the common case is `Enter` to accept defaults; one keypress, not a multi-field form-fill. But the click cost is real and worth naming.
- The curated locale list is a small ongoing taste decision — which locales make the list, in what order, in which language (English names vs native names). The `Other (type BCP-47 tag)` escape hatch keeps the list non-canonical, so getting it slightly wrong is recoverable, but it is a surface someone has to own.
- The Slug auto-derive-then-stop rule has one subtle case: the Owner types Title, the Slug fills in, she clicks into Slug and presses Backspace once to delete a trailing dash, then clicks back into Title and keeps typing. Slug no longer updates — which is the rule — but the Owner who didn't realise the Slug-edit armed the freeze may be surprised. The mitigation is the "clear to re-arm" gesture from decision 3; the surprise is the cost of giving the Owner control over the slug.

## Follow-ups

- Implement the modal using the existing `openTextModal` infrastructure in `src/editor/canvas-client.ts` (or a new `openPageCreateModal` that follows the same single-modal-stack discipline — throws if another modal is open, Escape resolves to null, backdrop click cancels).
- Replace `createPage`'s body so the page is constructed from the modal's return value (`{ title, slug, locale }`) rather than from `idx`. The blank `feature-grid` starter section per decision 6 stays.
- Surface the reserved-slug constant `CUSTOM_404_PAGE_SLUG` (and the `404`-after-normalisation case) as a small helper — `isReservedPageSlug(slug: string): boolean` — that both `renamePage` and the new modal call. Keeps the reserved set in one place.
- Update the script: I4.B.1 and I4.B.2 collapse into a single beat ("Pages tab → + New Page. Modal opens. Type `Doha launch`, pick Arabic, Create."). The handoff's G7 entry can then move to "shipped."
- Curated locale list — initial set should at minimum cover the locales the script touches (`en`, `ar`) plus a handful of common ones (`fr`, `de`, `es`, `ja`, `zh-CN`). Final list is a design call, not an ADR call.
