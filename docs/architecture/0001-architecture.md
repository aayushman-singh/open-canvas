# ADR 0001 — rev01 architecture

**Status:** Accepted
**Date:** 2026-05-21
**Author:** Aayushman Singh

## Context

rev01 is a multiplayer, AI-native site builder. Product requirements:

1. A user describes a site in plain language; an AI agent drafts editable pages.
2. Multiple users can edit the same page at the same time without conflicts.
3. The published site loads fast from anywhere in the world.
4. The system must reach a demoable MVP fast and be cheap to operate at portfolio scale.
5. Lean target: under 5,000 LOC for v0.

This ADR fixes the architectural choices that fall out of those requirements.

## Decisions

### 1. Single edge-runtime bundle

One Cloudflare Worker hosts: the dashboard UI, the JSON API, the customer-site renderer, the AI agent endpoints, and the WebSocket entry to per-page Durable Objects.

**Why:** one deploy, one log stream, one bill, sub-50ms cold start, no Node-to-edge polyfill drift, no split between "marketing app" and "render app." Eliminates an entire class of cross-runtime configuration bugs.

### 2. Hono + `hono/jsx`

Hono is the router; the dashboard UI is server-rendered JSX inside the same Worker.

**Why:** smallest router that runs on Workers. `hono/jsx` removes the need for a separate React SSR framework while keeping the JSX authoring surface.

### 3. One ProseMirror document per page

Each page is one `document.json`. TipTap v3 binds to it in the browser; the renderer walks it on the edge.

**Why:** full-page editing is the product surface — users edit prose, headings, sections, and media inline, with a single selection model. A field-by-field bound editor would split that surface across dozens of UI components and would not support cross-element selection. ProseMirror is the canonical engine for collaborative rich-text editing and has first-class CRDT integration.

### 4. Yjs CRDT in a per-page Durable Object

Each page has one Durable Object that owns the live Yjs document and the WebSocket connections to active editors. The DO snapshots the Yjs document to Postgres every 50 ops or 10 seconds (whichever first). The op log is not persisted: Yjs converges from any snapshot plus the connected clients' state.

**Why:** Durable Objects give us a single-writer authoritative actor without running our own coordination service. Snapshotting bounds recovery cost on DO eviction. Op-log skip keeps storage cost flat over time. Worst case on a DO crash is a loss of the most recent few seconds of edits — acceptable for portfolio stage.

### 5. AI agent as first-class collaborator

The agent gets a reserved Yjs `clientId`. Its avatar appears in the top-bar collaborator list with a distinct glyph. Every operation it emits is attributable to actor `agent` in revision history.

**Why:** the demo story is "you and the agent edit the same document." If the agent edits are anonymous, a viewer cannot tell what the agent did. Reserving a `clientId` is a one-line Yjs primitive — no extra infra.

### 6. Anthropic Claude with tool use over the schema

The agent's tools are document operations: `insertSection`, `editText`, `swapImage`, `setTheme`, etc. The model emits tool calls; the server applies them as Yjs operations on the live document.

**Why:** Claude's tool-use surface maps cleanly to a constrained operation vocabulary, which keeps the agent's output well-formed by construction. Streaming a list of operations is also a better UX than streaming raw HTML — the user sees the document change incrementally as the agent reasons.

### 7. Drizzle ORM + Neon serverless Postgres

Schema in `src/db/schema.ts`; queries via Drizzle; transport via Neon's HTTP driver.

**Why:** the Neon HTTP driver is one of the few Postgres clients that runs inside a Workers isolate without a TCP-over-HTTP shim. Drizzle is TypeScript-first and edge-safe. No connection pooling needed at this scale.

### 8. Path-routed customer sites for MVP

Customer sites live at `rev01.<domain>/s/:siteId/*` on the canonical host. Custom-domain support is deferred to post-MVP.

**Why:** custom-domain provisioning means a hostname-to-site mapping in a Durable Object, a DNS verification poller, an SSO handshake from the dashboard origin to the customer origin (because session cookies do not cross origins), and per-tab edit-mode state on the customer site. All of that is real work that does not contribute to the headline multiplayer-plus-agent demo. Path routing keeps everything on one origin, which means Clerk session cookies just work.

### 9. Single Clerk session, no token handoff

Clerk's session cookie covers the whole product because everything is on one origin. The dashboard, the editor, and the customer-site preview all read the same `__session` cookie.

**Why:** falls out of decision #8. Cross-origin handoff is only needed when origins differ.

### 10. Pure-function renderer in the Worker

`renderDoc(doc, theme) → string`. No framework. No SSR engine. The Worker reads the page row from Postgres (or KV cache), calls `renderDoc`, returns HTML.

**Why:** a doc-to-HTML walk is ~200 lines. Any framework adds cold-start cost and a build pipeline for no behavioural win.

### 11. Templates are seed documents

A template is a row in `templates`: an id, a name, a thumbnail, a theme token set, and an array of `{ slug, title, doc }`. `POST /sites` copies the template row's pages into new `Site` and `Page` rows.

**Why:** templates are content, not deployable artifacts. Adding a template is an INSERT. There is no per-template build, no version pinning, no separate Worker.

### 12. Workers Analytics Engine for visitor analytics

Edge requests fire a single `writeDataPoint` call to a binding. The dashboard queries the Analytics Engine SQL endpoint and renders a chart.

**Why:** zero extra vendor. Works inside a Worker. Adblocker-proof by construction (the request is to the customer origin, not a third party). 90-day retention is adequate at portfolio scale.

### 13. Zero published npm packages

All code in `src/` with relative imports. No private registry, no versioning, no publish-before-deploy invariant.

**Why:** publishing creates an out-of-band step between editing source and seeing the change deploy. At portfolio scale there is no second consumer, so a package boundary buys nothing.

### 14. Subsystem docs

Each subsystem under `src/<name>/` carries a `SUBSYSTEM.md` with four fields: name, definition (the why), inputs (inbound semantic relations), outputs (outbound semantic relations). Zero implementation details.

**Why:** these files anchor the conceptual model. They onboard a reviewer in two minutes without dragging them through code.

## Out of scope for MVP

Pricing UI, payments, multi-tenancy admin console, cron jobs, email automation, custom domains, form submissions, appointment booking, ingestion / scraping tooling. Each can be added after the headline demo lands; none contributes to the portfolio narrative.

## Consequences

**Positive:**
- One deploy command, one logs stream, one bill.
- LOC target plausible: under 5,000 for v0.
- All product features observable on one URL.

**Negative:**
- Customer sites share a path prefix with the dashboard until custom-domain support lands — acceptable trade for MVP.
- Neon HTTP driver has higher per-query latency than a TCP-pooled client (≈40 ms vs ≈5 ms). Acceptable for dashboard reads; hot paths can move to KV cache.
- Workers Analytics Engine has limited query expressiveness — adequate for the headline chart, less so for ad-hoc analysis.

## Follow-ups

- ADR 0002 — Document schema vocabulary (nodes, marks, attrs).
- ADR 0003 — Multiplayer transport (Yjs over WebSocket on Durable Object: protocol, snapshot cadence, recovery semantics).
- ADR 0004 — AI agent tool surface (tool names, JSON Schema, streaming protocol, reserved client id, history attribution).
- ADR 0005 — Theme tokens (OKLCH derivation, WCAG checks, runtime CSS variable emission).
- ADR 0006 — Design language: Post-Aero (D) rationale and token graph.
