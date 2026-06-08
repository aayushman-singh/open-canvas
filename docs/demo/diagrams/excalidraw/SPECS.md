# Excalidraw Diagram Specs

Written specs for the 4 architecture diagrams that need the hand-drawn aesthetic. You draw each one from its spec; the `.excalidraw` file lives next to this README under the same `Dn-name` slug.

Trimmed 2026-06-07 — D1, D11, D22, D24, D25, D28 specs deleted along with the rest of the routine plumbing. Only the flagship beats from [`../act-2-canvas.md`](../act-2-canvas.md) survive here.

Each spec gives:

- **Purpose** — the one thing the diagram should answer
- **Nodes** — the boxes to draw (named, no implementation details)
- **Edges** — the arrows + their labels (what flows along them)
- **Layout hint** — where each node sits relative to the others
- **Annotations** — callouts to write on the diagram (asterisks, badges)
- **Animation note** (D7 only) — what to reveal in sequence when recording the drawing live

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
