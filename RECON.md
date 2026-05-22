# Recon — rev01

> Canvas-first POC. Architecture is reasoned from the lived Owner / Visitor experience; see [docs/adr/0003-canvas-first-reset.md](docs/adr/0003-canvas-first-reset.md) and the implementation plan in [docs/superpowers/plans/2026-05-22-canvas-first-poc.md](docs/superpowers/plans/2026-05-22-canvas-first-poc.md).

---

## Elevator pitch

rev01 is a **desktop canvas site builder** — one Template Seed, positioned design primitives, deterministic Style Kits, an AI agent that previews edits before applying them, and a Published Address that updates open Visitor tabs immediately. Single Cloudflare Worker, single bundle, single Durable Object (`SiteRoom`) per site for publish broadcasts and presence.

---

## Live state

- **Build:** Bun + Wrangler + Hono scaffold with strict TypeScript, ESLint, Prettier, and a Worker dry-run build.
- **Local dev:** `bun install` then `bun.cmd run dev`; `/` renders the Post-Aero landing, `/health` returns a JSON heartbeat, `/dashboard` is Clerk-gated.
- **Deployed URL:** <https://rev01.aayushman.dev>.
- **Published Addresses:** `*.rev01.aayushman.dev` via wildcard CNAME + Workers Route on the `aayushman.dev` zone.

---

## Locked decisions (canvas-first POC)

| Dim | Choice |
|---|---|
| Product name | `rev01` |
| Runtime | Single Cloudflare Worker — dashboard, API, editor, agent, public host |
| Router + UI | Hono + `hono/jsx` |
| Modules | Flat `src/`, no monorepo |
| Editor | Vanilla browser JS over a positioned canvas (`src/editor/canvas-*`) |
| Document model | `CanvasSiteState` — positioned primitives + StyleKit selector (`src/canvas/schema.ts`) |
| Style system | Deterministic Style Kits with typography / surfaces / shapes / actions / motion (`src/canvas/style-kits.ts`) |
| Live | `SiteRoom` Durable Object per site — publish broadcasts + presence (`src/live/site-room.ts`) |
| AI | Gemini adapter with previewed edits + recipe registry (`src/agent/canvas-{ops,tools,agent-smoke}.ts`, `src/canvas/recipes.ts`) |
| Renderer | Pure JSON -> HTML (`src/canvas/render.ts`) |
| DB | Drizzle + Neon (HTTP driver) |
| Auth | Clerk, single origin |
| Site routing | `*.rev01.aayushman.dev` wildcard for Visitors; `rev01.aayushman.dev` for the app |
| Templates | One canonical Template Seed (`src/canvas/fixtures/home.json`) |
| Persona | Indie creators / solo founders |
| Mobile editing | Desktop-only; published sites render responsively |
| License | MIT |
| Default branch | `main` |

---

## What is retired (and where it still lives on disk)

The original ProseMirror + Yjs architecture has been **superseded** by the canvas-first POC. ADR 0003 records the reset. The legacy files are kept on disk as inert reference — excluded from typecheck (`tsconfig.json` `exclude`), excluded from lint (`eslint.config.js` `ignores`), and unreachable from `src/index.ts` so the bundler never pulls them in. The deps that powered them (`prosemirror-model`, `prosemirror-state`, `prosemirror-transform`, `y-prosemirror`, `y-protocols`, `yjs`) have been removed from `package.json`.

Retained files (read-only reference):

- `src/document/` — old ProseMirror document vocabulary + renderer. `src/db/schema.ts` still imports the pure types from here for the legacy `page` table.
- `src/multiplayer/` — old Yjs DO + snapshot + pm-schema.
- `src/editor/{client.ts,index.tsx,styles.ts}` — old multiplayer editor.
- `src/agent/{ops.ts,orchestrator.ts,smoke.ts,tools.ts,_live-smoke.ts}` — old agent over Yjs ops.
- `src/routes/api/{pages.ts,agent.ts}` — old per-page mutation + agent endpoints (unmounted).
- `src/routes/dashboard/theme.tsx` — old theme studio (unmounted).

Reviving any of these = restore the dep, un-exclude the path, re-import in `src/index.ts`. Nothing else has been deleted.

---

## Current backlog

| # | Task | Status |
|---|------|--------|
| 1 | Repo + landing | done |
| 2 | Clerk + first DB row | done |
| 3 | Canvas schema + validator + renderer | done |
| 4 | Style Kit registry (depth pass) | done |
| 5 | Editor canvas (positioned primitives + drag) | done |
| 6 | Canvas API (load/save/publish) | done |
| 7 | Published Address (wildcard host + snapshot serve) | done |
| 8 | Live publish broadcast + presence (`SiteRoom`) + visitor-update smoke | done |
| 9 | Previewed AI canvas edits + recipe registry | done (T6 in plan) |
| 9-partial | Retire ProseMirror + Yjs deps, unwire legacy routes, refresh docs | this commit |

See the plan at `docs/superpowers/plans/2026-05-22-canvas-first-poc.md` for the full task list.

---

## Open questions

None. Architecture reset captured in ADR 0003 (2026-05-22).
