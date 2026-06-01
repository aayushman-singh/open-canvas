# Excalidraw Diagram Specs

Written specs for the 9 architecture diagrams that need the hand-drawn aesthetic. You draw each one from its spec; the `.excalidraw` file lives next to this README under the same `Dn-name` slug.

Each spec gives:

- **Purpose** — the one thing the diagram should answer
- **Nodes** — the boxes to draw (named, no implementation details)
- **Edges** — the arrows + their labels (what flows along them)
- **Layout hint** — where each node sits relative to the others
- **Annotations** — callouts to write on the diagram (asterisks, badges)
- **Animation note** (D3, D7 only) — what to reveal in sequence when recording the drawing live

---

## D1 — System architecture overview

**Purpose:** answer "what are all the moving pieces of Open Canvas?" in 60 seconds.

**Nodes:**

- **Visitor browser** — top-left, small
- **Owner browser (editor)** — top-right, small
- **Cloudflare Workers (Hono router)** — center, large box
- **Neon Postgres** — bottom-center
- **Cloudflare R2 (`rev01-assets`)** — bottom-right
- **Durable Objects** — right-of-center, two stacked: `SiteRoom`, `FormRateLimiter`
- **Clerk** — top, external (outside the Worker)
- **Resend** — right edge, external
- **Gemini 2.5 Pro (Google)** — right edge, external
- **Replicate (Flux Schnell)** — right edge, external
- **Cloudflare for SaaS** — top edge, external
- **Cloudflare Turnstile** — top edge, external
- **Scraper service (Playwright)** — top-left, external

**Edges:**

- Visitor → Workers (HTTPS published-site requests + form POST + sitemap/robots/search)
- Owner → Workers (dashboard + editor API + WebSocket upgrade)
- Workers → Neon (Drizzle ORM)
- Workers → R2 (assets, fonts, OG image cache)
- Workers ⇋ SiteRoom DO (WebSocket fan-out for live updates and co-edit)
- Workers → FormRateLimiter DO (per-IP form throttle)
- Workers → Clerk (JWT verify)
- Workers → Resend (invite emails, owner form notifications)
- Workers → Gemini (AI agent + chat tool calls)
- Workers → Replicate (AI image generation)
- Workers → CF for SaaS API (custom hostname register + status poll)
- Workers → Turnstile (form bot verification)
- Workers → Scraper service (site import — disabled in public POC; dashed line)

**Layout hint:** Workers is the central hub; everything else radiates. External services on the top + right edges. Storage along the bottom.

**Annotations:**

- "Edge runtime — no servers" near Workers
- "Content-hash keyed" near R2
- "ADR 0007" near SiteRoom
- "Disabled in public POC" near Scraper (dashed)

---

## D6 — AI agent + chat preview/apply gate

**Purpose:** answer "how does the agent not break the site?"

**Nodes:**

- **Owner prompt** — left edge
- **Gemini 2.5 Pro** — top, external
- **Tool surface (15 mutating + 2 read-only)** — center-left
- **Tool argument parsers** — center, narrow vertical column. Each row a parser: inline marks, media kind, element type, style-kit tokens, page metadata, section motion/background fields, site config
- **Preview ops** — center-right (a stack of preview cards)
- **Owner Accept / Reject** — right edge
- **Apply layer** — right-of-center (only reached after Accept)
- **Validator** — between Apply layer and the editable site (gate)
- **EditableSite (state mutation)** — far right

**Edges:**

- Owner prompt → Gemini (with system prompt + current site state)
- Gemini → Tool surface (chooses tools)
- Tool surface → Tool argument parsers (every arg validated)
- Tool argument parsers → Preview ops (only valid args produce previews)
- Preview ops → Owner (streamed via SSE as cards)
- Owner Accept → Apply layer
- Apply layer → Validator (write gate)
- Validator → EditableSite (only valid ops mutate state)

**Layout hint:** strict left-to-right flow. Validator drawn as a _gate_ with a lock icon — anything that fails fails loudly.

**Annotations:**

- "ADR 0012" near Validator
- "ADR 0014" near Tool argument parsers (template-literal substitution rules)
- "Streamed SSE" on the edge from Preview ops to Owner
- "Read-only: `query_site`, `query_assets`" branching off the Tool surface — these skip the preview/apply path entirely

---

## D7 — Yjs CRDT operation model + element-style projection

**Purpose:** answer "how do two people edit at once without losing edits?"

**Nodes:**

- **Maya's editor (Y.Doc)** — left
- **Sam's editor (Y.Doc)** — right
- **Y.encodeStateAsUpdate** — center-top, twice (one per side)
- **SiteRoom DO (broadcast)** — center
- **Snapshot (Y.encodeStateAsUpdate binary)** — bottom-center, persists to DB
- **EditableSite projection** — between Y.Doc and the canvas, both sides

**Edges:**

- Maya's Y.Doc → encodeStateAsUpdate → SiteRoom (Maya's diff)
- Sam's Y.Doc → encodeStateAsUpdate → SiteRoom (Sam's diff)
- SiteRoom → both Y.Docs (merged updates)
- Both Y.Docs → Snapshot (persist on autosave)
- Both Y.Docs → EditableSite projection (read-side type-shape that `elementStyle` survives across)

**Layout hint:** mirror layout — Maya left, Sam right, central spine of SiteRoom + Snapshot.

**Animation note (live-drawn):**

1. Start with empty Y.Docs both sides.
2. Reveal Maya editing → encodeStateAsUpdate arrow → SiteRoom box appears.
3. Reveal Sam editing concurrently → his arrow appears.
4. SiteRoom merges → draw arrows back to both Y.Docs simultaneously.
5. Draw the projection edges last — these are the read-side.

**Annotations:**

- "Conflict-free by construction"
- "ADR 0007"
- "elementStyle preserved through projection"

---

## D8 — A11y audit pipeline

**Purpose:** answer "what stops a bad-accessibility site from publishing?"

**Nodes:**

- **Publish request** — left
- **A11y orchestrator** — center
- **6 check workers** — column on the right of the orchestrator: alt-text, action-labels, color-contrast, form-field-labels, heading-order, page-meta
- **Crash isolation wrapper** — around each check (a try/catch box)
- **Severity classifier** — bottom-center
- **Issue list (blocking / warning / info)** — bottom-right
- **Publish gate** — far right: if any blocking → publish blocked

**Edges:**

- Publish → A11y orchestrator
- Orchestrator → each of 6 check workers (parallel)
- Each check → Issue list (via severity classifier)
- Issue list → Publish gate (if blocking: stop)
- Publish gate → either Publish proceeds or Publish blocked + report to Owner

**Annotations:**

- "Crash → blocking `audit-crash` issue" — explains the wrapper
- "Contrast resolved against innermost surface by area, then z-index" — beside color-contrast worker
- "Heading H-level from font size via per-kit headingScale" — beside heading-order worker

---

## D11 — Owner Asset content-addressed pipeline

**Purpose:** answer "where do the images live and why don't they duplicate?"

**Nodes:**

- **Upload** — left (file from browser)
- **SHA256 hasher** — center-left
- **Dimension prober** — center-left (magic bytes only — PNG/JPEG/GIF/WebP)
- **R2 (`rev01-assets`)** — center-right, big bucket
- **`owner_asset` table (Neon)** — bottom-center
- **Public URL** — right (`/assets/<contentHash>`)
- **Two owners (different `customer_id`)** — annotated at the bottom of the `owner_asset` row, sharing the same R2 object

**Edges:**

- Upload → SHA256 → contentHash
- contentHash → R2 (write if not present; skip if exists)
- Upload bytes → Dimension prober → width/height
- contentHash + width/height + ownerId → `owner_asset` row
- Public URL ← R2 (content-hash addressable)

**Annotations:**

- "ADR 0004 (ownership) + ADR 0006 (storage)"
- "Same bytes → one R2 object, two `owner_asset` rows"
- "Magic bytes only — no full decode"

---

## D14 — Site Import architecture

**Purpose:** answer "how does the scraper turn a URL into an EditableSite?"

**Nodes:**

- **Owner Import button** — left
- **Workers (validate URL, auth scraper request)** — center-left
- **Scraper service (Playwright, external)** — center
- **Headless browser** — inside the scraper, rendering the source URL
- **DOM extractor** — inside the scraper
- **Element mapper (Import Mapping)** — center-right
- **Asset downloader → R2** — bottom-right
- **Seed color extractor → OKLCH theme algebra → custom Style Kit** — top-right
- **EditableSite with one Canvas Page** — far right

**Edges:**

- Owner → Workers → Scraper service (bearer auth via `SCRAPER_API_SECRET`)
- Scraper → Headless browser → DOM extractor → Element mapper
- Element mapper → EditableSite
- Element mapper → Asset downloader → R2 → Owner Assets
- Element mapper → Seed color → OKLCH algebra → custom Style Kit on EditableSite

**Annotations:**

- "ADR 0008"
- "Disabled in public POC build"
- "Source animations → nearest Motion Preset"

---

## D22 — Security pass (one big poster)

**Purpose:** answer "what stops the obvious attacks?" by listing the defenses on one diagram.

**Layout hint:** grid of small boxes, one per defense, grouped by attack class. Don't try to connect them — this is a glossary diagram.

**Groups:**

- **Auth tokens** — Clerk JWT, edit token (HMAC-SHA256, origin-bound), invite token (HMAC JWT 7-day), unlock cookie (HS256)
- **Hashing** — PBKDF2-SHA256 100k iterations + 32-byte salt (passwords); timing-safe XOR compare for every signature; SHA-256 IP truncation
- **Input** — Drizzle parameterized queries; `escapeHtml`/`escapeAttr`/`escapeCssValue`/`sanitiseCssKey`; SMTP header injection guard; GA measurement ID regex
- **Output** — CSP dynamic `frame-src`; chart SVG attribute escaping; element selector escaping; version-preview metadata XSS hardening; inline-link XSS guard
- **Network** — Turnstile bot challenge; per-IP rate limits (5/min unlock, 10/min form); webhook HMAC-SHA256 `X-Opencanvas-Signature`; redirect path validation
- **Operations** — Admin null-safety; loud failures; custom domain ownership checks; asset unlink logging

**Annotations:**

- Cross-reference the per-defense file (e.g. `src/password/`, `src/embed/csp.ts`) on each box
- One large heading at the top: "Open Canvas — security pass"

---

## D24 — API surface map

**Purpose:** show the 90+ endpoints organized by auth mechanism, not chronologically.

**Layout hint:** three vertical columns.

**Columns:**

- **Public (no auth)** — landing, `/health`, `/favicon.ico`, `/sitemap.xml`, `/robots.txt`, `/og/:siteId/:pageSlug.png`, `/fonts/:contentHash`, `/assets/:contentHash`, `/__opencanvas/forms/:siteId/:formId`, `/__opencanvas/search`, `/__opencanvas/unlock`, `/__live?siteId=&role=`
- **Clerk-authed `/api/*`** — sites (6), publishing (2), canvas-agent (2), chat (2), assets (5), fonts (3), collaborators (3), sections (2), library (3), custom-templates (3), version (4), domains (3), password (2), forms (2), search (1), a11y (1), addons (4), slot-history (3), profile (2), import (1), on-site-edit (1)
- **Edit-token cookie `/__api/*`** — canvas, canvas-agent, publish, owner/assets, sections/import, library/sections, custom-templates, chat

**Annotations:**

- "Durable Objects: SiteRoom (WebSocket), FormRateLimiter"
- "Scheduled: `*/5 * * * *` — custom domain status poll"

---

## D25 — Deploy + runtime

**Purpose:** the operational view: where does code live, how does it ship, what runs at the edge?

**Nodes:**

- **Local dev** — bottom-left (Bun + tsc + smokes)
- **GitHub** — center-left
- **GitHub Actions CI** — center (typecheck, lint, smoke, deploy)
- **Cloudflare Workers** — center-right (the running edge)
- **Neon Postgres** — right
- **Cloudflare R2** — right
- **Durable Object namespaces** — right (SiteRoom, FormRateLimiter)
- **External services** (Clerk, Resend, Gemini, Replicate, Turnstile) — top edge

**Edges:**

- Local dev → git push → GitHub → CI → Workers (deploy via `wrangler deploy`)
- Workers ⇋ Neon (via `DATABASE_URL`)
- Workers ⇋ R2 (binding)
- Workers ⇋ DO namespaces
- Workers → external services (env-secret-bound HTTP calls)

**Annotations:**

- "Bun 1.3.14"
- "TS strict mode, ES2022"
- "Migrations in `drizzle/`"
- "13 env secrets"
- "Routes: `opencanvas.aayushman.dev` + `*.opencanvas.aayushman.dev`"

---

## D28 — DevEx

**Purpose:** show what makes the codebase navigable + safe to change.

**Nodes / groups:**

- **40+ smoke test scripts** — hermetic, no network, no DB (`bun run <name>:smoke`)
- **Pure validators** — collect ALL errors (no fail-fast); guard page width, section height, element types, href schemes, inline marks
- **Layout engine** — semantic tree (stack/grid/split) resolved to positioned CanvasSection
- **Design section parser** — LLM semantic output → positioned canvas section with validated element placement
- **Type invariants** — `_ELEMENT_TYPES_COVERS_UNION` + `_UNION_COVERS_ELEMENT_TYPES` compile-time checks on schema.ts; similar pair for inline marks
- **CLAUDE.md / CONTEXT.md / ADR index** — the doc surface
- **Subsystem READMEs** — `src/*/SUBSYSTEM.md` per major folder

**Layout hint:** a grid of small named cards, one per group, grouped under "Build-time safety" and "Run-time safety" and "Doc surface." This is a glossary diagram, not a flow.

**Annotations:**

- "Pre-commit hook: typecheck"
- "ADR catalog drives architectural intent — not FEATURES.md"
