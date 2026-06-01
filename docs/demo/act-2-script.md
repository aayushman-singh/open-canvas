# Act 2 — Engineering Walkthrough

> **Runtime target:** ~30–60 minutes. **Voice:** host-narrator (same voice as Act 1, no seam). **Format:** voiceover paired with diagram callouts. Diagrams referenced as `[DIAGRAM: D1 ...]` markers that map to files in `diagrams/`.

## Reading conventions

- **Diagram source location:** Mermaid sources live in [`diagrams/mermaid/`](diagrams/mermaid/) and render inline in this doc as `mermaid` code fences. Excalidraw architecture diagrams are pre-rendered PNGs in [`diagrams/excalidraw/`](diagrams/excalidraw/) — see [`SPECS.md`](diagrams/excalidraw/SPECS.md) for the written specs they're drawn from.
- **ADR references:** every diagram that maps to a decision links the ADR in `docs/adr/`. The ADR is the canonical record; this script is the narrative wrapping.
- **Animation:** mostly static. Two beats (D3 SiteRoom fan-out, D7 Yjs CRDT replay) are recorded as live Excalidraw drawing sessions for animation effect; everything else is voiceover-over-static-image.

---

## Beat index — 29 diagram-anchored blocks

| # | Block | Diagram | ADR / source | Tool |
|---|---|---|---|---|
| D1 | System architecture overview | [`excalidraw/D1-architecture.excalidraw`](diagrams/excalidraw/D1-architecture.excalidraw) | ADR 0001, 0003 + `wrangler.toml` | Excalidraw |
| D2 | Style Kit determinism + dark variants | [`mermaid/D2-style-kit.md`](diagrams/mermaid/D2-style-kit.md) | `src/canvas/style-kits.ts` | Mermaid |
| D3 | Live updates — SiteRoom DO WebSocket fan-out | [`mermaid/D3-fanout.md`](diagrams/mermaid/D3-fanout.md) **+ live-drawn Excalidraw** | `src/live/site-room.ts`, ADR 0007 | Mermaid sequence + animated Excalidraw |
| D4 | Published address routing | [`mermaid/D4-routing.md`](diagrams/mermaid/D4-routing.md) | ADR 0002 | Mermaid state |
| D5 | Edit token issuance + origin binding | [`mermaid/D5-edit-token.md`](diagrams/mermaid/D5-edit-token.md) | `src/auth/`, ADR 0005 (custom-domain context) | Mermaid sequence |
| D6 | AI agent + chat — preview/apply gate, validator, tool surface | [`excalidraw/D6-agent-gate.excalidraw`](diagrams/excalidraw/D6-agent-gate.excalidraw) | ADR 0012 validation-write-gate, ADR 0014 template-literal-substitution | Excalidraw |
| D7 | Yjs CRDT operation model + element-style projection | [`excalidraw/D7-yjs-crdt.excalidraw`](diagrams/excalidraw/D7-yjs-crdt.excalidraw) **+ live-drawn replay** | ADR 0007 | Excalidraw + animation |
| D8 | A11y audit pipeline — 6 checks, crash isolation, contrast resolution, heading-from-font-size | [`excalidraw/D8-a11y.excalidraw`](diagrams/excalidraw/D8-a11y.excalidraw) | `src/a11y/SUBSYSTEM.md` | Excalidraw |
| D9 | Responsive layout engine + breakpoint cascade | [`excalidraw/D9-layout.excalidraw`](diagrams/excalidraw/D9-layout.excalidraw) | `src/canvas/responsive/` | Excalidraw |
| D10 | Invite token (HMAC JWT) sequence | [`mermaid/D10-invite-token.md`](diagrams/mermaid/D10-invite-token.md) | `src/auth/invite-token.ts`, ADR 0010 | Mermaid sequence |
| D11 | Owner Asset content-addressed dedup + R2 + dimension probing | [`excalidraw/D11-asset-pipeline.excalidraw`](diagrams/excalidraw/D11-asset-pipeline.excalidraw) | ADR 0004, ADR 0006 | Excalidraw |
| D12 | Library section import + seed materialization | [`mermaid/D12-library-import.md`](diagrams/mermaid/D12-library-import.md) | `src/canvas/library-section-import.ts` | Mermaid sequence |
| D13 | Version snapshot pipeline + Y.Doc deterministic encoding | [`mermaid/D13-version-snapshot.md`](diagrams/mermaid/D13-version-snapshot.md) | `src/version/` | Mermaid sequence |
| D14 | Site Import (scraper service) architecture | [`excalidraw/D14-site-import.excalidraw`](diagrams/excalidraw/D14-site-import.excalidraw) | ADR 0008 | Excalidraw |
| D15 | Form pipeline — Turnstile → DO rate limiter → DB → HMAC webhook + Resend | [`mermaid/D15-form-pipeline.md`](diagrams/mermaid/D15-form-pipeline.md) | `src/forms/` | Mermaid sequence |
| D16 | Password gate sequence — PBKDF2 + HS256 unlock + rate-limit + redirect sanitization | [`mermaid/D16-password-gate.md`](diagrams/mermaid/D16-password-gate.md) | `src/password/` | Mermaid sequence |
| D17 | Custom domain state machine + CF for SaaS lifecycle + cron poll | [`mermaid/D17-custom-domain.md`](diagrams/mermaid/D17-custom-domain.md) | ADR 0005, `src/custom-domain/` | Mermaid state |
| D18 | SEO meta emission pipeline (JSON-LD, OG, Twitter, canonical, lang) | [`mermaid/D18-seo-meta.md`](diagrams/mermaid/D18-seo-meta.md) | `src/seo/` | Mermaid sequence |
| D19 | OG image pipeline — Satori → resvg-wasm → R2 content-hash cache | [`mermaid/D19-og-image.md`](diagrams/mermaid/D19-og-image.md) | `src/og-image/` | Mermaid sequence |
| D20 | Atomic search index rebuild (PG FTS) | [`mermaid/D20-search-rebuild.md`](diagrams/mermaid/D20-search-rebuild.md) | `src/search/` | Mermaid sequence |
| D21 | Addon entitlement vs site-addon split + lifecycle | [`mermaid/D21-addon-entitlement.md`](diagrams/mermaid/D21-addon-entitlement.md) | ADR 0009 | Mermaid state |
| D22 | Security pass — HMAC, timing-safe, CSP, XSS guards, redirect sanitization, SMTP injection, GA validation, admin null-safety | [`excalidraw/D22-security.excalidraw`](diagrams/excalidraw/D22-security.excalidraw) | various — see ledger | Excalidraw (one big poster) |
| D23 | Database schema ER (17 tables) | [`mermaid/D23-schema-er.md`](diagrams/mermaid/D23-schema-er.md) | `src/db/schema.ts`, `drizzle/` | Mermaid ER |
| D24 | API surface map (90+ endpoints) | [`excalidraw/D24-api-surface.excalidraw`](diagrams/excalidraw/D24-api-surface.excalidraw) | `src/routes/` | Excalidraw |
| D25 | Deployment + runtime (Workers, Hono, Neon, R2, DOs, Bun, CI/CD) | [`excalidraw/D25-deploy.excalidraw`](diagrams/excalidraw/D25-deploy.excalidraw) | `wrangler.toml`, `package.json`, CI workflows | Excalidraw |
| D26 | Dual rate limiter — in-process (dev) vs DO (prod), same interface | [`mermaid/D26-rate-limiter.md`](diagrams/mermaid/D26-rate-limiter.md) | `src/live/form-rate-limiter.ts` | Mermaid class |
| D27 | CSP dynamic frame-src derived from page-used embed providers | [`mermaid/D27-csp.md`](diagrams/mermaid/D27-csp.md) | `src/embed/csp.ts` | Mermaid sequence |
| D28 | DevEx — smoke tests, pure validators, layout engine, design section parser | [`excalidraw/D28-devex.excalidraw`](diagrams/excalidraw/D28-devex.excalidraw) | `scripts/`, `src/canvas/responsive/`, smokes | Excalidraw |
| D29 | In-app notifications — writer at row-commit point → `NotificationOwnerRoom` DO fan-out → per-Owner SSE → dashboard + editor bell. Per-kind email policy in parallel. Reconnect backfill via `Last-Event-ID` + `?since=…`, no in-memory queue. | [`mermaid/D29-notification-sse.md`](diagrams/mermaid/D29-notification-sse.md) | ADR 0043, `src/notifications/`, `src/routes/api/notifications.ts` | Mermaid sequence |

---

## Suggested narrative order

The diagrams in their natural narrative order (not the numeric order above):

1. **D1 architecture** — set the picture before any zoom-in
2. **D4 published-address routing** — answer "how does a URL find a site?"
3. **D11 asset pipeline (R2 + dedup)** — answer "where do the images live?"
4. **D2 style kit determinism** — answer "why does the editor look like the published site?"
5. **D9 layout engine + responsive** — answer "how does breakpoint switching work?"
6. **D7 Yjs CRDT** (with animation) — answer "how do two people edit at once?"
7. **D3 SiteRoom fan-out** (with animation) — answer "how do visitors see edits live?"
8. **D5 edit token + D10 invite token** — answer "how does auth work across surfaces?"
9. **D6 AI agent + chat gate** — answer "how does the AI not break the site?"
10. **D13 version snapshot + Y.Doc encoding** — answer "how is history stored?"
11. **D12 library section import + D14 site import** — answer "how do sites get content?"
12. **D8 a11y audit** — answer "what stops bad accessibility from publishing?"
13. **D18 SEO meta emission + D19 OG image + D20 search rebuild** — answer "what happens at publish?"
14. **D15 form pipeline + D16 password gate** — answer "how is visitor input handled?"
15. **D21 addon entitlement split** — answer "how is per-site capability modeled?"
16. **D17 custom domain state machine** — answer "how does briar.app work?"
17. **D27 CSP frame-src + D26 dual rate limiter + D22 security poster** — answer "what stops the obvious attacks?"
18. **D29 notification SSE pipeline** — answer "how did Maya's bell light up the moment the visitor submitted?" (pairs with D3 SiteRoom fan-out as the second live channel — D3 is per-site for visitors and co-editors; D29 is per-Owner for notifications)
19. **D23 schema ER** — the data view of everything you just saw
20. **D24 API surface + D25 deploy + D28 DevEx** — the operational view

---

## Status

- **Diagram inventory:** complete (this file).
- **Mermaid sources:** to draft inline in `diagrams/mermaid/`. Pending.
- **Excalidraw specs:** to write in `diagrams/excalidraw/SPECS.md`. Pending.
- **Voiceover script:** to draft block-by-block after diagrams are in place. Pending.
- **Recommended drafting order:** Mermaid first (cheaper), Excalidraw specs second, voiceover third — once you can see all the visuals you'll know how much words each one needs.
