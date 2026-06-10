# Open Canvas

> A desktop canvas site builder where an Owner starts from one Template Seed, edits positioned design primitives with AI help, switches deterministic Style Kits, and publishes to a real Published Address that updates open Visitor tabs immediately.

[![CI](https://github.com/aayushman-singh/open-canvas/actions/workflows/deploy-worker.yml/badge.svg)](https://github.com/aayushman-singh/open-canvas/actions/workflows/deploy-worker.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Live](https://img.shields.io/badge/live-opencanvas.aayushman.dev-cyan)](https://opencanvas.aayushman.dev)

## Demo

▶️ **[Watch the full walkthrough →](https://youtu.be/VIDEO_ID)**  _(replace `VIDEO_ID` with your YouTube video id)_

<!--
  Hero clip: add a short (~10s) optimized GIF or a GitHub-hosted .mp4 under
  docs/media/, then uncomment one of these for an inline preview:
  ![Open Canvas in action](docs/media/demo.gif)
  [![Watch the demo](docs/media/demo-thumbnail.png)](https://youtu.be/VIDEO_ID)
-->

## What it is

Open the dashboard, name a site, and drop into a canvas pre-populated from one Template Seed. Drag positioned design primitives, ask the AI agent for a previewed edit, swap deterministic Style Kits live, and click Publish — the Published Address (`<subdomain>.opencanvas.aayushman.dev`) updates in every open Visitor tab within a few hundred milliseconds. One Cloudflare Worker hosts the dashboard, the editor, the canvas API, the AI agent endpoint, the publish snapshot store, and the public host that serves Visitors.

## Stack

- Cloudflare Workers + Hono JSX (single bundle)
- Drizzle ORM + Neon serverless Postgres (HTTP driver)
- Clerk auth (single origin, no token handoff)
- Durable Object: `SiteRoom` — publish broadcasts + presence
- Gemini adapter for previewed AI edits
- Vanilla browser JS in the editor (no client framework)

## How it compares

Most site builders are *template hosts*: you pick a layout, fill predefined slots, pay for hosting, and republish to push a change live. Open Canvas is built on a different premise — a free-form canvas, an agent at the cursor, and a live document the whole team shares. The table below maps the differences axis by axis.

| Axis | The familiar template-host approach | Open Canvas |
|---|---|---|
| **Editing model** | Fill predefined slots in a fixed template | Free-form 2D canvas — 14 positioned design primitives, dragged, resized, and rotated anywhere |
| **AI** | None, or a copy-writing box bolted on | A 15-operation canvas agent plus multi-turn chat — every edit is previewed before it lands |
| **Collaboration** | One editor at a time | Real-time co-editing over a Yjs CRDT with Figma-style presence cursors — conflict-free by construction |
| **Publishing** | Republish, then reload to see it | Publish broadcasts to every open Visitor tab over a Durable Object socket — updates land in a few hundred milliseconds, no refresh |
| **Theming** | Token panel that can drift from the live site | Deterministic Style Kits — one 12-token OKLCH grammar renders identically in the editor and in published output, with pre-computed dark variants |
| **Content** | Static fields; "no CMS" | First-class Collections — manual or page-bound entries, field binding, per-entry OG images, all rendered to static HTML |
| **Reuse** | Template variants | Section Library with lineage, asset manifests, and cross-template import |
| **History** | A single backup, if any | Full snapshot timeline (Yjs binary), preview + one-click restore, automatic pre-restore safety snapshot |
| **Accessibility** | Not addressed | Six-category audit that *blocks* publish on serious issues, with element-level remediation hints |
| **Forms** | A block that collects fields | Turnstile bot protection, per-IP and per-form rate limits, HMAC-signed webhooks, CSV export, AJAX with a no-JS fallback |
| **Media** | Manual upload | Content-addressed dedup pipeline, magic-byte probing, slot history, and text-to-image generation |
| **Reach** | English, LTR | Per-page locale, localized routing, and RTL coordinate mirroring at render time |
| **Output** | Framework-rendered pages | Pure HTML — interactive runtime injected only when a section needs it; zero client-framework weight otherwise |
| **Security** | Edit sessions + headers | Timing-safe crypto, SVG-upload block, `nosniff`, embed-aware CSP, fail-closed rate limiters, atomic custom-domain rollback |
| **Runtime** | A multi-service stack to operate | One Cloudflare Worker — dashboard, editor, canvas API, agent, snapshot store, and public host in a single deploy unit |
| **Discipline** | Roadmap docs | 66 architecture decision records, 40+ hermetic smoke tests, 71-area E2E suite, and a single canvas validation write-gate |

The throughline: the previous generation lets you *fill in a layout*. Open Canvas lets you, an agent, and your whole team *design on one live canvas* — and ships the result as clean, accessible, framework-free HTML.

## Develop

```bash
bun install
bun.cmd run dev            # wrangler dev — http://localhost:8787
```

`/` renders the Post-Aero landing. `/health` returns a JSON heartbeat. `/dashboard` is gated by Clerk.

## Verify

```bash
bun.cmd run typecheck       # tsc --noEmit
bun.cmd run lint            # eslint .
bun.cmd run canvas:smoke    # canvas schema + validator + renderer round-trip
bun.cmd run canvas-agent:smoke   # canvas-agent tool surface + op application
bun.cmd run review:smoke    # publish + visitor-update integration
bun.cmd run build           # wrangler deploy --dry-run
```

## Status

Live at **[opencanvas.aayushman.dev](https://opencanvas.aayushman.dev)** and under active development. Issues and PRs welcome.

## Documentation

- [FEATURES.md](FEATURES.md) — exhaustive feature reference
- [docs/adr/](docs/adr/) — 66 architecture decision records (the reasoning behind every major choice)
- [CONTEXT.md](CONTEXT.md) — domain language and core concepts

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the dev loop and PR checklist, plus [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) and [SECURITY.md](SECURITY.md) for reporting vulnerabilities.

## License

[MIT](LICENSE) (c) 2026 Aayushman Singh
