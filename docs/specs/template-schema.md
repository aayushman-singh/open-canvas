# Template Seed Schema

**Status:** Current
**Date:** 2026-05-28

## Goal

Define the Template Seed vocabulary and the seed-to-site flow for the canvas
builder. A Template Seed stores a complete `EditableSite`: Style Kit choice,
Canvas Pages, shared header/footer Sections, and optional site-wide publish
settings. Creating a site copies that state into a new Editable Site.

This spec is the source of truth for:

1. The **Template Seed** shape copied into a new Editable Site.
2. The **Canvas Site State** vocabulary every seed must satisfy.
3. The **seed to Editable Site flow** when an Owner starts from a seed.

The source of truth in code is `src/canvas/schema.ts`; seed definitions live in
`src/templates/registry.ts` and fixture JSON lives in `src/canvas/fixtures/`.

## 1. Template Seed

```typescript
type TemplateSeed = {
  id: string;
  name: string;
  tagline: string;
  state: EditableSite;
};
```

Rules:

- `id` is a stable URL-safe identifier.
- `name` and `tagline` are dashboard copy only.
- `state` is deep-cloned before it becomes an Editable Site.
- A seed must not depend on per-owner records except through Owner Asset ids
  that the seed materialisation step is prepared to copy or remap.

## 2. Canvas Site State

```typescript
type EditableSite = {
  styleKit: StyleKit;
  pages: CanvasPage[];
  header?: CanvasSection;
  footer?: CanvasSection;
  customStyleKit?: StyleKitPreset;
  defaultLocale?: string;
  siteNoIndex?: boolean;
  darkModeEnabled?: boolean;
  faviconAssetId?: string;
};
```

Rules:

- `pages` contains one or more Canvas Pages.
- `styleKit` is one of the built-in Style Kits or `custom`.
- `customStyleKit` is required when `styleKit` is `custom`.
- `header` and `footer`, when present, are site-wide Sections rendered on every
  Canvas Page.
- Publish settings (`defaultLocale`, `siteNoIndex`, `darkModeEnabled`,
  `faviconAssetId`) are copied into the Published Snapshot on publish.

## 3. Canvas Page

```typescript
type CanvasPage = {
  id: string;
  slug: string;
  title: string;
  width: number;
  sections: CanvasSection[];
  description?: string;
  ogImageAssetId?: string;
  canonical?: string;
  noIndex?: boolean;
  locale?: string;
  entranceAnimation?: MotionPreset;
  scrollTriggerMode?: ScrollTriggerMode;
  pageBackground?: string;
  defaultMotionPreset?: MotionPreset;
  sectionGap?: number;
  maxWidth?: number;
  publishedDate?: string;
  author?: string;
  tags?: string[];
  category?: string;
};
```

Rules:

- `slug` is the visitor path segment; `/` is represented by the homepage slug
  used by the route layer.
- `title` is required and feeds dashboard labels and SEO title output.
- `sections` contains the page body Sections only; shared header/footer
  Sections live on `EditableSite`.
- Optional SEO and metadata fields are rendered by the publish and public host
  layers.

## 4. Canvas Section

```typescript
type CanvasSection = {
  id: string;
  recipeId: SectionRecipeId;
  name: string;
  height: number;
  role?: 'header' | 'footer' | 'body';
  backgroundEffect?: BackgroundEffect;
  entrance?: MotionPreset;
  trigger?: { type: 'exit-intent' | 'delay' | 'scroll'; value?: number };
  backgroundVideo?: string;
  elements: CanvasElement[];
};
```

Rules:

- `role` defaults to `body`.
- A Section owns a bounded two-dimensional editing space.
- `elements` are positioned Content Elements rendered in deterministic order.
- `recipeId` records the Section Recipe used to create the Section; `custom`
  is valid for owner-authored shapes.

## 5. Content Elements

Every Content Element has:

```typescript
type BaseElement = {
  id: string;
  type: ElementType;
  box: PositionedBox;
  motion?: { preset: MotionPreset; delayMs?: number };
  pinnedStyle?: Record<string, string>;
  elementStyle?: ElementStyle;
  responsive?: ResponsiveOverrides;
};
```

Current `ElementType` values:

| Type | Purpose |
| --- | --- |
| `text` | Rich inline text with roles, marks, alignment, and typography controls. |
| `media` | Image or video Owner Asset display. |
| `action` | Visitor-facing link or page action. |
| `shape` | Decorative or structural shape primitive. |
| `container` | Surface primitive for grouping or visual framing. |
| `form` | Visitor submission form. |
| `embed` | Allowlisted external frame. |
| `chart` | Static chart rendered as SVG. |
| `accordion` | Interactive disclosure set. |
| `carousel` | Interactive slide set. |
| `table` | Structured tabular content. |
| `code` | Syntax-highlighted code snippet. |
| `nav` | Visitor navigation element. |
| `collection` | Manual or page-backed collection display. |

Text content is an ordered list of inline runs:

```typescript
type InlineRun = {
  text: string;
  marks?: InlineMark[];
};
```

Inline marks are intentionally small: bold, italic, underline, strike, code,
highlight, and link. A Text Element remains one positioned visual paragraph;
paragraph grouping belongs to Sections and Pages, not to the inline text model.

## 6. Seed To Editable Site Flow

1. Owner selects a Template Seed in the dashboard.
2. Client submits `{ templateId, siteName, subdomain }` to the site creation
   route.
3. Server resolves the Template Seed from `src/templates/registry.ts`.
4. Server deep-clones the seed's `EditableSite`.
5. Server materialises any seed assets for the Owner.
6. Server creates a new Editable Site row with the cloned state.
7. Dashboard sends the Owner to the Canvas Editor for the new site.

No per-seed build, per-seed Worker, or external deployment step exists in this
flow. Publish later promotes the Editable Site state into a Published Snapshot.

## 7. Validation

Validation lives in `src/canvas/validate.ts` and related element-level modules.
It checks:

- State has at least one Canvas Page.
- Every Page, Section, and Content Element has a stable id.
- Element `type` values are known.
- Required element fields are present and valid.
- Action links use supported target shapes.
- Media references point to Owner Asset ids and carry alt text.
- Style Kit selection is valid, including the `custom` requirements.
- Inline marks are known and link marks use allowed URLs.

The validator fails loudly with explicit errors. It does not substitute default
state or silently skip invalid elements.
