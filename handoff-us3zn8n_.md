# Handoff: 7 Inspector Panels for New Element Types + Demo Prep

## Focus for Next Session

Add inspector panels (property editors) for the 7 element types that were added to the editor's Add panel this session but have **no configuration UI** yet: Form, Embed, Code, Accordion, Carousel, Table, Nav. Then final demo polish for a presentation tomorrow.

## What Was Done This Session (cumulative across 3 sessions)

### Artifacts to Reference (do not re-derive)
| Artifact | Path |
|---|---|
| Feature catalog (43 areas) | `FEATURES.md` |
| Test report + UX audit | `DEMO_TEST_REPORT.md` |
| Previous handoffs | `handoff-gtf92vrm.md`, `handoff-11ibpu5j.md` |
| Domain language | `CONTEXT.md` |

### Bug Fixes Deployed (9)
B1-B7 (OG URLs, WebSocket backoff, Clerk iframes, placeholder 404s, HTML entities, site limit, template page gate), B8 (version-timeline route unmounted), R1 (search `tsv` column missing from Neon prod).

### UX Deployed (7)
1. Site-level sidebar navigation (9 links on all `/dashboard/sites/:id/*` pages)
2. All 14 element types in editor Add panel (7 new: Form, Embed, Code, Accordion, Carousel, Table, Nav)
3. AI Chat slide-out panel in editor (editor header button, SSE streaming, op-preview with Accept buttons)
4. AI Agent "AI" prompt button in editor header (opens modal → `runAiPreview`)
5. SEO link per page in editor Pages tab (links to `/dashboard/sites/:id/pages/:pageId/seo`)
6. Email notification on form submission (Resend, fire-and-forget)
7. Scroll-triggered entrance animations on published sites (IntersectionObserver + CSS transitions)

### Demo Data
- **Northstar Enterprise** (`test1.rev01.aayushman.dev`) — published v1, Enterprise Scale template, page description set
- **Meridian Studio** (`meridian.rev01.aayushman.dev`) — draft, Studio Portfolio template
- Profile bio: "Building tools for people who ship sites."
- Junk sites (oogabooga, test) deleted. 2 of 3 slots used on Free plan.

---

## The Task: 7 Inspector Panels

### How the Inspector System Works

When an element is selected, `renderInspector()` in `src/editor/canvas-client.ts` builds the property panel. The pattern (lines ~2680-2957):

```js
// After the shared heading, meta, kit summary, reorder, z-order...
if (element.type === "text") { /* text-specific controls */ }
if (element.type === "action") { /* variant, label, href */ }
if (element.type === "shape") { /* variant select */ }
if (element.type === "container") { /* variant select */ }
if (element.type === "media") { /* upload, alt, fit, kind */ }
if (element.type === "chart") { buildChartInspector(element); }
// Then motion controls (shared for all types)
```

**Helper functions:**
- `field(label, inputElement)` — wraps a label + input in a `.field` div (line 1976)
- `selectInput(options, selected)` — creates a `<select>` with string options (line 1986)
- `rebuildElement(elementId)` — re-renders the element on canvas after property change
- `scheduleSave()` — debounced PUT to `/api/canvas/sites/:siteId`
- `renderInspector()` — re-runs the full inspector build (call after structural changes)
- `newElementId()` — generates unique IDs for new sub-items (fields, rows, slides, etc.)

**Existing complex inspector** to model after: `buildChartInspector(element)` (line ~2955) — builds a data grid for series/categories. For the new panels, follow the same `if (element.type === "xxx") { ... }` pattern, inserting BEFORE the motion controls block (line ~2959).

### CRITICAL CONSTRAINT
**No backticks (`` ` ``) anywhere in `canvas-client.ts`.** The entire file body is a template literal. Use `"strings"` and `String.fromCharCode(10)` for newlines in generated JS strings. Escaped `\\n` in the TypeScript source becomes a literal newline in output (not the `\n` escape sequence) due to template literal processing. This already caused a syntax error earlier in this session.

### What Each Inspector Needs

#### 1. Form Inspector
Schema (`src/canvas/elements/form.ts`):
```ts
fields: FormFieldDef[]  // {id, label, kind, required, placeholder?, options?}
submitLabel: string
successMessage: string
webhookUrl?: string
```
- Field list with add/remove/reorder
- Per-field: label (text input), kind (select: text/email/textarea/checkbox/select), required (checkbox), placeholder (text)
- For `kind === "select"`: options editor (comma-separated or add/remove)
- Submit label (text input)
- Success message (text input)
- Webhook URL (text input, optional)

#### 2. Embed Inspector
Schema (`src/canvas/elements/embed.ts`):
```ts
url: string
title?: string
aspectRatio?: number  // default 16/9
```
- URL input (text, placeholder "https://youtube.com/...")
- Title input (text, optional)
- Aspect ratio select: 16:9, 4:3, 1:1, 21:9

#### 3. Code Inspector
Schema (`src/canvas/elements/code.ts`):
```ts
language: CodeLanguage  // "typescript"|"javascript"|"python"|"rust"|"go"|"json"|"bash"|"sql"|"html"|"css"|"markdown"
source: string
showLineNumbers: boolean
```
- Language select (11 options)
- Source textarea (multi-line code editor)
- Show line numbers checkbox
- **IMPORTANT**: source may contain newlines — use `String.fromCharCode(10)` when setting default values, never `\n`

#### 4. Accordion Inspector
Schema (`src/canvas/elements/accordion.ts`):
```ts
items: AccordionItem[]  // {id, title, body: InlineRun[]}
allowMultipleOpen: boolean
```
- Item list with add/remove
- Per-item: title (text input), body (text input — simplified from InlineRun[] to plain text for the inspector)
- Allow multiple open (checkbox)

#### 5. Carousel Inspector
Schema (`src/canvas/elements/carousel.ts`):
```ts
slides: CarouselSlide[]  // {id, assetId, caption?, href?}
showArrows: boolean
showDots: boolean
```
- Slide list with add/remove
- Per-slide: caption (text), href (text, optional) — asset picker is aspirational, skip for now
- Show arrows checkbox
- Show dots checkbox

#### 6. Table Inspector
Schema (`src/canvas/elements/table.ts`):
```ts
columns: TableColumn[]  // {id, header, align?}
rows: TableRow[]        // {id, cells: Record<string, string>}
zebra: boolean
collapseOnPhone: boolean
```
- Column headers editor (add/remove columns)
- Row × column cell grid (text inputs)
- Zebra striping checkbox
- Collapse on phone checkbox

#### 7. Nav Inspector
Schema (`src/canvas/elements/nav.ts`):
```ts
links: NavLink[]   // {label, href, kind: "internal"|"external"|"anchor"}
layout: NavLayout  // "left-center-right"|"left-right"
sticky: boolean
logoAssetId?: string
```
- Link list with add/remove
- Per-link: label (text), href (text), kind (select: internal/external/anchor)
- Layout select (2 options)
- Sticky checkbox
- Logo asset ID (text, optional)

### Implementation Approach

All 7 inspectors go in `src/editor/canvas-client.ts`. Insert them after the chart inspector block (after `buildChartInspector`) and before the motion controls block. Each should be a self-contained `if (element.type === "xxx") { ... }` block.

For list editors (form fields, accordion items, carousel slides, table rows, nav links), the pattern:
1. Render current items as a vertical list of inputs
2. "Add" button at the bottom
3. Per-item "Remove" button
4. On any change: mutate `element` in place → `rebuildElement(element.id)` → `scheduleSave()` → `renderInspector()` (to rebuild the list)

For the table inspector specifically, rendering a grid of cells is more complex — follow the `buildChartInspector` pattern (series × categories grid).

### Remaining Demo Prep

After inspectors are done:
1. Add a Form + Accordion + Chart to Northstar Enterprise via the editor and publish it — proves interactive elements on the live site
2. Verify scroll animations work on the published site
3. Test AI chat end-to-end (requires `GEMINI_API_KEY` in wrangler secrets)
4. Final screenshot sweep

## Constraints

- **No backticks in canvas-client.ts** — the entire function body is a template literal
- **No `\n` in strings** — use `String.fromCharCode(10)` or avoid newlines entirely
- **No fallbacks** — fail loudly or fix the root cause
- **Conventional commits** — `feat:`, `fix:`, etc.
- **Test against production** — `rev01.aayushman.dev`
- `npx tsc --noEmit` must pass before deploy
- `npx wrangler deploy` to ship

## Suggested Skills

- `/superpowers:dispatching-parallel-agents` — the 7 inspectors are independent; dispatch one agent per inspector
- `/superpowers:verification-before-completion` — typecheck + deploy + browser verify before claiming done
- `/verify` — test inspector panels work in the real editor
