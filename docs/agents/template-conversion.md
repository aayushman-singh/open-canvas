# Template Conversion Runbook

Use this when converting a URL or GitHub repository into an Open Canvas builder template.

## Done State

A conversion is done only when a user can open the dashboard template picker, see the new template in the Community tab, preview it with real assets, create a site from it, and inspect an explicit list of source-site behaviors that were not replicated.

Open Canvas has two template paths:

- Built-in global templates are `TemplateSeed`s in `src/templates/registry.ts` and `allTemplateSeeds`.
- DB-backed global custom templates are separate rows managed by `src/routes/api/custom-templates.ts`.

Do not invent another visibility tier. For a source URL or GitHub repo conversion, default to a built-in `TemplateSeed` unless the user explicitly asks for DB-backed custom-template behavior.

## First Read The Workspace

Before editing, check:

```bash
git status --short
```

Record unrelated dirty files and do not repair them unless they block the template work.

Read these files as needed:

- `src/templates/registry.ts`: current `TemplateSeed` shape, style kit pattern, `allTemplateSeeds`.
- `src/canvas/section-library/entries/*.json`: Section Library entry examples.
- `src/canvas/section-library/entries/manifest.ts`: generated entry manifest.
- `scripts/sync-section-library-manifest.ts`: manifest sync.
- `src/canvas/seed-assets.ts`: bundled seed asset registry.
- `src/assets/seed-source/`: base64 source bytes for seed assets.
- `src/assets/seed-script.ts`: seed asset verifier and R2 uploader.
- `src/routes/dashboard/templates.tsx`: dashboard picker and preview helpers.
- `src/routes/dashboard/template-preview.smoke.ts`: global picker/preview smoke.
- `docs/specs/designer-template-fidelity-gaps.md`: known builder fidelity gaps.

`docs/specs/template-schema.md` is useful background, but the code in `src/templates/registry.ts` is the current source of truth for composition-era templates.

## Source Intake

For a GitHub repo, clone it outside the workspace, usually under a temp directory. For a URL, inspect enough source to identify the page structure, assets, styles, and runtime behavior.

Inventory:

- Pages/routes and slugs.
- Sections and visible copy.
- Navigation and cross-page links.
- Images, videos, fonts, icons, and generated/canvas assets.
- Interactions: typewriter, preloader, route transitions, canvas/WebGL, games, tabs, carousels, hover effects, scroll scenes.
- License or explicit user permission for source assets.

Write a short working-backwards brief:

- Why this template exists from the user's perspective.
- Observable success criteria.
- Non-goals.
- Hard constraints, including asset permissions and unsupported source behavior.

## Red Tests First

Create or extend focused smokes before production changes.

Template smoke:

- Path: `src/templates/<template-id>.smoke.ts`.
- Assert `getTemplateSeed('<template-id>')` exists.
- Assert page count and important slugs.
- Call `instantiateTemplate`.
- Run `validateEditableSite`, `validateSeedFixture`, and `validatePublishedSnapshot`.
- Render with `renderCanvasSnapshot` plus `injectInteractiveRuntime`.
- Assert essential source copy and source asset ids are present.
- Assert forbidden source-runtime tokens are absent.

Dashboard/global smoke:

- Path: `src/routes/dashboard/template-preview.smoke.ts`.
- Assert `allTemplateSeeds` includes the template id.
- Render `renderBuiltInTemplatePreviewBodyHtml('<template-id>')`.
- Assert representative copy and media ids appear.
- If adding seed assets, assert `renderBuiltInTemplatePreviewAssetResponse` reads the seed asset `r2Key`.

Package script:

```json
"<template-id>:smoke": "bun run src/templates/<template-id>.smoke.ts"
```

Run the new or changed smoke and confirm it fails for the expected missing behavior before implementing.

## Section Library Entries

Create one JSON entry per reusable section:

- Path: `src/canvas/section-library/entries/<base-slug>.json`.
- Required metadata: `baseSlug`, `category`, `name`, `description`, `recipeId`, `headingPreview`, `sectionData`, `originTemplateId`.
- The manifest row id is `<baseSlug>-v1`.

Use builder-native elements:

- `text` for copy and visible labels.
- `media` for images/videos with seed or owner assets.
- `action` for links and buttons.
- `nav` for site navigation.
- `tabs`, `accordion`, `carousel`, `collection`, and supported interactive primitives where available.
- `container` and `shape` for native visual framing.

Do not paste source framework components, raw CSS files, arbitrary scripts, external asset URLs, GSAP blobs, or complete React/Vue/Svelte apps into the template. Translate to schema-owned pages, sections, elements, style kits, seed assets, and supported interactions.

After adding or changing entries:

```bash
bun run section-library:sync
```

## Source Assets

Only import source media when the source license allows it or the user explicitly approves it.

For every bundled source image:

1. Write base64 bytes to `src/assets/seed-source/<seed-name>.<ext>.b64`.
2. Add immutable metadata to `src/canvas/seed-assets.ts`:
   - `contentHash`: sha256 of raw bytes.
   - `r2Key`: `assets/<first-32-hash-chars>.<ext>`.
   - `mediaType`.
   - `kind`.
   - `width`.
   - `height`.
   - `byteSize`.
   - `sourcePath`.
   - `alt` in `SEED_ASSET_REGISTRY`.
3. Reference the seed id from Section Library `media.assetId` fields.

Verify source bytes:

```bash
bun run seed:assets
```

For global dashboard previews and created sites, upload seed bytes to R2:

```bash
bun run seed:assets --upload --remote
```

If the upload fails, report it as a deployment blocker. Do not claim global image availability while R2 objects are missing.

## Template Registry

In `src/templates/registry.ts`:

- Add a `StyleKitPreset` if the source needs a custom look.
- Export a `TemplateSeed` with stable `id`, `name`, `tagline`, `styleKit`, optional `customStyleKit`, optional `headerRef` and `footerRef`, and `pages`.
- Each page uses `bodyRefs` pointing to Section Library rows such as `<baseSlug>-v1`.
- Add the template to `allTemplateSeeds`.

Use deterministic ids:

- Template id: URL-safe kebab case.
- Page ids: `page-<template-id>-<role>`.
- Section instance ids: stable and readable.
- Element ids: semantic and source-specific enough to avoid collisions.

## Verification

Run these after implementation:

```bash
bun run <template-id>:smoke
bun run template-preview:smoke
bun run section-library-composition:smoke
bun run seed:assets
bun run assets:smoke
bun run typecheck
```

Also run `bun run seed:assets --upload --remote` when the template introduces source seed assets that must display globally.

If `bun run typecheck` fails in unrelated dirty files, report the exact files and errors. Do not patch unrelated work just to make the final line green.

## Final Report

Report:

- Template id and where it is globally visible.
- Files changed.
- Source assets imported and whether R2 upload succeeded.
- Verification commands and outcomes.
- Detailed gaps that remain.
- Unrelated workspace failures, if any.

Gap categories:

- Unsupported source runtime or framework behavior.
- Unsupported animation/interaction capability.
- Asset, font, or licensing constraints.
- Layout differences caused by builder-native primitives.
- Deployment steps not completed, especially R2 upload or Worker deploy.

Do not call a behavior done when it is an approximation. Say what is native, what is missing, and what builder capability would close the gap.
