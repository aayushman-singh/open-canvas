# api

## Definition

Programmatic surface for the dashboard, canvas editor, AI preview/apply flow,
asset library, and publish pipeline. Every mutating route is authenticated,
resolves the owning customer, verifies site ownership, validates the relevant
canvas state, and either writes the editable state, writes a media asset,
updates a style kit, returns an AI preview, applies accepted AI ops, or
promotes the editable state to a published snapshot.

## Active Endpoints

- **`sites.ts`** -> create a site from the canonical Template Seed and seed
  media assets.
- **`canvas.ts`** -> load/save the editable `CanvasSiteState`, upload assets,
  serve owner-gated asset previews, and change the active Style Kit.
- **`canvas-agent.ts`** -> produce AI previews and apply accepted op lists
  after validation and asset ownership checks.
- **`publish.ts`** -> snapshot the editable state, verify referenced assets,
  write `publishedSnapshot`/`publishedVersion`, and broadcast the new HTML via
  `SiteRoom`.

## Inputs

- **dashboard caller** -> site name, subdomain, and template id.
- **editor caller** -> editable-state saves, asset uploads, style-kit changes,
  AI prompts, accepted ops, and publish requests.
- **identity gate** -> current Clerk user, used to resolve the customer row.
- **environment** -> Neon database URL, Gemini API key, and `SITE_ROOM`.

## Outputs

- **Postgres** -> customer, site, and site-asset rows.
- **SiteRoom** -> publish broadcasts and presence sockets.
- **caller** -> JSON success bodies or explicit 4xx/5xx errors with context.
