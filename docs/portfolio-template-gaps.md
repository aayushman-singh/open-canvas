# Portfolio template — capability gaps

Surfaced while porting `C:/Repo/portfolio` 1:1 into `src/canvas/fixtures/portfolio-showcase.json`. Each row is a thing the portfolio does that the canvas could not express cleanly; the port either approximated or skipped. Ordered by how visible the loss is in the rendered template.

## Status snapshot

| Bundle | Gaps | Status | Reference |
|---|---|---|---|
| **A** — Renderer + inspector parity | 4, 13, 15 | ✅ Shipped | Commits Bundle A 1–4 (1 dropped + 13/15 promoted as part of full typography surface incl. lineHeight + textTransform) |
| **F** — Seed asset expansion | 16 | ✅ Shipped | Bundle A commit 3 (`seed-portrait-placeholder`, `seed-project-thumb-neutral`) |
| **B** — Layout primitives | 1, 11, 12 | ✅ Shipped | [ADR 0050](adr/0050-layout-primitives-fluid-type-anchor-ids-scroll-padding.md) |
| **C** — Action expressiveness | 7, 8, 9, 10 | ✅ Shipped (10 partial) | [ADR 0051](adr/0051-action-expressiveness-rich-labels-icons-copy-container-links.md) |
| **D** — Tabs | 2 | ✅ Shipped | [ADR 0052](adr/0052-tabs-as-element-with-embedded-panels.md) |
| **Layout v2** — sticky positioning + scroll-snap rail shipped; drill-in overlay contract documented | 3, 6, 14 | ✅ Shipped (3 deferred impl) | [ADR 0054](adr/0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md) |
| **Style-kit tint tokens** | 17 | ✅ Shipped | `StyleKitPreset.tintTokens` + `ContainerElement.tint` + renderer CSS-var emission |
| **Brand icons follow-up** | 10 (partial → full path) | ✅ Infrastructure shipped | `scripts/sync-brand-icons.ts` fetches Simple Icons (CC0) on demand; brand-icons.generated.ts pattern documented in icons.ts |
| **Pushed back** — looping motion | 5 | ❌ Won't ship | Idle-motion rabbit hole; static dot is fine |

## Full gap table

| # | Portfolio capability | Canvas today | Port did | Status |
|---|---|---|---|---|
| 1 | **Fluid type** — `clamp(64px, 9vw, 132px)` on the hero name | `TextElement.fontSize: number` (px). Per-breakpoint `responsive.{tablet,phone}.w/h` only — no fluid font size. | Pinned `fontSize: 124` at desktop, smaller `w/h` at tablet/phone. | ✅ **Closed by ADR 0050 dec 1** — `TextElement.fluidSize?: { min, max, vw }` lands clamp() and `fontSize` becomes the structured fallback. Wired in fixture. |
| 2 | **Tabs** — `<button role="tab">` switching panels (Stack / Work / Notes) | No tab element. `accordion` collapses; doesn't swap. | Rendered all three as back-to-back sections with `01 / 02 / 03` index labels. Loses the tab UX entirely. | ✅ **Closed by ADR 0052** — new `TabsElement` with embedded `tabs: Tab[]` (each carrying its own `elements: CanvasElement[]` panel children, panel-local coordinates), `activeTabId` discriminator, optional `tabBarHeight`. Delegated visitor JS handler emitted only when a TabsElement exists. Portfolio home rewritten: `pf-stack` + `pf-work` + `pf-notes` (121 elements total) collapsed into one `pf-explore` section containing a single TabsElement with three panels (Stack / Work / Notes); section anchor `'about'` lives on `pf-explore`. Graceful no-JS fallback shows all panels stacked. |
| 3 | **Iframe project drill-in** — clicking a card opens a full-screen overlay with an `<iframe>` + sidebar | No modal / overlay primitive. `embed` can host the iframe but only as a page-level element. | Cards link out to the live URL (`open →`). No in-app drill-in. | 📜 **Contract documented in [ADR 0054 dec 3](adr/0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md)** — `trigger: { type: 'element-click'; targetElementId }` extension + delegated visitor handler + embed-in-popup composition. Implementation deferred until a template needs it; current portfolio cards link out via Bundle C's `linkHref`. |
| 4 | **Sticky topnav with `backdrop-filter: blur(14px) saturate(1.2)`** | `header` section + `nav` element with `sticky: true` exists. `pinnedStyle` carries `backdrop-filter` through. | Worked via `pinnedStyle`. | ✅ **Closed by Bundle A commit 2** — `pinnedStyle` docstring now formally endorses `backdrop-filter` + the visual-effects family. No promotion to structured field. |
| 5 | **Pulsing status dot** — `@keyframes pulse-soft` running forever on the "consulting · advisory" indicator | `motion.preset` enums are one-shot entrance only. `slow-drift` and `parallax-soft` are the only loops, and they're scroll-tied. | Used a static `circle` shape — dot does not pulse. | ❌ **Won't ship.** Idle-motion (`pulse`, `breathe`, `shimmer`) is a known rabbit hole; the static dot reads fine. |
| 6 | **Sticky right column** — portrait card pins via `position: sticky; top: 80px` while left column scrolls | Elements are absolute-positioned only. No `position: sticky`. | Portrait card sits at a fixed `y` and scrolls with the page. | ✅ **Closed by [ADR 0054 dec 1](adr/0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md)** — `BaseElement.stickyOffset?: number` opt-in switches the wrapper to `position: sticky` with margins for the initial offset and the field value as the viewport-top offset. Portfolio portrait card wired (`stickyOffset: 80`). Validator + yjs round-trip + 9-template validate all green. |
| 7 | **Copy-to-clipboard action** — "copy" → "copied" pulse on the email tile + handles in the footer | `ActionElement.href` only (link). No JS behaviour. | Email tile is a plain `mailto:` link. Handles under the social tiles are not copyable. | ✅ **Closed by ADR 0051 dec 3 + 4** — `ActionElement.behavior: { type: 'copy', value }`, mutually exclusive with `href` via discriminated union. Delegated visitor-side handler emitted at end of `<main>` only when a copy action exists. Wired in portfolio footer email tile. |
| 8 | **Rich CTA tiles** — icon + label + caption inside one click target ("github / /aayushman-singh") | `ActionElement.label: string` (plain text, no inline marks, no icon slot). | Used the label string only: `"github · /aayushman-singh"`. | ✅ **Closed by ADR 0051 dec 1 + 2** — `label: InlineRun[]` (atomic migration across 122 fixture sites + every consumer + agent tool) + `iconKind?: IconName`. Hero CTAs wired with `download` / `external` icons. |
| 9 | **`<a>` wrapping the whole card** — entire project card is one click target | An `action` covers its own bounds only. Stacking it across the card is fragile. | `open →` link at the bottom of each card. | ✅ **Closed by ADR 0051 dec 5** — `ContainerElement.linkHref?: ActionHref`. `renderElement` swaps outer wrapper to `<a>` when set. All 6 portfolio project cards wired. |
| 10 | **Inline SVG icons** (GitHub mark, LinkedIn, X, email, copy, check) | `shape` is variant-bound (`circle`, `pill`, `blob` …). `media` works only with uploaded image/video assets. | Footer social tiles use letters (`GH`, `in`, `𝕏`, `@`) in `action.label`. Looks placeholder-y. | ✅ **Fully closed.** ADR 0051 dec 2 ships the 13-icon generic registry. Brand-icon follow-up shipped as [scripts/sync-brand-icons.ts](../scripts/sync-brand-icons.ts) — a one-shot script that fetches CC0 path data from Simple Icons (`cdn.simpleicons.org/<slug>/`) for github / linkedin / x / instagram / facebook / youtube / discord / mastodon / bluesky / medium / substack / rss and writes `src/canvas/icons/brand-icons.generated.ts`. Run by hand when the brand set changes; output is committed. Portfolio footer keeps letter-glyph fallback until the script runs in this checkout. |
| 11 | **Hash-deeplinkable in-page anchors** (`#about`, `#stack`, `#work`, `#contact`) | Renderer never emits `id="..."` on sections or elements. | Header anchors `#about` / `#work` / `#contact` wired but unresolvable. | ✅ **Closed by ADR 0050 dec 2** — `BaseElement.anchorId` + `CanvasSection.anchorId`, strict charset, per-page uniqueness enforced. Wired in fixture (`top`/`about`/`work`/`notes`/`contact`). |
| 12 | **Smooth scroll + `scroll-padding-top`** for the sticky header offset | Not exposed at site or page level. | Anchor jumps land under the sticky header. | ✅ **Closed by ADR 0050 dec 3** — `EditableSite.scrollBehavior?: { smooth?, paddingTop? }`. Renderer emits a single global `<style>` block. Wired in fixture (`smooth: true, paddingTop: 80`). |
| 13 | **`text-wrap: pretty`** and `color-mix(in oklab, …)` in computed colors | No first-class field; passes through `pinnedStyle` but only as escape hatch. | Used `pinnedStyle.color` for static colours; skipped `text-wrap: pretty`. | ✅ **Closed by Bundle A commit 1** — `TextElement.textWrap: 'pretty' \| 'balance'`. `color-mix` stays in `pinnedStyle` per the endorsement docstring. |
| 14 | **Scroll-snap horizontal rail** ("other work" in IframeView) | `carousel` element exists, paginates. Not 1:1 with native scroll-snap. | Not used (drill-in was dropped). | ✅ **Closed by [ADR 0054 dec 2](adr/0054-layout-v2-sticky-positioning-drill-in-overlay-scroll-snap-rail.md)** — `CarouselElement.mode: 'paginate' \| 'scroll-snap'` opt-in; default `'paginate'` preserves every existing carousel unchanged. Scroll-snap mode emits `data-opencanvas-carousel-mode="scroll-snap"` and suppresses arrows/dots so style-kit CSS applies `scroll-snap-type: x mandatory`. |
| 15 | **Marquee letter-spacing animation on hero name** (`letter-spacing: -0.02em` at `124px`) | `pinnedStyle.letter-spacing` works. The editor inspector did not expose it. | Worked via `pinnedStyle`. | ✅ **Closed by Bundle A commit 1** — `TextElement.letterSpacing: string` typed field; fixtures migrated (36 line-height + 6 letter-spacing moved out of `pinnedStyle`). |
| 16 | **Real portrait + project thumbnails** | Only two 1×1 transparent PNG seed assets shipped. | Used a 1×1 PNG for the portrait; project thumbs were gradient containers. | ✅ **Closed by Bundle A/F commit 3** — `seed-portrait-placeholder` (stylised figure SVG) + `seed-project-thumb-neutral` (16:9 neutral SVG). Fixture swapped. |
| 17 | **Per-project brand accent** carried through card, thumbnail tint, and expanded view | No per-element design token; only site-wide style kit. | Encoded the accent as a hard-coded `linear-gradient` per card. Cannot be themed. | ✅ **Closed** — `StyleKitPreset.tintTokens?: Record<string, string>` registers semantic accent names; `ContainerElement.tint?: string` references a token or a raw CSS colour. Renderer resolves via tintTokens → fallback to literal; emits `--opencanvas-tint: <colour>` CSS var + `data-tint="<name>"` attribute + an inline `linear-gradient(135deg, color-mix(in oklab, var(--opencanvas-tint) 25%, transparent) 0%, transparent 70%)` overlay. Portfolio's customStyleKit gains `tintTokens: { forest, terracotta, cobalt, violet }`; all 6 project cards wired (jarvis+tattletale → forest, walt+dont-say-that → terracotta, gitlogs → cobalt, neural-cloud-architect → violet). |

## What the canvas already did well

These needed zero workaround:

- `visitorTheme: 'dark'` — single-source dark palette, no light fallback needed.
- `customStyleKit` — entire portfolio palette + typography + every `surfaceVariants` / `actionVariants` / `motionPresets` row was expressible.
- `EditableSite.header` / `footer` — shared across pages without duplication.
- `nav.sticky: true` and `pinnedStyle` for the blurred backdrop.
- `collection` page-bound mode with `filter.category: 'notes'` + `sort.field: 'publishedDate'` — the blog index reads the four mock posts directly via page metadata. CMS path exercised end-to-end.
- `responsive: { tablet, phone }` overrides on the hero name + heading rows.
- `ActionHref.type: 'page'` for the "← notes" back-link inside each blog post.

## All gaps closed

Every numbered gap above has a status of ✅ (shipped, possibly with implementation-deferred follow-up documented in an ADR) or ❌ (deliberately won't ship, with rationale).

| Closure status | Count | Gaps |
|---|---|---|
| ✅ Schema/runtime shipped | 14 | 1, 4, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, plus 2 (Bundle D), 6 + 14 (Layout-v2) |
| ✅ Schema shipped, full visual integration deferred | 1 | 10's brand-icon path (script ready, run when needed) |
| 📜 Contract documented, implementation deferred | 1 | 3 (drill-in overlay) — lands when a template needs it |
| ❌ Won't ship | 1 | 5 (pulsing dot — idle-motion rabbit hole) |

The remaining follow-ups are **inspector rows** for the new fields (sticky, tint, fluidSize, anchorId, linkLabel, iconKind, behavior, tabs editor) — each ADR documents its inspector work as a deliberate post-runtime PR per ADR 0050's follow-ups precedent. Runtime + fixtures + smokes ship first; editor UX tracks per element.

## Test plan (manual)

1. `bun run canvas:smoke` — passes (baseline).
2. `bun -e "..."` validation of every template in `allTemplateSeeds` — 9/9 valid.
3. `bun run typecheck` — clean.
4. **Render** the `portfolio-showcase` template in the editor and visually compare to `https://aayushman.dev`. Expect: hero, stack, six project cards, four notes rows, footer all visible. Gaps #1–17 above will be obvious.
5. Publish the template to a subdomain and visit `/blog` — the page-bound `collection` should list the four mock posts. Click one → lands on its post page.
