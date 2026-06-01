# rev01 — Exhaustive Feature Reference

> **What it is:** A desktop canvas site builder where owners start from a template seed, edit positioned design primitives with AI help, switch deterministic style kits, and publish to a real public address that updates open visitor tabs immediately.
>
> **Stack:** Cloudflare Workers + Hono + Drizzle ORM + Neon Postgres + Yjs + Gemini + Playwright
>
> **Live:** https://rev01.aayushman.dev

---

## Table of Contents

1. [Canvas Editor](#1-canvas-editor)
2. [Design Primitives (14 Element Types)](#2-design-primitives-14-element-types)
3. [Style Kits](#3-style-kits)
4. [Template Seeds](#4-template-seeds)
5. [Publishing & Live Updates](#5-publishing--live-updates)
6. [Multi-Page Sites & Navigation](#6-multi-page-sites--navigation)
7. [Responsive Layout](#7-responsive-layout)
8. [AI Agent — Canvas Design](#8-ai-agent--canvas-design)
9. [AI Chat — Multi-Turn Conversations](#9-ai-chat--multi-turn-conversations)
10. [Real-Time Collaborative Editing](#10-real-time-collaborative-editing)
11. [Collaborator Invitations & Roles](#11-collaborator-invitations--roles)
12. [Owner Asset Pipeline](#12-owner-asset-pipeline)
13. [Custom Fonts](#13-custom-fonts)
14. [~~Symbols (Reusable Components)~~ — removed](#14-symbols-removed)
15. [Section Library & Cross-Template Import](#15-section-library--cross-template-import)
16. [Custom Templates](#16-custom-templates)
17. [Version History & Snapshots](#17-version-history--snapshots)
18. [Site Import (Web Scraper)](#18-site-import-web-scraper)
19. [Forms & Submissions](#19-forms--submissions)
20. [Password-Protected Publishing](#20-password-protected-publishing)
21. [Custom Domains](#21-custom-domains)
22. [SEO & Meta Tags](#22-seo--meta-tags)
23. [OG Image Generation](#23-og-image-generation)
24. [Sitemap & Robots.txt](#24-sitemap--robotstxt)
25. [Site Search (Full-Text)](#25-site-search-full-text)
26. [Accessibility Auditing](#26-accessibility-auditing)
27. [Light/Dark Mode Toggle](#27-lightdark-mode-toggle)
28. [Interactive Elements](#28-interactive-elements)
29. [Embed Support](#29-embed-support)
30. [Charts (SVG)](#30-charts-svg)
31. [Code Snippets (Syntax Highlighting)](#31-code-snippets-syntax-highlighting)
32. [Collections (Dynamic Content)](#32-collections-dynamic-content)
33. [Addon System](#33-addon-system)
34. [Localization (per-page locale + RTL)](#34-localization-per-page-locale--rtl)
35. [Authentication & Security](#35-authentication--security)
36. [Dashboard](#36-dashboard)
37. [Landing Page](#37-landing-page)
38. [Email System](#38-email-system)
39. [Slot History (Element Asset History)](#39-slot-history-element-asset-history)
40. [Motion Presets](#40-motion-presets)
41. [Database Schema (17 Tables)](#41-database-schema-17-tables)
42. [API Surface (95+ Endpoints)](#42-api-surface-95-endpoints)
43. [Infrastructure & DevOps](#43-infrastructure--devops)
44. [In-app Notifications](#44-in-app-notifications)

---

## Recent Ship Audit (May 27-28, 2026)

The current feature list has been re-evaluated against the commits from `ca9039b` through `80919c1`, plus the current workspace state where it affects shipped surface area.

| Area | What changed |
|---|---|
| Canvas/editor | Element style controls landed; new element inspectors shipped; inline mark toggle-off works without reselecting text; editor links now get clickable Open/Edit/Unlink treatment with a visitor-view preview; per-element drag handle was reverted, so it is not listed as a current feature |
| Design primitives | The canonical schema has 14 element types; the Apogee Showcase template exercises all 14 through 5 pages and 31 body sections |
| AI | Canvas agent and chat now expose a 15-operation mutating canvas tool surface, with read-only `query_site` and `query_assets` tools for chat context and preview/apply routing for mutations |
| Dashboard | Site cards and site-detail rows are clickable; settings was redesigned around Hosting, Password, Search Indexing, Visitor Dark Mode, and Collaborators; the public POC disables the import button rather than inviting a broken flow |
| Templates | Template preview scaling was hardened; the gallery now separates community/global templates from personal/private templates in the working tree |
| Publishing/public | Responsive CSS rendering is memoized per snapshot identity; live visitor payload validation is stricter; custom-domain on-site editing is supported; visitor count UI was removed from public pages |
| Security/hardening | Recent fixes cover editor/theme/version XSS, SMTP header injection, GA measurement ID validation, timing-safe comparisons, auth null-safety, custom-domain ownership checks, chart attribute escaping, CSS selector escaping, asset unlink logging, and louder reviewed failure paths |
| Testing/docs | E2E coverage was rewritten as user-flow tests with production targeting, and the E2E inventory was expanded through 71 feature areas |

## Recent Ship Audit (May 30 – June 1, 2026)

Re-evaluated against commits from `80919c1..HEAD` (~278 commits). Highest-impact additions:

| Area | What changed |
|---|---|
| **In-app notifications (NEW §44, ADR 0043 Accepted)** | Phases A-F shipped same day as ADR drafted: `notification` + `notification_read` Drizzle tables, 4 kinds (`form_submission`, `collaborator_event`, `publish_event`, `access_event`), per-kind email policy, `/api/notifications` + `/api/notifications/stream` (SSE), `NotificationOwnerRoom` Durable Object for live fan-out, dashboard top-bar bell + inbox dropdown, editor header bell, shared bell styles. No silent fallback on the live channel — persisted row is truth, EventSource reconnect → `?since=…` backfill closes any gap |
| Forms | Operator-renamable form `title` (inspector + inbox label + CSV aria-label + agent `patchProperties` key); AJAX submit replaces full-page reload (no Turnstile re-fetch on success); designed visitor form chrome (kit-aware focus ring, accent submit, success/error blocks, textarea grow, checkbox accent-color); no-JS path keeps the 303 fallback |
| Editor | Settings gear icon in editor header; A11y link surfaced (ADR 0039); Accessibility panel moved out of editor into site settings (ADR 0042 cascade); click-shield over the editable canvas; click anywhere on artboard activates the page; editable page title in the inspector; viewport-background click clears page deselect |
| Co-edit / collaborators | Collaborators (not only owners) can open the editor; Figma-style mouse-follow cursors with smooth interpolation; `customer.displayName` carried into the Yjs awareness label; presence-convergence window collapsed on editor join; quiet WS reconnect race fixed; collaborator-friendly settings 403 |
| Dashboard | Site grid lists collaborator sites alongside owned ones; collaborator cards visually separated from owner-action affordances |
| Landing | Clerk-js boot on landing stamps `[data-signed-in]` on `<html>` after session resolves; CSS swaps header + hero CTA + footer CTA between signed-in and signed-out chrome |
| Email | Hosted brand-mark PNG in every template; copyright footer line |
| Assets | SVG uploads blocked at write time; `X-Content-Type-Options: nosniff` set on asset reads; upload `customerId` scoped to the site owner when `siteId` is supplied (defends against editor-mode collaborators uploading on the owner's quota) |
| Custom domain | Cloudflare hostname is rolled back on any DB error during registration (no orphaned CF records) |
| Password gate | `/__live` WebSocket upgrade bypasses the password gate when a valid `wsToken` is presented (so the editor socket works on password-protected sites); the password gate now fails closed if the Durable Object rate limiter is unreachable (no silent dev-mode fallback in prod) |
| Schema | 2 new tables (`notification`, `notification_read`); migrations grew from 6 to 14 (most recent: `0013_notifications.sql`, `0012_visitor_theme_enum.sql`, `0011_library_section_description.sql`, `0010_drop_legacy_template_page.sql`) — note the legacy `page` and `template` tables are dropped; site pages now live in the `site` JSONB |
| Visitor theme (ADR 0035) | Visitor dark mode is a three-way enum (`light` / `dark` / `toggleable`), not a boolean |
| Dead-feature cleanup | §14 Symbols, §34 translate-via-Gemini, the legacy `page`/`template` tables and the per-page-drag-handle revert have all left the codebase |

---

## 1. Canvas Editor

The core editing experience. A desktop-first visual editor where the owner drags, resizes, and styles positioned design primitives on a canvas.

| Capability | Detail |
|---|---|
| Drag-and-drop positioning | Free-form element placement on a canvas grid |
| Element inspector panel | Right-side panel with type-specific property editors for each element |
| Editor header controls | Breadcrumbs, published-address chip, AI button, Chat button, **notification bell (live SSE)**, **Settings gear icon**, A11y link, Save, Publish, Save as template |
| Click-shield over canvas | Inert layer prevents accidental visitor-style interactions while editing; lifts on element drag and inspector focus |
| Click-anywhere activates page | Clicking the artboard background activates the current page (and clears element selection) so quick-add buttons target the right surface |
| Editable page title in inspector | Page title is editable inline from the right-side page inspector with the same noRebuild contract as element titles |
| AI Chat panel | Slide-out chat panel in editor — multi-turn SSE streaming with Gemini 2.5 Pro, op-preview with inline Accept buttons that apply canvas changes |
| AI Agent prompt | "AI" button opens prompt modal for natural-language canvas edits with preview/accept flow across text, media, element, section, page, style-kit, and site-config operations |
| Section management | Insert, remove, reorder, duplicate canvas sections via film-reel panel |
| Section roles | Header (pinned top), Footer (pinned bottom), Body (freely reorderable) |
| Rich text editing | Inline contenteditable with 7 mark types, floating toolbar, keyboard shortcuts |
| Link interaction popover | Inline links, action links, and nav links expose Open/Edit/Unlink affordances plus a visitor-view preview inside the editor |
| Element visual style controls | Inspector controls for background color/image, background sizing, border color/width/radius, opacity, shadow, text color, and overflow |
| Undo/redo | Full undo/redo stack via Yjs history |
| Sidebar tabs | Add (14 direct-add component buttons + style kits), Sections (searchable catalog), Pages (page list with SEO links) |
| Pan + zoom | Mouse wheel zoom (25%-200%), fit-to-viewport, select/pan mode toggle |
| Live preview | Real-time preview of editable state |
| Status line | Collaboration indicators, save status, presence |
| Clerk auth | Authenticated editor sessions with auto-refresh |
| On-site editing | Edit published sites directly via edit-token cookie popup flow |
| Styled modal system | Browser `alert`/`confirm`/`prompt` interactions replaced by branded JSX modals across editor/dashboard flows where wired |
| Client bundle | ~270KB browser client with Yjs CRDT, canvas manipulation, live refresh |

### Rich Text Editing System

Full inline editing on text elements via contenteditable + Selection API. No library dependency.

| Capability | Detail |
|---|---|
| 7 inline mark types | **bold**, *italic*, underline, ~~strike~~, `code`, highlight, [link] |
| Floating mark toolbar | Appears on text selection — toggle any mark with one click |
| Keyboard shortcuts | Ctrl+B bold, Ctrl+I italic, Ctrl+U underline, Ctrl+K insert link |
| Link editing | Inline link modal with URL validation (http, https, mailto, tel, internal paths, anchors) |
| Link popover | Hover or select a link to open it, edit it, unlink it, or inspect the exact visitor-facing style |
| Mark toggle-off | Re-clicking a mark button removes the mark from the active selection without requiring a fresh selection |
| Semantic roles | Heading (h1-h6), body, label — each with distinct font size/weight defaults from style kit |
| DOM parser | Reads back styled HTML (strong, em, a, mark, code, s, u) into InlineRun[] schema on blur |
| Paste handling | Preserves bold/italic/link marks from pasted HTML; strips unsupported formatting |
| Adjacent run merging | Adjacent runs with identical marks are auto-merged for clean schema output |

### Element Inspector Panels

Each element type has a dedicated inspector panel when selected:

| Element | Inspector capabilities |
|---|---|
| Text | AI rewrite button, semantic role, font size, font weight, text alignment |
| Action | 7 button variants, label, link type (external URL / internal page), destination picker |
| Shape | 6 shape variants (rect, pill, circle, line, badge, blob) |
| Container | 7 surface variants (flat, raised, glass, outlined, sticker, editorial-frame, soft-panel) |
| Media | Upload/history/gallery picker, alt text, fit mode (cover/contain/fill), video playback controls (autoplay, muted, loop, controls) |
| Chart | Chart kind picker (bar/line/area/pie/donut), axis titles, legend toggle, interactive data grid (series x categories) |
| Form | Field list editor, field kind picker, required/placeholder/options controls, submit label, success message |
| Embed | URL, title, aspect ratio, provider-derived render preview |
| Code | Language picker, source editor, line-number toggle |
| Table | Column editor, row/cell editor, column alignment, zebra rows, phone collapse |
| Accordion | Item title/body editor, add/remove items, multi-open toggle |
| Carousel | Slide asset/caption editor, arrow toggle, dot toggle |
| Nav | Layout picker, sticky toggle, logo asset, internal/external/anchor link editing |
| Collection | Manual/page-bound mode, filters, sorting, grid settings, entry template mapping |
| All elements | Motion preset selector (16 presets), motion delay, z-order controls, reading-order reorder, shared element-style controls |

**Key files:** [canvas-index.tsx](src/editor/canvas-index.tsx), [canvas-client.ts](src/editor/canvas-client.ts), [canvas-styles.ts](src/editor/canvas-styles.ts)

---

## 2. Design Primitives (14 Element Types)

Every visual primitive available on the canvas. Each is server-rendered to pure HTML — no client framework in published output.

| # | Element | Description | Key Features |
|---|---------|-------------|--------------|
| 1 | **Text** | Rich text with inline marks | Bold, italic, link marks; heading/body/label semantic roles |
| 2 | **Media** | Images and videos | Lazy loading, responsive sizing, alt text, aspect ratio control |
| 3 | **Action** | CTA buttons and links | 7 variants: solid, outline, ghost, pill, glass, brutalist, underline; internal/external links |
| 4 | **Shape** | Geometric shapes | Circle, rectangle, pill; fill, stroke, stroke-width from kit tokens |
| 5 | **Container** | Layout panels | Surface variants: flat, raised, glass, outlined, sticker, editorial-frame, soft-panel |
| 6 | **Form** | Data collection | Text, email, textarea, checkbox, select fields; operator-renamable `title`; Turnstile bot protection; AJAX submit with no-JS 303 fallback; webhook delivery |
| 7 | **Embed** | Third-party content | YouTube, Vimeo, Loom, Figma, Spotify, SoundCloud, CodePen, Twitter/X, Google Maps, generic iframe |
| 8 | **Code** | Syntax-highlighted snippets | 11 languages (TS, JS, Python, Rust, Go, JSON, Bash, SQL, HTML, CSS, Markdown); optional line numbers |
| 9 | **Chart** | Data visualization | Bar, line, pie, donut, area; server-rendered SVG; kit-derived colors; multi-series |
| 10 | **Table** | Data tables | Column alignment, zebra striping, responsive card collapse on phone, scoped inline CSS |
| 11 | **Accordion** | Collapsible sections | Rich text body, multi-open support, keyboard accessible (Enter/Space) |
| 12 | **Carousel** | Image slider | Prev/next navigation, dot pagination, lazy-loaded slides, captions with links |
| 13 | **Nav** | Navigation bar | Two layouts (left-center-right, left-right); logo, links, CTA slot; sticky positioning |
| 14 | **Collection** | Dynamic content repeats | Manual entries or page-bound auto-generation; filtering, sorting, grid layout, field binding |

**Key files:** [elements/](src/canvas/elements/), [render.ts](src/canvas/render.ts)

---

## 3. Style Kits

Deterministic visual systems that restyle the entire site without changing content. One source of truth for editor and published output — drift is impossible by construction.

| Kit | Personality | Accent | Typography |
|---|---|---|---|
| **Charcoal** | Modern, technical, dark | `#d9dde4` silver | Inter + JetBrains Mono |
| **Orange Editorial** | Bold, print-inspired, warm | `#d6541b` burnt orange | Playfair Display + Inter |
| **Blue SaaS** | Corporate, polished, deep blue | `#5b8def` electric blue | Inter Tight + JetBrains Mono |
| **Green Organic** | Natural, warm, approachable | `#4a9d5b` leaf green | Lora + Inter |
| **Custom** | Owner-defined custom theme | Per-site | Per-site |

Each kit defines: background, panel, text, muted, accent, accentText colors; display/body/mono font families; heading/body/label scale; line height; radius; border width; shadow; 7 surface variants; shape tokens; 7 action button variants; motion duration + easing + 16 motion presets.

**Key files:** [style-kits.ts](src/canvas/style-kits.ts), [public-styles.ts](src/canvas/public-styles.ts)

---

## 4. Template Seeds

Starting site shapes that owners clone into new editable sites.

| # | Template | Style Kit | Target Use Case |
|---|----------|-----------|-----------------|
| 1 | **Starter Canvas** | Charcoal | General-purpose flexible canvas |
| 2 | **Launch Page** | Blue SaaS | Product launch with hero + proof + CTA |
| 3 | **Enterprise Scale** | Charcoal | Proof-heavy enterprise landing with outcome cards, team, sales CTAs |
| 4 | **Studio Portfolio** | Orange Editorial | Visual-first portfolio for designers, photographers, makers |
| 5 | **Local Business** | Green Organic | Cafes, salons, services — hours, location, booking |
| 6 | **Apogee Showcase** | Custom (dark + blue accent) | Multi-page all-elements showcase: 5 pages, 31 body sections, and every canonical element type |

Each template provides: pre-populated sections, copy, media references, and style kit selection. Custom templates can be saved by owners (private) or admins (global), then browsed as Personal or Community entries in the template gallery.

**Key files:** [registry.ts](src/templates/registry.ts), [templates/seeds/](src/templates/seeds/)

---

## 5. Publishing & Live Updates

| Capability | Detail |
|---|---|
| One-click publish | Promotes editable state to a versioned published snapshot |
| Version numbering | Incremental `published_version` on each publish |
| State isolation | Editable and published states are fully separate |
| Live visitor updates | On publish, rendered HTML is broadcast to all connected visitor tabs via Durable Object WebSocket fan-out |
| Unpublish | Remove the published snapshot (site goes offline) |
| Pre-publish a11y audit | Accessibility checks run before publish; blocking issues prevent publish |
| OG image pre-render | OG images are generated and cached at publish time |
| Search index rebuild | Full-text search index is rebuilt on every publish |
| Scroll entrance animations | Published sites use IntersectionObserver to animate elements with motion presets on scroll-into-view; CSS transitions with kit-derived duration/easing |
| Responsive CSS memoization | `renderResponsiveCss` is memoized per snapshot identity during publish/render hot paths |
| Site favicon | Published meta emission can include a site-level favicon asset through `faviconAssetId` |

**Key files:** [publish.ts](src/routes/api/publish.ts), [site-room.ts](src/live/site-room.ts), [public.ts](src/routes/public.ts)

---

## 6. Multi-Page Sites & Navigation

| Capability | Detail |
|---|---|
| Multiple pages | Create pages with slug-based URL routing (`/about`, `/blog`, `/contact`) |
| Page ordering | Position field controls nav display order |
| Page metadata | Title, description, OG image, published date, author, tags, category per page |
| Nav element | Dedicated Nav design primitive rendered as site-wide navigation bar |
| Nav editor | Dashboard UI for managing navigation links and structure |
| Per-page Nav suppression | Pages can opt out of the site-wide nav individually |
| Page settings | Per-page SEO, metadata, and visibility controls |
| Slug validation | Lowercase, unique per site, reserved words blocked |
| Default page | First page serves as site root (`/`) |

**Key files:** [page-routing.ts](src/canvas/page-routing.ts), [nav.ts](src/canvas/elements/nav.ts), [nav-editor.tsx](src/routes/dashboard/nav-editor.tsx)

---

## 7. Responsive Layout

| Capability | Detail |
|---|---|
| Breakpoint cascade | Phone / tablet / desktop breakpoints |
| Per-element overrides | Position, size per breakpoint |
| CSS-based responsiveness | Inline responsive CSS per page — no JS layout |
| Table responsive collapse | Tables switch to card layout on phone with data-label attributes |
| Safe CSS escaping | All user-controlled CSS values are sanitized |

**Key files:** [responsive/css.ts](src/canvas/responsive/css.ts), [layout/engine.ts](src/canvas/layout/engine.ts)

---

## 8. AI Agent — Canvas Design

| Capability | Detail |
|---|---|
| Preview flow | Owner describes a change in natural language; agent generates a preview |
| Apply flow | Owner approves preview; agent applies the change to editable state |
| 15 mutating tools | `rewriteText`, `replaceMedia`, `designSection`, `deleteElement`, `updateElement`, `addElement`, `updateSection`, `deleteSection`, `moveSection`, `duplicateSection`, `addPage`, `updatePage`, `deletePage`, `setStyleKit`, `setSiteConfig` |
| Operation vocabulary | Apply layer also understands `insertSection` recipe ops for constrained recipe-based section creation |
| LLM backend | Google Gemini 2.5 Pro via `@google/genai` SDK |
| Section recipes | Constrained section shapes the agent can use for new sections |
| Design section parser | Converts agent output to valid canvas section structures |
| Tool parsers | Tight parsers validate model tool args, inline marks, media kind, element type, style-kit tokens, page metadata, section motion/background fields, and site config before apply |
| Streaming responses | SSE-based streaming for real-time agent output |

**Key files:** [agent/](src/agent/), [llm-gemini.ts](src/agent/llm-gemini.ts), [canvas-tools.ts](src/agent/canvas-tools.ts)

---

## 9. AI Chat — Multi-Turn Conversations

| Capability | Detail |
|---|---|
| Multi-turn sessions | Persistent chat sessions with full message history |
| Session persistence | Chat sessions saved to database with role/content/toolCalls per turn |
| Streaming SSE | Server-sent events for real-time chat responses |
| Canvas-aware tools | Chat agent can invoke the full mutating canvas operation set through preview cards |
| Read-only inspection tools | `query_site` returns token-capped site structure; `query_assets` returns uploaded asset metadata for concrete media references |
| Op-preview acceptance | Mutating tool calls stream as preview cards and apply only after the owner clicks Accept |
| Session resume | Resume interrupted sessions via session ID |
| Dashboard/editor panels | Dedicated dashboard chat route plus editor slide-out chat panel |

**Key files:** [agent/chat/](src/agent/chat/), [chat-panel.tsx](src/routes/dashboard/chat-panel.tsx)

---

## 10. Real-Time Collaborative Editing

| Capability | Detail |
|---|---|
| Yjs CRDT | Conflict-free replicated data type for concurrent edits |
| WebSocket transport | Real-time sync via Cloudflare Durable Object (`SiteRoom`) |
| Awareness protocol | Cursor positions, user presence indicators, `customer.displayName` as the awareness label (falls back to email handle) |
| Figma-style mouse-follow cursors | Each remote participant's cursor renders as a smoothly-interpolated tinted pointer with name flag inside the editor canvas |
| Collaborator editor access | Accepted collaborators (not just the owner) can open the editor; editor revoke-on-access-changed modal handles in-session removal |
| Presence pre-seed | Initial awareness state is pre-seeded on editor join to collapse the convergence window for incoming participants |
| Quiet WS reconnect | Reconnect race on ephemeral disconnects no longer surfaces a transient "disconnected" banner |
| Autosave | Automatic saving during collaborative sessions |
| Broadcast fan-out | Edits broadcast to all connected editors and visitors |
| Edit-token socket auth | On-site editor sockets can authenticate with edit tokens, including custom-domain editing sessions; `/__live` WebSocket upgrade bypasses the password gate when a valid `wsToken` is presented |
| Element style projection | Yjs projection preserves `elementStyle` so visual overrides survive collaborative round-trips |
| `editable-state-replaced` broadcast | Canvas agent broadcasts a replacement event after every Apply so co-editors converge on the new editable state without waiting for an autosave round-trip |
| Per-site rooms | One Durable Object instance per published site |

**Key files:** [live/site-room.ts](src/live/site-room.ts), [live/co-edit/](src/live/co-edit/)

---

## 11. Collaborator Invitations & Roles

| Capability | Detail |
|---|---|
| Email invitations | Send collaborator invites via Resend email |
| Roles | `editor` (full edit access) and `viewer` (read-only) |
| Invite tokens | HMAC-SHA256 signed JWTs with 7-day TTL |
| Invite acceptance | Click link in email to accept and join site |
| Access control | Site ownership + collaborator role checked at every API endpoint |
| Self-invite prevention | Cannot invite yourself |
| Account requirement | Invited email must have an existing account |
| Collaborator removal | Owner can remove collaborators at any time |
| Collaborator-friendly settings 403 | Settings page returns a scoped 403 (not a generic crash) when a collaborator hits owner-only controls |
| Notification side-effects | Invite/join/leave + role-change/revoke emit notifications (ADR 0043, see §44) — affected collaborator and their teammates land in different recipient buckets |

**Key files:** [collaborators.ts](src/routes/api/collaborators.ts), [invite-token.ts](src/auth/invite-token.ts)

---

## 12. Owner Asset Pipeline

| Capability | Detail |
|---|---|
| Content-addressed storage | Assets stored in Cloudflare R2, keyed by SHA256 content hash |
| Owner-rooted | Assets belong to the owner, reusable across all their sites |
| Deduplication | Same bytes uploaded twice share the same R2 object |
| Image dimension probing | Width/height detected via magic bytes (PNG, JPEG, GIF, WebP) |
| Video support | Video assets stored with separate `video` kind |
| Alt text | Per-asset accessibility alt text |
| AI image generation | Generate images via Replicate Flux Schnell from text prompts |
| Aspect ratio presets | 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9 for AI generation |
| Public asset serving | Content-hash URLs for cache-friendly public delivery |
| MIME allowlist | SVG uploads are blocked at write time; only raster image kinds + video MIMEs reach R2 |
| `X-Content-Type-Options: nosniff` | Set on every public asset read to defeat MIME sniffing |
| Editor-mode upload scoping | When a `siteId` is supplied on upload, the asset's `customerId` is forced to the site owner — collaborators cannot push assets onto their own quota under an owner's site |

**Key files:** [assets/](src/assets/), [r2-client.ts](src/assets/r2-client.ts)

---

## 13. Custom Fonts

| Capability | Detail |
|---|---|
| WOFF2 upload | Upload custom font files per site |
| Font metadata | Name, family, weight (400, 600, 700), style (normal, italic) |
| Content-hash storage | Fonts stored in R2 with deduplication |
| @font-face generation | Automatic CSS @font-face rules in published output |
| Public font serving | Content-hash URLs at `/fonts/:contentHash` |
| Site-scoped | Fonts are per-site, not per-owner |

**Key files:** [fonts/route.ts](src/fonts/route.ts)

---

## 14. ~~Symbols~~ — removed

Symbol Masters and Symbol Instances were nuked from the codebase. The `symbol-instance` element type, the `symbols/route.ts` API surface, the `SymbolMaster` schema, and the "Nav as symbol" propagation pattern no longer exist.

Reuse paths that survive:

- **Section Library** ([§15](#15-section-library--cross-template-import)) — save any section as a reusable library entry, import it into other pages.
- **Custom Templates** ([§16](#16-custom-templates)) — save an entire site as a reusable template.
- **Nav element** ([§6](#6-multi-page-sites--navigation)) — the Nav primitive is still a first-class element and is authored once per site, but it is *not* a symbol; per-page Nav suppression replaces the old "drop a SymbolInstance everywhere" model.

This section is preserved at §14 so existing external references to "FEATURES.md §14" do not break.

---

## 15. Section Library & Cross-Template Import

| Capability | Detail |
|---|---|
| Save to library | Save any canvas section as a reusable library entry |
| Visibility scopes | `private` (owner-only) or `global` (admin-curated, all owners) |
| Asset manifests | Snapshot of referenced assets preserved at save time |
| Import into page | Import library sections into any site page |
| Section catalog | Browse template sections for insertion |
| Recipe-tagged | Sections tagged with recipe IDs for categorization |

**Key files:** [library-sections.ts](src/routes/api/library-sections.ts), [sections.ts](src/routes/api/sections.ts)

---

## 16. Custom Templates

| Capability | Detail |
|---|---|
| Save site as template | Owners save their entire site as a reusable template |
| Private templates | Owner-only visibility |
| Global templates | Admin-published, visible to all owners |
| Community / Personal gallery | Built-in and global templates appear under Community; private owner templates appear under Personal |
| Template preview | Render template as HTML for preview |
| Preview scaling | Template iframe previews use the same scale strategy as dashboard thumbnails |
| Template assets | Asset manifest preserved with template |
| Style kit preservation | Template retains its style kit selection |

**Key files:** [custom-templates.ts](src/routes/api/custom-templates.ts)

---

## 17. Version History & Snapshots

| Capability | Detail |
|---|---|
| Manual snapshots | Capture labeled snapshots at any time |
| Auto-snapshots | Automatic snapshot on every publish with version number |
| Timeline view | Dashboard UI showing chronological snapshot history |
| Preview | Render any historical snapshot as HTML in a sandboxed iframe |
| Restore | Rollback to any previous snapshot |
| Pre-restore safety | Automatic safety snapshot captured before every restore |
| Yjs binary storage | Efficient binary encoding via `Y.encodeStateAsUpdate` |
| Version pruning | Automatic cleanup of old snapshots |
| Reasons | Each snapshot tagged as `publish` or `manual` |

**Key files:** [version/](src/version/), [version-timeline.tsx](src/routes/dashboard/version-timeline.tsx)

---

## 18. Site Import (Web Scraper)

| Capability | Detail |
|---|---|
| URL-based import | Paste a URL, scraper extracts design structure |
| External scraper service | Playwright-based scraper running as separate service |
| HTML to canvas conversion | Scraped HTML elements converted to canvas elements |
| Asset import | Images, videos, and fonts extracted and uploaded |
| Color extraction | Automatic color palette extraction from source |
| Font detection | Detect and import fonts from source URL |
| Bearer auth | Scraper authenticated via `SCRAPER_API_SECRET` |
| Public POC gate | Dashboard import button is disabled in the hosted public POC while the local scraper/API path remains documented |

**Key files:** [import.ts](src/routes/api/import.ts), [services/scraper/](services/scraper/)

---

## 19. Forms & Submissions

| Capability | Detail |
|---|---|
| Field types | Text, email, textarea, checkbox, select (dropdown) |
| Operator-renamable form `title` | Optional title shown at the top of the form inspector, in the dashboard inbox row label, in the CSV export aria-label, and as a valid `patchProperties` key on the canvas agent's `updateElement` tool. Visitor-facing renderer ignores it. Falls back to the form element id when unset |
| Turnstile bot protection | Cloudflare Turnstile invisible challenge on every submission |
| Rate limiting | Per-IP (10/min) and per-form (100/hour) via Durable Objects |
| IP hashing | SHA-256 truncated to 32 chars — raw IP never stored |
| Webhook delivery | HMAC-SHA256 signed POST to owner-configured URL; `X-Rev01-Signature` header |
| Submissions inbox | Dashboard panel with paginated submission list |
| CSV export | Export all submissions as CSV |
| Required field validation | Server-side required check, email format validation, select option validation |
| Custom success message | Configurable message shown after successful submission |
| Owner email notification | Resend email sent to site owner on every submission — form ID, timestamp, inbox link (fire-and-forget, non-blocking) |
| In-app notification | Every submission also writes a `form_submission` notification row (recipient = the site, fanned out to every collaborator via `notification_read`); see [§44](#44-in-app-notifications) |
| AJAX visitor submit | Inline `preventDefault → fetch POST → toggle `.rev01-form-success` / populate `.rev01-form-error`` handler shared across all forms on a page via `window.__rev01FormHandlerWired`. Disabled submit + `data-busy` during the round trip; `window.turnstile.reset()` after success |
| No-JS fallback | When JS is blocked the native POST + `303 → /{slug}?form-ok={formId}` path still works; the success block ships with `hidden` so the no-JS path's server-side query handler is the only way to unhide it |
| Designed visitor form chrome | `.rev01-form` (14px grid gap), `.rev01-form-input` (kit-accent focus ring via `color-mix oklab`), `.rev01-form-submit` (accent background, hover brighten, disabled/`data-busy` fade), `.rev01-form-success` / `.rev01-form-error` with color-mix backgrounds so the chrome stays kit-aware across every built-in kit. Textarea grows; checkbox uses `accent-color: var(--rev01-accent)` |

**Key files:** [forms/](src/forms/), [form.ts](src/canvas/elements/form.ts), [forms-inbox.tsx](src/routes/dashboard/forms-inbox.tsx)

---

## 20. Password-Protected Publishing

| Capability | Detail |
|---|---|
| Per-site password gate | Enable/disable password protection per site |
| PBKDF2-SHA256 hashing | 100,000 iterations, 32-byte random salt |
| Unlock cookie | HS256-signed JWT with 7-day TTL, per-site cookie name |
| Password rotation | `hashEpoch` marker invalidates old unlock cookies |
| Rate limiting | 5 failed attempts per 60 seconds per IP |
| Minimal gate page | Plain HTML form with no JS — lowest attack surface |
| Redirect sanitization | Validates redirect path starts with `/`, rejects protocol-relative URLs |
| Timing-safe verification | All password comparisons use constant-time algorithms |
| Editor `/__live` bypass | The WebSocket upgrade endpoint bypasses the password gate when a valid editor `wsToken` is presented — collaborators on password-protected sites can still co-edit without entering the visitor password |
| Fail-closed without durable limiter | If the Durable Object rate limiter binding is unreachable in production, unlock requests fail closed rather than falling back to an in-process limiter (no silent dev fallback) |

**Key files:** [password/](src/password/)

---

## 21. Custom Domains

| Capability | Detail |
|---|---|
| Register custom hostname | Map owner's domain to their published site |
| Cloudflare for SaaS | Uses Cloudflare Custom Hostnames API |
| Domain verification | CNAME or HTTP DCV (Domain Control Validation) |
| Status tracking | `pending` → `verifying` → `active` (or `failed`) |
| Auto-polling | 5-minute cron job syncs domain status from Cloudflare API |
| SSL certificates | Automatic certificate issuance and tracking |
| Stuck-row detection | 30-minute timeout flips stuck `verifying` domains to `failed` |
| Dashboard UI | Domain management panel with status indicators |
| On-site editing | Published custom-domain sites can enter editor mode with origin-bound edit tokens |
| Ownership check | Domain ownership checks are combined into a single database query |
| Atomic registration rollback | If any DB write during hostname registration fails, the Cloudflare hostname is deleted via the CF API so no orphan CF records remain |

**Key files:** [custom-domain/](src/custom-domain/), [domains.tsx](src/routes/dashboard/domains.tsx)

---

## 22. SEO & Meta Tags

| Capability | Detail |
|---|---|
| Title & description | `<title>` and `<meta name="description">` per page |
| Open Graph | og:title, og:description, og:image, og:url, og:type |
| Twitter Cards | twitter:card, twitter:title, twitter:description, twitter:image |
| Canonical URL | Automatic canonical link resolution |
| noindex control | Per-page and site-wide noindex support |
| Language/locale | HTML `lang` attribute from snapshot config |
| JSON-LD | Structured data markup generation |
| Site favicon | Site-level favicon asset emitted as `<link rel="icon">` when configured |
| Page-level SEO editor | Dashboard UI for editing SEO fields per page |

**Key files:** [seo/meta-emit.ts](src/seo/meta-emit.ts), [seo/og-resolve.ts](src/seo/og-resolve.ts)

---

## 23. OG Image Generation

| Capability | Detail |
|---|---|
| Dynamic card rendering | 1200x630 OG cards via Satori (JSX to SVG) |
| Two modes | Simple text card (site name + title + description) or section-based card (renders hero section) |
| PNG rasterization | SVG to PNG via @resvg/resvg-wasm (WebAssembly) |
| Pre-render on publish | OG images generated and cached at publish time |
| Font bundling | Inter Regular + Bold bundled locally for rendering |
| Cache | Content-hash caching in R2 |
| Accent branding | Kit accent color used as stripe/border |

**Key files:** [og-image/](src/og-image/)

---

## 24. Sitemap & Robots.txt

| Capability | Detail |
|---|---|
| XML sitemap | Auto-generated `/sitemap.xml` for published sites |
| Multi-page support | All published pages included with lastmod |
| robots.txt | Configurable `/robots.txt` with sitemap reference |
| noindex respect | Pages marked noindex are excluded from sitemap |

**Key files:** [seo/sitemap/](src/seo/sitemap/)

---

## 25. Site Search (Full-Text)

| Capability | Detail |
|---|---|
| PostgreSQL FTS | `tsvector` + GIN index for full-text search |
| Auto-indexing | Search index rebuilt on every publish |
| Multi-page search | Search across all pages of a site |
| Snippet extraction | Return matching text snippets |
| Public endpoint | `GET /__rev01/search?q=<query>` — no auth required |
| Password-gate aware | Respects password protection |

**Key files:** [search/](src/search/)

---

## 26. Accessibility Auditing

| Capability | Detail |
|---|---|
| Pre-publish audit | Automated a11y checks before publish |
| 6 check categories | Alt text, action labels, color contrast, form field labels, heading order, page meta |
| Severity levels | Blocking (prevents publish), warning, info |
| Element-level issues | Issues linked to specific canvas elements with remediation hints |
| Dashboard report | Visual audit results in dashboard with severity badges |
| ARIA attributes | All canvas elements emit appropriate ARIA attributes in published output |

**Key files:** [a11y/](src/a11y/), [a11y-report.tsx](src/routes/dashboard/a11y-report.tsx)

---

## 27. Light/Dark Mode

Per [ADR 0035](docs/adr/0035-visitor-dark-mode-three-way-enum.md), visitor dark mode is a three-way enum, not a boolean.

| Capability | Detail |
|---|---|
| Three-way `visitorTheme` enum | `light` (always light), `dark` (always dark), `toggleable` (visitor toggle button + `prefers-color-scheme` honour) |
| Per-site setting | Configured under Site Settings → Visitor Dark Mode |
| Auto dark variants | Dark color variants generated from kit tokens (pre-computed per built-in kit, not just inverted) |
| Anti-flash inline script | Resolves the initial theme from localStorage → `prefers-color-scheme` before first paint to prevent flash |
| CSS variable switching | Theme switch via CSS custom properties — published output is otherwise unchanged |

**Key files:** [themes/visitor-mode/](src/themes/visitor-mode/), [drizzle/0012_visitor_theme_enum.sql](drizzle/0012_visitor_theme_enum.sql)

---

## 28. Interactive Elements

| Capability | Detail |
|---|---|
| Accordion | Expand/collapse with keyboard support, multi-open |
| Carousel | Slide navigation with dots, prev/next buttons |
| Popup/Modal | Trigger-based popup modals |
| Smart injection | Interactive runtime only injected when accordion/carousel elements are present |
| Zero-byte when unused | No client-side JS when no interactive elements exist |
| CSS-driven animations | No framework dependency — pure CSS transitions |

**Key files:** [interactive/](src/interactive/)

---

## 29. Embed Support

9 named providers with deterministic regex-based URL resolution (no external API calls):

| Provider | URL Patterns |
|---|---|
| YouTube | youtube.com, youtu.be, shorts |
| Vimeo | vimeo.com |
| Loom | loom.com |
| Figma | figma.com |
| Spotify | open.spotify.com |
| SoundCloud | soundcloud.com |
| CodePen | codepen.io |
| Twitter/X | twitter.com, x.com |
| Google Maps | google.com/maps, maps.google.com, goo.gl/maps |

Plus generic iframe fallback for any URL. All embeds are sandboxed with CSP, lazy-loaded, and aspect-ratio controlled (default 16:9).

**Key files:** [embed/](src/embed/), [embed.ts](src/canvas/elements/embed.ts)

---

## 30. Charts (SVG)

| Chart Type | Description |
|---|---|
| **Bar** | Vertical bar chart with axis labels |
| **Line** | Multi-series line chart with grid |
| **Area** | Filled area chart |
| **Pie** | Standard pie chart with legend |
| **Donut** | Pie chart with center cutout |

All charts are server-rendered SVG (no client JavaScript). Colors derived from kit accent. Supports legends, axis labels, and multiple data series.

**Key files:** [charts/](src/charts/)

---

## 31. Code Snippets (Syntax Highlighting)

11 supported languages via Shiki:

`TypeScript` | `JavaScript` | `Python` | `Rust` | `Go` | `JSON` | `Bash` | `SQL` | `HTML` | `CSS` | `Markdown`

Features: optional line numbers, kit-themed mono typeface, panel background from style kit, plain-text fallback for unsupported languages.

**Key files:** [code/](src/code/)

---

## 32. Collections (Dynamic Content)

| Mode | Description |
|---|---|
| **Manual** | Owner-managed entries (testimonials, team lists, FAQs) |
| **Page-bound** | Auto-generated from pages matching filter criteria |

Features: filtering by category/tags/date range, sorting by date or title, grid layout with configurable columns and gaps, entry templates, field binding system for content mapping.

**Key files:** [collection.ts](src/canvas/elements/collection.ts)

---

## 33. Addon System

Extensible per-site capability system (ADR 0009).

| Addon | Slug | Description |
|---|---|---|
| **Google Analytics** | `google-analytics` | GA4 gtag.js injection with measurement ID validation (`G-XXXXXXXXXX`) |
| **Custom Scripts** | `custom-scripts` | Arbitrary `<script>` injection for Intercom, Hotjar, Meta Pixel, etc. |

Architecture: account-level entitlements + per-site configuration. Head and body script injection points. Config fields with pattern validation.

**Key files:** [addons/registry.ts](src/addons/registry.ts), [addon-shop.tsx](src/routes/dashboard/addon-shop.tsx), [site-addons.tsx](src/routes/dashboard/site-addons.tsx)

---

## 34. Localization (per-page locale + RTL)

The original auto-translate-via-Gemini scope is dead and the button has been removed; what survives is per-page locale + RTL layout direction.

| Capability | Detail |
|---|---|
| Per-page locale picker | Site- and page-level `locale` field surfaced in the page-SEO inspector; emitted as `<html lang>` and used for the published-address routing prefix when set |
| BCP-47 locale chain | Locale resolution walks the full BCP-47 fallback chain |
| RTL language detection | Arabic, Farsi, Hebrew, Urdu (and region variants) flip layout direction to RTL via `<html dir="rtl">` |
| RTL coordinate mirroring | Positioned elements have x-coordinates mirrored at render time for RTL layouts |
| Localized URL routing | `/<locale>/<slug>` URL structure when a per-page locale is set |

**Key files:** [i18n/](src/i18n/), [i18n/mirror.ts](src/i18n/mirror.ts)

---

## 35. Authentication & Security

### Auth Mechanisms

| Mechanism | Purpose | TTL |
|---|---|---|
| Clerk JWT | Primary owner authentication | Session-based |
| Edit token (HMAC-SHA256) | On-site editor cross-subdomain/custom-domain auth, bound to site origin | 4 hours |
| Invite token (HMAC-SHA256) | Email collaboration invitations | 7 days |
| Unlock cookie (HS256) | Visitor password gate | 7 days |

### Security Features

| Feature | Detail |
|---|---|
| PBKDF2-SHA256 | 100,000 iterations for password hashing |
| Timing-safe comparisons | XOR accumulation for all signature/password verification |
| CSP headers | Dynamic Content-Security-Policy with embed-aware `frame-src` |
| XSS prevention | `escapeHtml()`, `escapeAttr()`, `escapeCssValue()`, `sanitiseCssKey()` on all user content |
| CSRF protection | SameSite=Lax cookies, httpOnly, Secure flags |
| Rate limiting | Per-IP limits on password unlock (5/min) and form submission (10/min) |
| IP hashing | SHA-256 truncated — raw IPs never stored |
| Redirect sanitization | Validates paths start with `/`, rejects `//` and control chars |
| SQL injection prevention | Drizzle ORM parameterized queries throughout |
| Webhook signatures | HMAC-SHA256 via `X-Rev01-Signature` header |
| Domain verification | Cloudflare CNAME/HTTP DCV |
| SMTP header injection guard | Form notification emails strip unsafe header material from owner-controlled values |
| Addon config validation | GA4 measurement IDs are validated server-side before script emission |
| Admin null-safety | Admin guards handle missing auth context explicitly instead of crashing ambiguously |
| SVG upload block | Asset upload rejects SVG MIMEs before R2 write; defeats SVG-script payloads in user uploads |
| `nosniff` on asset reads | `X-Content-Type-Options: nosniff` set on every public asset response so browsers can't reinterpret bytes |
| Editor-mode upload scoping | When `siteId` is supplied, uploads bill the site owner's quota — collaborators cannot stage assets under their own account on a shared site |
| Custom-domain atomic register | Any DB failure during hostname registration triggers a Cloudflare hostname delete; no orphan CF records |
| Password-gate fail-closed | Production unlock fails closed when the durable rate-limiter binding is unreachable (no in-process fallback) |
| `/__live` wsToken bypass | The WebSocket upgrade is allowed past the password gate when a valid editor `wsToken` is presented (so co-edit works on password-protected sites) |

---

## 36. Dashboard

Server-rendered Hono JSX dashboard with 14 panels, clickable site-card detail surfaces, a persistent site-level sidebar, and a top-bar notification bell (live SSE).

### Top-bar chrome

Every dashboard page renders the **notification bell** with unread badge in the global top-bar. Clicking opens the inbox dropdown ([§44](#44-in-app-notifications)).

### Site-Level Sidebar Navigation

Every `/dashboard/sites/:id/*` page renders a 220px left sidebar with 9 links: Editor, Settings, Navigation, Forms, Versions, Domains, Addons, Accessibility, Chat. The current page is highlighted. A "Back to all sites" link returns to the site grid. The sidebar is absent on global pages (site grid, templates, shop, profile, settings).

### Dashboard Panels

| Panel | Route | Purpose |
|---|---|---|
| Site grid | `/dashboard` | Owned sites + accepted-collaborator sites in one list with live iframe previews, stat cards (total/published/storage/plan), expandable cards, clickable detail rows, plan-limit enforcement. Collaborator cards are visually separated from owner-action affordances (Delete/Settings hidden) |
| Template gallery | `/dashboard/templates` | 6 template seeds with live previews, Community/Personal tabs, site name + subdomain fields, plan-limit gate |
| Site settings | `/dashboard/sites/:id/settings` | Hosting summary, password protection, search indexing toggle, visitor dark-mode toggle, collaborator invitations/removal |
| Nav editor | `/dashboard/sites/:id/nav` | Bar layout, logo, sticky toggle, link management, per-page suppression |
| Page SEO settings | `/dashboard/sites/:id/pages/:id/seo` | Title (60-char counter), description (160-char counter), canonical, noIndex, locale |
| Forms inbox | `/dashboard/sites/:id/forms` | Submission list per form, CSV export |
| Version timeline | `/dashboard/sites/:id/snapshots` | Snapshot history with preview iframe, restore, manual snapshot with label |
| A11y report | `/dashboard/sites/:id/a11y` | 6-check audit with blocking/warning/info severity badges, element-level remediation hints |
| Chat panel | `/dashboard/sites/:id/chat` | Multi-turn AI chat with streaming SSE, canvas-aware tool calls |
| Domains | `/dashboard/sites/:id/domains` | Custom hostname registration, CNAME/HTTP verification, status polling |
| Site addons | `/dashboard/sites/:id/addons` | Per-site enable/disable + config for owned addons |
| Addon shop | `/dashboard/shop` | Browse and acquire addons (GA4, Custom Scripts) |
| Profile | `/dashboard/profile` | Avatar, display name, bio, timezone, sign out |
| Account settings | `/dashboard/settings` | Billing tab (Free/Pro/Team plans), usage meters (sites, storage, AI generations), invoices |

**Key files:** [routes/dashboard/](src/routes/dashboard/), [shell.tsx](src/routes/dashboard/shell.tsx)

---

## 37. Landing Page

Public marketing page at `/` with:

| Component | Description |
|---|---|
| **Hero** | Full-viewport animated product demo with miniature editor sidebar, canvas preview, agent panel, and multiplayer cursors |
| **Tagline** | h1: "multiplayer site builder with an agent at the cursor." |
| **Feature grid** | Three differentiator cards (01/02/03) |
| **Stat line** | Runtime counters: LOC, demo edit ops, agent ops, published sites |
| **Footer** | MIT license, CTA, GitHub/docs links |
| **Status bar** | Brand, docs link, GitHub link |
| **Auth-state chrome** | Clerk-js boots after first paint on the landing page; once a session resolves, `[data-signed-in]` is stamped on `<html>` and CSS swaps header buttons, hero CTA, and footer CTA between signed-out (Sign in / Start building → `/dashboard`) and signed-in (Open dashboard) variants |

Dark color scheme, Google Fonts integration, a JS-driven hero demo canvas, and fully server-rendered page shell.

**Key files:** [landing/](src/landing/)

---

## 38. Email System

| Capability | Detail |
|---|---|
| Provider | Resend (direct HTTP API, no SDK) |
| From address | Environment-driven `${EMAIL_FROM}` (per [ADR 0018](docs/adr/0018-email-sender-from-env.md)); defaults to `rev01 <noreply@rev01.aayushman.dev>` for the rev01 deployment |
| Templates | Responsive HTML email (480px table-based) |
| Hosted brand-mark | All transactional templates emit a hosted brand-mark PNG header (no inline SVG, no attachment) so every mail client renders the brand identically |
| Copyright footer | Every template renders a copyright footer line beneath the body |
| Invite email | Collaborator invitation with branding, role details, CTA button, expiration notice |
| Signed links | HMAC-signed acceptance URLs |
| Form-submission email | Owner notification on every visitor submission (see [§19](#19-forms--submissions)) |
| Notification email policy | Notifications ([§44](#44-in-app-notifications)) email per kind: `form_submission` + `access_event` always, `publish_event` only on failure, `collaborator_event` only when the recipient is the subject |
| Fail loudly | Per [`src/email/send.ts`](src/email/send.ts) the send path raises on Resend failure — no silent retry queue, no "delivered" flag |

**Key files:** [email/](src/email/)

---

## 39. Slot History (Element Asset History)

| Capability | Detail |
|---|---|
| MRU tracking | Track previously-used assets per media element slot |
| Gallery picker | Show asset history in media picker UI |
| Restore | Swap element back to a previously-used asset |
| Clear | Clear element history |
| Composite key | `(site_id, element_id, owner_asset_id)` |

**Key files:** [slot-history.ts](src/routes/api/slot-history.ts)

---

## 40. Motion Presets

16 animation presets per style kit:

| Preset | Effect |
|---|---|
| `none` | No animation |
| `fade-up` | Translate Y + fade |
| `fade-down` | Translate Y (negative) + fade |
| `fade-in` | Opacity only |
| `fade-right` | Translate X + fade |
| `slide-left` | Translate X |
| `slide-up` | Translate Y |
| `slide-right` | Translate X (negative) |
| `scale-in` | Scale from 96% + fade |
| `zoom-out` | Scale from 108% + fade |
| `blur-in` | Opacity (blur implied by kit) |
| `rotate-in` | Rotate -6deg + scale 95% + fade |
| `flip-in` | Perspective + rotateY 90deg + fade |
| `bounce-in` | Scale from 60% + fade |
| `stagger-children` | Translate Y + fade with 60ms delay per child |
| `slow-drift` | Subtle translateY |
| `parallax-soft` | Soft parallax translateY |

Each kit customizes the exact values (distance, scale factor, delay) to match its personality.

---

## 41. Database Schema (17 Tables)

| # | Table | Purpose | Key Relationships |
|---|-------|---------|-------------------|
| 1 | `customer` | Owner accounts | Root entity; FK from site, ownerAsset, etc.; carries `displayName` for awareness labels |
| 2 | `site` | Sites | Belongs to customer; holds editable_state + published_snapshot + pages as JSONB |
| 3 | `site_collaborator` | Collaboration | Links customer to site with role + invite state (accepted/pending/declined) |
| 4 | `owner_asset` | Media assets | Belongs to customer; content-hash keyed R2 storage |
| 5 | `slot_history` | Element media history | Composite PK: (site_id, element_id, owner_asset_id) |
| 6 | `custom_domain` | Custom hostnames | Belongs to site; CF hostname ID + verification state |
| 7 | `form_submission` | Form data | Belongs to site; JSONB payload + hashed IP |
| 8 | `site_snapshot` | Version history | Belongs to site; Yjs binary + reason + label |
| 9 | `site_font` | Custom fonts | Belongs to site; WOFF2 in R2 |
| 10 | `site_search_entry` | Full-text search | Belongs to site; auto-generated tsvector + GIN index |
| 11 | `chat_session` | AI chat history | Belongs to site + customer; JSONB messages |
| 12 | `library_section` | Reusable sections | Optional customer FK; global or private |
| 13 | `custom_template` | Saved templates | Optional customer FK; global or private |
| 14 | `addon_entitlement` | Addon access | Belongs to customer (account-level) |
| 15 | `site_addon` | Per-site addon config | Belongs to site; JSONB config |
| 16 | `notification` | Per-recipient notification rows | Tagged-union `recipient_kind ∈ {customer, site}`; closed `kind` enum; jsonb `payload`; `read_at` for customer-recipient read state |
| 17 | `notification_read` | Per-collaborator read state for site-kind notifs | `(notification_id, customer_id, read_at)`; absence means unread for me |

Legacy `page` and `template` tables were dropped in `0010_drop_legacy_template_page.sql`; site pages now live inside the `site.editableState` / `site.publishedSnapshot` JSONB.

14 migrations in `drizzle/`: initial schema (`0000`), asset pipeline (`0001`), designer templates (`0002`), addon/collaborator system (`0003`), customer profile fields (`0004`), site-limit guard (`0005`), hot-path indexes (`0006`), customer plan (`0007`), plan-aware site limit (`0008`), lowercase customer emails (`0009`), drop legacy template+page (`0010`), library section description (`0011`), visitor theme three-way enum (`0012`), notifications + notification_read (`0013`).

**Key files:** [db/schema.ts](src/db/schema.ts), [drizzle/](drizzle/)

---

## 42. API Surface (95+ Endpoints)

### Public (No Auth)

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Landing page or published site (based on host) |
| GET | `/health` | Health check |
| GET | `/favicon.ico` | Favicon SVG |
| GET | `/sitemap.xml` | XML sitemap |
| GET | `/robots.txt` | Robots.txt |
| GET | `/og/:siteId/:pageSlug.png` | OG image |
| GET | `/fonts/:contentHash` | Public font file |
| GET | `/assets/:contentHash` | Public asset file |
| POST | `/__rev01/forms/:siteId/:formId` | Form submission |
| GET | `/__rev01/search?q=` | Site search |
| POST | `/__rev01/unlock` | Password unlock |
| GET | `/__live?siteId=&role=` | WebSocket upgrade |

### Authenticated API (Clerk Auth)

| Category | Endpoints | Example |
|---|---|---|
| Sites | 6 | `POST /api/sites`, `GET /api/sites/:id`, `PUT /api/sites/:id` |
| Publishing | 2 | `POST /api/publish/sites/:id`, `POST .../unpublish` |
| Canvas Agent | 2 | `POST .../canvas-agent/preview`, `POST .../canvas-agent/apply` |
| Chat | 2 | `POST .../chat`, `GET .../chat/stream` |
| Assets | 5 | `POST /api/owner/assets`, `GET /api/owner/assets`, `DELETE ...` |
| Fonts | 3 | `POST .../fonts`, `GET .../fonts`, `DELETE .../fonts/:id` |
| Collaborators | 3 | `POST .../collaborators`, `GET ...`, `DELETE ...` |
| Sections | 2 | `GET /api/templates/sections`, `POST .../sections/import` |
| Library | 3 | `GET /api/library/sections`, `POST ...`, `DELETE ...` |
| Custom Templates | 3 | `GET /api/custom-templates`, `POST ...`, `DELETE ...` |
| Version History | 4 | `GET .../snapshots`, `POST ...`, `POST .../restore`, `GET .../preview` |
| Custom Domains | 3 | `POST .../domains`, `GET ...`, `DELETE ...` |
| Password | 2 | `PUT .../password`, `DELETE .../password` |
| Forms | 2 | `GET .../submissions`, `GET .../export.csv` |
| Search | 1 | `GET /__rev01/search` |
| A11y | 1 | `GET .../a11y` |
| Addons | 4 | `POST .../acquire`, `DELETE ...`, `PUT .../config`, `GET .../sites/:id` |
| Slot History | 3 | `GET .../history`, `PUT .../history/:id`, `DELETE .../history` |
| Profile | 2 | `GET /api/profile`, `PATCH /api/profile` |
| Import | 1 | `POST /api/import` |
| On-Site Edit | 1 | `GET /api/on-site-edit` |
| Notifications | 3 | `GET /api/notifications?since=&limit=`, `GET /api/notifications/stream` (SSE), `POST /api/notifications/:id/read` |

### Edit Token API (Cookie Auth)

Proxy endpoints under `/__api/` using edit-token cookie instead of Clerk: canvas, canvas-agent, publish, owner/assets, sections/import, library/sections, custom-templates, chat.

### Dashboard UI Routes

14 dashboard pages under `/dashboard/` (see Dashboard section above).

### Durable Objects

- **SiteRoom** — WebSocket fan-out for live updates and co-editing
- **FormRateLimiter** — Per-IP form submission rate limiting
- **NotificationOwnerRoom** — Per-Owner SSE pub-sub hub for live notification delivery (ADR 0043)

### Scheduled

- `*/5 * * * *` — Custom domain status polling cron

---

## 43. Infrastructure & DevOps

| Component | Technology |
|---|---|
| **Runtime** | Cloudflare Workers (Edge) |
| **Framework** | Hono 4.12 |
| **Database** | Neon Serverless Postgres via Drizzle ORM |
| **Object Storage** | Cloudflare R2 (`rev01-assets`) |
| **Stateful Actors** | Cloudflare Durable Objects (SiteRoom, FormRateLimiter, NotificationOwnerRoom) |
| **Auth** | Clerk |
| **Email** | Resend |
| **AI** | Google Gemini 2.5 Pro |
| **Image Gen** | Replicate (Flux Schnell) |
| **Bot Protection** | Cloudflare Turnstile |
| **DNS** | Cloudflare Custom Hostnames API |
| **Scraper** | External Playwright service |
| **Collab** | Yjs CRDT + y-protocols |
| **OG Rendering** | Satori + resvg-wasm |
| **Syntax Highlight** | Shiki |
| **CI/CD** | GitHub Actions (typecheck, lint, smoke, deploy) |
| **Testing** | Playwright (E2E), 40+ Bun smoke test scripts |
| **Package Manager** | Bun 1.3.14 |
| **TypeScript** | 6.0.3 (strict mode, ES2022) |

### Environment Secrets

`DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CF_API_TOKEN`, `CF_ZONE_ID`, `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY`, `WEBHOOK_SIGNING_SECRET`, `UNLOCK_SIGNING_SECRET`, `RESEND_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `SCRAPER_URL`, `SCRAPER_API_SECRET`

### Routing

- `rev01.aayushman.dev` — Custom domain (dashboard + API + landing)
- `*.rev01.aayushman.dev` — Wildcard (published sites at `<subdomain>.rev01.aayushman.dev`)

---

## 44. In-app Notifications

Per [ADR 0043](docs/adr/0043-in-app-notifications.md), Phases A–F shipped 2026-06-01. Persistent, recipient-tagged inbox + per-Owner SSE live delivery + per-kind email policy. Closes the "have I missed anything?" gap for Owners who step away from the editor.

### Kinds

| Kind | When it fires | Recipient(s) | Email policy |
|---|---|---|---|
| `form_submission` | Visitor submits a form on a site | The site (every collaborator via `notification_read` fan-out) | Always |
| `collaborator_event` (`invited` / `joined` / `left`) | Site membership changes | The affected collaborator (customer-recipient row) + their teammates (site-recipient row) | Email only when *I* am the subject |
| `publish_event` (`succeeded` / `failed`) | A publish completes or fails | The site | Email only on failure |
| `access_event` (`role_changed` / `revoked`) | A collaborator's role changes or access is revoked | The affected collaborator + their teammates | Always (the affected Owner cannot recover from a silent revoke) |

### Row shape

```
notification (
  id, created_at, kind, recipient_kind ∈ {customer, site},
  recipient_id, payload jsonb, read_at nullable
)
notification_read (notification_id, customer_id, read_at)  -- site-kind only
```

`kind` is a closed enum (`NOTIFICATION_KINDS` in [db/schema.ts](src/db/schema.ts)); each kind has a typed payload defined in [src/notifications/kinds.ts](src/notifications/kinds.ts) and a constructor in [src/notifications/constructors.ts](src/notifications/constructors.ts) called inside the same transaction that commits the underlying event.

### Surfaces

| Surface | Where | What it shows |
|---|---|---|
| Dashboard top-bar bell | Every dashboard route | Unread badge; click opens the inbox dropdown with the 30 most-recent items the customer can see |
| Editor header bell | Every canvas-editor route | Same dropdown chrome via shared [bell-styles.ts](src/notifications/bell-styles.ts) |
| Inbox row | Each item | One-line summary + relative timestamp + "go here" deep-link to the upstream surface (forms inbox, collaborators panel, etc.) |
| Notification email | Recipient's account address | Per-kind policy (table above); fail-loudly per `sendEmail` contract — no outbox |

### Live delivery

| Capability | Detail |
|---|---|
| Transport | Server-Sent Events at `GET /api/notifications/stream` (Clerk-authed) |
| Fan-out | Per-Owner `NotificationOwnerRoom` Durable Object holds the SSE response refs; writer calls `ownerDO.notify({ kind, id })` at row-write time |
| Reconnect | Native EventSource `Last-Event-ID` plus a `?since=<iso>` backfill on (re)connect — no buffered queue in the DO |
| No silent fallback | If the SSE broadcast drops, the row already sits in Neon; backfill on reconnect closes the gap; no retry layer (per [CLAUDE.md](../CLAUDE.md) no-fallback rule) |
| Read-state propagation | "Marked read" rides the same SSE channel as a `read-state-changed` event so multiple open tabs converge |

### Read API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notifications?since=&limit=` | List inbox + unread count; recipient scope = `{me}` ∪ `{sites I own or accepted-collaborate on}` |
| GET | `/api/notifications/stream` | Long-lived SSE stream of `notification` and `read-state-changed` events |
| POST | `/api/notifications/:id/read` | Idempotent per-row mark-read. Customer-recipient writes `notification.read_at`; site-recipient writes a `notification_read` row. Rejects 404 if invisible to caller |

### Out of v1 scope

SMS, Web Push, mentions (no comment model yet), notification preferences UI, bulk-mark-read, on-site public editor inbox (the `/?edit` edit-token surface), digest email mode, retention beyond 90 days.

**Key files:** [src/notifications/](src/notifications/), [src/routes/api/notifications.ts](src/routes/api/notifications.ts), [drizzle/0013_notifications.sql](drizzle/0013_notifications.sql), [ADR 0043](docs/adr/0043-in-app-notifications.md)

---

## Feature Count Summary

| Category | Count |
|---|---|
| Design primitive types | 14 |
| Inline rich text mark types | 7 (bold, italic, underline, strike, code, highlight, link) |
| Rich text keyboard shortcuts | 4 (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+K) |
| Built-in style kits | 4 (+custom) |
| Template seeds | 6 (+custom; includes Apogee all-elements showcase) |
| Motion presets | 16 |
| Surface variants | 7 |
| Action button variants | 7 |
| Shape variants | 6 |
| Embed providers | 9 (+generic) |
| Chart types | 5 |
| Code languages | 11 |
| A11y check categories | 6 |
| Database tables | 17 |
| Drizzle migrations | 14 |
| API endpoints | 95+ |
| Dashboard panels | 14 |
| Dashboard sidebar links | 9 |
| Editor header actions | 7 (AI, Chat, Bell, Settings gear, A11y, Save, Publish, Save as template — bell shared with dashboard) |
| Canvas agent mutating tools | 15 |
| Chat read-only tools | 2 (`query_site`, `query_assets`) |
| Notification kinds | 4 (`form_submission`, `collaborator_event`, `publish_event`, `access_event`) |
| Durable Object classes | 3 (SiteRoom, FormRateLimiter, NotificationOwnerRoom) |
| E2E inventory areas | 71 |
| Smoke test scripts | 40+ |
| External integrations | 13 |
| Addon types | 2 |

---

## Micro-Features & Edge Cases (Demo Drop-In Details)

### Canvas & Rendering
- **Section background video** — any section can have a looping autoplay muted background video (`<video autoplay loop muted playsinline>`) behind its elements
- **6 background effects** — sections support `grain`, `grid`, `soft-light`, `paper`, `glass` texture overlays (schema + data attributes emitted, CSS expansion point)
- **Section entrance animations** — per-section `entrance` field with 16 motion presets; IntersectionObserver triggers CSS transition on scroll-into-view
- **Popup/modal sections** — sections with `trigger` field render hidden and appear as modals via exit-intent (mouse leaves viewport), delay (N ms), or scroll-depth (N%) triggers; dismissed state persisted in localStorage per visitor per section
- **Element rotation** — any positioned element supports independent CSS `transform: rotate()` via `box.rotation`
- **Element opacity** — per-element opacity applied inline
- **Shared element style object** — every element can carry `elementStyle` for background color/image, background-size, border radius/color/width, opacity, box shadow, text color, and overflow
- **Element style data attributes** — published wrappers emit `data-es-bg`, `data-es-radius`, `data-es-border`, and `data-es-shadow` hooks when the corresponding style controls are active
- **Pinned styles** — owner-set style overrides that survive style kit switches (not cleared when changing kit)
- **Page background override** — pages can carry a `pageBackground` CSS value that paints the editor artboard and published page
- **Apogee all-elements seed** — the showcase fixture covers text, media, action, shape, container, form, embed, code, chart, table, accordion, carousel, nav, and collection in one demo site
- **Custom 404 pages** — a page with slug `_404` in the snapshot is served as the site's 404 page; regular routing excludes it
- **Background effect data attributes** — every section emits `data-bg-effect` and `data-entrance` to the published DOM for CSS/JS hook-in

### Text & Content
- **Paste-safe rich text** — pasted HTML preserves bold/italic/link marks, strips unsupported formatting; DOM parser reads back `<strong>`, `<em>`, `<a>`, `<mark>`, `<code>`, `<s>`, `<u>` tags
- **Adjacent run merging** — identical inline mark sequences are auto-merged for clean schema (prevents bloated JSON from repeated typing/deleting)
- **Mark nesting order** — marks applied in fixed order (code > highlight > strike > underline > italic > bold > link) so identical runs always produce identical HTML
- **Editor link visitor preview** — link popovers show an Open action and a visitor-styled preview for inline links, action elements, and nav links
- **Canvas link click handling** — action and nav links are inspectable/clickable in the editor without hijacking text-editing caret behavior
- **Href legacy normalization** — action element hrefs stored as string or `{type, url}` object; renderer normalizes both forms seamlessly

### Security & Integrity
- **A11y audit crash isolation** — if any accessibility check throws, the exception is caught and converted to a blocking `audit-crash` issue rather than crashing the publish flow
- **Contrast resolution against innermost container** — the contrast checker resolves computed background from the innermost wrapping surface by area, then z-index, before falling back to page kit background
- **Heading level derived from font size** — the heading-order check converts absolute pixel fontSize into H-level via per-kit headingScale multiplier rather than hardcoding
- **Atomic search index rebuild** — batch DELETE+INSERT inside a single Drizzle call so concurrent readers see either old or new index, never an empty intermediate state
- **Form webhook HMAC-SHA256 signing** — `X-Rev01-Signature` header on every webhook POST; owner can verify payloads server-side
- **SMTP header injection hardening** — form email fields are sanitized before Resend payload construction
- **Inline-link XSS hardening** — editor link marks and theme-panel attribute output escape unsafe values before DOM/HTML insertion
- **Version timeline XSS hardening** — version-preview metadata avoids unsafe `innerHTML` insertion for owner-controlled values
- **Chart SVG attribute escaping** — chart legends and labels escape attribute values before SVG emission
- **Element selector escaping** — canvas CSS selectors escape user-controlled element IDs
- **GA measurement validation** — Google Analytics addon config is validated server-side before script emission
- **On-site edit origin binding** — edit tokens are bound to the intended site origin and can authorize custom-domain editor sessions
- **Dual rate limiter architecture** — InProcessRateLimiter for development/smoke tests, DurableObjectRateLimiter for production; same interface, swappable
- **Y.Doc deterministic encoding** — Yjs state encoded in stable field order within a single `doc.transact()` call; byte-equal output for same input across runtimes
- **Redirect sanitization** — password unlock redirect validates paths start with `/`, rejects protocol-relative `//` URLs and control characters
- **CSP frame-src from embed providers** — Content-Security-Policy `frame-src` dynamically includes only the embed providers used on the current page

### Responsive & Layout
- **3 breakpoints with per-element overrides** — desktop (page width), tablet (1023px), phone (375px); any element can override position/size/visibility per breakpoint independently
- **Table phone collapse** — tables emit per-cell `data-label` attributes; CSS media query switches to stacked-card layout on phone without JavaScript
- **Carousel via CSS attribute selectors** — active slide controlled by `[data-rev01-slide-index]` matching; no client-side state management
- **Responsive scaling factors** — fixed reference widths with proportional scale factors for element repositioning across breakpoints

### AI & Generation
- **AI image generation** — Replicate Flux Schnell model; 8 aspect ratio presets (1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3, 21:9); owner describes the image in natural language
- **AI section design** — agent can create entire new sections from natural language via `designSection` tool; uses layout engine (stack/grid/split) to position elements
- **AI site inspection** — chat can call `query_site` for a token-capped summary or full element listing before proposing operations
- **AI asset inspection** — chat can call `query_assets` so media operations reference concrete uploaded asset IDs
- **AI full-site operations** — agent tools cover element CRUD, section CRUD, page CRUD, style-kit switching, and site-level config updates
- **Section recipe catalog** — 8+ predefined section layouts (hero, features, CTA, testimonials, etc.) the agent can reference when creating sections
- **Chat session persistence** — multi-turn conversations saved to database; resume across page reloads via session ID

### Asset System
- **Content-addressed deduplication** — two owners uploading identical bytes share the same R2 object; separate ownerAsset rows preserve ownership (ADR 0004)
- **Magic-byte image dimension probing** — PNG/JPEG/GIF/WebP dimensions detected via first bytes; no full decode needed
- **Slot history MRU ordering** — media picker shows previously-used assets per element slot, most recent first
- **Section import seed materialization** — importing template sections auto-creates owner-rooted asset copies with stable `seed-<customerId>-<rawSeedId>` IDs

### Notifications (ADR 0043)
- **Tagged-union recipient** — one `notification` row never crosses recipient classes; fan-out to multiple recipients happens at write time
- **Per-collaborator read state for site-kind** — `notification_read` join table; absence of a row means unread for me; one row per site-kind notif, not N rows fanned out at write
- **Compile-time kind/payload symmetry** — `PayloadByKind` index in [kinds.ts](src/notifications/kinds.ts) plus a bidirectional `extends`-check fails the TS build if a new kind ships without a payload (or vice versa)
- **SSE + DO fan-out** — per-Owner `NotificationOwnerRoom` holds the SSE response refs; writer pushes `{ kind, id }` at row-write time; DO holds no subscription state
- **No silent fallback on live channel** — persisted row is truth; `Last-Event-ID` + `?since=…` backfill closes any drop; no retry, no in-memory queue, no `delivered` flag
- **Per-kind email policy** — `form_submission`/`access_event` always email; `publish_event` only on failure; `collaborator_event` only when *I* am the subject — policy lives in [email-policy.ts](src/notifications/email-policy.ts)

### Reusability
- **Section Library** — save any section with its asset manifest as a reusable library entry; import into any other site page (see [§15](#15-section-library--cross-template-import))
- **Custom Templates** — save an entire site as a reusable template (private to owner or admin-published as Community) (see [§16](#16-custom-templates))

### i18n & Localization
- **RTL language detection** — Arabic, Farsi, Hebrew, Urdu (plus region variants) trigger right-to-left rendering
- **RTL coordinate mirroring** — positioned elements have x-coordinates mirrored for RTL layouts
- **Per-page locale routing** — `/<locale>/<slug>` URL structure with `<html lang dir>` emission
- **BCP-47 locale resolution** — full locale chain with fallback

### Visitor Experience
- **Light/dark mode toggle** — dual `:root` palette CSS emission; early inline script prevents theme flash; respects `prefers-color-scheme` then localStorage
- **Pre-computed dark variants** — built-in kits have pre-calculated dark mode palettes (not just inverted)
- **Popup dismissal persistence** — modal popups remember dismissal per visitor per section via localStorage
- **Live visitor tab update** — publishing broadcasts rendered HTML to all open visitor tabs via WebSocket Durable Object fan-out; visitors see changes without refreshing

### Dashboard & Discoverability
- **Clickable site detail rows** — hosting, custom domain, password protection, search indexing, visitor dark mode, analytics, and style-kit rows link to the owning control surface
- **Settings anchors** — dashboard detail rows deep-link to `#hosting`, `#password`, `#seo`, and `#dark-mode` sections on the redesigned settings page
- **Community vs personal templates** — global/built-in templates and private owner templates are separated in the create-site flow
- **Public import disablement** — hosted demo disables the import button with an explicit title instead of exposing a known unavailable scraper path

### Developer Quality
- **40+ smoke test scripts** — hermetic, no network, no DB; run via `bun run <name>:smoke`; serial chain runner in `wishlist-smoke.ts`
- **Pure validators** — canvas state validator collects ALL errors (never fails fast); guards page width, section height, element types, href schemes, inline marks
- **Layout engine** — semantic tree (stack/grid/split) resolved to positioned CanvasSection; pure recursion with fill-size container backgrounds
- **Design section parser** — converts LLM semantic layout output into positioned canvas section with validated element placement
