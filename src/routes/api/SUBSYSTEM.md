# api

## Definition

Programmatic surface for the dashboard, the canvas editor, the AI agent, and
the publish pipeline. Receives mutation requests from signed-in callers,
verifies ownership of the targeted site, validates the proposed canvas state
against `src/canvas/schema.ts` + `src/canvas/validate.ts`, either applies the
change transactionally to Postgres, snapshots the editable state to the
Published Address, or streams agent events while routing each agent op
through the same validator so previews + applies cannot drift. Anonymous
callers are bounced to the identity gate before any handler runs.

## Active endpoints (canvas-first POC)

- **`canvas.ts`** — `GET/PATCH /api/canvas/:siteId` (load + mutate
  `CanvasSiteState`), `POST /api/canvas/:siteId/assets` (upload media as a
  data URL, persist to `site_asset`).
- **`canvas-agent.ts`** — `POST /api/canvas-agent/:siteId` — NDJSON stream of
  agent events (thinking / tool-call / preview / applied / error). Previewed
  edits are returned to the editor for accept/reject; on accept, the op is
  applied and the canvas state is updated.
- **`publish.ts`** — `POST /api/publish/:siteId` — snapshot the editable
  state, write it to `site.publishedSnapshot`, bump `publishedVersion`, and
  broadcast the new version through the site's `SiteRoom` Durable Object so
  open Visitor tabs swap in the new bytes.
- **`sites.ts`** — `POST /api/sites` (create a site from the canonical
  Template Seed + seed media assets), `GET /api/sites/:siteId` (owner-side
  metadata), `DELETE /api/sites/:siteId`.

## Inputs

- **dashboard caller** — request to create a site from the Template Seed,
  carrying a user-supplied site name + subdomain.
- **editor caller** — request to mutate the canvas, upload media, accept an
  AI-previewed edit, or publish.
- **agent caller (editor chat panel)** — request to drive the AI agent over
  the canvas with a natural-language prompt.
- **request context** — the resolved Clerk user, supplied by the identity
  gate, used to resolve the owning customer row and to verify site
  ownership.
- **environment** — Neon database URL, Gemini API key, `SITE_ROOM` Durable
  Object binding.

## Outputs

- **site store** — site, page, and site-asset rows; transactional so partial
  failure rolls back.
- **`SiteRoom` Durable Object** — a publish-broadcast message keyed by site
  id when a publish lands.
- **caller** — JSON for programmatic callers, NDJSON for the agent stream, a
  4xx with an error body for missing / invalid / unauthorised input.

## Retired endpoints

`pages.ts` (legacy per-page mutation) and `agent.ts` (legacy agent over Yjs)
are **superseded** by the canvas pair above. The files remain on disk for
reference but are unmounted from `src/index.ts`, excluded from typecheck +
lint, and unreachable from the bundler. See [ADR
0003](../../../docs/adr/0003-canvas-first-reset.md) for the reset rationale.
