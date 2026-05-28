# Handoff: Comprehensive Playwright Browser Testing + UX Audit

## Focus for Next Session

Run a full Playwright MCP browser walkthrough of every feature on production (`rev01.aayushman.dev`), testing as a real user (clicks, typing, navigation — not programmatic API calls). Dual purpose: (1) verify all features work, (2) audit whether each feature is discoverable from the UI alone.

## What Was Done This Session

### Bug Fixes Deployed (9)
- B1: OG image absolute URLs on subdomains
- B2: WebSocket exponential backoff (was 35+ errors per page)
- B4: Clerk publishableKey stripped from iframe previews
- B5: `__placeholder__` asset early-return
- B6: HTML entity double-escaping in A11y report
- B7: Site limit enforced in UI ("Upgrade to add sites" at 3/3)
- B8: Version timeline route mounted (was 404)
- R1: Full-text search — added missing `tsv` tsvector column + GIN index to Neon prod DB
- Editor syntax error from template literal escape sequences (used `String.fromCharCode(10)` pattern)

### UX Improvements Deployed (4)
1. **Site-level sidebar navigation** — 9 links (Editor, Settings, Navigation, Forms, Versions, Domains, Addons, Accessibility, Chat) on all `/dashboard/sites/:id/*` pages. File: `src/routes/dashboard/shell.tsx` exports `buildSiteNav()`. All 9 site sub-pages pass `siteNav` prop.
2. **14 element types in editor Add panel** — added Form, Embed, Code, Accordion, Carousel, Table, Nav to `src/editor/canvas-index.tsx` (HTML buttons) and `src/editor/canvas-client.ts` (action handlers with sensible defaults).
3. **AI Chat slide-out panel** — Chat button in editor header toggles a 360px right-side panel with SSE streaming to `POST /api/sites/:siteId/chat`. Files: `canvas-index.tsx` (panel HTML), `canvas-styles.ts` (CSS), `canvas-client.ts` (toggle + SSE reader).
4. **AI Agent "AI" button** — cyan accent button in editor header opens `openTextModal` prompt, calls `runAiPreview()`. Wired in `canvas-client.ts`.

### Testing Completed (first pass)
Pages tested with screenshots: Landing, Dashboard, Templates, Addon Shop, Published Site (test1), Editor (Add/Sections/Pages tabs), Site Settings, Forms, Versions, Domains, Chat, Nav Editor, Addons, A11y Report, Profile, Account Settings.

## Key Artifacts

| Artifact | Path |
|---|---|
| Exhaustive feature catalog (43 areas) | `FEATURES.md` |
| Test report + UX audit + visibility matrix | `DEMO_TEST_REPORT.md` |
| E2E test inventory | `E2E_FEATURES.md` |
| Domain language | `CONTEXT.md` |
| Previous handoff (bug fix details) | `handoff-gtf92vrm.md` |

## How to Run the Testing

### Prerequisites
- Production is live at `https://rev01.aayushman.dev`
- User must sign in via Clerk first (the browser session must be authenticated)
- Use Playwright MCP tools: `mcp__playwright__browser_navigate`, `mcp__playwright__browser_click`, `mcp__playwright__browser_snapshot`, `mcp__playwright__browser_take_screenshot`, `mcp__playwright__browser_evaluate`, `mcp__playwright__browser_fill_form`, `mcp__playwright__browser_console_messages`
- Load tool schemas via `ToolSearch` with `select:mcp__playwright__browser_navigate,...` before use

### Test Plan — Feature Walkthrough

**Phase 1: Public (no auth)**
1. Landing page (`/`) — hero panels, tagline, feature cards, stat counters, footer, CTA links, 0 console errors
2. Published site (`test1.rev01.aayushman.dev`) — full rendering, OG meta (verify absolute URLs), sitemap.xml, robots.txt, full-text search (`/__rev01/search?q=enterprise`), 0 WebSocket storms
3. OG image (`/og/:siteId/home.png`) — renders 1200x630 PNG

**Phase 2: Dashboard (auth required)**
4. Dashboard (`/dashboard`) — stat cards (Total/Published/Storage/Plan), site cards with previews, "Upgrade to add sites" at 3/3 limit, kebab menu details
5. Templates (`/dashboard/templates`) — 6 template cards, site name + subdomain fields, Create button
6. Addon Shop (`/dashboard/shop`) — 2 addon cards (GA + Custom Scripts)
7. Profile (`/dashboard/profile`) — display name, email, bio, timezone, sign out
8. Account Settings (`/dashboard/settings`) — Billing/Notifications/Account tabs, plan tiers, usage meters

**Phase 3: Site Management (sidebar navigation)**
For site `52968fe1-065a-464e-9f7d-eaa639789f10` (test1):

9. Settings (`/dashboard/sites/:id/settings`) — sidebar renders with 9 links, "Settings" highlighted, password protection + collaborators sections
10. Navigation (`/dashboard/sites/:id/nav`) — bar config, layout dropdown, links management
11. Forms (`/dashboard/sites/:id/forms`) — empty state or form list
12. Versions (`/dashboard/sites/:id/snapshots`) — timeline with Published v1, Preview/Restore buttons, snapshot label input
13. Domains (`/dashboard/sites/:id/domains`) — add domain form, empty state
14. Addons (`/dashboard/sites/:id/addons`) — GA toggle + measurement ID, Custom Scripts shop link
15. Accessibility (`/dashboard/sites/:id/a11y`) — severity badges, warning/info cards, proper quote rendering
16. Chat (`/dashboard/sites/:id/chat`) — message area, input field, Send button

**Phase 4: Editor**
17. Editor (`/dashboard/sites/:id/edit`) — canvas renders, editor header has AI + Chat + Save + Publish + Save as template
18. Add panel — verify all 14 elements: Text, Image, Video, Button, Shape, Container, Chart, Form, Embed, Code, Accordion, Carousel, Table, Nav
19. Sections tab — searchable section catalog
20. Pages tab — page list with slugs, "+ New Page"
21. Versions tab — check if it loads (was intermittent)
22. Chat panel — click Chat button, verify slide-out opens with input + Send
23. AI button — click AI, verify prompt modal opens
24. Style kit switching — click each of 4 kits in COLORS section

**Phase 5: Interactive Element Testing (optional, may modify site data)**
25. Add a Form element to a section, verify it renders
26. Type a message in Chat, verify SSE streaming
27. Use AI button with a prompt, verify preview panel

### UX Audit Checklist

For each page, answer:
- Can a new user find this feature without knowing the URL?
- Is the navigation path obvious (< 3 clicks from dashboard)?
- Are empty states helpful (tell user what to do next)?
- Are error states clear?
- Is the current page indicated in the sidebar/nav?

Current visibility score: **25 of 43 features discoverable** (up from 15 before this session). The remaining 18 unsurfaced features are documented in `DEMO_TEST_REPORT.md` Part 4.

## Known Remaining Issues

| # | Issue | Severity |
|---|-------|----------|
| R2 | Sitemap URL has `#v=1` hash fragment | Low |
| R3 | Templates page "Create site" not gated at plan limit (server blocks with 403 but UX is confusing) | Low |
| R4 | Editor Versions tab may not load on click (intermittent) | Low |
| — | Clerk publishableKey error on every page (cosmetic, in page chrome) | Cosmetic |

## Constraints

- **canvas-client.ts forbids backticks** — stray `` ` `` closes the template literal. Use `String.fromCharCode(10)` instead of `"\n"` for newlines in generated JS strings.
- **No fallbacks** — fail loudly or fix the root cause.
- **Conventional commits** — `feat:`, `fix:`, `refactor:`, etc.
- **Test against production** — `rev01.aayushman.dev`. Dev server at `localhost:8787` requires Clerk auth which blocks most pages.

## Suggested Skills

- `/verify` — verify features work in the real app via browser
- `/superpowers:verification-before-completion` — evidence before assertions
- `/superpowers:systematic-debugging` — for any bugs found during testing
