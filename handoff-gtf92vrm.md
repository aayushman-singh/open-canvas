# Handoff: Bug Fixes & UX Discoverability Improvements

## Focus for Next Session

Fix 3 critical bugs and 4 moderate bugs found during live Playwright testing against production, then implement UX changes so users can discover all 43 feature areas from the UI without knowing URL patterns.

## Repo & Branch

- **Repo:** `C:\Repo\rev01` (git, branch `main`)
- **Stack:** Cloudflare Workers + Hono + Drizzle ORM + Neon Postgres + Yjs + Gemini
- **Production:** `https://rev01.aayushman.dev`
- **Dev:** `npx wrangler dev` on `http://127.0.0.1:8787`

## Key Artifacts (do not re-derive)

| Artifact | Path | What it contains |
|---|---|---|
| Exhaustive feature catalog | `FEATURES.md` | All 43 feature areas, 90+ endpoints, 14 element types, 17 tables |
| Test report + UX audit | `DEMO_TEST_REPORT.md` | Every bug found, 10 concrete UX proposals, feature visibility matrix |
| E2E feature inventory | `E2E_FEATURES.md` | Playwright test status per feature |
| Domain language | `CONTEXT.md` | Canonical terminology (Owner, Visitor, Style Kit, etc.) |
| Architecture decisions | `docs/adr/` | ADRs 0004-0009 |

## Bugs to Fix (priority order)

### Critical

1. **B1 — OG image 404 on subdomains.** `og:image` meta emits relative URL `/og/:siteId/:slug.png` but the OG route is only mounted on the app host, not subdomain hosts. Fix: either make the URL absolute (`https://rev01.aayushman.dev/og/...`) in `src/seo/og-resolve.ts`, or mount the OG route in `src/routes/public.ts` for subdomain hosts too.

2. **B2 — WebSocket reconnect storm.** Published site inline script at `src/routes/public.ts` (around the `__live` WebSocket block) retries forever with no backoff when `wss://<subdomain>.rev01.aayushman.dev/__live` fails DNS. 35+ errors per page load. Fix: add exponential backoff (start 1s, max 30s) and a retry cap (e.g. 5 attempts then stop), or conditionally skip the WebSocket entirely when the subdomain can't resolve (detect via first failure).

3. **B3 — Missing meta description.** `src/seo/meta-emit.ts` emits `<title>` and `og:title` but no `<meta name="description">` or `og:description`. The page-level `description` field exists in the schema but isn't being read in the meta emitter. Fix: read `page.description` (or fallback to first body text) and emit both meta tags.

### Moderate

4. **B4 — Clerk publishableKey in iframe previews.** Dashboard and Templates pages render site previews as iframes. Each iframe loads Clerk JS but receives an empty publishableKey. Fix: either strip the Clerk `<script>` from the preview render path, or pass the correct key.

5. **B5 — `__placeholder__` asset 404s.** Three site cards reference `/api/canvas/sites/:id/assets/__placeholder__`. Likely a seed-asset reference that was never replaced. Fix: check `src/canvas/seed-assets.ts` or the asset URL builder and handle the `__placeholder__` sentinel gracefully (return a default image or skip).

6. **B6 — `&quot;` not decoded in A11y report.** `src/routes/dashboard/a11y-report.tsx` renders audit messages with raw HTML entities. Fix: the message strings contain `&quot;` that need to be decoded before rendering, or the JSX is double-escaping.

7. **B7 — Site limit not enforced in UI.** Dashboard shows "+ New site" at 3/3 Free limit. Fix: check plan limits in `src/routes/dashboard/index.tsx` and disable/gate the button when at limit.

## UX Changes (priority order)

The full proposals with ASCII mockups are in `DEMO_TEST_REPORT.md` Part 3. Key ones for the next session:

### Must-do

1. **Site-level sidebar navigation.** Add a persistent left nav on all `/dashboard/sites/:id/*` pages linking to: Editor, Settings, Pages, Forms, Versions, Domains, Addons, A11y, Chat, Collaborators. This is the single highest-impact change — it surfaces 10+ hidden features. Affected files: `src/routes/dashboard/shell.tsx` (add sidebar component), every site sub-page template.

2. **Add missing element types to editor Add panel.** 7 of 14 element types are missing from the sidebar: Form, Embed, Code, Accordion, Carousel, Table, Nav. The element implementations exist in `src/canvas/elements/` — they just need buttons in the Add panel. Affected file: `src/editor/canvas-client.ts` (the IIFE that builds the sidebar).

3. **Surface AI Chat in the editor.** Add a chat button/icon to the editor header that opens a slide-out panel. The chat route (`src/agent/chat/route.ts`), orchestrator, and streaming are all built. Needs a UI trigger and panel in the editor.

### Should-do

4. **Expand dashboard kebab menu** to show action links (Edit, Settings, Forms, Versions, Domains, A11y, Addons, Chat) instead of just a status table.

5. **Surface AI Agent in editor** — add "Edit with AI" button that triggers the canvas-agent preview/apply flow.

6. **Disable "+ New site" at plan limit** with upgrade prompt.

7. **Add SEO editing UI** — per-page title/description fields accessible from the Pages tab.

## Codebase Orientation

| Area | Key files |
|---|---|
| Main app + route mounting | `src/index.ts` |
| Published site renderer | `src/routes/public.ts` |
| Dashboard pages (JSX) | `src/routes/dashboard/*.tsx` |
| Editor shell + client | `src/editor/canvas-index.tsx`, `src/editor/canvas-client.ts` |
| Canvas elements (14 types) | `src/canvas/elements/*.ts` |
| SEO meta emission | `src/seo/meta-emit.ts`, `src/seo/og-resolve.ts` |
| OG image rendering | `src/og-image/render.tsx`, `src/og-image/route.ts` |
| A11y audit + report | `src/a11y/`, `src/routes/dashboard/a11y-report.tsx` |
| AI agent + chat | `src/agent/`, `src/agent/chat/` |
| Addons registry | `src/addons/registry.ts` |
| Style kits | `src/canvas/style-kits.ts` |
| DB schema | `src/db/schema.ts` |
| Wrangler config | `wrangler.toml` |

## Constraints

- **No fallbacks.** Fail loudly or fix the root cause. See user's global CLAUDE.md.
- **No TODO comments.** Create issues or mention directly.
- **Conventional commits.** `feat:`, `fix:`, `refactor:`, etc.
- **Windows 11 + Git Bash.** Use forward slashes, `pathlib` for Python.
- **canvas-client.ts forbids backticks in IIFE body.** Stray `` ` `` closes the template literal; build breaks even when smokes pass. (Saved in memory: `feedback_canvas_client_ts_backticks.md`)

## Suggested Skills for Next Session

- `/tdd` — for red-green-refactor on the bug fixes (especially B1-B3 which have smoke tests)
- `/superpowers:writing-plans` — to plan the site-level sidebar navigation before implementing
- `/superpowers:dispatching-parallel-agents` — the 7 bugs and 7 UX tasks are mostly independent; dispatch parallel agents for each
- `/superpowers:verification-before-completion` — verify each fix against production before claiming done
- `/frontend-design:frontend-design` — for the sidebar nav and editor UI additions (polished, not generic)

## Test Commands

```bash
bun run typecheck          # TypeScript
bun run lint               # ESLint
bun run canvas:smoke       # Canvas renderer
bun run canvas-agent:smoke # AI agent
bun run og:smoke           # OG image
bun run seo:smoke          # SEO meta
bun run a11y:smoke         # Accessibility
bun run forms:smoke        # Forms
bun run build              # Dry-run Cloudflare deploy
bun run e2e                # Full Playwright suite
```
