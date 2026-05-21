# rev01

> Multiplayer, AI-native site builder. Describe a site in one sentence, get an editable, multiplayer, edge-rendered site back.

**Status:** pre-alpha, scaffolding in progress. Live URL coming soon at `rev01.aayushman.dev`.

## Why

Existing builders gatekeep the editing surface behind subscription tiers and ship templates that all look the same. rev01 collapses site creation into a single ProseMirror document per page, edits it with multiplayer presence and a Claude-powered agent, and renders it from one Cloudflare Worker — no per-template build, no separate frontend service, no field-by-field editor surface.

## Stack

- **Runtime:** Single Cloudflare Worker — dashboard, API, customer-site render, agent, all in one bundle
- **Router + UI:** Hono + `hono/jsx` (no Next.js, no Pages)
- **Editor:** TipTap v3 + Yjs CRDT + Durable Object per page
- **Renderer:** pure JSON → HTML in the Worker
- **DB:** Drizzle + Neon (HTTP driver, edge-callable)
- **Auth:** Clerk
- **AI:** Anthropic Claude (tool use over document schema, streamed Yjs ops)
- **Storage:** R2 (assets), KV (hot config), DO (per-page editor state)
- **Design language:** Post-Aero (Vista-glass × terminal × live data chrome) — see [docs/specs/design-variants.md](docs/specs/design-variants.md) §D

Architectural rationale + ADRs: [`docs/architecture/`](docs/architecture/). Document schema spec: [`docs/specs/template-schema.md`](docs/specs/template-schema.md).

## Run locally

TBD — scaffolding pending.

## License

MIT — see [LICENSE](LICENSE).
