# Canvas-First POC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild rev01 as a desktop canvas site builder where an owner creates one template-based site, edits positioned text/media/actions/shapes/containers, switches deterministic style kits, previews AI edits, publishes a whole-site snapshot, and open visitor tabs at the published address update immediately.

**Architecture:** Keep the existing Cloudflare Worker, Hono routes, Clerk auth, Drizzle/Neon store, and Gemini adapter pattern. Replace the legacy flow-document page model with canvas JSON: a site has canvas pages, each page has ordered canvas sections, each section has positioned design primitives. Publish promotes the current editable site into a stored published snapshot and broadcasts the new rendered HTML through a site Durable Object.

**Rich text scope (2026-05-22 amendment):** The old page-model editor remains retired. Rich text lives **only inside a `TextElement`** as a flat array of inline runs — no block structure (no paragraphs/lists/blockquotes). The text element's `role` (heading / body / label), `fontSize`, `fontWeight`, `align`, and `box` are unchanged; what changes is the content shape. See "Rich Text Content Model" below for the exact contract; Task 4.5 retrofits Task 1's schema/validator/renderer/fixture and Task 4's editor to honour it before Task 5 ships publish.

**Tech Stack:** Cloudflare Workers, Hono JSX, Drizzle ORM, Neon serverless Postgres, Clerk, Durable Objects, vanilla browser JS, Gemini adapter via `@google/genai`.

---

## Rich Text Content Model

A `TextElement` holds a flat array of inline runs. There are no block-level nodes — the text element itself is one visual paragraph whose box, alignment, font size, and role come from the surrounding `TextElement` fields.

```ts
export const INLINE_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'highlight',
  'link',
] as const;
export type InlineMarkType = (typeof INLINE_MARK_TYPES)[number];

export type InlineMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'highlight' }
  | { type: 'link'; href: string };

export interface InlineRun {
  text: string; // raw text, no HTML; newlines are literal U+000A
  marks?: InlineMark[]; // 0..N marks; order is style-irrelevant but must be deduplicated by type (link allowed once)
}

// Replaces the prior `text: string` field on TextElement:
export interface TextElement extends BaseElement {
  type: 'text';
  content: InlineRun[]; // 1..N runs; the concatenation of run.text is the plain-text projection
  role: 'heading' | 'body' | 'label';
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  align: 'left' | 'center' | 'right';
}
```

**Rules (validator must enforce):**

- `content` is a non-empty array. Each run has `text: string` (may be empty `''` for a marks-only placeholder run only if it is not the sole run; the concatenated plain text across the element must not be empty).
- Each mark's `type` must be in `INLINE_MARK_TYPES`. Unknown mark types → rejected.
- `marks` array within a run may not contain two marks of the same `type` (a run is either bold or not — no duplicates).
- `link` marks carry an `href` that follows the same allowlist as `ActionElement.href`: only `http:` / `https:` / `mailto:` / `tel:` / `#anchor` / relative `/...`. `javascript:` and `data:` schemes rejected.
- Any role may contain any mark (heading + link is allowed by design).
- Validator must walk `content` BEFORE element-level shape checks if the structure is malformed; errors stay collected, not first-only.

**Renderer (`src/canvas/render.ts`):**

- Pick the outer tag from `role` (`h1` / `p` / `span`) exactly as before.
- Inside the outer tag, emit one `<span>` per run. Apply marks by nesting tags in a stable order: `<a>` outermost (if `link` present), then `<strong>`, `<em>`, `<u>`, `<s>`, `<mark>`, `<code>` innermost. The order is fixed so identical content arrays always produce identical HTML — needed for diff stability and snapshot rendering.
- A run with no marks emits a bare `<span>{escaped text}</span>` (the `<span>` is kept for stable DOM addressing in the editor).
- Escape all text + href values with the existing `escapeHtml` / `escapeAttr` helpers.
- A run whose marks include `link` must render `<a href="{escaped}" class="rev01-inline-link">{nested marks}</a>`. The link must respect the same security posture as `ActionElement` rendering.

**Editor (`src/editor/canvas-client.ts`):**

- Double-clicking a text element makes its outer role tag `contenteditable="true"`. The DOM that goes into edit mode is the renderer's run-span structure, so the browser's native rich-text editing operates on real `<strong>`/`<em>`/`<u>`/`<s>`/`<mark>`/`<code>`/`<a>` elements.
- A small inline mark toolbar appears next to the selected text element while editing, with seven buttons matching `INLINE_MARK_TYPES` (link prompts for an href). Each button calls `document.execCommand` for the simple marks and a custom handler for `link` (wraps current selection in `<a>` with sanitised href). `code` and `highlight` wrap selection in `<code>` / `<mark>` via Range APIs because `execCommand` does not cover them.
- Blur (or Cmd+Enter / explicit Done) serialises the current DOM back to `InlineRun[]` via a small reader: walk children, accumulate active marks per `Range.startContainer` text node, emit one run per maximal active-mark stretch. Escape, Cancel, and the existing edit-cancel restore the pre-edit `content` snapshot.
- Owner-facing keyboard shortcuts: Cmd/Ctrl+B/I/U/Shift+X (strike) call the same toolbar handlers. Cmd/Ctrl+K opens link prompt.
- The owner-facing serializer must never produce a run with an empty `text` AND zero marks (drop it), must never produce two adjacent runs with byte-identical marks (merge them), and must never produce a `link` mark whose `href` fails the validator allowlist (refuse the save with status `Link rejected: {reason}`).

**AI rewrite ops (`src/agent/canvas-ops.ts`):**

- `rewriteText` op signature becomes `{ kind: 'rewriteText'; elementId: string; content: InlineRun[] }` — not `text: string`.
- The LLM tool `rewriteText(elementId, content)` accepts the run array directly. The tool's schema description must instruct the model to produce the run array, with examples showing bold and link marks.
- The preview endpoint dry-runs `applyCanvasAgentOp` then `validateCanvasSiteState`; an invalid run array (e.g. forbidden mark type or bad link href) is rejected loudly.
- A "plain string in, runs out" convenience helper is NOT added — the agent always speaks the rich-text contract.

**Fixture (`src/canvas/fixtures/home.json`):**

- All text elements gain `content` arrays. At least one element exercises multiple marks (e.g. hero-heading contains a `bold` run and a non-bold run); at least one run carries a `link` mark with an `http` href so the validator and renderer cover the link path.

**Out of scope (do NOT add):**

- Block-level nodes (paragraphs/lists/blockquotes) inside a text element.
- Per-character inline styles other than the seven marks (no inline colour, font, size, alignment — those are element-level).
- Nested marks beyond what's enumerated.
- Backwards-compatibility shims to accept the old `text: string` shape.

---

## Canvas Invariants (2026-05-22 round 2 amendment)

These are the cross-cutting invariants the POC commits to. They override looser language in earlier tasks; retrofits in Tasks 5.5 / 5.6 / 5.7 land the code. Later tasks (6, 7, 8, 9) inherit them.

### Single-page POC

- Every `CanvasSiteState` and `PublishedSnapshot` has **exactly one** `CanvasPage`. The validator rejects 0 pages and 2+ pages. The dashboard, the canvas editor, the canvas API, the publish endpoint, and the agent ops all treat `state.pages[0]` as canonical and never index further.
- Page URLs do not appear in the editor route, publish endpoint, or AI ops. The plan's `pages[]` array is retained in the schema as a forward-compat shape, but the validator pins length to 1.
- If a future task wants multi-page, it must change the validator first.

### Surface vs. container

- `ContainerElement` is **not** a content container — it has no `children`. It is a **surface primitive** (a card/panel/frame). Its purpose is decoration and composition by sibling overlap on the canvas. The class name in the rendered HTML is `rev01-surface` (already the case in the renderer). The schema retains `ContainerElement` for backwards source-compatibility; the canonical conceptual name in code comments and docs is "surface". Renaming the symbol is deferred to T9 if we keep the POC alive.
- Surfaces and shapes are **decorative by default**. In the published renderer they are emitted with `aria-hidden="true"` and `role="presentation"` so assistive tech skips them. (Owners can author a pinned `aria-label` if they ever need to override — outside POC scope.)
- Future "true container with children" work is out of POC scope. Do not add `children: CanvasElement[]` to `ContainerElement`.

### Reading order & accessibility

- Visitors do not see absolute positions — they hear DOM order. The published renderer emits elements per section in the order `section.elements[]` is stored. The Owner-side toolbar must therefore expose explicit "reorder element" controls (T4.6) so the Owner can shape reading order independent of visual z/x/y.
- Within each canvas section, semantically meaningful elements (text, media, action) are emitted in `elements[]` order, with decorative shapes/surfaces emitted in the same order but with `aria-hidden`. Page-level outer wrapper has `lang="en"`. Each section has `<section>` role inherited from the tag; we do NOT auto-assign `<header>`/`<main>`/`<nav>` — Section Recipes (T7) are the place to enforce a single `<main>`-like landmark if needed.
- Focusable elements (actions, links inside text) receive `tabindex` only when explicitly needed; defaults are honoured. Action elements render as `<a>` (already done). Link marks inside text are `<a>` (already done).

### Section recipes are constrained shapes

- A `Section Recipe` (`SectionRecipeId` enum + a per-recipe factory) is the **only** way the agent creates a new section. The agent never authors a freeform `CanvasSection` object. The recipe registry is implemented in T7 (`src/canvas/recipes.ts`) and lives alongside the validator. Each recipe is a pure factory `(brief: string, styleKit: StyleKit) => CanvasSection` that produces a fully-formed section with deterministic ids (prefix `sec-{recipe}-` + random suffix) and bounded element counts.
- Owner-authored sections (from the toolbar in T4) are also pinned to a starting recipe — when the Owner clicks "Add Section", they pick a recipe id; the editor calls the same factory, then lets the Owner freely modify the result. The factory enforces shape; the validator enforces content; the Owner enforces taste.

### Style Kit depth

- A `Style Kit` is a curated visual system, not a colour set. The T8 preset table must cover, per kit:
  - Colour tokens: `bg`, `panel`, `text`, `muted`, `accent`, `accentText` (text on accent surfaces).
  - Typography tokens: `fontFamilyDisplay`, `fontFamilyBody`, `fontFamilyMono`, three role-specific font-size scales (`headingScale`, `bodyScale`, `labelScale`), and one `lineHeight` base.
  - Surface tokens: `radius`, `borderWidth`, `shadow`, and a per-variant tweak map for the seven surface variants (so a `glass` surface in `orange-editorial` looks different from `glass` in `blue-saas`).
  - Shape tokens: `shapeFill`, `shapeStrokeWidth`, `shapeAccent`.
  - Action tokens: `actionRadius`, `actionPadding`, plus variant-specific overrides for `pill` / `brutalist` / `underline` (per the seven action variants).
  - Motion tokens: `motionDurationMs`, `motionEasing`, plus a per-preset `defaultDelayMs` for the eight motion presets.
- The renderer applies these as CSS custom properties on the page wrapper. Both the editor and the public renderer consume the same preset map; there is exactly one definition (`src/canvas/style-kits.ts`). T8 lands the full preset table.

### Seed media policy

- A site created from a Template Seed gets a working set of `siteAsset` rows. The template's fixture references asset ids; T6 materialises real bytes for each seed asset id so a new site never has dangling media.
- T6 makes the publish endpoint and the public asset route respect this: visitors only see assets referenced by the current `publishedSnapshot`, regardless of which assets exist for the editable site.

### Fail-loud, no fallbacks

- All validators reject silently-broken shapes (unknown asset ids, dangling section recipe ids, mark drift, etc.). The publish endpoint refuses to publish a state that would reference a non-existent asset.
- The agent preview endpoint refuses ops that would land an invalid state. There is no "best effort" preview that ignores invalid runs.
- The public router never falls back to "looks like" matches. A subdomain either resolves to a published site or it 404s.

---

## File Structure

Create:

- `src/canvas/schema.ts` - canonical canvas JSON types, deterministic style kits, design primitives, motion presets, and section recipes.
- `src/canvas/validate.ts` - pure validator for canvas pages, style kits, primitives, media, motion, and snapshots.
- `src/canvas/render.ts` - pure renderer from published snapshot to HTML.
- `src/canvas/fixtures/home.json` - one seed canvas page.
- `src/canvas/smoke.ts` - validates fixture and renderer output.
- `src/live/site-room.ts` - Durable Object for visitor publish broadcasts and lightweight presence.
- `src/routes/public.ts` - host-based published-address resolver and public site renderer.
- `src/routes/api/canvas.ts` - owner APIs for loading/saving editable canvas state.
- `src/routes/api/publish.ts` - owner publish endpoint.
- `src/editor/canvas-index.tsx` - server-rendered editor shell.
- `src/editor/canvas-client.ts` - inline browser module for canvas editing.
- `src/editor/canvas-styles.ts` - desktop editor styling.
- `src/agent/canvas-ops.ts` - previewable AI canvas operations.
- `src/agent/canvas-tools.ts` - constrained LLM tool definitions for canvas edits.
- `src/routes/api/canvas-agent.ts` - AI preview endpoint.
- `src/assets/site-assets.ts` - site asset helpers and response serialization.

Modify:

- `src/db/schema.ts` - replace document-shaped page fields with canvas fields; add subdomain, published snapshot fields, and site assets.
- `src/templates/registry.ts` - collapse to one canvas template seed.
- `src/routes/api/sites.ts` - fix auth middleware and create a canvas site with subdomain.
- `src/routes/dashboard/index.tsx` - point to the canvas editor and public address.
- `src/routes/dashboard/templates.tsx` - become a one-template creation screen.
- `src/index.ts` - wire canvas routes, public host router, and `SiteRoom`; remove old editor/page routes from the POC path.
- `wrangler.toml` - bind `SITE_ROOM`; document wildcard route expectation.
- `package.json` - add canvas smoke scripts and retire old document/multiplayer smoke scripts after the reset lands.
- `README.md`, `RECON.md`, `src/*/SUBSYSTEM.md` - align public docs with canvas-first POC.

Retire after replacement is passing:

- `src/document/*`
- `src/multiplayer/*`
- old `src/editor/client.ts`, `src/editor/index.tsx`, `src/editor/styles.ts`
- old flow-document imports and dependencies

---

### Task 1: Canvas Domain Model And Validator

**Files:**

- Create: `src/canvas/schema.ts`
- Create: `src/canvas/validate.ts`
- Create: `src/canvas/fixtures/home.json`
- Create: `src/canvas/smoke.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the canvas schema**

Create `src/canvas/schema.ts`:

```ts
export const STYLE_KITS = ['charcoal', 'orange-editorial', 'blue-saas', 'green-organic'] as const;
export type StyleKit = (typeof STYLE_KITS)[number];

export const ELEMENT_TYPES = ['text', 'media', 'action', 'shape', 'container'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const ACTION_VARIANTS = [
  'solid',
  'outline',
  'ghost',
  'pill',
  'glass',
  'brutalist',
  'underline',
] as const;
export type ActionVariant = (typeof ACTION_VARIANTS)[number];

export const SURFACE_VARIANTS = [
  'flat',
  'raised',
  'glass',
  'outlined',
  'sticker',
  'editorial-frame',
  'soft-panel',
] as const;
export type SurfaceVariant = (typeof SURFACE_VARIANTS)[number];

export const SHAPE_VARIANTS = ['rect', 'pill', 'circle', 'line', 'badge', 'blob'] as const;
export type ShapeVariant = (typeof SHAPE_VARIANTS)[number];

export const MOTION_PRESETS = [
  'none',
  'fade-up',
  'slide-left',
  'scale-in',
  'blur-in',
  'stagger-children',
  'slow-drift',
  'parallax-soft',
] as const;
export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const SECTION_RECIPE_IDS = [
  'hero-split',
  'feature-grid',
  'gallery-strip',
  'cta-band',
  'logo-strip',
  'testimonial-row',
  'video-hero',
] as const;
export type SectionRecipeId = (typeof SECTION_RECIPE_IDS)[number];

export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasSize {
  w: number;
  h: number;
}

export interface PositionedBox extends CanvasPoint, CanvasSize {
  rotation?: number;
  z: number;
}

export interface BaseElement {
  id: string;
  type: ElementType;
  box: PositionedBox;
  motion?: { preset: MotionPreset; delayMs?: number };
  pinnedStyle?: Record<string, string>;
}

export interface TextElement extends BaseElement {
  type: 'text';
  text: string;
  role: 'heading' | 'body' | 'label';
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  align: 'left' | 'center' | 'right';
}

export interface MediaElement extends BaseElement {
  type: 'media';
  mediaKind: MediaKind;
  assetId: string;
  posterAssetId?: string;
  alt: string;
  fit: 'cover' | 'contain';
  playback?: {
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    controls?: boolean;
  };
}

export interface ActionElement extends BaseElement {
  type: 'action';
  label: string;
  href: string;
  variant: ActionVariant;
}

export interface ShapeElement extends BaseElement {
  type: 'shape';
  variant: ShapeVariant;
}

export interface ContainerElement extends BaseElement {
  type: 'container';
  variant: SurfaceVariant;
}

export type CanvasElement =
  | TextElement
  | MediaElement
  | ActionElement
  | ShapeElement
  | ContainerElement;

export interface CanvasSection {
  id: string;
  recipeId: SectionRecipeId;
  name: string;
  height: number;
  backgroundEffect?: 'none' | 'grain' | 'grid' | 'soft-light' | 'paper' | 'glass';
  entrance?: MotionPreset;
  elements: CanvasElement[];
}

export interface CanvasPage {
  id: string;
  slug: string;
  title: string;
  width: number;
  sections: CanvasSection[];
}

export interface CanvasSiteState {
  styleKit: StyleKit;
  pages: CanvasPage[];
}

export interface PublishedSnapshot {
  version: number;
  publishedAt: string;
  styleKit: StyleKit;
  pages: CanvasPage[];
}
```

- [ ] **Step 2: Add validator tests through a smoke file first**

Create `src/canvas/fixtures/home.json` with one page, three sections, and at least one text, media image, media video, action, shape, and container element. Use stable ids like `page-home`, `section-hero`, `hero-heading`, `hero-media`, `hero-action`, `hero-video`, `hero-orb`, `hero-card`.

Create `src/canvas/smoke.ts`:

```ts
import fixture from './fixtures/home.json';
import { renderCanvasSnapshot } from './render';
import type { CanvasSiteState, PublishedSnapshot } from './schema';
import { validateCanvasSiteState, validatePublishedSnapshot } from './validate';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const editable = fixture as CanvasSiteState;
const editableResult = validateCanvasSiteState(editable);
assert(editableResult.valid, editableResult.valid ? '' : editableResult.errors.join('; '));

const snapshot: PublishedSnapshot = {
  version: 1,
  publishedAt: '2026-05-22T00:00:00.000Z',
  styleKit: editable.styleKit,
  pages: editable.pages,
};
const publishedResult = validatePublishedSnapshot(snapshot);
assert(publishedResult.valid, publishedResult.valid ? '' : publishedResult.errors.join('; '));

const html = renderCanvasSnapshot(snapshot, '/assets');
assert(html.includes('data-rev01-page="page-home"'), 'expected rendered home page marker');
assert(html.includes('data-rev01-section="section-hero"'), 'expected rendered hero section marker');
assert(html.includes('data-rev01-element="hero-heading"'), 'expected rendered heading marker');
assert(html.includes('data-rev01-media-kind="video"'), 'expected rendered video media marker');

console.log('[canvas:smoke] OK');
```

- [ ] **Step 3: Implement the validator**

Create `src/canvas/validate.ts` with `validateCanvasSiteState` and `validatePublishedSnapshot`. It must reject:

- unknown style kit
- unknown element type
- unknown action, surface, shape, media, or motion variant
- no pages
- page width outside `960..1920`
- no sections
- section height outside `240..1400`
- duplicate ids in a page
- element boxes with negative `x`, `y`, `w`, or `h`
- elements extending beyond the page width
- media elements without `assetId`
- video media elements with autoplay enabled and muted disabled
- action elements with executable URLs

- [ ] **Step 4: Add a temporary renderer stub sufficient for the smoke to fail for the right reason**

Create `src/canvas/render.ts`:

```ts
import type { PublishedSnapshot } from './schema';

export function renderCanvasSnapshot(_snapshot: PublishedSnapshot, _assetBasePath: string): string {
  throw new Error('renderCanvasSnapshot red-test sentinel');
}
```

- [ ] **Step 5: Run the smoke and confirm it fails on renderer implementation**

Run: `bun.cmd run src/canvas/smoke.ts`

Expected: FAIL with `renderCanvasSnapshot red-test sentinel`.

- [ ] **Step 6: Implement enough rendering to pass**

Implement `renderCanvasSnapshot` as a pure HTML string renderer. It should:

- wrap all pages in `<main class="rev01-site" data-style-kit="...">`
- render sections with `position:relative;width:...px;height:...px`
- render elements as absolutely positioned nodes using their `box`
- render media elements as `<img>` or `<video>` using `/assets/:assetId`
- render action, shape, and container variants with `data-variant`
- emit section and element motion attributes/classes from curated motion presets
- escape text and attributes

- [ ] **Step 7: Add script**

Modify `package.json`:

```json
"canvas:smoke": "bun run src/canvas/smoke.ts"
```

- [ ] **Step 8: Verify**

Run:

```bash
bun.cmd run canvas:smoke
bun.cmd run typecheck
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add package.json src/canvas
git commit -m "feat: add canvas document model"
```

---

### Task 2: Database Shape, Single Template Seed, And Site Creation

**Files:**

- Modify: `src/db/schema.ts`
- Modify: `src/templates/registry.ts`
- Modify: `src/routes/api/sites.ts`
- Modify: `src/routes/dashboard/templates.tsx`
- Test: `src/review-smoke.ts`

- [ ] **Step 1: Replace document-specific DB types**

Modify `src/db/schema.ts` imports to use canvas types:

```ts
import type { CanvasSiteState, CanvasPage, PublishedSnapshot, StyleKit } from '../canvas/schema';
```

Update `site` with:

```ts
subdomain: text('subdomain').notNull().unique(),
styleKit: text('style_kit').notNull().$type<StyleKit>(),
editableState: jsonb('editable_state').notNull().$type<CanvasSiteState>(),
publishedSnapshot: jsonb('published_snapshot').$type<PublishedSnapshot | null>(),
publishedVersion: integer('published_version').notNull().default(0),
```

Keep `name`, `customerId`, timestamps. Keep `page` only if needed for old migrations during transition, but stop new code from using it.

Add `siteAsset`:

```ts
export const siteAsset = pgTable('site_asset', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  siteId: text('site_id')
    .notNull()
    .references(() => site.id, { onDelete: 'cascade' }),
  mediaType: text('media_type').notNull(),
  bytesBase64: text('bytes_base64').notNull(),
  kind: text('kind').notNull().$type<'image' | 'video'>(),
  alt: text('alt').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Collapse templates to one canvas seed**

Modify `src/templates/registry.ts` to export:

```ts
import seed from '../canvas/fixtures/home.json';
import type { CanvasSiteState } from '../canvas/schema';

export interface TemplateSeed {
  id: 'starter-canvas';
  name: string;
  tagline: string;
  state: CanvasSiteState;
}

export const starterTemplate: TemplateSeed = {
  id: 'starter-canvas',
  name: 'Starter Canvas',
  tagline:
    'A desktop canvas site with editable sections, text, media, actions, shapes, containers, style kits, and motion.',
  state: seed as CanvasSiteState,
};

export function getTemplateSeed(id: string): TemplateSeed | null {
  return id === starterTemplate.id ? starterTemplate : null;
}
```

- [ ] **Step 3: Fix auth middleware and create site from template**

Modify `src/routes/api/sites.ts` so it runs both middlewares:

```ts
sites.use('*', clerkAuth());
sites.use('*', requireAuth());
```

Input must include `siteName` and `subdomain`. Validate subdomain with:

```ts
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const RESERVED_SUBDOMAINS = new Set(['www', 'api', 'app', 'rev01', 'admin']);
```

On duplicate subdomain, return `409` with a clear JSON error. Do not silently mutate the requested subdomain.

- [ ] **Step 4: Update template screen**

Modify `src/routes/dashboard/templates.tsx` to show one form:

- site name
- published address input prefix/suffix: `<input name="subdomain">.aayushman.dev`
- hidden template id `starter-canvas`
- submit to `/api/sites`

Keep the screen plain but usable.

- [ ] **Step 5: Add route smoke coverage**

Modify `src/review-smoke.ts` to assert:

- invalid subdomain returns 400 from `POST /api/sites` once authenticated request helpers are available
- unknown public host returns 404 after Task 4 wires public routing

If auth helpers are not present yet, create a pure exported `validateSubdomain(value)` function in `src/routes/api/sites.ts` and smoke-test that function directly.

- [ ] **Step 6: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run canvas:smoke
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/templates/registry.ts src/routes/api/sites.ts src/routes/dashboard/templates.tsx src/review-smoke.ts
git commit -m "feat: create canvas sites from one template"
```

---

### Task 3: Canvas Editor Load, Save, Style Kit, And Section Editing APIs

**Files:**

- Create: `src/routes/api/canvas.ts`
- Modify: `src/index.ts`
- Modify: `src/routes/dashboard/index.tsx`
- Test: `src/review-smoke.ts`

- [ ] **Step 1: Add owner canvas API**

Create `src/routes/api/canvas.ts` with:

- `GET /api/canvas/sites/:siteId` returns `{ siteId, name, subdomain, editableState, publishedVersion }`
- `PUT /api/canvas/sites/:siteId` accepts full `CanvasSiteState`, validates it, writes `site.editableState`, and returns `{ ok: true }`
- `POST /api/canvas/sites/:siteId/style-kit` accepts `{ styleKit }`, validates against `STYLE_KITS`, updates `editableState.styleKit` and `site.styleKit`

All routes must run `clerkAuth()` then `requireAuth()` and verify ownership through `customer`.

- [ ] **Step 2: Wire route**

Modify `src/index.ts`:

```ts
import canvasApi from './routes/api/canvas';
app.route('/api/canvas', canvasApi);
```

- [ ] **Step 3: Update dashboard link**

Modify `src/routes/dashboard/index.tsx` to point latest site to:

```tsx
<a href={`/dashboard/sites/${editorLink.siteId}/edit`}>{editorLink.siteName}</a>
```

No page id is needed for the POC because the editable site owns one canvas page.

- [ ] **Step 4: Add pure save smoke**

In `src/review-smoke.ts`, add validator assertions that `validateCanvasSiteState` rejects a section with an element wider than the page and rejects an autoplay video that is not muted.

- [ ] **Step 5: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run canvas:smoke
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/api/canvas.ts src/index.ts src/routes/dashboard/index.tsx src/review-smoke.ts
git commit -m "feat: add canvas editing api"
```

---

### Task 4: Desktop Canvas Editor UI

**Files:**

- Create: `src/editor/canvas-index.tsx`
- Create: `src/editor/canvas-client.ts`
- Create: `src/editor/canvas-styles.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Add editor route shell**

Create `src/editor/canvas-index.tsx` route `GET /dashboard/sites/:siteId/edit`. It should:

- auth-gate owner
- verify site ownership
- render editor header with site name, public address, style-kit choices, save button, publish button
- include `<div id="canvas-root"></div>`
- inline `canvasClientScript({ siteId })`
- include `canvasEditorStyles`

- [ ] **Step 2: Add client state loader**

Create `src/editor/canvas-client.ts` exporting `canvasClientScript(params)`. First client milestone:

- fetch `/api/canvas/sites/:siteId`
- store `state`
- render page sections into `#canvas-root`
- render selected element inspector
- save full state with `PUT /api/canvas/sites/:siteId`

- [ ] **Step 3: Add selection and inline text editing**

In the client script:

- clicking an element selects it
- double-clicking text sets `contenteditable=true`
- blur writes text back to state and re-renders
- Escape cancels edit by restoring previous text

- [ ] **Step 4: Add drag and resize**

In the client script:

- selected elements can be dragged within their canvas section
- selected elements have one southeast resize handle
- clamp movement to section bounds and page width
- update `box.x`, `box.y`, `box.w`, `box.h`

- [ ] **Step 5: Add content and section controls**

Add toolbar buttons:

- add text to selected section
- add image/video media to selected section using existing asset id or URL-backed seed asset
- add action to selected section
- add shape to selected section
- add container/card to selected section
- duplicate selected section
- delete selected section, rejecting deletion of the last section with visible error text
- move selected section up/down

- [ ] **Step 6: Add style-kit, variant, and motion controls**

Style-kit buttons call `POST /api/canvas/sites/:siteId/style-kit`, update local state, and re-render immediately.

The selected-element inspector should expose only curated controls:

- action variant from `ACTION_VARIANTS`
- shape variant from `SHAPE_VARIANTS`
- container variant from `SURFACE_VARIANTS`
- media fit and video playback controls
- motion preset from `MOTION_PRESETS`

- [ ] **Step 7: Wire route**

Modify `src/index.ts`:

```ts
import canvasEditor from './editor/canvas-index';
app.route('/dashboard', canvasEditor);
```

Place it before the dashboard route.

- [ ] **Step 8: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run build
```

Expected: typecheck passes and Worker dry-run build completes.

- [ ] **Step 9: Commit**

```bash
git add src/editor/canvas-index.tsx src/editor/canvas-client.ts src/editor/canvas-styles.ts src/index.ts
git commit -m "feat: add desktop canvas editor"
```

---

### Task 4.5: Rich Text Content Retrofit

**Why:** Tasks 1 and 4 shipped `TextElement.text: string`. The plan now requires `TextElement.content: InlineRun[]`. This task lands the contract from "Rich Text Content Model" above across schema, validator, renderer, fixture, smoke, editor, and any code that read `element.text` — _before_ publish (Task 5) renders snapshots and _before_ AI rewrite (Task 7) speaks the contract.

**Files:**

- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/fixtures/home.json`
- Modify: `src/canvas/smoke.ts`
- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts` _(only if inline-mark toolbar needs new styles — keep this minimal)_
- Modify: `src/review-smoke.ts` _(add rich-text validator assertions)_

- [ ] **Step 1: Update the schema**

In `src/canvas/schema.ts`, add the exports defined in "Rich Text Content Model": `INLINE_MARK_TYPES`, `InlineMarkType`, `InlineMark` union, `InlineRun` interface. Replace `TextElement.text: string` with `TextElement.content: InlineRun[]`. Do not retain the old `text` field even as deprecated — delete it cleanly (the dev DB is empty, no migration needed).

- [ ] **Step 2: Update the validator**

In `src/canvas/validate.ts`:

- Replace the `text` string check on text elements with a `content` array walk.
- For each run: `text` must be a string (empty allowed only if not the sole run; concatenated plain text must not be empty across the element). `marks` (if present) must be an array; each entry is one of the seven object shapes; `link` marks carry an `href` validated against the same allowlist as `ActionElement.href`; no two marks in the same run share a `type`.
- Emit specific error messages: `text element {id}.content must be a non-empty array`, `text element {id}.content[i].text must be a string`, `text element {id}.content[i].marks[j].type must be one of [...]`, `text element {id}.content[i].marks[j].href ...`, `text element {id} has empty concatenated plain text`.
- Collect all errors; do not short-circuit.

- [ ] **Step 3: Update the renderer**

In `src/canvas/render.ts`:

- Replace the text-element render branch with a run walk. Outer tag still comes from `role`.
- For each run, build the nested-mark structure in the fixed order: `<a>` (if link present, outermost), then `<strong>`, `<em>`, `<u>`, `<s>`, `<mark>`, `<code>` (innermost wraps the text node).
- A run with no marks emits a bare `<span>` around the escaped text.
- All text + attributes go through `escapeHtml` / `escapeAttr`.
- Emit `data-rev01-element="{element.id}"` and `data-element-type="text"` on the outer element as before. Do not add new data-attributes on the runs unless the editor genuinely needs them; if so, use `data-rev01-run-index="{i}"` on the run span.

- [ ] **Step 4: Update the fixture**

Modify `src/canvas/fixtures/home.json`:

- Rewrite every text element's `text` string into a `content` array.
- `hero-heading`: at least two runs, one of which carries a `bold` mark.
- One text element somewhere (e.g. `hero-body` or `cta-heading`) contains a run with a `link` mark pointing at `https://rev01.aayushman.dev`. Keep the visible behaviour close to the original copy.
- All previous element ids and section ids are preserved so the smoke's existing markers still match.

- [ ] **Step 5: Update the smoke**

In `src/canvas/smoke.ts`, keep all existing data-attribute assertions and add three more:

- the rendered HTML contains `<strong>` somewhere inside the heading element's marker block (proves at least one bold mark rendered);
- the rendered HTML contains `<a class="rev01-inline-link"` with an `https://` href (proves the link mark path);
- the validator rejects a hand-built text element whose `content` includes a `link` mark with `href: 'javascript:alert(1)'`.

- [ ] **Step 6: Update the editor**

In `src/editor/canvas-client.ts`:

- Replace the plain-text contenteditable commit path with a DOM-to-`InlineRun[]` serializer (per "Rich Text Content Model" above). Cancel/Escape restores the pre-edit `content` snapshot.
- Add a small inline mark toolbar that appears anchored to the selected text element while it is in edit mode (visible only during edit). Seven buttons matching `INLINE_MARK_TYPES`. `link` button prompts for an href; pre-validate the href against the validator allowlist before applying, and `setStatus('Link rejected: {reason}')` on failure.
- Keyboard shortcuts: Cmd/Ctrl+B/I/U for bold/italic/underline, Cmd/Ctrl+Shift+X for strike, Cmd/Ctrl+K for link. `preventDefault` so the browser's defaults don't take over.
- The DOM serializer must dedupe adjacent identical-mark runs and drop empty marks-only runs as specified in the model.
- Re-render after a successful commit uses the same render path as the rest of the editor; do NOT branch on plain vs. rich text — there is only rich text now.

- [ ] **Step 7: Update `src/review-smoke.ts`**

Add three new assertions:

- A text element whose `content` is `[]` is rejected with a message mentioning "non-empty array".
- A run whose `marks` contains `{ type: 'rainbow' }` is rejected with a message mentioning the offending type.
- A link mark with `href: 'javascript:alert(1)'` is rejected.

Keep all existing assertions.

- [ ] **Step 8: Verify**

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run review:smoke
bun.cmd run build
```

All five must pass. The renderer must produce `<strong>` and `<a class="rev01-inline-link"` exactly as the smoke asserts.

- [ ] **Step 9: Commit**

```bash
git add src/canvas src/editor/canvas-client.ts src/editor/canvas-styles.ts src/review-smoke.ts
git commit -m "feat: inline rich text content inside text elements"
```

---

### Task 5: Published Snapshot, Public Address Routing, And Visitor Live Update

**Files:**

- Create: `src/routes/api/publish.ts`
- Create: `src/routes/public.ts`
- Create: `src/live/site-room.ts`
- Modify: `src/index.ts`
- Modify: `wrangler.toml`
- Modify: `src/db/schema.ts`
- Test: `src/review-smoke.ts`

- [ ] **Step 1: Add publish endpoint**

Create `src/routes/api/publish.ts` with `POST /api/publish/sites/:siteId`.

It must:

- auth-gate owner
- load owned site
- validate `editableState`
- create `PublishedSnapshot` with `version = site.publishedVersion + 1`
- store `publishedSnapshot`, `publishedVersion`, `updatedAt`
- render HTML with `renderCanvasSnapshot`
- call `SITE_ROOM.idFromName(site.id)` and `fetch('/broadcast')` with `{ version, html }`
- return `{ ok: true, version, publicUrl }`

- [ ] **Step 2: Add public host router**

Create `src/routes/public.ts` with a function:

```ts
export async function handlePublicRequest(c: Context<Env>): Promise<Response | null>;
```

It should:

- inspect `new URL(c.req.url).host`
- resolve only owned-domain subdomains such as `*.aayushman.dev`
- ignore app hosts such as `rev01.aayushman.dev` and `localhost:8787`
- load `site` by `subdomain`
- return 404 if no published snapshot exists
- render snapshot HTML and inject a visitor live-update script

- [ ] **Step 3: Add site room Durable Object**

Create `src/live/site-room.ts`:

```ts
export class SiteRoom extends DurableObject {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.json();
      for (const ws of this.ctx.getWebSockets()) ws.send(JSON.stringify(payload));
      return new Response('ok');
    }
    if (url.pathname === '/socket' && request.headers.get('upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }
}
```

Add presence count if it is trivial after socket wiring; do not block publish on it.

- [ ] **Step 4: Wire public router before landing**

Modify `src/index.ts` so public host routing runs before `app.route('/', landing)`:

```ts
app.use('*', async (c, next) => {
  const response = await handlePublicRequest(c);
  if (response) return response;
  await next();
});
```

Export `SiteRoom`.

- [ ] **Step 5: Update Wrangler binding**

Modify `wrangler.toml`:

```toml
[[durable_objects.bindings]]
name = "SITE_ROOM"
class_name = "SiteRoom"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["SiteRoom"]
```

Keep `PageDocument` until old code is retired, then remove its binding in Task 9.

- [ ] **Step 6: Add visitor script**

The public renderer should include:

```html
<script type="module">
  const ws = new WebSocket(
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/__live`,
  );
  ws.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);
    if (payload && payload.html) {
      document.querySelector('[data-rev01-public-root]').innerHTML = payload.html;
    }
  });
</script>
```

Route `/__live` through `SiteRoom` for the resolved site.

- [ ] **Step 7: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run build
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/routes/api/publish.ts src/routes/public.ts src/live/site-room.ts src/index.ts wrangler.toml src/db/schema.ts src/review-smoke.ts
git commit -m "feat: publish canvas sites to public addresses"
```

---

### Task 5.5: Publish Smoke + Broadcast Payload Hardening

**Why:** Task 5 shipped publish + public routing + the SiteRoom DO, but its smoke coverage stops at "subdomain not found returns 404" and "app host serves landing". The plan now requires explicit assertions for the publish path itself, the `/__live` upgrade path, and the stale-version visitor protection. A code-review finding on `src/live/site-room.ts` (BroadcastPayload accepted any JSON shape — wrong-type payloads would reach every visitor's `innerHTML` assignment) is fixed here.

**Files:**

- Modify: `src/live/site-room.ts`
- Modify: `src/routes/api/publish.ts` _(only if needed to expose a versioned payload shape)_
- Modify: `src/routes/public.ts` _(stale-version filter in visitor script)_
- Modify: `src/review-smoke.ts`

- [ ] **Step 1: Lock the broadcast payload shape at runtime**

In `src/live/site-room.ts`, replace the implicit `as BroadcastPayload` cast with a runtime check:

```ts
function isBroadcastPayload(value: unknown): value is { version: number; html: string } {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.version === 'number' &&
    Number.isFinite(v.version) &&
    v.version >= 1 &&
    typeof v.html === 'string'
  );
}
```

If the parsed body fails this check, return `400 'invalid broadcast payload'`. Failures here must throw a loud `console.error('[SiteRoom] rejected malformed broadcast', payload)` — no silent skip.

- [ ] **Step 2: Stamp + filter stale versions in the visitor script**

In `src/routes/public.ts` (the inline `VISITOR_LIVE_SCRIPT`):

- Store the server-rendered snapshot version in a window-scoped `let currentVersion = N` literal injected at render time (escape the integer).
- When a `broadcast` message arrives, ignore it if `payload.version <= currentVersion`. Otherwise apply and update `currentVersion = payload.version`.
- A reconnect that fires after the page has already been refreshed by a full reload starts at the rendered snapshot version, so stale republishes never overwrite a fresh load.

- [ ] **Step 3: Add publish + public-render + live-upgrade smoke**

In `src/review-smoke.ts`, add these assertions using the existing `responseFromHost` helper:

1. Seed a fake `customer` + `site` row in the dev DB before the assertions so the publish/public lookups have something to hit. Use `db(env)` from `src/db/client` with the env vars threaded the same way `responseFromHost` already does. The fake site gets `subdomain = 'smoke'`, a valid `editableState` (use `starterTemplate.state`), no published snapshot.
2. `GET http://smoke.rev01.aayushman.dev/` returns 404 because no published snapshot. Body mentions "not yet published".
3. Insert a `publishedSnapshot` directly into the same row (since the publish endpoint requires Clerk auth which the smoke can't satisfy). Set `publishedVersion = 1`.
4. `GET http://smoke.rev01.aayushman.dev/` now returns 200 and the body contains `data-rev01-public-root` AND `data-rev01-page="page-home"` AND `currentVersion = 1` somewhere in the inline script (proves the version stamp is wired).
5. `GET http://smoke.rev01.aayushman.dev/__live` without `Upgrade: websocket` returns 426 with body `'expected websocket upgrade'`.
6. `GET http://rev01.aayushman.dev/__live` returns null-or-pass-through (app host should ignore the path — confirm the response is NOT a 426; the existing dashboard/landing routes win).
7. After assertions complete, clean up: `DELETE FROM site WHERE subdomain='smoke'; DELETE FROM customer WHERE clerk_user_id='smoke-user'`.

Wrap the seed/cleanup in a `try { … } finally { cleanup() }` so a failing assertion still removes the smoke rows.

- [ ] **Step 4: Verify**

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run review:smoke
bun.cmd run build
```

All five pass. The new smoke must hit a real Neon dev branch; if the branch is unreachable, fail loudly rather than skipping.

- [ ] **Step 5: Commit**

```bash
git add src/live/site-room.ts src/routes/api/publish.ts src/routes/public.ts src/review-smoke.ts
git commit -m "feat: harden publish broadcast + visitor live-update smoke"
```

---

### Task 5.6: Single-Page Enforcement, Surface Semantics, And Reading Order

**Why:** Tasks 1 + 4 left the schema with `pages: CanvasPage[]` and the editor pinned to `state.pages[0]`. The invariants block above says the POC validator must enforce exactly one page, the surface primitive must render `aria-hidden`, and DOM order must follow `elements[]` deterministically. This task lands those rules retroactively so T6 and T7 can rely on them.

**Files:**

- Modify: `src/canvas/validate.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/canvas/smoke.ts`
- Modify: `src/routes/api/canvas.ts` _(PUT defends against multi-page payloads loudly)_
- Modify: `src/routes/api/publish.ts` _(snapshot validation already calls validate, so the new rule cascades — confirm)_
- Modify: `src/review-smoke.ts`

- [ ] **Step 1: Validator — exactly one page**

In `src/canvas/validate.ts`, after the existing "no pages" check, also reject `state.pages.length !== 1`. Error message: `state.pages must contain exactly one canvas page (POC enforces single-page sites)`. Apply the same rule in `validatePublishedSnapshot` via the shared page walk.

- [ ] **Step 2: Renderer — surface + shape aria-hidden, deterministic order**

In `src/canvas/render.ts`:

- The element render loop already iterates `section.elements[]` in order — confirm and add a comment that this is the reading order contract.
- For shape and surface (container) elements, emit `aria-hidden="true" role="presentation"` on the outer wrapper.
- For text and action elements, emit no extra ARIA attributes (defaults are correct).
- For media: an image with empty `alt` is decorative — emit `aria-hidden="true"`. Otherwise leave the `<img alt>` to speak for itself.
- Outer `<main>` wrapper gets `lang="en"` only if the page has no language; for POC, always emit `lang="en"`.

- [ ] **Step 3: Smoke**

In `src/canvas/smoke.ts`, add:

- The rendered HTML for `section-hero` contains an element with `aria-hidden="true"` (the shape `hero-orb` or the surface `hero-card`).
- The rendered HTML does NOT contain `aria-hidden="true"` on the text heading (`hero-heading`).
- The validator rejects `{ ...starter, pages: [...starter.pages, ...starter.pages] }` (two pages) with the new error message.
- The validator rejects `{ ...starter, pages: [] }` (already covered) with the existing message.

- [ ] **Step 4: API defence**

In `src/routes/api/canvas.ts`'s PUT route, the existing `validateCanvasSiteState` call now rejects multi-page payloads automatically. Add a small explicit early check that the body's `pages` is an array of length 1 before passing to the validator, so the error response is more specific. Keep validator-returned errors as the source of truth.

- [ ] **Step 5: Review smoke**

In `src/review-smoke.ts`, add a `validateCanvasSiteState` assertion that a two-page state is rejected with "exactly one canvas page" in the message.

- [ ] **Step 6: Verify**

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run review:smoke
bun.cmd run build
```

All five pass.

- [ ] **Step 7: Commit**

```bash
git add src/canvas/validate.ts src/canvas/render.ts src/canvas/smoke.ts src/routes/api/canvas.ts src/review-smoke.ts
git commit -m "feat: enforce single-page POC + a11y reading order"
```

---

### Task 5.7: Editor Viewport + Z-order Controls

**Why:** Task 4 shipped the editor with no zoom, pan/scroll, or z-order controls. Absolute-positioned elements at a 1440px design width on a smaller laptop screen are unusable without fit-to-width zoom; overlapping shapes/surfaces need bring-forward / send-back. Owner-facing reading order (Task 5.6) is also surfaced here via element reorder controls.

**Files:**

- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts`

- [ ] **Step 1: Viewport zoom**

In `src/editor/canvas-client.ts`, wrap `#canvas-root` in a viewport container with explicit scroll. The viewport has:

- A toolbar zoom group (top-left of the canvas): buttons `Fit`, `100%`, `+`, `-`. Zoom range 0.25..2.0 in 0.1 increments.
- A `let zoom = 1` state variable; the canvas-root wrapper has `transform: scale(zoom)` + a `transform-origin: top left;` and the viewport scrolls naturally.
- `Fit` computes `viewport.clientWidth / page.width` clamped to [0.25, 1.0] (don't auto-zoom-in past 100%).
- Mouse wheel + Ctrl/Cmd zooms; horizontal/vertical wheel scrolls. The viewport `overflow:auto`.
- Mouse position to canvas position conversion (used by drag + section toolbar anchoring) must account for `zoom`. Refactor existing pointer-to-canvas math to divide by `zoom`.

- [ ] **Step 2: Z-order controls**

In the element inspector (any selected element):

- Add four buttons: `Bring to front`, `Send to back`, `Forward`, `Backward`.
- Z-order operates on the element's `box.z` integer. "Bring to front" → `max(siblingZ) + 1`. "Send to back" → `min(siblingZ) - 1`. "Forward" / "Backward" → swap z with the next sibling in the same direction.
- After mutation, re-render the section and trigger autosave.

- [ ] **Step 3: Element reorder (reading order)**

In the element inspector add two buttons: `Move up in reading order`, `Move down in reading order`. These reorder the element's index inside `section.elements[]` (NOT its visual z). The visitor-side DOM order changes; the visual layout does not. Show a small "Reading order: N of M" caption above the buttons so the Owner can see where they are.

- [ ] **Step 4: Styles**

In `src/editor/canvas-styles.ts`, add styles for:

- `.rev01-viewport` (scroll container, dark background outside the page).
- `.rev01-zoom-toolbar` (small floating button group, top-left of viewport).
- `.rev01-reorder-buttons` (compact inspector group).

- [ ] **Step 5: Verify**

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run review:smoke
bun.cmd run build
```

All five pass. Manual browser verification is required for the actual viewport/zoom/wheel interactions; the build step only checks that the worker bundle still builds.

- [ ] **Step 6: Commit**

```bash
git add src/editor/canvas-client.ts src/editor/canvas-styles.ts
git commit -m "feat: viewport zoom, z-order, and reading-order controls"
```

---

### Task 6: Site Assets And Media Replacement

**Files:**

- Create: `src/assets/site-assets.ts`
- Create: `src/canvas/seed-assets.ts` — registry of seed asset bytes
- Modify: `src/routes/api/canvas.ts`
- Modify: `src/routes/api/sites.ts` — materialise seed assets on site creation
- Modify: `src/routes/public.ts`
- Modify: `src/routes/api/publish.ts` — refuse to publish if state references missing assets
- Modify: `src/editor/canvas-client.ts`
- Modify: `src/canvas/fixtures/home.json` — pin seed asset ids to the seed-asset registry
- Modify: `src/canvas/validate.ts` — sanity-check the fixture's asset ids exist in the seed-asset registry
- Modify: `src/review-smoke.ts`

**Amended scope (2026-05-22 round 2):**

- A site created from a Template Seed must ship a working set of `siteAsset` rows. No broken `<img>` / `<video>` after site creation.
- The public `/assets/:assetId` route serves ONLY assets referenced by the current `publishedSnapshot`. Visitor-visible asset surface is constrained by the published snapshot, not the editable library.
- The publish endpoint refuses to publish a state that references a missing asset id.

- [ ] **Step 1: Add asset helpers**

Create `src/assets/site-assets.ts`:

```ts
export function dataUrlToAsset(input: string): {
  kind: 'image' | 'video';
  mediaType: string;
  bytesBase64: string;
} {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(input);
  if (!match) throw new Error('asset data must be a base64 data URL');
  const mediaType = match[1];
  if (mediaType.startsWith('image/')) return { kind: 'image', mediaType, bytesBase64: match[2] };
  if (mediaType.startsWith('video/')) return { kind: 'video', mediaType, bytesBase64: match[2] };
  throw new Error(`unsupported asset media type: ${mediaType}`);
}

export function assetResponse(mediaType: string, bytesBase64: string): Response {
  const bytes = Uint8Array.from(atob(bytesBase64), (ch) => ch.charCodeAt(0));
  return new Response(bytes, {
    headers: {
      'content-type': mediaType,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// Walks a CanvasSiteState (or PublishedSnapshot.pages) and returns every assetId
// referenced by a media element (including posterAssetId). Used by:
// - publish to verify all referenced assets exist before snapshotting;
// - public /assets/:assetId to scope serving to the current snapshot only.
export function collectReferencedAssetIds(pages: CanvasPage[]): Set<string> {
  /* ... */
}
```

- [ ] **Step 2: Build the seed asset registry**

Create `src/canvas/seed-assets.ts`. It exports a flat record keyed by the seed asset ids used in `src/canvas/fixtures/home.json`. Each entry contains the media type plus the base64 bytes. Use small but real bytes (e.g. a tiny solid-colour 1x1 webp/png and a tiny silent webm/mp4) so the fixture's `<img>` and `<video>` elements actually render. Document each entry's source in a comment.

The seed asset ids in the fixture MUST be human-stable strings like `seed-hero-image-1` and `seed-hero-video-1`. The fixture is updated in this step to use those ids; no random uuids.

The validator gains a step: every media element's `assetId` AND `posterAssetId` (if present) in `src/canvas/fixtures/home.json` must exist in `src/canvas/seed-assets.ts`. The validator only enforces this when validating the fixture (because customer-uploaded assets are unknown to the registry); use a separate function `validateSeedFixture` so production validation doesn't accidentally fail on customer ids.

- [ ] **Step 3: Materialise seed assets on site creation**

Modify `src/routes/api/sites.ts`. After the `site` row is inserted (and before returning 201), insert one `siteAsset` row per seed asset id referenced by `starterTemplate.state.pages`. Each row gets:

- `id = seed asset id` (so the editable state's `assetId` references resolve immediately).
- `siteId = newSiteId`.
- `mediaType` from the registry entry.
- `bytesBase64` from the registry entry.
- `kind` from the registry entry.
- `alt` from the registry entry (fixture-author-provided fallback alt).

This runs inside the same DB call batch as the site insert via `db.batch([...])` so site creation is atomic. If the batch fails, the site row is rolled back.

The seed-asset bytes are large-ish — keep the in-Postgres copy as base64 text columns (existing `siteAsset.bytesBase64`) for the POC. T9 may move them to R2 later; document that intent.

- [ ] **Step 4: Add owner asset upload route**

In `src/routes/api/canvas.ts`, add:

- `POST /api/canvas/sites/:siteId/assets`
- accepts `{ dataUrl, alt }`
- validates ownership
- converts data URL with `dataUrlToAsset` (loud reject on unsupported media types)
- inserts a `siteAsset` row with a freshly generated id (NOT a seed id)
- returns `{ assetId, kind, mediaType }`

Owner asset upload always creates a NEW row. The seed asset ids are never overwritten; an Owner who wants to "edit" the seed image uploads a new asset and points the `MediaElement.assetId` at it.

- [ ] **Step 5: Add publish-scoped public asset route**

In `src/routes/public.ts`, serve `/assets/:assetId` ONLY for assets that appear in the resolved site's `publishedSnapshot`:

- Reject if the site has no `publishedSnapshot` → 404.
- Compute the set of `assetId`s referenced by `publishedSnapshot.pages` (via `collectReferencedAssetIds`).
- If the requested `assetId` is not in the set → 404 (do NOT leak existence of editable-only assets).
- Otherwise load the matching `siteAsset` row scoped by `siteId` AND `id`. Missing → 404.
- Return via `assetResponse(mediaType, bytesBase64)`.

The Owner-side editor reads assets via a separate owner-gated route (Step 7) — not via `/assets/:assetId`. The public route is visitor-only.

- [ ] **Step 6: Refuse publish on missing-asset reference**

In `src/routes/api/publish.ts`, before writing the snapshot:

- Compute `referenced = collectReferencedAssetIds(editableState.pages)`.
- Query `siteAsset` for the intersection of `siteId = site.id` AND `id IN (referenced)`.
- If the count of returned rows < `referenced.size`, find the missing ones and return `400 { error: 'cannot publish: missing assets', missingAssetIds: [...] }`.
- Do NOT auto-fix or substitute placeholders.

- [ ] **Step 7: Add owner asset preview route**

In `src/routes/api/canvas.ts`, add `GET /sites/:siteId/assets/:assetId` (owner-gated). Serves the editable asset bytes so the editor can show what an Owner just uploaded BEFORE the next publish. Same payload as the public route, but scoped by `customer.clerkUserId → site.customerId`. Missing → 404. The editor's media element rendering reads from this path (not `/assets/:assetId`) during edit mode.

- [ ] **Step 8: Editor media replacement**

In `src/editor/canvas-client.ts`, when a media element is selected:

- Show a file input (one for image, one for video — accept the corresponding mime types).
- Read the selected file as a base64 data URL.
- POST to `/api/canvas/sites/:siteId/assets` with `{ dataUrl, alt }`.
- Set the selected element's `assetId`, `mediaKind`, and `alt` from the response.
- Editor-mode media `<img src>` / `<video src>` points at `/api/canvas/sites/:siteId/assets/:assetId` (the owner-preview path), NOT `/assets/:assetId`.
- For video elements, expose autoplay / muted / loop / controls checkboxes; if autoplay is checked, force muted true and disable the muted-uncheck (same rule as Task 4).
- Save editable state.

- [ ] **Step 9: Smoke**

In `src/review-smoke.ts`, add:

- The validator's new `validateSeedFixture` accepts the seed fixture (positive case).
- The validator's `validateSeedFixture` rejects a hand-built fixture whose media references an unknown asset id.
- After site creation via the owner's site-create endpoint, the corresponding `siteAsset` row count == seed asset id count.

Skip the public asset assertion here (it's hit in the T5.5 smoke if you want to extend it).

- [ ] **Step 10: Verify**

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run review:smoke
bun.cmd run build
```

All five pass.

- [ ] **Step 11: Commit**

```bash
git add src/assets/site-assets.ts src/canvas/seed-assets.ts src/canvas/fixtures/home.json src/canvas/validate.ts src/routes/api/canvas.ts src/routes/api/sites.ts src/routes/api/publish.ts src/routes/public.ts src/editor/canvas-client.ts src/review-smoke.ts
git commit -m "feat: seed media assets + publish-scoped public asset serving"
```

---

### Task 7: Previewed AI Canvas Edits

**Files:**

- Create: `src/agent/canvas-ops.ts`
- Create: `src/agent/canvas-tools.ts`
- Create: `src/routes/api/canvas-agent.ts`
- Modify: `src/agent/llm-gemini.ts`
- Modify: `src/editor/canvas-client.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Define preview operations**

Create `src/agent/canvas-ops.ts`:

```ts
import type { CanvasSiteState, CanvasSection } from '../canvas/schema';

export type CanvasAgentOp =
  | { kind: 'rewriteText'; elementId: string; content: InlineRun[] }
  | {
      kind: 'replaceMedia';
      elementId: string;
      mediaKind: 'image' | 'video';
      assetId: string;
      alt: string;
    }
  | { kind: 'insertSection'; afterSectionId: string | null; section: CanvasSection };

export function applyCanvasAgentOp(state: CanvasSiteState, op: CanvasAgentOp): CanvasSiteState {
  const next = structuredClone(state) as CanvasSiteState;
  const page = next.pages[0];
  if (!page) throw new Error('canvas agent op requires at least one page');
  if (op.kind === 'rewriteText') {
    const element = page.sections.flatMap((s) => s.elements).find((el) => el.id === op.elementId);
    if (!element || element.type !== 'text')
      throw new Error(`text element not found: ${op.elementId}`);
    element.content = op.content;
    return next;
  }
  if (op.kind === 'replaceMedia') {
    const element = page.sections.flatMap((s) => s.elements).find((el) => el.id === op.elementId);
    if (!element || element.type !== 'media')
      throw new Error(`media element not found: ${op.elementId}`);
    element.mediaKind = op.mediaKind;
    element.assetId = op.assetId;
    element.alt = op.alt;
    return next;
  }
  const index = op.afterSectionId
    ? page.sections.findIndex((section) => section.id === op.afterSectionId) + 1
    : page.sections.length;
  if (index < 0) throw new Error(`section not found: ${op.afterSectionId}`);
  page.sections.splice(index, 0, op.section);
  return next;
}
```

- [ ] **Step 1.5: Section recipe registry (2026-05-22 round 2 amendment)**

Create `src/canvas/recipes.ts` exporting:

```ts
export interface RecipeFactoryInput {
  brief: string;
  styleKit: StyleKit;
  assetIds: { hero?: string; cards?: string[]; gallery?: string[] };
}
export type RecipeFactory = (input: RecipeFactoryInput) => CanvasSection;
export const RECIPE_REGISTRY: Record<SectionRecipeId, RecipeFactory> = {
  /* one per id */
};
export function createSectionFromRecipe(
  recipeId: SectionRecipeId,
  input: RecipeFactoryInput,
): CanvasSection;
```

Every entry in `SECTION_RECIPE_IDS` MUST have a factory. Each factory:

- Produces a fully-formed `CanvasSection` with deterministic ids (`sec-{recipe}-{shortRand}`, elements `el-{role}-{shortRand}`).
- Honours the rich-text content model (no plain-string `text` anywhere).
- References asset ids supplied via `assetIds`; falls back to placeholder seed ids ONLY if `assetIds` is empty AND the brief explicitly asks for it. Default behaviour: the caller MUST supply real asset ids (the preview endpoint generates or uploads them first).
- Produces output that passes `validateCanvasSiteState` when slotted into a single-page state.

`insertSection` op switches from accepting a freeform `section: CanvasSection` to:

```ts
| { kind: 'insertSection'; afterSectionId: string | null; recipeId: SectionRecipeId; input: RecipeFactoryInput };
```

`applyCanvasAgentOp` calls `createSectionFromRecipe(op.recipeId, op.input)` itself; the LLM does not author canvas section shapes directly. This is the structural guarantee that constrains agent output to known recipe shapes.

- [ ] **Step 2: Define constrained tools**

Create `src/agent/canvas-tools.ts` with tools:

- `rewriteText(elementId, content)` — `content` is the `InlineRun[]` defined in the Rich Text Content Model. Tool schema MUST instruct the model to produce the run array, not a plain string.
- `replaceMedia(elementId, assetId, alt)` — the LLM picks an existing uploaded asset by id and supplies alt text. The tool does NOT generate media bytes. Media uploads go through the owner asset route (Task 6). **Renamed from `generateReplacementMedia` (2026-05-22 round 2 amendment)** because no real media-generation adapter exists; T-future may add one.
- `createSection(recipeId, afterSectionId, brief, assetIds)` — `recipeId` MUST be one of `SECTION_RECIPE_IDS`; `assetIds` are existing uploaded asset ids the recipe should slot. Tool schema enumerates valid recipe ids in the description so the model cannot invent one.

The endpoint returns preview ops only. It does not mutate `editableState`.

- [ ] **Step 3: Add preview endpoint**

Create `src/routes/api/canvas-agent.ts`:

- `POST /api/canvas-agent/sites/:siteId/preview`
- auth-gates owner
- loads editable state
- calls Gemini adapter with the constrained tool definitions
- parses tool output into `CanvasAgentOp[]`
- For each `insertSection` op, the recipe factory runs first; the resulting section is validated.
- For each `replaceMedia` op, verifies the referenced `assetId` belongs to the site.
- validates the full result by dry-running ops through `applyCanvasAgentOp` and `validateCanvasSiteState`
- returns `{ previewId, ops, previewState }`

- [ ] **Step 4: Add apply endpoint**

Add `POST /api/canvas-agent/sites/:siteId/apply`:

- accepts `{ ops }`
- validates by dry-run
- writes updated `editableState`
- returns `{ ok: true, editableState }`

- [ ] **Step 5: Add editor preview UI**

In `src/editor/canvas-client.ts`:

- selected text element shows "AI rewrite"
- selected media shows "AI media"
- section toolbar shows "AI section"
- preview response renders a side panel with Accept and Dismiss
- Accept calls apply endpoint and re-renders
- Dismiss discards preview without saving

- [ ] **Step 6: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run build
```

Expected: both pass. If `GEMINI_API_KEY` is absent locally, endpoint should return a loud `500 GEMINI_API_KEY not configured` only when called; build and typecheck must still pass.

- [ ] **Step 7: Commit**

```bash
git add src/agent/canvas-ops.ts src/agent/canvas-tools.ts src/routes/api/canvas-agent.ts src/agent/llm-gemini.ts src/editor/canvas-client.ts src/index.ts
git commit -m "feat: preview ai edits for canvas sites"
```

---

### Task 8: Deterministic Style Kits, Visual Variants, Motion, And Presence Indicator

**Files:**

- Modify: `src/canvas/schema.ts`
- Modify: `src/canvas/render.ts`
- Modify: `src/editor/canvas-client.ts`
- Modify: `src/editor/canvas-styles.ts`
- Modify: `src/live/site-room.ts`

- [ ] **Step 1: Add deterministic style-kit tokens (2026-05-22 round 2 amendment — depth)**

Style kits cover colour, typography, surfaces, shapes, shadows, motion. The preset table lives in `src/canvas/style-kits.ts` (NEW — extracted from schema.ts so the schema stays type-only) and is consumed by both the editor and the public renderer. Shape:

```ts
export interface StyleKitPreset {
  // Colour
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string; // text colour on accent surfaces
  // Typography
  fontFamilyDisplay: string;
  fontFamilyBody: string;
  fontFamilyMono: string;
  // role-specific size scales (modular). The renderer multiplies the element's `fontSize` by the role's scale.
  headingScale: number;
  bodyScale: number;
  labelScale: number;
  lineHeight: number;
  // Surfaces (containers)
  radius: string;
  borderWidth: string;
  shadow: string;
  surfaceVariants: Record<
    SurfaceVariant,
    { background?: string; border?: string; shadow?: string; radius?: string }
  >;
  // Shapes
  shapeFill: string;
  shapeStroke: string;
  shapeStrokeWidth: string;
  // Actions
  actionRadius: string;
  actionPadding: string;
  actionVariants: Record<
    ActionVariant,
    { background?: string; color?: string; border?: string; weight?: number }
  >;
  // Motion
  motionDurationMs: number;
  motionEasing: string;
  motionPresets: Record<MotionPreset, { delayMs?: number; transform?: string; opacity?: number }>;
}

export const STYLE_KIT_PRESETS: Record<StyleKit, StyleKitPreset> = {
  /* four kits, fully populated */
};
```

Every kit MUST fill every field. There is no "default" fallback at runtime — a missing token is a compile error. The renderer translates each preset into a block of `--rev01-*` CSS custom properties on the page wrapper; per-variant maps emit `[data-variant="..."]` selectors so action / surface / shape variants pick up the kit's variant tweaks automatically.

Switching the active style kit MUST visibly affect:

- Page background, panel/surface colours, default text colour.
- Body + heading typography (different fonts per kit).
- Action visual variants (a `solid` action in `orange-editorial` differs from a `solid` in `blue-saas`).
- Surface variants (`raised` shadow + radius differ across kits).
- Shape fill/stroke.
- Motion easing/duration (each kit has its own personality — e.g. `orange-editorial` snappier, `green-organic` slower).

- [ ] **Step 2: Apply style kits, variants, and motion presets in editor and public renderer**

Renderer and editor should set CSS variables from `STYLE_KIT_PRESETS[state.styleKit]`.

Pinned styles on a positioned element override only the matching CSS variable or style field for that element.

Renderer and editor must support:

- action variants from `ACTION_VARIANTS`
- container/card variants from `SURFACE_VARIANTS`
- shape variants from `SHAPE_VARIANTS`
- section background effects
- media image and video rendering
- motion presets from `MOTION_PRESETS`

- [ ] **Step 3: Add presence indicator**

In `SiteRoom`, maintain socket count and broadcast `{ type: 'presence', count }` on connect/close.

In editor/public UI, show a small icon and count when present. Do not add full collaborator avatars or remote cursors.

- [ ] **Step 4: Verify**

Run:

```bash
bun.cmd run typecheck
bun.cmd run build
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add src/canvas/schema.ts src/canvas/render.ts src/editor/canvas-client.ts src/editor/canvas-styles.ts src/live/site-room.ts
git commit -m "feat: add style kits and presence indicator"
```

---

### Task 9: Retire Old Flow-Document Path And Update Docs

**Files:**

- Delete or stop exporting: `src/document/*`, `src/multiplayer/*`, old `src/editor/client.ts`, old `src/editor/index.tsx`, old `src/editor/styles.ts`
- Modify: `src/index.ts`
- Modify: `package.json`
- Modify: `wrangler.toml`
- Modify: `README.md`
- Modify: `RECON.md`
- Modify: subsystem docs

- [ ] **Step 1: Remove old route wiring**

In `src/index.ts`, remove:

- old `pages` route unless still used by live site room
- old `agent` route if replaced by `canvas-agent`
- `PageDocument` export
- old editor route import

- [ ] **Step 2: Remove old Durable Object binding**

In `wrangler.toml`, remove `PAGE_DO` only after no imports reference `PageDocument`.

- [ ] **Step 3: Remove legacy document-editor dependencies**

In `package.json`, remove the legacy document-editor package family and any
sync packages used only by that retired path.

Keep a dependency only if a remaining canvas/live file imports it.

- [ ] **Step 4: Update docs**

Update README pitch to:

```md
rev01 is a desktop canvas site builder where an owner starts from one template, edits positioned design primitives with AI help, switches deterministic style kits, and publishes to a real public address that updates open visitor tabs immediately.
```

Update `RECON.md` to mark the legacy flow-document editor and its sync path as superseded by ADR 0003.

- [ ] **Step 5: Verify full reset**

Run:

```bash
bun.cmd run typecheck
bun.cmd run lint
bun.cmd run canvas:smoke
bun.cmd run build
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: retire legacy document poc path"
```

---

## Self-Review Notes

Spec coverage:

- Canvas page, canvas sections, positioned text/media/actions/shapes/containers: Tasks 1 and 4.
- Video support: Tasks 1, 4, 6, and 8.
- Professional template adaptability through curated design primitives, visual variants, section recipes, and motion presets: Tasks 1, 4, 7, and 8.
- One template seed: Task 2.
- Public address under owned domain: Task 5.
- Publish-gated visitor state: Task 5.
- Already-open visitor updates: Task 5.
- AI preview before apply: Task 7.
- AI text rewrite, media replacement, constrained section generation: Task 7.
- Site assets for generated/replaced media: Task 6 and Task 7.
- Small deterministic style kits, variants, and motion presets: Task 8.
- Full multiplayer out of scope, lightweight presence only: Task 8.
- Reuse repo foundations and retire old model: Tasks 2 through 9.

No known unresolved product decisions remain for the first implementation pass.
