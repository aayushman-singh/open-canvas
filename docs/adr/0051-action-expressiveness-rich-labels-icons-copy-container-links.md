# ADR 0051 — Action expressiveness: rich labels, icon registry, copy behaviour, container links

**Status:** Accepted
**Date:** 2026-06-02 (Accepted 2026-06-09)
**Author:** Aayushman Singh
**Drives:** gaps 7, 8, 9, and 10 from [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md). Bundle C in the gap-bundling plan agreed on 2026-06-01.

**As-built (2026-06-09):** all five decisions live in the canvas.
Decision 1 (`label: InlineRun[]`) on [`src/canvas/elements/action.ts`](../../src/canvas/elements/action.ts) with the 2026-06-02 JSONB migration that swept legacy string labels.
Decision 2 (icon registry) lives in [`src/canvas/icons.ts`](../../src/canvas/icons.ts) (`ICON_NAMES`, `IconName`, `renderIconSvg`), surfaced via the visual picker in [`src/editor-client/inspector-icon-picker.ts`](../../src/editor-client/inspector-icon-picker.ts).
Decision 3 (`href` ⊕ `behavior` discriminated union) on [`src/canvas/elements/action.ts`](../../src/canvas/elements/action.ts).
Decision 4 (delegated copy handler) emitted from [`src/canvas/render.ts`](../../src/canvas/render.ts) under `[data-opencanvas-copy]`; smoke at [`src/canvas/action-expressiveness.smoke.ts`](../../src/canvas/action-expressiveness.smoke.ts).
Decision 5 (`ContainerElement.linkHref`) on [`src/canvas/elements/container.ts`](../../src/canvas/elements/container.ts).

## Context

Four threads from the portfolio port collapse into the same surface — the action / link interface — and are best decided as a bundle so the contracts settle once:

1. **Rich CTA labels.** The portfolio's hero CTAs are tile-shaped: icon + label + caption ("github · /aayushman-singh"). `ActionElement.label: string` can't carry inline formatting; the port collapsed each tile into a single concatenated label string and lost the icon entirely.
2. **Icons.** The portfolio footer's social tiles, the copy/check affordance, the résumé download icon, and the small arrow-up-right on each notes row are all stock SVG marks. The canvas has no surface for them: `shape` covers geometric primitives (`circle`, `pill`, `blob`); `media` requires an Owner-uploaded asset id. The port used letter glyphs (`GH`, `in`, `𝕏`, `@`) inside action labels as a placeholder — visibly amateur.
3. **Copy-to-clipboard.** The portfolio's email address and social handles are click-to-copy. `ActionElement.href` is link-only — there is no JS-behaviour slot on the action surface.
4. **Card-as-link.** The portfolio's project cards are single click-targets — the whole card is one `<a>`. `ActionElement` has bounded coverage; trying to stack one across an absolute-positioned card is fragile. `ContainerElement` (the natural card primitive) has no link slot.

A fifth thread — **per-element tint** for the card accent (gap #17) — was originally bundled here and pulled out on review. Tint belongs in a style-kit redesign once the container shape settles; the ADR for that bundle does not block this one.

## Decisions

1. **`ActionElement.label` becomes `InlineRun[]`.** Replaces `label: string` atomically across schema, validator, renderer, agent-tool spec, and every checked-in fixture. The InlineRun shape is the same one TextElement already uses, so authors get bold / italic / link / code / highlight inside button text and the agent-side rich-text path doesn't fork into a second parser.

   **Why a breaking change instead of a compat shim.** The dev DB is empty per ADR 0003; no production data is at risk. The canonical-shape rule (ADR 0012 dec 1, the validator is the only write gate) makes a string fallback a permanent fork in the validator + every consumer. A compat shim accepting either shape would double the renderer's label path, mean two test surfaces, and silently round-trip the old shape forever. Atomic migration matches the all-or-nothing posture in CLAUDE.md.

2. **Icons ship as an inline-SVG registry, not as seed assets.** A new module `src/canvas/icons.ts` exports `ICON_NAMES` (a curated 13-icon `as const` array) and `renderIconSvg(name): string` that emits the matching `<svg>` with bounded inline path data. Both `ActionElement.iconKind?: IconName` and `ShapeElement.variant: 'icon'` + `iconKind: IconName` reference the same union. Icons are part of the design vocabulary, alongside `SurfaceVariant` / `ActionVariant` / `ShapeVariant` — they have no Owner-content semantics.

   **Why not seed assets (the original ADR-0050 gap-doc proposal).** Per ADRs 0004 + 0006, seed assets are content-hashed, R2-backed, owner-asset-row materialised entities — every Owner site gets a copy in storage, every fork ships its own bytes. Common icons (a GitHub mark, a check, a chevron) are system primitives, not Owner content; storing 13 SVG seeds per Owner site is structurally wrong (storage quota impact, redundant R2 objects, billing concerns at scale, and a `seed:assets` migration every time a new icon lands). An in-repo registry has none of those costs and matches how style-kit tokens already live in `src/canvas/style-kits.ts` rather than in R2.

   **Why 13 icons and which.** `mail`, `copy`, `check`, `arrow-up-right`, `arrow-left`, `download`, `external`, `chevron-down`, `menu`, `close`, `plus`, `minus`, `search`. The set covers the portfolio template's non-brand needs and the universal navigation / UI affordances any future template will need. All are simple geometric primitives composable from standard SVG drawing operations. The set is intentionally extensible: adding a new icon is one entry in `ICON_NAMES` and one entry in the path registry; the rule for adding a new icon is "the same icon is requested in two or more templates" — single-template requests stay in fixture pinnedStyle until a second request lands, same threshold the pinnedStyle docstring uses for typography promotions.

   **Why brand icons (`github`, `linkedin`, `x`) are NOT in the initial set.** Brand marks are trademarked. Reproducing them from memory carries copyright + trademark surface that pure geometric primitives do not. They land in a follow-up that bundles a permissively-licensed icon set (Simple Icons, CC0 public domain) as an opt-in dependency, OR that lets Owners upload their own brand marks as Owner Assets and reference them via `iconKind` extended to `'asset:<assetId>'` discriminator. The portfolio template's footer social tiles keep the letter-glyph fallback (`GH`, `in`, `𝕏`, `@`) until that follow-up lands.

3. **`ActionElement.href` and `ActionElement.behavior` are mutually exclusive via a discriminated union.** An action is either a navigation target (`href: ActionHref`, no `behavior`) or a click-driven behaviour (`behavior: ActionBehavior`, no `href`). The `ActionBehavior` discriminator is open by design — `{ type: 'copy'; value: string }` ships first; future behaviours (`{ type: 'submit-form'; formId }`, `{ type: 'open-popup'; sectionId }`) extend the union without renaming the field.

   **Why mutual exclusion, not coexistence.** A button that both navigates AND copies tells the visitor two different things about what the click does. Real authoring cases want one or the other — the portfolio's email tile is a *link* (`mailto:`) and the handle next to it is a *separate copy button*, two distinct surfaces. Allowing both on one element would require the renderer to decide which behaviour wins on click and would surprise authors who set both. The validator enforces "exactly one" so the type system and the runtime agree.

4. **Copy behaviour ships via `data-opencanvas-copy` attribute + a delegated visitor-side handler.** When at least one action with `behavior.type === 'copy'` exists in the published snapshot, the renderer emits one `<script>` block at the end of `<main>` that registers a single delegated click listener on `document` (closest-match against `[data-opencanvas-copy]`, calls `navigator.clipboard.writeText`, sets `data-opencanvas-copied` for 2s only after the clipboard promise resolves, and sets `data-opencanvas-copy-failed` with a console error when the Clipboard API is unavailable or rejects). Snapshots with no copy actions emit no script — zero-cost when unused, matching the ADR 0050 dec 3 `scrollBehavior` pattern.

   **Why delegated, not per-element inline.** Per-element `onclick="navigator.clipboard.writeText('…')"` would inline script per action (CSP fight), embed Owner-content strings into JS (escaping minefield), and balloon the rendered HTML when a snapshot has many copy buttons. One delegated handler reads the attribute at click time, so the attribute is the only place the value lives and HTML attribute escaping is the entire safety story.

   **Why emit inside `<main>` rather than a separate script asset.** Same reason ADR 0050 dec 3 emits its `<style>` block inside `<main>` — the renderer's contract is to return a self-contained `<main>`; the caller wraps it in the document envelope; one inline script keeps the surface area at one boundary and doesn't ask publish-route + editor-preview + OG-renderer to wire a new external asset.

5. **`ContainerElement.linkHref?: ActionHref` makes a container's wrapper an `<a>` instead of a `<div>`.** When set, `renderElement` emits `<a class="opencanvas-element" href="…" data-…>` for the container's outer wrapper. Every other wrapper attribute, the inner `<div class="opencanvas-surface">`, the wrapperStyle pipeline, motion, anchorId, elementStyle — all unchanged. The change is a one-line tag swap conditioned on element type + linkHref presence.

   **Why no constraint on child action elements (no "nested `<a>`" rule).** Canvas elements are siblings at the section level, absolute-positioned. The card-as-link container and a child action button are DOM siblings, not parent and child — there is no HTML anchor-nesting violation. When the visitor clicks an absolute-positioned child action, the child's own click handler fires first (HTML event order) and the container's link is only followed when the click lands on the container's own bare region. The visual nesting is real, but the DOM nesting is not, and that's the whole point of the absolute-positioning posture from [render.ts:83](../../src/canvas/render.ts#L83).

## Out of scope

- **Per-element tint (gap #17).** Deferred to a style-kit redesign ADR. The "branded accent on this card" concept needs `StyleKitPreset.tintTokens` and a resolved enum on `ContainerElement`, not a one-off raw-colour field. Pull after Bundle C settles container shape so the tint tokens know which container fields they're decorating.
- **Looping motion (gap #5).** Pushed back; static UI reads fine.
- **Sticky positioning (gap #6), in-app drill-in overlay (gap #3), scroll-snap rail (gap #14).** All deferred to a layout-v2 ADR that pairs with Bundle D (tabs).
- **Inspector rows for the new fields.** Ship in a follow-up PR per the established Bundle-B pattern: runtime + fixtures + smokes land first, editor UI tracks them in a smaller follow-up.
- **More than 13 icons.** Extensions land per the "two-template request" rule documented in decision 2.
- **Other `ActionBehavior` discriminants** (`submit-form`, `open-popup`, etc.). The discriminated union accommodates them, but only `copy` ships in this ADR.

## Consequences

**Positive:**
- The portfolio template's hero CTAs, footer social tiles, project cards, and copy-handle affordances all express in typed fields. No `pinnedStyle` escape for any of them.
- Every consumer of `ActionElement.label` (renderer, agent tool, inspector) reads one shape — `InlineRun[]`. No string-fallback fork.
- Icons are extensible at zero R2 cost. Adding a new icon is one PR's worth of inline SVG path data and one enum entry.
- The discriminated union for action shape means TypeScript narrows correctly in the renderer: inside the `if (element.href)` branch, `behavior` is `undefined` at the type level; inside the `behavior` branch, `href` is `undefined`. No runtime "which one does this thing actually have" guard needed beyond the discriminator check.

**Negative:**
- Every checked-in fixture changes shape — apogee, portfolio, the seven starter templates. The migration script is mechanical, but the diff is large; reviewers should expect the bulk of the PR's line count to live in fixture JSON, not in code.
- The agent's tool spec for `label` widens to accept either a string (convenience for single-run labels) or an `InlineRun[]`, parsed into the canonical array shape. The convenience-string path is *parse-time only* — at-rest data is always `InlineRun[]`. Documented in the agent tool spec; the agent will learn from the JSON schema and the examples.
- Snapshots with copy actions ship one inline `<script>` block. The block is ~12 lines of source, ~250 bytes minified, fires only on the first click after page load that lands inside `[data-opencanvas-copy]`. Safe and bounded but worth noting as a per-page footprint.
- `ContainerElement.linkHref` introduces the first canvas case where the wrapper tag varies by element data, not by element type. Future authors of `render.ts` need to remember to thread that conditional. Documented inline.

## Follow-ups

- **Inspector rows.** Action label as a small rich-text editor (re-use the textElement rewrite path); iconKind as a select from `ICON_NAMES`; behavior as a two-row group (type select + value text, conditional on type). Container linkHref via the existing `action-href` inspector field. Shape variant select gains `'icon'`; iconKind select appears conditionally.
- **Style-kit `[data-opencanvas-copied]` rule.** The post-click "Copied" affordance is purely CSS. Add to each built-in style kit a default rule that swaps the trailing icon to `check` (or shows a "Copied" trailing label) when the data attribute is set. Empty pinnedStyle escape hatch stays available.
- **Fixture migration script.** A single bun script that walks every `*.json` under `src/canvas/fixtures/` and rewrites `"label": "X"` → `"label": [{"text": "X"}]` on every action element. Idempotent. Lands as part of this PR's commit.
- **Gaps-doc update.** Mark 7/8/9/10 closed against this ADR. The status snapshot table at the top of [docs/portfolio-template-gaps.md](../portfolio-template-gaps.md) advances Bundle C to ✅.
- **Bundle D — tabs.** With Bundle C in, the only remaining "fix this in the canvas" gap that needs a layout-engine rethink is tabs (gap #2) + the deferred layout-v2 set (sticky, drill-in, scroll-snap). Author the next ADR when Bundle D scope is finalized.
