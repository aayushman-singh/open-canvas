# Portfolio template — capability gaps

Surfaced while porting `C:/Repo/portfolio` 1:1 into `src/canvas/fixtures/portfolio-showcase.json`. Each row is a thing the portfolio does that the canvas could not express cleanly; the port either approximated or skipped. Ordered by how visible the loss is in the rendered template.

| # | Portfolio capability | Canvas today | Port did | Suggested fix |
|---|---|---|---|---|
| 1 | **Fluid type** — `clamp(64px, 9vw, 132px)` on the hero name | `TextElement.fontSize: number` (px). Per-breakpoint `responsive.{tablet,phone}.w/h` only — no fluid font size. | Pinned `fontSize: 124` at desktop, smaller `w/h` at tablet/phone. | Add `fontSize` to `ResponsiveBoxOverride` OR a `fluidFontSize: { min, max, viewportFactor }` field on `TextElement`. |
| 2 | **Tabs** — `<button role="tab">` switching panels (Stack / Work / Notes) | No tab element. `accordion` collapses; doesn't swap. | Rendered all three as back-to-back sections with `01 / 02 / 03` index labels. Loses the tab UX entirely. | New `tabs` element OR a section-level `displayMode: 'tabs'` that hides siblings until one is selected. |
| 3 | **Iframe project drill-in** — clicking a card opens a full-screen overlay with an `<iframe>` + sidebar | No modal / overlay primitive. `embed` can host the iframe but only as a page-level element. | Cards link out to the live URL (`open →`). No in-app drill-in. | `popup` section type already exists for forms — extend its trigger to `'element-click'` keyed to the card. |
| 4 | **Sticky topnav with `backdrop-filter: blur(14px) saturate(1.2)`** | `header` section + `nav` element with `sticky: true` exists. `pinnedStyle` carries `backdrop-filter` through. | Worked via `pinnedStyle`. The render path needs to honour the camelCase form too (`backdropFilter`) for editor parity. | First-class fields on `NavElement`: `sticky`, `backdropBlur`, `scrolledBackground`. |
| 5 | **Pulsing status dot** — `@keyframes pulse-soft` running forever on the "consulting · advisory" indicator | `motion.preset` enums are one-shot entrance only (`fade-up`, `bounce-in`, …). `slow-drift` and `parallax-soft` are the only loops, and they're scroll-tied. | Used a static `circle` shape — dot does not pulse. | Add looping presets: `pulse`, `breathe`, `shimmer`. Wire to a `motion.loop: true` flag. |
| 6 | **Sticky right column** — portrait card pins via `position: sticky; top: 80px` while left column scrolls | Elements are absolute-positioned only. No `position: sticky`. | Portrait card sits at a fixed `y` and scrolls with the page. | `BaseElement.sticky?: { top: number }` — translator emits sticky positioning when set. |
| 7 | **Copy-to-clipboard action** — "copy" → "copied" pulse on the email tile + handles in the footer | `ActionElement.href` only (link). No JS behaviour. | Email tile is a plain `mailto:` link. Handles under the social tiles are not copyable. | `ActionElement.behavior: 'copy' \| 'open'` with `behavior.copyValue: string`. |
| 8 | **Rich CTA tiles** — icon + label + caption inside one click target ("github / /aayushman-singh") | `ActionElement.label: string` (plain text, no inline marks, no icon slot). | Used the label string only: `"github · /aayushman-singh"`. | `ActionElement.label: InlineRun[]`, plus `iconAssetId?: string` slot. |
| 9 | **`<a>` wrapping the whole card** — entire project card is one click target | An `action` covers its own bounds only. Stacking it across the card is fragile. | `open →` link at the bottom of each card. | New `ContainerElement.linkHref?: ActionHref` so a container becomes a wrapping anchor. |
| 10 | **Inline SVG icons** (GitHub mark, LinkedIn, X, email, copy, check) | `shape` is variant-bound (`circle`, `pill`, `blob` …). `media` works only with uploaded image/video assets. | Footer social tiles use letters (`GH`, `in`, `𝕏`, `@`) in `action.label`. Looks placeholder-y. | Either (a) ship the common social marks as seed assets, or (b) add an `iconKind` field on `ShapeElement` backed by an inline-SVG registry. |
| 11 | **Hash-deeplinkable in-page anchors** (`#about`, `#stack`, `#work`, `#contact`) | Nav links support `href` but the renderer does not auto-emit `id="..."` on sections or elements for smooth-scroll targets. | Header links `#about` / `#work` / `#contact` are wired but won't scroll anywhere — no matching id is emitted. | Auto-emit `id` from `CanvasSection.slug` (new field) and from `BaseElement.anchorId` for elements. |
| 12 | **Smooth scroll + `scroll-padding-top`** for the sticky header offset | Not exposed at site or page level. | Anchor jumps land under the sticky header. | `EditableSite.scrollBehavior?: { smooth: boolean; padTopPx: number }`. |
| 13 | **`text-wrap: pretty`** and `color-mix(in oklab, …)` in computed colors | No first-class field; passes through `pinnedStyle` but only as escape hatch. | Used `pinnedStyle.color` for static colours; skipped `text-wrap: pretty`. | First-class `TextElement.wrap?: 'pretty' \| 'balance'`; document `pinnedStyle` as the supported escape. |
| 14 | **Scroll-snap horizontal rail** ("other work" in IframeView) | `carousel` element exists, paginates. Not 1:1 with native scroll-snap. | Not used (drill-in was dropped). When the drill-in feature lands, evaluate `carousel` vs. a new `rail` element. | Either reuse `carousel` with a `mode: 'scroll-snap'` flag or add a `rail` element. |
| 15 | **Marquee letter-spacing animation on hero name** (`letter-spacing: -0.02em` at `124px`) | `pinnedStyle.letter-spacing` works. The editor inspector does not expose it. | Worked via `pinnedStyle`. | Add `letterSpacing?: string` to `TextElement` and expose in the inspector. |
| 16 | **Real portrait + project thumbnails** | Only two 1×1 transparent PNG seed assets ship (`seed-hero-poster-1`, `seed-feature-canvas-1`). | Used the seed asset for the portrait; project thumbs are tinted `linear-gradient` containers per-project accent colour. Looks template-y but flag is real. | Add seed assets for: portrait, six project thumbs, optional brand mark. Author-time replaceable. |
| 17 | **Per-project brand accent** carried through card, thumbnail tint, and expanded view | No per-element design token; only site-wide style kit. | Encoded the accent as a hard-coded `linear-gradient` per card. Cannot be themed. | `ContainerElement.tint?: string` resolved by the renderer against the active style kit. |

## What the canvas already did well

These needed zero workaround:

- `visitorTheme: 'dark'` — single-source dark palette, no light fallback needed.
- `customStyleKit` — entire portfolio palette + typography + every `surfaceVariants` / `actionVariants` / `motionPresets` row was expressible.
- `EditableSite.header` / `footer` — shared across pages without duplication.
- `nav.sticky: true` and `pinnedStyle` for the blurred backdrop.
- `collection` page-bound mode with `filter.category: 'notes'` + `sort.field: 'publishedDate'` — the blog index reads the four mock posts directly via page metadata. CMS path exercised end-to-end.
- `responsive: { tablet, phone }` overrides on the hero name + heading rows.
- `ActionHref.type: 'page'` for the "← notes" back-link inside each blog post.

## Test plan (manual)

1. `bun run canvas:smoke` — passes (baseline).
2. `bun -e "..."` validation of every template in `allTemplateSeeds` — 9/9 valid.
3. `bun run typecheck` — clean.
4. **Render** the `portfolio-showcase` template in the editor and visually compare to `https://aayushman.dev`. Expect: hero, stack, six project cards, four notes rows, footer all visible. Gaps #1–17 above will be obvious.
5. Publish the template to a subdomain and visit `/blog` — the page-bound `collection` should list the four mock posts. Click one → lands on its post page.
