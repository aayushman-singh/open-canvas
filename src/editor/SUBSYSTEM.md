# editor

> Status: **canvas-first POC** as of T9-partial (2026-05-22).
> The active editor is the canvas editor: `canvas-index.tsx` (server render), `canvas-client.ts` (browser runtime), `canvas-styles.ts` (CSS). The previous ProseMirror + Yjs editor (`index.tsx`, `client.ts`, `styles.ts`) is **superseded** — those files remain on disk for reference but are out of typecheck, lint, and bundle scope. See [ADR 0003](../../docs/adr/0003-canvas-first-reset.md).

## Definition (current — canvas editor)

`editor` owns the experience an authenticated Owner has when they want to change one of their sites. Its contract: given a site identity and a signed-in customer who owns it, present a desktop canvas where positioned design primitives can be dragged, sized, restyled, and reordered; expose a Style Kit picker that swaps the deterministic palette + typography + surfaces + shapes + actions + motion in one click; offer a chat panel where the AI agent proposes a previewed edit the Owner accepts or rejects; surface a Publish button that promotes the editable state to the Published Address and updates open Visitor tabs immediately via `SiteRoom`.

The subsystem makes no decisions about how state is persisted (canvas API), how the public host serves a snapshot (`src/routes/public.ts`), how the AI agent reasons (`src/agent/canvas-*`), or how primitives map to HTML (`src/canvas/render.ts`). It is purely the human-facing edge.

## Inputs

- **site owner (signed-in customer)** — the intent to mutate the site (drag, resize, type, switch kit, ask the agent, publish), identified by site id in the URL.
- **canvas API** — the current `CanvasSiteState` for the site and the response to each mutation.
- **`SiteRoom` DO** — live presence + publish-success broadcasts for the site.
- **canvas-agent API** — NDJSON stream of agent events for the chat panel.

## Outputs

- **canvas API** — mutation requests (`PATCH /api/canvas/:siteId` etc.) and publish requests.
- **page owner** — a continuously updated canvas view, a Style Kit picker, a chat panel that streams the agent's reasoning + a previewed-edit accept/reject, a presence indicator, and a Publish button with its current state.

## Retired files

- `index.tsx` — old ProseMirror server-rendered editor shell.
- `client.ts` — old browser runtime (TipTap + Yjs WebSocket provider).
- `styles.ts` — old editor CSS.

Reviving them = un-exclude the three files in `tsconfig.json` and `eslint.config.js`, restore the `prosemirror-*` / `y-*` deps in `package.json`, restore the `editor` import + `app.route('/dashboard', editor)` mount in `src/index.ts`, and restore the `PAGE_DO` binding + a fresh migration tag in `wrangler.toml`.
