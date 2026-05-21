# Template schema spec

**Status:** Draft
**Date:** 2026-05-21

## Goal

Define the document vocabulary, the template descriptor format, and the seed-to-site flow. A template is a **seed document**: creating a site copies the template's document into a new row, and editing the site is editing that document. No per-block versioning, no field mappings, no per-template build.

This spec is the source of truth for:
1. The **document model** — ProseMirror node and mark vocabulary every template and every site must conform to.
2. The **template descriptor** — sidecar metadata describing a template to the catalog.
3. The **seed → site flow** — what happens when a user clicks "Use template."

The schema is derived directly from product requirements, not from any external reference. Vocabulary covers the minimum set of structural primitives a Gamma-style page composer needs.

## 1. Document model

A page is one document. A site is N pages. The TypeScript schema in `src/document/schema.ts` is the source of truth — TipTap's runtime schema and the renderer both consume it.

### 1.1 Design principles

- **Composition over configuration.** A small set of primitives that compose, not a large set of pre-baked block types.
- **Semantic, not visual.** A node says what it is (`actions`, `media`), not how it looks. Visual variation lives in attrs (`variant`, `align`, `style`) and theme tokens.
- **Renderer-friendly.** Every node maps to a small, predictable HTML output. No node requires conditional walking, lookback, or external data.
- **Editor-friendly.** Every node has obvious insertion, deletion, and selection behaviour in TipTap.
- **Agent-friendly.** Every node is constructible by Claude tool-use without ambiguity.

### 1.2 Node types

| Node | Kind | Required attrs | Optional attrs | Children |
|---|---|---|---|---|
| `doc` | root | — | — | `1+ section` |
| `section` | block | `kind` (`hero` \| `feature` \| `pricing` \| `gallery` \| `cta` \| `footer` \| `custom`) | `surface` (theme-token ref), `padding` (`sm` \| `md` \| `lg`), `bg` (url or theme-token ref) | `block+` |
| `heading` | block | `level` (1–6) | `align` (`start` \| `center` \| `end`) | `inline+` |
| `paragraph` | block | — | `align` | `inline*` |
| `media` | atom-block | `src`, `mediaType` (`image` \| `video` \| `iframe`) | `alt`, `aspectRatio`, `loading` (`lazy` \| `eager`) | — |
| `actions` | block | — | `align` | `1+ action` |
| `action` | inline-block | `href`, `label` | `variant` (`primary` \| `secondary` \| `ghost`), `newTab` (bool) | — |
| `columns` | block | `count` (`2` \| `3` \| `4`) | `gap` (`sm` \| `md` \| `lg`) | `column+` |
| `column` | block | — | `width` (`auto` \| `1/2` \| `1/3` \| `2/3` \| `1/4` \| `3/4`), `align` | `block+` |
| `divider` | atom-block | — | `style` (`line` \| `dot` \| `space`) | — |
| `list` | block | `style` (`bullet` \| `numbered` \| `check`) | — | `listItem+` |
| `listItem` | block | — | — | `inline+` |
| `text` | leaf | — | `marks` | — |

**Content groups:**
- `block` = `heading | paragraph | media | actions | columns | divider | list`
- `inline` = `text` (carries marks)

### 1.3 Marks

| Mark | Attrs | Excludes |
|---|---|---|
| `bold` | — | — |
| `italic` | — | — |
| `underline` | — | — |
| `code` | — | all others |
| `link` | `href`, `target`, `rel` | — |
| `color` | `value` (theme-token ref or hex) | — |
| `highlight` | `value` (theme-token ref or hex) | — |

### 1.4 Notes on omissions

- **No collection / repeater node.** Pages are static documents. Listing pages (blog index, gallery feed) are out of MVP scope; when they land they become a separate page kind, not a node inside `doc`.
- **No icon node.** Icons go through `media` with an SVG src.
- **No subscript / superscript marks.** Out of scope for the launch templates.
- **No strikethrough.** Edit history makes strikethrough redundant.

## 2. Template descriptor

Stored alongside the seed document in the `templates` table.

```typescript
type TemplateDescriptor = {
  id: string;                    // url-safe slug, e.g. "acme-coffee"
  name: string;                  // display name
  tagline: string;               // 1-line pitch
  category: 'business' | 'portfolio' | 'landing' | 'product' | 'blog';
  thumbnail: string;             // R2 url
  designLanguage: DesignLanguageId; // see design-variants.md
  tokens: ThemeTokenSet;         // baseline tokens; user can override per site
  pages: TemplatePage[];         // 1+ pages
};

type TemplatePage = {
  slug: string;                  // url path, e.g. "/", "/about"
  title: string;
  doc: DocumentJSON;             // the seed ProseMirror document
};

type ThemeTokenSet = {
  paletteSeed: string;           // OKLCH hex; rest derived
  font: { heading: string; body: string };
  radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  density: 'compact' | 'normal' | 'comfortable';
};
```

## 3. Seed → site flow

1. User clicks "Use template" on a `TemplateDescriptor`.
2. `POST /api/sites` with `{ templateId, siteName }`.
3. Server:
   - Creates a `Site` row.
   - For each `TemplatePage`, creates a `Page` row with `doc = deepClone(template.pages[i].doc)`.
   - Copies `template.tokens` into `Site.tokens`.
   - Returns `siteId`.
4. Dashboard navigates to `/dashboard/sites/<siteId>`.
5. Editor loads page 0 via `GET /api/pages/<pageId>` → renders TipTap with `doc`.

No per-template build. No Wrangler deploy. No R2 archive. Adding a template is one INSERT.

## 4. Validator

`src/document/validate.ts` — pure function `validateDocument(doc: unknown) → { valid: true } | { valid: false, errors: string[] }`.

Checks:
- Root type is `doc`.
- At least one `section`.
- All node and mark types exist in the schema.
- Required attrs present.
- Text nodes have no children.
- `media.mediaType` matches expected `src` shape (image url for `image`, video url for `video`, allowlisted host for `iframe`).

Does not enforce ProseMirror content expressions at the JSON level — TipTap enforces those at edit time. The validator is for catalog-upload safety and AI-agent output checks.

## 5. Open follow-ups

- **Per-page theme override.** v1 keeps tokens site-wide; per-page override is post-MVP.
- **Embed allowlist.** Hardcoded: `youtube.com`, `vimeo.com`, `loom.com`, `codesandbox.io`, `figma.com`. Validator rejects anything else.
- **Schema versioning.** Add `Site.schemaVersion: 1` column when the first breaking change ships. Until then, no version field is needed.
