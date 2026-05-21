# Recon — rev01

> Greenfield, clean-room multiplayer + AI-native site builder. Architecture is reasoned from product requirements; see [docs/architecture/0001-architecture.md](docs/architecture/0001-architecture.md) and [docs/specs/](docs/specs/).

---

## Elevator pitch

rev01 is a **multiplayer, AI-native site builder** — one ProseMirror document per page, edited live with Yjs CRDT, rendered by one Cloudflare Worker, driven by a Claude agent that streams document operations. Recruiter hook: *"Webflow's editor plus Figma's multiplayer plus Cursor's agent, deployed as one edge binary."*

---

## Live state

- **Build:** none — repo scaffolded only (LICENSE, README, .gitignore, ADR 0001, specs).
- **Local dev:** none.
- **Deployed URL:** none. Placeholder host: `rev01.aayushman.dev`.
- **Deployed state:** none.

---

## Locked decisions

| Dim | Choice |
|---|---|
| Product name | `rev01` |
| Design language | **D — Post-Aero** (Vista-glass × terminal × live data chrome). See [docs/specs/design-variants.md](docs/specs/design-variants.md) §D |
| Runtime | Single Cloudflare Worker — dashboard, API, customer-site render, agent, all in one bundle |
| Router + UI | Hono + `hono/jsx` |
| Modules | Flat `src/`, no published packages, no monorepo workspaces |
| Editor | TipTap v3 + ProseMirror, whole page = `document.json` |
| Multiplayer | Yjs CRDT + one DO per page + WebSocket; top-bar avatars only; snapshot to Postgres every 50 ops / 10s |
| Agent visibility | Reserved Yjs `clientId`; appears as `<agent>` chip in top bar + history attribution |
| AI | Anthropic Claude w/ tool use over document schema; streamed Yjs ops |
| Renderer | Pure JSON → HTML in Worker |
| DB | Drizzle + Neon (HTTP driver) |
| Auth | Clerk, single origin, no token handoff |
| Site routing | Path-based `/s/:siteId/*` on canonical host; custom domains post-MVP |
| Templates | 3 hand-built seed documents in DB |
| Billing / cron / admin / forms / bookings / scraping | Out of MVP |
| Persona | Indie creators / solo founders |
| Demo data | Anon-editable "Acme Coffee" site |
| Mobile editing | Desktop-only; mobile renders read-only |
| i18n | Skip |
| License | MIT |
| Default branch | `main` |
| LOC target (v0) | < 5,000 |

---

## Backlog — ranked by hire-impact-per-hour

Effort: **S** (under 2h), **M** (half day), **L** (full day+). Impact: low / medium / high.

| # | Task | Effort | Impact | Why hireable |
|---|------|--------|--------|--------------|
| 1 | Reserve subdomain DNS, deploy "coming soon" + waitlist via CI | S | high | Day-one live URL on resume |
| 2 | Repo wiring: Bun + Wrangler + Hono + `hono/jsx` + Drizzle + strict TS + ESLint + Prettier + Conventional Commits + ADR convention + SUBSYSTEM.md convention. Single `wrangler.toml`, single entrypoint `src/index.ts` | S | high | Visible hygiene |
| 3 | Post-Aero (D) landing replacing "coming soon" — hero = 3-panel live editor+preview+agent view, terminal status bar, IBM Plex, deep-navy + cyan accent | M | high | First impression |
| 4 | README v1 — 3-sentence pitch, GIF/Loom of dramatic interaction, run-locally, mermaid arch diagram, ADR 0001 link | S | high | Engineer reviewer scan |
| 5 | Clerk auth + magic-link + first Drizzle/Neon table (`Customer`) | S | medium | Signed-up users = live data |
| 6 | `src/document/` — clean-room TypeScript ProseMirror schema per [template-schema.md](docs/specs/template-schema.md) + pure-function renderer (`renderDoc(doc, theme) → string`) | M | medium | Editor foundation |
| 7 | 3 hand-built templates as seed `document.json` per template-schema spec; `templates` table + `POST /sites` flow | M | medium | Catalog + site-create end-to-end |
| 8 | **Multiplayer editor MVP** — TipTap + Yjs + DO per page + WebSocket; top-bar avatar list | L | **high** | Headline differentiator |
| 9 | **AI agent over doc.json** — Claude tool use, streaming ops applied via Yjs, agent appears as one of the avatars | L | **high** | Hiring trend + matches multiplayer surface |
| 10 | **Live theme studio** — palette → OKLCH derivation of full token set, WCAG contrast pass/fail, hot-reload preview | M | high | Visible design-system depth |
| 11 | Edge analytics dashboard via Workers Analytics Engine + custom chart | M | high | Live data badge |

**Hard-stop after #10. #11 only if time remains before outreach.**

Post-MVP (do not dispatch now): custom-domain support, forms, appointments, billing, admin console, scraping.

---

## Recommended dispatch order

1. Task #1 — DNS + coming-soon deploy.
2. Task #2 — repo wiring.
3. Task #4 (draft) — README v1.
4. Task #3 — Post-Aero landing.
5. Task #5 — Clerk + first DB row.
6. Task #6 — `src/document/` schema + renderer.
7. Task #7 — 3 templates + `POST /sites`.
8. Task #8 — multiplayer.
9. Task #9 — AI agent.
10. Task #10 — theme studio.
11. Task #4 (revisit) — README final with Loom + diagrams.

---

## Cred prerequisites (gating dispatch)

All accounts must be **personal**, with no overlap with any prior employer's infrastructure.

| Cred | Status |
|---|---|
| Cloudflare account ID + API token (Workers, KV, R2, DO, Analytics Engine, DNS edit) | Pending |
| `aayushman.dev` zone present in personal CF account | Pending |
| Neon API key OR connection string | Pending |
| Clerk publishable + secret keys (Development instance) | Pending |
| Anthropic API key | Pending |
| GitHub remote location + auth | Pending |

---

## Open questions

None — all locked 2026-05-21.

---

*Ready to dispatch once creds arrive. Tasks #1, #2, #4-draft are unblocked by infra. Tasks #5, #6, #3 follow once #2 lands.*
